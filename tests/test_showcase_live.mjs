/** Offline stage interaction contracts; no browser, model, camera or real fetch is used. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { initializeShowcaseChat } from "../src/web/static/showcase-chat.js";
import { initializeShowcaseYolo, observeYoloSection } from "../src/web/static/showcase-yolo.js";
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
function visionHarness({ initial, demoAvailable = true, cameraAvailable = true, visible = false, controlIds = {} } = {}) {
  const dom = makeDOM(visionIds.map((id) => controlIds[id] || id));
  // Tests address logical controls while the DOM can use independent page IDs.
  for (const id of visionIds) if (controlIds[id]) dom.elements[id] = dom.elements[controlIds[id]];
  const streams = [];
  const calls = { starts: [], stops: 0, stopStamps: [], urls: 0, status: 0, sources: 0 };
  let state = initial || { running: false, state: "stopped", source: null, frame_count: 0, fps: 0 };
  let startReply = null;
  let stopReply = null;
  let sourceFailure = false;
  let changeVisibility;
  const snapshots = [];
  class Events {
    constructor(path) { this.path = path; this.handlers = {}; this.closed = false; streams.push(this); }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    close() { this.closed = true; }
    publish(snapshot) { this.handlers.status({ data: JSON.stringify(snapshot) }); }
  }
  const running = (source = "camera", stamp = "run-1") => ({ running: true, state: "running", source, source_label: source === "demo" ? "动态检测案例" : "本地摄像头", started_at: stamp, frame_count: 1, fps: 2.75 });
  const widget = initializeShowcaseYolo({ document: dom.document, window: dom.window,
    controlIds, onSnapshot: (snapshot) => snapshots.push(snapshot),
    observeSection: (_section, callback) => { changeVisibility = callback; callback(visible); return () => {}; },
    createTransport: (options) => createYoloTransport({
    ...options, EventSourceImpl: Events,
    readSources: async () => {
      calls.sources += 1;
      if (sourceFailure) throw new Error("source list offline");
      return { default: "camera", sources: [{ id: "camera", label: "本地摄像头", available: cameraAvailable, msg: "摄像头不可用" }, { id: "demo", label: "动态检测案例", available: demoAvailable, msg: "案例未安装" }, { id: "video", label: "视频案例", available: true }] };
    },
    readStatus: async () => { calls.status += 1; return state; },
    requestStart: async (source) => {
      calls.starts.push(source);
      const reply = startReply;
      startReply = null;
      const result = reply ? await reply : { ok: true, created: true, ...running(source, `run-${calls.starts.length}`) };
      state = result; return result;
    },
    requestStop: async (stamp) => {
      calls.stops += 1; calls.stopStamps.push(stamp);
      if (stopReply) { const reply = stopReply; stopReply = null; state = await reply; return state; }
      if (stamp && stamp !== state.started_at) return { ok: false, ...state, msg: "运行已变更" };
      state = { ...state, running: false, state: "stopped" }; return { ok: true, ...state };
    },
    imageUrl: () => { calls.urls += 1; return `/mock-stream/${calls.urls}`; },
  }) });
  return { ...dom, calls, streams, snapshots, running, widget, enter: () => changeVisibility(true), leave: () => changeVisibility(false),
    select: (source) => { dom.elements["stage-yolo-source"].value = source; dom.elements["stage-yolo-source"].dispatch("change"); },
    setStartReply: (value) => { startReply = value; }, setStopReply: (value) => { stopReply = value; },
    setSourceFailure: (value) => { sourceFailure = value; }, setState: (value) => { state = value; streams.at(-1).publish(value); } };
}

test("camera starts on entering YOLO, never behind the home page; Stop suppresses repeated observer entries", async () => {
  const h = visionHarness();
  await flush();
  assert.equal(h.elements["stage-yolo-source"].value, "camera");
  assert.equal(h.streams[0].path, "/yolo/events");
  assert.equal(h.calls.starts.length, 0);
  assert.equal(h.calls.urls, 0);
  const pending = deferred();
  h.setStartReply(pending.promise);
  h.enter();
  await flush();
  h.elements["stage-yolo-start"].dispatch("click");
  h.enter();
  assert.deepEqual(h.calls.starts, ["camera"]);
  pending.resolve({ ok: true, created: true, ...h.running() });
  await flush();
  assert.equal(h.elements["stage-yolo-image"].hidden, false);
  assert.match(h.elements["stage-yolo-source-label"].textContent, /摄像头/);
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
  assert.deepEqual(h.calls.stopStamps, ["run-1"]);
  assert.equal(h.elements["stage-yolo-image"].src, "");
  h.enter();
  h.setState({ ...h.running(), running: false, state: "stopped" });
  h.elements["stage-yolo-refresh"].dispatch("click");
  await flush();
  assert.deepEqual(h.calls.starts, ["camera"], "Stop is not undone by repeat visibility or refresh");
  h.leave(); await flush(); h.enter(); await flush();
  assert.deepEqual(h.calls.starts, ["camera", "camera"], "A later visit starts a new demonstration");
  h.widget.destroy();
  await flush();
});

test("an external camera remains read-only until View; leaving or hiding never stops it", async () => {
  const current = { running: true, state: "running", source: "camera", source_label: "本地摄像头", started_at: "existing", frame_count: 24, fps: 4 };
  const h = visionHarness({ initial: current, visible: true });
  await flush();
  assert.equal(h.elements["stage-yolo-source"].value, "camera");
  assert.equal(h.calls.starts.length, 0);
  assert.equal(h.calls.urls, 0, "Even an already-running camera is never attached on page load");
  assert.equal(h.elements["stage-yolo-view"].hidden, false);
  h.elements["stage-yolo-view"].dispatch("click");
  assert.equal(h.calls.urls, 1);
  h.document.hidden = true;
  h.document.dispatch("visibilitychange");
  h.window.dispatch("pagehide");
  await flush();
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
  await flush();
});

test("unavailable camera shows a recoverable error; selecting a case starts live inference without another click", async () => {
  const h = visionHarness({ cameraAvailable: false, visible: true });
  await flush();
  assert.equal(h.elements["stage-yolo-source"].value, "camera");
  assert.equal(h.calls.starts.length, 0);
  assert.equal(h.elements["stage-yolo-start"].disabled, true);
  assert.match(h.elements["stage-yolo-notice"].textContent, /摄像头不可用/);
  h.select("demo");
  await flush();
  assert.deepEqual(h.calls.starts, ["demo"]);
  assert.equal(h.elements["stage-yolo-image"].hidden, false);
  assert.match(h.elements["stage-yolo-source-label"].textContent, /动态检测案例/);
  h.setSourceFailure(true);
  h.elements["stage-yolo-refresh"].dispatch("click");
  await flush();
  assert.match(h.elements["stage-yolo-notice"].textContent, /source list offline/);
  assert.equal(h.elements["stage-yolo-stop"].disabled, false);
  h.widget.destroy();
  await flush();
});

test("rapid choices serialize Stop and Start, skip obsolete targets, and attach only the final live stream", async () => {
  const h = visionHarness({ visible: true });
  await flush();
  const pending = deferred();
  h.setStopReply(pending.promise);
  h.select("demo");
  await flush();
  assert.equal(h.calls.stops, 1);
  assert.equal(h.elements["stage-yolo-source"].disabled, false);
  h.select("video"); h.select("demo"); h.select("video");
  pending.resolve({ ok: true, ...h.running(), running: false, state: "stopped" });
  await flush();
  assert.deepEqual(h.calls.starts, ["camera", "video"]);
  assert.equal(h.calls.urls, 2);
  assert.equal(h.elements["stage-yolo-source"].value, "video");
  h.widget.destroy(); await flush();
});

test("leaving during Start releases the eventual owned camera before starting the next visit", async () => {
  const h = visionHarness();
  await flush();
  const pending = deferred();
  h.setStartReply(pending.promise);
  h.enter(); await flush(); h.leave();
  pending.resolve({ ok: true, created: true, ...h.running() });
  await flush();
  assert.deepEqual(h.calls.starts, ["camera"]);
  assert.deepEqual(h.calls.stopStamps, ["run-1"]);
  assert.equal(h.calls.urls, 0, "An obsolete Start response must never attach its stream");
  h.enter(); await flush();
  assert.deepEqual(h.calls.starts, ["camera", "camera"]);
  assert.equal(h.calls.urls, 1);
  h.widget.destroy(); await flush();
});

test("changing during Start never displays the obsolete source and immediately moves to the latest choice", async () => {
  const h = visionHarness(); await flush();
  const pending = deferred(); h.setStartReply(pending.promise);
  h.enter(); await flush(); h.select("demo"); h.select("video");
  pending.resolve({ ok: true, created: true, ...h.running() });
  await flush();
  assert.deepEqual(h.calls.starts, ["camera", "video"]);
  assert.deepEqual(h.calls.stopStamps, ["run-1"]);
  assert.equal(h.calls.urls, 1, "Only the final source is attached");
  h.widget.destroy(); await flush();
});

test("Stop during pending Start releases the eventual run and never opens its image", async () => {
  const h = visionHarness(); await flush();
  const pending = deferred(); h.setStartReply(pending.promise);
  h.enter(); await flush(); h.elements["stage-yolo-stop"].dispatch("click");
  pending.resolve({ ok: true, created: true, ...h.running() });
  await flush();
  assert.deepEqual(h.calls.stopStamps, ["run-1"]);
  assert.equal(h.calls.urls, 0);
  h.enter(); await flush();
  assert.deepEqual(h.calls.starts, ["camera"]);
  h.widget.destroy(); await flush();
});

test("an in-flight Start with created:false never owns or releases another client's worker", async () => {
  const h = visionHarness(); await flush();
  const pending = deferred(); h.setStartReply(pending.promise);
  h.enter(); await flush(); h.leave();
  pending.resolve({ ok: true, created: false, ...h.running("camera", "other-page") });
  await flush();
  assert.equal(h.calls.stops, 0);
  assert.equal(h.calls.urls, 0);
  h.widget.destroy(); await flush();
});

test("page hiding releases this page's camera, and showing it resumes a visible demonstration", async () => {
  const h = visionHarness({ visible: true }); await flush();
  h.document.hidden = true; h.document.dispatch("visibilitychange"); await flush();
  assert.deepEqual(h.calls.stopStamps, ["run-1"]);
  assert.equal(h.elements["stage-yolo-image"].src, "");
  assert.equal(h.streams[0].closed, true);
  h.document.hidden = false; h.document.dispatch("visibilitychange"); await flush();
  assert.deepEqual(h.calls.starts, ["camera", "camera"]);
  assert.equal(h.calls.urls, 2);
  h.widget.destroy(); await flush();
});

test("returning while Start is pending keeps one command and restores the visible owned stream", async () => {
  const h = visionHarness(); await flush();
  const pending = deferred(); h.setStartReply(pending.promise);
  h.enter(); await flush(); h.window.dispatch("pagehide");
  h.window.dispatch("pageshow", { persisted: true });
  pending.resolve({ ok: true, created: true, ...h.running() });
  await flush();
  assert.deepEqual(h.calls.starts, ["camera"]);
  assert.equal(h.calls.stops, 0);
  assert.equal(h.calls.urls, 1);
  h.widget.destroy(); await flush();
});

test("a replaced external run fails the conditional Stop and blocks the requested switch", async () => {
  const h = visionHarness({ visible: true }); await flush();
  const pending = deferred(); h.setStopReply(pending.promise);
  h.select("demo"); await flush();
  pending.resolve({ ok: false, ...h.running("video", "external-replacement"), msg: "运行已变更" });
  await flush();
  assert.deepEqual(h.calls.starts, ["camera"]);
  assert.match(h.elements["stage-yolo-notice"].textContent, /运行已变更/);
  h.leave(); await flush();
  assert.equal(h.calls.stops, 1, "Leaving never stops the replacement run");
  h.widget.destroy(); await flush();
});

test("the standalone page can reuse the controller with its own DOM IDs and extra snapshot fields", async () => {
  const controlIds = Object.fromEntries(visionIds.map((id, index) => [id, `standalone-${index}`]));
  const h = visionHarness({ visible: true, controlIds }); await flush();
  assert.deepEqual(h.calls.starts, ["camera"]);
  assert.equal(h.document.getElementById(controlIds["stage-yolo-image"]).hidden, false);
  assert.equal(h.snapshots.at(-1).source, "camera");
  h.select("demo"); await flush();
  assert.deepEqual(h.calls.starts, ["camera", "demo"]);
  h.widget.destroy(); await flush();
});

test("viewport entry works for a long section, waits outside YOLO, and removes observers on teardown", () => {
  const { document, window } = makeDOM([]);
  window.innerHeight = 900;
  let box = { top: 1000, bottom: 3000 };
  const section = { getBoundingClientRect: () => box };
  const header = { getBoundingClientRect: () => ({ bottom: 80 }) };
  document.querySelector = () => header;
  let callback;
  let disconnected = false;
  window.IntersectionObserver = class {
    constructor(fn) { callback = fn; }
    observe(element) { assert.equal(element, section); }
    disconnect() { disconnected = true; }
  };
  const observations = [];
  const stop = observeYoloSection(section, (visible) => observations.push(visible), { window, document });
  assert.deepEqual(observations, [false]);
  box = { top: 200, bottom: 2200 }; callback();
  box = { top: -500, bottom: 1800 }; window.dispatch("scroll");
  box = { top: -2000, bottom: 100 }; window.dispatch("hashchange");
  assert.deepEqual(observations, [false, true, true, false]);
  stop(); assert.equal(disconnected, true);
  box = { top: 200, bottom: 2200 }; window.dispatch("scroll");
  assert.equal(observations.length, 4);
});
