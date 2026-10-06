/**
 * API请求层
 * ==========
 * 统一封装所有后端接口调用，前端其他模块不直接写fetch，只调用这里暴露的方法。
 * 后端接口路径变更只需修改这一个文件。
 */

const API_BASE = "";

/**
 * 发送聊天消息
 * @param {string} message 用户输入
 * @param {Array} history 对话历史
 * @returns {Promise<string>} AI回复
 */
export async function sendChatMessage(message, history) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.reply;
}

/**
 * 启动YOLO检测
 * @returns {Promise<Object>} 操作结果
 */
export async function startYolo() {
  const res = await fetch(`${API_BASE}/yolo/start`, { method: "POST" });
  return res.json();
}

/**
 * 停止YOLO检测
 * @returns {Promise<Object>} 操作结果
 */
export async function stopYolo() {
  const res = await fetch(`${API_BASE}/yolo/stop`, { method: "POST" });
  return res.json();
}

/**
 * 获取YOLO视频流地址
 * @returns {string} 视频流URL
 */
export function getYoloStreamUrl() {
  return `${API_BASE}/yolo/stream`;
}
