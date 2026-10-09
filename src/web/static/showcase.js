/** Keep every project mounted; only explicit controls start or reload applications. */
import { createShowcaseTransport } from "./showcase-transport.js";
import { initShowcaseLive } from "./showcase-live.js";

const byId = (id) => document.getElementById(id);
const transport = createShowcaseTransport();
let readingResearch = false;
let readingCatalog = false;
let checking = false;
let catalogLoaded = false;
let tableArtifact = null;
let tableLoadedFor = "";
let currentRun = "";
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai", hour12: false,
  }).format(date);
};

function renderResearch(data) {
  currentRun = data.runId;
  byId("harness-source").textContent = data.source;
  byId("harness-run").textContent = data.title;
  byId("harness-summary").textContent = data.summary;
  byId("harness-limitation").textContent = data.limitation;
  if (data.metrics.length) byId("harness-metrics").replaceChildren(...data.metrics.map((metric) => {
    const item = element("div", "metric");
    item.append(element("span", "", metric.label), element("strong", "", metric.value));
    return item;
  }));
  const report = data.artifacts.find((item) => item.id === "report" && item.available);
  const frame = byId("harness-report");
  const placeholder = byId("harness-report-placeholder");
  if (report) {
    byId("harness-report-label").textContent = report.label;
    frame.hidden = false;
    placeholder.hidden = true;
    if (frame.getAttribute("src") !== report.href || frame.dataset.run !== data.runId) {
      frame.dataset.run = data.runId;
      frame.src = report.href;
    }
  } else {
    frame.hidden = true;
    placeholder.hidden = false;
    placeholder.replaceChildren(element("strong", "", data.source), element("p", "", data.summary));
    if (data.comparison.length) {
      const table = element("table", "comparison-table");
      const head = element("tr");
      ["输入尺寸", "mAP50–95", "延迟 / ms", "拆分"].forEach((label) => head.append(element("th", "", label)));
      const body = element("tbody");
      data.comparison.forEach((row) => {
        const tr = element("tr");
        [row.imgsz, row.map50_95, row.latency_ms, row.split].forEach((value) => tr.append(element("td", "", String(value ?? "—"))));
        body.append(tr);
      });
      const thead = element("thead"); thead.append(head); table.append(thead, body); placeholder.append(table);
    }
  }
  tableArtifact = data.artifacts.find((item) => item.id === "table" && item.available) || null;
  if (tableLoadedFor !== currentRun) byId("harness-table").textContent = tableArtifact ? "展开后读取原始评测数据。" : "该运行快照未提供可读取的 CSV 文件。";
  const downloads = byId("harness-downloads");
  downloads.replaceChildren();
  for (const artifact of data.artifacts.filter((item) => item.available && item.kind === "pdf")) {
    const link = element("a", "", artifact.label);
    link.href = artifact.href; link.download = "AIU-research-report.pdf"; downloads.append(link);
  }
  if (tableArtifact) {
    const link = element("a", "", "原始评测 CSV"); link.href = "#runtime-details";
    link.addEventListener("click", () => { byId("runtime-details").open = true; byId("harness-table-details").open = true; });
    downloads.append(link);
  }
  if (byId("harness-table-details").open) void loadTable();
}

async function loadResearch() {
  if (readingResearch) return;
  readingResearch = true;
  byId("refresh-harness").disabled = true;
  try { renderResearch(await transport.getStageResearch()); }
  catch (error) {
    if (error?.name !== "AbortError") {
      byId("harness-source").textContent = "读取未完成";
      byId("harness-summary").textContent = error.message || "运行记录暂时无法读取，可刷新记录重试。";
      const placeholder = byId("harness-report-placeholder");
      if (!placeholder.hidden) placeholder.replaceChildren(element("strong", "", "已保存研究报告"), element("p", "", "刷新记录后读取报告产物。"));
    }
  } finally { readingResearch = false; byId("refresh-harness").disabled = false; }
}

async function loadTable() {
  if (!tableArtifact || tableLoadedFor === currentRun) return;
  const run = currentRun;
  byId("harness-table").textContent = "正在读取…";
  try {
    const text = await transport.getStageResearchText("table");
    if (run !== currentRun) return;
    byId("harness-table").textContent = text || "（文件为空）";
    tableLoadedFor = run;
  } catch (error) { if (error?.name !== "AbortError") byId("harness-table").textContent = error.message || "原始数据读取未完成。"; }
}

async function loadCatalog() {
  if (readingCatalog) return;
  readingCatalog = true; byId("retry-showcase").disabled = true;
  try {
    const data = await transport.getShowcase();
    byId("checked-date").textContent = `资料日期 · ${data.checkedDate}`;
    byId("showcase-verdict").textContent = data.verdict;
    byId("runtime-catalog").replaceChildren(...data.cards.map((card) => {
      const item = element("details", "catalog-item");
      item.append(element("summary", "", `${card.title} · ${card.status}`), element("p", "", card.summary));
      const proof = element("ul"); card.proof.forEach((text) => proof.append(element("li", "", text))); item.append(proof);
      const talk = element("ul"); card.talk.forEach((text) => talk.append(element("li", "", text))); item.append(talk);
      if (card.limitation) item.append(element("p", "", `范围说明 · ${card.limitation}`));
      const links = element("div", "catalog-links");
      card.evidence.filter((entry) => entry.available !== false).forEach((entry) => {
        const link = element("a", "", `下载${entry.label}`); link.href = transport.evidenceUrl(entry.id); link.download = ""; links.append(link);
      });
      item.append(links); return item;
    }));
    catalogLoaded = true;
  } catch (error) { if (error?.name !== "AbortError") byId("runtime-catalog").textContent = error.message || "项目资料读取未完成。"; }
  finally { readingCatalog = false; byId("retry-showcase").disabled = false; }
}

async function refreshPreflight() {
  if (checking) return;
  checking = true; byId("refresh-preflight").disabled = true; byId("preflight-time").textContent = "正在检查…";
  byId("preflight-services").setAttribute("aria-busy", "true");
  try {
    const data = await transport.getPreflight();
    byId("preflight-services").replaceChildren(...data.services.map((service) => {
      const item = element("div", "service-item"); item.dataset.available = String(service.available);
      const heading = element("div", "service-heading");
      heading.append(element("span", "service-label", service.label), element("span", "service-state", service.available ? "检查通过" : "需检查"));
      item.append(heading, element("p", "service-detail", service.detail)); return item;
    }));
    byId("preflight-time").textContent = `检查时间 · ${dateLabel(data.checkedAt)}`;
    byId("preflight-note").textContent = data.note;
    byId("preflight-announcement").textContent = "连接检查完成。";
  } catch (error) {
    if (error?.name !== "AbortError") { byId("preflight-time").textContent = "检查未完成"; byId("preflight-note").textContent = error.message || "可以点击检查连接重试。"; }
  } finally { checking = false; byId("refresh-preflight").disabled = false; byId("preflight-services").setAttribute("aria-busy", "false"); }
}

const yinghuo = byId("yinghuo-frame");
byId("load-yinghuo").addEventListener("click", () => {
  byId("yinghuo-placeholder").hidden = false;
  byId("yinghuo-load-status").textContent = "正在载入萤火…";
  yinghuo.hidden = false;
  yinghuo.src = yinghuo.dataset.src;
  byId("load-yinghuo").textContent = "手动重新载入";
  byId("load-yinghuo").title = "仅点击此按钮才重新载入；项目导航保留当前编辑。";
});
yinghuo.addEventListener("load", () => { if (yinghuo.hasAttribute("src")) byId("yinghuo-placeholder").hidden = true; });
byId("refresh-harness").addEventListener("click", () => { void loadResearch(); });
byId("refresh-preflight").addEventListener("click", () => { void refreshPreflight(); });
byId("retry-showcase").addEventListener("click", () => { void loadCatalog(); });
byId("runtime-details").addEventListener("toggle", () => { if (byId("runtime-details").open && !catalogLoaded) void loadCatalog(); });
byId("harness-table-details").addEventListener("toggle", () => { if (byId("harness-table-details").open) void loadTable(); });
document.querySelectorAll(".saved-image img").forEach((image) => image.addEventListener("error", () => {
  image.hidden = true; image.parentElement.querySelector(".image-fallback").hidden = false;
}));

const links = [...document.querySelectorAll(".site-nav a")];
function markSection(id) { links.forEach((link) => { if (link.hash === `#${id}`) link.setAttribute("aria-current", "location"); else link.removeAttribute("aria-current"); }); }
markSection(window.location.hash.slice(1) || "agent");
if (typeof IntersectionObserver === "function") {
  const observer = new IntersectionObserver((entries) => {
    const entry = entries.filter((item) => item.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (entry) markSection(entry.target.id);
  }, { rootMargin: "-100px 0px -55% 0px", threshold: 0 });
  document.querySelectorAll(".project-section").forEach((section) => observer.observe(section));
}
if (document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function") {
  const button = byId("fullscreen-button"); button.hidden = false;
  button.addEventListener("click", async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { byId("interface-announcement").textContent = "浏览器未允许全屏。"; }
  });
  document.addEventListener("fullscreenchange", () => {
    const active = Boolean(document.fullscreenElement); button.setAttribute("aria-pressed", String(active)); button.textContent = active ? "退出全屏" : "全屏";
  });
}
window.addEventListener("pagehide", () => transport.close());
initShowcaseLive();
void loadResearch();
