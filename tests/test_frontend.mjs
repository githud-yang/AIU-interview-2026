/** No browser, model server, camera, npm package or network is needed.
 * Run from the repository root: node --test tests/test_frontend.mjs
 * These are DOM/state contract tests; they do not claim visual browser coverage.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const api = await import(new URL("../src/web/static/api.js", import.meta.url));
const { createYoloTransport } = await import(new URL("../src/web/static/yolo-transport.js", import.meta.url));
const moduleSource = (name) => readFileSync(new URL(`../src/web/static/${name}`, import.meta.url), "utf8").replace(/^import[^\n]*\n/gm, "");
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

// Only the DOM methods used by these modules are implemented. Writing innerHTML
// deliberately fails so a regression to unsafe rendering is visible.
class Element {
  constructor(id = "") {
    Object.assign(this, { id, value: "", textContent: "", children: [], dataset: {}, hidden: false, disabled: false, className: "", attrs: {}, classes: new Set(), listeners: new Map() });
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      toggle: (name, present) => present ? this.classes.add(name) : this.classes.delete(name),
    };
  }
  addEventListener(name, fn) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(fn);
    this.listeners.set(name, listeners);
  }
  dispatch(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn(event); }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  appendChild(child) { this.append(child); }
  replaceChildren(...children) { this.children.forEach((child) => { child.parent = null; }); this.children = []; this.append(...children); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; } }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; if (key === "src") this.src = ""; }
  focus() {}
  set innerHTML(_value) { throw new Error("Unsafe innerHTML write in frontend"); }
}

function makeDOM(ids) {
  const elements = Object.fromEntries(ids.map((id) => [id, new Element(id)]));
  const suggestions = [new Element(), new Element()];
  suggestions[0].dataset.message = "看看终端屏幕";
  suggestions[1].dataset.message = "检查实验室的门";
  const document = new Element("document");
  Object.assign(document, {
    hidden: false,
    getElementById: (id) => { assert.ok(elements[id], `Unmocked element ${id}`); return elements[id]; },
    createElement: () => new Element(),
    querySelectorAll: () => suggestions,
  });
  return { elements, suggestions, document };
}

test("API sends message/history and translates failed, empty and unreadable responses", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  try {
    globalThis.fetch = async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, json: async () => ({ reply: "ok" }) };
    };
    assert.equal(await api.sendChatMessage("action", [{ user: "u", ai: "a" }]), "ok");
    assert.equal(captured.url, "/api/chat");
    assert.equal(captured.options.method, "POST");
    assert.deepEqual(JSON.parse(captured.options.body), { message: "action", history: [{ user: "u", ai: "a" }] });
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ detail: "model offline" }) });
    await assert.rejects(api.sendChatMessage("x", []), /model offline/);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ reply: "" }) });
    await assert.rejects(api.sendChatMessage("x", []), /有效回复/);
    globalThis.fetch = async () => { throw new TypeError("failed fetch"); };
    await assert.rejects(api.sendChatMessage("x", []), /无法连接服务/);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } });
    await assert.rejects(api.getYoloStatus(), /无法读取的响应/);
  } finally { globalThis.fetch = originalFetch; }
});

test("Adventure locks duplicate sends, keeps 10-turn context and retries without adding false history", async () => {
  const dom = makeDOM(["chat", "input-form", "input", "send-btn", "reset-btn", "chat-error", "turn-count", "char-count", "chat-state", "send-label", "chat-error-text", "retry-btn", "check-connection", "model-status", "model-status-text", "model-name", "model-error"]);
  let saved = JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ user: `u${i}`, ai: `a${i}` })));
  const calls = [];
  let response;
  const context = {
    document: dom.document,
    sessionStorage: { getItem: () => saved, setItem: (_key, value) => { saved = value; } },
    sendChatMessage: (message, history) => { calls.push({ message, history }); response = deferred(); return response.promise; },
    getHealth: async () => ({ model: { available: true, provider: "ollama", model: "test" } }),
  };
  vm.runInNewContext(moduleSource("app.js"), context);
  await flush();
  assert.equal(dom.elements.chat.children.length, 25, "Restores 12 complete turns plus the prologue");
  assert.equal(dom.elements["model-status-text"].textContent, "已连接");
  const submit = (value) => { dom.elements.input.value = value; dom.elements["input-form"].dispatch("submit", { preventDefault() {} }); };
  submit("first");
  submit("duplicate");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].history.length, 10);
  assert.equal(calls[0].history[0].user, "u2", "Only the latest 10 complete turns enter the request");
  assert.equal(dom.elements["send-btn"].disabled, true);
  response.resolve("<script>plain text</script>");
  await flush();
  assert.equal(JSON.parse(saved).length, 13);
  assert.equal(dom.elements.chat.children.at(-1).children[1].textContent, "<script>plain text</script>");
  assert.equal(dom.elements["send-btn"].disabled, false);
  submit("failing");
  response.reject(new Error("offline"));
  await flush();
  assert.equal(dom.elements["chat-error"].hidden, false);
  assert.equal(JSON.parse(saved).length, 13, "An API error is not a successful AI turn");
  const failedSize = dom.elements.chat.children.length;
  dom.elements["retry-btn"].dispatch("click");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].message, "failing");
  assert.equal(dom.elements.chat.children.length, failedSize + 1, "Retry reuses the player bubble and adds just its pending reply");
  response.resolve("retry worked");
  await flush();
  assert.equal(JSON.parse(saved).length, 14);
  assert.equal(dom.elements["chat-error"].hidden, true);
  let imePrevented = false;
  dom.elements.input.dispatch("keydown", { key: "Enter", isComposing: true, shiftKey: false, preventDefault() { imePrevented = true; } });
  assert.equal(imePrevented, false, "IME confirmation must not submit the form");
  dom.elements["reset-btn"].dispatch("click");
  assert.equal(saved, "[]");
  assert.equal(dom.elements.chat.children.length, 1);
});

function visionHarness({ EventSourceImpl = null } = {}) {
  const dom = makeDOM(["source-select", "start-btn", "stop-btn", "refresh-btn", "video", "video-placeholder", "yolo-msg", "yolo-warning", "source-help", "source-overlay", "placeholder-title", "placeholder-description", "detection-status", "active-source", "detection-model", "fps", "frame-count", "elapsed"]);
  const window = new Element("window");
  const timers = new Map();
  const statusResponses = [];
  let nextTimer = 0;
  let current = { running: false, state: "stopped", frame_count: 0, fps: 0 };
  const calls = { starts: 0, stops: 0, status: 0 };
  const activeState = () => ({ running: true, state: "running", source: "demo", source_label: "公开样例", model: "best.pt", frame_count: 1, fps: 3.3, started_at: new Date().toISOString(), elapsed_seconds: 5 });
  const context = {
    document: dom.document, window, Date,
    getYoloSources: async () => ({ default: "demo", sources: [{ id: "demo", label: "静态样例", available: true }, { id: "video", label: "本地文件", available: false }] }),
    getYoloStatus: async () => { calls.status += 1; return statusResponses.length ? statusResponses.shift() : current; },
    startYolo: async () => { calls.starts += 1; current = activeState(); return { ok: true, ...current }; },
    stopYolo: async () => { calls.stops += 1; current = { ...current, running: false, state: "stopped" }; return { ok: true, ...current }; },
    getYoloStreamUrl: () => "/yolo/stream",
    setTimeout: (fn) => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  context.createYoloTransport = (options) => createYoloTransport({
    ...options, EventSourceImpl,
    readSources: context.getYoloSources, readStatus: context.getYoloStatus,
    requestStart: context.startYolo, requestStop: context.stopYolo,
    imageUrl: context.getYoloStreamUrl,
    setTimer: context.setTimeout, clearTimer: context.clearTimeout,
  });
  vm.runInNewContext(moduleSource("yolo.js"), context);
  return {
    ...dom, window, calls, timers, statusResponses, activeState,
    setState: (value) => { current = value; },
    runTimer: () => { const entry = timers.entries().next().value; assert.ok(entry, "Expected a scheduled poll"); timers.delete(entry[0]); entry[1](); },
  };
}

test("YOLO locks start, labels static media, recovers broken MJPEG and removes it on stop", async () => {
  const harness = visionHarness();
  await flush();
  assert.equal(harness.elements["source-select"].value, "demo");
  assert.equal(harness.elements["source-select"].children[1].disabled, true);
  assert.equal(harness.elements["start-btn"].disabled, false);
  harness.elements["start-btn"].dispatch("click");
  harness.elements["start-btn"].dispatch("click");
  await flush();
  assert.equal(harness.calls.starts, 1);
  assert.equal(harness.elements.video.hidden, false, "A first processed frame reveals MJPEG without waiting for the stream to finish");
  assert.equal(harness.elements["source-select"].disabled, true);
  assert.match(harness.elements["source-overlay"].textContent, /非实时/);
  harness.elements.video.dispatch("error");
  assert.equal(harness.elements.video.hidden, true);
  assert.equal(harness.elements.video.src, "");
  assert.match(harness.elements["yolo-msg"].textContent, /连接中断/);
  harness.elements["refresh-btn"].dispatch("click");
  await flush();
  assert.equal(harness.elements.video.hidden, false);
  assert.equal(harness.elements.video.src, "/yolo/stream");
  harness.elements["stop-btn"].dispatch("click");
  await flush();
  assert.equal(harness.calls.stops, 1);
  assert.equal(harness.elements.video.hidden, true);
  assert.equal(harness.elements.video.src, "");
  assert.equal(harness.elements["start-btn"].disabled, false);
});

test("YOLO stops old poll scheduling during pagehide and resumes one poll/stream on bfcache return", async () => {
  const harness = visionHarness();
  await flush();
  harness.setState(harness.activeState());
  assert.equal(harness.timers.size, 1);
  const pending = deferred();
  harness.statusResponses.push(pending.promise);
  harness.runTimer();
  await flush();
  harness.document.hidden = true;
  harness.window.dispatch("pagehide");
  assert.equal(harness.elements.video.src, "");
  pending.resolve(harness.activeState());
  await flush();
  assert.equal(harness.elements.video.src, "", "A late status response must not reopen the stream after pagehide");
  assert.equal(harness.timers.size, 0, "An old asynchronous poll must not schedule a new timer after leaving");
  harness.document.hidden = false;
  harness.window.dispatch("pageshow", { persisted: true });
  await flush();
  assert.equal(harness.timers.size, 1, "Restoring from bfcache restarts a single poll chain");
  assert.equal(harness.elements.video.hidden, false);
  assert.equal(harness.elements.video.src, "/yolo/stream");
  harness.window.dispatch("pagehide");
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.elements.video.src, "");
  harness.window.dispatch("pageshow", { persisted: false });
  await flush();
  assert.equal(harness.timers.size, 0, "A normal new navigation must not start a second initialization chain");
});

function eventSourceHarness() {
  const instances = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; instances.push(this); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    send(status) { this.listeners.get("status")?.({ data: JSON.stringify(status) }); }
    malformed(data) { this.listeners.get("status")?.({ data }); }
    fail() { this.onerror?.(); }
    close() { this.closed = true; }
  }
  return { EventSourceImpl: FakeEventSource, instances };
}

test("YOLO subscribes to SSE, formats server elapsed time and closes/resumes one subscription per visible page", async () => {
  const events = eventSourceHarness();
  const harness = visionHarness(events);
  await flush();
  assert.equal(events.instances.length, 1);
  assert.equal(events.instances[0].url, "/yolo/events");
  assert.equal(harness.calls.status, 0, "EventSource primary mode has no HTTP status polling");
  assert.equal(harness.timers.size, 0);
  const first = events.instances[0];
  first.send({ running: false, state: "stopped", elapsed_seconds: null });
  assert.equal(harness.elements["start-btn"].disabled, false);
  first.send({ ...harness.activeState(), started_at: "2000-01-01T00:00:00Z", elapsed_seconds: 125 });
  assert.equal(harness.elements.elapsed.textContent, "2:05", "The browser formats backend duration instead of recalculating it from its clock");
  assert.equal(harness.elements.video.src, "/yolo/stream");
  harness.document.hidden = true;
  harness.document.dispatch("visibilitychange");
  assert.equal(first.closed, true);
  assert.equal(harness.elements.video.src, "");
  first.send({ ...harness.activeState(), frame_count: 999 });
  assert.equal(harness.elements["frame-count"].textContent, "1", "Late events from a closed subscription cannot update the page");
  harness.document.hidden = false;
  harness.document.dispatch("visibilitychange");
  assert.equal(events.instances.length, 2);
  events.instances[1].send({ ...harness.activeState(), elapsed_seconds: 126 });
  assert.equal(harness.elements.elapsed.textContent, "2:06");
  harness.window.dispatch("pagehide");
  assert.equal(events.instances[1].closed, true);
  harness.window.dispatch("pageshow", { persisted: true });
  assert.equal(events.instances.length, 3);
  events.instances[2].fail();
  events.instances[2].fail();
  assert.equal(events.instances[2].closed, true);
  assert.equal(harness.timers.size, 1, "Duplicate errors schedule only one reconnect");
  assert.equal(harness.elements["detection-status"].textContent, "服务未连接");
  harness.runTimer();
  assert.equal(events.instances.length, 4);
  events.instances[3].send({ running: false, state: "stopped", elapsed_seconds: null });
  assert.equal(harness.elements["detection-status"].textContent, "已停止");
  assert.equal(harness.calls.status, 0);
  harness.window.dispatch("pagehide");
  assert.equal(events.instances[3].closed, true);
  assert.equal(harness.timers.size, 0);
});

test("YOLO transport rejects malformed SSE and ignores a late HTTP status after a newer pushed state", async () => {
  const events = eventSourceHarness();
  const states = [];
  const errors = [];
  const timers = new Map();
  let serial = 0;
  let response = deferred();
  const transport = createYoloTransport({
    ...events, onStatus: (value) => states.push(value), onError: (error) => errors.push(error.message),
    readStatus: () => response.promise,
    setTimer: (callback) => { timers.set(++serial, callback); return serial; },
    clearTimer: (id) => timers.delete(id),
  });
  transport.start();
  transport.start();
  assert.equal(events.instances.length, 1);
  const refreshing = transport.refresh();
  events.instances[0].send({ running: true, state: "running", frame_count: 8 });
  response.resolve({ running: false, state: "stopped" });
  await refreshing;
  assert.equal(states.length, 1);
  assert.equal(states[0].frame_count, 8, "An older HTTP response cannot replace a newer pushed state");
  response = deferred();
  const failing = transport.refresh();
  events.instances[0].send({ running: true, state: "running", frame_count: 9 });
  response.reject(new Error("outdated request failed"));
  await failing;
  assert.equal(errors.length, 0, "An old failed request cannot disconnect a healthy SSE subscription");
  events.instances[0].malformed("{bad json");
  assert.equal(errors.length, 1);
  assert.equal(events.instances[0].closed, true);
  assert.equal(timers.size, 1);
  const retry = timers.values().next().value;
  timers.clear();
  retry();
  assert.equal(events.instances.length, 2);
  events.instances[1].send({ running: false, state: "stopped" });
  assert.equal(states.at(-1).state, "stopped");
  events.instances[1].malformed(JSON.stringify({ state: "running" }));
  assert.match(errors.at(-1), /无效/);
  transport.close();
  assert.equal(timers.size, 0);
  const before = states.length;
  events.instances[1].send({ running: true, state: "running" });
  assert.equal(states.length, before);
});

test("YOLO fallback recovers from HTTP errors and does not reuse a pre-command status request", async () => {
  const states = [];
  const errors = [];
  const timers = new Map();
  let serial = 0;
  let reads = 0;
  let request = deferred();
  const transport = createYoloTransport({
    EventSourceImpl: null, onStatus: (value) => states.push(value), onError: (error) => errors.push(error.message),
    readStatus: () => { reads += 1; return request.promise; },
    requestStart: async () => ({ ok: true }),
    setTimer: (callback) => { timers.set(++serial, callback); return serial; },
    clearTimer: (id) => timers.delete(id),
  });
  transport.start();
  request.reject(new Error("offline"));
  await flush();
  assert.deepEqual(errors, ["offline"]);
  assert.equal(timers.size, 1);
  const retry = timers.values().next().value;
  timers.clear();
  request = deferred();
  retry();
  await flush();
  const older = request;
  await transport.startDetection("demo");
  request = deferred();
  const confirmation = transport.refresh();
  assert.equal(reads, 3, "Command completion forces a new confirmation instead of reusing a pre-command request");
  request.resolve({ running: true, state: "running", frame_count: 2 });
  await confirmation;
  older.resolve({ running: false, state: "stopped" });
  await flush();
  assert.equal(states.length, 1);
  assert.equal(states[0].state, "running");
  assert.equal(timers.size, 1);
  transport.close();
  assert.equal(timers.size, 0);
});
