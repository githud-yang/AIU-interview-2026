"""Launch/observe one real research task through the same public API as the UI."""
import argparse
import json
import time
import uuid
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--goal", default="Study whether Gaussian training augmentation improves digit classification under noisy inputs while measuring its clean accuracy trade-off.")
    parser.add_argument("--run-id", help="Observe an existing run without creating another")
    parser.add_argument("--domain", choices=("digits_robustness", "yolo_tradeoff"), default="digits_robustness")
    parser.add_argument("--model-calls", type=int, help="Optional cumulative model-call limit")
    parser.add_argument("--seconds", type=int, help="Optional cumulative elapsed-time limit")
    parser.add_argument("--trials", type=int, help="Optional cumulative model-fit limit")
    parser.add_argument("--evidence", default="evidence/research-runtime-smoke.json")
    args = parser.parse_args()
    with httpx.Client(base_url=args.base_url, timeout=15, trust_env=False) as client:
        if args.run_id:
            run_id = args.run_id
        else:
            request = {"goal": args.goal, "domain": args.domain, "mode": "autonomous",
                       "request_id": uuid.uuid4().hex, "budget": {"max_seconds": args.seconds,
                           "model_calls": args.model_calls, "max_trials": args.trials}}
            response = client.post("/api/research/runs", json=request)
            response.raise_for_status()
            run_id = response.json()["id"]
        print("Run:", run_id, flush=True)
        previous = None
        while True:
            response = client.get(f"/api/research/runs/{run_id}")
            response.raise_for_status()
            run = response.json()
            state = (run["status"], run["stage"], run["budget"]["used_model_calls"], run["budget"]["used_trials"])
            if state != previous:
                print(state, run["summary"], flush=True)
                previous = state
            if run["status"] not in {"queued", "running", "cancelling"}:
                break
            time.sleep(2)
        downloads = []
        import hashlib
        for artifact in run["artifacts"]:
            response = client.get(artifact["url"])
            downloads.append({"name": artifact["name"], "http_status": response.status_code,
                "hash_matches": response.status_code == 200 and hashlib.sha256(response.content).hexdigest() == artifact["sha256"]})
        evidence = {"run": run, "verified_downloads": downloads,
                    "model_calls_actual": run["budget"]["used_model_calls"],
                    "human_interventions_actual": run["intervention_count"],
                    "limitations": ["Registered task only: " + run["domain"], "No novelty, external review or publication asserted"]}
        path = Path(args.evidence)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Evidence:", path.resolve(), flush=True)
        if run["status"] != "completed" or not all(item["hash_matches"] for item in downloads):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
