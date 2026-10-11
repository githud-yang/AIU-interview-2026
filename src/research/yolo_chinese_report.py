"""中文 YOLO 阅读稿：只从已校验的冻结证据导出，保留所有历史稿件。"""
from __future__ import annotations

import base64
import hashlib
import html
import json
from datetime import datetime, timezone
from pathlib import Path

from .domain import artifact, sha256_file, write_json
from .yolo_manuscript import _verify_experiment


def _chinese_font() -> Path:
    for path in (Path("C:/Windows/Fonts/simhei.ttf"),
                 Path("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
                 Path("/usr/share/fonts/truetype/arphic/uming.ttc")):
        if path.is_file():
            return path
    raise RuntimeError("中文 PDF 需要可嵌入的中文字体；当前未找到 SimHei 或文泉驿字体")


def _plot(path: Path, rows: list[dict], font_path: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.font_manager import FontProperties
    font = FontProperties(fname=str(font_path))
    figure, axes = plt.subplots(1, 2, figsize=(9, 3.5), constrained_layout=True)
    for split, label, color, marker in (("selection", "选择集", "#71717a", "o"),
                                        ("evaluation", "冻结评测集", "#0071e3", "s")):
        measured = [row for row in rows if row["split"] == split]
        for axis, field, scale in ((axes[0], "map50_95", 100), (axes[1], "latency_ms", 1)):
            axis.plot([row["imgsz"] for row in measured], [row[field] * scale for row in measured],
                      marker=marker, color=color, label=label)
    for axis in axes:
        axis.set_xlabel("输入尺寸（像素）", fontproperties=font)
        axis.set_xticks([320, 480, 640])
        axis.set_ylim(bottom=0)
        axis.grid(alpha=.2)
        axis.legend(prop=font, fontsize=9)
    axes[0].set_ylabel("mAP50-95（%）", fontproperties=font)
    axes[0].set_ylim(0, 100)
    axes[1].set_ylabel("平均端到端延迟（毫秒/张）", fontproperties=font)
    figure.savefig(path, dpi=170)
    plt.close(figure)


def _sections(verified: dict, literature: dict | list | None) -> tuple[list[tuple[str, str]], list[str]]:
    rows = verified["summary"]
    selected = verified["selected_imgsz"]
    indexed = {(row["split"], row["imgsz"]): row for row in rows}
    candidate, baseline = indexed[("evaluation", selected)], indexed[("evaluation", 640)]
    accuracy_pp = 100 * (candidate["map50_95"] - baseline["map50_95"])
    latency_ms = candidate["latency_ms"] - baseline["latency_ms"]
    latency_pct = 100 * (candidate["latency_ms"] / baseline["latency_ms"] - 1)
    conclusion = ("未在冻结评测中获得速度提升" if latency_ms >= 0 else "在冻结评测中测得较低平均延迟")
    protocol, environment = verified["protocol"], verified["environment"]
    counts = protocol["counts"]
    records = literature if isinstance(literature, list) else (literature or {}).get("records", [])
    scope_names = {"metadata_only": "元数据", "metadata_and_abstract": "元数据与摘要",
                   "full_text": "公开全文", "full_text_extracted": "公开全文提取文本"}
    references = []
    for number, record in enumerate(records, 1):
        authors = "、".join(str(author) for author in record.get("authors", [])) or "作者信息未记录"
        scope = scope_names.get(record.get("reading_scope"), record.get("reading_scope", "元数据"))
        references.append(f"[{number}] {authors}。{record.get('title', '题名未记录')}。"
                          f"{record.get('year') or '年份未记录'}。{record.get('url', '')}。"
                          f"记录的阅读范围：{scope}；全文获取状态：{record.get('full_text_status', '未请求')}。")
    sections = [
        ("摘要", f"本研究考察固定 YOLO 权重下，输入尺寸对检测精度与单张推理延迟的影响。"
         f"采用 COCO128 公开样例，划分 {counts['selection']} 张选择图像与 {counts['evaluation']} 张评测图像，"
         f"比较 320、480、640 三种输入尺寸。仅在选择集上，按相对于 640 的 mAP50-95 损失不超过 0.02 的约束，"
         f"选取平均延迟最低的尺寸，并在评测前冻结为 {selected}。冻结评测中，{selected} 与 640 的 mAP50-95 分别为 "
         f"{candidate['map50_95'] * 100:.4f}% 与 {baseline['map50_95'] * 100:.4f}%，平均延迟分别为 "
         f"{candidate['latency_ms']:.4f} 与 {baseline['latency_ms']:.4f} 毫秒/张。"
         f"结论是：本轮选定配置{conclusion}，较小尺寸不保证更快。本文提供可追溯的配置比较与测量结果，"
         "研究范围限于当前权重、样例数据和硬件环境。"),
        ("1. 研究问题与工作范围", "目标检测部署需要在精度与响应时间之间作出选择。输入尺寸是可直接控制的部署参数，"
         "但缩小输入后，预处理、推理和后处理的组合开销不一定按像素数量同比下降。"
         "本次问题因此具体化为：在相同权重、数值精度、批大小与设备下，能否在保留检测精度的约束内降低单张平均延迟？"
         "研究只改变输入尺寸；不重新训练或微调权重，不引入新网络结构。该报告属于探索性推理基准与现场阅读稿。"),
        ("2. 文献与来源范围", f"原运行保存了 {len(records)} 条书目记录，参考资料在文末按当时实际获取的范围列出。"
         "元数据、摘要和公开全文提取文本分别记录，书目检索本身不能证明已完整阅读，也不能证明方法新颖。"
         "本文的数值结论全部来自本次登记的原始测量，而非文献摘要、写作分析或推测。期刊范围与投稿要求应另按官方指南核查。"),
        ("3. 数据与冻结协议", f"数据采用 COCO128。准备阶段剔除了 {len(protocol.get('excluded_coco8', []))} 个已知本地 COCO8 重叠图像，"
         f"以及 {len(protocol.get('excluded_missing_annotation', []))} 个缺少显式标注文件的样本。"
         f"划分种子为 {protocol.get('split_seed', '未记录')}，选择集与评测集图像标识不重叠。"
         "图像、标注、清单和划分均保留 SHA256。预训练权重仍可能见过 COCO 来源图像，剔除少量已知重叠不能消除预训练泄漏风险；"
         "这里的第二拆分因此称为冻结评测集，不称为独立泛化测试集。"),
        ("4. 候选选择与评测方法", f"先在选择集比较 320、480、640；以 640 为对照，保留 mAP50-95 绝对损失不超过 0.02 "
         f"（即 2 个百分点）的候选。在合格候选中选择平均延迟最低者；并列时依次选择较高 mAP50-95 和较小尺寸。"
         f"本轮选定 {selected}，在开启评测前冻结。评测集只运行选定配置与 640 对照，不在看过评测后追选其他尺寸。"
         "mAP50 指 IoU 为 0.50 时的平均精度；mAP50-95 汇总评估器在 0.50 至 0.95 阈值上的平均精度。"
         "精确率与召回率沿用登记评估器的操作点，不能脱离该评估设置作比较。"),
        ("5. 运行环境与计时口径", f"实际设备为 {environment.get('device_name', environment['device'])}，"
         f"使用 {environment['precision']}、batch=1；Python {environment.get('python_version', '未记录')}，"
         f"PyTorch {environment.get('torch_version', '未记录')}，Ultralytics {environment.get('ultralytics_version', '未记录')}。"
         "每项配置先预热 5 次，再对固定 10 张图重复 3 轮，保留全部 30 次逐张计时。"
         "延迟包含预处理、模型推理、后处理和需要的设备同步；不包含权重加载、图像文件读取与解码、数据下载、独立精度验证及预热。"
         "平均值与样本标准差由原始计时重算，FPS=1000/平均毫秒延迟，表示单图顺序调用的倒数估计。"
         "它不等于摄像头实测帧率，也不表示生产并发吞吐。相同图像与设备上的重复调用相互相关，30 次计时不等于 30 次独立研究复验。"),
        ("6. 实测结果", f"表 1 和表 2 分别报告选择集与冻结评测集的所有实际作业。检测指标来自对应拆分的全体图像，"
         f"延迟来自每项配置的 30 次计时调用。相对 640，选定 {selected} 的冻结评测 mAP50-95 变化为 {accuracy_pp:+.4f} 个百分点，"
         f"平均延迟变化为 {latency_ms:+.4f} 毫秒/张（{latency_pct:+.2f}%）。"
         f"因此，本轮{conclusion}。选择集中的最低延迟不能直接外推成冻结评测中的速度优势，"
         "选择集的精度约束也不保证评测集具有同样的差值上界。"),
        ("7. 讨论与部署含义", "测量结果支持按实际部署环境做配置比较，而不是预设更小输入一定更快。"
         "本轮保留了速度未改善的结果，这使配置建议能够回到测量事实，而不是只呈现有利结果。"
         "设备负载、功耗状态、算子形状与后处理工作量可能影响延迟，但这些只是待检验解释，本实验没有分别控制它们，不能认定为已证实原因。"
         "后续可在目标业务数据上固定新协议，比较端到端延迟、尾延迟与分类别误检漏检，再决定是否采用更小输入或进一步压缩模型。"),
        ("8. 局限与后续验证", "COCO128 是小型公开样例，不能代表真实部署分布；其与预训练数据的潜在重叠限制泛化解释。"
         "缺标注文件样本被剔除而非当作无目标图像，可能影响误检评估。单设备和有限计时对设备状态敏感，"
         "没有建立跨设备稳定性、并发能力或显著性结论。看过评测结果后若进一步调整配置、数据或方法，需要新的独立评测协议。"
         "现有结果不构成算法创新、外部同行评审或期刊录用证据；投稿前仍需独立数据、最接近工作对照和与目标期刊一致的格式核查。"),
        ("9. 证据、复现与版本", "本中文稿从既有 metrics.csv、latency_samples.csv、data_protocol.json、environment.json "
         "与 frozen_selection.json 重新校验并导出。导出前核查全部登记实验文件的 SHA256，重算平均延迟、标准差、FPS，"
         "并重放选择规则以验证冻结选择一致。原始英文稿及其历史版本保留，中文稿另存目录；本次新增训练、实验和模型调用均为 0。"
         "冻结 runner、权重标识、图像清单和环境记录支持审计；便携独立重放入口与新环境复现实验尚未验证。"
         "中文稿是技术阅读版本，尚未针对某期刊完成正式格式转换或提交。"),
    ]
    return sections, references


def _table_rows(summary: list[dict], split: str) -> list[list[str]]:
    return [[str(row["imgsz"]), f"{row['map50'] * 100:.4f}", f"{row['map50_95'] * 100:.4f}",
             f"{row['precision'] * 100:.2f} / {row['recall'] * 100:.2f}",
             f"{row['latency_ms']:.4f} / {row['latency_sd_ms']:.4f}", f"{row['fps']:.4f}"]
            for row in summary if row["split"] == split]


def _render_pdf(path: Path, title: str, sections: list, references: list,
                summary: list, chart: Path, font_path: Path) -> dict:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    font = "ResearchChinese"
    if font not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(font, str(font_path)))
    styles = getSampleStyleSheet()
    styles["Normal"].fontName = font
    styles["Normal"].fontSize, styles["Normal"].leading = 10, 17
    styles["Normal"].wordWrap = "CJK"
    styles["Normal"].spaceAfter = 10
    for key in ("Title", "Heading2", "Heading3"):
        styles[key].fontName = font
        styles[key].wordWrap = "CJK"
        styles[key].keepWithNext = True
    styles["Title"].fontSize, styles["Title"].leading = 20, 29
    styles["Heading2"].fontSize, styles["Heading2"].leading = 13, 20
    styles["Heading2"].spaceBefore, styles["Heading2"].spaceAfter = 14, 7
    cell_style = ParagraphStyle("ChineseCell", fontName=font, fontSize=8, leading=11, wordWrap="CJK", alignment=TA_CENTER)
    balanced_title = html.escape(title).replace("、", "、<br/>", 1)
    story = [Paragraph(balanced_title, styles["Title"]), Paragraph("中文技术阅读稿 · 固定权重精度与速度基准", styles["Normal"]), Spacer(1, 7)]
    for heading, text in sections:
        story.extend([Paragraph(html.escape(heading), styles["Heading2"]), Paragraph(html.escape(text), styles["Normal"])])
        if heading == "6. 实测结果":
            for split, name in (("selection", "表 1. 选择集"), ("evaluation", "表 2. 冻结评测集")):
                story.append(Paragraph(name, styles["Heading3"]))
                values = [["输入尺寸", "mAP50 (%)", "mAP50-95 (%)", "精确率 / 召回率 (%)", "延迟均值 / 标准差 (ms)", "FPS"], *_table_rows(summary, split)]
                cells = [[Paragraph(html.escape(cell), cell_style) for cell in row] for row in values]
                table = Table(cells, repeatRows=1, colWidths=[44, 69, 78, 99, 125, 72])
                table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f3f7")),
                    ("LINEBELOW", (0, 0), (-1, 0), .6, colors.HexColor("#a1a1aa")),
                    ("LINEBELOW", (0, 1), (-1, -1), .3, colors.HexColor("#d4d4d8")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
                story.extend([table, Spacer(1, 9)])
            story.extend([Image(str(chart), width=487, height=189),
                Paragraph("图 1. 选择与冻结评测的精度、延迟。连线仅连接已测配置；不代表未测尺寸的结果。", styles["Normal"])])
    story.append(Paragraph("参考资料与获取范围", styles["Heading2"]))
    for reference in references or ["本次未提供已登记书目；不得将其表述为已完成系统文献综述。"]:
        story.append(Paragraph(html.escape(reference), styles["Normal"]))
    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont(font, 8)
        canvas.setFillColor(colors.HexColor("#71717a"))
        canvas.drawString(48, 25, "YOLO 精度与速度基准 · 中文阅读稿")
        canvas.drawRightString(547, 25, str(document.page))
        canvas.restoreState()
    SimpleDocTemplate(str(path), pagesize=(595, 842), leftMargin=48, rightMargin=48,
                      topMargin=43, bottomMargin=43, title=title, author="").build(story, onFirstPage=footer, onLaterPages=footer)
    return {"status": "generated", "backend": "reportlab", "font": font_path.name, "language": "zh-CN", "path": str(path)}


def build_yolo_chinese_report(output_dir: str | Path, *, experiment: dict,
                              literature: dict | list | None = None, run_id: str | None = None,
                              directory_name: str = "reading_zh") -> dict:
    """Create a separate Chinese reading edition without changing frozen inputs.

    Returns registered-style artifacts for callers to add to their existing API.
    A matching export is reused after hash checks; differing inputs need a new
    directory name, never an overwrite of a previous reading edition.
    """
    root = Path(output_dir).resolve()
    if not directory_name or Path(directory_name).name != directory_name or directory_name in {".", ".."}:
        raise ValueError("中文稿目录必须是运行目录内的单级名称")
    directory = root / directory_name
    if directory.is_symlink():
        raise ValueError("中文稿目录不能使用符号链接")
    verified = _verify_experiment(experiment, root)
    digest = hashlib.sha256(json.dumps({"version": 1, "experiment": experiment, "literature": literature,
        "run_id": run_id}, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    manifest_path = directory / "reading_zh.json"
    if manifest_path.is_file():
        saved = json.loads(manifest_path.read_text(encoding="utf-8"))
        if saved.get("input_sha256") != digest:
            raise ValueError("既有中文稿对应不同输入，请使用新的版本目录")
        for item in saved.get("artifacts", []):
            path = Path(item["path"]).resolve()
            if not path.is_relative_to(directory) or not path.is_file() or sha256_file(path) != item["sha256"]:
                raise ValueError("已保存中文稿的产物哈希不一致")
        return {**saved, "manifest": artifact(manifest_path, "chinese_reading_manifest"), "reused": True}
    if directory.exists() and any(directory.iterdir()):
        raise ValueError("中文稿目录已有未登记文件，请使用新的版本目录")
    font_path = _chinese_font()
    directory.mkdir(parents=True, exist_ok=True)
    title = "固定 YOLO 权重下的输入尺寸、检测精度与推理延迟研究"
    sections, references = _sections(verified, literature)
    summary = verified["summary"]
    chart = directory / "accuracy_latency.zh.png"
    _plot(chart, summary, font_path)
    markdown = f"# {title}\n\n中文技术阅读稿 · 固定权重精度与速度基准\n\n"
    body = f"<header><p class='eyebrow'>中文技术阅读稿</p><h1>{html.escape(title)}</h1><p class='subtitle'>同一权重，固定协议，可追溯的精度与延迟测量。</p></header>"
    headers = ["输入尺寸", "mAP50 (%)", "mAP50-95 (%)", "精确率 / 召回率 (%)", "延迟均值 / 标准差 (ms)", "FPS"]
    for heading, text in sections:
        markdown += f"## {heading}\n\n{text}\n\n"
        body += f"<section><h2>{html.escape(heading)}</h2><p>{html.escape(text)}</p>"
        if heading == "6. 实测结果":
            for split, name in (("selection", "表 1. 选择集"), ("evaluation", "表 2. 冻结评测集")):
                values = _table_rows(summary, split)
                markdown += f"### {name}\n\n| " + " | ".join(headers) + " |\n| " + " | ".join(["---:"] * len(headers)) + " |\n"
                markdown += "\n".join("| " + " | ".join(row) + " |" for row in values) + "\n\n"
                body += f"<h3>{name}</h3><div class='table-scroll'><table><thead><tr>" + "".join(f"<th scope='col'>{html.escape(cell)}</th>" for cell in headers) + "</tr></thead><tbody>"
                body += "".join("<tr>" + "".join(f"<td>{html.escape(cell)}</td>" for cell in row) + "</tr>" for row in values) + "</tbody></table></div>"
            encoded = base64.b64encode(chart.read_bytes()).decode("ascii")
            body += f"<figure><img src='data:image/png;base64,{encoded}' alt='选择集和冻结评测集的精度与平均延迟对比'><figcaption>图 1. 连线仅连接已测配置，不表示未测尺寸的结果。</figcaption></figure>"
            markdown += "![精度与平均延迟对比](accuracy_latency.zh.png)\n\n"
        body += "</section>"
    markdown += "## 参考资料与获取范围\n\n" + "\n\n".join(references or ["本次未提供已登记书目。"])
    body += "<section><h2>参考资料与获取范围</h2>" + "".join(f"<p class='reference'>{html.escape(reference)}</p>" for reference in references or ["本次未提供已登记书目。未作系统文献综述声明。"] ) + "</section>"
    stylesheet = "body{font:16px/1.85 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#1d1d1f;background:#fff;margin:0}main{max-width:940px;padding:44px 28px;margin:auto}h1{font-size:32px;line-height:1.35;letter-spacing:-.03em;margin:8px 0 16px}h2{font-size:22px;line-height:1.5;margin:0 0 12px}h3{font-size:17px}.eyebrow{font-size:13px;color:#0071e3}.subtitle,figcaption{color:#6e6e73}header{padding-bottom:25px;border-bottom:1px solid #e5e5e7}section{padding-top:30px}p{margin:0 0 15px}table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}th,td{padding:12px 9px;border-bottom:1px solid #e5e5e7;text-align:right;white-space:nowrap}th{background:#f5f5f7;color:#515154;font-weight:500}.table-scroll{overflow:auto}figure{margin:24px 0}img{width:100%;height:auto}figcaption{font-size:12px}.reference{font-size:13px;overflow-wrap:anywhere}@media(max-width:600px){main{padding:24px 18px}h1{font-size:25px}h2{font-size:20px}}@media print{main{max-width:none;padding:0}section{break-inside:auto}h2,h3{break-after:avoid}table,figure{break-inside:avoid}}"
    (directory / "paper.zh.md").write_text(markdown + "\n", encoding="utf-8")
    (directory / "paper.zh.html").write_text("<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>YOLO 精度与速度研究 · 中文阅读稿</title><style>" + stylesheet + "</style></head><body><main>" + body + "</main></body></html>", encoding="utf-8")
    pdf = _render_pdf(directory / "paper.zh.pdf", title, sections, references, summary, chart, font_path)
    source_manifest = [{"path": str(path.relative_to(root).as_posix()), "sha256": sha256_file(path)} for path in sorted(verified["evidence"])]
    write_json(directory / "source_manifest.json", {"run_id": run_id, "sources": source_manifest,
        "new_training_fits": 0, "new_evaluation_jobs": 0, "new_model_calls": 0,
        "independent_test": False, "pretraining_overlap_possible": True})
    result = {"ok": True, "status": "completed", "domain": "yolo_tradeoff", "language": "zh-CN", "run_id": run_id,
        "title": title, "input_sha256": digest, "created_utc": datetime.now(timezone.utc).isoformat(),
        "selected_imgsz": verified["selected_imgsz"], "summary": summary, "pdf": pdf,
        "new_training_fits": 0, "new_evaluation_jobs": 0, "new_model_calls": 0,
        "artifacts": [artifact(path, "chinese_reading_" + path.suffix.lstrip(".")) for path in sorted(directory.iterdir()) if path.is_file()]}
    write_json(manifest_path, result)
    return {**result, "manifest": artifact(manifest_path, "chinese_reading_manifest")}


def export_yolo_chinese_reading(store, run_id: str, *, directory_name: str = "reading_zh") -> dict:
    """Append registered Chinese artifacts and one event; retain every old stage."""
    run = store.get(run_id)
    if run["status"] != "completed" or run.get("domain") != "yolo_tradeoff":
        raise ValueError("中文 YOLO 阅读稿只接受已完成的 YOLO 研究")
    if any(item["status"] in {"queued", "running", "cancelling"} for item in store.list_runs()):
        raise ValueError("研究正在运行，请完成或停止后再导出中文阅读稿")
    for item in run["artifacts"]:
        store.artifact_path(run_id, item["id"])
    result = build_yolo_chinese_report(store.run_dir(run_id),
        experiment=run["outputs"]["validation"], literature=run["outputs"].get("reading", {}),
        run_id=run_id, directory_name=directory_name)
    items = [store.artifact(run_id, item["path"], item["kind"])
             for item in [*result["artifacts"], result["manifest"]]]
    existing = {item["id"]: item for item in run["artifacts"]}
    for item in items:
        if item["id"] in existing and item != existing[item["id"]]:
            raise ValueError("中文产物与既有登记不一致，不覆盖原登记")
    added = [item for item in items if item["id"] not in existing]
    if added:
        def publish(current):
            current["outputs"]["chinese_reading"] = result
            ids = {item["id"] for item in current["artifacts"]}
            current["artifacts"].extend(item for item in added if item["id"] not in ids)
        store.update(run_id, mutate=publish, event={"type": "chinese_reading_exported", "stage": "manuscript",
            "status": "completed", "message": "中文阅读稿已导出，原始实验与英文历史稿保留；新增模型调用和评测均为 0",
            "data": {"directory": directory_name, "artifact_count": len(added),
                     "new_training_fits": 0, "new_evaluation_jobs": 0, "new_model_calls": 0}})
    return {**result, "registered_artifacts": items, "newly_registered": len(added)}


if __name__ == "__main__":
    import argparse
    from .store import ResearchStore
    parser = argparse.ArgumentParser(description="从冻结 YOLO 证据导出并登记独立中文阅读稿，不启动实验")
    parser.add_argument("run_id")
    parser.add_argument("--research-root", type=Path, default=Path(__file__).resolve().parents[2] / "logs/research")
    parser.add_argument("--directory", default="reading_zh")
    args = parser.parse_args()
    journal = ResearchStore(args.research_root)
    try:
        reading = export_yolo_chinese_reading(journal, args.run_id, directory_name=args.directory)
        print(json.dumps({"run_id": args.run_id, "newly_registered": reading["newly_registered"],
            "pdf": reading["pdf"]["path"], "new_model_calls": 0, "new_evaluation_jobs": 0}, ensure_ascii=False))
    finally:
        journal.close()
