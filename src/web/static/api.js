/** Shared same-origin API client. Network failures and responses are checked here. */
async function request(path, { method = "GET", body, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      method, signal: controller.signal, cache: "no-store",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`服务返回了无法读取的响应（${response.status}）`); }
    if (!response.ok) {
      const detail = typeof data.detail === "string" ? data.detail : data.error || data.msg;
      throw new Error(detail || `请求失败（${response.status}），请稍后重试`);
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("等待服务响应超时，请检查连接后重试");
    if (error instanceof TypeError) throw new Error("无法连接服务，请确认应用已经启动");
    throw error;
  } finally { clearTimeout(timer); }
}

export async function sendChatMessage(message, history) {
  const data = await request("/api/chat", { method: "POST", body: { message, history }, timeout: 180000 });
  if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("模型没有返回有效回复，请重试");
  return data.reply;
}
export const getHealth = () => request("/api/health", { timeout: 12000 });
export const getYoloSources = () => request("/yolo/sources");
export const getYoloStatus = () => request("/yolo/status");
export const startYolo = (source) => request("/yolo/start", { method: "POST", body: { source }, timeout: 60000 });
export const stopYolo = () => request("/yolo/stop", { method: "POST", timeout: 15000 });
export const getYoloStreamUrl = () => `/yolo/stream?t=${Date.now()}`;
