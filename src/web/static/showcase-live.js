/** Assemble the two stage widgets; each owns its API controls and local UI state. */
import { initializeShowcaseChat } from "./showcase-chat.js";
import { initializeShowcaseYolo } from "./showcase-yolo.js";

export function initializeShowcaseLive(options = {}) {
  const widgets = [initializeShowcaseChat(options), initializeShowcaseYolo(options)];
  return { destroy() { widgets.forEach((widget) => widget?.destroy()); } };
}

export const initShowcaseLive = initializeShowcaseLive;
