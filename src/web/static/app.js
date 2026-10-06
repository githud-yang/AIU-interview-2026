/**
 * 文字冒险游戏前端主逻辑
 * ======================
 * 只负责DOM操作、事件绑定和状态管理，所有后端请求通过api.js层调用。
 */
import { sendChatMessage } from "./api.js";

// DOM元素
const chat = document.getElementById("chat");
const form = document.getElementById("input-form");
const input = document.getElementById("input");

// 对话状态
const history = [];

/**
 * 添加一条消息到聊天窗口
 * @param {string} text 消息内容
 * @param {string} who 发送者：user / ai
 */
function addMessage(text, who) {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  paragraph.style.whiteSpace = "pre-wrap";
  div.appendChild(paragraph);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// 表单提交事件
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  // 更新UI
  addMessage(text, "user");
  input.value = "";
  const btn = form.querySelector("button");
  btn.disabled = true;

  try {
    // 调用API层
    const reply = await sendChatMessage(text, history.slice(-10));
    history.push({ user: text, ai: reply });
    addMessage(reply, "ai");
  } catch (err) {
    addMessage("请求失败：" + err.message, "ai");
  } finally {
    btn.disabled = false;
    input.focus();
  }
});

// 页面加载完成后自动聚焦输入框
input.focus();
