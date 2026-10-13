/** Start on entering YOLO; serialize source changes and release only this page's run. */
import { createYoloTransport } from "./yolo-transport.js?v=stage-live-20261013-c";

/** Observe the useful middle of the viewport, including sections taller than a screen. */
export function observeYoloSection(section, onChange, { window: win, document: doc } = {}) {
  if (!section) return () => {};
  const update = () => {
    const box = section.getBoundingClientRect();
    const header = doc.querySelector?.(".site-header")?.getBoundingClientRect().bottom || 0;
    const upper = Math.max(header + 24, win.innerHeight * 0.16);
    const lower = win.innerHeight * 0.6;
    onChange(box.top < lower && box.bottom > upper);
  };
  let observer = null;
  if (typeof win.IntersectionObserver === "function") {
    observer = new win.IntersectionObserver(update, { rootMargin: "-16% 0px -40% 0px", threshold: 0 });
    observer.observe(section);
  }
  for (const event of ["scroll", "resize", "hashchange", "pageshow"]) win.addEventListener(event, update, { passive: true });
  update();
  return () => {
    observer?.disconnect();
    for (const event of ["scroll", "resize", "hashchange", "pageshow"]) win.removeEventListener(event, update);
  };
}

export function initializeShowcaseYolo({
  document: doc = globalThis.document, window: win = globalThis.window,
  section = doc.getElementById("yolo"), observeSection = observeYoloSection,
  createTransport = createYoloTransport, controlIds = {}, onSnapshot = () => {},
} = {}) {
  const ids = ["stage-yolo-source", "stage-yolo-start", "stage-yolo-stop", "stage-yolo-refresh", "stage-yolo-view", "stage-yolo-image", "stage-yolo-placeholder", "stage-yolo-status", "stage-yolo-notice", "stage-yolo-source-label", "stage-yolo-fps", "stage-yolo-frames"];
  const elements = ids.map((id) => doc.getElementById(controlIds[id] || id));
  if (elements.some((element) => !element)) return null;
  const [select, start, stop, refresh, view, image, placeholder, statusLabel, notice, sourceLabel, fps, frames] = elements;
  const placeholderDescription = placeholder.querySelector?.("p") || placeholder;
  const listeners = [];
  let sources = [];
  let state = { running: false, state: "idle" };
  let active = !doc.hidden;
  let visible = false;
  let destroyed = false;
  let tearingDown = false;
  let connected = false;
  let refreshing = false;
  let busy = false;
  let generation = 0;
  let statusVersion = 0;
  let intentVersion = 0;
  let intent = null;
  let autoSuppressed = false;
  let ownRun = null;
  let viewedRun = null;
  let streamAttached = false;
  let streamFailed = false;
  let actionError = "";
  let connectionError = "";
  let explicitSelection = false;
  const runKey = (snapshot) => JSON.stringify([snapshot.source || "", snapshot.started_at || ""]);
  const validSnapshot = (snapshot) => snapshot && typeof snapshot.running === "boolean" && typeof snapshot.state === "string";
  const running = () => state.running || state.state === "stopping";
  const current = (token) => !destroyed && active && !doc.hidden && token === generation;
  const transport = createTransport({ onStatus: receiveStatus, onError: showConnectionError });

  function listen(element, event, handler) {
    element.addEventListener(event, handler);
    listeners.push(() => element.removeEventListener(event, handler));
  }
  function updateControls() {
    const selected = sources.find((source) => source.id === select.value);
    // Source selection stays usable during switching: the last selection wins.
    select.disabled = !active || !sources.length;
    start.disabled = !active || busy || refreshing || running() || !selected?.available;
    stop.disabled = !active || (!busy && !running());
    refresh.disabled = !active || busy || refreshing;
    view.hidden = !state.running || streamAttached;
    view.disabled = !active || busy || refreshing || !connected;
    view.textContent = streamFailed ? "重新连接画面" : "连接已有画面";
    start.textContent = busy ? "切换中…" : "启动检测";
  }
  function removeStream() {
    streamAttached = false;
    image.hidden = true;
    image.removeAttribute("src");
    placeholder.hidden = false;
  }
  function attachStream() {
    if (!active || !visible || doc.hidden || !connected || !state.running || streamAttached || streamFailed || viewedRun !== runKey(state)) return;
    streamAttached = true;
    placeholderDescription.textContent = "正在等待实时检测画面…";
    image.src = transport.streamUrl();
  }
  function render() {
    if (destroyed) return;
    const labels = { idle: "待机", starting: "准备中", running: "检测中", stopping: "停止中", stopped: "已停止", finished: "播放完毕", error: "检测异常" };
    statusLabel.textContent = connected ? labels[state.state] || (state.running ? "检测中" : "待机") : "状态未连接";
    statusLabel.dataset.tone = !connected || state.error ? "warning" : state.running ? "success" : "neutral";
    const source = sources.find((item) => item.id === state.source);
    sourceLabel.textContent = state.source_label || source?.label || "尚未启动";
    image.alt = `YOLO ${state.source_label || source?.label || "目标"}实时检测画面`;
    fps.textContent = typeof state.fps === "number" && Number.isFinite(state.fps) ? `${state.fps.toFixed(1)} fps` : "—";
    frames.textContent = typeof state.frame_count === "number" && Number.isFinite(state.frame_count) ? state.frame_count.toLocaleString("zh-CN") : "—";
    const selected = sources.find((item) => item.id === select.value);
    const selectedHelp = selected?.available === false ? selected.msg || "当前来源不可用，请选择其他来源或检查服务配置。" : autoSuppressed ? "检测已暂停。点击“启动检测”恢复，或直接切换输入源。" : visible ? "进入本区自动启动摄像头；切换输入源会自动启动对应检测。" : "进入 YOLO 展示区后自动启动摄像头。";
    const liveHelp = viewedRun === runKey(state) ? state.msg || "逐帧检测正在运行。切换输入源后自动重新启动。" : "检测服务已有其他页面的运行。可连接已有画面，或切换输入源启动本次展示。";
    const streamError = streamFailed ? "画面连接中断。点击“刷新状态”或“重新连接画面”再试。" : "";
    notice.textContent = actionError || connectionError || state.error || streamError || state.warning || (busy ? "正在切换输入源并启动实时检测…" : state.running ? liveHelp : selectedHelp);
    notice.classList.toggle("notice-error", Boolean(actionError || connectionError || state.error || streamError));
    if (state.running) {
      attachStream();
      if (streamAttached && !streamFailed && Number(state.frame_count) > 0) {
        image.hidden = false;
        placeholder.hidden = true;
      } else if (!streamAttached) placeholderDescription.textContent = streamFailed ? "画面连接中断，请重新连接" : busy ? "正在切换实时画面…" : "检测正在运行，可连接已有画面";
    } else {
      removeStream();
      placeholderDescription.textContent = state.error ? "检测未能继续，请查看提示后重试" : state.state === "finished" ? "视频播放完毕，可重新启动" : autoSuppressed ? "检测已停止，可再次启动或切换输入源" : "进入本区自动启动；选择案例会切换到实时推理";
    }
    updateControls();
  }
  function receiveStatus(next) {
    if (destroyed) return;
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
    if (ownRun && ownRun.key !== runKey(next)) ownRun = null;
    state = next;
    statusVersion += 1;
    connected = true;
    connectionError = "";
    onSnapshot(next);
    render();
  }
  function showConnectionError(error) {
    if (destroyed) return;
    connected = false;
    connectionError = `${error?.message || "无法读取检测状态"}。可点击“刷新状态”重试。`;
    if (streamAttached) streamFailed = true;
    removeStream();
    render();
  }
  async function loadSources(token) {
    const response = await transport.getSources();
    if (!current(token)) return;
    if (!Array.isArray(response?.sources) || response.sources.some((source) => !source || typeof source.id !== "string" || typeof source.label !== "string" || typeof source.available !== "boolean")) throw new Error("服务未返回有效的画面来源");
    const previous = select.value;
    sources = response.sources.filter((source) => source.id !== "video" || source.available);
    select.replaceChildren();
    for (const source of sources) {
      const option = doc.createElement("option");
      option.value = source.id;
      option.textContent = `${source.label}${source.available ? "" : "（不可用）"}`;
      option.disabled = !source.available;
      select.appendChild(option);
    }
    const desired = sources.find((source) => source.id === (explicitSelection ? previous : "camera")) || sources[0];
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
    const results = await Promise.allSettled([loadSources(token), transport.refresh()]);
    if (!current(token)) return;
    const failed = results.find((result) => result.status === "rejected");
    if (failed) actionError = `${failed.reason?.message || "无法刷新检测来源"}。请检查服务后再次刷新。`;
    refreshing = false;
    if (visible && !autoSuppressed && !intent && !state.running) requestIntent(select.value, false);
    render();
    void processIntent();
  }
  function requestIntent(source, explicit, releaseOnly = false) {
    intent = { source, explicit, releaseOnly, version: ++intentVersion };
    if (source !== null) { actionError = ""; streamFailed = false; }
    viewedRun = null;
    removeStream();
    void processIntent();
  }
  function acceptCommand(result, beforeVersion) {
    if (!validSnapshot(result)) throw new Error("服务未返回有效操作状态，请刷新确认结果");
    // A newer pushed replacement must not be overwritten by an older command reply.
    if (statusVersion !== beforeVersion && state.running && runKey(state) !== runKey(result)) return;
    receiveStatus(result);
  }
  function failIntent(request, message) {
    if (intent?.version !== request.version) return;
    actionError = `${message || "检测操作未完成"}。可点击“启动检测”或“刷新状态”重试。`;
    autoSuppressed = true;
    if (intent?.version === request.version) intent = null;
  }
  async function processIntent() {
    if (busy || refreshing || destroyed || !intent) return;
    if (intent.source !== null && (!active || doc.hidden || !visible || !sources.length || !connected)) return;
    busy = true;
    render();
    try {
      while (intent && !destroyed) {
        const request = intent;
        if (request.source !== null && (!active || doc.hidden || !visible)) { intent = null; break; }
        // Navigation cleanup sends the atomic conditional stop immediately;
        // other commands first refresh the shared worker's current state.
        if (!request.releaseOnly) {
          transport.start();
          await transport.refresh();
        }
        if (!intent || intent.version !== request.version) continue;
        if (!connected) { failIntent(request, "无法确认当前检测状态"); break; }
        if (request.source !== null && !sources.find((item) => item.id === request.source)?.available) {
          failIntent(request, sources.find((item) => item.id === request.source)?.msg || "所选输入源不可用");
          break;
        }
        if (request.releaseOnly && (!ownRun || ownRun.key !== runKey(state))) { intent = null; break; }
        if (state.running && request.source === state.source) {
          if (ownRun?.key === runKey(state)) viewedRun = ownRun.key;
          // Entering a section never takes ownership of another client's worker.
          intent = null;
          break;
        }
        if (running()) {
          if (!request.explicit && request.source !== null && ownRun?.key !== runKey(state)) { intent = null; break; }
          const beforeVersion = statusVersion;
          const result = await transport.stopDetection(state.started_at);
          acceptCommand(result, beforeVersion);
          if (!result.ok || running()) { failIntent(request, result.msg || result.error || "未能释放当前输入源"); break; }
          ownRun = null;
          viewedRun = null;
          // A newer choice can arrive during Stop; do not start the old choice.
          if (intent?.version !== request.version) continue;
        }
        if (request.source === null) { intent = null; break; }
        const beforeVersion = statusVersion;
        const previousRun = runKey(state);
        const result = await transport.startDetection(request.source);
        acceptCommand(result, beforeVersion);
        const created = result.created === true;
        if (result.ok && result.running && result.source === request.source && created && runKey(result) !== previousRun && runKey(state) === runKey(result)) ownRun = { key: runKey(result), startedAt: result.started_at };
        if (!result.ok || !result.running || result.source !== request.source) {
          failIntent(request, result.msg || result.error || "输入源未能启动");
          if (intent) continue;
          break;
        }
        if (intent?.version !== request.version) continue;
        if (ownRun?.key === runKey(state)) viewedRun = ownRun.key;
        intent = null;
      }
    } catch (error) {
      if (intent) failIntent(intent, error?.message || "检测操作未完成");
    } finally {
      busy = false;
      if (!active) transport.close();
      if (tearingDown) { destroyed = true; transport.close(); return; }
      render();
      if (intent && !destroyed) void processIntent();
    }
  }
  function setSectionVisible(next) {
    if (destroyed || next === visible) return;
    visible = next;
    if (visible) {
      autoSuppressed = false;
      if (active && !doc.hidden) requestIntent(select.value || "camera", false);
    } else {
      viewedRun = null;
      requestIntent(null, false, true);
    }
    render();
  }
  function pause() {
    if (destroyed || !active) return;
    active = false;
    generation += 1;
    refreshing = false;
    viewedRun = null;
    streamFailed = false;
    requestIntent(null, false, true);
    if (!busy) transport.close();
    removeStream();
    updateControls();
  }
  function resume() {
    if (destroyed || doc.hidden || active) return;
    active = true;
    transport.start();
    if (visible && !autoSuppressed) requestIntent(select.value || "camera", false);
    void refreshStatus();
  }

  listen(select, "change", () => {
    explicitSelection = true;
    autoSuppressed = false;
    if (visible && active && !doc.hidden) requestIntent(select.value, true);
    render();
  });
  listen(start, "click", () => {
    if (!active || doc.hidden || !visible || busy || refreshing) return;
    autoSuppressed = false;
    requestIntent(select.value, true);
  });
  listen(stop, "click", () => {
    if (!active || doc.hidden || (!busy && !running())) return;
    autoSuppressed = true;
    requestIntent(null, true);
  });
  listen(refresh, "click", () => { void refreshStatus({ reconnectImage: true }); });
  listen(view, "click", () => {
    if (!active || !visible || doc.hidden || busy || refreshing || !connected || !state.running) return;
    viewedRun = runKey(state);
    streamFailed = false;
    actionError = "";
    render();
  });
  listen(image, "load", () => {
    if (!active || !visible || doc.hidden || !streamAttached || !state.running || viewedRun !== runKey(state)) return;
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
  const stopObserving = observeSection(section, setSectionVisible, { window: win, document: doc });
  render();
  if (active) void refreshStatus();
  return {
    setSectionVisible,
    destroy() {
      stopObserving?.();
      listeners.forEach((remove) => remove());
      tearingDown = true;
      pause();
      // Let an in-flight Start finish and release its owned run before teardown.
      if (!busy) { destroyed = true; transport.close(); }
    },
  };
}
