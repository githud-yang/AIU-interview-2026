/** Graph behavior tests with an isolated DOM; no network, models or camera. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createResearchWorkflow } from "../src/web/static/research-workflow.js";

class Element {
  constructor(tag, owner) {
    Object.assign(this, { tag, owner, children: [], parentElement: null, dataset: {}, style: {}, attributes: {}, listeners: new Map(), textContent: "", scrollLeft: 0, scrollTop: 0, clientWidth: 600, clientHeight: 350, captured: new Set() });
  }
  addEventListener(type, callback) { const callbacks = this.listeners.get(type) || new Set(); callbacks.add(callback); this.listeners.set(type, callbacks); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type, values = {}) {
    const event = { target: this, button: 0, pointerType: "mouse", pointerId: 1, clientX: 120, clientY: 80, deltaY: 0, prevented: false, preventDefault() { this.prevented = true; }, ...values };
    for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
    return event;
  }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  focus() { this.owner.activeElement = this; }
  contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  closest(selector) {
    let current = this;
    while (current) {
      if (selector === "button[data-stage-id]" ? current.tag === "button" && current.dataset.stageId : ["button", "a", "input", "select", "textarea"].includes(current.tag)) return current;
      current = current.parentElement;
    }
    return null;
  }
  getBoundingClientRect() { return { left: 20, top: 30 }; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  set innerHTML(_) { throw new Error("HTML injection is forbidden"); }
}
const ids = ["workflow-viewport", "workflow-world", "workflow-edges", "stage-list", "workflow-zoom-in", "workflow-zoom-out", "workflow-zoom-reset", "workflow-fit", "workflow-zoom-label", "workflow-focus-current", "workflow-announcement", "workflow-inspector", "node-title", "node-status", "node-summary", "node-inputs", "node-outputs", "node-artifacts", "node-empty"];
const stages = [
  ["literature", "文献发现"], ["reading", "全文获取与阅读"], ["ideation", "选题与反证"], ["protocol", "实验设计"],
  ["data", "数据准备"], ["baseline", "基线复现"], ["method", "方法实现"], ["experiments", "候选实验"],
  ["validation", "复验与消融"], ["manuscript", "分析与论文"], ["review", "核查与修改"], ["submission", "投稿材料"],
].map(([id, label]) => ({ id, label, status: "pending" }));
function harness() {
  const document = { activeElement: null };
  const elements = Object.fromEntries(ids.map((id) => [id, new Element(id === "stage-list" ? "ol" : "div", document)]));
  document.getElementById = (id) => elements[id] || null;
  document.createElement = (tag) => new Element(tag, document);
  document.createElementNS = (_, tag) => new Element(tag, document);
  const window = new Element("window", document);
  window.location = { href: "http://127.0.0.1:8000/research?presentation=1" };
  elements["workflow-world"].append(elements["workflow-edges"], elements["stage-list"]);
  elements["workflow-viewport"].append(elements["workflow-world"]);
  const selections = [];
  const graph = createResearchWorkflow({ document, window, onSelect: (stage) => selections.push(stage.id) });
  const buttons = () => elements["stage-list"].children.map((row) => row.children[0]).filter(Boolean);
  const button = (id) => buttons().find((item) => item.dataset.stageId === id);
  return { document, window, elements, graph, selections, buttons, button };
}
function run(overrides = {}) { return { id: "run-1", domain: "yolo_tradeoff", stage: "baseline", status: "running", goal: "比较检测精度与延迟", outputs: {}, artifacts: [], ...overrides }; }
function text(node) { return [node.textContent, ...node.children.map(text)].join(" "); }
function select(h, id) { h.elements["stage-list"].dispatch("click", { target: h.button(id) }); }
function all(node, tag) { return [...(node.tag === tag ? [node] : []), ...node.children.flatMap((child) => all(child, tag))]; }

test("preview is a keyboard-accessible graph and does not report stages as executed", () => {
  const h = harness();
  h.graph.update({ stages: stages.map((stage) => ({ ...stage, status: "completed" })) });
  assert.equal(h.buttons().length, 12);
  assert.ok(h.elements["stage-list"].children.every((row) => row.dataset.status === "pending"));
  assert.equal(h.elements["workflow-edges"].children.length, 12); // Defs plus 11 real workflow connections.
  assert.equal(h.elements["workflow-zoom-label"].textContent, "100%");
  assert.equal(h.button("literature").attributes["aria-pressed"], "true");
  assert.match(text(h.elements["node-outputs"]), /运行前预览/);
  assert.deepEqual(h.selections, []);
  const event = h.elements["stage-list"].dispatch("keydown", { target: h.button("literature"), key: "ArrowRight" });
  assert.equal(event.prevented, true);
  assert.equal(h.document.activeElement, h.button("reading"));
  assert.equal(h.elements["node-title"].textContent, "全文获取与阅读");
  assert.deepEqual(h.selections, ["reading"]);
});

test("live snapshots keep selected nodes, keyboard focus and viewport; a different run selects its own current stage", () => {
  const h = harness();
  h.graph.update({ stages, run: run() });
  assert.equal(h.button("baseline").attributes["aria-pressed"], "true");
  select(h, "ideation");
  const kept = h.button("ideation");
  kept.focus();
  h.elements["workflow-viewport"].scrollLeft = 120;
  h.elements["workflow-viewport"].scrollTop = 180;
  const changed = stages.map((stage) => ({ ...stage, status: stage.id === "ideation" ? "failed" : stage.status, summary: stage.id === "ideation" ? "等待真实证据" : "" }));
  h.graph.update({ stages: changed, run: run({ stage: "experiments" }), events: [{ stage: "ideation", message: "当前选题缺少比较材料" }] });
  assert.equal(h.button("ideation"), kept);
  assert.equal(h.document.activeElement, kept);
  assert.equal(h.elements["node-status"].textContent, "执行失败");
  assert.match(text(h.elements["node-outputs"]), /当前选题缺少比较材料/);
  assert.equal(h.elements["workflow-viewport"].scrollLeft, 120);
  assert.equal(h.elements["workflow-viewport"].scrollTop, 180);
  assert.deepEqual(h.selections, ["ideation"]);
  h.graph.update({ stages, run: run({ id: "run-2", stage: "review" }) });
  assert.equal(h.button("review").attributes["aria-pressed"], "true");
  assert.equal(h.elements["node-title"].textContent, "核查与修改");
  assert.deepEqual(h.selections, ["ideation"]);
});

test("malformed snapshots and empty stages clear stale details without fabricating output", () => {
  const h = harness();
  h.graph.update({ stages, run: run({ outputs: { baseline: { summary: "旧结果" } } }) });
  assert.match(text(h.elements["node-outputs"]), /旧结果/);
  h.graph.update(null);
  assert.equal(h.elements["node-empty"].hidden, false);
  assert.equal(text(h.elements["node-outputs"]).trim(), "");
  assert.match(text(h.elements["stage-list"]), /暂无阶段记录/);
  h.graph.update({ stages: [null, {}, { id: 1 }, { id: "__proto__", label: "自定义节点", status: "unknown" }, { id: "__proto__" }], run: run() });
  assert.equal(h.buttons().length, 1);
  assert.equal(h.elements["node-title"].textContent, "自定义节点");
  assert.equal(h.elements["node-status"].textContent, "unknown");
  assert.match(text(h.elements["node-outputs"]), /尚无服务端登记输出/);
});

test("inspector uses only matching registered stage artifacts and rejects unsafe download URLs", () => {
  const h = harness();
  const paths = ["good.json", "evil.json", "external.json", "credentials.json", "wrong-prefix.json"];
  const artifacts = paths.map((path, index) => ({ id: `file-${index}`, name: path, path, sha256: "matching", url: ["/api/research/runs/run-1/artifacts/file-0", "javascript:alert(1)", "https://evil.example/api/research/file", "http://user:password@127.0.0.1:8000/api/research/file", "/api/research-evil/file"][index] }));
  artifacts.push({ id: "unrelated", name: "other-stage.csv", path: "other-stage.csv", url: "/api/research/runs/run-1/artifacts/unrelated" });
  artifacts.push({ id: "wrong-run", name: "wrong-run.json", path: "wrong-run.json", url: "/api/research/runs/run-1/artifacts/wrong-run" });
  artifacts.push({ id: "bad-hash", name: "bad-hash.json", path: "bad-hash.json", sha256: "changed", url: "/api/research/runs/run-1/artifacts/bad-hash" });
  const references = [...paths.map((path) => ({ path: `D:/store/runs/run-1/${path}`, sha256: "matching" })), { path: "D:/store/runs/run-2/wrong-run.json" }, { path: "bad-hash.json", sha256: "original" }];
  const cyclic = {}; cyclic.nested = cyclic;
  h.graph.update({ stages, run: run({ stage: "ideation", artifacts, outputs: { ideation: { title: "<script>do not execute</script>", novelty_status: "unverified", artifacts: references, notes: cyclic } } }) });
  const links = all(h.elements["node-artifacts"], "a");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "http://127.0.0.1:8000/api/research/runs/run-1/artifacts/file-0");
  assert.equal(h.elements["node-artifacts"].children.length, 5);
  assert.doesNotMatch(text(h.elements["node-artifacts"]), /other-stage|wrong-run|bad-hash/);
  assert.match(text(h.elements["node-outputs"]), /<script>do not execute<\/script>/);
  assert.match(text(h.elements["node-outputs"]), /unverified/);
  select(h, "baseline");
  assert.equal(all(h.elements["node-artifacts"], "a").length, 0);
});

test("inspector limits long output and artifact lists while retaining server facts", () => {
  const h = harness();
  const artifacts = Array.from({ length: 14 }, (_, index) => ({ id: `a${index}`, name: `${index}.json`, path: `${index}.json`, url: `/api/research/runs/run-1/artifacts/a${index}` }));
  const output = { title: "x".repeat(10000), ...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`field${index}`, index])), artifacts };
  h.graph.update({ stages, run: run({ stage: "review", outputs: { review: output }, artifacts }) });
  assert.equal(all(h.elements["node-artifacts"], "a").length, 8);
  assert.match(text(h.elements["node-artifacts"]), /另有 6 份/);
  assert.equal(h.elements["node-outputs"].children.length, 9);
  assert.ok(text(h.elements["node-outputs"]).length < 1500);
});

test("manuscript prioritizes only registered Chinese reading artifacts and retains its English files", () => {
  const h = harness();
  const english = Array.from({ length: 9 }, (_, index) => ({ id: `en${index}`, name: `report-${index}.pdf`, path: `manuscript/report-${index}.pdf`, kind: "manuscript", sha256: `en-hash-${index}`, url: `/api/research/runs/run-1/artifacts/en${index}` }));
  const chinese = ["png", "md", "pdf", "html"].map((extension) => ({ id: `zh-${extension}`, name: `report_zh.${extension}`, path: `reading_zh/report_zh.${extension}`, kind: `chinese_reading_${extension}`, sha256: `zh-hash-${extension}`, url: `/api/research/runs/run-1/artifacts/zh-${extension}` }));
  const unrelated = { id: "foreign", name: "foreign-chinese.pdf", path: "reading_other/report.pdf", kind: "chinese_reading_pdf", sha256: "foreign-hash", url: "/api/research/runs/run-1/artifacts/foreign" };
  const stale = { id: "stale", name: "stale-reading.pdf", path: "reading_zh/stale.pdf", kind: "chinese_reading_pdf", sha256: "changed", url: "/api/research/runs/run-1/artifacts/stale" };
  const reading = { title: "YOLO 输入分辨率与检测性能研究", artifacts: [
    ...chinese.map((record) => ({ path: `D:/store/runs/run-1/${record.path}`, sha256: record.sha256 })),
    { path: stale.path, sha256: "original" },
  ] };
  const snapshot = run({ stage: "manuscript", artifacts: [...english, unrelated, ...chinese, stale], outputs: {
    manuscript: { title: "English benchmark report", artifacts: english }, chinese_reading: reading,
    review: { artifacts: [{ path: "review.json" }] },
  } });
  h.graph.update({ stages, run: snapshot });
  const links = all(h.elements["node-artifacts"], "a");
  assert.deepEqual(links.slice(0, 4).map((link) => link.textContent), ["report_zh.html", "report_zh.pdf", "report_zh.md", "report_zh.png"]);
  assert.equal(links[4].textContent, "report-0.pdf");
  assert.equal(links.length, 8);
  assert.match(text(h.elements["node-artifacts"]), /另有 5 份/);
  assert.match(text(h.elements["node-outputs"]), /中文阅读稿.*YOLO 输入分辨率与检测性能研究/);
  assert.doesNotMatch(text(h.elements["node-artifacts"]), /foreign-chinese|stale-reading/);
  select(h, "review");
  assert.equal(all(h.elements["node-artifacts"], "a").length, 0);
  assert.doesNotMatch(text(h.elements["node-outputs"]), /中文阅读稿/);
});

test("zoom is bounded, ordinary scrolling stays native, and blank-canvas dragging never captures node clicks", () => {
  const h = harness();
  h.graph.update({ stages, run: run() });
  const viewport = h.elements["workflow-viewport"];
  const wheel = viewport.dispatch("wheel", { deltaY: 90, ctrlKey: false });
  assert.equal(wheel.prevented, false);
  assert.equal(h.elements["workflow-zoom-label"].textContent, "100%");
  const ctrlWheel = viewport.dispatch("wheel", { deltaY: -400, ctrlKey: true });
  assert.equal(ctrlWheel.prevented, true);
  assert.equal(h.elements["workflow-zoom-label"].textContent, "160%");
  for (let index = 0; index < 30; index += 1) h.elements["workflow-zoom-out"].dispatch("click");
  assert.equal(h.elements["workflow-zoom-label"].textContent, "30%");
  assert.equal(h.elements["workflow-zoom-out"].disabled, true);
  h.graph.reset();
  assert.equal(h.elements["workflow-zoom-label"].textContent, "100%");
  const click = viewport.dispatch("pointerdown", { target: h.button("baseline") });
  assert.equal(click.prevented, false);
  assert.equal(viewport.captured.size, 0);
  viewport.dispatch("pointerdown", { target: h.elements["workflow-world"] });
  assert.equal(viewport.captured.size, 1);
  viewport.dispatch("pointermove", { clientX: -5000, clientY: -5000 });
  assert.equal(viewport.scrollLeft, 1252 - 600);
  assert.equal(viewport.scrollTop, 724 - 350);
  viewport.dispatch("pointerup");
  assert.equal(viewport.captured.size, 0);
  assert.equal(viewport.dataset.dragging, "false");
  h.graph.fit();
  assert.equal(h.elements["workflow-zoom-label"].textContent, "44%");
  assert.equal(viewport.scrollLeft, 0);
  assert.equal(viewport.scrollTop, 0);
});

test("destroy removes handlers, releases dragging, and prevents stale snapshot rendering", () => {
  const h = harness();
  h.graph.update({ stages, run: run() });
  const viewport = h.elements["workflow-viewport"];
  viewport.dispatch("pointerdown", { target: h.elements["workflow-world"] });
  const title = h.elements["node-title"].textContent;
  h.graph.destroy();
  h.graph.destroy();
  assert.equal(viewport.captured.size, 0);
  assert.ok(ids.every((id) => [...h.elements[id].listeners.values()].every((listeners) => listeners.size === 0)));
  assert.ok([...h.window.listeners.values()].every((listeners) => listeners.size === 0));
  h.graph.update({ stages, run: run({ id: "run-2", stage: "submission" }) });
  select(h, "review");
  h.elements["workflow-focus-current"].dispatch("click");
  assert.equal(h.elements["node-title"].textContent, title);
  assert.deepEqual(h.selections, []);
});
