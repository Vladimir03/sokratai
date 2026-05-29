-- Add 'speaking' to homework_tutor_tasks.task_kind CHECK (voice-speaking-mvp, Этап 2, TASK-6).
--
-- Назначение:
--   Новый task_kind='speaking' — устный ответ (монолог) для языковых ДЗ
--   (DELF/ЕГЭ/ОГЭ говорение). Ученик записывает монолог голосом, backend
--   транскрибирует (Whisper) и грейдит транскрипт тем же pipeline, что и
--   письменную работу. Tutor помечает задачу как устную в конструкторе.
--
-- КРИТИЧНО — CHECK-constraint в Postgres НЕ аддитивен:
--   нельзя «дополнить» список значений. Канонический идемпотентный паттерн —
--   DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT с полным новым списком
--   (mirror миграций 20260509120000 и 20260510083100, где этот же констрейнт
--   уже пересоздавался). Точное имя констрейнта — homework_tutor_tasks_task_kind_check.
--
-- Additive only: значения 'numeric' / 'extended' / 'proof' сохраняются; новое
--   'speaking' добавляется. Никаких DROP/RENAME колонок. DEFAULT остаётся
--   'extended' (НЕ меняем) — speaking ставится явно во write-path (§0
--   двойной derive-инвариант), не выводится из check_format.
--
-- Idempotent: безопасно прогонять повторно (DROP IF EXISTS + ADD).
--
-- Spec: docs/delivery/features/voice-speaking-mvp/spec.md §5 (Миграции), tasks.md TASK-6.

ALTER TABLE public.homework_tutor_tasks
  DROP CONSTRAINT IF EXISTS homework_tutor_tasks_task_kind_check;

ALTER TABLE public.homework_tutor_tasks
  ADD CONSTRAINT homework_tutor_tasks_task_kind_check
    CHECK (task_kind IN ('numeric', 'extended', 'proof', 'speaking'));

COMMENT ON COLUMN public.homework_tutor_tasks.task_kind IS
  'Task kind для student SubmitSheet shape: numeric (Часть 1, только числовой ответ), extended (Часть 2, число + фото решения), proof (Часть 2 доказательство, только фото), speaking (устный монолог — запись голоса, транскрипция Whisper, языковые ДЗ). Backfilled from check_format (short_answer→numeric, detailed_solution→extended). speaking ставится явно во write-path (§0), не через deriveTaskKind. Default extended для новых строк. See docs/delivery/features/student-homework-problem-screen/spec.md §5 + docs/delivery/features/voice-speaking-mvp/spec.md.';
