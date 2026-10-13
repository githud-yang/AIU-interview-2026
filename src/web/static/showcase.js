/** Assemble continuous project views and public connection metadata. */
import { createShowcaseTransport } from "./showcase-transport.js?v=stage-live-20261013-c";
import { initShowcaseLive } from "./showcase-live.js?v=stage-live-20261013-c";
import { initializeShowcaseNavigation } from "./showcase-navigation.js?v=stage-live-20261013-c";

const byId = (id) => document.getElementById(id);
const transport = createShowcaseTransport();
let readingCatalog = false;
let checking = false;
let catalogLoaded = false;
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
byId("refresh-preflight").addEventListener("click", () => { void refreshPreflight(); });
byId("retry-showcase").addEventListener("click", () => { void loadCatalog(); });
byId("runtime-details").addEventListener("toggle", () => { if (byId("runtime-details").open && !catalogLoaded) void loadCatalog(); });
document.querySelectorAll(".saved-image img").forEach((image) => image.addEventListener("error", () => {
  image.hidden = true; image.parentElement.querySelector(".image-fallback").hidden = false;
}));

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
initializeShowcaseNavigation();
