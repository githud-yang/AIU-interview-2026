/** Render the interview outline and evidence; all network reads belong to showcase-transport.js. */
import { createShowcaseTransport } from "./showcase-transport.js";

const byId = (id) => document.getElementById(id);
const transport = createShowcaseTransport();
const CORE_IDS = ["agent", "yolo", "yinghuo", "hardware", "harness"];
const STEP_KEY = "aiu-showcase-current-step";
const ui = Object.fromEntries([
  "showcase-title", "checked-date", "verdict-title", "start-presenting", "refresh-preflight",
  "preflight-time", "preflight-services", "preflight-note", "preflight-announcement",
  "overview-mode", "presenter-mode", "fullscreen-button", "fullscreen-label", "print-button",
  "mode-description", "showcase-loading", "showcase-error", "showcase-error-message", "retry-showcase",
  "overview-panel", "project-grid", "engineering-details", "engineering-summary", "engineering-card",
  "presenter-panel", "presenter-steps", "presenter-card", "previous-step", "next-step",
  "presenter-position", "step-announcement", "preparation", "preparation-list", "print-summary",
  "evidence-dialog", "evidence-title", "close-evidence", "evidence-status", "evidence-image",
  "evidence-text", "evidence-open", "interface-announcement",
].map((id) => [id, byId(id)]));
let cards = [];
let currentStep = 0;
let mode = "overview";
let loading = false;
let checking = false;
let evidenceGeneration = 0;
let evidenceController = null;
let evidenceTrigger = null;
const nativeDialog = typeof ui["evidence-dialog"].showModal === "function";

function element(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function dateLabel(value, withTime = false) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(date);
}

function safeActionUrl(href) {
  try {
    const url = new URL(href, window.location.href);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function list(items, className) {
  const result = element("ul", className);
  for (const item of items) result.append(element("li", "", item));
  return result;
}

function metadata(card, optional = false) {
  const result = element("div", "card-meta");
  result.append(element("span", "category", `${optional ? "选讲 · " : ""}${card.category}`));
  result.append(element("span", "status-badge", card.status));
  return result;
}

function limitation(card) {
  if (!card.limitation) return null;
  const note = element("p", "card-limit");
  note.append(element("strong", "", "边界说明 · "), document.createTextNode(card.limitation));
  return note;
}

function evidenceSection(card) {
  if (!card.evidence.length) return null;
  const section = element("section", "card-evidence");
  section.setAttribute("aria-label", `${card.title}的证据`);
  section.append(element("h4", "detail-label", "证据入口"));
  const buttons = element("div", "evidence-buttons");
  for (const evidence of card.evidence) {
    const button = element("button", "evidence-button", evidence.label);
    button.type = "button";
    button.disabled = evidence.available === false;
    if (button.disabled) {
      button.textContent = `${evidence.label} · 暂不可用`;
      button.title = "登记的证据文件当前不可读取";
    } else {
      button.setAttribute("aria-haspopup", "dialog");
      button.addEventListener("click", () => { void openEvidence(evidence, button); });
    }
    buttons.append(button);
  }
  section.append(buttons);
  return section;
}

function actions(card, { presenter = false } = {}) {
  const result = element("div", "card-actions");
  for (const action of card.actions) {
    const href = safeActionUrl(action.href);
    if (!href) continue;
    const link = element("a", "button button-light", action.label);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const arrow = element("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    link.append(arrow, element("span", "sr-only", "（新标签页）"));
    result.append(link);
  }
  if (!presenter) {
    const button = element("button", "text-link", "讲解这项 →");
    button.type = "button";
    button.addEventListener("click", () => {
      const step = cards.findIndex((item) => item.id === card.id);
      if (step < 0) return;
      selectStep(step);
      setMode("presenter", true);
    });
    result.append(button);
  }
  return result;
}

function overviewCard(card) {
  const article = element("article", "project-card");
  const heading = element("h3", "", card.title);
  heading.id = `overview-title-${card.id}`;
  article.setAttribute("aria-labelledby", heading.id);
  article.append(metadata(card, card.id === "engineering"), heading,
    element("p", "card-summary", card.summary));
  if (card.proof.length) article.append(list(card.proof, "proof-list"));
  const note = limitation(card);
  const evidence = evidenceSection(card);
  if (note) article.append(note);
  if (evidence) article.append(evidence);
  article.append(actions(card));
  return article;
}

function rememberStep() {
  try { window.localStorage.setItem(STEP_KEY, cards[currentStep].id); }
  catch { /* Storage is optional; presentation remains usable in private or restricted contexts. */ }
}

function focusPresenter() {
  byId("presenter-title")?.focus({ preventScroll: true });
}

function renderPresenter() {
  const card = cards[currentStep];
  if (!card) return;
  const article = ui["presenter-card"];
  article.replaceChildren();
  const heading = element("h3", "", card.title);
  heading.id = "presenter-title";
  heading.tabIndex = -1;
  article.append(metadata(card, card.id === "engineering"), heading,
    element("p", "presenter-summary", card.summary));

  const columns = element("div", "presenter-columns");
  const talk = element("section", "presenter-talk");
  talk.setAttribute("aria-label", "讲解提纲");
  talk.append(element("h4", "detail-label", "用自己的话讲清楚"));
  if (card.talk.length) talk.append(list(card.talk, "talk-list"));
  else talk.append(element("p", "subtle", "这项作品暂未提供讲解提纲。"));
  columns.append(talk);
  if (card.proof.length) {
    const proof = element("section", "presenter-proof");
    proof.setAttribute("aria-label", "已登记的实现与证据");
    proof.append(element("h4", "detail-label", "实现与证据"), list(card.proof, "proof-list"));
    columns.append(proof);
  }
  article.append(columns);
  const note = limitation(card);
  const evidence = evidenceSection(card);
  if (note) article.append(note);
  if (evidence) article.append(evidence);
  article.append(actions(card, { presenter: true }));

  for (const button of ui["presenter-steps"].querySelectorAll("button")) {
    if (button.dataset.step === card.id) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  ui["previous-step"].disabled = currentStep === 0;
  ui["next-step"].disabled = currentStep === cards.length - 1;
  ui["next-step"].textContent = cards[currentStep + 1]?.id === "engineering" ? "选讲收尾 →" : "下一项 →";
  ui["presenter-position"].textContent = `${card.id === "engineering" ? "选讲收尾" : "当前作品"} · ${card.title}`;
  ui["step-announcement"].textContent = `正在讲解${card.title}${card.id === "engineering" ? "，这是选讲收尾" : ""}`;
}

function selectStep(index, focus = false) {
  if (index < 0 || index >= cards.length) return;
  currentStep = index;
  rememberStep();
  renderPresenter();
  if (focus) focusPresenter();
}

function setMode(nextMode, focus = false) {
  if (!cards.length) return;
  mode = nextMode;
  const presenting = mode === "presenter";
  ui["overview-panel"].hidden = presenting;
  ui["presenter-panel"].hidden = !presenting;
  ui["overview-mode"].setAttribute("aria-pressed", String(!presenting));
  ui["presenter-mode"].setAttribute("aria-pressed", String(presenting));
  ui["mode-description"].textContent = presenting
    ? "沿讲解路径逐项展开。工程实现是可选收尾，作品入口均在新标签页打开。"
    : "先看整体，再选择一项作品展开。";
  if (presenting && focus) {
    focusPresenter();
    byId("projects").scrollIntoView({ block: "start", behavior: "auto" });
  }
}

function renderPrint(data) {
  const summary = ui["print-summary"];
  summary.replaceChildren(element("h1", "", data.title), element("p", "print-verdict", data.verdict),
    element("p", "print-date", `核对日期：${dateLabel(data.checkedDate)} · 现场展示提纲`));
  const grid = element("div", "print-cards");
  for (const card of cards) {
    const article = element("article", "print-card");
    article.append(element("h2", "", `${card.id === "engineering" ? "选讲 · " : ""}${card.title}`),
      element("p", "", card.summary), list(card.talk, ""));
    if (card.limitation) article.append(element("p", "print-limit", `边界：${card.limitation}`));
    grid.append(article);
  }
  summary.append(grid);
  if (data.checklist.length) {
    const checklist = element("section", "print-checklist");
    checklist.append(element("h2", "", "上台前确认"), list(data.checklist, ""));
    summary.append(checklist);
  }
}

function renderShowcase(data) {
  cards = [...CORE_IDS, "engineering"].flatMap((id) => data.cards.filter((card) => card.id === id));
  if (!cards.length) throw new Error("展示清单没有可用作品，请刷新后重试。");
  try {
    const saved = window.localStorage.getItem(STEP_KEY);
    currentStep = Math.max(0, cards.findIndex((card) => card.id === saved));
  } catch { currentStep = 0; }
  ui["showcase-title"].textContent = data.title;
  document.title = `${data.title} · AIU Lab`;
  ui["verdict-title"].textContent = data.verdict;
  ui["checked-date"].textContent = `交付核对 · ${dateLabel(data.checkedDate)}`;
  ui["project-grid"].replaceChildren(...cards.filter((card) => card.id !== "engineering").map(overviewCard));
  const engineering = cards.find((card) => card.id === "engineering");
  ui["engineering-details"].hidden = !engineering;
  if (engineering) {
    ui["engineering-summary"].textContent = engineering.title;
    ui["engineering-card"].replaceChildren(overviewCard(engineering));
  }
  ui["presenter-steps"].replaceChildren();
  cards.forEach((card, index) => {
    const button = element("button", `step-button${card.id === "engineering" ? " step-button--optional" : ""}`);
    button.type = "button";
    button.dataset.step = card.id;
    button.append(element("span", "", card.title), element("small", "", card.id === "engineering" ? "OPTIONAL CLOSING" : card.category));
    button.addEventListener("click", () => selectStep(index));
    ui["presenter-steps"].append(button);
  });
  ui["preparation-list"].replaceChildren(...data.checklist.map((item) => element("li", "", item)));
  ui["preparation"].hidden = data.checklist.length === 0;
  ui["start-presenting"].disabled = false;
  ui["presenter-mode"].disabled = false;
  ui["print-button"].disabled = false;
  renderPresenter();
  renderPrint(data);
  setMode(mode);
}

async function loadShowcase() {
  if (loading) return;
  loading = true;
  ui["showcase-loading"].hidden = false;
  ui["showcase-error"].hidden = true;
  ui["retry-showcase"].disabled = true;
  try { renderShowcase(await transport.getShowcase()); }
  catch (error) {
    if (error?.name === "AbortError") return;
    ui["showcase-error-message"].textContent = error.message || "请确认本机服务已启动，然后重新读取。";
    ui["showcase-error"].hidden = false;
    ui["checked-date"].textContent = "交付核对清单暂未读取";
    ui["verdict-title"].textContent = "请先读取交付核对清单";
  } finally {
    loading = false;
    ui["showcase-loading"].hidden = true;
    ui["retry-showcase"].disabled = false;
  }
}

async function refreshPreflight() {
  if (checking) return;
  checking = true;
  ui["refresh-preflight"].disabled = true;
  ui["preflight-services"].setAttribute("aria-busy", "true");
  ui["preflight-time"].textContent = "正在检查…";
  try {
    const result = await transport.getPreflight();
    ui["preflight-services"].replaceChildren(...result.services.map((service) => {
      const item = element("div", "service-item");
      item.dataset.available = String(service.available);
      const heading = element("div", "service-heading");
      heading.append(element("span", "service-label", service.label),
        element("span", "service-state", service.available ? "检查通过" : "需检查"));
      item.append(heading, element("p", "service-detail", service.detail));
      return item;
    }));
    ui["preflight-time"].textContent = `检查于 ${dateLabel(result.checkedAt, true)}`;
    ui["preflight-note"].textContent = result.note;
    ui["preflight-announcement"].textContent = result.services.every((service) => service.available)
      ? "登记项目的只读检查已通过。" : "只读检查完成，部分项目需要检查，请查看详情。";
  } catch (error) {
    if (error?.name === "AbortError") return;
    ui["preflight-services"].replaceChildren(element("p", "preflight-error", error.message || "连接检查暂未完成。"));
    ui["preflight-time"].textContent = "检查未完成";
    ui["preflight-note"].textContent = "确认本机服务状态后，可以手动刷新检查。";
    ui["preflight-announcement"].textContent = "连接检查未完成，可以手动重试。";
  } finally {
    checking = false;
    ui["refresh-preflight"].disabled = false;
    ui["preflight-services"].setAttribute("aria-busy", "false");
  }
}

function cleanupEvidence() {
  evidenceGeneration += 1;
  evidenceController?.abort();
  evidenceController = null;
  ui["evidence-image"].onload = null;
  ui["evidence-image"].onerror = null;
  ui["evidence-image"].removeAttribute("src");
  ui["evidence-text"].textContent = "";
  document.body.style.overflow = "";
  if (evidenceTrigger?.isConnected) evidenceTrigger.focus({ preventScroll: true });
  else if (mode === "presenter") focusPresenter();
  else ui["overview-mode"].focus({ preventScroll: true });
  evidenceTrigger = null;
}

function closeEvidence() {
  const dialog = ui["evidence-dialog"];
  if (!dialog.open) return;
  if (nativeDialog) dialog.close();
  else { dialog.removeAttribute("open"); cleanupEvidence(); }
}

async function openEvidence(evidence, trigger) {
  const token = ++evidenceGeneration;
  evidenceController?.abort();
  evidenceController = new AbortController();
  evidenceTrigger = trigger;
  const dialog = ui["evidence-dialog"];
  const image = ui["evidence-image"];
  const text = ui["evidence-text"];
  const status = ui["evidence-status"];
  ui["evidence-title"].textContent = evidence.label;
  ui["evidence-open"].href = transport.evidenceUrl(evidence.id);
  image.hidden = true;
  image.removeAttribute("src");
  text.hidden = true;
  text.textContent = "";
  status.hidden = false;
  status.dataset.error = "false";
  status.textContent = "正在读取证据…";
  if (!dialog.open) {
    if (nativeDialog) dialog.showModal();
    else {
      dialog.setAttribute("open", "");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      document.body.style.overflow = "hidden";
    }
  }
  ui["close-evidence"].focus({ preventScroll: true });
  const current = () => token === evidenceGeneration && dialog.open;
  const showError = (message) => {
    if (!current()) return;
    status.dataset.error = "true";
    status.textContent = message;
    status.hidden = false;
    image.hidden = true;
    text.hidden = true;
  };
  if (evidence.kind === "image") {
    image.alt = `${evidence.label}，项目展示证据`;
    image.onload = () => { if (current()) { status.hidden = true; image.hidden = false; } };
    image.onerror = () => showError("这张证据图片暂时无法读取，请确认服务状态后重试。");
    image.src = transport.evidenceUrl(evidence.id);
  } else {
    try {
      const content = await transport.getEvidenceText(evidence.id, { signal: evidenceController.signal });
      if (!current()) return;
      text.textContent = content || "（文件为空）";
      text.hidden = false;
      status.hidden = true;
    } catch (error) {
      if (error?.name !== "AbortError") showError(error.message || "这份证据暂时无法读取，请稍后重试。");
    }
  }
}

ui["start-presenting"].addEventListener("click", () => setMode("presenter", true));
ui["overview-mode"].addEventListener("click", () => setMode("overview"));
ui["presenter-mode"].addEventListener("click", () => setMode("presenter", true));
ui["previous-step"].addEventListener("click", () => selectStep(currentStep - 1, true));
ui["next-step"].addEventListener("click", () => selectStep(currentStep + 1, true));
ui["refresh-preflight"].addEventListener("click", () => { void refreshPreflight(); });
ui["retry-showcase"].addEventListener("click", () => { void loadShowcase(); });
ui["print-button"].addEventListener("click", () => window.print());
ui["close-evidence"].addEventListener("click", closeEvidence);
ui["evidence-dialog"].addEventListener("close", cleanupEvidence);
ui["evidence-dialog"].addEventListener("click", (event) => {
  if (event.target !== ui["evidence-dialog"]) return;
  const rect = ui["evidence-dialog"].getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeEvidence();
});
ui["evidence-dialog"].addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !nativeDialog) { event.preventDefault(); closeEvidence(); return; }
  if (event.key !== "Tab") return;
  const focusable = [...ui["evidence-dialog"].querySelectorAll("button, a[href], [tabindex='0']")]
    .filter((item) => !item.disabled && !item.hidden && item.getClientRects().length);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});

document.addEventListener("keydown", (event) => {
  if (mode !== "presenter" || ui["evidence-dialog"].open || event.defaultPrevented
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("a,button,input,textarea,select,summary,[contenteditable]:not([contenteditable='false']),[role='button'],[role='textbox'],[role='slider'],[role='listbox'],[role='combobox'],[role='menu']")) return;
  const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (!direction || currentStep + direction < 0 || currentStep + direction >= cards.length) return;
  event.preventDefault();
  selectStep(currentStep + direction, true);
});

if (document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function") {
  ui["fullscreen-button"].hidden = false;
  ui["fullscreen-button"].addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { ui["interface-announcement"].textContent = "浏览器未允许全屏，可继续使用当前展示模式。"; }
  });
  document.addEventListener("fullscreenchange", () => {
    const active = Boolean(document.fullscreenElement);
    const label = active ? "退出全屏" : "全屏展示";
    ui["fullscreen-button"].setAttribute("aria-pressed", String(active));
    ui["fullscreen-button"].title = label;
    ui["fullscreen-label"].textContent = label;
  });
}

window.addEventListener("pagehide", () => { evidenceController?.abort(); transport.close(); });
void loadShowcase();
void refreshPreflight();
