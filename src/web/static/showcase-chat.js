/** A fresh fictional stage conversation; only explicit player actions call the shared API. */
import { sendChatMessage } from "./api.js";

export function initializeShowcaseChat({ document: doc = globalThis.document, sendMessage = sendChatMessage } = {}) {
  const ids = ["stage-chat-log", "stage-chat-form", "stage-chat-input", "stage-chat-send", "stage-chat-reset", "stage-chat-retry", "stage-chat-notice"];
  const elements = ids.map((id) => doc.getElementById(id));
  if (elements.some((element) => !element)) return null;
  const [log, form, input, send, reset, retry, notice] = elements;
  const quickActions = [...doc.querySelectorAll("[data-stage-action]")];
  const history = [];
  const listeners = [];
  let busy = false;
  let failedTurn = null;
  let destroyed = false;

  function listen(element, event, handler) {
    element.addEventListener(event, handler);
    listeners.push(() => element.removeEventListener(event, handler));
  }
  function addMessage(text, who, pending = false) {
    const message = doc.createElement("article");
    message.className = `chat-message chat-message-${who}${pending ? " chat-message-pending" : ""}`;
    const label = doc.createElement("p");
    label.className = "message-label";
    label.textContent = who === "user" ? "你的行动" : "叙述者";
    const body = doc.createElement("p");
    body.className = "message-body";
    body.textContent = text;
    message.append(label, body);
    log.appendChild(message);
    log.scrollTop = log.scrollHeight;
    return message;
  }
  function updateControls() {
    send.disabled = busy || !input.value.trim();
    send.textContent = busy ? "正在回应…" : "发送行动";
    reset.disabled = busy;
    retry.disabled = busy;
    retry.hidden = !failedTurn;
    retry.textContent = "重试本次";
    input.readOnly = busy;
    quickActions.forEach((button) => { button.disabled = busy; });
    log.setAttribute("aria-busy", String(busy));
  }
  function freshConversation() {
    history.length = 0;
    failedTurn = null;
    input.value = "";
    log.replaceChildren();
    addMessage("虚构演示开场：你在一间摆满旧电脑的实验室醒来。桌上的终端闪着光标，一扇紧闭的门通往走廊。屏幕上写着：\n\n“欢迎回来。先看看周围，再决定下一步。”", "ai");
    notice.textContent = "输入行动或选择快捷行动，开始这次新冒险。";
    notice.classList.remove("notice-error");
    updateControls();
  }
  async function submitMessage(value, { retrying = false, clearInput = false } = {}) {
    if (destroyed || busy) return;
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return;
    if (text.length > 4000) {
      notice.textContent = "行动最多输入 4000 个字符，请缩短后发送。";
      notice.classList.add("notice-error");
      return;
    }
    const userMessage = retrying ? failedTurn?.element : addMessage(text, "user");
    if (!userMessage) return;
    if (!retrying && failedTurn) failedTurn.element.remove();
    failedTurn = null;
    if (clearInput) input.value = "";
    busy = true;
    notice.textContent = "叙述者正在回应，请稍候…";
    notice.classList.remove("notice-error");
    updateControls();
    const pending = addMessage("正在续写这次冒险…", "ai", true);
    try {
      const reply = await sendMessage(text, history.slice(-10));
      if (destroyed) return;
      pending.remove();
      addMessage(reply, "ai");
      history.push({ user: text, ai: reply });
      if (history.length > 10) history.splice(0, history.length - 10);
      notice.textContent = "可以继续输入下一步行动。";
    } catch (error) {
      if (destroyed) return;
      pending.remove();
      failedTurn = { text, element: userMessage };
      notice.textContent = `这一步尚未完成：${error?.message || "服务暂时无法响应"}。可点击“重试本次”。`;
      notice.classList.add("notice-error");
    } finally {
      busy = false;
      if (!destroyed) updateControls();
    }
  }

  listen(form, "submit", (event) => {
    event.preventDefault();
    void submitMessage(input.value, { clearInput: true });
  });
  listen(input, "input", updateControls);
  listen(input, "keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  listen(retry, "click", () => {
    if (failedTurn) void submitMessage(failedTurn.text, { retrying: true });
  });
  quickActions.forEach((button) => listen(button, "click", () => { void submitMessage(button.dataset.stageAction); }));
  listen(reset, "click", () => {
    if (!busy) {
      freshConversation();
      input.focus({ preventScroll: true });
    }
  });
  freshConversation();
  return { destroy() { destroyed = true; listeners.forEach((remove) => remove()); } };
}
