"""Measured YOLO inference reports; no training or independent-test claim.

Only registered, hashed evidence contributes quantitative claims. Model prose
is retained separately, because numeric token membership cannot establish that
an interpretation uses the correct comparison.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import html
import json
import math
import statistics
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from src.research.domain import artifact, sha256_file, write_json
from src.research.manuscript import _tex_escape

_SIZES = (320, 480, 640)
_FLOATS = ("map50", "map50_95", "precision", "recall", "latency_ms", "latency_sd_ms", "fps")
_COUNTS = ("imgsz", "repeats", "sample_count", "n_images")
_REQUIRED = {"model", "split", *_FLOATS, *_COUNTS}


def _number(value, field: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"invalid numeric evidence: {field}")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid numeric evidence: {field}") from exc
    if not math.isfinite(number):
        raise ValueError(f"non-finite numeric evidence: {field}")
    return number


def _integer(value, field: str) -> int:
    number = _number(value, field)
    if number != int(number):
        raise ValueError(f"non-integer evidence: {field}")
    return int(number)


def _matches(actual: dict, claimed: dict) -> None:
    for field in ("model", "split", *_COUNTS):
        if actual[field] != claimed.get(field):
            raise ValueError(f"summary identifier/count differs from raw results: {field}")
    for field in _FLOATS:
        value = _number(claimed.get(field), field)
        if not math.isclose(actual[field], value, rel_tol=1e-8, abs_tol=1e-8):
            raise ValueError(f"summary numeric claim differs from raw results: {field}")


def _verify_experiment(experiment: dict, root: Path) -> dict:
    if (experiment.get("domain") != "yolo_tradeoff" or experiment.get("ok") is not True
            or experiment.get("status") != "completed" or experiment.get("evaluation_opened") is not True
            or experiment.get("independent_test") is not False or experiment.get("test_opened") is not False):
        raise ValueError("YOLO manuscript requires completed frozen evaluation, explicitly without an independent test")
    if experiment.get("recipe", {}).get("image_sizes") != list(_SIZES):
        raise ValueError("YOLO manuscript only accepts the registered image-size protocol")
    evidence: dict[Path, dict] = {}
    for item in experiment.get("artifacts", []):
        path = Path(item["path"]).resolve()
        if (not path.is_relative_to(root) or not path.is_file()
                or Path(item["path"]).is_symlink() or sha256_file(path) != item.get("sha256")):
            raise ValueError("experiment evidence is outside the run or has a hash mismatch")
        if path in evidence:
            raise ValueError("duplicate registered experiment evidence")
        evidence[path] = item
    def registered(name: str) -> Path:
        path = root / "experiments" / name
        if path not in evidence:
            raise ValueError(f"{name} is not registered experiment evidence")
        return path
    protocol = json.loads(registered("data_protocol.json").read_text(encoding="utf-8"))
    environment = json.loads(registered("environment.json").read_text(encoding="utf-8"))
    frozen = json.loads(registered("frozen_selection.json").read_text(encoding="utf-8"))
    splits = protocol.get("splits", {})
    image_sets = {}
    for split in ("selection", "evaluation"):
        values = splits.get(split, [])
        if not values or len(set(values)) != len(values) or not all(isinstance(value, str) for value in values):
            raise ValueError("data protocol requires nonempty unique image IDs")
        image_sets[split] = set(values)
        if protocol.get("counts", {}).get(split) != len(values):
            raise ValueError("data protocol sample count differs from split IDs")
    if image_sets["selection"] & image_sets["evaluation"]:
        raise ValueError("selection and evaluation image IDs overlap")
    if (protocol.get("dataset") != "coco128" or protocol.get("independent_test") is not False
            or protocol.get("pretraining_overlap_possible") is not True
            or protocol.get("selection_evaluation_disjoint") is not True):
        raise ValueError("COCO128 protocol must retain the pretraining-overlap and independence limits")
    manifest = root / "experiments" / "dataset_manifest.json"
    if manifest in evidence and protocol.get("dataset_manifest_sha256") != sha256_file(manifest):
        raise ValueError("dataset manifest differs from the frozen data protocol")
    if (frozen.get("frozen_before_evaluation") is not True or frozen.get("baseline_imgsz") != 640
            or frozen.get("selected_imgsz") not in _SIZES):
        raise ValueError("selection is not recorded as frozen before evaluation")
    selected = frozen["selected_imgsz"]
    if experiment.get("selected_imgsz", selected) != selected:
        raise ValueError("experiment selected image size differs from frozen selection")
    expected = {("selection", size) for size in _SIZES} | {("evaluation", size) for size in {640, selected}}
    with registered("metrics.csv").open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        if not _REQUIRED.issubset(reader.fieldnames or []):
            raise ValueError("raw metrics CSV is missing measured fields")
        raw = list(reader)
    rows = {}
    for source in raw:
        row = {field: _number(source[field], field) for field in _FLOATS}
        row.update({field: _integer(source[field], field) for field in _COUNTS})
        row.update(model=source["model"], split=source["split"])
        key = (row["split"], row["imgsz"])
        if key not in expected or key in rows or row["model"] != f"yolo_imgsz{row['imgsz']}":
            raise ValueError("raw results have missing, duplicate or unregistered evaluation jobs")
        if any(not 0 <= row[field] <= 1 for field in ("map50", "map50_95", "precision", "recall")):
            raise ValueError("accuracy evidence is outside [0, 1]")
        if row["latency_ms"] <= 0 or row["latency_sd_ms"] < 0 or row["fps"] <= 0:
            raise ValueError("latency and throughput evidence must be valid")
        if (row["repeats"] != 3 or row["sample_count"] != 30
                or row["n_images"] != len(image_sets[row["split"]])):
            raise ValueError("raw job count differs from the registered measurement protocol")
        rows[key] = row
    if set(rows) != expected:
        raise ValueError("raw results do not contain the exact frozen evaluation jobs")
    with registered("latency_samples.csv").open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        if not {"model", "split", "imgsz", "repeat", "sample", "image_id", "latency_ms"}.issubset(reader.fieldnames or []):
            raise ValueError("latency samples CSV is missing observation identifiers")
        observations = list(reader)
    by_job = {key: [] for key in rows}
    identifiers = set()
    for sample in observations:
        key = (sample["split"], _integer(sample["imgsz"], "imgsz"))
        repeat = _integer(sample["repeat"], "repeat")
        index = _integer(sample["sample"], "sample")
        identifier = (*key, repeat, index)
        if (key not in by_job or sample["model"] != rows[key]["model"] or identifier in identifiers
                or sample["image_id"] not in image_sets[key[0]]):
            raise ValueError("latency sample has an invalid or duplicate measurement identity")
        value = _number(sample["latency_ms"], "latency_ms")
        if value <= 0:
            raise ValueError("latency observation must be positive")
        identifiers.add(identifier)
        by_job[key].append((repeat, value))
    for key, measurements in by_job.items():
        groups = {repeat for repeat, _ in measurements}
        if len(measurements) != 30 or len(groups) != 3 or any(sum(r == group for r, _ in measurements) != 10 for group in groups):
            raise ValueError("latency evidence must retain all three repeats of ten frames")
        values = [value for _, value in measurements]
        computed = {"latency_ms": statistics.fmean(values), "latency_sd_ms": statistics.stdev(values)}
        computed["fps"] = 1000 / computed["latency_ms"]
        for field, value in computed.items():
            if not math.isclose(rows[key][field], value, rel_tol=1e-8, abs_tol=1e-8):
                raise ValueError(f"raw latency observations disagree with metrics CSV: {field}")
            rows[key][field] = value
    selection = [rows[("selection", size)] for size in _SIZES]
    eligible = [row for row in selection if rows[("selection", 640)]["map50_95"] - row["map50_95"] <= 0.02 + 1e-12]
    reproduced_selection = min(eligible, key=lambda row: (row["latency_ms"], -row["map50_95"], row["imgsz"]))["imgsz"]
    if selected != reproduced_selection:
        raise ValueError("frozen image-size choice differs from the registered selection rule")
    frozen_rows = frozen.get("selection", [])
    if len(frozen_rows) != len(selection):
        raise ValueError("frozen selection does not retain all selection measurements")
    freeze_by_size = {row.get("imgsz"): row for row in frozen_rows}
    if set(freeze_by_size) != set(_SIZES):
        raise ValueError("frozen selection identifiers differ from raw results")
    for row in selection:
        _matches(row, freeze_by_size[row["imgsz"]])
    summary = [rows[key] for key in sorted(rows, key=lambda key: (key[0] != "selection", key[1]))]
    claimed = experiment.get("summary", [])
    claimed_by_job = {(row.get("split"), row.get("imgsz")): row for row in claimed}
    if len(claimed) != len(summary) or set(claimed_by_job) != expected:
        raise ValueError("summary does not match raw experiment records")
    for row in summary:
        _matches(row, claimed_by_job[(row["split"], row["imgsz"])])
    if (environment.get("precision") != "FP32" or environment.get("batch_size", environment.get("batch")) != 1
            or environment.get("warmups") != 5 or environment.get("repeats") != 3
            or environment.get("samples_per_repeat") != 10 or not environment.get("device")):
        raise ValueError("environment does not record the registered batch/precision/timing protocol")
    return {"summary": summary, "selected_imgsz": selected, "protocol": protocol,
            "environment": environment, "frozen": frozen, "evidence": evidence}


def _plot(path: Path, summary: list[dict]) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    figure, axes = plt.subplots(1, 2, figsize=(9, 3.35), constrained_layout=True)
    for split, color, marker in (("selection", "#317861", "o"), ("evaluation", "#3e6390", "s")):
        rows = [row for row in summary if row["split"] == split]
        sizes = [row["imgsz"] for row in rows]
        axes[0].plot(sizes, [row["map50_95"] for row in rows], marker=marker, color=color, label=split)
        axes[1].plot(sizes, [row["latency_ms"] for row in rows], marker=marker, color=color, label=split)
    for axis in axes:
        axis.set_xlabel("Input image size (pixels)")
        axis.set_xticks(_SIZES)
        axis.grid(alpha=0.22)
        axis.legend(fontsize=8)
    axes[0].set_ylabel("mAP50-95 (fraction)")
    axes[0].set_ylim(0, 1)
    axes[1].set_ylabel("Mean end-to-end latency (ms / image)")
    axes[1].set_ylim(bottom=0)
    figure.savefig(path, dpi=170)
    plt.close(figure)


def build_yolo_manuscript(output_dir: str | Path, *, question: str, literature: dict | list,
                          experiment: dict, analysis: dict | str | None = None, revision: int = 1) -> dict:
    """Export a frozen inference trade-off study from hashed, measured CSVs."""
    root = Path(output_dir).resolve()
    verified = _verify_experiment(experiment, root)
    summary, selected = verified["summary"], verified["selected_imgsz"]
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ValueError("manuscript revision must be a positive integer")
    directory = root / ("manuscript" if revision == 1 else f"manuscript_v{revision}")
    if directory.is_symlink() or not directory.resolve().is_relative_to(root):
        raise ValueError("manuscript directory is outside the run")
    inputs = {"question": question, "literature": literature, "experiment": experiment, "analysis": analysis, "revision": revision}
    digest = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()
    saved_path = directory / "manuscript.json"
    if saved_path.is_file():
        saved = json.loads(saved_path.read_text(encoding="utf-8"))
        if saved.get("input_sha256") != digest:
            raise ValueError("Existing manuscript revision is immutable; export a new revision")
        for item in saved["artifacts"]:
            path = Path(item["path"]).resolve()
            if not path.is_relative_to(directory) or not path.is_file() or sha256_file(path) != item["sha256"]:
                raise ValueError("Saved manuscript artifact has a hash mismatch")
        return {**saved, "manifest": artifact(saved_path, "manuscript_manifest"), "reused": True}
    if directory.exists() and any(directory.iterdir()):
        raise ValueError("Unmanifested manuscript directory already has files; export a new revision")
    directory.mkdir(parents=True, exist_ok=True)
    protocol, environment = verified["protocol"], verified["environment"]
    indexed = {(row["split"], row["imgsz"]): row for row in summary}
    candidate, baseline = indexed[("evaluation", selected)], indexed[("evaluation", 640)]
    map_difference = candidate["map50_95"] - baseline["map50_95"]
    latency_difference = candidate["latency_ms"] - baseline["latency_ms"]
    ratio = baseline["latency_ms"] / candidate["latency_ms"]
    counts = protocol["counts"]
    records = literature if isinstance(literature, list) else literature.get("records", [])
    title = "A Measured YOLO Inference Accuracy-Latency Trade-off Study"
    abstract = (f"We compare image sizes 320, 480 and 640 using one unchanged YOLO checkpoint and the public COCO128 sample. "
        f"The fixed data protocol separates {counts['selection']} selection images from {counts['evaluation']} evaluation images. "
        f"The selection-only rule chooses size {selected}: the lowest measured latency among candidates whose mAP50-95 loss from size 640 is at most 0.02. "
        f"After freezing this choice, evaluation mAP50-95 is {candidate['map50_95']:.4f} versus {baseline['map50_95']:.4f} at size 640 "
        f"(difference {map_difference:+.4f}); mean latency is {candidate['latency_ms']:.3f} versus {baseline['latency_ms']:.3f} ms per image "
        f"(baseline-to-selected latency ratio {ratio:.3f}). COCO-pretrained weights may already have seen these images, so this is an inference configuration study "
        "and not independent generalization confirmation, algorithmic innovation, retraining or a publication claim.")
    methods = (f"COCO128 image and label snapshots, the dataset manifest and split IDs are registered with SHA-256 hashes. "
        f"Preparation excludes {len(protocol.get('excluded_coco8', []))} known local COCO8 images and "
        f"{len(protocol.get('excluded_missing_annotation', []))} images without explicit annotation files; excluded IDs are retained in the protocol. "
        f"Split seed {protocol.get('split_seed', 'unavailable')} is recorded; selection and evaluation IDs are non-overlapping. "
        "The checkpoint remains fixed for every job, and no model training is performed. "
        f"Accuracy uses all {counts['selection']} or {counts['evaluation']} images in the corresponding split. "
        "mAP50 measures average precision at IoU 0.50; mAP50-95 averages across the evaluator's IoU thresholds from 0.50 to 0.95. "
        "The reported precision and recall use the registered evaluator's operating point. "
        "Before opening evaluation, all three selection sizes are compared against the selection-size-640 baseline. "
        "Among candidates with mAP50-95 loss at most 0.02, choose the lowest mean latency, breaking ties by higher mAP50-95 and then smaller size. "
        "Evaluation is run only for this frozen choice and size 640; other candidate sizes are not measured on evaluation and are not retrospectively ranked there. "
        "If size 640 wins selection, both labels refer to the same evaluation job.")
    timing = (f"Recorded device: {environment['device']}; precision: {environment['precision']}; batch size: 1. "
        "Each job performs 5 warm-up predictions followed by 3 repeats of 10 single-image predictions, retaining all 30 latency observations. "
        "Latency is the arithmetic mean of those observations, with sample standard deviation reported separately. "
        "It includes the registered end-to-end predict call (preprocessing, model inference, postprocessing and synchronization where required); "
        "it excludes dataset download, file loading, the separate accuracy validation job and warm-up calls. "
        "FPS is 1000 divided by the measured mean latency and is a reciprocal single-image throughput estimate, not a concurrent-stream benchmark. "
        f"Software and hardware versions, checkpoint identity and the complete timing settings are retained in experiments/environment.json. "
        "Repeated frames on one device are dependent observations; latency SD is not a confidence interval, and no significance test is claimed.")
    results = (f"On the frozen evaluation split, selected size {selected} changes mAP50-95 by {map_difference:+.4f} "
        f"and mean latency by {latency_difference:+.3f} ms relative to size 640. "
        "These are measured outcomes, including any evaluation accuracy degradation; selection eligibility is not a guarantee of the same degradation bound on evaluation. "
        "All measured selection candidates and both frozen evaluation configurations are shown. Accuracy depends on the full split, whereas timing uses 30 recorded prediction calls.")
    discussion = ("The supported decision is limited to the registered image-size range, checkpoint, sample images and hardware. "
        "Choosing a smaller input can change both detection accuracy and latency; the report retains the measured trade-off rather than claiming a universal optimum. "
        "Any model-generated analysis is stored verbatim in model_analysis_unverified.json and is not used as measured quantitative evidence in this report. "
        "A proposed explanation or modification needs new controlled evidence. Revising prose reuses this frozen evidence; it does not provide a new experimental result.")
    limitations = ("COCO128 is a small public example rather than a representative deployment benchmark. Its images may overlap the COCO training data of the pretrained checkpoint. "
        "Images without annotation files are omitted instead of being assumed to contain no objects; this exclusion may bias false-positive assessment. "
        "Even with disjoint selection and evaluation IDs, the evaluation is not an independent test of generalization. "
        "No weights are retrained or fine-tuned, no new architecture or optimization algorithm is introduced, and no venue-specific format, external review, submission or acceptance is established. "
        "Single-device timing is sensitive to device load, power state and software versions, and the fixed small timing sample does not describe tail latency or production concurrency. "
        "Evaluation exposure prevents later adaptive changes from being treated as confirmation on an untouched holdout. "
        "Broader or deployment-specific claims require a suitably independent dataset and a new frozen protocol.")
    runner_name = "yolo_runner_source.py"
    reproduce = (f"The archive retains the runner snapshot experiments/{runner_name}, recipe, data protocol, environment and checkpoint hashes for inspection. "
        "It is not a standalone executable reproduction: paths refer to the original machine, and a portable replay entry point using the archived weights and frozen split is not implemented. "
        "Running the registered project module src.research.yolo_domain with --output in a matching environment starts new measurements using current project-owned inputs; it does not replay this frozen experiment. "
        "Independent reproduction in a fresh environment has not been verified. "
        "The archive includes the hashed raw metrics, per-call timing observations and frozen selection. "
        "Numeric tables are regenerated from the raw CSV files; latency mean, SD and reciprocal FPS are independently recomputed from the observations. "
        "PDF export uses ReportLab. paper.tex is generated source and has not been compiled by a TeX engine. The preparation bundle has not been submitted externally.")
    sections = [("Abstract", abstract), ("1. Study Scope", "The user research question is preserved in project_goal.txt. This registered study implements fixed-weight YOLO image-size inference comparisons; it does not implement arbitrary user-designed training or architecture experiments."),
        ("2. Retrieved Literature", f"The recorded acquisition contains {len(records)} bibliographic entries. Metadata and abstracts are not represented as full-text reading; retrieval does not establish novelty or exhaustive coverage."),
        ("3. Data and Frozen Selection", methods), ("4. Runtime and Timing Protocol", timing), ("5. Measured Results", results),
        ("6. Discussion", discussion), ("7. Limitations and Quality Status", limitations), ("8. Reproducibility", reproduce)]
    references = []
    for index, record in enumerate(records, 1):
        authors = ", ".join(str(author) for author in record.get("authors", [])) or "Authors unavailable"
        references.append(f"[{index}] {authors}. {record.get('title', 'Title unavailable')}. {record.get('year') or 'Year unavailable'}. {record.get('url', '')} "
            f"(Acquisition scope: {record.get('reading_scope', 'metadata_only')}; full-text status: {record.get('full_text_status', 'not_requested')}).")
    (directory / "project_goal.txt").write_text(question, encoding="utf-8")
    write_json(directory / "model_analysis_unverified.json", {"source": "model_or_controller_provided", "status": "not_used_as_measured_evidence", "analysis": analysis})
    discussion_audit = {"status": "raw_preserved_not_used_as_measured_claims", "numeric_source": "registered CSV and latency observations", "semantic_review": "not_external_review"}
    write_json(directory / "discussion_audit.json", discussion_audit)
    chart = directory / "accuracy_latency.png"
    _plot(chart, summary)
    def table_rows(split: str) -> list[list[str]]:
        return [[str(row["imgsz"]), f"{row['map50_95']:.4f}", f"{row['map50']:.4f}", f"{row['precision']:.4f}", f"{row['recall']:.4f}", f"{row['latency_ms']:.3f} / {row['latency_sd_ms']:.3f}", f"{row['fps']:.2f}"] for row in summary if row["split"] == split]
    headers = ["Size", "mAP50-95", "mAP50", "Precision", "Recall", "Latency mean / SD (ms)", "FPS"]
    markdown = f"# {title}\n\nStatus: candidate inference report; novelty unverified; no independent generalization test; not submitted.\n\n"
    html_body = f"<h1>{html.escape(title)}</h1><p class='status'>Candidate inference report; novelty unverified; no independent generalization test; not submitted.</p>"
    tex = "\\documentclass[11pt]{article}\n\\usepackage[margin=1in]{geometry}\n\\begin{document}\n\\title{" + _tex_escape(title) + "}\n\\author{Author information not supplied}\n\\date{}\n\\maketitle\n"
    for heading, text in sections:
        markdown += f"## {heading}\n\n{text}\n\n"
        html_body += f"<h2>{html.escape(heading)}</h2><p>{html.escape(text)}</p>"
        tex += "\\section*{" + _tex_escape(heading) + "}\n" + _tex_escape(text) + "\n\n"
        if heading == "5. Measured Results":
            for split in ("selection", "evaluation"):
                cells = table_rows(split)
                markdown += f"### {split.title()} ({counts[split]} images)\n\n| " + " | ".join(headers) + " |\n| " + " | ".join(["---:"] * len(headers)) + " |\n"
                markdown += "\n".join("| " + " | ".join(row) + " |" for row in cells) + "\n\n"
                html_body += f"<h3>{split.title()} ({counts[split]} images)</h3><table><thead><tr>" + "".join(f"<th>{html.escape(cell)}</th>" for cell in headers) + "</tr></thead><tbody>"
                html_body += "".join("<tr>" + "".join(f"<td>{html.escape(cell)}</td>" for cell in row) + "</tr>" for row in cells) + "</tbody></table>"
                tex += "\\paragraph{" + split.title() + "}\n\\begin{tabular}{rrrrrrr}\nSize & mAP50-95 & mAP50 & P & R & ms (mean/SD) & FPS \\\\\n\\hline\n"
                tex += "\n".join(" & ".join(_tex_escape(cell) for cell in row) + r" \\" for row in cells) + "\n\\end{tabular}\n"
            markdown += "![Measured accuracy and mean latency](accuracy_latency.png)\n\n"
            encoded = base64.b64encode(chart.read_bytes()).decode("ascii")
            html_body += f"<img src='data:image/png;base64,{encoded}' alt='Measured accuracy and mean latency'>"
    markdown += "## References and Acquisition Scope\n\n" + ("\n\n".join(references) or "No literature successfully retrieved; related-work coverage is unavailable.") + "\n"
    html_body += "<h2>References and Acquisition Scope</h2>" + "".join(f"<p>{html.escape(reference)}</p>" for reference in references)
    tex += "\\section*{References and Acquisition Scope}\n" + "\n\n".join(_tex_escape(reference) for reference in references) + "\n\\end{document}\n"
    (directory / "paper.md").write_text(markdown, encoding="utf-8")
    (directory / "paper.html").write_text("<!doctype html><html lang='en'><meta charset='utf-8'><title>YOLO inference trade-off report</title><style>body{font:17px Georgia;max-width:980px;margin:40px auto;padding:0 20px;line-height:1.6;color:#17222e}table{border-collapse:collapse;width:100%;font:13px Arial}td,th{border:1px solid #aaa;padding:7px}img{max-width:100%}.status{color:#854400}</style>" + html_body + "</html>", encoding="utf-8")
    (directory / "paper.tex").write_text(tex, encoding="utf-8")
    pdf_status = _render_pdf(directory / "paper.pdf", title, sections, table_rows, counts, chart, references)
    quality = {"status": "candidate_report", "numeric_integrity": "verified_against_raw_csv", "data_hash_verified": True,
        "latency_integrity": "mean_sd_and_fps_recomputed_from_raw_observations", "novelty": "novelty_unverified", "external_review": "not_evaluated", "submission": "not_submitted",
        "independent_test": False, "pretraining_overlap_possible": True, "reproduction": "archived_evidence_only_portable_replay_unimplemented", "target_format": "generic preparation bundle; no venue-specific compliance asserted",
        "pdf": pdf_status, "latex": {"status": "source_generated_not_compiled"}, "model_analysis": "raw source retained separately; not used as measured evidence", "discussion": discussion_audit}
    write_json(directory / "quality_status.json", quality)
    paths = sorted(set(verified["evidence"]) | {path for path in directory.iterdir() if path.is_file() and path.name != "manuscript.json" and path.suffix != ".zip" and not path.name.startswith("qa-") and not path.name.endswith(".tmp")})
    archive_path = directory / "submission_bundle.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in paths:
            archive.write(path, path.relative_to(root).as_posix())
        archive.writestr("MANIFEST.sha256", "\n".join(f"{sha256_file(path)}  {path.relative_to(root).as_posix()}" for path in paths) + "\n")
        archive.writestr("REPRODUCE.txt", reproduce + "\n\nCOCO pretraining overlap is possible; no independent generalization confirmation or external submission occurred.\n")
    result = {"ok": True, "domain": "yolo_tradeoff", "status": "completed" if pdf_status["status"] == "generated" else "partial", "title": title, "revision": revision,
        "input_sha256": digest, "created_utc": datetime.now(timezone.utc).isoformat(), "quality": quality, "pdf": pdf_status, "summary": summary,
        "selected_imgsz": selected, "baseline_imgsz": 640, "difference_map50_95": map_difference, "difference_latency_ms": latency_difference,
        "artifacts": [artifact(path, path.suffix.lstrip(".")) for path in sorted(directory.iterdir()) if path.is_file() and path.name != "manuscript.json" and not path.name.startswith("qa-")]}
    write_json(saved_path, result)
    return {**result, "manifest": artifact(saved_path, "manuscript_manifest")}


def _render_pdf(path: Path, title: str, sections, table_rows, counts, chart: Path, references: list[str]) -> dict:
    status = {"status": "failed", "backend": "reportlab", "tex_compiled": False}
    try:
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
        normal_font, bold_font = "Times-Roman", "Helvetica-Bold"
        for normal, bold in ((Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")), (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))):
            if normal.is_file() and bold.is_file():
                if "ResearchSans" not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont("ResearchSans", str(normal)))
                    pdfmetrics.registerFont(TTFont("ResearchSansBold", str(bold)))
                normal_font, bold_font = "ResearchSans", "ResearchSansBold"
                break
        styles = getSampleStyleSheet()
        styles["Normal"].fontName = normal_font
        styles["Normal"].fontSize, styles["Normal"].leading = 10, 13
        for name in ("Title", "Heading2", "Heading3"):
            styles[name].fontName = bold_font
            styles[name].keepWithNext = True
        story = [Paragraph(html.escape(title), styles["Title"]), Paragraph("Candidate inference report. Pretraining overlap possible. No independent test. Not submitted.", styles["Normal"]), Spacer(1, 10)]
        for heading, text in sections:
            story.extend([Paragraph(html.escape(heading), styles["Heading2"]), Paragraph(html.escape(text), styles["Normal"])])
            if heading == "5. Measured Results":
                for split in ("selection", "evaluation"):
                    story.append(Paragraph(f"{split.title()} ({counts[split]} images)", styles["Heading3"]))
                    cells = [["Size", "mAP50-95", "mAP50", "Precision", "Recall", "ms mean / SD", "FPS"], *table_rows(split)]
                    table = Table(cells, repeatRows=1, colWidths=[37, 71, 60, 64, 60, 110, 50])
                    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e7f0ea")), ("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("FONTNAME", (0, 0), (-1, -1), normal_font), ("FONTSIZE", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
                    story.extend([table, Spacer(1, 7)])
                story.extend([Image(str(chart), width=480, height=179), Spacer(1, 6)])
                story.append(Paragraph("Only frozen selected and baseline configurations are measured on evaluation; lines connect measured points and do not show unmeasured results.", styles["Normal"]))
        story.append(Paragraph("References and Acquisition Scope", styles["Heading2"]))
        for reference in references:
            story.extend([Paragraph(html.escape(reference), styles["Normal"]), Spacer(1, 5)])
        def footer(canvas, document):
            canvas.saveState()
            canvas.setFont(normal_font, 8)
            canvas.drawString(42, 24, "Measured inference study - pretraining overlap possible - not submitted")
            canvas.drawRightString(570, 24, str(document.page))
            canvas.restoreState()
        SimpleDocTemplate(str(path), pagesize=(612, 792), rightMargin=42, leftMargin=42, topMargin=42, bottomMargin=42).build(story, onFirstPage=footer, onLaterPages=footer)
        return {"status": "generated", "backend": "reportlab", "tex_compiled": False, "path": str(path)}
    except Exception as exc:
        status["error"] = f"{type(exc).__name__}: {exc}"
        return status
