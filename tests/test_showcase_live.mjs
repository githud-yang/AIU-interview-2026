/** Offline stage interaction contracts; no browser, model, camera or real fetch is used. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { initializeShowcaseChat } from "../src/web/static/showcase-chat.js";
import { initializeShowcaseYolo } from "../src/web/static/showcase-yolo.js";
import { createYoloTransport } from "../src/web/static/yolo-transport.js";

const flush = async () => { for (let i = 0; i < 25; i += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

class Element {
  constructor(id = "") {
    Object.assign(this, { id, value: "", textContent: "", hidden: false, disabled: false, dataset: {}, children: [], listeners: new Map(), attrs: {} });
    const classes = new Set();
    this.classList = { add: (name) => classes.add(name), remove: (name) => classes.delete(name), toggle: (name, present) => present ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) };
  }
  addEventListener(name, fn) { const handlers = this.listeners.get(name) || []; handlers.push(fn); this.listeners.set(name, handlers); }
  removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter((handler) => handler !== fn)); }
  dispatch(name, event = {}) { (this.listeners.get(name) || []).forEach((handler) => handler(event)); }
  append(...children) { children.forEach((child) => { child.parent = this; this.children.push(child); }); }
  appendChild(child) { this.append(child); }
  replaceChildren(...children) { this.children.forEach((child) => { child.parent = null; }); this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; if (key === "src") this.src = ""; }
  requestSubmit() { this.dispatch("submit", { preventDefault() {} }); }
  focus() {}
  set innerHTML(_value) { throw new Error("Unsafe HTML rendering"); }
}
function makeDOM(ids) {
  const elements = Object.fromEntries(ids.map((id) => [id, new Element(id)]));
  const document = new Element("document");
  const window = new Element("window");
  const quick = [new Element(), new Element()];
  quick[0].dataset.stageAction = "看看终端屏幕";
  quick[1].dataset.stageAction = "检查实验室的门";
  Object.assign(document, { hidden: false, getElementById: (id) => elements[id] || null, querySelectorAll: () => quick, createElement: () => new Element() });
  return { elements, document, window, quick };
}
const chatIds = ["stage-chat-log", "stage-chat-form", "stage-chat-input", "stage-chat-send", "stage-chat-reset", "stage-chat-retry", "stage-chat-notice"];
const userBubbles = (log) => log.children.filter((node) => node.className === "chat-message chat-message-user");

test("stage conversation starts fresh, locks duplicates and retries one failed player bubble", async () => {
  const dom = makeDOM(chatIds);
  const { elements: el } = dom;
  const calls = [];
  let pending;
  const widget = initializeShowcaseChat({ document: dom.document, sendMessage: (message, history) => {
    calls.push({ message, history }); pending = deferred(); return pending.promise;
  } });
  assert.equal(calls.length, 0, "Opening the showcase never generates a model turn");
  assert.equal(el["stage-chat-log"].children.length, 1);
  assert.match(el["stage-chat-log"].children[0].children[1].textContent, /虚构演示开场/);
  dom.quick[0].dispatch("click");
  dom.quick[1].dispatch("click");
  el["stage-chat-reset"].dispatch("click");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { message: "看看终端屏幕", history: [] });
  assert.equal(el["stage-chat-reset"].disabled, true);
  pending.reject(new Error("offline <b>details</b>"));
  await flush();
  assert.equal(el["stage-chat-retry"].hidden, false);
  assert.match(el["stage-chat-notice"].textContent, /offline <b>details<\/b>/);
  const originalUser = userBubbles(el["stage-chat-log"])[0];
  el["stage-chat-retry"].dispatch("click");
  el["stage-chat-retry"].dispatch("click");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0], "Failed requests contribute no successful history");
  assert.equal(userBubbles(el["stage-chat-log"]).length, 1);
  assert.equal(userBubbles(el["stage-chat-log"])[0], originalUser);
  pending.resolve("<script>shown as text</script>");
  await flush();
  assert.equal(el["stage-chat-log"].children.at(-1).children[1].textContent, "<script>shown as text</script>");
  assert.equal(el["stage-chat-retry"].hidden, true);
  el["stage-chat-reset"].dispatch("click");
  dom.quick[1].dispatch("click");
  assert.deepEqual(calls[2].history, [], "Reset creates an independent new conversation");
  pending.resolve("new scene");
  await flush();
  widget.destroy();
  dom.quick[0].dispatch("click");
  assert.equal(calls.length, 3);
});

test("only ten successful stage turns enter context, with input limits and IME-safe Enter", async () => {
  const dom = makeDOM(chatIds);
  const calls = [];
  initializeShowcaseChat({ document: dom.document, sendMessage: async (message, history) => {
    calls.push({ message, history }); return `answer ${message}`;
  } });
  const submit = async (value) => { dom.elements["stage-chat-input"].value = value; dom.elements["stage-chat-form"].requestSubmit(); await flush(); };
  for (let index = 0; index < 12; index += 1) await submit(`turn ${index}`);
  assert.equal(calls[11].history.length, 10);
  assert.equal(calls[11].history[0].user, "turn 1");
  await submit("x".repeat(4001));
  assert.equal(calls.length, 12);
  let prevented = false;
  dom.elements["stage-chat-input"].dispatch("keydown", { key: "Enter", isComposing: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
});

const visionIds = ["stage-yolo-source", "stage-yolo-start", "stage-yolo-stop", "stage-yolo-refresh", "stage-yolo-view", "stage-yolo-image", "stage-yolo-placeholder", "stage-yolo-status", "stage-yolo-notice", "stage-yolo-source-label", "stage-yolo-fps", "stage-yolo-frames"];
function visionHarness({ initial, demoAvailable = true } = {}) {
  const dom = makeDOM(visionIds);
  const streams = [];
  const calls = { starts: [], stops: 0, urls: 0, status: 0, sources: 0 };
  let state = initial || { running: false, state: "stopped", source: null, frame_count: 0, fps: 0 };
  let startReply = null;
  let sourceFailure = false;
  class Events {
    constructor(path) { this.path = path; this.handlers = {}; this.closed = false; streams.push(this); }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    close() { this.closed = true; }
    publish(snapshot) { this.handlers.status({ data: JSON.stringify(snapshot) }); }
  }
  const running = (source = "demo", stamp = "run-1") => ({ running: true, state: "running", source, source_label: source === "demo" ? "公开样例" : "本地摄像头", started_at: stamp, frame_count: 1, fps: 2.75 });
  const widget = initializeShowcaseYolo({ document: dom.document, window: dom.window, createTransport: (options) => createYoloTransport({
    ...options, EventSourceImpl: Events,
    readSources: async () => {
      calls.sources += 1;
      if (sourceFailure) throw new Error("source list offline");
      return { default: "camera", sources: [{ id: "camera", label: "本地摄像头", available: true }, { id: "demo", label: "公开样例", available: demoAvailable, msg: "样例未安装" }] };
    },
    readStatus: async () => { calls.status += 1; return state; },
    requestStart: async (source) => {
      calls.starts.push(source);
      const result = startReply ? await startReply : { ok: true, ...running(source) };
      state = result; return result;
    },
    requestStop: async () => { calls.stops += 1; state = { ...state, running: false, state: "stopped" }; return { ok: true, ...state }; },
    imageUrl: () => { calls.urls += 1; return `/mock-stream/${calls.urls}`; },
  }) });
  return { ...dom, calls, streams, running, widget, setStartReply: (value) => { startReply = value; }, setSourceFailure: (value) => { sourceFailure = value; }, setState: (value) => { state = value; streams.at(-1).publish(value); } };
}

test("stage detection prefers demo, starts once explicitly and reconnects MJPEG only on a manual retry", async () => {
  const h = visionHarness();
  await flush();
  assert.equal(h.elements["stage-yolo-source"].value, "demo");
  assert.equal(h.streams[0].path, "/yolo/events");
  assert.equal(h.calls.starts.length, 0);
  assert.equal(h.calls.urls, 0);
  const pending = deferred();
  h.setStartReply(pending.promise);
  h.elements["stage-yolo-start"].dispatch("click");
  h.elements["stage-yolo-start"].dispatch("click");
  assert.deepEqual(h.calls.starts, ["demo"]);
  pending.resolve({ ok: true, ...h.running() });
  await flush();
  assert.equal(h.elements["stage-yolo-image"].hidden, false);
  assert.match(h.elements["stage-yolo-source-label"].textContent, /非实时/);
  h.elements["stage-yolo-image"].dispatch("error");
  h.setState(h.running());
  assert.equal(h.calls.urls, 1, "Automatic status updates cannot retry a broken image stream");
  assert.equal(h.elements["stage-yolo-image"].src, "");
  h.elements["stage-yolo-refresh"].dispatch("click");
  await flush();
  assert.equal(h.calls.urls, 2);
  h.elements["stage-yolo-stop"].dispatch("click");
  await flush();
  assert.equal(h.calls.stops, 1);
  assert.equal(h.elements["stage-yolo-image"].src, "");
  h.widget.destroy();
});

test("existing camera is read-only until View; hide closes clients and return needs a fresh View", async () => {
  const current = { running: true, state: "running", source: "camera", source_label: "本地摄像头", started_at: "existing", frame_count: 24, fps: 4 };
  const h = visionHarness({ initial: current });
  await flush();
  assert.equal(h.elements["stage-yolo-source"].value, "demo");
  assert.equal(h.calls.urls, 0, "Even an already-running camera is never attached on page load");
  assert.equal(h.elements["stage-yolo-view"].hidden, false);
  h.elements["stage-yolo-view"].dispatch("click");
  assert.equal(h.calls.urls, 1);
  h.document.hidden = true;
  h.document.dispatch("visibilitychange");
  h.window.dispatch("pagehide");
  assert.equal(h.elements["stage-yolo-image"].src, "");
  assert.equal(h.streams[0].closed, true);
  assert.equal(h.calls.stops, 0, "Navigation must not stop another page's shared worker");
  h.document.hidden = false;
  h.window.dispatch("pageshow", { persisted: true });
  await flush();
  assert.equal(h.streams.length, 2);
  assert.equal(h.calls.urls, 1, "Restoring a page reconnects status reads only");
  h.elements["stage-yolo-view"].dispatch("click");
  assert.equal(h.calls.urls, 2);
  h.setState(h.running("camera", "replacement"));
  assert.equal(h.elements["stage-yolo-image"].src, "", "Viewing permission is bound to one worker run");
  assert.equal(h.calls.urls, 2);
  h.widget.destroy();
});

test("unavailable demo never silently selects camera; failed source refresh leaves Stop usable", async () => {
  const h = visionHarness({ demoAvailable: false });
  await flush();
  assert.equal(h.elements["stage-yolo-source"].value, "demo");
  assert.equal(h.elements["stage-yolo-start"].disabled, true);
  h.elements["stage-yolo-source"].value = "camera";
  h.elements["stage-yolo-source"].dispatch("change");
  h.elements["stage-yolo-start"].dispatch("click");
  await flush();
  assert.deepEqual(h.calls.starts, ["camera"], "Camera can be started by an explicit source choice and click");
  h.setSourceFailure(true);
  h.elements["stage-yolo-refresh"].dispatch("click");
  await flush();
  assert.match(h.elements["stage-yolo-notice"].textContent, /source list offline/);
  assert.equal(h.elements["stage-yolo-stop"].disabled, false);
  h.widget.destroy();
});

test("returning while Start is pending resumes reads and observes its completion without reopening video", async () => {
  const h = visionHarness();
  await flush();
  const pending = deferred();
  h.setStartReply(pending.promise);
  h.elements["stage-yolo-start"].dispatch("click");
  h.window.dispatch("pagehide");
  h.window.dispatch("pageshow", { persisted: true });
  assert.equal(h.streams.length, 2, "A pending command does not block the read subscription on return");
  pending.resolve({ ok: true, ...h.running() });
  await flush();
  assert.deepEqual(h.calls.starts, ["demo"]);
  assert.equal(h.calls.urls, 0, "Leaving the page revokes its original viewing permission");
  assert.equal(h.elements["stage-yolo-status"].textContent, "检测中");
  assert.equal(h.elements["stage-yolo-stop"].disabled, false);
  assert.equal(h.elements["stage-yolo-view"].hidden, false);
  h.widget.destroy();
});
