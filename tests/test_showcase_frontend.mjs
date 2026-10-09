/** Exercise the showcase HTTP boundary offline; no browser or model service is contacted. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createShowcaseTransport } from "../src/web/static/showcase-transport.js";

test("showcase requests are read-only, evidence IDs stay in one encoded path segment", async () => {
  const calls = [];
  const transport = createShowcaseTransport({ fetchImpl: async (path, options) => {
    calls.push({ path, options });
    return { ok: true, text: async () => "registered evidence", json: async () => ({
      checkedAt: "2026-10-10", note: "read-only", services: [{ id: "local", label: "model", detail: "offline", available: false }],
    }) };
  } });
  assert.equal((await transport.getPreflight()).services[0].available, false);
  assert.equal(await transport.getEvidenceText("../configs/.env"), "registered evidence");
  assert.equal(calls[1].path, "/api/showcase/files/..%2Fconfigs%2F.env");
  assert.ok(calls.every(({ options }) => options.method === "GET" && !options.body));
  assert.throws(() => transport.evidenceUrl(""), /编号无效/);
  transport.close();
});

test("offline, malformed and unsuccessful responses become actionable errors", async () => {
  let reply = async () => { throw new TypeError("fetch failed"); };
  const transport = createShowcaseTransport({ fetchImpl: (...args) => reply(...args) });
  await assert.rejects(transport.getPreflight(), /无法连接本机/);
  reply = async () => ({ ok: false, status: 404 });
  await assert.rejects(transport.getEvidenceText("missing"), /HTTP 404/);
  reply = async () => ({ ok: true, json: async () => ({ checkedAt: "now", note: "x", services: [{ available: "false" }] }) });
  await assert.rejects(transport.getPreflight(), /格式不完整/);
  reply = async () => ({ ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } });
  await assert.rejects(transport.getShowcase(), /无法读取/);
  transport.close();
});

test("closing evidence, unloading and timeout cancel pending reads and clear timers", async () => {
  const timers = new Map();
  let timerId = 0;
  const transport = createShowcaseTransport({
    setTimer: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimer: (id) => timers.delete(id),
    fetchImpl: (_path, { signal }) => new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }),
  });
  const controller = new AbortController();
  const evidence = transport.getEvidenceText("training", { signal: controller.signal });
  controller.abort();
  await assert.rejects(evidence, { name: "AbortError" });
  assert.equal(timers.size, 0);
  const preflight = transport.getPreflight();
  transport.close();
  await assert.rejects(preflight, { name: "AbortError" });
  assert.equal(timers.size, 0);
  const timed = transport.getPreflight();
  timers.values().next().value();
  await assert.rejects(timed, /超时/);
  assert.equal(timers.size, 0);
});
