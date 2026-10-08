"""Public scholarly metadata and arXiv full-text acquisition with honest degradation."""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import httpx

from src.research.domain import artifact, write_json

USER_AGENT = "AIU-Research-Harness/1.0 (public academic metadata; local educational project)"
ARXIV_ID = re.compile(r"^(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]+/\d{7})(?:v\d+)?$", re.IGNORECASE)


def _text(value: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", value or "")).strip()


async def _request(client: httpx.AsyncClient, url: str, *, params=None, attempts=2) -> httpx.Response:
    for attempt in range(attempts):
        response = await client.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=25)
        if response.status_code in (429, 503) and attempt < attempts - 1:
            # Bounded backoff; do not turn an API Retry-After into an unbounded sleep.
            delay = response.headers.get("Retry-After", "3")
            await asyncio.sleep(min(6, max(3, int(delay) if delay.isdigit() else 3)))
            continue
        response.raise_for_status()
        return response
    raise RuntimeError("request exhausted")


async def search_literature(query: str, output_dir: str | Path, max_results: int = 6, *, client: httpx.AsyncClient | None = None) -> dict:
    if not isinstance(query, str) or not query.strip() or len(query) > 500:
        raise ValueError("literature query must contain 1-500 characters")
    if not 1 <= max_results <= 20:
        raise ValueError("max_results must be 1-20")
    if client is None:
        async with httpx.AsyncClient(follow_redirects=True) as owned:
            return await search_literature(query, output_dir, max_results, client=owned)
    directory = Path(output_dir).resolve() / "literature"
    directory.mkdir(parents=True, exist_ok=True)
    records = []
    source_status = []
    started = time.monotonic()
    timestamp = datetime.now(timezone.utc).isoformat()
    # Independent sources: a failure is preserved; one working source is partial coverage.
    for source in ("crossref", "arxiv"):
        try:
            if source == "crossref":
                response = await _request(client, "https://api.crossref.org/works", params={"query.bibliographic": query, "rows": max_results, "filter": "type:journal-article"})
                raw = response.json()
                write_json(directory / "crossref_raw.json", raw)
                for item in raw.get("message", {}).get("items", []):
                    doi = item.get("DOI")
                    if not doi or not item.get("title"):
                        continue
                    dates = item.get("published", item.get("issued", {})).get("date-parts", [[]])
                    records.append({"id": "doi:" + doi.lower(), "source": "crossref", "doi": doi, "arxiv_id": None,
                        "title": _text(item["title"][0]), "authors": [_text(" ".join((a.get("given", ""), a.get("family", "")))) for a in item.get("author", [])],
                        "year": dates[0][0] if dates and dates[0] else None, "url": item.get("URL", "https://doi.org/" + doi),
                        "abstract": _text(item.get("abstract")), "reading_scope": "metadata_and_abstract" if item.get("abstract") else "metadata_only",
                        "full_text_status": "not_requested", "retrieved_utc": timestamp})
            else:
                # Limit query syntax to literal terms, not user-controlled arXiv operators.
                terms = re.findall(r"[\w\-]+", query, flags=re.UNICODE)[:18]
                expression = " AND ".join('all:"' + term + '"' for term in terms)
                response = await _request(client, "https://export.arxiv.org/api/query", params={"search_query": expression, "start": 0, "max_results": max_results, "sortBy": "relevance"})
                (directory / "arxiv_raw.xml").write_text(response.text, encoding="utf-8")
                ns = {"a": "http://www.w3.org/2005/Atom", "x": "http://arxiv.org/schemas/atom"}
                tree = ET.fromstring(response.text)
                fallback_used = False
                if not tree.findall("a:entry", ns) and len(terms) > 2:
                    # An all-terms intersection may be empty. Broaden honestly and
                    # retain both queries so downstream review can reject irrelevant hits.
                    await asyncio.sleep(3)
                    anchors = [term for term in terms if term.lower() in {"handwritten", "digits", "mnist", "image", "images", "classification", "recognition"}]
                    modifiers = [term for term in terms if term not in anchors]
                    if anchors and modifiers:
                        expression = "(" + " OR ".join('all:"' + term + '"' for term in anchors) + ") AND (" + " OR ".join('all:"' + term + '"' for term in modifiers) + ")"
                    else:
                        expression = " OR ".join('all:"' + term + '"' for term in terms)
                    response = await _request(client, "https://export.arxiv.org/api/query", params={"search_query": expression, "start": 0, "max_results": max_results, "sortBy": "relevance"})
                    (directory / "arxiv_broadened_raw.xml").write_text(response.text, encoding="utf-8")
                    tree = ET.fromstring(response.text)
                    fallback_used = True
                for entry in tree.findall("a:entry", ns):
                    ident = (entry.findtext("a:id", "", ns)).split("/abs/")[-1]
                    if not ARXIV_ID.fullmatch(ident):
                        continue
                    published = entry.findtext("a:published", "", ns)
                    records.append({"id": "arxiv:" + ident, "source": "arxiv", "doi": entry.findtext("x:doi", None, ns), "arxiv_id": ident,
                        "title": _text(entry.findtext("a:title", "", ns)), "authors": [_text(a.findtext("a:name", "", ns)) for a in entry.findall("a:author", ns)],
                        "year": int(published[:4]) if published[:4].isdigit() else None, "url": "https://arxiv.org/abs/" + ident,
                        "abstract": _text(entry.findtext("a:summary", "", ns)), "reading_scope": "metadata_and_abstract", "full_text_status": "not_requested", "retrieved_utc": timestamp})
            source_status.append({"source": source, "status": "success", "http_status": response.status_code,
                **({"query_used": expression, "broadened_query": fallback_used} if source == "arxiv" else {"filter": "type:journal-article"})})
        except Exception as exc:
            source_status.append({"source": source, "status": "failed", "error": f"{type(exc).__name__}: {exc}"})
    deduplicated = {}
    # Prefer arXiv's record when its DOI duplicates Crossref, for a concrete full-text route.
    for record in records:
        key = (record.get("doi") or record["id"]).lower()
        deduplicated[key] = record
    records = list(deduplicated.values())
    succeeded = sum(source["status"] == "success" for source in source_status)
    result = {"ok": bool(records), "status": "completed" if succeeded == 2 and records else "partial" if records else "unavailable",
        "query": query, "sources": source_status, "records": records,
        "retrieved_utc": timestamp, "duration_seconds": time.monotonic() - started,
        "coverage": "bounded Crossref/arXiv search; not an exhaustive novelty search; metadata is not full-text reading",
        "artifacts": []}
    write_json(directory / "search.json", result)
    result["artifacts"] = [artifact(path, "literature_source") for path in sorted(directory.iterdir()) if path.is_file()]
    return result


async def acquire_full_text(records: list[dict], output_dir: str | Path, max_papers: int = 3, *, client: httpx.AsyncClient | None = None, max_bytes: int = 12_000_000) -> dict:
    if not 0 <= max_papers <= 10:
        raise ValueError("max_papers must be 0-10")
    if client is None:
        async with httpx.AsyncClient(follow_redirects=True) as owned:
            return await acquire_full_text(records, output_dir, max_papers, client=owned, max_bytes=max_bytes)
    directory = Path(output_dir).resolve() / "literature"
    directory.mkdir(parents=True, exist_ok=True)
    enriched, artifacts, attempted, succeeded = [], [], 0, 0
    for original in records:
        record = dict(original)
        ident = record.get("arxiv_id")
        if not ident:
            record.update(full_text_status="metadata_only", full_text_error="No implemented public full-text route for this Crossref record; publisher access is not assumed.")
        elif not ARXIV_ID.fullmatch(ident):
            record.update(full_text_status="failed", full_text_error="invalid arXiv identifier")
        elif attempted >= max_papers:
            record.update(full_text_status="not_requested_budget")
        else:
            attempted += 1
            basename = "arxiv_" + re.sub(r"[^A-Za-z0-9._-]", "_", ident)
            path = directory / (basename + ".pdf")
            try:
                # Fixed arXiv host, streamed byte cap; never follow publisher/metadata URLs.
                async with client.stream("GET", "https://arxiv.org/pdf/" + ident, headers={"User-Agent": USER_AGENT}, timeout=35) as response:
                    response.raise_for_status()
                    chunks, size = [], 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > max_bytes:
                            raise ValueError("PDF exceeds bounded download size")
                        chunks.append(chunk)
                content = b"".join(chunks)
                if not content.startswith(b"%PDF-"):
                    raise ValueError("full-text endpoint returned non-PDF content")
                path.write_bytes(content)
                pdf_record = artifact(path, "source_pdf")
                artifacts.append(pdf_record)
                record.update(full_text_status="downloaded_unparsed", pdf_path=str(path), pdf_sha256=pdf_record["sha256"], reading_scope="metadata_and_abstract")
                try:
                    from pypdf import PdfReader
                    reader = PdfReader(path)
                    pages = [{"page": i + 1, "text": page.extract_text() or ""} for i, page in enumerate(reader.pages)]
                    text_path = directory / (basename + ".pages.json")
                    write_json(text_path, {"source_id": record["id"], "source_sha256": pdf_record["sha256"], "pages": pages})
                    artifacts.append(artifact(text_path, "source_page_text"))
                    count = sum(len(page["text"].strip()) for page in pages)
                    record.update(full_text_status="parsed" if count >= 200 else "needs_ocr", reading_scope="full_text_extracted" if count >= 200 else "metadata_and_abstract", extracted_characters=count, pages=len(pages), page_text_path=str(text_path), extraction_warning="PDF text extraction may lose formulas/tables; page numbers retained, no OCR or semantic correctness guarantee")
                except Exception as exc:
                    record["full_text_error"] = f"PDF saved; text extraction failed: {type(exc).__name__}: {exc}"
                if record["full_text_status"] == "parsed":
                    succeeded += 1
            except Exception as exc:
                record.update(full_text_status="failed", full_text_error=f"{type(exc).__name__}: {exc}")
        enriched.append(record)
    result = {"ok": succeeded > 0, "status": "completed" if attempted and succeeded == attempted else "partial" if succeeded else "unavailable", "attempted": attempted, "parsed": succeeded, "records": enriched, "artifacts": artifacts, "coverage": "arXiv public PDFs only; unavailable/metadata-only entries remain explicit"}
    path = directory / "full_text.json"
    write_json(path, result)
    result["artifacts"].append(artifact(path, "full_text_manifest"))
    return result
