/** Embedded planning actions send an editable analysis focus to the same-origin workbench. */
export function initializeResearchPlanning({ document: doc = document, window: win = window } = {}) {
  const embedded = new URL(win.location.href).searchParams.get("embed") === "1" && win.parent !== win;
  if (!embedded) return;
  doc.documentElement.dataset.embed = "true";
  const focusAction = (container, label, focus, mode = "replace") => {
    if (!container) return;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "button primary planning-use";
    button.textContent = label;
    button.dataset.planningFocus = focus;
    button.dataset.planningMode = mode;
    container.append(button);
  };
  const ideas = [
    "围绕实时应用的截止时间，分析320、480、640输入的精度与延迟取舍，并整理动态尺寸选择需要补充的证据。",
    "围绕小目标漏检与局部补救，分析当前输入尺寸测量的适用范围，并整理目标尺度分组、区域选择开销和消融所需的验证。",
    "围绕持续运行的性能稳定性，分析固定尺寸测量中的平均延迟与波动，并整理持续负载、真实视频和跨设备比较所需的补充验证。",
  ];
  doc.querySelectorAll('section[aria-labelledby="ideas-title"] .card').forEach((card, index) => {
    if (ideas[index]) focusAction(card, "采用此研究方向", ideas[index]);
  });
  const venues = [
    "策划目标：Journal of Real-Time Image Processing。围绕具体实时问题论述，检查时间约束、持续负载、策略开销和最近似方法对照的证据缺口。投稿规则依据2026-10-11核查资料，正式投稿前再次核对官方要求。",
    "策划目标：Signal, Image and Video Processing。检查方法机制、组件消融、真实设备和图像/视频应用贡献的证据缺口；页限冲突需向官方确认。投稿规则依据2026-10-11核查资料，正式投稿前再次核对。",
    "策划目标：PLOS ONE。检查技术有效性、独立评测、数据与代码可用性、声明和结论边界的证据缺口。投稿规则依据2026-10-11核查资料，正式投稿前再次核对官方要求。",
  ];
  doc.querySelectorAll('section[aria-labelledby="venues-title"] tbody tr').forEach((row, index) => {
    if (venues[index]) focusAction(row.querySelector("td:last-child"), "加入分析重点", venues[index], "append");
  });
  doc.querySelectorAll("[data-planning-focus]").forEach((button) => {
    button.hidden = false;
    button.addEventListener("click", () => {
      const focus = button.dataset.planningFocus;
      if (!focus) return;
      win.parent.postMessage({ type: "qiyuan:planning-focus", domain: "yolo_tradeoff", mode: button.dataset.planningMode || "replace", focus }, win.location.origin);
    });
  });
}

if (typeof document !== "undefined" && typeof window !== "undefined") initializeResearchPlanning();
