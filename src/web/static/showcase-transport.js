/** Own the showcase's read-only HTTP boundary; no polling, model execution or credentials are stored. */

const string = (value) => typeof value === "string";
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const stringList = (value) => Array.isArray(value) && value.every(string);
const evidenceItem = (item) => record(item) && string(item.label) && string(item.id)
  && item.id.length > 0 && ["text", "image"].includes(item.kind)
  && (item.available === undefined || typeof item.available === "boolean");
const actionItem = (item) => record(item) && string(item.label) && string(item.href);

export function validateShowcaseSnapshot(value) {
  if (!record(value) || !string(value.title) || !string(value.verdict)
      || !string(value.checkedDate) || !stringList(value.checklist)
      || !Array.isArray(value.cards) || value.cards.length === 0
      || !value.cards.every((card) => record(card)
        && ["id", "title", "category", "status", "summary", "limitation"].every((key) => string(card[key]))
        && card.id.length > 0 && stringList(card.proof) && stringList(card.talk)
        && Array.isArray(card.actions) && card.actions.every(actionItem)
        && Array.isArray(card.evidence) && card.evidence.every(evidenceItem))
      || new Set(value.cards.map((card) => card.id)).size !== value.cards.length) {
    throw new Error("展示清单格式不完整，请刷新后重试。");
  }
  return value;
}

export function validatePreflightSnapshot(value) {
  if (!record(value) || !string(value.checkedAt) || !string(value.note)
      || !Array.isArray(value.services) || !value.services.every((service) => record(service)
        && string(service.id) && string(service.label) && string(service.detail)
        && typeof service.available === "boolean")) {
    throw new Error("连接检查结果格式不完整，请重新检查。");
  }
  return value;
}

export function validateStageResearchSnapshot(value) {
  const artifactIds = new Set(["report", "table", "figure", "pdf"]);
  if (!record(value) || typeof value.available !== "boolean"
      || !["title", "runId", "status", "source", "summary", "limitation"].every((key) => string(value[key]))
      || !Array.isArray(value.metrics) || !value.metrics.every((item) => record(item) && string(item.label) && string(item.value))
      || !Array.isArray(value.stages) || !value.stages.every((item) => record(item) && string(item.id) && string(item.label) && string(item.status))
      || !Array.isArray(value.comparison) || !Array.isArray(value.artifacts)
      || !value.artifacts.every((item) => record(item) && artifactIds.has(item.id) && string(item.label)
        && ["html", "text", "image", "pdf"].includes(item.kind) && typeof item.available === "boolean"
        && item.href === `/api/showcase/research/files/${item.id}`)) {
    throw new Error("保存的研究记录格式不完整，请重新读取。");
  }
  return value;
}

export function createShowcaseTransport({
  fetchImpl = globalThis.fetch,
  requestTimeout = 15000,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  const pending = new Set();

  async function read(path, { text = false, signal } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimer(() => { timedOut = true; controller.abort(); }, requestTimeout);
    pending.add(controller);
    try {
      const response = await fetchImpl(path, {
        method: "GET", credentials: "same-origin", cache: "no-store",
        headers: { Accept: text ? "text/plain, application/json;q=0.9" : "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}），请确认本机服务正在运行。`);
      return text ? await response.text() : await response.json();
    } catch (error) {
      if (timedOut) throw new Error("读取超时，请确认本机服务状态后重试。");
      if (error?.name === "AbortError") throw error;
      if (error instanceof SyntaxError) throw new Error("服务返回的内容无法读取，请刷新后重试。");
      if (error instanceof TypeError) throw new Error("暂时无法连接本机服务，请确认服务已启动。");
      throw error;
    } finally {
      clearTimer(timer);
      pending.delete(controller);
      signal?.removeEventListener("abort", abort);
    }
  }

  function evidenceUrl(id) {
    if (!string(id) || id.length === 0) throw new Error("证据编号无效。");
    return `/api/showcase/files/${encodeURIComponent(id)}`;
  }

  return {
    async getShowcase() { return validateShowcaseSnapshot(await read("/api/showcase")); },
    async getPreflight() { return validatePreflightSnapshot(await read("/api/showcase/preflight")); },
    async getStageResearch() { return validateStageResearchSnapshot(await read("/api/showcase/research")); },
    getStageResearchText: (id, options = {}) => {
      if (id !== "table") throw new Error("未登记的表格编号。");
      return read("/api/showcase/research/files/table", { ...options, text: true });
    },
    evidenceUrl,
    getEvidenceText: (id, options = {}) => read(evidenceUrl(id), { ...options, text: true }),
    close() { for (const controller of pending) controller.abort(); },
  };
}
