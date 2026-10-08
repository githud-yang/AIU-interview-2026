"""Export a new paper revision from frozen results, without fitting or model calls."""
import argparse
import hashlib
import json
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run_id")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--evidence", default="evidence/research-export-smoke.json")
    args = parser.parse_args()
    with httpx.Client(base_url=args.base_url, timeout=60, trust_env=False) as client:
        before = client.get(f"/api/research/runs/{args.run_id}")
        before.raise_for_status()
        before = before.json()
        response = client.post(f"/api/research/runs/{args.run_id}/export")
        response.raise_for_status()
        after = response.json()
        for field in ("used_trials", "used_model_calls"):
            if before["budget"][field] != after["budget"][field]:
                raise ValueError("Text export unexpectedly changed scientific execution counts")
        old_hashes = {a["id"]: a["sha256"] for a in before["artifacts"]}
        after_hashes = {a["id"]: a["sha256"] for a in after["artifacts"]}
        if not old_hashes.items() <= after_hashes.items():
            raise ValueError("An existing artifact was overwritten during revision")
        downloads = []
        for item in after["artifacts"]:
            data = client.get(item["url"])
            data.raise_for_status()
            valid = hashlib.sha256(data.content).hexdigest() == item["sha256"]
            if not valid:
                raise ValueError("Artifact content differs from registered hash")
            downloads.append({"path": item["path"], "hash_matches": valid})
        evidence = {"run_id": args.run_id, "status": after["status"], "export": after["outputs"]["latest_export"],
            "new_model_calls": 0, "new_model_fits": 0, "old_artifacts_preserved": len(old_hashes),
            "verified_downloads": downloads, "manuscript": after["outputs"]["manuscript"],
            "intervention_count": after["intervention_count"], "budget": after["budget"]}
        target = Path(args.evidence)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"run_id": args.run_id, "revision": evidence["export"]["revision"],
            "discussion": evidence["export"]["discussion"], "verified_artifacts": len(downloads),
            "new_model_calls": 0, "new_model_fits": 0, "pdf": evidence["manuscript"]["pdf"]["path"],
            "evidence": str(target.resolve())}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
