"""Transactional run journal independent of the graph checkpoint database."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .contracts import STAGES


def now():
    return datetime.now(timezone.utc).isoformat()


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


class ResearchStore:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.db = sqlite3.connect(str(self.root / "app.sqlite3"), check_same_thread=False, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
                request_hash TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_research
                ON runs ((1)) WHERE status IN ('queued','running','cancelling');
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
                body TEXT NOT NULL, FOREIGN KEY(run_id) REFERENCES runs(id));
            CREATE INDEX IF NOT EXISTS events_by_run ON events(run_id, seq);
            CREATE TABLE IF NOT EXISTS operations (
                run_id TEXT NOT NULL, operation_id TEXT NOT NULL, body TEXT NOT NULL,
                PRIMARY KEY(run_id,operation_id), FOREIGN KEY(run_id) REFERENCES runs(id));
        """)
        self.db.commit()

    def close(self):
        with self._lock:
            self.db.close()

    def get(self, run_id):
        with self._lock:
            row = self.db.execute("SELECT body FROM runs WHERE id=?", (run_id,)).fetchone()
            if row is None:
                raise KeyError(run_id)
            return json.loads(row[0])

    def list_runs(self, limit=30):
        with self._lock:
            return [json.loads(r[0]) for r in self.db.execute(
                "SELECT body FROM runs ORDER BY rowid DESC LIMIT ?", (limit,))]

    def _save(self, run):
        run["updated_at"] = now()
        self.db.execute("UPDATE runs SET status=?,body=? WHERE id=?",
                        (run["status"], encode(run), run["id"]))

    def _event(self, run_id, event):
        event = {"type": "state", "stage": None, "status": "", "message": "", "data": {},
                 "created_at": now(), **event}
        self.db.execute("INSERT INTO events(run_id,body) VALUES (?,?)", (run_id, encode(event)))

    def create(self, request):
        payload = request.model_dump(mode="json") if hasattr(request, "model_dump") else request
        digest = hashlib.sha256(encode(payload).encode()).hexdigest()
        with self._lock, self.db:
            old = self.db.execute("SELECT request_hash,body FROM runs WHERE request_id=?",
                                  (payload["request_id"],)).fetchone()
            if old:
                if old[0] != digest:
                    raise ValueError("同一 request_id 的任务内容发生变化")
                return json.loads(old[1]), False
            run_id = uuid.uuid4().hex
            run = {"id": run_id, "goal": payload["goal"].strip(), "domain": payload["domain"],
                   "mode": payload["mode"], "status": "queued", "stage": None,
                   "created_at": now(), "updated_at": now(), "progress": 0,
                   "budget": {**payload["budget"], "elapsed_seconds": 0.0,
                              "used_model_calls": 0, "used_trials": 0},
                   "stages": [{"id": k, "label": v, "status": "pending", "summary": ""}
                              for k, v in STAGES],
                   "outputs": {}, "artifacts": [], "interventions": [], "intervention_count": 0,
                   "automatic_recoveries": 0, "quality_status": "not_evaluated",
                   "summary": "任务已登记，等待执行", "error": "", "cancel_requested": False,
                   "model_mode": payload["mode"], "request_id": payload["request_id"]}
            try:
                self.db.execute("INSERT INTO runs VALUES (?,?,?,?,?)",
                                (run_id, payload["request_id"], digest, "queued", encode(run)))
            except sqlite3.IntegrityError as exc:
                raise ValueError("已有研究正在执行，请等待或取消当前任务") from exc
            self._event(run_id, {"type": "run_created", "status": "queued", "message": run["summary"]})
            return run, True

    def update(self, run_id, changes=None, *, event=None, mutate=None):
        with self._lock, self.db:
            run = self.get(run_id)
            if changes:
                run.update(changes)
            if mutate:
                mutate(run)
            self._save(run)
            if event:
                self._event(run_id, event)
            return run

    def event(self, run_id, **event):
        with self._lock, self.db:
            self._event(run_id, event)

    def events(self, run_id, after_seq=0, limit=250):
        self.get(run_id)
        with self._lock:
            rows = self.db.execute("SELECT seq,body FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?",
                                   (run_id, after_seq, limit)).fetchall()
            events = [{**json.loads(row[1]), "seq": row[0]} for row in rows]
            return {"events": events, "last_seq": events[-1]["seq"] if events else after_seq}

    def operation(self, run_id, operation_id):
        with self._lock:
            row = self.db.execute("SELECT body FROM operations WHERE run_id=? AND operation_id=?",
                                  (run_id, operation_id)).fetchone()
            return json.loads(row[0]) if row else None

    def finish_stage(self, run_id, stage, output, artifacts=None, summary=""):
        with self._lock, self.db:
            if stage not in dict(STAGES):
                raise ValueError("研究阶段未登记")
            run = self.get(run_id)
            previous = self.operation(run_id, stage)
            if previous is not None:
                if encode(previous) != encode(output):
                    raise ValueError("已完成步骤不可原地改写，请创建新版本或运行")
                return run
            run["outputs"][stage] = output
            for item in run["stages"]:
                if item["id"] == stage:
                    item.update(status="completed", summary=summary)
            existing = {a["id"] for a in run["artifacts"]}
            run["artifacts"].extend(a for a in (artifacts or []) if a["id"] not in existing)
            run["progress"] = round(100 * sum(s["status"] == "completed" for s in run["stages"]) / len(STAGES))
            run["summary"] = summary
            self.db.execute("INSERT INTO operations VALUES (?,?,?)",
                            (run_id, stage, encode(output)))
            self._save(run)
            self._event(run_id, {"type": "stage_completed", "stage": stage, "status": "completed",
                                 "message": summary, "data": {"artifact_count": len(artifacts or [])}})
            return run

    def run_dir(self, run_id):
        self.get(run_id)
        path = self.root / "runs" / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def artifact(self, run_id, path, kind="file"):
        path = Path(path).resolve()
        root = self.run_dir(run_id).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("产物必须是当前运行目录内的真实文件")
        relative = path.relative_to(root).as_posix()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        artifact_id = hashlib.sha256(relative.encode()).hexdigest()[:24]
        return {"id": artifact_id, "name": path.name, "kind": kind, "path": relative,
                "sha256": digest, "size_bytes": path.stat().st_size,
                "url": f"/api/research/runs/{run_id}/artifacts/{artifact_id}"}

    def artifact_path(self, run_id, artifact_id):
        run = self.get(run_id)
        record = next((a for a in run["artifacts"] if a["id"] == artifact_id), None)
        if not record:
            raise KeyError(artifact_id)
        path = (self.run_dir(run_id) / record["path"]).resolve()
        if not path.is_relative_to(self.run_dir(run_id).resolve()) or not path.is_file():
            raise KeyError(artifact_id)
        if hashlib.sha256(path.read_bytes()).hexdigest() != record["sha256"]:
            raise ValueError("产物哈希变化，已拒绝返回过期证据")
        return path

    def mark_stale(self):
        with self._lock, self.db:
            rows = self.db.execute("SELECT body FROM runs WHERE status IN ('queued','running','cancelling')").fetchall()
            for row in rows:
                run = json.loads(row[0])
                run["status"] = "cancelled" if run["cancel_requested"] else "interrupted"
                run["summary"] = "服务重启，正在核对已保存步骤"
                self._save(run)
                self._event(run["id"], {"type": "service_recovery", "status": run["status"],
                                         "message": run["summary"]})
