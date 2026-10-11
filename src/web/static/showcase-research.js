/** Select registered reading versions and mount the real workbench only on request. */
export function selectResearchReport(artifacts, language = "zh") {
  const available = (id) => artifacts.find((item) => item.id === id && item.available && item.kind === "html");
  return available(language === "en" ? "report" : "report-zh") || available("report") || available("report-zh") || null;
}

export function createStageWorkbench({ frame, container, button, link }) {
  let runId = "";
  function url() {
    return `/research?presentation=1${runId ? `&run_id=${encodeURIComponent(runId)}` : ""}`;
  }
  return {
    setRun(id) {
      runId = id;
      link.href = `/research${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`;
    },
    open() {
      // Revisiting this section keeps the task, input and subscription mounted.
      if (!frame.getAttribute("src")) frame.src = url();
      container.hidden = false;
      button.textContent = "回到交互工作台";
      button.setAttribute("aria-expanded", "true");
      container.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  };
}
