"""
Deprecated helper for mock-exams-v1 Variant 1 LaTeX patching.

The DOCX content review was completed on 2026-05-07. The reviewed source of
truth is now:

  docs/delivery/features/mock-exams-v1/source/variant1-tasks.json
  docs/delivery/features/mock-exams-v1/source/variant1-review.md

Do not use this script to patch the JSON again: the original draft patches had
known wrong assumptions for KIM 17 and KIM 23 and stale review markers.
"""

import sys


def main() -> int:
    print(
        "Deprecated: variant1-tasks.json has already been manually reviewed "
        "against the DOCX. Edit the reviewed JSON directly and regenerate the "
        "seed with scripts/build-mock-exam-seed.py.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
