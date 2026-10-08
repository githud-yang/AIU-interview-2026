/** Run: node --test tests/test_research_frontend.mjs
 * Contract/state tests use a small DOM and mocked HTTP responses. They do not
 * claim browser rendering, real model execution or real research quality.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createResearchApp, safeURL } from "../src/web/static/research.js";

const html = readFileSync(new URL("../src/web/static/research.html", import.meta.url), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
class Element {
  constructor(tag = "div") {
    Object.assign(this, { tag, value: "", textContent: "", children: [], dataset: {}, style: {}, hidden: false, disabled: false, className: "", attributes: {}, listeners: new Map(), classes: new Set(), focused: false });
    this.classList = { toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name) };
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.focused = true; }
  set innerHTML(_value) { throw new Error("Unsafe innerHTML write"); }
}
const capabilities = {
  model: { provider: "ollama", model: "qwen2.5:7b", available: true },
  execution: { mode: "declarative", available: true, detail: "固定领域配方执行；未开放任意生成代码。" },
  domains: [{ id: "digits_robustness", label: "手写数字分类鲁棒性", description: "流程验证，创新尚未证明。" }],
  stages: [{ id: "literature", label: "文献发现" }, { id: "experiment", label: "真实实验" }, { id: "manuscript", label: "稿件" }],
  limitations: ["初始领域为 sklearn digits。"],
};
const defaultWriterSettings = {
  provider: "codex", model: "Codex CLI default", key_configured: false,
  base_url: "https://api.deepseek.com/v1", editable: true, busy: false, configured_provider: "auto",
};
function run(overrides = {}) {
  return {
    id: "run-1", goal: "比较数字分类模型对噪声的稳健性", domain: "digits_robustness", mode: "autonomous",
    status: "running", stage: "experiment", created_at: "2026-10-08T03:00:00Z", updated_at: "2026-10-08T03:02:00Z", progress: 33,
    stages: [{ id: "literature", label: "文献发现", status: "completed", summary: "检索已完成" }, { id: "experiment", label: "真实实验", status: "running", summary: "实验作业执行中" }, { id: "manuscript", label: "稿件", status: "pending" }],
    budget: { max_seconds: null, model_calls: null, max_trials: null, elapsed_seconds: 120, used_model_calls: 2, used_trials: 1 },
    intervention_count: 0, interventions: [], outputs: {}, artifacts: [], summary: "研究正在执行，尚无最终结论。", error: null, quality_status: "unverified",
    ...overrides,
  };
}
function harness({ saved = null, initialRun = null, customFetch = null, caps = capabilities, writerSettings = defaultWriterSettings } = {}) {
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const document = new Element("document");
  Object.assign(document, { hidden: false, getElementById: (id) => { assert.ok(elements[id], `Missing HTML element: ${id}`); return elements[id]; }, createElement: (tag) => new Element(tag) });
  const window = new Element("window");
  window.location = { href: "http://127.0.0.1:8000/research" };
  const storage = { value: saved, getItem() { return this.value; }, setItem(_key, value) { this.value = value; } };
  const timers = new Map();
  let timerID = 0;
  const calls = [];
  const server = { run: initialRun, events: [], last_seq: 0, writerSettings: { ...writerSettings } };
  const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (customFetch) {
      const result = customFetch(url, options, { response, server, calls });
      if (result !== undefined) return result;
    }
    if (url === "/api/research/capabilities") return response(caps);
    if (url === "/api/research/writer-settings" && !options.method) return response(server.writerSettings);
    if (url === "/api/research/writer-settings/test") return response({ ok: true, model: JSON.parse(options.body).model, available_models: ["deepseek-flash", "deepseek-chat"], configured: server.writerSettings.key_configured, message: "连接测试通过。" });
    if (url === "/api/research/writer-settings" && options.method === "PUT") {
      server.writerSettings = { ...server.writerSettings, provider: "deepseek", configured_provider: "deepseek", model: JSON.parse(options.body).model, key_configured: true };
      return response({ ok: true, settings: server.writerSettings, message: "已保存并启用 DeepSeek。" });
    }
    if (url === "/api/research/runs" && !options.method) return response({ runs: server.run ? [server.run] : [] });
    if (url === "/api/research/runs/run-1") return response(server.run || { detail: "Run not found" }, server.run ? 200 : 404);
    if (url.includes("/events?")) return response({ events: server.events, last_seq: server.last_seq });
    if (url === "/api/research/runs" && options.method === "POST") {
      server.run = run();
      return response(server.run, 202);
    }
    if (url.endsWith("/cancel")) { server.run = { ...server.run, status: "cancelling" }; return response(server.run); }
    if (url.endsWith("/resume")) { server.run = { ...server.run, status: "running" }; return response(server.run); }
    throw new Error(`Unmocked request ${url}`);
  };
  const app = createResearchApp({ document, window, storage, fetch, setTimeout: (callback, delay) => { const id = ++timerID; timers.set(id, { callback, delay }); return id; }, clearTimeout: (id) => timers.delete(id), uuid: () => "09998e10-3115-4dc4-b9c7-3f26fcfa650c" });
  return { app, elements, document, window, storage, timers, calls, server, response };
}
const postCalls = (h, suffix = "/api/research/runs") => h.calls.filter((call) => call.options.method === "POST" && call.url === suffix);
function textTree(node) { return [node.textContent, ...node.children.map(textTree)].filter(Boolean).join(" "); }

test("Capabilities preview has no fabricated run, metrics, experiments or finished stages", async () => {
  const h = harness();
  await h.app.ready;
  assert.equal(h.elements["start-btn"].disabled, false);
  assert.equal(h.elements["research-domain"].value, "digits_robustness");
  assert.equal(h.app.state.run, null);
  assert.equal(h.elements["stage-list"].children.length, 3);
  assert.ok(h.elements["stage-list"].children.every((stage) => stage.dataset.status === "pending"));
  assert.equal(h.elements["experiment-list"].children.length, 0);
  assert.match(textTree(h.elements["capability-summary"]), /手写数字分类与抗干扰/);
  assert.doesNotMatch(textTree(h.elements["capability-summary"]), /配方执行|任意生成代码|sklearn/);
  assert.match(h.elements["goal-help"].textContent, /噪声干扰/);
  assert.equal(h.elements["resume-btn"].disabled, true);
  assert.equal(h.timers.size, 0, "An empty workspace does not create needless polling");
});

test("Double submit produces one stable request with no implicit resource limits", async () => {
  const pending = deferred();
  const h = harness({ customFetch: (url, options) => url === "/api/research/runs" && options.method === "POST" ? pending.promise : undefined });
  await h.app.ready;
  h.elements["research-goal"].value = "研究噪声鲁棒性";
  const event = { preventDefault() {} };
  const first = h.app.start(event);
  const second = h.app.start(event);
  assert.equal(postCalls(h).length, 1);
  const sent = JSON.parse(postCalls(h)[0].options.body);
  assert.deepEqual(sent.budget, { max_seconds: null, model_calls: null, max_trials: null });
  assert.equal(sent.domain, "digits_robustness");
  assert.equal(sent.mode, "autonomous");
  assert.equal(h.elements["start-btn"].disabled, true);
  pending.resolve(h.response(run(), 202));
  await Promise.all([first, second]);
  assert.equal(h.app.state.run.id, "run-1");
  assert.equal(h.elements["cancel-btn"].disabled, false);
  assert.equal(h.elements["start-btn"].disabled, true);
  assert.equal(JSON.parse(h.storage.value).pending, null);
  assert.equal(h.timers.size, 1);
});

test("Optional limits stay collapsed and empty until a user chooses them", async () => {
  const details = html.match(/<details[^>]*id="advanced-options"[^>]*>/)?.[0];
  assert.ok(details);
  assert.doesNotMatch(details, /\bopen\b/);
  for (const id of ["budget-minutes", "budget-trials", "budget-model-calls"]) {
    const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(input);
    assert.doesNotMatch(input, /\bvalue=|\brequired\b/);
  }
  assert.doesNotMatch(html, /目标与预算|总时长上限|模型调用上限|时间预算/);
  const h = harness();
  await h.app.ready;
  h.elements["research-goal"].value = "研究噪声鲁棒性";
  h.elements["budget-minutes"].value = "30";
  h.elements["budget-model-calls"].value = "0";
  await h.app.start({ preventDefault() {} });
  assert.deepEqual(JSON.parse(postCalls(h)[0].options.body).budget, { max_seconds: 1800, model_calls: 0, max_trials: null });
});

test("Unlimited runs show actual consumption and no fake exhausted-budget warning", async () => {
  const h = harness({ initialRun: run({ status: "failed" }) });
  await h.app.ready;
  assert.equal(h.elements["elapsed-value"].textContent, "2.0 分钟");
  assert.equal(h.elements["trial-value"].textContent, "1 次");
  assert.equal(h.elements["model-call-value"].textContent, "2 次");
  assert.equal(h.elements["elapsed-track"].hidden, true);
  assert.equal(h.elements["run-blocker"].hidden, true);
  for (const id of ["elapsed-detail", "trial-value", "trial-detail", "model-call-value", "model-call-detail"]) assert.doesNotMatch(h.elements[id].textContent, /null|undefined|\/\s*0|上限|最多/);
  h.server.run = run({ budget: { elapsed_seconds: 5, used_trials: 0, used_model_calls: 0 } });
  await h.app.poll();
  assert.equal(h.elements["model-call-value"].textContent, "0 次");
  assert.equal(h.elements["run-blocker"].hidden, true);
});

test("Explicit limits annotate active runs; finished runs show only actual consumption", async () => {
  const h = harness({ initialRun: run({ budget: { max_seconds: 1200, model_calls: 12, max_trials: 18, elapsed_seconds: 120, used_model_calls: 2, used_trials: 1 } }) });
  await h.app.ready;
  assert.equal(h.elements["trial-value"].textContent, "1 次");
  assert.equal(h.elements["model-call-value"].textContent, "2 次");
  assert.match(h.elements["elapsed-detail"].textContent, /最多 20 分钟/);
  assert.match(h.elements["trial-detail"].textContent, /最多 18 次/);
  assert.match(h.elements["model-call-detail"].textContent, /最多 12 次/);
  assert.equal(h.elements["elapsed-track"].hidden, false);
  assert.equal(h.elements["elapsed-bar"].style.width, "10%");
  for (const status of ["completed", "cancelled", "failed", "interrupted"]) {
    h.server.run = { ...h.server.run, status };
    await h.app.poll();
    assert.equal(h.elements["elapsed-track"].hidden, true);
    assert.equal(h.elements["trial-detail"].textContent, "模型拟合尝试的实际记录");
    for (const id of ["elapsed-detail", "trial-detail", "model-call-detail"]) assert.doesNotMatch(h.elements[id].textContent, /最多|上限|你设置|已设置/);
    assert.equal(h.elements["trial-value"].textContent, "1 次");
    assert.equal(h.elements["model-call-value"].textContent, "2 次");
  }
});

test("Invalid optional resource settings do not create a pending request", async () => {
  const h = harness();
  await h.app.ready;
  h.elements["research-goal"].value = "研究噪声鲁棒性";
  h.elements["budget-trials"].value = "2";
  await h.app.start({ preventDefault() {} });
  assert.equal(postCalls(h).length, 0);
  assert.equal(h.app.state.pending, null);
  assert.match(h.elements["request-error-text"].textContent, /至少 3/);
  h.elements["budget-trials"].value = "3.5";
  await h.app.start({ preventDefault() {} });
  assert.equal(postCalls(h).length, 0);
});

test("Lost start response preserves the same key and payload across refresh/reload", async () => {
  let attempts = 0;
  const h = harness({ customFetch: (url, options) => {
    if (url === "/api/research/runs" && options.method === "POST") {
      attempts += 1;
      if (attempts === 1) throw new TypeError("Network lost after server accepted request");
    }
    return undefined;
  } });
  await h.app.ready;
  h.elements["research-goal"].value = "研究噪声鲁棒性";
  await h.app.start({ preventDefault() {} });
  const firstPayload = postCalls(h)[0].options.body;
  assert.equal(JSON.parse(h.storage.value).pending.request_id, JSON.parse(firstPayload).request_id);
  assert.equal(h.elements["request-error"].hidden, false);
  assert.match(h.elements["notice-text"].textContent, /同一请求编号/);
  const restored = harness({ saved: h.storage.value });
  await restored.app.ready;
  assert.equal(postCalls(restored).length, 1);
  assert.equal(postCalls(restored)[0].options.body, firstPayload);
  assert.equal(restored.app.state.run.id, "run-1");
  assert.equal(JSON.parse(restored.storage.value).pending, null);
});

test("Cancel and resume lock repeated clicks, preserve budget and distinguish terminal cancellation", async () => {
  const pending = deferred();
  const h = harness({ initialRun: run(), customFetch: (url) => url.endsWith("/cancel") ? pending.promise : undefined });
  await h.app.ready;
  const first = h.app.action("cancel");
  const duplicate = h.app.action("cancel");
  assert.equal(postCalls(h, "/api/research/runs/run-1/cancel").length, 1);
  assert.equal(h.elements["cancel-btn"].disabled, true);
  pending.resolve(h.response(run({ status: "cancelling" })));
  await Promise.all([first, duplicate]);
  assert.equal(h.elements["cancel-btn"].disabled, true);
  assert.match(h.elements["notice-text"].textContent, /等待作业实际停止/);
  h.server.run = run({ status: "cancelled" });
  await h.app.poll();
  assert.equal(h.elements["resume-btn"].disabled, true);
  await h.app.action("resume");
  assert.equal(postCalls(h, "/api/research/runs/run-1/resume").length, 0);
  h.server.run = run({ status: "failed", error: "累计时长达到本次运行限制", budget: { max_seconds: 1200, model_calls: 12, max_trials: 12, elapsed_seconds: 1200, used_model_calls: 8, used_trials: 5 } });
  await h.app.poll();
  assert.equal(h.elements["resume-btn"].disabled, false);
  assert.match(h.elements["run-blocker"].textContent, /不会自动扩大/);
  assert.match(h.elements["run-blocker"].textContent, /本次运行的资源限制/);
  assert.match(h.elements["run-blocker"].textContent, /累计时长达到本次运行限制/);
  assert.doesNotMatch(h.elements["run-blocker"].textContent, /你设置/);
  await h.app.action("resume");
  const resume = postCalls(h, "/api/research/runs/run-1/resume")[0];
  assert.equal(resume.options.body, undefined, "Resume does not reset or enlarge budgets");
});

test("Results are server facts rendered as text; unsafe URLs and completed-quality conflation are rejected", async () => {
  const malicious = "<script>alert(1)</script>";
  const h = harness({ initialRun: run({ status: "completed", quality_status: "candidate_only", outputs: { literature: { papers: [{ title: malicious, url: "javascript:alert(1)", summary: "仅取得摘要", access_scope: "abstract" }] }, experiment: { trials: [{ name: malicious, status: "completed", config: { seed: 3 }, metrics: { accuracy: 0.875 } }] } }, artifacts: [{ id: "a", name: malicious, kind: "manuscript", url: "/api/research/runs/run-1/artifacts/a", size_bytes: 1024, sha256: "abcde1234567890" }, { id: "b", name: "unsafe", url: "https://evil.invalid/file" }] }) });
  await h.app.ready;
  assert.equal(h.elements["run-status"].textContent, "流程已完成");
  assert.equal(h.elements["run-quality"].textContent, "候选稿 · 未经外评");
  assert.match(textTree(h.elements["literature-list"]), /<script>alert\(1\)<\/script>/);
  assert.equal(h.elements["literature-list"].children[0].children[1].children[0].children.length, 0, "Unsafe literature URL does not create a link");
  assert.match(textTree(h.elements["experiment-list"]), /0.875/);
  assert.equal(h.elements["artifact-list"].children[0].children[2].href, "http://127.0.0.1:8000/api/research/runs/run-1/artifacts/a");
  assert.equal(h.elements["artifact-list"].children[1].children[2].textContent, "下载地址不可用");
  assert.equal(h.elements["start-btn"].disabled, false);
});

test("Poll merges events by sequence, keeps pending intervention separate from completed intervention count", async () => {
  const h = harness({ initialRun: run({ status: "needs_input", interventions: [{ id: "i", title: "资源未就绪", status: "pending", required_action: "启动模型服务", reason: "连接不可用" }], intervention_count: 0 }) });
  h.server.events = [{ seq: 1, type: "stage_start", message: "开始文献阶段", created_at: "2026-10-08T03:00:00Z" }];
  h.server.last_seq = 1;
  await h.app.ready;
  assert.match(h.elements["run-blocker"].textContent, /启动模型服务/);
  assert.equal(h.elements["intervention-count"].textContent, "0 次已记录");
  h.server.events = [...h.server.events, { seq: 2, type: "fallback", message: "模型失败，已显式降级", created_at: "2026-10-08T03:01:00Z" }];
  h.server.last_seq = 2;
  await h.app.poll();
  await h.app.poll();
  assert.equal(h.app.state.events.length, 2);
  assert.equal(h.elements["event-list"].children.length, 2);
  assert.match(textTree(h.elements["event-list"]), /显式降级/);
  assert.ok(h.calls.some((call) => call.url.endsWith("after_seq=2")));
});

test("Pagehide rejects stale poll writes and bfcache return resumes only one poll chain", async () => {
  const pending = deferred();
  let hold = false;
  const h = harness({ initialRun: run(), customFetch: (url) => hold && url === "/api/research/runs/run-1" ? pending.promise : undefined });
  await h.app.ready;
  hold = true;
  const poll = h.app.poll();
  h.window.dispatch("pagehide");
  assert.equal(h.timers.size, 1, "Only the in-flight request timeout remains after pagehide");
  pending.resolve(h.response(run({ status: "completed" })));
  await poll;
  assert.equal(h.timers.size, 0);
  assert.equal(h.app.state.run.status, "running", "A late response cannot replace hidden-page state");
  hold = false;
  h.window.dispatch("pageshow", { persisted: true });
  await flush();
  assert.equal(h.timers.size, 1);
  h.window.dispatch("pageshow", { persisted: false });
  await flush();
  assert.equal(h.timers.size, 1);
});

test("Busy server selects the actual active run instead of fabricating a start", async () => {
  const h = harness({ customFetch: (url, options, { response, server }) => {
    if (url === "/api/research/runs" && options.method === "POST") {
      server.run = run();
      return response({ detail: "已有运行" }, 409);
    }
    return undefined;
  } });
  await h.app.ready;
  h.elements["research-goal"].value = "研究噪声鲁棒性";
  await h.app.start({ preventDefault() {} });
  assert.equal(h.app.state.run.id, "run-1");
  assert.equal(h.elements["start-btn"].disabled, true);
  assert.equal(h.app.state.pending, null);
  assert.match(h.elements["request-error-text"].textContent, /已有研究/);
});

test("Tabs support keyboard navigation and artifact URL validation rejects executable/off-origin paths", async () => {
  const h = harness();
  await h.app.ready;
  h.elements["tab-experiments"].dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(h.elements["tab-literature"].attributes["aria-selected"], "true");
  assert.equal(h.elements["pane-literature"].hidden, false);
  assert.equal(h.elements["pane-experiments"].hidden, true);
  assert.equal(h.elements["tab-literature"].focused, true);
  assert.equal(safeURL("javascript:alert(1)", "http://localhost/research"), null);
  assert.equal(safeURL("//evil.invalid/api/research/a", "http://localhost/research", { artifact: true }), null);
  assert.equal(safeURL("/static/nope", "http://localhost/research", { artifact: true }), null);
  assert.equal(safeURL("/api/research/a", "http://localhost/research", { artifact: true }), "http://localhost/api/research/a");
});

test("Actual digits module outputs expose real summary metrics, reading scope and manuscript checks", async () => {
  const h = harness({ initialRun: run({ status: "completed", quality_status: "candidate_only", outputs: {
    literature: { status: "completed", records: [{ title: "Real source", reading_scope: "metadata_only", full_text_status: "unavailable", full_text_error: "公开全文未取得" }] },
    experiment: { status: "completed", summary: [{ model: "baseline", condition: "corrupted", accuracy_mean: 0.71, accuracy_sd: 0.02, macro_f1_mean: 0.7, seeds_completed: 3 }], limitations: ["matched control 不代表新增独立方法"], novelty_status: "unproven" },
    manuscript: { title: "真实实验稿件", status: "completed", summary: "有限范围内的结果", pdf: { status: "unavailable", error: "编译器不可用" }, quality: { novelty: "unproven", external_review: "not_reviewed" } },
    review: { checks: [{ name: "numeric_integrity", passed: true }] }, submission: { status: "not_submitted" },
  } }) });
  await h.app.ready;
  assert.match(textTree(h.elements["experiment-list"]), /accuracy_mean[\s\S]*0.71/);
  assert.match(textTree(h.elements["experiment-list"]), /corrupted/);
  assert.match(h.elements["experiment-context"].textContent, /matched control/);
  assert.match(textTree(h.elements["literature-list"]), /metadata_only/);
  assert.match(textTree(h.elements["literature-list"]), /公开全文未取得/);
  assert.equal(h.elements["manuscript-title"].textContent, "真实实验稿件");
  assert.match(h.elements["manuscript-checks"].textContent, /not_submitted/);
  assert.match(h.elements["manuscript-checks"].textContent, /编译器不可用/);
  assert.equal(h.elements["manuscript-result"].hidden, false);
});

test("Malformed successful start response retains pending key for confirmation rather than declaring success", async () => {
  const h = harness({ customFetch: (url, options, { response }) => url === "/api/research/runs" && options.method === "POST" ? response({ status: "queued" }, 202) : undefined });
  await h.app.ready;
  h.elements["research-goal"].value = "研究噪声鲁棒性";
  await h.app.start({ preventDefault() {} });
  assert.equal(h.app.state.run, null);
  assert.ok(h.app.state.pending?.request_id);
  assert.match(h.elements["request-error-text"].textContent, /缺少运行编号/);
  assert.equal(h.app.state.connected, false);
});

test("Writer settings are collapsed, password-only and expose only current public configuration", async () => {
  assert.doesNotMatch(html.match(/<details[^>]*id="writer-settings-panel"[^>]*>/)?.[0] || "", /\bopen\b/);
  const keyInput = html.match(/<input[^>]*id="writer-api-key"[^>]*>/)?.[0] || "";
  assert.match(keyInput, /type="password"/);
  assert.match(keyInput, /autocomplete="off"/);
  assert.match(keyInput, /autocapitalize="off"/);
  assert.doesNotMatch(keyInput, /\bvalue=/);
  assert.match(html, /仅保存在本机配置，保存后用于后续论文写作与审阅/);
  assert.match(html, /https:\/\/platform\.deepseek\.com\/api_keys/);
  const h = harness({ writerSettings: { ...defaultWriterSettings, api_key: "sk-must-never-enter-state" } });
  await h.app.ready;
  assert.equal(h.elements["writer-model-input"].value, "deepseek-flash");
  assert.equal(h.elements["writer-api-key"].value, "");
  assert.match(h.elements["writer-current-provider"].textContent, /codex · Codex CLI default/);
  assert.equal(h.elements["writer-key-status"].dataset.configured, "false");
  assert.doesNotMatch(JSON.stringify(h.app.state), /sk-must-never-enter-state|"api_key"/);
  assert.equal(h.elements["writer-save-btn"].disabled, false);
});

test("Saved DeepSeek model is loaded while refresh and polling preserve unsaved model and key input", async () => {
  const h = harness({ initialRun: run({ status: "completed" }), writerSettings: { ...defaultWriterSettings, provider: "deepseek", configured_provider: "deepseek", key_configured: true, model: "deepseek-chat" } });
  await h.app.ready;
  assert.equal(h.elements["writer-model-input"].value, "deepseek-chat");
  assert.equal(h.elements["writer-key-status"].dataset.configured, "true");
  h.elements["writer-model-input"].value = "deepseek-flash";
  h.elements["writer-model-input"].dispatch("input");
  h.elements["writer-api-key"].value = "sk-unsaved-private-key";
  h.elements["writer-api-key"].dispatch("input");
  h.server.writerSettings = { ...h.server.writerSettings, model: "deepseek-reasoner" };
  await h.app.refresh();
  await h.app.poll();
  assert.equal(h.elements["writer-model-input"].value, "deepseek-flash");
  assert.equal(h.elements["writer-api-key"].value, "sk-unsaved-private-key");
  assert.match(h.elements["writer-current-provider"].textContent, /deepseek-reasoner/);
  assert.doesNotMatch(JSON.stringify(h.app.state), /sk-unsaved-private-key/);
  assert.doesNotMatch(String(h.storage.value), /sk-unsaved-private-key/);
});

test("Connection test can reuse a configured key without saving or enabling a new provider", async () => {
  const h = harness({ writerSettings: { ...defaultWriterSettings, key_configured: true } });
  await h.app.ready;
  await h.app.writerAction("test");
  const calls = postCalls(h, "/api/research/writer-settings/test");
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.body), { api_key: null, model: "deepseek-flash" });
  assert.equal(h.calls.filter((call) => call.options.method === "PUT").length, 0);
  assert.equal(h.app.state.writerSettings.provider, "codex");
  assert.match(h.elements["writer-message"].textContent, /测试不会修改已有配置/);
  assert.equal(h.elements["writer-model-options"].children.length, 2);
});

test("Save locks duplicate requests, clears the key and refreshes the active writer without restart", async () => {
  const pending = deferred();
  const caps = { ...capabilities, writer: { provider: "codex", model: "Codex CLI default", available: true } };
  const h = harness({ caps, customFetch: (url, options) => url === "/api/research/writer-settings" && options.method === "PUT" ? pending.promise : undefined });
  await h.app.ready;
  h.elements["writer-api-key"].value = "sk-save-private-key";
  h.elements["writer-api-key"].dispatch("input");
  const first = h.app.writerAction("save", { preventDefault() {} });
  const duplicate = h.app.writerAction("save", { preventDefault() {} });
  const calls = h.calls.filter((call) => call.url === "/api/research/writer-settings" && call.options.method === "PUT");
  assert.equal(calls.length, 1);
  assert.equal(h.elements["writer-save-btn"].disabled, true);
  assert.equal(h.elements["writer-test-btn"].disabled, true);
  assert.equal(h.elements["writer-api-key"].disabled, true);
  h.server.writerSettings = { ...defaultWriterSettings, provider: "deepseek", model: "deepseek-flash", key_configured: true, configured_provider: "deepseek" };
  caps.writer = { provider: "deepseek", model: "deepseek-flash", available: true };
  pending.resolve(h.response({ ok: true, settings: { ...h.server.writerSettings, api_key: "sk-save-private-key" }, message: "已保存并启用 DeepSeek。" }));
  await Promise.all([first, duplicate]);
  assert.equal(h.elements["writer-api-key"].value, "");
  assert.equal(h.elements["writer-save-btn"].disabled, false);
  assert.equal(h.elements["writer-key-status"].dataset.configured, "true");
  assert.match(h.elements["writer-current-provider"].textContent, /deepseek · deepseek-flash/);
  assert.match(h.elements["environment-note"].textContent, /deepseek/);
  assert.equal(h.calls.filter((call) => call.url === "/api/research/capabilities").length, 2);
  assert.equal(h.calls.filter((call) => call.url === "/api/research/writer-settings" && !call.options.method).length, 2);
  assert.doesNotMatch(JSON.stringify(h.app.state), /sk-save-private-key|"api_key"/);
  assert.doesNotMatch(String(h.storage.value), /sk-save-private-key/);
});

test("Blank key requires an existing configuration and can reuse that configuration on save", async () => {
  const h = harness();
  await h.app.ready;
  await h.app.writerAction("test");
  await h.app.writerAction("save");
  assert.equal(postCalls(h, "/api/research/writer-settings/test").length, 0);
  assert.equal(h.calls.filter((call) => call.options.method === "PUT").length, 0);
  assert.match(h.elements["writer-message"].textContent, /请先填写 DeepSeek API Key/);
  h.server.writerSettings.key_configured = true;
  await h.app.refresh();
  await h.app.writerAction("save");
  const save = h.calls.find((call) => call.options.method === "PUT");
  assert.deepEqual(JSON.parse(save.options.body), { api_key: null, model: "deepseek-flash" });
  assert.equal(h.app.state.writerSettings.provider, "deepseek");
});

test("Running research disables writer save while allowing connection tests", async () => {
  const h = harness({ initialRun: run(), writerSettings: { ...defaultWriterSettings, editable: false, busy: true, key_configured: true } });
  await h.app.ready;
  assert.equal(h.elements["writer-save-btn"].disabled, true);
  assert.equal(h.elements["writer-test-btn"].disabled, false);
  await h.app.writerAction("save");
  assert.equal(h.calls.filter((call) => call.options.method === "PUT").length, 0);
  await h.app.writerAction("test");
  assert.equal(postCalls(h, "/api/research/writer-settings/test").length, 1);
  h.server.run = run({ status: "completed" });
  h.server.writerSettings = { ...h.server.writerSettings, editable: true, busy: false };
  await h.app.poll();
  assert.equal(h.elements["writer-save-btn"].disabled, false);
});

test("Writer test and save failures redact reflected keys, preserve retry input and avoid browser persistence", async () => {
  const key = "sk-example-secret-key";
  for (const action of ["test", "save"]) {
    const h = harness({ customFetch: (url, options, { response }) => url.startsWith("/api/research/writer-settings") && options.method ? response({ detail: `Authentication rejected: ${JSON.parse(options.body).api_key}` }, 400) : undefined });
    await h.app.ready;
    h.elements["writer-api-key"].value = key;
    h.elements["writer-api-key"].dispatch("input");
    await h.app.writerAction(action);
    assert.equal(h.elements["writer-message"].dataset.tone, "error");
    assert.match(h.elements["writer-message"].textContent, /Authentication rejected/);
    assert.doesNotMatch(h.elements["writer-message"].textContent, /sk-example-secret-key/);
    assert.equal(h.elements["writer-api-key"].value, key);
    assert.doesNotMatch(JSON.stringify(h.app.state), /sk-example-secret-key/);
    assert.doesNotMatch(String(h.storage.value), /sk-example-secret-key/);
    assert.equal(h.elements["writer-save-btn"].disabled, false);
    h.window.dispatch("pagehide");
    assert.equal(h.elements["writer-api-key"].value, "");
  }
});

test("Writer settings failure stays local; a late hidden-page response cannot restore key input", async () => {
  let unavailableEndpoint = true;
  const unavailable = harness({ customFetch: (url, _options, { response }) => unavailableEndpoint && url === "/api/research/writer-settings" ? response({ detail: "Settings endpoint unavailable" }, 503) : undefined });
  await unavailable.app.ready;
  assert.equal(unavailable.elements["start-btn"].disabled, false);
  assert.equal(unavailable.elements["writer-save-btn"].disabled, true);
  assert.match(unavailable.elements["writer-message"].textContent, /暂时无法读取/);
  unavailableEndpoint = false;
  await unavailable.app.refresh();
  assert.equal(unavailable.elements["writer-save-btn"].disabled, false);
  assert.equal(unavailable.elements["writer-message"].hidden, true);
  const pending = deferred();
  const h = harness({ customFetch: (url) => url === "/api/research/writer-settings/test" ? pending.promise : undefined });
  await h.app.ready;
  h.elements["writer-api-key"].value = "sk-leaving-page-key";
  h.elements["writer-api-key"].dispatch("input");
  const testRequest = h.app.writerAction("test");
  h.window.dispatch("pagehide");
  assert.equal(h.elements["writer-api-key"].value, "");
  pending.resolve(h.response({ ok: true, model: "deepseek-flash", available_models: [], configured: false, message: "sk-leaving-page-key" }));
  await testRequest;
  assert.equal(h.elements["writer-api-key"].value, "");
  assert.doesNotMatch(h.elements["writer-message"].textContent, /sk-leaving-page-key/);
  assert.equal(h.app.state.writerMutation, null);
});
