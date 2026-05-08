"""
Take parsed mock-exam JSON and produce two artifacts:
  1. tasks.json — clean intermediate, one entry per kim 1..26
  2. review.md  — human review document for Egor (one section per task,
                  with image filenames noted, math-warnings flagged,
                  Part 1 expected answer pre-filled from answer table,
                  Part 2 solution outline pre-filled from "Возможное решение")

Anchor strategy:
  - Find idx of "Часть 1" + "Часть 2" + "Система оценивания" + "Критерии оценивания выполнения заданий с развёрнутым ответом"
  - Within Часть 1 region: walk forward, find paragraphs whose .text matches
    /^(\d{1,2})$/ exactly, treat them as kim_number markers in order 1..20
  - Within Часть 2 region: same logic, expecting markers 21..26
  - Body = paragraphs between marker N and marker N+1 (excluding markers, "Ответ: ___" placeholder,
    and trailing whitespace-only entries)
  - Anomaly handling: if body for task N is empty (because Egor mis-ordered marker),
    mark with `_layout_anomaly: true`, leave body empty for manual fill-in

Answer key extraction:
  - In the table at idx ~394-437, parse rows: (kim_number, answer, kim_number, answer)
  - Map to part1_answer field per task

Part 2 solution extraction:
  - For each task 21-26, find its "Возможное решение" table after idx 438+
  - Capture solution paragraphs (the multi-step explanation)
  - Capture the boxed final answer (e.g. "Ответ: L = 1,8 м")
  - Capture max_score from the criteria block (typical: 3 for full)

Usage:
  python scripts/structure-mock-exam.py <parsed_json> <out_tasks_json> <out_review_md>
"""

import json
import re
import sys
from pathlib import Path

TASK_MARKER_RE = re.compile(r"^(\d{1,2})$")
PERCENT_NOISE_RE = re.compile(r"^[%\s]+$")  # idx 323 has stray '%'

# Per spec + grading rules (idx 391-393), Part 1 check_modes:
CHECK_MODE_BY_KIM = {
    1: "strict", 2: "strict", 3: "strict", 4: "strict",
    5: "multi_choice",
    6: "ordered",
    7: "strict", 8: "strict",
    9: "multi_choice",
    10: "ordered",
    11: "strict", 12: "strict", 13: "strict",
    14: "multi_choice",
    15: "ordered",
    16: "strict",
    17: "ordered",
    18: "multi_choice",
    19: "pair",
    20: "task20",
    21: "manual", 22: "manual", 23: "manual", 24: "manual", 25: "manual", 26: "manual",
}

# Max score per kim from answer-key table + criteria sections:
# 1-4, 7, 8, 11-13, 16, 19, 20 → 1 балл (per idx 391)
# 5, 9, 14, 18 (multi-choice) → 2 балла (per idx 393)
# 6, 10, 15, 17 (ordered) → 2 балла (per idx 392)
# Part 2 verified against source docx criteria:
# 21 → 3, 22 → 2, 23 → 2, 24 → 3, 25 → 3, 26 → 4.
MAX_SCORE_BY_KIM = {
    1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 1, 8: 1, 9: 2, 10: 2,
    11: 1, 12: 1, 13: 1, 14: 2, 15: 2, 16: 1, 17: 2, 18: 2, 19: 1, 20: 1,
    21: 3, 22: 2, 23: 2, 24: 3, 25: 3, 26: 4,
}

# Topic mapping per Egor's variant content (rough — Egor will refine):
TOPIC_BY_KIM = {
    1: "Кинематика — графики движения",
    2: "Динамика — 2-й закон Ньютона",
    3: "Энергия — кинетическая, потенциальная",
    4: "Колебания — пружинный маятник",
    5: "Кинематика — анализ графика x(t)",
    6: "Динамика — броски, кинематика и энергия",
    7: "МКТ — изопроцессы",
    8: "Термодинамика — 1-е начало",
    9: "МКТ — диаграмма p-V",
    10: "МКТ — смесь газов",
    11: "Электричество — постоянный ток, q(t)",
    12: "Магнетизм — энергия катушки",
    13: "Колебательный контур — период",
    14: "Колебательный контур — динамика q(t)",
    15: "Радиосвязь — частота колебаний",
    16: "Ядерная физика — β⁻-распад",
    17: "Ядерная физика — α-распад изотопа",
    18: "Общие закономерности (множественный выбор)",
    19: "Измерения — динамометр с погрешностью",
    20: "Эксперимент — выбор схем",
    21: "МКТ — концентрация и плотность газа (объяснение)",
    22: "Кинематика — равноускоренное движение (расчёт)",
    23: "Электричество — внутреннее сопротивление (расчёт)",
    24: "МКТ — увлажнитель воздуха (расчёт)",
    25: "Оптика — линза и источники (расчёт)",
    26: "Динамика — доска с бруском, трение (расчёт)",
}


def find_section_idx(paras: list, label: str) -> int:
    for i, p in enumerate(paras):
        if p["text"].strip() == label:
            return i
    return -1


def find_first_section(paras: list, prefix: str, start: int = 0) -> int:
    for i in range(start, len(paras)):
        if paras[i]["text"].strip().startswith(prefix):
            return i
    return -1


def find_task_markers(paras: list, start_idx: int, end_idx: int, expected_range: range) -> dict:
    """Walk paras[start_idx:end_idx], find markers matching ^N$ in order. Return {N: paragraph_idx}."""
    expected = list(expected_range)
    out = {}
    cursor = 0
    for i in range(start_idx, end_idx):
        if cursor >= len(expected):
            break
        m = TASK_MARKER_RE.match(paras[i]["text"].strip())
        if not m:
            continue
        n = int(m.group(1))
        if n == expected[cursor]:
            out[n] = i
            cursor += 1
    return out


def is_answer_placeholder(text: str) -> bool:
    """'Ответ: ___ м.' / 'Ответ: ____' / 'Ответ:' / 'Ответ: (    ±    ) Н.' all end the task body."""
    if not text.startswith("Ответ"):
        return False
    if "___" in text:
        return True
    if text.strip() == "Ответ:":
        return True
    # Task 19 special: 'Ответ: (        ±        ) Н.'
    if "±" in text:
        return True
    return False


def extract_task_block(paras: list, start_marker_idx: int, end_marker_idx: int) -> dict:
    """Pull body paras between marker (excl.) and next marker (excl.).
    Stops at first 'Ответ: ___' anchor — anything after that belongs to next task
    (handles Egor's layout anomaly for tasks 4 and 7 where the body precedes the marker)."""
    body_paras = []
    images = []
    has_math = False
    seen_answer = False
    for i in range(start_marker_idx + 1, end_marker_idx):
        p = paras[i]
        text = p["text"].strip()
        if TASK_MARKER_RE.match(text):
            continue
        if PERCENT_NOISE_RE.match(text):
            continue
        if is_answer_placeholder(text):
            seen_answer = True
            continue
        # Anything after the first answer placeholder = anomaly, belongs to next task — drop
        if seen_answer:
            continue
        if text or p["images"]:
            body_paras.append(p)
            images.extend(p["images"])
            if p.get("has_math"):
                has_math = True
    return {
        "body_paras": body_paras,
        "images": list(dict.fromkeys(images)),
        "has_math": has_math,
    }


def fix_layout_anomalies(paras: list, out: dict) -> None:
    """For tasks where the marker comes AFTER the body (Egor's docx for tasks 4 and 7),
    walk BACKWARDS from the marker to find the orphan body paragraph.
    Stop at: previous task marker (don't cross), or after 4 paragraphs scanned."""
    for kim in range(2, 27):
        if not out[kim].get("_layout_anomaly"):
            continue
        marker_pos = out[kim]["marker_idx"]
        scan_limit = max(0, marker_pos - 5)
        for j in range(marker_pos - 1, scan_limit, -1):
            p = paras[j]
            text = p["text"].strip()
            if TASK_MARKER_RE.match(text):
                break
            if is_answer_placeholder(text) or PERCENT_NOISE_RE.match(text):
                continue
            if len(text) >= 50:
                # Collect images from the orphan body itself + any image-only paragraphs
                # immediately preceding it (e.g. idx 225 image8.png for task 7).
                orphan_imgs = list(p["images"])
                k = j - 1
                while k > scan_limit:
                    prev = paras[k]
                    prev_text = prev["text"].strip()
                    # Stop at any text content (we want only image-only paragraphs)
                    if prev_text and not is_answer_placeholder(prev_text) and not TASK_MARKER_RE.match(prev_text):
                        break
                    if prev["images"]:
                        orphan_imgs = prev["images"] + orphan_imgs
                    k -= 1

                out[kim]["task_text"] = text
                if orphan_imgs:
                    out[kim]["images"] = list(dict.fromkeys(orphan_imgs + out[kim]["images"]))
                out[kim]["_layout_anomaly"] = False
                out[kim]["_layout_anomaly_fixed"] = True
                # Remove orphan images from previous task (they leaked there)
                if kim - 1 in out and orphan_imgs:
                    out[kim - 1]["images"] = [
                        img for img in out[kim - 1]["images"]
                        if img not in orphan_imgs
                    ]
                    out[kim - 1]["_review_images"] = True
                break


def extract_answer_key(paras: list, criteria_start: int) -> dict:
    """Extract the (kim_number, answer) table sitting between 'Система оценивания' and 'Критерии'."""
    # The table is the one with header "Номер задания" / "Правильный ответ"
    answers = {}
    for i, p in enumerate(paras):
        if not p.get("table_ctx"):
            continue
        if p["text"].strip() == "Номер задания":
            # Found the header. Walk subsequent table rows and pair them up.
            tid = p["table_ctx"]["table_id"]
            cur_row = None
            row_cells = []
            for j in range(i, len(paras)):
                q = paras[j]
                tctx = q.get("table_ctx")
                if not tctx or tctx.get("table_id") != tid:
                    break
                row = tctx["row"]
                col = tctx["col"]
                if row != cur_row:
                    if cur_row is not None and cur_row > 0:
                        # Process previous row: pairs (col0,col1) + (col2,col3)
                        cells_by_col = {c["table_ctx"]["col"]: c["text"].strip() for c in row_cells}
                        try:
                            kim_a = int(cells_by_col.get(0, ""))
                            ans_a = cells_by_col.get(1, "").strip()
                            answers[kim_a] = ans_a
                        except ValueError:
                            pass
                        try:
                            kim_b = int(cells_by_col.get(2, ""))
                            ans_b = cells_by_col.get(3, "").strip()
                            answers[kim_b] = ans_b
                        except ValueError:
                            pass
                    row_cells = []
                    cur_row = row
                row_cells.append(q)
            # Final row
            if row_cells and cur_row > 0:
                cells_by_col = {c["table_ctx"]["col"]: c["text"].strip() for c in row_cells}
                try:
                    kim_a = int(cells_by_col.get(0, ""))
                    answers[kim_a] = cells_by_col.get(1, "").strip()
                except ValueError:
                    pass
                try:
                    kim_b = int(cells_by_col.get(2, ""))
                    answers[kim_b] = cells_by_col.get(3, "").strip()
                except ValueError:
                    pass
            break
    return answers


def extract_part2_solutions(paras: list, criteria_start: int) -> dict:
    """For each KIM 21..26, extract the 'Возможное решение' content + final answer.

    The criteria section is a sequence of: marker (e.g. '21'), task body (re-stated),
    image, then a table. The table contains:
      row 0: 'Возможное решение' header
      row 1: solution paragraphs (multi-row col 0)
      row 2: 'Критерии оценивания' header
      rows 3+: criteria with point values.
    """
    out = {}
    in_criteria = False
    current_kim = None
    pending_task_marker_text = None

    for i, p in enumerate(paras):
        if i < criteria_start:
            continue
        text = p["text"].strip()

        # Detect kim marker outside table (body container)
        if p.get("container") == "body":
            m = TASK_MARKER_RE.match(text)
            if m:
                n = int(m.group(1))
                if 21 <= n <= 26:
                    current_kim = n
                    if current_kim not in out:
                        out[current_kim] = {
                            "solution_paras": [],
                            "final_answer_text": None,
                            "marker_idx": i,
                        }
                    continue

        if current_kim is None:
            continue

        # Inside table — capture
        tctx = p.get("table_ctx")
        if tctx:
            # Header row "Возможное решение" — skip
            if text == "Возможное решение":
                continue
            # "Ответ:" row — capture as final_answer
            if text.startswith("Ответ:") and tctx.get("row") == 1:
                out[current_kim]["final_answer_text"] = text
                continue
            # Criteria header — stop capturing solution for this task
            if text == "Критерии оценивания выполнения задания" or text == "Баллы":
                continue
            # Solution paragraph row (typically row 1)
            if tctx.get("row") == 1 and tctx.get("col") == 0:
                if text or p["images"]:
                    out[current_kim]["solution_paras"].append({
                        "text": text,
                        "images": p["images"],
                        "has_math": p.get("has_math"),
                    })
    return out


def joined_text(body_paras: list) -> str:
    """Join body paragraph texts into single task_text. Note image-only paras → marker."""
    parts = []
    for p in body_paras:
        if p["text"]:
            parts.append(p["text"])
        elif p["images"]:
            parts.append(f"[РИСУНОК: {', '.join(p['images'])}]")
    return "\n\n".join(parts)


def build_review_md(out: dict, parsed: dict) -> str:
    """Produce a human-readable Markdown for Egor + Vladimir review."""
    lines = []
    lines.append("# Mock Exam: Тренировочный вариант 1 — review для Егора + Владимира")
    lines.append("")
    lines.append("Источник: `Тр_вариант 1.docx` от Егора, парсинг через `scripts/parse-mock-exam-docx.py` + `scripts/structure-mock-exam.py`.")
    lines.append("")
    lines.append("**Что сделать:**")
    lines.append("1. Пробежать по всем 26 задачам ниже")
    lines.append("2. Для каждой проверить: текст условия, **kim-номер** (особенно 4 и 7 — там layout anomaly), картинки (`imgN.ext`), ожидаемый ответ Части 1 (`expected_answer`)")
    lines.append("3. Для Части 2 (21–26) — проверить `solution_text` и `final_answer`")
    lines.append("4. **Math content** — формулы вытащены приближённо из OMML (Word-формул); там где `[MATH]` нужна сверка с docx")
    lines.append("5. Когда всё ок — Vladimir закоммитит `supabase/seed/mock_exams_variant_1.sql` и загрузит картинки в Lovable Cloud Studio")
    lines.append("")
    lines.append("**Картинки (92 файла):** будут загружены в bucket `mock-exam-variant-tasks` через Lovable Studio UI. Имена сохраним 1:1 — `imageN.ext` (где N = сквозной номер из docx).")
    lines.append("")
    lines.append("---")
    lines.append("")

    for kim in range(1, 27):
        task = out.get(kim, {})
        lines.append(f"## Задание {kim}")
        lines.append("")
        lines.append(f"- **part:** {1 if kim <= 20 else 2}")
        lines.append(f"- **check_mode:** `{CHECK_MODE_BY_KIM[kim]}`")
        lines.append(f"- **max_score:** {MAX_SCORE_BY_KIM[kim]}")
        lines.append(f"- **topic:** {TOPIC_BY_KIM[kim]}")
        if task.get("_layout_anomaly"):
            lines.append("- ⚠️ **layout anomaly** — kim-маркер в docx стоит после тела задачи. Текст подтянут из соседних paragraph-ов, проверить.")
        if task.get("has_math"):
            lines.append("- 🧮 **MATH** — задача содержит OMML-формулы; текст приближённый, сверить с docx.")
        if task.get("images"):
            lines.append(f"- **картинки:** {', '.join(task['images'])}")
        lines.append("")
        lines.append("**task_text:**")
        lines.append("")
        lines.append("```")
        lines.append(task.get("task_text", "(пусто — fill in manually)"))
        lines.append("```")
        lines.append("")
        if kim <= 20:
            ans = task.get("expected_answer", "(не найден в answer key)")
            lines.append(f"**expected_answer:** `{ans}`")
        else:
            sol_text = task.get("solution_text", "")
            final = task.get("final_answer", "")
            lines.append("**solution_text (черновик из 'Возможное решение'):**")
            lines.append("")
            lines.append("```")
            lines.append(sol_text or "(пусто — заполнить из docx вручную)")
            lines.append("```")
            lines.append("")
            lines.append(f"**final_answer:** `{final}`")
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def main():
    if len(sys.argv) < 4:
        print("usage: structure-mock-exam.py <parsed_json> <out_tasks_json> <out_review_md>", file=sys.stderr)
        sys.exit(2)
    parsed_path = Path(sys.argv[1])
    tasks_path = Path(sys.argv[2])
    review_path = Path(sys.argv[3])

    parsed = json.loads(parsed_path.read_text(encoding="utf-8"))
    paras = parsed["paragraphs"]

    chast1_idx = find_section_idx(paras, "Часть 1")
    chast2_idx = find_section_idx(paras, "Часть 2")
    grading_idx = find_first_section(paras, "Система оценивания", start=chast2_idx + 1)
    criteria_idx = find_first_section(paras, "Критерии оценивания выполнения заданий с развёрнутым ответом", start=grading_idx + 1)
    print(f"[info] sections: Часть1={chast1_idx} Часть2={chast2_idx} Система={grading_idx} Критерии={criteria_idx}", file=sys.stderr)

    # Find markers within Часть 1
    p1_markers = find_task_markers(paras, chast1_idx + 1, chast2_idx, range(1, 21))
    print(f"[info] Part 1 markers: {sorted(p1_markers.keys())}", file=sys.stderr)
    # Within Часть 2 (up to grading section)
    p2_markers = find_task_markers(paras, chast2_idx + 1, grading_idx, range(21, 27))
    print(f"[info] Part 2 markers: {sorted(p2_markers.keys())}", file=sys.stderr)

    # Build sorted list of all marker positions for boundary computation
    all_markers = sorted(list(p1_markers.items()) + list(p2_markers.items()), key=lambda x: x[1])

    out = {}
    for idx, (kim, marker_pos) in enumerate(all_markers):
        if idx + 1 < len(all_markers):
            end_pos = all_markers[idx + 1][1]
        else:
            end_pos = grading_idx if kim <= 20 else grading_idx
        block = extract_task_block(paras, marker_pos, end_pos)
        body_text = joined_text(block["body_paras"])
        out[kim] = {
            "kim_number": kim,
            "part": 1 if kim <= 20 else 2,
            "marker_idx": marker_pos,
            "task_text": body_text,
            "images": block["images"],
            "has_math": block["has_math"],
            "_layout_anomaly": not body_text.strip(),  # body empty = anomaly
        }

    # Fix layout anomalies before answer key (so review.md shows correct task texts)
    fix_layout_anomalies(paras, out)

    # Answer key for Part 1
    answer_key = extract_answer_key(paras, grading_idx)
    print(f"[info] answer key extracted: {sorted(answer_key.keys())}", file=sys.stderr)
    for kim, ans in answer_key.items():
        if kim in out:
            out[kim]["expected_answer"] = ans

    # Part 2 solutions
    p2_sols = extract_part2_solutions(paras, criteria_idx)
    print(f"[info] Part 2 solutions extracted: {sorted(p2_sols.keys())}", file=sys.stderr)
    for kim, sol in p2_sols.items():
        if kim in out:
            out[kim]["solution_text"] = "\n\n".join(
                p["text"] for p in sol["solution_paras"] if p["text"]
            )
            out[kim]["solution_images"] = list(dict.fromkeys(
                img for p in sol["solution_paras"] for img in p["images"]
            ))
            if sol["final_answer_text"]:
                out[kim]["final_answer"] = sol["final_answer_text"]

    # Write tasks.json
    tasks_path.write_text(
        json.dumps({"tasks": out, "answer_key": answer_key}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[ok] wrote {tasks_path}", file=sys.stderr)

    # Write review.md
    review_path.write_text(build_review_md(out, parsed), encoding="utf-8")
    print(f"[ok] wrote {review_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
