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

test("standalone detector assembles the shared automatic controller and formats server metadata", () => {
  const dom = makeDOM(["main", "detection-model", "elapsed"]);
  let assembled;
  vm.runInNewContext(moduleSource("yolo.js"), { document: dom.document,
    initializeShowcaseYolo: (options) => { assembled = options; } });
  assert.equal(assembled.section, dom.elements.main);
  assert.equal(assembled.controlIds["stage-yolo-source"], "source-select");
  assert.equal(assembled.controlIds["stage-yolo-view"], "view-btn");
  let visible = false;
  const dispose = assembled.observeSection(dom.elements.main, value => { visible = value; });
  assert.equal(visible, true);
  assert.equal(typeof dispose, "function");
  assembled.onSnapshot({ model: "best.pt", elapsed_seconds: 125 });
  assert.equal(dom.elements["detection-model"].textContent, "best.pt");
  assert.equal(dom.elements.elapsed.textContent, "2:05");
  assembled.onSnapshot({ elapsed_seconds: null });
  assert.equal(dom.elements.elapsed.textContent, "—");
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
