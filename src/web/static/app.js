/** 文字冒险UI与交互；模型和工具通过后端API执行。 */
import { sendChatMessage, getHealth } from "./api.js";

const chat = document.getElementById("chat");
const form = document.getElementById("input-form");
const input = document.getElementById("input");
const sendButton = document.getElementById("send-btn");
const resetButton = document.getElementById("reset-btn");
const errorBox = document.getElementById("chat-error");
const history = [];
const storageKey = "aiu.adventure.v1";
let busy = false;
let failedTurn = null;
let checkingHealth = false;

function addMessage(text, who, { pending = false } = {}) {
  const message = document.createElement("article");
  message.className = `message message-${who}${pending ? " message-pending" : ""}`;
  const label = document.createElement("p");
  label.className = "message-label";
  label.textContent = who === "user" ? "你" : "叙述者";
  const body = document.createElement("p");
  body.className = "message-body";
  body.textContent = text;
  message.append(label, body);
  chat.appendChild(message);
  chat.scrollTop = chat.scrollHeight;
  return message;
}
function updateCount() {
  document.getElementById("turn-count").textContent = `${history.length} 轮对话`;
  document.getElementById("char-count").textContent = `${input.value.length} / 4000`;
}
function saveProgress() {
  try { sessionStorage.setItem(storageKey, JSON.stringify(history.slice(-40))); }
  catch { document.getElementById("chat-state").textContent = "当前浏览器无法保存进度"; }
}
function renderHistory() {
  chat.replaceChildren();
  addMessage("你在一间摆满旧电脑的实验室醒来。桌上的终端闪着光标，一扇紧闭的门通往走廊。屏幕上出现一行字：\n\n“欢迎回来。先看看周围，再决定下一步。”", "ai");
  for (const turn of history) { addMessage(turn.user, "user"); addMessage(turn.ai, "ai"); }
  updateCount();
}
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
  if (Array.isArray(saved)) history.push(...saved.filter((turn) => turn && typeof turn.user === "string" && turn.user.length <= 4000 && typeof turn.ai === "string" && turn.ai.length <= 12000).slice(-40));
} catch { /* A malformed or blocked store must not prevent a new game. */ }
renderHistory();

function setBusy(value) {
  busy = value;
  sendButton.disabled = value;
  resetButton.disabled = value;
  input.readOnly = value;
  chat.setAttribute("aria-busy", String(value));
  document.getElementById("send-label").textContent = value ? "思考中" : "发送";
  document.getElementById("chat-state").textContent = value ? "叙述者正在回应，请稍候…" : "Enter 发送 · Shift + Enter 换行";
  document.querySelectorAll(".suggestion").forEach((button) => { button.disabled = value; });
}
async function submitMessage(text, retry = false) {
  if (busy || !text.trim()) return;
  if (!retry && failedTurn) { failedTurn.element.remove(); failedTurn = null; }
  const userMessage = retry ? failedTurn.element : addMessage(text, "user");
  userMessage.classList.remove("message-failed");
  errorBox.hidden = true;
  input.value = "";
  updateCount();
  setBusy(true);
  const pendingMessage = addMessage("正在续写你的冒险…", "ai", { pending: true });
  try {
    const reply = await sendChatMessage(text, history.slice(-10));
    history.push({ user: text, ai: reply });
    if (history.length > 40) { history.splice(0, history.length - 40); renderHistory(); }
    else { pendingMessage.remove(); addMessage(reply, "ai"); }
    failedTurn = null;
    updateCount();
    setBusy(false);
    saveProgress();
  } catch (error) {
    pendingMessage.remove();
    userMessage.classList.add("message-failed");
    failedTurn = { text, element: userMessage };
    document.getElementById("chat-error-text").textContent = `这一步尚未完成：${error.message}`;
    errorBox.hidden = false;
    setBusy(false);
  } finally { input.focus({ preventScroll: true }); }
}
form.addEventListener("submit", (event) => { event.preventDefault(); void submitMessage(input.value.trim()); });
input.addEventListener("input", updateCount);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
});
document.getElementById("retry-btn").addEventListener("click", () => { if (failedTurn) void submitMessage(failedTurn.text, true); });
document.querySelectorAll(".suggestion").forEach((button) => { button.addEventListener("click", () => { void submitMessage(button.dataset.message); }); });
resetButton.addEventListener("click", () => {
  if (busy) return;
  history.length = 0;
  failedTurn = null;
  input.value = "";
  errorBox.hidden = true;
  renderHistory();
  saveProgress();
  input.focus({ preventScroll: true });
});

async function checkHealth() {
  if (checkingHealth) return;
  checkingHealth = true;
  const checkButton = document.getElementById("check-connection");
  const status = document.getElementById("model-status");
  const statusText = document.getElementById("model-status-text");
  const modelError = document.getElementById("model-error");
  checkButton.disabled = true;
  try {
    const health = await getHealth();
    const model = health.model || {};
    status.dataset.tone = model.available ? "success" : "warning";
    statusText.textContent = model.available ? "已连接" : "暂不可用";
    document.getElementById("model-name").textContent = [model.provider, model.model].filter(Boolean).join(" · ") || "尚未配置模型";
    modelError.textContent = model.error || "";
    modelError.hidden = !model.error;
  } catch (error) {
    status.dataset.tone = "warning";
    statusText.textContent = "连接检查失败";
    document.getElementById("model-name").textContent = "请检查应用与模型服务";
    modelError.textContent = error.message;
    modelError.hidden = false;
  } finally { checkingHealth = false; checkButton.disabled = false; }
}
document.getElementById("check-connection").addEventListener("click", () => { void checkHealth(); });
void checkHealth();
