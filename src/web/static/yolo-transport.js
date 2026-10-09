/** Own YOLO commands and state subscriptions; the page only renders snapshots. */
import { getYoloSources, getYoloStatus, startYolo, stopYolo, getYoloStreamUrl } from "./api.js";

export function createYoloTransport({
  onStatus, onError = () => {},
  EventSourceImpl = globalThis.EventSource,
  readSources = getYoloSources, readStatus = getYoloStatus,
  requestStart = startYolo, requestStop = stopYolo, imageUrl = getYoloStreamUrl,
  setTimer = setTimeout, clearTimer = clearTimeout,
  pollInterval = 2500, reconnectDelay = 2000,
} = {}) {
  let active = false;
  let generation = 0;
  let source = null;
  let timer = null;
  let pending = null;
  let pendingGeneration = -1;
  let statusVersion = 0;

  const current = (token) => active && token === generation;
  function publish(status, token) {
    if (!current(token)) return;
    if (!status || Array.isArray(status) || typeof status !== "object"
        || typeof status.running !== "boolean" || typeof status.state !== "string") {
      throw new Error("服务返回了无效的检测状态");
    }
    onStatus(status);
  }
  function report(error, token) {
    if (current(token)) onError(error instanceof Error ? error : new Error("检测状态连接中断，正在重新连接"));
  }
  function clearSubscription() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (source) source.close();
    source = null;
  }
  function schedule(fn, delay, token) {
    if (!current(token)) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; if (current(token)) fn(); }, delay);
  }
  async function refresh() {
    if (!active) return;
    const token = generation;
    if (pending && pendingGeneration === token) return pending;
    pendingGeneration = token;
    const version = statusVersion;
    const request = (async () => {
      try {
        const status = await readStatus();
        if (version === statusVersion) publish(status, token);
      }
      catch (error) { if (version === statusVersion) report(error, token); }
    })();
    pending = request;
    try { await request; }
    finally { if (pending === request) pending = null; }
  }
  async function poll(token) {
    await refresh();
    schedule(() => { void poll(token); }, pollInterval, token);
  }
  function openEvents(token) {
    if (!current(token)) return;
    let stream;
    try { stream = new EventSourceImpl("/yolo/events"); }
    catch (error) {
      report(error, token);
      schedule(() => openEvents(token), reconnectDelay, token);
      return;
    }
    source = stream;
    const valid = () => current(token) && source === stream;
    function reconnect(error) {
      if (!valid()) return;
      stream.close();
      source = null;
      report(error, token);
      schedule(() => openEvents(token), reconnectDelay, token);
    }
    stream.addEventListener("status", (event) => {
      if (!valid()) return;
      try {
        const status = JSON.parse(event.data);
        publish(status, token);
        statusVersion += 1;
      }
      catch (error) { reconnect(error); }
    });
    stream.onerror = () => reconnect(new Error("检测状态连接中断，正在重新连接"));
  }
  return {
    start() {
      if (active) return;
      active = true;
      const token = ++generation;
      if (typeof EventSourceImpl === "function") openEvents(token);
      else void poll(token);
    },
    close() {
      active = false;
      generation += 1;
      clearSubscription();
    },
    refresh,
    getSources: () => readSources(),
    async startDetection(selected) {
      const result = await requestStart(selected);
      statusVersion += 1;
      pending = null;
      return result;
    },
    async stopDetection() {
      const result = await requestStop();
      statusVersion += 1;
      pending = null;
      return result;
    },
    streamUrl: () => imageUrl(),
  };
}
