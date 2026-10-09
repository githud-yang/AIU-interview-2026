"""Compute display status and publish YOLO state without owning inference resources."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime, timezone
import json
import math
import time


def status_snapshot(manager, *, now: datetime | None = None) -> dict:
    """Keep elapsed-time calculation on the server; inactive sessions show no timer."""
    current = dict(manager.status())
    elapsed = None
    started_at = current.get("started_at")
    if current.get("state") in {"starting", "running", "stopping"} and started_at is not None:
        try:
            if isinstance(started_at, (float, int)):
                started = datetime.fromtimestamp(started_at, timezone.utc)
            else:
                started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                if started.tzinfo is None:
                    started = started.replace(tzinfo=timezone.utc)
            duration = ((now or datetime.now(timezone.utc)) - started).total_seconds()
            if math.isfinite(duration):
                elapsed = max(0, math.floor(duration))
        except (ValueError, TypeError, AttributeError, OverflowError, OSError):
            pass
    current["elapsed_seconds"] = elapsed
    return current


def status_frame(status: dict) -> str:
    payload = json.dumps(status, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    return f"event: status\ndata: {payload}\n\n"


async def yolo_events(manager, request, *, interval: float = 1.0,
                      heartbeat: float = 15.0) -> AsyncIterator[str]:
    """Send an initial snapshot, changed states and idle heartbeats until disconnect.

    The subscription owns no camera, inference worker or persistent queue. Closing
    or cancelling the generator releases its local state and never stops a shared
    detection session used by another browser.
    """
    previous = None
    last_sent = time.monotonic()
    while not await request.is_disconnected():
        current = await asyncio.to_thread(status_snapshot, manager)
        if await request.is_disconnected():
            return
        if previous is None or current != previous:
            prefix = "retry: 2000\n" if previous is None else ""
            yield prefix + status_frame(current)
            previous = current
            last_sent = time.monotonic()
        elif time.monotonic() - last_sent >= heartbeat:
            yield ": heartbeat\n\n"
            last_sent = time.monotonic()
        await asyncio.sleep(interval)
