/** Present the current run's registered research outputs beside its workflow. */
const list = (value) => Array.isArray(value) ? value : [];
const path = (value) => typeof value === "string" ? value.replaceAll("\\", "/") : "";
const text = (value, fallback = "") => typeof value === "string" && value.trim() ? value : fallback;

function registeredURL(artifact, runID, baseURL) {
  if (!artifact || typeof artifact.id !== "string" || typeof artifact.url !== "string") return null;
  try {
    const url = new URL(artifact.url, baseURL);
    const expected = `/api/research/runs/${encodeURIComponent(runID)}/artifacts/${encodeURIComponent(artifact.id)}`;
    if (url.origin !== new URL(baseURL).origin || !["http:", "https:"].includes(url.protocol)
      || url.username || url.password || url.pathname !== expected || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

function matchesReference(artifact, reference) {
  const relative = path(artifact.path);
  const source = path(reference?.path);
  return Boolean(relative && source && (source === relative || source.endsWith(`/${relative}`))
    && (!reference.sha256 || reference.sha256 === artifact.sha256));
}

function measuredSummary(run, manuscript) {
  const records = list(manuscript?.summary);
  if (run.domain === "yolo_tradeoff") {
    const selected = manuscript?.selected_imgsz;
    const record = records.find((row) => row.split === "evaluation" && row.imgsz === selected);
    if (record && typeof record.map50_95 === "number" && Number.isFinite(record.map50_95)
      && record.map50_95 >= 0 && record.map50_95 <= 1 && typeof record.latency_ms === "number"
      && Number.isFinite(record.latency_ms) && record.latency_ms > 0) {
      return `冻结配置 ${selected} · 第二拆分评测 mAP50–95 ${(record.map50_95 * 100).toFixed(2)}% · 单图端到端延迟 ${record.latency_ms.toFixed(2)} ms。`;
    }
  }
  if (run.domain === "digits_robustness") {
    const selected = records.find((row) => row.model === "selected_candidate" && row.condition === "gaussian_noise");
    const baseline = records.find((row) => row.model === "baseline" && row.condition === "gaussian_noise");
    const valid = (row) => typeof row?.accuracy_mean === "number" && Number.isFinite(row.accuracy_mean) && row.accuracy_mean >= 0 && row.accuracy_mean <= 1;
    if (valid(selected) && valid(baseline)) return `噪声条件下，候选配置平均准确率 ${(selected.accuracy_mean * 100).toFixed(2)}%，基线 ${(baseline.accuracy_mean * 100).toFixed(2)}%。`;
  }
  return text(manuscript?.summary, "论文、实验图表与数据随实际运行更新。");
}

export function selectResearchOutcomes(run, baseURL) {
  if (!run || typeof run.id !== "string") return { runID: null, title: "研究成果将在这里呈现", summary: "论文、实验图表与数据随实际运行更新。", status: "等待研究运行", empty: "启动研究后，可以在画布旁查看和打开已产生的成果。" };
  const artifacts = list(run.artifacts).map((artifact) => ({ ...artifact, href: registeredURL(artifact, run.id, baseURL) })).filter((artifact) => artifact.href);
  const outputs = run.outputs || {};
  const manuscript = outputs.manuscript;
  const candidateReading = manuscript?.chinese_reading || outputs.chinese_reading;
  const reading = !candidateReading?.run_id || candidateReading.run_id === run.id ? candidateReading : null;
  const referenced = (references, accept) => artifacts.find((artifact) => accept(artifact) && list(references).some((ref) => matchesReference(artifact, ref)));
  const manuscriptFile = (extension) => referenced(manuscript?.artifacts, (artifact) => artifact.kind === extension) || null;
  const paperZH = referenced(reading?.artifacts, (artifact) => artifact.kind === "chinese_reading_html");
  const pdfZH = referenced(reading?.artifacts, (artifact) => artifact.kind === "chinese_reading_pdf");
  const chartZH = referenced(reading?.artifacts, (artifact) => artifact.kind === "chinese_reading_png");
  const paper = paperZH || manuscriptFile("html");
  const pdf = pdfZH || manuscriptFile("pdf");
  const chart = chartZH || referenced(manuscript?.artifacts, (artifact) => artifact.kind === "png" && /(?:accuracy_latency|robustness)\.png$/.test(path(artifact.path)))
    || artifacts.find((artifact) => ["experiments/accuracy_latency.png", "experiments/robustness.png"].includes(path(artifact.path)));
  const csv = artifacts.find((artifact) => path(artifact.path) === "experiments/metrics.csv");
  const bundle = outputs.latest_export?.bundle
    ? referenced([outputs.latest_export.bundle], (artifact) => artifact.kind === "zip")
    : artifacts.find((artifact) => path(artifact.path) === "research_bundle.zip");
  const hasPaper = Boolean(paper || pdf);
  const any = hasPaper || chart || csv || bundle;
  const active = ["queued", "running", "cancelling"].includes(run.status);
  const stopped = ["failed", "cancelled", "interrupted", "needs_input"].includes(run.status);
  return {
    runID: run.id, paper, pdf, chart, csv, bundle,
    title: text(paperZH || pdfZH ? reading?.title : manuscript?.title, any ? "本次研究成果" : "研究成果正在准备"),
    summary: measuredSummary(run, manuscript),
    status: hasPaper ? (active ? "稿件已生成 · 研究进行中" : stopped ? "已保留阶段稿件" : "候选稿已生成") : active ? "研究进行中" : ({ failed: "执行失败", cancelled: "研究已取消", interrupted: "研究已中断", needs_input: "等待补充条件" }[run.status] || "暂无稿件"),
    empty: hasPaper ? "" : active ? "研究正在推进，论文生成后可直接阅读；已有实验成果会先展示。" : stopped ? "本次运行尚未生成可阅读稿件，可查看已保留的实验材料和运行日志。" : "本次运行尚无已登记的可阅读稿件。",
  };
}

export function createResearchOutcomes({ document: doc, window: win, baseURL }) {
  const el = (id) => doc.getElementById(id);
  let current = selectResearchOutcomes(null, baseURL);
  let tab = "outcomes";
  let previewURL = null;
  let chartURL = null;
  function clearSource(node) { if (typeof node.removeAttribute === "function") node.removeAttribute("src"); else node.src = ""; }
  function showTab(name, focus = false) {
    if (!["outcomes", "node"].includes(name)) return;
    tab = name;
    for (const mode of ["outcomes", "node"]) {
      const selected = mode === name;
      const button = el(`inspector-tab-${mode}`);
      button.setAttribute("aria-selected", String(selected));
      button.setAttribute("tabindex", selected ? "0" : "-1");
      button.classList.toggle("active", selected);
      el(mode === "outcomes" ? "outcome-pane" : "node-pane").hidden = !selected;
    }
    el("inspector-title").textContent = name === "outcomes" ? "研究成果" : "节点详情";
    if (focus) el(`inspector-tab-${name}`).focus();
  }
  function closePreview(focus = true) {
    const open = !el("outcome-preview").hidden;
    el("outcome-preview").hidden = true;
    clearSource(el("outcome-preview-frame"));
    previewURL = null;
    if (open && focus) el("outcome-open").focus();
  }
  function openPreview() {
    if (!current.paper) return;
    const frame = el("outcome-preview-frame");
    frame.setAttribute("sandbox", "");
    frame.src = `${current.paper.href}?preview=1`;
    previewURL = current.paper.href;
    el("outcome-preview").hidden = false;
    el("outcome-preview-close").focus();
  }
  function update(run) {
    const next = selectResearchOutcomes(run, baseURL);
    if (current.runID !== next.runID) { closePreview(false); showTab("outcomes"); }
    else if (previewURL && previewURL !== next.paper?.href) closePreview(false);
    current = next;
    el("outcome-state").textContent = current.status;
    el("outcome-title").textContent = current.title;
    el("outcome-summary").textContent = current.summary;
    el("outcome-empty").textContent = current.empty;
    el("outcome-empty").hidden = !current.empty;
    el("outcome-open").disabled = !current.paper;
    for (const type of ["pdf", "csv", "bundle"]) {
      const link = el(`outcome-${type}`);
      const artifact = current[type];
      link.hidden = !artifact;
      link.href = artifact?.href || "";
      link.setAttribute("download", artifact?.name || "");
    }
    if (chartURL !== (current.chart?.href || null) || !current.chart) {
      chartURL = current.chart?.href || null;
      if (chartURL) el("outcome-chart").src = `${chartURL}?preview=1`;
      else clearSource(el("outcome-chart"));
      el("outcome-chart").hidden = !chartURL;
      el("outcome-chart-empty").hidden = Boolean(chartURL);
      el("outcome-chart-empty").textContent = "实际实验图表准备好后在此显示。";
    }
  }
  function escape(event) { if (event.key === "Escape" && !el("outcome-preview").hidden) { event.preventDefault(); closePreview(); } }
  for (const mode of ["outcomes", "node"]) {
    el(`inspector-tab-${mode}`).addEventListener("click", () => showTab(mode));
    el(`inspector-tab-${mode}`).addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      showTab(event.key === "Home" ? "outcomes" : event.key === "End" ? "node" : tab === "node" ? "outcomes" : "node", true);
    });
  }
  el("outcome-open").addEventListener("click", openPreview);
  el("outcome-preview-close").addEventListener("click", () => closePreview());
  el("outcome-chart").addEventListener("error", () => {
    el("outcome-chart").hidden = true;
    el("outcome-chart-empty").hidden = false;
    el("outcome-chart-empty").textContent = "图表暂时无法载入，可从完整材料中查看。";
  });
  win.addEventListener("keydown", escape);
  showTab("outcomes"); update(null);
  return { update, showTab, openPreview, closePreview, destroy() { closePreview(false); win.removeEventListener?.("keydown", escape); } };
}
