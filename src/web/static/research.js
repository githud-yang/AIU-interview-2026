const STORAGE_KEY = "aiu.research.workspace.v1";
const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling"]);
const RESUMABLE_STATUSES = new Set(["interrupted", "failed", "needs_input"]);
const STATUS_LABELS = {
  queued: "等待执行", running: "正在研究", cancelling: "正在取消", completed: "流程已完成",
  failed: "执行失败", cancelled: "已取消", interrupted: "运行已中断", needs_input: "需要补充条件",
  pending: "待执行", succeeded: "已完成", blocked: "受阻", unsupported: "未接入", skipped: "已跳过",
};
const QUALITY_LABELS = {
  candidate_only: "候选稿 · 未经外评", unverified: "质量未验证", not_evaluated: "未评定",
  internal_pass: "内部检查通过", external_pass: "外部评审通过", failed: "未通过内部检查",
  candidate_report_novelty_unverified: "候选稿 · 创新待验证",
};
const DOMAIN_COPY = {
  digits_robustness: { label: "手写数字分类与抗干扰", description: "当前可研究手写数字在噪声干扰下的识别效果与准确率变化。" },
};

export function safeURL(value, baseURL, { artifact = false } = {}) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, baseURL);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (artifact && (url.origin !== new URL(baseURL).origin || !url.pathname.startsWith("/api/research/"))) return null;
    return url.href;
  } catch { return null; }
}

function asText(value, fallback = "—") {
  if (value === undefined || value === null || value === "") return fallback;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
function listFrom(value, keys) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of keys) if (Array.isArray(value[key])) return value[key];
  return [];
}
function stamp(value, { timeOnly = false } = {}) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", timeOnly ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false } : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
function sizeLabel(value) {
  if (!Number.isFinite(value) || value < 0) return "大小未提供";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function configuredLimit(value, minimum = 0) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : null;
}
function domainDescription(domain) {
  return DOMAIN_COPY[domain?.id]?.description || domain?.description || "系统根据已接入的工具和资源安排研究步骤。";
}

export function createResearchApp(dependencies = {}) {
  const doc = dependencies.document || globalThis.document;
  const win = dependencies.window || globalThis.window;
  const fetcher = dependencies.fetch || globalThis.fetch.bind(globalThis);
  let storage = dependencies.storage;
  if (!storage) {
    try { storage = win.localStorage; }
    catch { storage = { getItem() { return null; }, setItem() { throw new Error("Storage unavailable"); } }; }
  }
  const schedule = dependencies.setTimeout || globalThis.setTimeout;
  const unschedule = dependencies.clearTimeout || globalThis.clearTimeout;
  const uuid = dependencies.uuid || (() => globalThis.crypto.randomUUID());
  const baseURL = dependencies.baseURL || win.location.href;
  const el = (id) => doc.getElementById(id);
  const state = {
    capabilities: null, run: null, pending: null, savedRunID: null,
    mutation: false, refreshPromise: null, pollBusy: false, timer: null, paused: false,
    generation: 0, events: [], lastSeq: 0, connected: false, initialized: false,
    writerSettings: null, writerMutation: null, writerInputDirty: false,
    writerSettingsRevision: 0, writerActionGeneration: 0, writerSettingsLoadFailed: false,
  };

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = asText(text, "");
    return node;
  }
  function write(id, value, fallback = "—") { el(id).textContent = asText(value, fallback); }
  function save() {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ runID: state.savedRunID, pending: state.pending }));
    } catch {
      showNotice("浏览器未能保存恢复记录；刷新后仍可从服务端找回运行。", "warning");
    }
  }
  function load() {
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return;
      if (typeof saved.runID === "string") state.savedRunID = saved.runID;
      if (saved.pending && typeof saved.pending === "object" && typeof saved.pending.request_id === "string" && typeof saved.pending.goal === "string" && saved.pending.budget && typeof saved.pending.budget === "object") {
        state.pending = saved.pending;
        write("notice-text", "正在确认上次启动请求的实际状态，将使用原请求编号防止重复启动。");
        el("notice").hidden = false;
        el("research-goal").value = saved.pending.goal;
      }
    } catch {
      showNotice("本地恢复记录不可读取；正在查询服务端已有运行。", "warning");
    }
  }
  function showNotice(message, tone = "neutral") {
    write("notice-text", message);
    el("notice").dataset.tone = tone;
    el("notice").hidden = !message;
  }
  function showError(message) {
    write("request-error-text", message);
    el("request-error").hidden = !message;
  }
  function setConnection(connected) {
    state.connected = connected;
    write("connection-status", connected ? "服务已连接" : "连接中断");
    el("connection-status").dataset.tone = connected ? "success" : "error";
    if (!connected && state.run) write("footer-state", "连接中断 · 展示上次获取的服务端记录");
  }
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
      const detail = typeof data.detail === "string" ? data.detail : (data.error || (Array.isArray(data.detail) ? data.detail.map((issue) => issue.msg || asText(issue)).join("；") : null));
      const failure = new Error(detail || `请求失败（HTTP ${response.status}）`);
      failure.status = response.status;
      failure.uncertain = response.status >= 500 && Boolean(options.method && options.method !== "GET");
      throw failure;
    }
    if (!data || typeof data !== "object") throw new Error("服务返回的数据格式无效。");
    return data;
  }

  function updateControls() {
    const active = Boolean(state.run && ACTIVE_STATUSES.has(state.run.status));
    const ready = Boolean(state.capabilities?.execution?.available && listFrom(state.capabilities?.domains, []).length);
    el("start-btn").disabled = state.mutation || Boolean(state.writerMutation) || active || !ready || !state.connected;
    el("cancel-btn").disabled = state.mutation || !state.connected || !state.run || !["queued", "running"].includes(state.run.status);
    el("resume-btn").disabled = state.mutation || !state.connected || !state.run || !RESUMABLE_STATUSES.has(state.run.status);
    for (const id of ["research-goal", "research-domain", "budget-minutes", "budget-trials", "budget-model-calls"]) el(id).disabled = state.mutation || active || Boolean(state.pending) || (id === "research-domain" && !ready);
    write("start-label", state.mutation ? "正在处理" : state.pending ? "确认启动状态" : "启动研究");
    write("start-help", state.mutation ? "正在与服务确认，请稍候" : active ? "已有研究正在执行" : state.writerMutation ? "论文模型设置处理中，完成后可启动研究" : !ready ? "当前执行条件未就绪" : !state.connected ? "连接恢复后可以启动" : state.pending ? "沿用原请求编号，不新建重复运行" : !state.capabilities?.model?.available ? "模型暂不可用，使用预设流程并记录原因" : "自动推进至流程完成，可随时取消");
    updateWriterControls();
  }

  function updateWriterControls() {
    const settings = state.writerSettings;
    const unavailable = !state.connected || !settings || state.paused;
    const changing = Boolean(state.writerMutation);
    const running = Boolean(state.run && ACTIVE_STATUSES.has(state.run.status));
    el("writer-test-btn").disabled = unavailable || changing;
    el("writer-save-btn").disabled = unavailable || changing || state.mutation || running || settings?.busy || !settings?.editable;
    el("writer-api-key").disabled = changing;
    el("writer-model-input").disabled = changing;
    write("writer-test-btn", state.writerMutation === "test" ? "正在测试连接" : "测试连接");
    write("writer-save-btn", state.writerMutation === "save" ? "正在保存" : "保存并启用 DeepSeek");
    write("writer-edit-note", changing ? "正在与服务确认，请稍候" : unavailable ? "读取设置后可测试连接与保存" : running || settings.busy ? "研究运行中，可测试连接，完成后可保存" : !settings.editable ? "当前设置暂不可保存，可先测试连接" : "已有 Key 可留空，保留本机配置");
  }

  function writerMessage(message, tone = "neutral", secret = "") {
    let safeMessage = asText(message, "");
    for (const value of [secret, el("writer-api-key").value.trim()]) {
      if (value) safeMessage = safeMessage.split(value).join("[密钥已隐藏]");
    }
    safeMessage = safeMessage.replace(/\bsk-[a-zA-Z0-9_-]+\b/g, "[密钥已隐藏]");
    write("writer-message", safeMessage, "");
    el("writer-message").dataset.tone = tone;
    el("writer-message").hidden = !safeMessage;
  }

  function renderWriterSettings(data) {
    if (typeof data?.key_configured !== "boolean" || typeof data?.editable !== "boolean") throw new Error("服务未返回完整的论文模型设置。");
    // Keep only public metadata. API keys never enter app state or browser storage.
    const settings = {
      provider: typeof data.provider === "string" ? data.provider : "未配置",
      model: typeof data.model === "string" ? data.model : "未配置",
      key_configured: data.key_configured, editable: data.editable,
      busy: data.busy === true,
      configured_provider: typeof data.configured_provider === "string" ? data.configured_provider : "auto",
      base_url: "https://api.deepseek.com/v1",
    };
    state.writerSettings = settings;
    const current = `${settings.provider} · ${settings.model}`;
    write("writer-current-provider", current);
    write("writer-current-summary", `${current} · DeepSeek Key ${settings.key_configured ? "已配置" : "未配置"}`);
    write("writer-key-status", settings.key_configured ? "已配置（密钥不会回显）" : "未配置");
    el("writer-key-status").dataset.configured = String(settings.key_configured);
    if (!state.writerInputDirty) {
      const deepseek = settings.configured_provider === "deepseek" || settings.provider === "deepseek";
      el("writer-model-input").value = deepseek && settings.model !== "未配置" ? settings.model : "deepseek-flash";
    }
    updateWriterControls();
  }

  async function loadWriterSettings(generation = state.generation) {
    const revision = state.writerSettingsRevision;
    try {
      const settings = await request("/api/research/writer-settings");
      if (generation !== state.generation || revision !== state.writerSettingsRevision || state.paused) return;
      renderWriterSettings(settings);
      if (state.writerSettingsLoadFailed) writerMessage("");
      state.writerSettingsLoadFailed = false;
    } catch {
      if (generation !== state.generation || revision !== state.writerSettingsRevision || state.paused) return;
      state.writerSettings = null;
      state.writerSettingsLoadFailed = true;
      write("writer-current-summary", "设置暂不可用");
      write("writer-key-status", "状态未读取");
      el("writer-key-status").dataset.configured = "";
      writerMessage("暂时无法读取论文模型设置，请刷新重试。", "warning");
      updateWriterControls();
    }
  }

  async function writerAction(action, event) {
    event?.preventDefault();
    if (!["test", "save"].includes(action) || state.writerMutation || state.paused || !state.connected || !state.writerSettings) return;
    if (action === "save" && (state.mutation || ACTIVE_STATUSES.has(state.run?.status) || state.writerSettings.busy || !state.writerSettings.editable)) return;
    const apiKey = el("writer-api-key").value.trim();
    const model = el("writer-model-input").value.trim();
    if (!model) { writerMessage("请填写论文模型名称，例如 deepseek-flash。", "error"); return; }
    if (!apiKey && !state.writerSettings.key_configured) { writerMessage("请先填写 DeepSeek API Key。已有本机 Key 配置时可留空。", "error"); return; }
    state.writerMutation = action;
    const actionGeneration = state.writerActionGeneration;
    writerMessage("");
    updateControls();
    try {
      const result = await request(action === "test" ? "/api/research/writer-settings/test" : "/api/research/writer-settings", {
        method: action === "test" ? "POST" : "PUT",
        body: JSON.stringify({ api_key: apiKey || null, model }),
      }, 45000);
      if (actionGeneration !== state.writerActionGeneration || state.paused) return;
      if (result.ok !== true) throw new Error(result.message || "DeepSeek 请求未成功，请检查配置后重试。");
      if (action === "test") {
        const models = listFrom(result.available_models, []).map((value) => typeof value === "string" ? value : value?.id).filter((value) => typeof value === "string");
        el("writer-model-options").replaceChildren(...models.map((value) => {
          const option = element("option");
          option.value = value;
          return option;
        }));
        writerMessage(`${result.message || "DeepSeek 连接测试通过。"} 测试不会修改已有配置，保存后才会启用本次设置。`, "success", apiKey);
      } else {
        el("writer-api-key").value = "";
        state.writerInputDirty = false;
        state.writerSettingsRevision += 1;
        renderWriterSettings(result.settings);
        writerMessage(result.message || "已保存并启用 DeepSeek，用于后续论文写作与审阅。", "success", apiKey);
        // Wait for an older refresh before fetching the newly saved provider.
        if (state.refreshPromise) await state.refreshPromise;
        if (actionGeneration === state.writerActionGeneration && !state.paused) await refresh();
      }
    } catch (error) {
      if (actionGeneration !== state.writerActionGeneration || state.paused) return;
      writerMessage(error.uncertain && action === "save" ? "保存结果尚未确认，请刷新设置核验；不会自动重复发送。" : error.message, "error", apiKey);
    } finally {
      state.writerMutation = null;
      updateControls();
    }
  }

  function renderCapabilities(data) {
    state.capabilities = data;
    const model = data.model || {};
    const execution = data.execution || {};
    write("environment-status", execution.available ? "执行环境可用" : "执行环境未就绪");
    el("environment-dot").dataset.tone = execution.available ? "success" : "warning";
    write("environment-model", `${model.provider || "提供方未配置"} · ${model.model || "模型未配置"}${model.available ? "" : " · 当前不可用"}`);
    const writer = data.writer;
    write("environment-note", writer ? `论文：${writer.provider} · ${writer.model}${writer.available ? "" : " · 未就绪"}` : execution.detail || "读取真实执行环境状态");
    const summary = el("capability-summary");
    const dot = element("span", "status-dot");
    dot.dataset.tone = execution.available ? "success" : "warning";
    const domains = listFrom(data.domains, []);
    const availableDomains = domains.map((domain) => DOMAIN_COPY[domain.id]?.label || domain.label || domain.id).join("、");
    const parts = [execution.available ? `已接入${availableDomains || "当前研究领域"}；将自动检索文献、完成实验并生成论文与复现材料。` : "研究执行环境暂未就绪。"];
    if (!model.available) parts.push("研究规划模型暂不可用，使用预设流程时会保留记录。");
    if (writer && !writer.available) parts.push("论文模型暂不可用，稿件生成方式会记录在结果中。");
    summary.replaceChildren(dot, element("p", "", parts.join(" ")));
    const select = el("research-domain");
    const previous = select.value;
    const options = domains.map((domain) => {
      const option = element("option", "", DOMAIN_COPY[domain.id]?.label || domain.label || domain.id);
      option.value = domain.id;
      return option;
    });
    select.replaceChildren(...(options.length ? options : [element("option", "", "暂无接入领域")]));
    select.value = domains.some((domain) => domain.id === previous) ? previous : domains[0]?.id || "";
    const selected = domains.find((domain) => domain.id === select.value);
    write("goal-help", domainDescription(selected));
    if (!state.run) renderStages(listFrom(data.stages, []).map((stage) => ({ ...stage, status: "pending" })), null);
    updateControls();
  }

  function renderStages(stages, run) {
    const completed = stages.filter((stage) => stage.status === "completed").length;
    write("stage-total", stages.length ? `${completed} / ${stages.length}` : "暂无阶段");
    const progress = run && Number.isFinite(Number(run.progress)) ? ` · 服务端进度 ${Math.max(0, Math.min(100, Number(run.progress))).toFixed(0)}%` : "";
    write("stage-progress", run ? `已完成 ${completed} 个阶段${progress}` : "运行前预览当前服务已接入的阶段");
    const nodes = stages.map((stage, index) => {
      const row = element("li", "stage-row");
      row.dataset.status = stage.status || "pending";
      const marker = element("span", "stage-marker", stage.status === "completed" ? "✓" : stage.status === "failed" ? "!" : String(index + 1).padStart(2, "0"));
      marker.setAttribute("aria-hidden", "true");
      const copy = element("div", "stage-copy");
      const title = element("div", "stage-name");
      title.append(element("span", "", stage.label || stage.id), element("span", "stage-status", STATUS_LABELS[stage.status] || stage.status || "待执行"));
      copy.append(title);
      if (stage.summary) copy.append(element("p", "stage-description", stage.summary));
      row.append(marker, copy);
      return row;
    });
    el("stage-list").replaceChildren(...(nodes.length ? nodes : [element("li", "empty-state compact-empty", "当前服务暂无研究阶段")]));
  }

  function artifactLink(artifact, label = "下载") {
    const href = safeURL(artifact.url, baseURL, { artifact: true });
    if (!href) return element("span", "muted small", "下载地址不可用");
    const link = element("a", "button button-outline compact", label);
    link.href = href;
    link.setAttribute("download", artifact.name || "");
    link.setAttribute("aria-label", `${label} ${artifact.name || "研究产物"}`);
    return link;
  }
  function renderExperiments(value) {
    let records = listFrom(value, ["trials", "results", "records", "summary"]);
    if (!records.length && value && typeof value === "object" && Object.keys(value).length) records = [{ name: "实验结构化输出", metrics: value }];
    const context = value && typeof value === "object" ? [...listFrom(value.warnings, []), ...listFrom(value.limitations, []), value.novelty_status && `创新状态：${value.novelty_status}`].filter(Boolean).join("\n") : "";
    write("experiment-context", context, "");
    el("experiment-context").hidden = !context;
    write("experiment-count", records.length);
    el("experiment-empty").hidden = records.length > 0;
    el("experiment-table-wrap").hidden = records.length === 0;
    const rows = records.map((record, index) => {
      const data = record && typeof record === "object" ? record : { metrics: record };
      const row = element("tr");
      const name = element("td");
      name.append(element("span", "record-title", data.name || data.method || data.model || data.id || `试验 ${index + 1}`));
      if (data.id) name.append(element("span", "record-detail", data.id));
      const status = element("td");
      const rowStatus = data.status || value?.status;
      const tag = element("span", "state-tag", STATUS_LABELS[rowStatus] || rowStatus || "未提供");
      tag.dataset.status = rowStatus || "unknown";
      status.append(tag);
      const configData = data.config || data.recipe || { ...(data.condition !== undefined ? { condition: data.condition } : {}), ...(data.seed !== undefined ? { seed: data.seed } : {}) };
      const config = element("td", "", asText(configData));
      config.style.whiteSpace = "pre-wrap";
      const metricFields = ["accuracy_mean", "accuracy_sd", "macro_f1_mean", "macro_f1_sd", "seeds_completed", "accuracy", "macro_f1"].filter((key) => data[key] !== undefined);
      const actualMetrics = metricFields.length ? Object.fromEntries(metricFields.map((key) => [key, data[key]])) : null;
      const metrics = element("td", "", asText(data.metrics || data.result || data.results || data.summary || actualMetrics));
      metrics.style.whiteSpace = "pre-wrap";
      const evidence = element("td", "", data.error || data.artifact_id || data.log || data.duration_seconds !== undefined && `耗时 ${data.duration_seconds} 秒` || "—");
      row.append(name, status, config, metrics, evidence);
      return row;
    });
    el("experiment-list").replaceChildren(...rows);
  }
  function renderLiterature(value) {
    let papers = listFrom(value, ["papers", "records", "sources", "references"]);
    if (!papers.length && value && typeof value === "object" && Object.keys(value).length) papers = [{ title: "文献检索输出", summary: value }];
    write("literature-count", papers.length);
    el("literature-empty").hidden = papers.length > 0;
    const nodes = papers.map((paper) => {
      const data = paper && typeof paper === "object" ? paper : { title: paper };
      const item = element("li", "literature-entry");
      const icon = element("span", "paper-symbol", "▤");
      icon.setAttribute("aria-hidden", "true");
      const copy = element("div", "paper-copy");
      const title = element("h4", "paper-title");
      const href = safeURL(data.url || data.source_url || data.link, baseURL);
      if (href) {
        const link = element("a", "record-link", data.title || data.name || "文献来源");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        title.append(link);
      } else title.textContent = asText(data.title || data.name, "文献记录");
      const metadata = [data.year, data.authors && asText(data.authors), data.doi && `DOI ${data.doi}`, data.reading_scope || data.access_scope || data.scope || data.status, data.full_text_status].filter(Boolean);
      copy.append(title);
      if (metadata.length) copy.append(element("p", "paper-meta", metadata.join(" · ")));
      if (data.summary || data.abstract || data.error || data.full_text_error) copy.append(element("p", "paper-summary", data.summary || data.abstract || data.error || data.full_text_error));
      item.append(icon, copy);
      return item;
    });
    el("literature-list").replaceChildren(...nodes);
  }
  function renderArtifacts(artifacts) {
    write("output-count", artifacts.length);
    el("artifact-empty").hidden = artifacts.length > 0;
    const nodes = artifacts.map((artifact) => {
      const item = element("li", "artifact-entry");
      const icon = element("span", "paper-symbol", artifact.kind === "manuscript" ? "▧" : "▤");
      icon.setAttribute("aria-hidden", "true");
      const copy = element("div", "artifact-copy");
      const hash = artifact.sha256 ? ` · SHA256 ${artifact.sha256.slice(0, 12)}…` : "";
      copy.append(element("strong", "artifact-name", artifact.name || artifact.id), element("span", "artifact-meta", `${artifact.kind || "研究产物"} · ${sizeLabel(artifact.size_bytes)}${hash}`));
      item.append(icon, copy, artifactLink(artifact));
      return item;
    });
    el("artifact-list").replaceChildren(...nodes);
  }
  function renderManuscript(outputs) {
    const manuscript = outputs?.manuscript;
    const present = manuscript && typeof manuscript === "object" && Object.keys(manuscript).length > 0;
    el("manuscript-result").hidden = !present;
    if (!present) return;
    write("manuscript-title", manuscript.title || "稿件输出");
    write("manuscript-summary", manuscript.summary || manuscript.status || "服务未提供稿件摘要");
    const checks = { ...(manuscript.quality ? { quality: manuscript.quality } : {}), ...(manuscript.pdf ? { pdf: manuscript.pdf } : {}), ...(outputs.analysis ? { analysis: outputs.analysis } : {}), ...(outputs.review ? { review: outputs.review } : {}), ...(outputs.submission ? { submission: outputs.submission } : {}) };
    write("manuscript-checks", Object.keys(checks).length ? checks : manuscript);
  }
  function renderInterventions(run) {
    const records = listFrom(run.interventions, []);
    write("intervention-count", `${finiteNumber(run.intervention_count)} 次已记录`);
    const nodes = records.map((record) => {
      const item = element("li", "intervention-entry");
      item.append(element("strong", "", record.title || "人工介入记录"));
      const details = [record.status === "pending" ? "待处理" : record.status === "resolved" ? "已处理" : record.status, record.required_action, record.reason].filter(Boolean);
      if (details.length) item.append(element("div", "", details.join(" · ")));
      item.append(element("time", "entry-time", stamp(record.created_at)));
      return item;
    });
    el("intervention-list").replaceChildren(...(nodes.length ? nodes : [element("li", "empty-state compact-empty", "暂无人工介入记录")]));
  }
  function renderRun(run) {
    if (!run || typeof run.id !== "string") throw new Error("服务未返回有效的研究运行编号。");
    if (state.run?.id !== run.id) { state.events = []; state.lastSeq = 0; renderEvents(); }
    state.run = run;
    state.savedRunID = run.id;
    save();
    const budget = run.budget || {};
    const stages = listFrom(run.stages, []);
    const stage = stages.find((item) => item.id === run.stage);
    const artifacts = listFrom(run.artifacts, []);
    const elapsed = finiteNumber(budget.elapsed_seconds);
    const seconds = configuredLimit(budget.max_seconds, 1);
    const trialsLimit = configuredLimit(budget.max_trials, 1);
    const callsLimit = configuredLimit(budget.model_calls);
    const usedTrials = finiteNumber(budget.used_trials);
    const usedCalls = finiteNumber(budget.used_model_calls);
    const showLimits = ACTIVE_STATUSES.has(run.status);
    write("run-status", STATUS_LABELS[run.status] || run.status);
    el("run-status").classList.toggle("status-small", true);
    write("run-stage", stage?.label || run.stage || "尚无阶段记录");
    write("elapsed-value", `${(elapsed / 60).toFixed(1)} 分钟`);
    write("elapsed-detail", showLimits && seconds !== null ? `本次最多 ${(seconds / 60).toFixed(0)} 分钟` : "实际累计用时 · 中断恢复后继续记录");
    el("elapsed-track").hidden = !showLimits || seconds === null;
    el("elapsed-bar").style.width = `${seconds ? Math.min(100, Math.max(0, elapsed / seconds * 100)) : 0}%`;
    write("trial-value", `${usedTrials} 次`);
    write("trial-detail", showLimits && trialsLimit !== null ? `本次最多 ${trialsLimit} 次拟合` : "模型拟合尝试的实际记录");
    write("model-call-value", `${usedCalls} 次`);
    write("model-call-detail", showLimits && callsLimit !== null ? `本次最多 ${callsLimit} 次调用` : "规划、写作与审阅的实际调用");
    write("artifact-value", artifacts.length);
    write("artifact-detail", artifacts.length ? "仅显示服务端登记的实际产物" : "尚无登记的研究产物");
    write("current-goal", run.goal);
    write("current-summary", run.summary || "执行结果将根据服务端记录持续更新。");
    write("run-id", run.id);
    write("run-updated", stamp(run.updated_at));
    const provider = run.outputs?.provider || run.outputs?.model || state.capabilities?.model;
    write("run-model", provider && typeof provider === "object" ? [provider.provider, provider.model].filter(Boolean).join(" · ") : provider);
    write("run-quality", QUALITY_LABELS[run.quality_status] || run.quality_status || "未评定");
    let blocker = run.error || "";
    if (run.status === "needs_input") {
      const pending = listFrom(run.interventions, []).filter((record) => record.status === "pending");
      blocker = [blocker, ...pending.map((record) => record.required_action || record.reason || record.title)].filter(Boolean).join("\n");
    }
    if (RESUMABLE_STATUSES.has(run.status) && ((seconds !== null && elapsed >= seconds) || (trialsLimit !== null && usedTrials >= trialsLimit) || (callsLimit !== null && usedCalls >= callsLimit))) blocker = [blocker, "本次运行的资源限制可能已经达到。恢复沿用这些设置，不会自动扩大上限。"].filter(Boolean).join("\n");
    write("run-blocker", blocker, "");
    el("run-blocker").hidden = !blocker;
    write("evidence-updated", `更新于 ${stamp(run.updated_at)}`);
    write("footer-state", `研究 ${run.id} · ${STATUS_LABELS[run.status] || run.status} · 服务端记录`);
    renderStages(stages, run);
    renderExperiments(run.outputs?.experiment);
    renderLiterature(run.outputs?.reading?.records ? run.outputs.reading : run.outputs?.literature);
    renderArtifacts(artifacts);
    renderManuscript(run.outputs);
    renderInterventions(run);
    if (!el("research-goal").value) el("research-goal").value = run.goal || "";
    updateGoalCount();
    updateControls();
  }
  function renderEvents() {
    write("event-count", state.events.length);
    el("event-empty").hidden = state.events.length > 0;
    const nodes = [...state.events].reverse().map((event) => {
      const item = element("li", "event-entry");
      item.append(element("time", "event-time", stamp(event.created_at, { timeOnly: true })));
      const copy = element("div");
      copy.append(element("p", "event-message", event.message || "服务未提供事件描述"));
      copy.append(element("span", "event-type", [event.seq && `#${event.seq}`, event.type, event.stage, event.status && (STATUS_LABELS[event.status] || event.status)].filter(Boolean).join(" · ")));
      item.append(copy);
      return item;
    });
    el("event-list").replaceChildren(...nodes);
  }
  function appendEvents(data) {
    const known = new Set(state.events.map((event) => event.seq));
    for (const event of listFrom(data.events, [])) {
      if (Number.isInteger(event.seq) && !known.has(event.seq)) { state.events.push(event); known.add(event.seq); }
    }
    state.events.sort((left, right) => left.seq - right.seq);
    state.lastSeq = Math.max(state.lastSeq, finiteNumber(data.last_seq), ...state.events.map((event) => event.seq));
    // Keep a bounded browser view; the full event log remains in server artifacts.
    if (state.events.length > 500) state.events = state.events.slice(-500);
    renderEvents();
  }

  function stopTimer() { if (state.timer !== null) { unschedule(state.timer); state.timer = null; } }
  function queuePoll(delay = 2500) {
    stopTimer();
    if (state.paused || doc.hidden || !state.savedRunID) return;
    state.timer = schedule(() => { state.timer = null; void poll(); }, delay);
  }
  async function poll() {
    if (state.pollBusy || state.paused || doc.hidden || !state.savedRunID) return;
    state.pollBusy = true;
    const generation = state.generation;
    const id = state.savedRunID;
    let failed = false;
    try {
      const run = await request(`/api/research/runs/${encodeURIComponent(id)}`);
      if (generation !== state.generation || state.paused || id !== state.savedRunID) return;
      setConnection(true);
      renderRun(run);
      const events = await request(`/api/research/runs/${encodeURIComponent(id)}/events?after_seq=${state.lastSeq}`);
      if (generation !== state.generation || state.paused || id !== state.savedRunID) return;
      appendEvents(events);
      await loadWriterSettings(generation);
      if (generation !== state.generation || state.paused || id !== state.savedRunID) return;
      showError("");
    } catch (error) {
      if (generation !== state.generation || state.paused) return;
      failed = true;
      setConnection(false);
      showError(error.message);
      updateControls();
    } finally {
      state.pollBusy = false;
      if (generation === state.generation && !state.paused) queuePoll(failed ? 7000 : ACTIVE_STATUSES.has(state.run?.status) ? 2500 : 10000);
    }
  }
  async function chooseExistingRun() {
    if (state.savedRunID) {
      try { return await request(`/api/research/runs/${encodeURIComponent(state.savedRunID)}`); }
      catch (error) {
        if (error.status !== 404) throw error;
        state.savedRunID = null;
        save();
      }
    }
    const data = await request("/api/research/runs");
    const runs = listFrom(data.runs, []);
    return runs.find((run) => ACTIVE_STATUSES.has(run.status)) || runs[0] || null;
  }
  async function resolvePending() {
    if (!state.pending || state.mutation) return;
    state.mutation = true;
    updateControls();
    try {
      const run = await request("/api/research/runs", { method: "POST", body: JSON.stringify(state.pending) });
      if (typeof run.id !== "string") {
        const invalid = new Error("启动响应缺少运行编号；请重新连接确认实际状态。");
        invalid.uncertain = true;
        throw invalid;
      }
      state.pending = null;
      renderRun(run);
      showError("");
      showNotice("启动请求已确认。执行状态与产物会持续更新。");
      setConnection(true);
      queuePoll(0);
    } catch (error) {
      if (!error.uncertain) { state.pending = null; save(); }
      showError(error.status === 409 ? `当前已有研究或请求冲突：${error.message}` : error.message);
      if (error.uncertain) {
        setConnection(false);
        showNotice("启动请求的结果尚未确认。重新连接时会沿用同一请求编号，避免重复创建研究。", "warning");
      } else if (error.status === 409) {
        try {
          const data = await request("/api/research/runs");
          const run = listFrom(data.runs, []).find((item) => ACTIVE_STATUSES.has(item.status));
          if (run) { renderRun(run); queuePoll(0); }
        }
        catch { setConnection(false); }
      }
    } finally { state.mutation = false; updateControls(); }
  }
  async function refresh() {
    if (state.refreshPromise) return state.refreshPromise;
    if (state.paused) return;
    stopTimer();
    state.generation += 1;
    const generation = state.generation;
    el("refresh-btn").disabled = true;
    state.refreshPromise = (async () => {
      try {
        const capabilities = await request("/api/research/capabilities");
        if (generation !== state.generation || state.paused) return;
        setConnection(true);
        renderCapabilities(capabilities);
        await loadWriterSettings(generation);
        if (generation !== state.generation || state.paused) return;
        if (state.pending) { await resolvePending(); return; }
        const run = await chooseExistingRun();
        if (generation !== state.generation || state.paused) return;
        if (run) {
          renderRun(run);
          const events = await request(`/api/research/runs/${encodeURIComponent(run.id)}/events?after_seq=${state.lastSeq}`);
          if (generation !== state.generation || state.paused) return;
          appendEvents(events);
        }
        showError("");
        updateControls();
      } catch (error) {
        if (generation !== state.generation || state.paused) return;
        setConnection(false);
        showError(error.message);
        updateControls();
      } finally {
        if (generation === state.generation && !state.paused) queuePoll(state.connected ? ACTIVE_STATUSES.has(state.run?.status) ? 2500 : 10000 : 7000);
        state.refreshPromise = null;
        el("refresh-btn").disabled = false;
      }
    })();
    return state.refreshPromise;
  }
  function optionalLimit(id, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
    const input = el(id).value.trim();
    if (!input) return null;
    const value = Number(input);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`请填写${id === "budget-minutes" ? "运行时间" : id === "budget-trials" ? "模型拟合次数" : "模型调用次数"}的有效整数（至少 ${minimum}），或留空不设限。`);
    return value;
  }
  async function start(event) {
    event?.preventDefault();
    if (state.mutation || state.writerMutation || !state.connected || ACTIVE_STATUSES.has(state.run?.status) || !state.capabilities?.execution?.available) return;
    if (state.pending) { await resolvePending(); return; }
    try {
      const goal = el("research-goal").value.trim();
      if (!goal || goal.length > 4000) throw new Error("请填写 1 至 4000 字的研究目标。");
      const domain = el("research-domain").value;
      if (!listFrom(state.capabilities.domains, []).some((item) => item.id === domain)) throw new Error("请选择当前已接入的研究领域。");
      const minutes = optionalLimit("budget-minutes", 1, Math.floor(Number.MAX_SAFE_INTEGER / 60));
      state.pending = { goal, domain, request_id: uuid(), budget: { max_seconds: minutes === null ? null : minutes * 60, model_calls: optionalLimit("budget-model-calls", 0), max_trials: optionalLimit("budget-trials", 3) }, mode: "autonomous" };
      save();
      await resolvePending();
    } catch (error) { showError(error.message); updateControls(); }
  }
  async function action(name) {
    if (state.mutation || !state.connected || !state.run) return;
    if (name === "cancel" && !["queued", "running"].includes(state.run.status)) return;
    if (name === "resume" && !RESUMABLE_STATUSES.has(state.run.status)) return;
    state.mutation = true;
    stopTimer();
    state.generation += 1;
    updateControls();
    try {
      const run = await request(`/api/research/runs/${encodeURIComponent(state.run.id)}/${name}`, { method: "POST" });
      renderRun(run);
      showError("");
      showNotice(name === "cancel" ? "取消请求已送达，等待作业实际停止。" : "恢复请求已送达，将沿用研究设置并继续记录执行情况。");
    } catch (error) {
      showError(error.message);
      if (error.uncertain) { setConnection(false); showNotice("操作结果尚未确认，正在查询运行状态；不会重复发送操作。", "warning"); }
    } finally { state.mutation = false; updateControls(); queuePoll(0); }
  }
  function updateGoalCount() { write("goal-count", `${el("research-goal").value.length} / 4000`); }
  const tabNames = ["experiments", "literature", "artifacts", "events"];
  function selectTab(name, focus = false) {
    for (const tab of tabNames) {
      const button = el(`tab-${tab}`);
      const selected = tab === name;
      button.setAttribute("aria-selected", String(selected));
      button.setAttribute("tabindex", selected ? "0" : "-1");
      button.classList.toggle("active", selected);
      el(`pane-${tab}`).hidden = !selected;
    }
    if (focus) el(`tab-${name}`).focus();
  }
  for (const name of tabNames) {
    el(`tab-${name}`).addEventListener("click", () => selectTab(name));
    el(`tab-${name}`).addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = tabNames.indexOf(name);
      const target = event.key === "Home" ? 0 : event.key === "End" ? tabNames.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabNames.length) % tabNames.length;
      selectTab(tabNames[target], true);
    });
  }
  el("research-form").addEventListener("submit", (event) => { void start(event); });
  el("writer-settings-form").addEventListener("submit", (event) => { void writerAction("save", event); });
  el("writer-test-btn").addEventListener("click", () => { void writerAction("test"); });
  for (const id of ["writer-api-key", "writer-model-input"]) el(id).addEventListener("input", () => { state.writerInputDirty = true; writerMessage(""); });
  el("research-goal").addEventListener("input", updateGoalCount);
  el("research-domain").addEventListener("change", () => {
    const domain = listFrom(state.capabilities?.domains, []).find((item) => item.id === el("research-domain").value);
    write("goal-help", domainDescription(domain));
  });
  el("refresh-btn").addEventListener("click", () => { void refresh(); });
  el("retry-btn").addEventListener("click", () => { void refresh(); });
  el("cancel-btn").addEventListener("click", () => { void action("cancel"); });
  el("resume-btn").addEventListener("click", () => { void action("resume"); });
  win.addEventListener("offline", () => { setConnection(false); updateControls(); showError("网络已断开。后台研究可能仍在执行，重新连接后会查询实际状态。"); });
  win.addEventListener("online", () => { void refresh(); });
  win.addEventListener("pagehide", () => { state.paused = true; state.generation += 1; state.writerActionGeneration += 1; el("writer-api-key").value = ""; stopTimer(); });
  win.addEventListener("pageshow", (event) => { if (event.persisted) { state.paused = false; void refresh(); } });
  doc.addEventListener("visibilitychange", () => { if (doc.hidden) stopTimer(); else if (!state.paused) void refresh(); });
  load();
  if (!el("writer-model-input").value) el("writer-model-input").value = "deepseek-flash";
  updateGoalCount();
  updateControls();
  const ready = refresh();
  return { ready, state, refresh, start, action, poll, selectTab, writerAction };
}

if (typeof document !== "undefined" && typeof window !== "undefined") createResearchApp();
