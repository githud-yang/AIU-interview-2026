"""Publish research snapshots, changed fields and journal events over SSE."""
from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator


def event_frame(name: str, data: dict, *, sequence: int | None = None) -> str:
    """Encode JSON on one SSE data line; journal cursors survive reconnects."""
    identifier = f"id: {sequence}\n" if sequence is not None else ""
    payload = json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    return f"{identifier}event: {name}\ndata: {payload}\n\n"


def reconnect_cursor(after_seq: int, last_event_id: str | None) -> int:
    """Treat Last-Event-ID as an untrusted optional, nonnegative cursor."""
    try:
        previous = int(last_event_id or "0")
    except (ValueError, TypeError):
        previous = 0
    if previous > 2**63 - 1:
        previous = 0
    return max(after_seq, previous, 0)


async def research_events(store, run_id: str, request, *, after_seq: int = 0,
                          interval: float = 1.0, heartbeat: float = 15.0) -> AsyncIterator[str]:
    """Read the journal off the event loop and emit only changes after snapshot.

    A connection owns no worker, queue or database handle. Cancellation and
    disconnect exit the generator; the shared store belongs to app lifecycle.
    Completed runs remain subscribed so later exports can still be published.
    """
    previous = None
    cursor = after_seq
    last_sent = time.monotonic()
    yield "retry: 2000\n\n"
    while not await request.is_disconnected():
        try:
            current = await asyncio.to_thread(store.get, run_id)
            if previous is None:
                yield event_frame("snapshot", {"run": current})
                last_sent = time.monotonic()
            else:
                changes = {key: value for key, value in current.items()
                           if key not in previous or previous[key] != value}
                removed = [key for key in previous if key not in current]
                if changes or removed:
                    yield event_frame("state", {"run_id": run_id, "changes": changes,
                                                "removed": removed})
                    last_sent = time.monotonic()
            previous = current
            if await request.is_disconnected():
                return
            # Drain full batches without imposing a 250-event reconnect gap.
            while True:
                batch = await asyncio.to_thread(store.events, run_id, cursor)
                if not batch["events"]:
                    break
                cursor = batch["last_seq"]
                yield event_frame("events", batch, sequence=cursor)
                last_sent = time.monotonic()
                if len(batch["events"]) < 250 or await request.is_disconnected():
                    break
        except KeyError:
            yield event_frame("unavailable", {"message": "研究记录已不可用，请刷新工作台。"})
            return
        if await request.is_disconnected():
            return
        if time.monotonic() - last_sent >= heartbeat:
            yield ": heartbeat\n\n"
            last_sent = time.monotonic()
        await asyncio.sleep(interval)
