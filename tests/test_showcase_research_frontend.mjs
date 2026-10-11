/** Verify reading edition fallback and explicit workbench mount without model calls. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createStageWorkbench, selectResearchReport } from "../src/web/static/showcase-research.js";
import { validateStageResearchSnapshot } from "../src/web/static/showcase-transport.js";

const html = (id, available = true) => ({ id, available, kind: "html", label: id, href: `/api/showcase/research/files/${id}` });

test("Chinese is preferred; English remains selectable and missing editions fall back", () => {
  const reports = [html("report"), html("report-zh")];
  assert.equal(selectResearchReport(reports).id, "report-zh");
  assert.equal(selectResearchReport(reports, "en").id, "report");
  assert.equal(selectResearchReport([html("report-zh", false), html("report")]).id, "report");
  assert.equal(selectResearchReport([]), null);
  const snapshot = { available: true, title: "saved", runId: "fixed", status: "completed", source: "local",
    summary: "measured", limitation: "sample", metrics: [], stages: [], comparison: [], artifacts: reports };
  assert.equal(validateStageResearchSnapshot(snapshot), snapshot);
  assert.throws(() => validateStageResearchSnapshot({ ...snapshot, artifacts: [html("private")] }), /格式不完整/);
});

test("workbench loads on explicit action and revisits retain the mounted application", () => {
  let src = null;
  let mounts = 0;
  let scrolls = 0;
  const frame = { getAttribute: () => src, set src(value) { src = value; mounts += 1; } };
  const container = { hidden: true, scrollIntoView() { scrolls += 1; } };
  const button = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
  const link = {};
  const view = createStageWorkbench({ frame, container, button, link });
  view.setRun("fixed-run");
  assert.equal(src, null);
  assert.equal(container.hidden, true);
  view.open();
  assert.equal(src, "/research?presentation=1&run_id=fixed-run");
  assert.equal(container.hidden, false);
  assert.equal(button.attributes["aria-expanded"], "true");
  view.setRun("new-run");
  view.open();
  assert.equal(mounts, 1);
  assert.equal(scrolls, 2);
  assert.equal(link.href, "/research?run_id=new-run");
});
