"""Evidence-backed manuscript exports; PDF uses ReportLab, not a TeX compiler."""
from __future__ import annotations

import csv
import html
import hashlib
import json
import math
import re
import statistics
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from src.research.domain import artifact, sha256_file, write_json


def _verify_experiment(experiment: dict, root: Path) -> list[dict]:
    if experiment.get("status") != "completed" or not experiment.get("test_opened"):
        raise ValueError("manuscript requires a completed, frozen final-test experiment")
    for item in experiment.get("artifacts", []):
        path = Path(item["path"]).resolve()
        if not path.is_relative_to(root) or not path.is_file() or sha256_file(path) != item["sha256"]:
            raise ValueError("experiment evidence is outside the run or has a hash mismatch")
    metrics = root / "experiments" / "metrics.csv"
    if not any(Path(item["path"]).resolve() == metrics for item in experiment.get("artifacts", [])):
        raise ValueError("raw metrics.csv is not registered experiment evidence")
    with metrics.open(encoding="utf-8", newline="") as stream:
        raw = list(csv.DictReader(stream))
    summary = []
    seeds = experiment["recipe"]["seeds"]
    for label in ("baseline", "selected_candidate", "ablation_no_augmentation"):
        for condition in ("clean", "gaussian_noise"):
            rows = [row for row in raw if row["model"] == label and row["split"] == "test" and row["condition"] == condition]
            if len(rows) != len(seeds) or sorted(int(row["seed"]) for row in rows) != sorted(seeds):
                raise ValueError("final results do not have exactly one record per seed and condition")
            values = [float(row["accuracy"]) for row in rows]
            summary.append({"model": label, "condition": condition, "accuracy_mean": statistics.mean(values), "accuracy_sd": statistics.stdev(values), "macro_f1_mean": statistics.mean(float(row["macro_f1"]) for row in rows), "seeds_completed": len(rows)})
    proposed = experiment.get("summary", [])
    if len(proposed) != len(summary):
        raise ValueError("summary does not match raw experiment records")
    for actual, claim in zip(summary, proposed):
        for field in ("model", "condition", "seeds_completed"):
            if actual[field] != claim.get(field):
                raise ValueError("summary identifier/count differs from raw results")
        for field in ("accuracy_mean", "accuracy_sd", "macro_f1_mean"):
            if not math.isclose(actual[field], claim.get(field, float("nan")), rel_tol=1e-10, abs_tol=1e-10):
                raise ValueError("summary numeric claim differs from raw results")
    return summary


def _tex_escape(value: str) -> str:
    return "".join({"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}.get(char, char) for char in value)


def audit_discussion(analysis, summary, recipe):
    """Check numeric tokens, without treating model interpretation as peer review.

    Membership in measured values cannot prove that a sentence uses the right
    comparison or establishes causality. That semantic limit remains explicit.
    """
    if not isinstance(analysis, dict) or not isinstance(analysis.get("interpretation"), str):
        return "", {"status": "unavailable", "reason": "No structured model interpretation supplied"}
    pieces = [analysis["interpretation"], *analysis.get("limitations", [])]
    text = " ".join(p for p in pieces if isinstance(p, str)).strip()
    text = text.translate(str.maketrans({"–": "-", "—": "-", "‑": "-", "−": "-"}))
    facts = [1797, 64, 10, 16, 350, len(recipe["seeds"]), *recipe["seeds"], recipe["evaluation_noise_std"]]
    for config in recipe["candidates"]:
        facts.extend(value for value in config.values() if isinstance(value, (int, float)) and not isinstance(value, bool))
    measured = [row[field] for row in summary for field in ("accuracy_mean", "accuracy_sd", "macro_f1_mean")]
    indexed = {(r["model"], r["condition"]): r for r in summary}
    for condition in ("clean", "gaussian_noise"):
        for field in ("accuracy_mean", "macro_f1_mean"):
            difference = indexed[("selected_candidate", condition)][field] - indexed[("baseline", condition)][field]
            measured.extend([difference, abs(difference)])
    # Models commonly report fractions or percentages with 2-5 decimal places.
    facts.extend([value * scale for value in measured for scale in (1, 100)])
    invalid, checked = [], []
    pattern = r"(?<![\w.])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?(?!\w|\.\d)"
    for match in re.finditer(pattern, text):
        literal = match.group()
        value = float(literal)
        decimals = len(literal.split(".", 1)[1]) if "." in literal and "e" not in literal.lower() else 0
        # Integer quantities must match exactly; fractional numbers may be rounded.
        tolerance = 0.51 * 10 ** (-decimals) if decimals else 1e-8
        if not any(abs(value - fact) <= tolerance for fact in facts):
            invalid.append(literal)
        checked.append(literal)
    audit = {"status": "withheld_unknown_numbers" if invalid else "numeric_tokens_checked",
             "checked_tokens": checked, "unknown_tokens": invalid,
             "semantic_review": "not_external_review; numeric membership does not establish sentence correctness"}
    return ("" if invalid else text), audit


def build_manuscript(output_dir: str | Path, *, question: str, literature: dict | list, experiment: dict, analysis: dict | str | None = None, revision: int = 1) -> dict:
    """Render measured facts; LLM prose is never copied into quantitative claims.

    The archive is a preparation bundle. No channel-specific format compliance,
    author declaration, submission, acceptance or scientific novelty is asserted.
    """
    root = Path(output_dir).resolve()
    summary = _verify_experiment(experiment, root)
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ValueError("manuscript revision must be a positive integer")
    directory = root / ("manuscript" if revision == 1 else f"manuscript_v{revision}")
    directory.mkdir(parents=True, exist_ok=True)
    inputs = {"question": question, "literature": literature, "experiment": experiment, "analysis": analysis, "revision": revision}
    input_digest = hashlib.sha256(json.dumps(inputs, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()
    saved_path = directory / "manuscript.json"
    if saved_path.is_file():
        saved = json.loads(saved_path.read_text(encoding="utf-8"))
        if saved.get("input_sha256") != input_digest:
            raise ValueError("Existing manuscript revision is immutable; export a new revision")
        for item in saved["artifacts"]:
            path = Path(item["path"]).resolve()
            if not path.is_relative_to(root) or not path.is_file() or sha256_file(path) != item["sha256"]:
                raise ValueError("Saved manuscript artifact has a hash mismatch")
        return {**saved, "manifest": artifact(saved_path, "manuscript_manifest"), "reused": True}
    records = literature if isinstance(literature, list) else literature.get("records", [])
    config = experiment["recipe"]["candidates"][experiment["selected_index"]]
    noise = experiment["recipe"]["evaluation_noise_std"]
    seeds = experiment["recipe"]["seeds"]
    rows = {f"{row['model']}/{row['condition']}": row for row in summary}
    control = rows["baseline/gaussian_noise"]["accuracy_mean"]
    candidate = rows["selected_candidate/gaussian_noise"]["accuracy_mean"]
    difference = candidate - control
    clean_control = rows["baseline/clean"]["accuracy_mean"]
    clean_candidate = rows["selected_candidate/clean"]["accuracy_mean"]
    interpretation = ("improved" if difference > 0 else "reduced" if difference < 0 else "did not change")
    title = "A Reproducible Digits Classification Study under Gaussian Corruption"
    abstract = (f"We evaluate training-time Gaussian augmentation on the bundled sklearn digits dataset using {len(seeds)} random seeds and one fixed stratified holdout. "
        f"Candidate configurations are selected only by corrupted validation accuracy before final test evaluation. "
        f"Mean corrupted test accuracy is {candidate:.4f} for the selected candidate and {control:.4f} for the matched no-augmentation control "
        f"(difference {difference:+.4f}). Clean test accuracy is {clean_candidate:.4f} versus {clean_control:.4f} "
        f"(difference {clean_candidate-clean_control:+.4f}). This small synthetic-corruption study demonstrates a traceable automated research pipeline; "
        "it does not establish a novel algorithm or broad scientific superiority.")
    introduction = ("Robustness claims need explicit data separation, controlled comparisons and recoverable measurements. "
        "This study asks whether a bounded training-time noise augmentation recipe changes digit-classification accuracy under a fixed synthetic corruption. "
        "The initial user goal is preserved in project_goal.txt; the implemented scientific scope is limited to the declared digits experiment.")
    related = (f"The pipeline retrieved {len(records)} bibliographic records from implemented public sources. "
        "Entries are listed with their actual acquisition scope. Metadata and abstracts are not represented as full-text reading. "
        "Retrieval does not establish novelty, exhaustive coverage, or support for a specific causal claim.")
    method = (f"We use 1,797 samples with 64 pixel features and 10 labels from sklearn.datasets.load_digits. Pixel values are divided by 16. "
        f"One fixed stratified train/validation/test split uses fractions 60/20/20 (split seeds 2026/2027). Random seeds {', '.join(map(str, seeds))} share those indices and govern augmentation, estimator randomness and noise draws; no test index enters any candidate's training or validation set. "
        f"The selected estimator is {config['algorithm']}; standardization is {str(config['standardize']).lower()} and any scaler is fitted only to training data. "
        f"Its augmentation concatenates clean training examples with one Gaussian-noisy copy (standard deviation {config['augmentation_std']}, clipped to [0,1]). "
        f"Validation and test corruption use standard deviation {noise}, shared within a seed across compared models. "
        "Candidate selection uses mean corrupted validation accuracy. The selected recipe is frozen before any test predictions. "
        "The final baseline and no-augmentation ablation are the same matched estimator with identical selected hyperparameters and clean training only; "
        "the duplicated ablation label is an explicit control alias, not an additional independently fitted model.")
    params = (f"Logistic-regression C={config['regularization_c']} and max_iter=350; random-forest trees={config['trees']} and max_depth={config['max_depth']}. "
        "Only parameters belonging to the selected algorithm are active. The exact recipe, selection and fixed code snapshot are included.")
    result_text = (f"Training augmentation {interpretation} mean corrupted test accuracy by {difference:+.4f} on this protocol. "
        f"The clean-test difference is {clean_candidate-clean_control:+.4f}; any reduction is retained rather than hidden. "
        "Reported error bars are sample standard deviations across seeds, not confidence intervals. "
        "Seeds share the same held-out samples, so outcomes are dependent and no independent-significance claim is made. "
        "All seed/condition observations and individual predictions are retained in the raw CSV files; no unsuccessful outcome is filtered out.")
    limitations = ("This is a small benchmark with synthetic Gaussian corruption and a restricted declarative recipe family. "
        "It does not implement unconstrained model-written code, arbitrary datasets, device experiments or an isolated code-agent sandbox. "
        "Augmentation doubles training samples and consumes extra fitting work; timings and training counts are logged, and this is not an equal-compute comparison. "
        "Novelty is unverified, external review has not occurred, and the document is a candidate research report requiring scientific assessment. "
        "The original test remains exposed after this run; any subsequent adaptive recipe change must use a new independent holdout for confirmatory claims.")
    reproduce = ("Run experiments/fixed_runner.py with --recipe experiments/recipe.json --output reproduced in an environment matching experiments/environment.json. "
        "The bundled dataset hash, all split indices, frozen selection, algorithm parameters, warnings and per-seed predictions are included. "
        "The source runner never executes generated Python. PDF export is performed by ReportLab; paper.tex is generated source and has not been compiled by a TeX engine.")
    sections = [("Abstract", abstract), ("1. Introduction", introduction), ("2. Retrieved Literature", related),
        ("3. Methods", method + " " + params), ("4. Results", result_text)]
    discussion, discussion_audit = audit_discussion(analysis, summary, experiment["recipe"])
    if discussion:
        sections.append(("5. Model-assisted Discussion", discussion))
    sections.extend([("6. Limitations and Quality Status", limitations), ("7. Reproducibility", reproduce)])
    references = []
    for index, record in enumerate(records, 1):
        authors = ", ".join(record.get("authors", [])) or "Authors unavailable"
        reference = f"[{index}] {authors}. {record.get('title', 'Title unavailable')}. {record.get('year') or 'Year unavailable'}. {record.get('url', '')}"
        references.append(reference + f" (Acquisition scope: {record.get('reading_scope', 'metadata_only')}; full-text status: {record.get('full_text_status', 'not_requested')}).")
    # Preserve the raw interpretation and exact scope of numeric checks.
    write_json(directory / "model_analysis_unverified.json", {"source": "model_or_controller_provided", "status": "not_used_as_measured_evidence", "analysis": analysis})
    write_json(directory / "discussion_audit.json", discussion_audit)
    (directory / "project_goal.txt").write_text(question, encoding="utf-8")
    table_header = "| Model / condition | Accuracy mean | Seed SD | Macro F1 mean | Seeds |"
    table_rows = [f"| {row['model']} / {row['condition']} | {row['accuracy_mean']:.4f} | {row['accuracy_sd']:.4f} | {row['macro_f1_mean']:.4f} | {row['seeds_completed']} |" for row in summary]
    markdown = f"# {title}\n\nStatus: candidate report; novelty_unverified; external quality not evaluated; not submitted.\n\n"
    for heading, text in sections:
        markdown += f"## {heading}\n\n{text}\n\n"
        if heading == "4. Results":
            markdown += table_header + "\n| --- | ---: | ---: | ---: | ---: |\n" + "\n".join(table_rows) + "\n\n"
            if (root / "experiments" / "robustness.png").exists():
                markdown += "![Mean accuracy with seed standard deviation](../experiments/robustness.png)\n\n"
    markdown += "## References and Acquisition Scope\n\n" + ("\n\n".join(references) or "No literature successfully retrieved; related-work coverage is unavailable.") + "\n"
    (directory / "paper.md").write_text(markdown, encoding="utf-8")
    html_body = f"<h1>{html.escape(title)}</h1><p class='status'>Candidate report; novelty unverified; external quality not evaluated; not submitted.</p>"
    for heading, text in sections:
        html_body += f"<h2>{html.escape(heading)}</h2><p>{html.escape(text)}</p>"
        if heading == "4. Results":
            html_body += "<table><thead><tr><th>Model / condition</th><th>Accuracy mean</th><th>Seed SD</th><th>Macro F1</th><th>Seeds</th></tr></thead><tbody>"
            for row in summary:
                html_body += f"<tr><td>{html.escape(row['model'] + ' / ' + row['condition'])}</td><td>{row['accuracy_mean']:.4f}</td><td>{row['accuracy_sd']:.4f}</td><td>{row['macro_f1_mean']:.4f}</td><td>{row['seeds_completed']}</td></tr>"
            html_body += "</tbody></table>"
            if (root / "experiments" / "robustness.png").exists():
                import base64
                chart = base64.b64encode((root / "experiments" / "robustness.png").read_bytes()).decode("ascii")
                html_body += "<img src='data:image/png;base64," + chart + "' alt='Mean accuracy and seed standard deviation'>"
    html_body += "<h2>References and Acquisition Scope</h2>" + "".join(f"<p>{html.escape(reference)}</p>" for reference in references)
    (directory / "paper.html").write_text("<!doctype html><html lang='en'><meta charset='utf-8'><title>Digits robustness research report</title><style>body{font:17px Georgia;max-width:960px;margin:40px auto;padding:0 20px;line-height:1.6;color:#17222e}table{border-collapse:collapse;width:100%;font:13px Arial}td,th{border:1px solid #aaa;padding:8px}img{max-width:100%}.status{color:#854400}</style>" + html_body + "</html>", encoding="utf-8")
    tex = "\\documentclass[11pt]{article}\n\\usepackage[margin=1in]{geometry}\n\\begin{document}\n\\title{" + _tex_escape(title) + "}\n\\author{Automated research pipeline: author information not supplied}\n\\date{}\n\\maketitle\n"
    for heading, text in sections:
        tex += "\\section*{" + _tex_escape(heading) + "}\n" + _tex_escape(text) + "\n\n"
        if heading == "4. Results":
            tex += "\\begin{tabular}{lrrrr}\nModel/condition & Accuracy & SD & F1 & Seeds \\\\\n\\hline\n"
            for row in summary:
                short_label = {"baseline": "Control", "selected_candidate": "Candidate", "ablation_no_augmentation": "Ablation"}[row["model"]]
                tex += f"{short_label}/{_tex_escape(row['condition'])} & {row['accuracy_mean']:.4f} & {row['accuracy_sd']:.4f} & {row['macro_f1_mean']:.4f} & {row['seeds_completed']} \\\\\n"
            tex += "\\end{tabular}\n"
    tex += "\\section*{References and Acquisition Scope}\n" + "\n\n".join(_tex_escape(reference) for reference in references) + "\n\\end{document}\n"
    (directory / "paper.tex").write_text(tex, encoding="utf-8")
    pdf_status = {"status": "failed", "backend": "reportlab", "tex_compiled": False}
    try:
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
        styles = getSampleStyleSheet()
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        candidates = [(Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")),
                      (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))]
        normal_font, bold_font = "Times-Roman", "Helvetica-Bold"
        unicode_fonts = False
        for normal, bold in candidates:
            if normal.is_file() and bold.is_file():
                if "ResearchSans" not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont("ResearchSans", str(normal)))
                    pdfmetrics.registerFont(TTFont("ResearchSansBold", str(bold)))
                normal_font, bold_font, unicode_fonts = "ResearchSans", "ResearchSansBold", True
                break
        styles["Normal"].fontName = normal_font
        styles["Title"].fontName = bold_font
        styles["Heading2"].fontName = bold_font
        styles["Normal"].fontSize = 10
        styles["Normal"].leading = 13
        story = [Paragraph(html.escape(title), styles["Title"]), Paragraph("Candidate report. Novelty unverified. Not submitted.", styles["Normal"]), Spacer(1, 12)]
        for heading, text in sections:
            story.extend([Paragraph(heading, styles["Heading2"]), Paragraph(html.escape(text), styles["Normal"])])
            if heading == "4. Results":
                cells = [["Model/condition", "Accuracy", "Seed SD", "Macro F1", "N"]]
                for row in summary:
                    label = {"baseline": "Control", "selected_candidate": "Candidate", "ablation_no_augmentation": "Ablation"}[row["model"]]
                    cells.append([label + "/" + ("noise" if row["condition"] == "gaussian_noise" else "clean"), f"{row['accuracy_mean']:.4f}", f"{row['accuracy_sd']:.4f}", f"{row['macro_f1_mean']:.4f}", str(row["seeds_completed"])])
                table = Table(cells, repeatRows=1, splitByRow=0, colWidths=[180, 70, 70, 70, 30])
                table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e6edf5")), ("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("FONTNAME", (0, 0), (-1, -1), normal_font), ("FONTSIZE", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
                story.extend([Spacer(1, 8), table, Spacer(1, 8)])
                plot = root / "experiments" / "robustness.png"
                if plot.exists():
                    story.append(Image(str(plot), width=6.3 * inch, height=3.6 * inch))
        story.append(Paragraph("References and Acquisition Scope", styles["Heading2"]))
        for reference in references:
            pdf_reference = reference if unicode_fonts else reference.encode("ascii", "replace").decode("ascii")
            story.append(Paragraph(html.escape(pdf_reference), styles["Normal"]))
            story.append(Spacer(1, 5))
        pdf_path = directory / "paper.pdf"
        def footer(canvas, document):
            canvas.saveState()
            canvas.setFont(normal_font, 9)
            canvas.drawString(42, 24, "Candidate report - measured results, novelty unverified")
            canvas.drawRightString(570, 24, str(document.page))
            canvas.restoreState()
        SimpleDocTemplate(str(pdf_path), pagesize=(612, 792), rightMargin=42, leftMargin=42, topMargin=42, bottomMargin=42).build(story, onFirstPage=footer, onLaterPages=footer)
        pdf_status = {"status": "generated", "backend": "reportlab", "tex_compiled": False, "path": str(pdf_path), "unicode_bibliography": "Embedded Unicode Latin font; originals retained" if unicode_fonts else "ASCII fallback; original metadata retained in md/html/tex"}
    except Exception as exc:
        pdf_status["error"] = f"{type(exc).__name__}: {exc}"
    quality = {"status": "candidate_report", "numeric_integrity": "verified_against_raw_csv", "data_hash_verified": True,
        "novelty": "novelty_unverified", "external_review": "not_evaluated", "submission": "not_submitted", "target_format": "generic preparation bundle; no venue-specific compliance asserted", "pdf": pdf_status,
        "latex": {"status": "source_generated_not_compiled"}, "model_analysis": "raw source retained; numeric-checked discussion is interpretation, not new empirical evidence",
        "discussion": discussion_audit}
    write_json(directory / "quality_status.json", quality)
    all_paths = [path for folder in (root / "experiments", root / "literature", root / "method", directory) if folder.exists() for path in folder.rglob("*") if path.is_file() and path.suffix != ".zip" and path.name != "manuscript.json" and not path.name.startswith("qa-") and not path.name.endswith(".tmp") and not path.is_symlink()]
    manifest_lines = [f"{sha256_file(path)}  {path.relative_to(root).as_posix()}" for path in sorted(all_paths)]
    archive_path = directory / "submission_bundle.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in all_paths:
            archive.write(path, path.relative_to(root).as_posix())
        archive.writestr("MANIFEST.sha256", "\n".join(manifest_lines) + "\n")
        archive.writestr("REPRODUCE.txt", reproduce + "\n\nNo external submission occurred. Author information and venue-specific formatting remain unconfigured.\n")
    result = {"ok": True, "status": "completed" if pdf_status["status"] == "generated" else "partial", "title": title, "revision": revision,
        "input_sha256": input_digest,
        "created_utc": datetime.now(timezone.utc).isoformat(), "quality": quality, "pdf": pdf_status,
        "summary": summary, "difference_corrupted_accuracy": difference,
        "artifacts": [artifact(path, path.suffix.lstrip(".")) for path in sorted(directory.iterdir()) if path.is_file() and path.name != "manuscript.json" and not path.name.startswith("qa-")]}
    write_json(directory / "manuscript.json", result)
    return {**result, "manifest": artifact(directory / "manuscript.json", "manuscript_manifest")}
