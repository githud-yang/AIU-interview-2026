/** Keep the archived report API compatible after moving all research UI into the workspace. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateStageResearchSnapshot } from "../src/web/static/showcase-transport.js";

const html = (id, available = true) => ({ id, available, kind: "html", label: id, href: `/api/showcase/research/files/${id}` });

test("registered Chinese and English reading editions retain their public artifact boundary", () => {
  const reports = [html("report"), html("report-zh")];
  const snapshot = { available: true, title: "saved", runId: "fixed", status: "completed", source: "local",
    summary: "measured", limitation: "sample", metrics: [], stages: [], comparison: [], artifacts: reports };
  assert.equal(validateStageResearchSnapshot(snapshot), snapshot);
  assert.throws(() => validateStageResearchSnapshot({ ...snapshot, artifacts: [html("private")] }), /格式不完整/);
});
