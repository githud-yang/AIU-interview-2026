/** Run: node --test tests/test_research_outcomes.mjs. No network or research jobs. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { selectResearchOutcomes } from "../src/web/static/research-outcomes.js";

const base = "http://127.0.0.1:8000/research";
function artifact(id, path, kind, sha256 = id) {
  return { id, path, kind, name: path.split("/").at(-1), sha256, url: `/api/research/runs/run-1/artifacts/${id}` };
}
function reference(item) { return { path: `D:\\workspace\\logs\\research\\runs\\run-1\\${item.path.replaceAll("/", "\\")}`, sha256: item.sha256 }; }
function completed() {
  const old = artifact("old", "reading_zh_v1/paper.zh.html", "chinese_reading_html");
  const paper = artifact("paper", "manuscript_v2/paper.html", "html");
  const htmlZH = artifact("html-zh", "reading_zh_v2/paper.zh.html", "chinese_reading_html");
  const pdfZH = artifact("pdf-zh", "reading_zh_v2/paper.zh.pdf", "chinese_reading_pdf");
  const chartZH = artifact("chart", "reading_zh_v2/accuracy_latency.zh.png", "chinese_reading_png");
  const csv = artifact("csv", "experiments/metrics.csv", "raw_metrics_csv");
  const bundle = artifact("zip", "research_bundle.zip", "zip");
  return { id: "run-1", status: "completed", domain: "yolo_tradeoff", artifacts: [old, paper, htmlZH, pdfZH, chartZH, csv, bundle], outputs: {
    manuscript: { title: "Measured study", selected_imgsz: 640, artifacts: [reference(paper)],
      summary: [{ split: "selection", imgsz: 640, map50_95: .9, latency_ms: 3 }, { split: "evaluation", imgsz: 640, map50_95: .474565, latency_ms: 13.946786 }],
      chinese_reading: { title: "固定权重下的输入尺寸研究", run_id: "run-1", artifacts: [reference(htmlZH), reference(pdfZH), reference(chartZH)] } },
    analysis: { interpretation: "UNVERIFIED: guaranteed improvement" },
  } };
}

test("prominent outputs resolve the current Chinese revision and summarize evaluation facts", () => {
  const result = selectResearchOutcomes(completed(), base);
  assert.equal(result.paper.id, "html-zh");
  assert.equal(result.pdf.id, "pdf-zh");
  assert.equal(result.chart.id, "chart");
  assert.equal(result.csv.id, "csv");
  assert.equal(result.bundle.id, "zip");
  assert.equal(result.title, "固定权重下的输入尺寸研究");
  assert.match(result.summary, /第二拆分评测 mAP50–95 47.46%.*13.95 ms/);
  assert.doesNotMatch(result.summary, /90.00|UNVERIFIED|improvement/);
  assert.equal(result.status, "候选稿已生成");
});

test("references cannot select an old revision, mismatched hashes or a different run's reading", () => {
  const run = completed();
  run.outputs.manuscript.chinese_reading.artifacts[0].sha256 = "wrong";
  assert.equal(selectResearchOutcomes(run, base).paper.id, "paper");
  run.outputs.manuscript.chinese_reading.run_id = "another-run";
  const result = selectResearchOutcomes(run, base);
  assert.equal(result.paper.id, "paper");
  assert.equal(result.title, "Measured study");
  assert.equal(result.pdf, null);
  run.artifacts.push(artifact("first-draft", "manuscript/paper.html", "html"));
  run.outputs.manuscript.artifacts = [];
  run.outputs.manuscript.revision = 3;
  assert.equal(selectResearchOutcomes(run, base).paper, null);
});

test("registered URLs must bind the current run and artifact, with no off-origin or executable preview", () => {
  const unsafe = ["javascript:alert(1)", "https://other.example/api/research/runs/run-1/artifacts/html-zh", "/api/research/runs/other/artifacts/html-zh", "/api/research/runs/run-1/artifacts/old", "/api/research/runs/run-1/artifacts/html-zh?redirect=elsewhere", "http://name:password@127.0.0.1:8000/api/research/runs/run-1/artifacts/html-zh"];
  for (const url of unsafe) {
    const run = completed();
    run.artifacts.find((item) => item.id === "html-zh").url = url;
    assert.equal(selectResearchOutcomes(run, base).paper.id, "paper", url);
  }
});

test("latest export bundle wins and a broken latest reference never silently offers the old package", () => {
  const run = completed();
  const latest = artifact("latest", "export_v3/research_bundle.zip", "zip");
  run.artifacts.push(latest);
  run.outputs.latest_export = { bundle: { ...latest } };
  assert.equal(selectResearchOutcomes(run, base).bundle.id, "latest");
  run.outputs.latest_export.bundle.sha256 = "mismatch";
  assert.equal(selectResearchOutcomes(run, base).bundle, undefined);
});

test("empty and interrupted studies show honest partial output; invalid metrics stay out of the summary", () => {
  assert.equal(selectResearchOutcomes(null, base).runID, null);
  const run = { id: "run-1", status: "running", artifacts: [], outputs: {} };
  let result = selectResearchOutcomes(run, base);
  assert.match(result.empty, /研究正在推进/);
  assert.equal(result.paper, null);
  run.status = "failed";
  result = selectResearchOutcomes(run, base);
  assert.equal(result.status, "执行失败");
  assert.match(result.empty, /尚未生成/);
  const invalid = completed();
  invalid.outputs.manuscript.summary[1].latency_ms = NaN;
  assert.doesNotMatch(selectResearchOutcomes(invalid, base).summary, /NaN|47.46/);
  invalid.status = "interrupted";
  assert.equal(selectResearchOutcomes(invalid, base).status, "已保留阶段稿件");
});
