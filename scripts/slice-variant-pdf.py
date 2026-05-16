"""TASK-12 (2026-05-14) — slice variant1-tasks.pdf to remove answer leak.

Original `Тр_вариант 1.docx` (converted via docx2pdf in TASK-10) was 27 pages
and contained answer tables + Часть 2 solutions starting from page 14.
Student downloading the PDF on taking page (TASK-10 PDF button) could see
correct answers BEFORE submitting — critical security leak.

Solution: slice PDF to first N pages (default 13 — pages 1-13 contain only
Инструкция + Справочные данные + Часть 1 tasks (KIM 1-20) + Часть 2 tasks
(KIM 21-26) without answers/solutions). Page 14+ contains answer tables
and Часть 2 reference solutions, NEVER show to student.

Initial TASK-12 sliced to 24 pages — that was WRONG (still leaked answer
tables). TASK-14 fix re-sliced to 13 pages.

Run this script locally; replace the bucket file via Lovable Studio
(path `variant1/variant1.pdf`).

Usage:
  python scripts/slice-variant-pdf.py [--pages N] [--in path] [--out path]

Defaults match the canonical paths in the repo.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    print("ERROR: pypdf not installed. Run `pip install pypdf`.", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IN = REPO_ROOT / "docs/delivery/features/mock-exams-v1/source/variant1/variant1-tasks.pdf"
DEFAULT_OUT = DEFAULT_IN  # in-place replace by default
DEFAULT_PAGES = 13


def main() -> None:
    parser = argparse.ArgumentParser(description="Slice PDF to remove answer-key pages.")
    parser.add_argument(
        "--in",
        dest="src",
        default=str(DEFAULT_IN),
        help=f"Source PDF path (default: {DEFAULT_IN})",
    )
    parser.add_argument(
        "--out",
        dest="dst",
        default=None,
        help="Destination PDF path (default: in-place replace)",
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=DEFAULT_PAGES,
        help=f"Number of pages to keep (default: {DEFAULT_PAGES})",
    )
    args = parser.parse_args()

    src = Path(args.src)
    dst = Path(args.dst) if args.dst else src

    if not src.is_file():
        print(f"ERROR: source not found: {src}", file=sys.stderr)
        sys.exit(2)

    reader = PdfReader(str(src))
    total = len(reader.pages)
    if args.pages >= total:
        print(f"WARNING: --pages {args.pages} >= total {total}; nothing to slice")
        return

    writer = PdfWriter()
    for page in reader.pages[: args.pages]:
        writer.add_page(page)

    tmp = dst.with_suffix(dst.suffix + ".tmp")
    with open(tmp, "wb") as f:
        writer.write(f)
    os.replace(tmp, dst)

    print(f"OK sliced {src.name}: {total} -> {args.pages} pages")
    print(f"   written to {dst}")
    print()
    print("Next steps (manual):")
    print("  1. Vladimir uploads sliced PDF to Lovable Studio:")
    print("     Storage -> bucket `mock-exam-variant-pdfs` -> path `variant1/variant1.pdf`")
    print("     (replace existing file; same URL).")
    print("  2. Hard-reload student taking page in Lovable preview to bust browser cache.")
    print("  3. Verify page 14 of new PDF does NOT contain answer table.")


if __name__ == "__main__":
    main()
