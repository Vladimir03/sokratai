-- Mock Exams — дробные баллы Части 1 (INT → NUMERIC)
-- ---------------------------------------------------------------------------
-- Повод (02.08.2026, репорт Эмилии): в её DELF-варианте задание «repas
-- familial» — ЧЕТЫРЕ вопроса на 2 балла, то есть по 0,5 за вопрос; Exercice 1 —
-- шесть вопросов на 7 баллов. Целыми весами это не выражается, поэтому после
-- разбиения многовопросных заданий на отдельные вопросы (канон
-- task-sub-questions v1.0) баллы всё равно врали бы.
--
-- ⚠️ ЭТО ОБЩИЙ ГРЕЙДИНГ ПРОБНИКОВ. Тот же код обслуживает живые физические
-- варианты Егора и обществознание Милады. Регресс физики ДО деплоя обязателен:
-- прогнать вариант целиком (авто-проверка Ч1 → тоталы → approve) и сверить,
-- что суммы совпали с прежними.
--
-- numeric(6,2): максимум 9999.99 при реальном потолке варианта ~100 баллов,
-- шаг 0.01. Шаг ВВОДА ограничивает edge-валидатор (0.5 для max_score) — в БД
-- держим запас, потому что per-task правки репетитора в ДЗ уже идут шагом 0.1
-- и однажды приедут сюда же.
--
-- Расширяющее преобразование: int → numeric не теряет данных, CHECK'и
-- (> 0 / >= 0) Postgres пересоздаёт сам. Обратной миграции не предусмотрено —
-- откат означал бы потерю дробной части.
--
-- Idempotent: повторный ALTER TYPE на уже-numeric колонке — no-op по факту,
-- поэтому гоняем через DO-блок с проверкой текущего типа.

BEGIN;

-- ============================================================
-- 0. RLS-политики, зависящие от earned_score (урок применения 03.08)
-- ============================================================
-- Postgres запрещает ALTER TYPE колонки, на которую ссылается политика:
--   ERROR 0A000: cannot alter type of a column used in a policy definition
-- Обе student-политики Части 1 несут `earned_score IS NULL` в WITH CHECK
-- (анти-spoofing балла, rule 45) — снимаем и пересоздаём ДОСЛОВНО после
-- смены типов. В прод применено именно так (Lovable, 03.08); этот блок
-- держит файл воспроизводимым на чистой базе.

DROP POLICY IF EXISTS "Mock part1 student insert own in progress" ON public.mock_exam_attempt_part1_answers;
DROP POLICY IF EXISTS "Mock part1 student update own in progress" ON public.mock_exam_attempt_part1_answers;

-- ============================================================
-- 1. Колонки
-- ============================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('mock_exam_variant_tasks',           'max_score'),
      ('mock_exam_attempt_part1_answers',   'earned_score'),
      ('mock_exam_attempts',                'total_part1_score'),
      ('mock_exam_attempts',                'total_part2_score'),
      ('mock_exam_attempts',                'total_score'),
      ('mock_exam_variants',                'total_max_score'),
      ('mock_exam_variants',                'part1_max'),
      ('mock_exam_variants',                'part2_max'),
      ('mock_exam_attempt_part2_solutions', 'tutor_score')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = r.tbl
         AND column_name = r.col
         AND data_type = 'integer'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(6,2)',
        r.tbl, r.col
      );
    END IF;
  END LOOP;
END $$;

-- Пересоздание политик — дословно прежние определения (source: pg_policies прода).
CREATE POLICY "Mock part1 student insert own in progress"
ON public.mock_exam_attempt_part1_answers
FOR INSERT TO authenticated
WITH CHECK (
  (EXISTS (
    SELECT 1 FROM public.mock_exam_attempts a
     WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
       AND a.student_id = auth.uid()
       AND a.status = 'in_progress'::text
  ))
  AND (earned_score IS NULL)
  AND (score_source = 'student_form'::text)
);

CREATE POLICY "Mock part1 student update own in progress"
ON public.mock_exam_attempt_part1_answers
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.mock_exam_attempts a
     WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
       AND a.student_id = auth.uid()
       AND a.status = 'in_progress'::text
  )
)
WITH CHECK (
  (EXISTS (
    SELECT 1 FROM public.mock_exam_attempts a
     WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
       AND a.student_id = auth.uid()
       AND a.status = 'in_progress'::text
  ))
  AND (earned_score IS NULL)
  AND (score_source = 'student_form'::text)
);

COMMENT ON COLUMN public.mock_exam_variant_tasks.max_score IS
  'Максимальный балл задачи. numeric(6,2) с 2026-08-02 (DELF: 0,5 и 1,5 за вопрос). Шаг ВВОДА валидирует edge (0.5) — в БД запас до 0.01.';

-- ============================================================
-- 2. RPC пересоздаются без ::int
-- ============================================================
-- Оба тела жёстко кастовали суммы в int — это молча обрезало бы дробную часть
-- ПОСЛЕ смены типа колонок (2.5 → 2), то есть баг был бы тише самой проблемы.

CREATE OR REPLACE FUNCTION public.mock_exam_resync_attempt_totals(_attempt_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.mock_exam_attempts a
  SET
    total_part1_score = COALESCE((
      SELECT SUM(earned_score)
      FROM public.mock_exam_attempt_part1_answers
      WHERE attempt_id = _attempt_id
    ), 0),
    total_part2_score = CASE
      WHEN a.total_score IS NULL THEN a.total_part2_score
      ELSE COALESCE((
        SELECT SUM(tutor_score)
        FROM public.mock_exam_attempt_part2_solutions
        WHERE attempt_id = _attempt_id
      ), 0)
    END,
    total_score = CASE
      WHEN a.total_score IS NULL THEN NULL
      ELSE (
        COALESCE((
          SELECT SUM(earned_score)
          FROM public.mock_exam_attempt_part1_answers
          WHERE attempt_id = _attempt_id
        ), 0)
        + COALESCE((
          SELECT SUM(tutor_score)
          FROM public.mock_exam_attempt_part2_solutions
          WHERE attempt_id = _attempt_id
        ), 0)
      )
    END
  WHERE a.id = _attempt_id;
$$;

COMMENT ON FUNCTION public.mock_exam_resync_attempt_totals(uuid) IS
  'Атомарный пересчёт тоталов попытки из дочерних таблиц. 2026-08-02: касты ::int убраны — они обрезали дробные баллы DELF. Инвариант total_score = part1 + part2 (rule 45) сохранён.';

-- Замена задач варианта: (t->>''max_score'')::int → ::numeric, суммы без ::int.
-- Сигнатура НЕ меняется (11 аргументов, как в 20260801120000) — DROP не нужен,
-- CREATE OR REPLACE достаточно, гранты и CAS-гард остаются как есть.
CREATE OR REPLACE FUNCTION public.mock_exam_variant_replace_tasks(
  _variant_id uuid,
  _tasks jsonb,
  _title text DEFAULT NULL,
  _subject text DEFAULT NULL,
  _exam_type text DEFAULT NULL,
  _duration_minutes int DEFAULT NULL,
  _listening_audio_url text DEFAULT NULL,
  _listening_transcript text DEFAULT NULL,
  _task_blocks jsonb DEFAULT NULL,
  _block_transcripts jsonb DEFAULT NULL,
  _expected_revision int DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_blocks jsonb;
  v_revision int;
  v_has_blocks boolean;
BEGIN
  IF _tasks IS NOT NULL
     AND (jsonb_typeof(_tasks) <> 'array' OR jsonb_array_length(_tasks) = 0) THEN
    RAISE EXCEPTION 'TASKS_REQUIRED';
  END IF;

  IF _task_blocks IS NOT NULL AND jsonb_typeof(_task_blocks) <> 'array' THEN
    RAISE EXCEPTION 'BLOCKS_MALFORMED';
  END IF;
  IF _block_transcripts IS NOT NULL AND jsonb_typeof(_block_transcripts) <> 'object' THEN
    RAISE EXCEPTION 'BLOCKS_MALFORMED';
  END IF;

  SELECT content_revision,
         COALESCE(jsonb_array_length(task_blocks_json), 0) > 0
    INTO v_revision, v_has_blocks
    FROM public.mock_exam_variants
   WHERE id = _variant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VARIANT_NOT_FOUND';
  END IF;

  IF _expected_revision IS NOT NULL THEN
    IF _expected_revision <> v_revision THEN
      RAISE EXCEPTION 'VARIANT_STALE';
    END IF;
  ELSIF v_has_blocks AND _tasks IS NOT NULL THEN
    RAISE EXCEPTION 'VARIANT_STALE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mock_exam_assignments WHERE variant_id = _variant_id
  ) THEN
    RAISE EXCEPTION 'VARIANT_IN_USE';
  END IF;

  UPDATE public.mock_exam_variants
  SET
    title = COALESCE(_title, title),
    subject = COALESCE(_subject, subject),
    exam_type = COALESCE(_exam_type, exam_type),
    duration_minutes = COALESCE(_duration_minutes, duration_minutes),
    listening_audio_url = CASE
      WHEN _listening_audio_url IS NULL THEN listening_audio_url
      ELSE NULLIF(_listening_audio_url, '')
    END,
    listening_transcript = CASE
      WHEN _listening_transcript IS NULL THEN listening_transcript
      ELSE NULLIF(_listening_transcript, '')
    END,
    task_blocks_json = CASE
      WHEN _task_blocks IS NULL THEN task_blocks_json
      WHEN jsonb_array_length(_task_blocks) = 0 THEN NULL
      ELSE _task_blocks
    END,
    block_transcripts_json = CASE
      WHEN _block_transcripts IS NULL THEN block_transcripts_json
      WHEN _block_transcripts = '{}'::jsonb THEN NULL
      ELSE _block_transcripts
    END,
    content_revision = content_revision + 1
  WHERE id = _variant_id;

  SELECT COALESCE(task_blocks_json, '[]'::jsonb)
    INTO v_blocks
    FROM public.mock_exam_variants
   WHERE id = _variant_id;

  IF _tasks IS NULL THEN
    IF _task_blocks IS NOT NULL THEN
      UPDATE public.mock_exam_variant_tasks t
         SET block_id = NULL
       WHERE t.variant_id = _variant_id
         AND t.block_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_blocks) AS b
            WHERE b->>'id' = t.block_id
         );
    END IF;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_tasks) AS t
     WHERE NULLIF(t->>'block_id', '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_blocks) AS b
          WHERE b->>'id' = t->>'block_id'
       )
  ) THEN
    RAISE EXCEPTION 'BLOCK_NOT_FOUND';
  END IF;

  DELETE FROM public.mock_exam_variant_tasks WHERE variant_id = _variant_id;

  INSERT INTO public.mock_exam_variant_tasks (
    variant_id, kim_number, part, order_num, task_text, task_image_url,
    correct_answer, check_mode, max_score, solution_text, solution_image_urls,
    topic, block_id
  )
  SELECT
    _variant_id,
    (t->>'kim_number')::int,
    (t->>'part')::int,
    (t->>'order_num')::int,
    t->>'task_text',
    NULLIF(t->>'task_image_url', ''),
    NULLIF(t->>'correct_answer', ''),
    NULLIF(t->>'check_mode', ''),
    -- ::numeric, НЕ ::int — иначе 0.5 молча превращается в 0 при вставке.
    (t->>'max_score')::numeric,
    NULLIF(t->>'solution_text', ''),
    NULLIF(t->>'solution_image_urls', ''),
    NULLIF(t->>'topic', ''),
    NULLIF(t->>'block_id', '')
  FROM jsonb_array_elements(_tasks) AS t;

  UPDATE public.mock_exam_variants v
  SET
    part1_max = COALESCE((
      SELECT SUM(max_score) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id AND part = 1
    ), 0),
    part2_max = COALESCE((
      SELECT SUM(max_score) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id AND part = 2
    ), 0),
    total_max_score = (
      SELECT SUM(max_score) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id
    ),
    task_count = (
      SELECT COUNT(*) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id
    )::int
  WHERE v.id = _variant_id;
END;
$$;

COMMENT ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text, jsonb, jsonb, int) IS
  'Атомарное сохранение варианта: CAS по content_revision (VARIANT_STALE) → in-use гард (VARIANT_IN_USE) → мета + блоки → замена задач с block_id (BLOCK_NOT_FOUND fail-closed) → пересчёт тоталов, одной транзакцией. 2026-08-02: max_score и суммы на numeric (дробные баллы DELF). service_role-only.';

-- create_with_tasks считает part1/part2 из payload — там тоже был ::int.
CREATE OR REPLACE FUNCTION public.mock_exam_variant_create_with_tasks(
  _meta jsonb,
  _tasks jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_p1 numeric;
  v_p2 numeric;
  v_revision int;
BEGIN
  IF _tasks IS NULL OR jsonb_typeof(_tasks) <> 'array' OR jsonb_array_length(_tasks) = 0 THEN
    RAISE EXCEPTION 'TASKS_REQUIRED';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN (t->>'part')::int = 1 THEN (t->>'max_score')::numeric ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN (t->>'part')::int = 2 THEN (t->>'max_score')::numeric ELSE 0 END), 0)
  INTO v_p1, v_p2
  FROM jsonb_array_elements(_tasks) AS t;

  INSERT INTO public.mock_exam_variants (
    title, exam_type, source, source_attribution, duration_minutes,
    total_max_score, part1_max, part2_max, task_count,
    created_by, owner_id, subject, variant_pdf_url,
    listening_audio_url, listening_transcript,
    task_blocks_json, block_transcripts_json
  ) VALUES (
    _meta->>'title',
    _meta->>'exam_type',
    COALESCE(NULLIF(_meta->>'source', ''), 'tutor'),
    NULLIF(_meta->>'source_attribution', ''),
    (_meta->>'duration_minutes')::int,
    v_p1 + v_p2,
    v_p1,
    v_p2,
    jsonb_array_length(_tasks),
    (_meta->>'created_by')::uuid,
    (_meta->>'owner_id')::uuid,
    NULLIF(_meta->>'subject', ''),
    NULLIF(_meta->>'variant_pdf_url', ''),
    NULLIF(_meta->>'listening_audio_url', ''),
    NULLIF(_meta->>'listening_transcript', ''),
    CASE
      WHEN jsonb_typeof(_meta->'task_blocks_json') = 'array'
       AND jsonb_array_length(_meta->'task_blocks_json') > 0
      THEN _meta->'task_blocks_json'
    END,
    CASE
      WHEN jsonb_typeof(_meta->'block_transcripts_json') = 'object'
       AND _meta->'block_transcripts_json' <> '{}'::jsonb
      THEN _meta->'block_transcripts_json'
    END
  ) RETURNING id, content_revision INTO v_id, v_revision;

  -- Ревизия ЯВНО и ИМЕНОВАННО (инцидент 02.08: без неё CAS-гард принимал
  -- внутренний вызов за stale-клиента и ронял создание вариантов с блоками).
  PERFORM public.mock_exam_variant_replace_tasks(
    _variant_id        := v_id,
    _tasks             := _tasks,
    _expected_revision := v_revision
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) TO service_role;

COMMIT;

-- Validation:
-- SELECT table_name, column_name, data_type, numeric_scale
--   FROM information_schema.columns
--  WHERE table_schema='public' AND column_name IN
--    ('max_score','earned_score','total_score','total_part1_score','total_part2_score',
--     'total_max_score','part1_max','part2_max','tutor_score')
--    AND table_name LIKE 'mock_exam%' ORDER BY 1,2;
-- Expected: все numeric, scale = 2.
--
-- Дробь доезжает (после деплоя edge, из редактора): задача с баллом 0.5
-- SELECT kim_number, max_score FROM mock_exam_variant_tasks WHERE max_score <> round(max_score);
