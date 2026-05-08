"""
Parse Egor's Тр_вариант N.docx into structured JSON for mock_exams seed.

Output:
  - tasks: list of { kim_number, part, raw_text, image_refs[], inline_omml[], position }
  - rels: relationship_id → image_filename map
  - sections: detected section headings

Usage:
  python scripts/parse-mock-exam-docx.py <extracted_docx_dir> <output_json>

The extracted_docx_dir must contain word/document.xml, word/media/, word/_rels/document.xml.rels
"""

import json
import re
import sys
from pathlib import Path
from lxml import etree

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture"
M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

NS = {
    "w": W_NS, "r": R_NS, "a": A_NS, "pic": PIC_NS, "m": M_NS, "wp": WP_NS,
}

TASK_RE = re.compile(r"^\s*(Задание|Задача|№)\s*(\d{1,2})\b", re.IGNORECASE)


def load_relationships(rels_path: Path) -> dict:
    if not rels_path.exists():
        return {}
    tree = etree.parse(str(rels_path))
    root = tree.getroot()
    out = {}
    for rel in root.findall(f"{{{REL_NS}}}Relationship"):
        rid = rel.get("Id")
        target = rel.get("Target")
        rtype = rel.get("Type", "")
        if "image" in rtype.lower() and target:
            out[rid] = target.lstrip("/").replace("media/", "")
    return out


def extract_paragraph_text(p) -> str:
    """Pull all text runs from <w:p>, preserving order; ignore complex math for now (handled separately)."""
    parts = []
    for el in p.iter():
        tag = etree.QName(el).localname
        ns = etree.QName(el).namespace
        if ns == W_NS and tag == "t":
            parts.append(el.text or "")
        elif ns == W_NS and tag == "tab":
            parts.append("\t")
        elif ns == W_NS and tag == "br":
            parts.append("\n")
    return "".join(parts).strip()


def extract_paragraph_images(p, rels: dict) -> list:
    """Find embedded images in <w:p> via blip/r:embed."""
    refs = []
    for blip in p.iter(f"{{{A_NS}}}blip"):
        rid = blip.get(f"{{{R_NS}}}embed")
        if rid and rid in rels:
            refs.append(rels[rid])
    # Also check <v:imagedata> (older format) and <w:pict>
    for el in p.iter():
        rid = el.get(f"{{{R_NS}}}id") or el.get(f"{{{R_NS}}}embed")
        if rid and rid in rels:
            fname = rels[rid]
            if fname not in refs:
                refs.append(fname)
    return refs


def has_math(p) -> bool:
    """Detect inline OMML math in paragraph."""
    for _ in p.iter(f"{{{M_NS}}}oMath"):
        return True
    for _ in p.iter(f"{{{M_NS}}}oMathPara"):
        return True
    return False


def extract_omml_text(p) -> str:
    """Extract a rough textual approximation of math content (m:t elements)."""
    parts = []
    for mt in p.iter(f"{{{M_NS}}}t"):
        if mt.text:
            parts.append(mt.text)
    return "".join(parts)


def parse_document(extracted_dir: Path):
    doc_path = extracted_dir / "word" / "document.xml"
    rels_path = extracted_dir / "word" / "_rels" / "document.xml.rels"

    rels = load_relationships(rels_path)
    print(f"[info] loaded {len(rels)} image relationships", file=sys.stderr)

    tree = etree.parse(str(doc_path))
    root = tree.getroot()
    body = root.find(f"{{{W_NS}}}body")

    # Walk body in document order: <w:p> at top level + <w:p> inside <w:tbl> cells.
    # We tag each captured paragraph with its container kind so seed editing can
    # reason about table-vs-prose layout (Egor's answer keys live in tables).
    captured = []

    def walk(node, container, table_ctx=None):
        for child in node:
            tag = etree.QName(child).localname
            ns = etree.QName(child).namespace
            if ns != W_NS:
                continue
            if tag == "p":
                captured.append((child, container, table_ctx))
            elif tag == "tbl":
                # Begin table context: record cell coords
                row_idx = 0
                for tr in child.findall(f"{{{W_NS}}}tr"):
                    cell_idx = 0
                    for tc in tr.findall(f"{{{W_NS}}}tc"):
                        ctx = {"table_id": id(child), "row": row_idx, "col": cell_idx}
                        walk(tc, "table_cell", ctx)
                        cell_idx += 1
                    row_idx += 1
            elif tag == "sdt":
                content = child.find(f"{{{W_NS}}}sdtContent")
                if content is not None:
                    walk(content, container, table_ctx)

    walk(body, "body")
    print(f"[info] captured {len(captured)} paragraphs (incl. tables)", file=sys.stderr)

    out = []
    for idx, (p, container, table_ctx) in enumerate(captured):
        text = extract_paragraph_text(p)
        imgs = extract_paragraph_images(p, rels)
        math = has_math(p)
        omml_text = extract_omml_text(p) if math else ""

        if not text and not imgs and not math:
            continue

        out.append({
            "idx": idx,
            "text": text,
            "images": imgs,
            "has_math": math,
            "omml_text": omml_text,
            "container": container,
            "table_ctx": table_ctx,
        })

    return {
        "rels": rels,
        "rels_count": len(rels),
        "paragraphs": out,
        "paragraph_count": len(out),
    }


def detect_task_boundaries(parsed: dict) -> list:
    """Find paragraph indices where 'Задание N' appears, group following paragraphs."""
    boundaries = []
    for i, p in enumerate(parsed["paragraphs"]):
        m = TASK_RE.match(p["text"])
        if m:
            n = int(m.group(2))
            if 1 <= n <= 30:
                boundaries.append((i, n, p["text"]))
    return boundaries


def detect_sections(parsed: dict) -> list:
    """Find major section headings: 'Часть 1', 'Часть 2', 'Ответы', etc."""
    section_re = re.compile(r"(Часть\s*[12]|Ответы|Решени[ея])", re.IGNORECASE)
    out = []
    for i, p in enumerate(parsed["paragraphs"]):
        if len(p["text"]) < 100 and section_re.search(p["text"]):
            out.append({"idx": i, "text": p["text"]})
    return out


def main():
    if len(sys.argv) < 3:
        print("usage: parse-mock-exam-docx.py <extracted_dir> <output_json>", file=sys.stderr)
        sys.exit(2)
    extracted = Path(sys.argv[1])
    out_path = Path(sys.argv[2])

    parsed = parse_document(extracted)
    parsed["task_boundaries"] = detect_task_boundaries(parsed)
    parsed["sections"] = detect_sections(parsed)

    out_path.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ok] wrote {out_path} — {parsed['paragraph_count']} paragraphs, {len(parsed['task_boundaries'])} task boundaries, {len(parsed['sections'])} sections", file=sys.stderr)


if __name__ == "__main__":
    main()
