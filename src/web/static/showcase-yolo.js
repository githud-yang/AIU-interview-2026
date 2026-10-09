/** Render shared-worker snapshots; opening this page never starts or views a camera. */
import { createYoloTransport } from "./yolo-transport.js";

export function initializeShowcaseYolo({
  document: doc = globalThis.document, window: win = globalThis.window,
  createTransport = createYoloTransport,
} = {}) {
  const ids = ["stage-yolo-source", "stage-yolo-start", "stage-yolo-stop", "stage-yolo-refresh", "stage-yolo-view", "stage-yolo-image", "stage-yolo-placeholder", "stage-yolo-status", "stage-yolo-notice", "stage-yolo-source-label", "stage-yolo-fps", "stage-yolo-frames"];
  const elements = ids.map((id) => doc.getElementById(id));
  if (elements.some((element) => !element)) return null;
  const [select, start, stop, refresh, view, image, placeholder, statusLabel, notice, sourceLabel, fps, frames] = elements;
  const placeholderDescription = placeholder.querySelector?.("p") || placeholder;
  const listeners = [];
  let sources = [];
  let state = { running: false, state: "idle" };
  let busy = false;
  let refreshing = false;
  let connected = false;
  let active = !doc.hidden;
  let destroyed = false;
  let generation = 0;
  let viewedRun = null;
  let streamAttached = false;
  let streamFailed = false;
  let actionError = "";
  let connectionError = "";
  let explicitSelection = false;
  const runKey = (snapshot) => JSON.stringify([snapshot.source || "", snapshot.started_at || ""]);
  const validSnapshot = (snapshot) => snapshot && typeof snapshot.running === "boolean" && typeof snapshot.state === "string";
  const current = (token) => !destroyed && active && !doc.hidden && token === generation;
  const transport = createTransport({ onStatus: receiveStatus, onError: showConnectionError });

  function listen(element, event, handler) {
    element.addEventListener(event, handler);
    listeners.push(() => element.removeEventListener(event, handler));
  }
  function updateControls() {
    const running = state.running || state.state === "stopping";
    const selected = sources.find((source) => source.id === select.value);
    select.disabled = !active || busy || running || !sources.length;
    start.disabled = !active || busy || refreshing || running || !selected?.available;
    stop.disabled = !active || busy || refreshing || !running;
    refresh.disabled = !active || busy || refreshing;
    view.hidden = !state.running || streamAttached;
    view.disabled = !active || busy || refreshing || !connected;
    view.textContent = streamFailed ? "重新连接画面" : "查看现有画面";
    start.textContent = busy ? "处理中…" : "启动检测";
  }
  function removeStream() {
    streamAttached = false;
    image.hidden = true;
    image.removeAttribute("src");
    placeholder.hidden = false;
  }
  function attachStream() {
    if (!active || doc.hidden || !connected || !state.running || streamAttached || streamFailed || viewedRun !== runKey(state)) return;
    streamAttached = true;
    placeholderDescription.textContent = "正在等待检测画面…";
    image.src = transport.streamUrl();
  }
  function render() {
    const labels = { idle: "待机", starting: "准备中", running: "检测中", stopping: "停止中", stopped: "已停止", finished: "播放完毕", error: "检测异常" };
    statusLabel.textContent = connected ? labels[state.state] || (state.running ? "检测中" : "待机") : "状态未连接";
    statusLabel.dataset.tone = !connected || state.error ? "warning" : state.running ? "success" : "neutral";
    const source = sources.find((item) => item.id === state.source);
    sourceLabel.textContent = state.source === "demo" ? "公开静态样例 · 非实时画面" : state.source_label || source?.label || "尚未启动";
    image.alt = state.source === "demo" ? "YOLO 公开静态样例检测结果（非实时画面）" : `YOLO ${state.source_label || source?.label || "目标"}检测画面`;
    fps.textContent = typeof state.fps === "number" && Number.isFinite(state.fps) ? `${state.fps.toFixed(1)} fps` : "—";
    frames.textContent = typeof state.frame_count === "number" && Number.isFinite(state.frame_count) ? state.frame_count.toLocaleString("zh-CN") : "—";
    const selected = sources.find((item) => item.id === select.value);
    const selectedHelp = selected?.available === false ? selected.msg || "当前来源不可用，请选择其他来源或检查服务配置。" : selected?.id === "camera" ? "点击启动后将使用运行应用的电脑摄像头。" : "默认使用公开静态样例；选择来源后点击“启动检测”。";
    const liveHelp = viewedRun === runKey(state) ? state.msg || "检测正在运行。" : "检测服务已在运行。点击“查看现有画面”后，本页才会连接画面。";
    const streamError = streamFailed ? "画面连接中断。点击“刷新状态”或“重新连接画面”再试；检测服务可能仍在运行。" : "";
    notice.textContent = actionError || connectionError || state.error || streamError || state.warning || (state.running ? liveHelp : selectedHelp);
    notice.classList.toggle("notice-error", Boolean(actionError || connectionError || state.error || streamError));
    if (state.running) {
      attachStream();
      // MJPEG may not fire load until it closes; processed frames can reveal the authorized stream.
      if (streamAttached && !streamFailed && Number(state.frame_count) > 0) {
        image.hidden = false;
        placeholder.hidden = true;
      } else if (!streamAttached) {
        placeholderDescription.textContent = streamFailed ? "画面连接中断，请手动重连" : "检测正在运行，点击“查看现有画面”连接";
      }
    } else {
      removeStream();
      placeholderDescription.textContent = state.error ? "检测未能继续，请查看提示后重试" : state.state === "finished" ? "视频播放完毕，可重新启动" : "选择来源，点击“启动检测”显示画面";
    }
    updateControls();
  }
  function receiveStatus(next) {
    if (!active || doc.hidden || destroyed) return;
    if (!validSnapshot(next)) {
      showConnectionError(new Error("服务返回了无效的检测状态，请刷新重试"));
      return;
    }
    const changedRun = runKey(next) !== runKey(state);
    if (changedRun || !next.running) {
      removeStream();
      viewedRun = null;
      streamFailed = false;
    }
    state = next;
    connected = true;
    connectionError = "";
    render();
  }
  function showConnectionError(error) {
    if (!active || doc.hidden || destroyed) return;
    connected = false;
    connectionError = `${error?.message || "无法读取检测状态"}。可点击“刷新状态”重试。`;
    if (streamAttached) streamFailed = true;
    removeStream();
    render();
  }
  async function loadSources(token) {
    const response = await transport.getSources();
    if (!current(token)) return;
    if (!Array.isArray(response?.sources) || response.sources.some((source) => !source || typeof source.id !== "string" || typeof source.label !== "string" || typeof source.available !== "boolean")) {
      throw new Error("服务未返回有效的画面来源");
    }
    const previous = select.value;
    sources = response.sources;
    select.replaceChildren();
    for (const source of sources) {
      const option = doc.createElement("option");
      option.value = source.id;
      option.textContent = `${source.label}${source.available ? "" : "（不可用）"}`;
      option.disabled = !source.available;
      select.appendChild(option);
    }
    // Keep an explicit selection; a server camera default never replaces the public demo.
    const desired = (explicitSelection && sources.find((source) => source.id === previous)) || sources.find((source) => source.id === "demo") || sources.find((source) => source.available && source.id !== "camera") || sources.find((source) => source.available);
    if (desired) select.value = desired.id;
    render();
  }
  async function refreshStatus({ reconnectImage = false } = {}) {
    if (!active || doc.hidden || destroyed || refreshing || busy) return;
    const token = generation;
    refreshing = true;
    actionError = "";
    if (reconnectImage) streamFailed = false;
    updateControls();
    transport.start();
    // Source discovery and status are independent reads; a source error must not hide an active worker.
    const results = await Promise.allSettled([loadSources(token), transport.refresh()]);
    if (!current(token)) return;
    const failed = results.find((result) => result.status === "rejected");
    if (failed) {
      actionError = `${failed.reason?.message || "无法刷新检测来源"}。请检查服务后再次刷新。`;
    }
    refreshing = false;
    render();
  }
  async function changeDetection(action) {
    if (!active || doc.hidden || destroyed || busy || refreshing) return;
    if (action === "start" && (state.running || state.state === "stopping" || !sources.find((source) => source.id === select.value)?.available)) return;
    if (action === "stop" && !state.running && state.state !== "stopping") return;
    const token = generation;
    const selected = select.value;
    busy = true;
    actionError = "";
    notice.textContent = action === "start" ? "正在启动检测，请稍候…" : "正在停止共享检测，请稍候…";
    notice.classList.remove("notice-error");
    updateControls();
    try {
      const result = action === "start" ? await transport.startDetection(selected) : await transport.stopDetection();
      if (!current(token)) return;
      if (!validSnapshot(result)) throw new Error("服务未返回有效操作状态，请刷新确认结果");
      receiveStatus(result);
      if (!result.ok) {
        actionError = result.msg || result.error || "操作未完成，请检查提示后重试";
      } else if (action === "start" && result.running && result.source === selected) {
        viewedRun = runKey(result);
        streamFailed = false;
      }
      await transport.refresh();
    } catch (error) {
      if (current(token)) actionError = `${error?.message || "检测操作未完成"}。可刷新确认状态后重试。`;
    } finally {
      busy = false;
      if (current(token)) render();
      else if (!destroyed) {
        updateControls();
        if (active && !doc.hidden) void refreshStatus();
      }
    }
  }
  function pause() {
    if (destroyed) return;
    active = false;
    generation += 1;
    refreshing = false;
    connected = false;
    viewedRun = null;
    streamFailed = false;
    transport.close();
    removeStream();
    updateControls();
  }
  function resume() {
    if (destroyed || doc.hidden || active) return;
    active = true;
    transport.start();
    void refreshStatus();
  }

  listen(select, "change", () => { explicitSelection = true; render(); });
  listen(start, "click", () => { void changeDetection("start"); });
  listen(stop, "click", () => { void changeDetection("stop"); });
  listen(refresh, "click", () => { void refreshStatus({ reconnectImage: true }); });
  listen(view, "click", () => {
    if (!active || doc.hidden || busy || refreshing || !connected || !state.running) return;
    viewedRun = runKey(state);
    streamFailed = false;
    actionError = "";
    render();
  });
  listen(image, "load", () => {
    if (!active || doc.hidden || !streamAttached || !state.running || viewedRun !== runKey(state)) return;
    image.hidden = false;
    placeholder.hidden = true;
  });
  listen(image, "error", () => {
    if (!streamAttached || !state.running) return;
    streamFailed = true;
    removeStream();
    render();
  });
  listen(doc, "visibilitychange", () => { if (doc.hidden) pause(); else resume(); });
  listen(win, "pagehide", pause);
  listen(win, "pageshow", resume);
  render();
  if (active) void refreshStatus();
  return {
    destroy() {
      pause();
      destroyed = true;
      listeners.forEach((remove) => remove());
    },
  };
}
