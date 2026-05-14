"""
Generate supabase/seed/mock_exams_variant_1.sql from tasks.json.

Idempotent: ON CONFLICT (id) DO NOTHING for variant + tasks. Re-running the seed
after edits to tasks.json regenerates the SQL with fixed UUIDv5 values, but does
not overwrite already-applied rows in production.

Storage path convention:
  storage://mock-exam-variant-tasks/variant1/<filename>

Vladimir uploads each image to Lovable Cloud Studio under bucket
`mock-exam-variant-tasks`, folder `variant1/`, preserving filename. WMF/EMF must
be converted to PNG locally before upload (browsers don't render WMF). Update
TASK_IMAGE_EXT_MAP if extensions change at upload time.

Usage:
  python scripts/build-mock-exam-seed.py <tasks_json> <out_seed_sql>
"""

import json
import re
import sys
import uuid
from pathlib import Path

# Strip the [РИСУНОК: imageN.ext] markers that the structurer inserts as
# placement hints. The seed stores image refs separately in task_image_url;
# the frontend renders them above task_text per existing homework convention.
PICTURE_MARKER_RE = re.compile(r"\[РИСУНОК:[^\]]+\]\s*", re.UNICODE)

# Instruction paragraphs that leak into task bodies because they sit between
# task markers in the docx flow. They're variant-level guidance, not task content.
INSTRUCTION_PREFIXES = (
    "Полное правильное решение каждой из задач",  # Part 2 generic instruction (between kim 21 and 22)
    "В бланк ответов № 1 перенесите",
    "Не забудьте перенести",
    "Проверьте, чтобы",
)


def strip_instruction_paragraphs(text: str) -> str:
    """Remove standalone instruction paragraphs from task body."""
    lines = text.split("\n\n")
    cleaned = [p for p in lines if not p.strip().startswith(INSTRUCTION_PREFIXES)]
    return "\n\n".join(cleaned)

# Stable namespace for UUIDv5 — never change. If changed, ALL fixed UUIDs
# rotate and seed becomes non-idempotent.
NS = uuid.UUID("00000000-0000-0000-0000-000000005ec0")

VARIANT_KEY = "mock-exam-variant-1-egor-physics-2026"
VARIANT_ID = str(uuid.uuid5(NS, VARIANT_KEY))

# Egor Blinov (egor.o.blinov@gmail.com) — pilot tutor, owner of variant 1.
# UUID resolved 2026-05-08 via SQL JOIN auth.users × public.tutors (commit 8185ec3).
# Hardcoded here so re-generation preserves the canonical owner; if Egor's account
# is rotated, replace this constant and re-run.
EGOR_UUID = "a7212758-8cdd-4d7c-8608-4fedcb34d74c"


def task_uuid(kim: int) -> str:
    return str(uuid.uuid5(NS, f"mock-exam-variant-1-task-{kim}"))


# Convert wmf/emf to png at upload time (Lovable Studio). jpeg stays as-is.
def storage_path(filename: str) -> str:
    base, dot, ext = filename.rpartition(".")
    ext_lower = ext.lower()
    if ext_lower in ("wmf", "emf"):
        ext_lower = "png"
    return f"storage://mock-exam-variant-tasks/variant1/{base}.{ext_lower}"


def serialize_task_image_url(images: list) -> str:
    """Match dual-format invariant: 0 → NULL, 1 → single string, 2+ → JSON-array string.
    See .claude/rules/40-homework-system.md (Multi-photo на задачу)."""
    if not images:
        return "NULL"
    paths = [storage_path(img) for img in images]
    if len(paths) == 1:
        return sql_str(paths[0])
    return sql_str(json.dumps(paths, ensure_ascii=False))


def sql_str(s: str) -> str:
    """Escape Russian/Latin string for PostgreSQL. Single quotes doubled.
    Backslashes don't need escaping in standard SQL strings (E'...' would; we use plain '')."""
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def sql_or_null(value: str) -> str:
    return "NULL" if value is None else sql_str(value)


def build_sql(tasks_data: dict) -> str:
    tasks = tasks_data["tasks"]

    lines = []
    lines.append("-- Mock Exams v1 — Тренировочный вариант 1 от Егора Иванова (физика ЕГЭ-2026)")
    lines.append("-- ----------------------------------------------------------------------")
    lines.append("-- Этот файл сгенерирован скриптом scripts/build-mock-exam-seed.py из")
    lines.append("-- tasks.json. НЕ редактировать вручную — править tasks.json и пересобирать.")
    lines.append("--")
    lines.append("-- Provenance:")
    lines.append("--   source docx: 'Тр_вариант 1.docx' от Егора Иванова, 2026-05-07")
    lines.append("--   parser: scripts/parse-mock-exam-docx.py")
    lines.append("--   structurer: scripts/structure-mock-exam.py")
    lines.append("--   generator: scripts/build-mock-exam-seed.py")
    lines.append("--   review file: docs/delivery/features/mock-exams-v1/source/variant1-review.md")
    lines.append("--")
    lines.append("-- UUIDs derived deterministically via uuid5(ns=00000000-0000-0000-0000-000000005ec0).")
    lines.append("-- Re-running generator with same tasks.json produces identical UUIDs.")
    lines.append("--")
    lines.append("-- Storage refs:")
    lines.append("--   storage://mock-exam-variant-tasks/variant1/<filename>")
    lines.append("-- Vladimir загружает картинки в Lovable Cloud Studio (bucket mock-exam-variant-tasks,")
    lines.append("-- папка variant1/). WMF/EMF ДОЛЖНЫ быть конвертированы в PNG до загрузки —")
    lines.append("-- браузеры не рендерят WMF/EMF. Список файлов: docs/delivery/features/mock-exams-v1/source/storage-upload-checklist.md")
    lines.append("--")
    lines.append("-- Применяется через Lovable Cloud auto-deploy после push в main.")
    lines.append("-- AC-3 (deterministic checker): ответы Части 1 пред-вычислены и видны")
    lines.append("-- в `correct_answer` ниже. После seed применения — `SELECT COUNT(*) FROM")
    lines.append("-- mock_exam_variant_tasks WHERE variant_id = '" + VARIANT_ID + "';' = 26.")
    lines.append("")
    lines.append("BEGIN;")
    lines.append("")
    lines.append("-- =====================================================================")
    lines.append("-- 1. Вариант — мета-данные")
    lines.append("-- =====================================================================")
    lines.append("")

    def max_for_task(kim: int) -> int:
        return int(tasks.get(str(kim), {}).get("max_score") or _max_score(kim))

    part1_max = sum(max_for_task(kim) for kim in range(1, 21))
    part2_max = sum(max_for_task(kim) for kim in range(21, 27))
    total_max = part1_max + part2_max

    # Variant insert. created_by — мы не знаем auth.users.id Егора в момент seed.
    # Решение: подставить через subquery по email Егора. Если email не найден —
    # FOREIGN KEY violation, миграция упадёт явно.
    lines.append("INSERT INTO public.mock_exam_variants (")
    lines.append("  id, title, exam_type, source, source_attribution,")
    lines.append("  duration_minutes, total_max_score, part1_max, part2_max, task_count,")
    lines.append("  created_by")
    lines.append(") VALUES (")
    lines.append(f"  '{VARIANT_ID}'::uuid,")
    lines.append("  'Тренировочный вариант 1 (физика ЕГЭ-2026)',")
    lines.append("  'ege_physics',")
    lines.append("  'tutor',")
    lines.append("  'Источник: репетитор Егор Иванов',  -- displayed source attribution; docx author signature")
    lines.append("  235,  -- 3ч 55мин")
    lines.append(f"  {total_max},   -- {part1_max} (Часть 1) + {part2_max} (Часть 2), verified against source docx criteria")
    lines.append(f"  {part1_max},")
    lines.append(f"  {part2_max},")
    lines.append("  26,")
    lines.append("  -- Egor Blinov (egor.o.blinov@gmail.com) — pilot tutor, owner of variant 1.")
    lines.append("  -- UUID resolved 2026-05-08 via SQL JOIN auth.users × public.tutors.")
    lines.append(f"  '{EGOR_UUID}'::uuid")
    lines.append(") ON CONFLICT (id) DO NOTHING;")
    lines.append("")

    lines.append("-- =====================================================================")
    lines.append("-- 2. Задачи варианта (26 шт)")
    lines.append("-- =====================================================================")
    lines.append("")

    for kim in range(1, 27):
        t = tasks[str(kim)]
        tid = task_uuid(kim)
        part = t["part"]
        check_mode = "manual" if part == 2 else _check_mode(kim)
        max_score = max_for_task(kim)
        topic = t.get("topic") or _topic(kim)

        task_text = PICTURE_MARKER_RE.sub("", t["task_text"]).strip()
        task_text = strip_instruction_paragraphs(task_text)
        # Collapse triple+ newlines left by stripping
        task_text = re.sub(r"\n{3,}", "\n\n", task_text).strip()
        correct_answer = t.get("expected_answer") if part == 1 else None
        solution_text = t.get("solution_text") if part == 2 else None
        images = t.get("images", [])
        anom_fixed = t.get("_layout_anomaly_fixed")
        review_imgs = t.get("_review_images")

        lines.append(f"-- --- Задание {kim} (part {part}, kim={kim}, max_score={max_score}, check_mode={check_mode}) ---")
        if anom_fixed:
            lines.append(f"-- ⚠️ layout anomaly в docx: маркер kim={kim} стоял ПОСЛЕ тела задачи.")
            lines.append("--    structurer перенёс body+images назад. Проверить визуально перед commit.")
        if review_imgs:
            lines.append(f"-- ℹ️ images могли утечь к/от соседней задачи (anomaly fix). Проверить.")
        lines.append(f"INSERT INTO public.mock_exam_variant_tasks (")
        lines.append(f"  id, variant_id, kim_number, part, order_num,")
        lines.append(f"  task_text, task_image_url, correct_answer, check_mode, max_score,")
        lines.append(f"  solution_text, topic")
        lines.append(f") VALUES (")
        lines.append(f"  '{tid}'::uuid,")
        lines.append(f"  '{VARIANT_ID}'::uuid,")
        lines.append(f"  {kim}, {part}, {kim},")
        lines.append(f"  {sql_str(task_text)},")
        lines.append(f"  {serialize_task_image_url(images)},")
        lines.append(f"  {sql_or_null(correct_answer)},")
        lines.append(f"  '{check_mode}',")
        lines.append(f"  {max_score},")
        lines.append(f"  {sql_or_null(solution_text)},")
        lines.append(f"  {sql_str(topic)}")
        lines.append(f") ON CONFLICT (id) DO NOTHING;")
        lines.append("")

    lines.append("COMMIT;")
    lines.append("")
    lines.append("-- Validation:")
    lines.append("-- SELECT COUNT(*) FROM public.mock_exam_variant_tasks WHERE variant_id = '" + VARIANT_ID + "';")
    lines.append("-- Expected: 26")
    lines.append("-- SELECT kim_number, part, check_mode, max_score, correct_answer FROM public.mock_exam_variant_tasks WHERE variant_id = '" + VARIANT_ID + "' ORDER BY kim_number;")
    lines.append("")

    return "\n".join(lines)


# Hardcoded mappings (mirror those in structure-mock-exam.py)
_CHECK_MODE_BY_KIM = {
    1: "strict", 2: "strict", 3: "strict", 4: "strict", 5: "multi_choice",
    6: "ordered", 7: "strict", 8: "strict", 9: "multi_choice", 10: "ordered",
    11: "strict", 12: "strict", 13: "strict", 14: "multi_choice", 15: "ordered",
    16: "strict", 17: "ordered", 18: "multi_choice", 19: "pair", 20: "task20",
}
_MAX_SCORE_BY_KIM = {
    1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 1, 8: 1, 9: 2, 10: 2,
    11: 1, 12: 1, 13: 1, 14: 2, 15: 2, 16: 1, 17: 2, 18: 2, 19: 1, 20: 1,
    # Verified from the source docx criteria:
    # 21=3, 22=2, 23=2, 24=3, 25=3, 26=4.
    21: 3, 22: 2, 23: 2, 24: 3, 25: 3, 26: 4,
}
_TOPIC_BY_KIM = {
    1: "Кинематика — графики движения", 2: "Динамика — 2-й закон Ньютона",
    3: "Энергия — кинетическая, потенциальная", 4: "Колебания — пружинный маятник",
    5: "Кинематика — анализ графика x(t)", 6: "Динамика — броски, кинематика и энергия",
    7: "МКТ — изопроцессы", 8: "Термодинамика — 1-е начало",
    9: "МКТ — диаграмма p-V", 10: "МКТ — смесь газов",
    11: "Электричество — постоянный ток, q(t)", 12: "Магнетизм — энергия катушки",
    13: "Колебательный контур — период", 14: "Колебательный контур — динамика q(t)",
    15: "Радиосвязь — частота колебаний", 16: "Ядерная физика — β⁻-распад",
    17: "Ядерная физика — α-распад изотопа", 18: "Общие закономерности (множественный выбор)",
    19: "Измерения — динамометр с погрешностью", 20: "Эксперимент — выбор схем",
    21: "МКТ — концентрация и плотность газа (объяснение)", 22: "Кинематика — равноускоренное движение (расчёт)",
    23: "Электричество — внутреннее сопротивление (расчёт)", 24: "МКТ — увлажнитель воздуха (расчёт)",
    25: "Оптика — линза и источники (расчёт)", 26: "Динамика — доска с бруском, трение (расчёт)",
}


def _check_mode(kim: int) -> str:
    return _CHECK_MODE_BY_KIM.get(kim, "strict")


def _max_score(kim: int) -> int:
    return _MAX_SCORE_BY_KIM.get(kim, 1)


def _topic(kim: int) -> str:
    return _TOPIC_BY_KIM.get(kim, "")


def main():
    if len(sys.argv) < 3:
        print("usage: build-mock-exam-seed.py <tasks_json> <out_seed_sql>", file=sys.stderr)
        sys.exit(2)
    tasks_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])

    tasks_data = json.loads(tasks_path.read_text(encoding="utf-8"))
    sql = build_sql(tasks_data)
    out_path.write_text(sql, encoding="utf-8")
    print(f"[ok] wrote {out_path} — variant_id={VARIANT_ID}", file=sys.stderr)


if __name__ == "__main__":
    main()
