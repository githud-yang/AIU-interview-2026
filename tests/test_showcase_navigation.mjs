/** Navigation regressions with a continuous mounted document and browser-style scrolling. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { initializeShowcaseNavigation } from "../src/web/static/showcase-navigation.js";

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, fn, options) {
    const entries = this.listeners.get(name) || [];
    entries.push({ fn, once: options?.once });
    this.listeners.set(name, entries);
  }
  removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter((entry) => entry.fn !== fn)); }
  dispatch(name) {
    for (const entry of [...(this.listeners.get(name) || [])]) {
      if (entry.once) this.removeEventListener(name, entry.fn);
      entry.fn();
    }
  }
}
function navigationHarness({ hash = "", scrollY = 0, readyState = "loading" } = {}) {
  const win = new Events();
  const doc = { readyState, documentElement: { scrollHeight: 9000 } };
  const positions = { agent: 0, yolo: 1000, yinghuo: 2000, mowozhixi: 3500, campus: 4500, engineering: 8800 };
  const scrolls = [];
  const sections = Object.entries(positions).map(([id, top]) => ({
    id,
    contains: () => false,
    getBoundingClientRect: () => ({ top: top - win.scrollY }),
    scrollIntoView: (options) => {
      scrolls.push({ id, options });
      win.scrollY = Math.max(0, Math.min(8200, top - 210));
      win.dispatch("scroll");
    },
  }));
  const links = sections.map(({ id }) => ({
    hash: `#${id}`, attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    removeAttribute(name) { delete this.attrs[name]; },
  }));
  const frames = new Map();
  let frameId = 0;
  Object.assign(win, {
    location: { hash }, scrollY, innerHeight: 800,
    getComputedStyle: (element) => element === doc.documentElement ? { scrollPaddingTop: "108px" } : { scrollMarginTop: "102px" },
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  Object.assign(doc, {
    querySelectorAll: (selector) => selector === ".project-section" ? sections : links,
    querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 96 }) }),
    getElementById: (id) => sections.find((section) => section.id === id) || null,
  });
  const widget = initializeShowcaseNavigation({ document: doc, window: win });
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); };
  const current = () => links.find((link) => link.attrs["aria-current"] === "location")?.hash;
  return { win, doc, sections, scrolls, widget, flush, current };
}

test("a long previous section leaving cannot overwrite the project at the reading position", () => {
  const h = navigationHarness({ scrollY: 3290 });
  h.flush();
  assert.equal(h.current(), "#mowozhixi");
  h.win.dispatch("scroll");
  h.flush();
  assert.equal(h.current(), "#mowozhixi");
  h.win.scrollY = 4290;
  h.win.dispatch("scroll");
  h.flush();
  assert.equal(h.current(), "#campus");
  assert.equal(h.scrolls.length, 0, "Reading-position updates only mark the navigation");
});

test("hash changes mark the destination and native scrolling preserves every mounted section", () => {
  const h = navigationHarness();
  const mounted = [...h.sections];
  h.win.scrollY = 3290;
  h.win.location.hash = "#mowozhixi";
  h.win.dispatch("hashchange");
  assert.equal(h.current(), "#mowozhixi");
  h.flush();
  assert.equal(h.current(), "#mowozhixi");
  assert.deepEqual(h.sections, mounted);
  assert.equal(h.scrolls.length, 0, "Same-document navigation needs no scripted scrolling");
});

test("a misplaced first deep link is aligned once after load, never on later scrolling or resize", () => {
  const h = navigationHarness({ hash: "#mowozhixi" });
  h.flush();
  assert.equal(h.scrolls.length, 0, "Initialization waits for the initial document layout");
  h.win.dispatch("load");
  h.flush();
  assert.deepEqual(h.scrolls, [{ id: "mowozhixi", options: { behavior: "auto", block: "start" } }]);
  assert.equal(h.current(), "#mowozhixi");
  h.win.scrollY = 500;
  h.win.dispatch("scroll");
  h.win.dispatch("resize");
  h.win.dispatch("load");
  h.flush();
  assert.equal(h.scrolls.length, 1);
  assert.equal(h.current(), "#agent");
});

test("native positioning and a bottom-clamped final section need no corrective scroll", () => {
  for (const [hash, scrollY] of [["#mowozhixi", 3290], ["#engineering", 8200]]) {
    const h = navigationHarness({ hash, scrollY, readyState: "complete" });
    h.flush();
    assert.equal(h.scrolls.length, 0);
    assert.equal(h.current(), hash);
  }
});

test("user interaction or another hash cancels a late initial correction", () => {
  for (const action of ["wheel", "touchstart", "pointerdown", "keydown", "hashchange"]) {
    const h = navigationHarness({ hash: "#mowozhixi" });
    if (action === "hashchange") h.win.location.hash = "#campus";
    h.win.dispatch(action);
    h.win.dispatch("load");
    h.flush();
    assert.equal(h.scrolls.length, 0, action);
  }
});

test("plain, missing and malformed fragments never move the page; destroy removes listeners", () => {
  for (const hash of ["", "#absent", "#%invalid"]) {
    const h = navigationHarness({ hash });
    h.win.dispatch("load");
    h.flush();
    assert.equal(h.scrolls.length, 0);
    h.widget.destroy();
    h.win.scrollY = 4290;
    h.win.dispatch("scroll");
    h.flush();
    assert.equal(h.current(), "#agent");
  }
});
