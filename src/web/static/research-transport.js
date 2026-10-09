/** Research HTTP commands and one resumable SSE subscription; no DOM access. */
export function createResearchTransport(dependencies = {}) {
  const fetcher = dependencies.fetch || globalThis.fetch.bind(globalThis);
  const schedule = dependencies.setTimeout || globalThis.setTimeout;
  const unschedule = dependencies.clearTimeout || globalThis.clearTimeout;
  const EventSourceType = Object.hasOwn(dependencies, "EventSource") ? dependencies.EventSource : globalThis.EventSource;
  let stopCurrent = () => {};

  async function request(path, options = {}, timeoutMS = 15000) {
    const controller = new AbortController();
    const timeout = schedule(() => controller.abort(), timeoutMS);
    let response;
    try {
      response = await fetcher(path, { ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }, signal: controller.signal, cache: "no-store" });
    } catch (error) {
      const failure = new Error(error?.name === "AbortError" ? "服务响应超时，请重新连接确认运行状态。" : "无法连接服务，请检查网络和后台服务。");
      failure.uncertain = Boolean(options.method && options.method !== "GET");
      throw failure;
    } finally { unschedule(timeout); }
    let data;
    try { data = await response.json(); }
    catch {
      const failure = new Error("服务返回了无法读取的响应，请重新连接确认运行状态。");
      failure.uncertain = Boolean(options.method && options.method !== "GET");
      throw failure;
    }
    if (!response.ok) {
      const detail = typeof data.detail === "string" ? data.detail : (data.error || (Array.isArray(data.detail) ? data.detail.map((issue) => issue.msg || JSON.stringify(issue)).join("；") : null));
      const failure = new Error(detail || `请求失败（HTTP ${response.status}）`);
      failure.status = response.status;
      failure.uncertain = response.status >= 500 && Boolean(options.method && options.method !== "GET");
      throw failure;
    }
    if (!data || typeof data !== "object") throw new Error("服务返回的数据格式无效。");
    return data;
  }

  async function readRun(runID, afterSeq = 0) {
    const path = `/api/research/runs/${encodeURIComponent(runID)}`;
    const run = await request(path);
    const events = await request(`${path}/events?after_seq=${afterSeq}`);
    return { run, events };
  }

  function subscribe({ runID, afterSeq = 0, initialRun = null, initialDelay = 2500,
    onRun = () => {}, onEvents = () => {}, onConnection = () => {}, onError = () => {},
    onFallback = () => {}, onCycle = async () => {} }) {
    stopCurrent();
    let closed = false;
    let source = null;
    let timer = null;
    let cursor = afterSeq;
    let current = initialRun;
    let fallback = false;
    let busy = false;
    const stop = () => {
      closed = true;
      source?.close();
      source = null;
      if (timer !== null) unschedule(timer);
      timer = null;
    };
    stopCurrent = stop;
    const deliverEvents = (batch) => {
      if (!Array.isArray(batch.events) || !Number.isSafeInteger(batch.last_seq) || batch.last_seq < cursor) throw new Error("事件订阅返回了无效游标。");
      cursor = batch.last_seq;
      onEvents(batch);
    };
    const queue = (delay) => {
      if (closed) return;
      if (timer !== null) unschedule(timer);
      timer = schedule(() => { timer = null; void query(); }, delay);
    };
    const query = async () => {
      if (closed || busy) return;
      busy = true;
      let failed = false;
      try {
        const data = await readRun(runID, cursor);
        if (closed) return;
        if (data.run.id !== runID) throw new Error("服务返回了其他研究的记录。");
        current = data.run;
        onConnection(true);
        onRun(current);
        deliverEvents(data.events);
        await onCycle();
      } catch (error) {
        if (closed) return;
        failed = true;
        onConnection(false);
        onError(error);
      } finally {
        busy = false;
        if (!closed) queue(failed ? 7000 : ["queued", "running", "cancelling"].includes(current?.status) ? 2500 : 10000);
      }
    };
    const useFallback = (message) => {
      if (closed || fallback) return;
      fallback = true;
      source?.close();
      source = null;
      onFallback(message);
      queue(initialDelay);
    };
    if (typeof EventSourceType !== "function") {
      useFallback("当前浏览器未提供服务推送，已切换为兼容查询模式。");
      return stop;
    }
    const decode = (event, accept) => {
      if (closed || fallback) return;
      try { accept(JSON.parse(event.data)); }
      catch (error) {
        onError(new Error(`研究订阅数据无法读取：${error.message}`));
        useFallback("服务推送的数据格式异常，已切换为兼容查询模式。");
      }
    };
    try {
      source = new EventSourceType(`/api/research/runs/${encodeURIComponent(runID)}/stream?after_seq=${cursor}`);
      source.addEventListener("open", () => { if (!closed && !fallback) onConnection(true); });
      source.addEventListener("snapshot", (event) => decode(event, (data) => {
        if (!data.run || data.run.id !== runID) throw new Error("运行编号不匹配");
        current = data.run;
        onConnection(true);
        onRun(current);
      }));
      source.addEventListener("state", (event) => decode(event, (data) => {
        if (!current || data.run_id !== runID || !data.changes || typeof data.changes !== "object" || Array.isArray(data.changes) || !Array.isArray(data.removed)) throw new Error("状态变更格式无效");
        const next = { ...current, ...data.changes };
        for (const field of data.removed) delete next[field];
        if (next.id !== runID) throw new Error("运行编号不匹配");
        current = next;
        onConnection(true);
        onRun(current);
      }));
      source.addEventListener("events", (event) => decode(event, deliverEvents));
      source.addEventListener("unavailable", (event) => decode(event, (data) => {
        onConnection(false);
        onError(new Error(data.message || "研究订阅已不可用，请刷新工作台。"));
        stop();
      }));
      source.addEventListener("error", () => {
        if (closed || fallback) return;
        onConnection(false);
        onError(new Error("服务推送连接中断，正在自动重连；后台研究可能仍在执行。"));
        // CONNECTING means native EventSource will reconnect with Last-Event-ID.
        if (source?.readyState === 2) useFallback("服务推送暂不可用，已切换为兼容查询模式。");
      });
    } catch {
      useFallback("服务推送无法建立，已切换为兼容查询模式。");
    }
    return stop;
  }

  return { request, readRun, subscribe, stop: () => stopCurrent() };
}
