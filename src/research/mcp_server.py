"""Optional stdio MCP bridge to the local research API; no filesystem/shell tools."""
from __future__ import annotations

import os
import re
from urllib.parse import urlsplit

import httpx
from mcp.server import MCPServer

BASE_URL = os.getenv("AIU_RESEARCH_URL", "http://127.0.0.1:8000").rstrip("/")
parts = urlsplit(BASE_URL)
if parts.scheme != "http" or parts.hostname not in {"127.0.0.1", "localhost", "::1"} or parts.username or parts.password or parts.path or parts.query or parts.fragment:
    raise ValueError("AIU_RESEARCH_URL must be a loopback HTTP origin")

mcp = MCPServer("aiu-research", instructions="Operate the user's local research workspace. Only registered experiments run. Research quality and publication are separate from workflow completion.")


def token(value: str, length=32):
    if not re.fullmatch(r"[a-f0-9]{" + str(length) + r"}", value):
        raise ValueError("Invalid server-issued research identifier")
    return value


async def api(method, path, body=None):
    async with httpx.AsyncClient(base_url=BASE_URL, trust_env=False, timeout=15) as client:
        response = await client.request(method, path, json=body)
        if not response.is_success:
            raise ValueError(f"Research API {response.status_code}: {response.text[:500]}")
        return response.json()


def compact(run):
    return {key: run.get(key) for key in ("id", "goal", "domain", "status", "stage", "progress", "budget",
        "stages", "summary", "error", "quality_status", "model_mode", "intervention_count", "interventions", "automatic_recoveries", "artifacts")}


@mcp.tool()
async def research_capabilities() -> dict:
    """Read actual model, writer, execution and registered-domain availability."""
    return await api("GET", "/api/research/capabilities")


@mcp.tool()
async def research_list_runs() -> dict:
    """List compact persisted runs; never starts work."""
    return {"runs": [compact(run) for run in (await api("GET", "/api/research/runs"))["runs"]]}


@mcp.tool()
async def research_get_run(run_id: str, include_outputs: bool = False) -> dict:
    """Read one server-issued run. Full outputs are opt-in to limit context size."""
    result = await api("GET", "/api/research/runs/" + token(run_id))
    return result if include_outputs else compact(result)


@mcp.tool()
async def research_events(run_id: str, after_seq: int = 0) -> dict:
    """Read subsequent actual events; reuse the returned last_seq cursor."""
    if after_seq < 0:
        raise ValueError("after_seq must be nonnegative")
    return await api("GET", f"/api/research/runs/{token(run_id)}/events?after_seq={after_seq}")


@mcp.tool()
async def research_start(goal: str, request_id: str, max_seconds: int | None = None, model_calls: int | None = None, max_trials: int | None = None) -> dict:
    """Start authorized research; resource limits are optional. Keep request_id stable after a lost response."""
    return compact(await api("POST", "/api/research/runs", {"goal": goal, "domain": "digits_robustness", "mode": "autonomous",
        "request_id": request_id, "budget": {"max_seconds": max_seconds, "model_calls": model_calls, "max_trials": max_trials}}))


@mcp.tool()
async def research_cancel(run_id: str) -> dict:
    """Cancel an identified run when cancellation is requested; retain its evidence."""
    return compact(await api("POST", f"/api/research/runs/{token(run_id)}/cancel"))


@mcp.tool()
async def research_resume(run_id: str) -> dict:
    """Resume failed/interrupted work; cumulative usage is retained and agent recovery is separate from human intervention."""
    return compact(await api("POST", f"/api/research/runs/{token(run_id)}/resume", {"initiator": "agent"}))


@mcp.tool()
async def research_artifact(run_id: str, artifact_id: str) -> dict:
    """Verify an artifact via the API and return its local download URL, size and SHA256; no arbitrary path accepted."""
    run_id, artifact_id = token(run_id), token(artifact_id, 24)
    run = await api("GET", f"/api/research/runs/{run_id}")
    item = next((a for a in run["artifacts"] if a["id"] == artifact_id), None)
    if not item:
        raise ValueError("Artifact not registered to this run")
    import hashlib
    async with httpx.AsyncClient(base_url=BASE_URL, trust_env=False, timeout=15) as client:
        response = await client.get(item["url"])
        response.raise_for_status()
        if hashlib.sha256(response.content).hexdigest() != item["sha256"]:
            raise ValueError("Artifact content differs from its registered hash")
    return {"name": item["name"], "url": BASE_URL + item["url"], "size_bytes": item["size_bytes"], "sha256": item["sha256"]}


if __name__ == "__main__":
    mcp.run(transport="stdio")
