"""Real stdio MCP handshake and read-only bridge verification; no new research."""
import asyncio
import json
import sys
from pathlib import Path

from mcp import Client
from mcp.client.stdio import StdioServerParameters


def tool_data(result):
    """SDKs may return either structured data or standard JSON text content."""
    if result.is_error:
        raise AssertionError(f"MCP tool failed: {result.content}")
    data = result.structured_content
    if data is None:
        data = json.loads("".join(item.text for item in result.content if item.type == "text"))
    if isinstance(data, dict) and "result" in data and len(data) == 1:
        data = data["result"]
    assert isinstance(data, dict), "MCP tool response must be a JSON object"
    return data


async def main():
    root = Path(__file__).resolve().parents[1]
    parameters = StdioServerParameters(command=sys.executable, args=["-X", "utf8", "-m", "src.research.mcp_server"], cwd=str(root))
    async with Client(parameters, read_timeout_seconds=20) as client:
        tools = await client.list_tools()
        names = [tool.name for tool in tools.tools]
        assert len(names) == 8
        start_schema = next(tool.input_schema for tool in tools.tools if tool.name == "research_start")
        optional_limits = {}
        for field in ("max_seconds", "model_calls", "max_trials"):
            definition = start_schema["properties"][field]
            assert field not in start_schema.get("required", [])
            assert definition.get("default") is None
            assert any(item.get("type") == "null" for item in definition["anyOf"])
            optional_limits[field] = "unset_by_default"
        runs = await client.call_tool("research_list_runs", {})
        assert not runs.is_error
        data = tool_data(runs)
        assert isinstance(data["runs"], list)
        invalid = await client.call_tool("research_get_run", {"run_id": "../../configs/.env"})
        assert invalid.is_error
        first = data["runs"][0] if data["runs"] else None
        verified = None
        if first and first["artifacts"]:
            verified = await client.call_tool("research_artifact", {"run_id": first["id"], "artifact_id": first["artifacts"][0]["id"]})
            assert not verified.is_error
        result = {"transport": "real_stdio", "tool_names": names, "run_count": len(data["runs"]),
                  "resource_limits": optional_limits,
                  "path_traversal_rejected": invalid.is_error,
                  "verified_artifact": tool_data(verified) if verified else None}
        target = root / "evidence" / "research-mcp-smoke.json"
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
