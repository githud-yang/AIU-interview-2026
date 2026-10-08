import { getYoloSources, getYoloStatus, startYolo, stopYolo, getYoloStreamUrl } from "./api.js";

const sourceSelect = document.getElementById("source-select");
const startButton = document.getElementById("start-btn");
const stopButton = document.getElementById("stop-btn");
const refreshButton = document.getElementById("refresh-btn");
const video = document.getElementById("video");
const placeholder = document.getElementById("video-placeholder");
const notice = document.getElementById("yolo-msg");
const warning = document.getElementById("yolo-warning");
let sources = [];
let state = { running: false, state: "idle" };
let busy = false;
let polling = false;
let connected = false;
let streamAttached = false;
let streamFailed = false;
let noticeOverride = "";
let pollTimer;
let pollGeneration = 0;
let pageActive = true;
const sourceDescriptions = {
  camera: "使用运行应用的电脑摄像头。请打开隐私挡板，并保证光线充足。",
  demo: "公开静态样例：Ultralytics 的公交车图片。用于验证检测效果，并非实时摄像头。",
  video: "使用服务器已配置的视频文件。视频来源由应用管理员设置。",
};
function updateControls() {
  const active = Boolean(state.running) || state.state === "stopping";
  const selected = sources.find((source) => source.id === sourceSelect.value);
  sourceSelect.disabled = busy || active || !sources.length;
  startButton.disabled = busy || active || polling || !connected || !selected?.available;
  stopButton.disabled = busy || !active || polling || !connected;
  refreshButton.disabled = busy || polling;
  startButton.textContent = busy ? "处理中…" : "启动检测 ▶";
  document.getElementById("source-help").textContent = selected?.msg || sourceDescriptions[selected?.id] || "选择可用来源后启动检测。";
}
function removeStream() {
  streamAttached = false;
  video.hidden = true;
  video.removeAttribute("src");
  placeholder.hidden = false;
  document.getElementById("source-overlay").hidden = true;
}
function attachStream() {
  if (!pageActive || streamAttached || streamFailed) return;
  streamAttached = true;
  video.src = getYoloStreamUrl();
  document.getElementById("placeholder-title").textContent = "正在准备画面";
  document.getElementById("placeholder-description").textContent = "模型加载与首帧检测可能需要一些时间。";
}
function renderState(next) {
  state = next;
  const status = document.getElementById("detection-status");
  const active = Boolean(state.running);
  const labels = { idle: "待机", starting: "准备中", running: "检测中", stopping: "停止中", stopped: "已停止", finished: "播放完毕", error: "检测异常" };
  status.textContent = !connected ? "服务未连接" : labels[state.state] || (active ? "检测中" : "待机");
  status.dataset.tone = !connected || state.error ? "warning" : active ? "success" : "neutral";
  const activeSource = sources.find((source) => source.id === state.source);
  document.getElementById("active-source").textContent = state.source_label || activeSource?.label || "—";
  document.getElementById("detection-model").textContent = state.model || "—";
  document.getElementById("fps").textContent = Number.isFinite(Number(state.fps)) ? `${Number(state.fps).toFixed(1)} fps` : "—";
  document.getElementById("frame-count").textContent = Number(state.frame_count || 0).toLocaleString("zh-CN");
  const started = typeof state.started_at === "number" ? state.started_at * 1000 : Date.parse(state.started_at);
  const elapsed = active && Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : null;
  document.getElementById("elapsed").textContent = elapsed === null ? "—" : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  if (active && sources.some((source) => source.id === state.source)) sourceSelect.value = state.source;
  notice.textContent = noticeOverride || state.error || state.msg || (active ? "检测正在运行。" : "选择画面来源，然后启动检测。");
  notice.classList.toggle("notice-error", Boolean(state.error) || !connected || Boolean(noticeOverride));
  warning.textContent = state.warning || "";
  warning.hidden = !state.warning;
  if (active) {
    attachStream();
    // Some browsers do not emit an img load event until an MJPEG stream closes.
    // A processed frame also lets us reveal the live image while the stream remains open.
    if (Number(state.frame_count) > 0 && streamAttached && !streamFailed) {
      video.hidden = false;
      placeholder.hidden = true;
    }
    const overlay = document.getElementById("source-overlay");
    overlay.textContent = state.source === "demo" ? "公开静态样例 · 非实时画面" : state.source_label || activeSource?.label || "检测画面";
    overlay.hidden = video.hidden;
  } else {
    removeStream();
    streamFailed = false;
    document.getElementById("placeholder-title").textContent = state.error ? "检测未能继续" : state.state === "finished" ? "视频播放完毕" : "准备好开始检测";
    document.getElementById("placeholder-description").textContent = state.error ? "查看下方提示，处理后可再次启动。" : state.state === "finished" ? "可以重新启动播放，或选择其他画面来源。" : "选择画面来源，然后点击“启动检测”。";
  }
  updateControls();
}
async function loadSources() {
  const response = await getYoloSources();
  if (!Array.isArray(response.sources)) throw new Error("服务未返回有效的画面来源");
  const selected = sourceSelect.value;
  sources = response.sources;
  sourceSelect.replaceChildren();
  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = `${source.label}${source.available ? "" : "（不可用）"}`;
    option.disabled = !source.available;
    sourceSelect.appendChild(option);
  }
  const desired = sources.find((source) => source.id === selected && source.available) || sources.find((source) => source.id === response.default && source.available) || sources.find((source) => source.available);
  if (desired) sourceSelect.value = desired.id;
  updateControls();
}
async function refreshStatus({ refreshSources = false } = {}) {
  if (polling || busy) return;
  const generation = pollGeneration;
  polling = true;
  updateControls();
  try {
    if (refreshSources || !sources.length) await loadSources();
    const next = await getYoloStatus();
    if (!pageActive || generation !== pollGeneration) return;
    connected = true;
    renderState(next);
  } catch (error) {
    connected = false;
    notice.textContent = error.message;
    notice.classList.add("notice-error");
    document.getElementById("detection-status").textContent = "服务未连接";
    document.getElementById("detection-status").dataset.tone = "warning";
  } finally { polling = false; updateControls(); }
}
async function changeDetection(action) {
  if (busy || polling) return;
  const generation = pollGeneration;
  busy = true;
  noticeOverride = "";
  streamFailed = false;
  notice.classList.remove("notice-error");
  notice.textContent = action === "start" ? "正在启动检测，请稍候…" : "正在停止检测并释放设备…";
  updateControls();
  try {
    const result = action === "start" ? await startYolo(sourceSelect.value) : await stopYolo();
    if (!result.ok) {
      noticeOverride = result.msg || "操作未能完成，请检查服务后重试";
      if (result.state) state.state = result.state;
    }
    const next = await getYoloStatus();
    if (!pageActive || generation !== pollGeneration) return;
    connected = true;
    renderState(next);
  } catch (error) {
    noticeOverride = error.message;
    notice.textContent = error.message;
    notice.classList.add("notice-error");
  } finally { busy = false; updateControls(); }
}
video.addEventListener("load", () => {
  if (!state.running || !streamAttached) return;
  video.hidden = false;
  placeholder.hidden = true;
  document.getElementById("source-overlay").hidden = false;
});
video.addEventListener("error", () => {
  if (!streamAttached || !state.running) return;
  removeStream();
  streamFailed = true;
  noticeOverride = "视频流连接中断。点击“刷新状态”重新连接，或停止后再次启动。";
  notice.textContent = noticeOverride;
  notice.classList.add("notice-error");
  document.getElementById("placeholder-title").textContent = "画面连接中断";
  document.getElementById("placeholder-description").textContent = "检测服务可能仍在运行，请刷新状态。";
});
sourceSelect.addEventListener("change", updateControls);
startButton.addEventListener("click", () => { void changeDetection("start"); });
stopButton.addEventListener("click", () => { void changeDetection("stop"); });
refreshButton.addEventListener("click", () => { noticeOverride = ""; streamFailed = false; void refreshStatus({ refreshSources: true }); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshStatus(); });
window.addEventListener("pagehide", () => { pageActive = false; pollGeneration += 1; clearTimeout(pollTimer); removeStream(); });
window.addEventListener("pageshow", (event) => { pageActive = true; if (event.persisted) void poll(); });
async function poll() {
  const generation = pollGeneration;
  if (!document.hidden) await refreshStatus();
  if (generation === pollGeneration) pollTimer = setTimeout(poll, 2500);
}
void poll();
