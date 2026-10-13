/** Interactive research graph: inspect persisted stages without dispatching work. */

const SVG_NS = "http://www.w3.org/2000/svg";
const GEOMETRY = { width: 1252, height: 724, nodeWidth: 240, nodeHeight: 148, stepX: 300, stepY: 204, margin: 56 };
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.6;
const STATUS = {
  pending: "待执行", queued: "等待执行", running: "执行中", completed: "已完成", succeeded: "已完成",
  failed: "执行失败", interrupted: "已中断", cancelled: "已取消", cancelling: "正在取消",
  blocked: "受阻", needs_input: "待补充条件", skipped: "已跳过", unsupported: "未接入",
};
const PREVIEW = {
  literature: ["发现", "按研究任务检索文献，保存真实书目与来源。"],
  reading: ["发现", "获取可访问全文，保留实际阅读范围。"],
  ideation: ["构思", "明确问题、假设和反证方向，记录创新状态。"],
  protocol: ["设计", "冻结实验设置、选参规则与评价边界。"],
  data: ["实验", "准备已接入的数据、划分和环境记录。"],
  baseline: ["实验", "执行基线，保留原始测量。"],
  method: ["实验", "保存已注册实现与实验配方。"],
  experiments: ["实验", "运行候选设置，依据预先规则选取配置。"],
  validation: ["验证", "按冻结配置复验，记录真实评价范围。"],
  manuscript: ["成稿", "依据测量结果生成报告与可追溯材料。"],
  review: ["核查", "核对事实、记录审阅并保留修订版本。"],
  submission: ["投稿", "整理投稿准备材料与尚需补充的条件。"],
};
const OUTPUT_LABELS = {
  stage_summary: "阶段摘要", title: "研究标题", hypothesis: "研究假设", motivation: "问题动机",
  novelty_status: "创新状态", implemented_scope: "实现范围", limitations: "研究限制", warnings: "提示",
  query_plan: "检索计划", parsed: "已解析全文", selection_policy: "选取规则", records: "书目记录",
  recipe: "实验配方", execution: "执行方式", required_fits: "计划拟合次数", selection: "配置选取",
  status: "输出状态", ok: "工具结果", error: "错误信息", summary: "结果摘要", checks: "核查记录",
  model_review: "审阅意见", fixes: "修改记录", training_fits: "训练次数", fit_count: "拟合次数",
  interpretation: "结果解释", analysis: "结果分析", quality: "内部检查", preparation: "准备状态",
  venue: "投稿渠道", reason: "原因", required_action: "待办条件", scope: "执行范围",
  image_sizes: "输入尺寸", baseline_imgsz: "基线尺寸", independent_test: "独立测试",
  evaluation_scope: "评价范围", data_protocol: "数据规则", frozen_selection: "冻结配置",
};
const INPUTS = {
  reading: ["literature"], ideation: ["reading"], protocol: ["ideation"], data: ["protocol"],
  baseline: ["protocol", "data"], method: ["protocol"], experiments: ["protocol", "data"],
  validation: ["protocol", "experiments"], manuscript: ["reading", "validation"],
  review: ["manuscript"], submission: [],
};
const YOLO_INPUTS = {
  reading: ["literature"], ideation: [], protocol: [], data: [], baseline: ["data"],
  method: ["protocol"], experiments: ["data", "baseline"], validation: ["data", "experiments"],
  manuscript: ["reading", "validation"], review: ["manuscript"], submission: [],
};

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function list(value) { return Array.isArray(value) ? value : []; }
function own(value, key) { return object(value) && Object.hasOwn(value, key) ? value[key] : undefined; }
function clipped(value, limit = 260) {
  const text = typeof value === "string" ? value : value === undefined || value === null ? "未提供" : String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
function describe(value, limit = 260, depth = 0) {
  if (Array.isArray(value)) {
    if (!value.length) return "0 条记录";
    if (depth > 1) return `${value.length} 条记录`;
    return clipped(`${value.length} 条 · ${value.slice(0, 3).map((item) => describe(item, 90, depth + 1)).join("；")}`, limit);
  }
  if (object(value)) {
    if (depth > 1) return "结构化记录";
    return clipped(Object.entries(value).slice(0, 5).map(([key, item]) => `${OUTPUT_LABELS[key] || key}：${describe(item, 110, depth + 1)}`).join("；") || "空记录", limit);
  }
  return clipped(value, limit);
}
function safeArtifactURL(value, baseURL) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const base = new URL(baseURL);
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      && url.origin === base.origin && url.pathname.startsWith("/api/research/") ? url.href : null;
  } catch { return null; }
}
function normalizedPath(value) { return typeof value === "string" ? value.replaceAll("\\", "/").replace(/^\.\//, "") : ""; }
function stageArtifacts(output, run) {
  if (!object(output) || !run) return [];
  const references = [...list(output.artifacts), ...(object(output.manifest) ? [output.manifest] : [])].filter(object);
  return list(run.artifacts).filter((record) => object(record) && references.some((reference) => {
    if (reference.sha256 && record.sha256 && reference.sha256 !== record.sha256) return false;
    if (reference.id && reference.id === record.id) return true;
    const relative = normalizedPath(record.path);
    const source = normalizedPath(reference.path);
    return Boolean(relative && source && (relative === source || source.endsWith(`/runs/${run.id}/${relative}`)));
  }));
}
function nodeArtifacts(stageID, output, run) {
  const original = stageArtifacts(output, run);
  if (stageID !== "manuscript") return { artifacts: original, chinese: null };
  const chinese = object(output?.chinese_reading) || object(own(run?.outputs, "chinese_reading"));
  const preferred = stageArtifacts(chinese, run).sort((left, right) => {
    const priority = { chinese_reading_html: 4, chinese_reading_pdf: 3, chinese_reading_md: 2, chinese_reading_png: 1 };
    return (priority[right.kind] || 0) - (priority[left.kind] || 0);
  });
  const seen = new Set();
  const artifacts = [...preferred, ...original].filter((artifact) => {
    const key = artifact.id || normalizedPath(artifact.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { artifacts, chinese: preferred.length ? chinese : null };
}
function position(index) {
  const row = Math.floor(index / 4);
  const column = row % 2 ? 3 - index % 4 : index % 4;
  return { x: GEOMETRY.margin + column * GEOMETRY.stepX, y: GEOMETRY.margin + row * GEOMETRY.stepY };
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function createResearchWorkflow({ document: doc = globalThis.document, window: win = globalThis.window, onSelect = () => {} } = {}) {
  const el = (id) => doc.getElementById(id);
  const viewport = el("workflow-viewport");
  const world = el("workflow-world");
  const edges = el("workflow-edges");
  const stageList = el("stage-list");
  if (!viewport || !world || !edges || !stageList) throw new Error("研究工作流容器不完整。");
  const state = { stages: [], run: null, events: [], capabilities: null, selected: null, scale: 1, runID: null, destroyed: false, drag: null, focusedOnce: false };
  const nodes = new Map();
  const listeners = [];
  const baseURL = win.location?.href || "http://localhost/research";

  function node(tag, className, text) {
    const result = doc.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = clipped(text, 1200);
    return result;
  }
  function write(id, text) { const target = el(id); if (target) target.textContent = clipped(text, 1200); }
  function listen(target, type, callback, options) {
    if (!target) return;
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  }
  function svg(tag, attributes = {}) {
    const result = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, String(value));
    return result;
  }
  function bounds() {
    return { x: Math.max(0, GEOMETRY.width * state.scale - (viewport.clientWidth || 0)), y: Math.max(0, GEOMETRY.height * state.scale - (viewport.clientHeight || 0)) };
  }
  function scrollTo(x, y) {
    const maximum = bounds();
    viewport.scrollLeft = clamp(Number.isFinite(x) ? x : 0, 0, maximum.x);
    viewport.scrollTop = clamp(Number.isFinite(y) ? y : 0, 0, maximum.y);
  }
  function applyScale() {
    world.style.width = `${GEOMETRY.width * state.scale}px`;
    world.style.height = `${GEOMETRY.height * state.scale}px`;
    for (const surface of [stageList, edges]) {
      surface.style.width = `${GEOMETRY.width}px`;
      surface.style.height = `${GEOMETRY.height}px`;
      surface.style.transformOrigin = "0 0";
      surface.style.transform = `scale(${state.scale})`;
    }
    edges.setAttribute("viewBox", `0 0 ${GEOMETRY.width} ${GEOMETRY.height}`);
    write("workflow-zoom-label", `${Math.round(state.scale * 100)}%`);
    const smaller = el("workflow-zoom-out");
    const larger = el("workflow-zoom-in");
    if (smaller) smaller.disabled = state.scale <= MIN_SCALE;
    if (larger) larger.disabled = state.scale >= MAX_SCALE;
  }
  function zoom(value, anchor) {
    if (state.destroyed || !Number.isFinite(value)) return;
    const x = anchor?.x ?? (viewport.clientWidth || 0) / 2;
    const y = anchor?.y ?? (viewport.clientHeight || 0) / 2;
    const old = state.scale;
    const worldX = (viewport.scrollLeft + x) / old;
    const worldY = (viewport.scrollTop + y) / old;
    state.scale = clamp(value, MIN_SCALE, MAX_SCALE);
    applyScale();
    scrollTo(worldX * state.scale - x, worldY * state.scale - y);
  }
  function centerStage(id) {
    const index = state.stages.findIndex((stage) => stage.id === id);
    if (index < 0) return;
    const point = position(index);
    scrollTo((point.x + GEOMETRY.nodeWidth / 2) * state.scale - (viewport.clientWidth || 0) / 2,
      (point.y + GEOMETRY.nodeHeight / 2) * state.scale - (viewport.clientHeight || 0) / 2);
  }
  function currentID() { return state.stages.find((stage) => stage.id === state.run?.stage)?.id || state.stages.find((stage) => stage.status === "running")?.id || state.stages[0]?.id || null; }
  function inspect() {
    const stage = state.stages.find((item) => item.id === state.selected);
    const empty = el("node-empty");
    if (empty) empty.hidden = Boolean(stage);
    const inspector = el("workflow-inspector");
    if (inspector) inspector.dataset.empty = String(!stage);
    write("node-title", stage?.label || "选择一个节点");
    write("node-status", stage ? STATUS[stage.status] || stage.status : "暂无阶段");
    if (el("node-status")) el("node-status").dataset.status = stage?.status || "pending";
    const output = stage && object(own(state.run?.outputs, stage.id));
    const summary = stage?.summary || output?.stage_summary || (stage && own(PREVIEW, stage.id)?.[1]) || "服务连接后，将显示已接入的研究阶段。";
    write("node-summary", summary);
    const inputs = [];
    const outputs = [];
    const { artifacts, chinese } = nodeArtifacts(stage?.id, output, state.run);
    if (stage) {
      inputs.push(["研究目标", state.run?.goal || "从左侧填写目标，启动后随运行保存。"]);
      const domain = list(state.capabilities?.domains).find((item) => item?.id === state.run?.domain);
      if (state.run?.domain) inputs.push(["执行任务", domain?.label || state.run.domain]);
      const sourceIDs = own(state.run?.domain === "yolo_tradeoff" ? YOLO_INPUTS : INPUTS, stage.id) || [];
      for (const sourceID of sourceIDs) {
        const source = state.stages.find((item) => item.id === sourceID);
        const sourceOutput = object(own(state.run?.outputs, sourceID));
        inputs.push([source?.label || sourceID, sourceOutput ? describe(sourceOutput.stage_summary || source?.summary || sourceOutput, 180) : "尚未登记阶段输出"]);
      }
      if (stage.id === "submission") inputs.push(["运行记录", state.run ? "使用本次运行的登记产物、执行事件和人工介入记录。" : "运行后归集实际产物与执行记录。"]);
      if (chinese) outputs.push(["中文阅读稿", chinese.title || "中文报告文件已登记；英文稿与历史版本保留。"]);
      if (output) {
        const fields = Object.entries(output).filter(([key]) => !["artifacts", "manifest", "stage_summary", "revised_manuscript", "chinese_reading"].includes(key));
        for (const [key, value] of fields.slice(0, 8)) outputs.push([OUTPUT_LABELS[key] || key, describe(value, 340)]);
        if (fields.length > 8) outputs.push(["更多字段", `另有 ${fields.length - 8} 项，完整记录见下方材料与实验。`]);
      } else outputs.push(["阶段输出", state.run ? "此节点尚无服务端登记输出。" : "运行前预览，尚未执行。"]);
      const event = [...state.events].reverse().find((item) => object(item) && item.stage === stage.id && typeof item.message === "string");
      if (event) outputs.push(["最近事件", event.message]);
    }
    function records(id, items) {
      const container = el(id);
      if (!container) return;
      container.replaceChildren(...items.map(([label, value]) => {
        const entry = node("li", "inspector-record");
        entry.append(node("strong", "", label), node("span", "", value));
        return entry;
      }));
    }
    records("node-inputs", inputs);
    records("node-outputs", outputs);
    const container = el("node-artifacts");
    if (container) {
      const entries = artifacts.slice(0, 8).map((artifact) => {
        const item = node("li", "inspector-artifact");
        const href = safeArtifactURL(artifact.url, baseURL);
        const label = artifact.name || artifact.id || "研究产物";
        if (href) {
          const link = node("a", "", label);
          link.href = href;
          link.setAttribute("download", artifact.name || "");
          link.setAttribute("aria-label", `下载 ${clipped(label, 180)}`);
          item.append(link);
        } else item.append(node("span", "", `${clipped(label, 180)} · 下载地址不可用`));
        return item;
      });
      if (artifacts.length > 8) entries.push(node("li", "inspector-artifact", `另有 ${artifacts.length - 8} 份关联产物，见下方材料列表。`));
      if (!entries.length) entries.push(node("li", "inspector-artifact empty-inspector-record", stage ? "该节点尚无关联的已登记文件。" : "选择节点查看关联文件。"));
      container.replaceChildren(...entries);
    }
  }
  function updateSelection() {
    for (const [id, item] of nodes) {
      const selected = id === state.selected;
      item.row.dataset.selected = String(selected);
      item.row.dataset.current = String(id === state.run?.stage);
      item.button.setAttribute("aria-pressed", String(selected));
      item.button.setAttribute("tabindex", selected ? "0" : "-1");
    }
  }
  function select(id, { focus = false, center = false, announce = true, notify = true } = {}) {
    if (state.destroyed || !nodes.has(id)) return false;
    state.selected = id;
    updateSelection();
    inspect();
    const stage = state.stages.find((item) => item.id === id);
    if (announce) write("workflow-announcement", `${stage.label}，${STATUS[stage.status] || stage.status}`);
    if (focus) nodes.get(id).button.focus({ preventScroll: true });
    if (center) centerStage(id);
    if (notify) onSelect(stage);
    return true;
  }
  function drawEdges() {
    const definitions = svg("defs");
    for (const status of ["pending", "completed", "running", "failed"]) {
      const marker = svg("marker", { id: `workflow-arrow-${status}`, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse" });
      const arrow = svg("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "workflow-arrow" });
      arrow.dataset.status = status;
      marker.append(arrow);
      definitions.append(marker);
    }
    const paths = [];
    for (let index = 0; index < state.stages.length - 1; index += 1) {
      const source = state.stages[index];
      const target = state.stages[index + 1];
      const a = position(index);
      const b = position(index + 1);
      const turns = Math.floor(index / 4) !== Math.floor((index + 1) / 4);
      let d;
      if (turns) {
        const x = a.x + GEOMETRY.nodeWidth / 2;
        d = `M ${x} ${a.y + GEOMETRY.nodeHeight} L ${x} ${b.y - 8}`;
      } else {
        const forward = b.x > a.x;
        const start = a.x + (forward ? GEOMETRY.nodeWidth : 0);
        const end = b.x + (forward ? -8 : GEOMETRY.nodeWidth + 8);
        const y = a.y + GEOMETRY.nodeHeight / 2;
        d = `M ${start} ${y} C ${(start + end) / 2} ${y}, ${(start + end) / 2} ${y}, ${end} ${y}`;
      }
      const status = target.status === "failed" ? "failed" : target.status === "running" ? "running" : ["completed", "succeeded"].includes(source.status) && ["completed", "succeeded"].includes(target.status) ? "completed" : "pending";
      const path = svg("path", { d, class: "workflow-edge", fill: "none", "marker-end": `url(#workflow-arrow-${status})` });
      path.dataset.status = status;
      paths.push(path);
    }
    edges.replaceChildren(definitions, ...paths);
  }
  function renderNodes() {
    const previousFocus = doc.activeElement?.dataset?.stageId;
    const nextIDs = new Set(state.stages.map((stage) => stage.id));
    for (const id of nodes.keys()) if (!nextIDs.has(id)) nodes.delete(id);
    const rows = state.stages.map((stage, index) => {
      let entry = nodes.get(stage.id);
      if (!entry) {
        const row = node("li", "workflow-node");
        const button = node("button", "workflow-node-button");
        button.type = "button";
        button.dataset.stageId = stage.id;
        const eyebrow = node("span", "workflow-node-eyebrow");
        const title = node("span", "workflow-node-title");
        const status = node("span", "workflow-node-status");
        const summary = node("p", "workflow-node-summary");
        const input = node("span", "workflow-node-port workflow-node-port-in");
        const output = node("span", "workflow-node-port workflow-node-port-out");
        input.setAttribute("aria-hidden", "true");
        output.setAttribute("aria-hidden", "true");
        button.append(eyebrow, title, status, summary, input, output);
        row.append(button);
        entry = { row, button, eyebrow, title, status, summary };
        nodes.set(stage.id, entry);
      }
      const point = position(index);
      entry.row.style.left = `${point.x}px`;
      entry.row.style.top = `${point.y}px`;
      entry.row.style.width = `${GEOMETRY.nodeWidth}px`;
      entry.row.style.height = `${GEOMETRY.nodeHeight}px`;
      entry.row.dataset.status = stage.status;
      entry.row.dataset.flow = Math.floor(index / 4) % 2 ? "reverse" : "forward";
      entry.row.dataset.turnIn = String(index > 0 && index % 4 === 0);
      entry.row.dataset.turnOut = String(index < state.stages.length - 1 && index % 4 === 3);
      entry.eyebrow.textContent = `${String(index + 1).padStart(2, "0")} · ${own(PREVIEW, stage.id)?.[0] || "阶段"}`;
      entry.title.textContent = clipped(stage.label, 100);
      entry.status.textContent = STATUS[stage.status] || clipped(stage.status, 40);
      entry.status.dataset.status = stage.status;
      entry.summary.textContent = clipped(stage.summary || own(state.run?.outputs, stage.id)?.stage_summary || own(PREVIEW, stage.id)?.[1] || "等待服务端阶段记录。", 72);
      entry.button.setAttribute("aria-label", `${stage.label}，${STATUS[stage.status] || stage.status}`);
      return entry.row;
    });
    const ordered = stageList.children;
    const changed = ordered.length !== rows.length || rows.some((row, index) => ordered[index] !== row);
    if (changed) stageList.replaceChildren(...(rows.length ? rows : [node("li", "workflow-empty", "暂无阶段记录，等待服务连接。启动研究前不会执行节点。") ]));
    updateSelection();
    if (changed && previousFocus && nodes.has(previousFocus)) nodes.get(previousFocus).button.focus({ preventScroll: true });
    drawEdges();
  }
  function update(payload = {}) {
    if (state.destroyed) return;
    const data = object(payload) || {};
    state.run = object(data.run);
    state.events = list(data.events);
    state.capabilities = object(data.capabilities);
    const seen = new Set();
    state.stages = list(data.stages).filter((stage) => {
      if (!object(stage) || typeof stage.id !== "string" || !stage.id || stage.id.length > 100 || seen.has(stage.id)) return false;
      seen.add(stage.id);
      return true;
    }).map((stage) => ({ id: stage.id, label: typeof stage.label === "string" && stage.label ? stage.label : stage.id,
      status: state.run && typeof stage.status === "string" && stage.status ? stage.status : "pending", summary: state.run && typeof stage.summary === "string" ? stage.summary : "" }));
    const runID = typeof state.run?.id === "string" ? state.run.id : null;
    const changedRun = runID !== state.runID;
    state.runID = runID;
    if (changedRun || !state.stages.some((stage) => stage.id === state.selected)) state.selected = currentID();
    renderNodes();
    inspect();
    if ((!state.focusedOnce && state.stages.length) || changedRun) {
      state.focusedOnce = true;
      centerStage(state.selected);
    }
  }
  function focusCurrent() {
    const id = currentID();
    if (id) select(id, { center: true, focus: true });
  }
  function fit() {
    if (state.destroyed || !viewport.clientWidth || !viewport.clientHeight) return;
    zoom(Math.min((viewport.clientWidth - 28) / GEOMETRY.width, (viewport.clientHeight - 28) / GEOMETRY.height));
    scrollTo(0, 0);
  }
  function reset() { zoom(1); centerStage(state.selected); }
  listen(el("workflow-zoom-in"), "click", () => zoom(state.scale + 0.15));
  listen(el("workflow-zoom-out"), "click", () => zoom(state.scale - 0.15));
  listen(el("workflow-zoom-reset"), "click", reset);
  listen(el("workflow-fit"), "click", fit);
  listen(el("workflow-focus-current"), "click", focusCurrent);
  listen(stageList, "click", (event) => {
    const button = event.target?.closest?.("button[data-stage-id]");
    if (button && stageList.contains(button)) select(button.dataset.stageId);
  });
  listen(stageList, "keydown", (event) => {
    const button = event.target?.closest?.("button[data-stage-id]");
    if (!button || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const index = state.stages.findIndex((stage) => stage.id === button.dataset.stageId);
    if (index < 0) return;
    event.preventDefault();
    const step = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? state.stages.length - 1 : clamp(index + step, 0, state.stages.length - 1);
    select(state.stages[next].id, { focus: true, center: true });
  });
  listen(viewport, "wheel", (event) => {
    if (!event.ctrlKey || state.destroyed) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoom(state.scale * Math.exp(-clamp(event.deltaY, -400, 400) * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, { passive: false });
  listen(viewport, "keydown", (event) => {
    if (event.target !== viewport || event.ctrlKey || event.metaKey || event.altKey) return;
    if (["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "0") reset(); else zoom(state.scale + (event.key === "-" ? -0.15 : 0.15));
    }
  });
  listen(viewport, "pointerdown", (event) => {
    if (event.button !== 0 || event.pointerType === "touch" || event.target?.closest?.("button,a,input,select,textarea,[contenteditable]")) return;
    state.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.dataset.dragging = "true";
    viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  listen(viewport, "pointermove", (event) => {
    const drag = state.drag;
    if (!drag || drag.id !== event.pointerId) return;
    scrollTo(drag.left - (event.clientX - drag.x), drag.top - (event.clientY - drag.y));
    event.preventDefault();
  });
  function endDrag(event) {
    if (!state.drag || event.pointerId !== state.drag.id) return;
    if (viewport.hasPointerCapture?.(event.pointerId)) viewport.releasePointerCapture?.(event.pointerId);
    state.drag = null;
    viewport.dataset.dragging = "false";
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) listen(viewport, type, endDrag);
  listen(win, "resize", () => scrollTo(viewport.scrollLeft, viewport.scrollTop));
  applyScale();
  inspect();
  return {
    update, focusCurrent, fit, reset, select,
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      if (state.drag && viewport.hasPointerCapture?.(state.drag.id)) viewport.releasePointerCapture?.(state.drag.id);
      state.drag = null;
      viewport.dataset.dragging = "false";
      for (const remove of listeners.splice(0)) remove();
    },
  };
}
