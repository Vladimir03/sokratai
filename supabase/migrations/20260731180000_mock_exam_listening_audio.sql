-- Mock Exams — Аудирование (compréhension orale): аудиотрек варианта + транскрипт
-- ---------------------------------------------------------------------------
-- Запрос Эмилии 31.07.2026 (DELF, окно оформления пробников 1–5 августа):
--   «функцию в пробник, чтобы можно было добавить аудиотрек? и его транскрипцию»
-- План: ~/.claude/plans/glistening-humming-forest.md (Релиз 1).
--
-- Модель: аудио привязано к ВАРИАНТУ, не к задаче — эталонный файл Эмилии
-- (delf-b2-tp-coll-exemple1-integral.mp3, 23:46, 21.7 МБ) = цельная запись всей
-- секции Compréhension orale с экзаменационными паузами. Зеркало паттерна
-- variant_pdf_url (20260514130100).
--
-- ⚠️ ANTI-LEAK (rule 45, КРИТИЧНО — противоположно транскрипту речи ученика):
--   listening_transcript = транскрипт ТРЕК-УСЛОВИЯ. Ученик, читающий его до
--   сдачи, получает ответы аудирования → leak-класс solution_text.
--   Раскрывается ТОЛЬКО post-submit (state-aware, как solution_text Части 2).
--   Само аудио — условие задачи, доступно в in_progress (как task_image_url).
--   Инвариант edge: listening_audio_url — в taking-select;
--   listening_transcript — ТОЛЬКО в post-submit ветке result-эндпоинта.
--
-- Idempotent.

BEGIN;

-- ============================================================
-- 1. Колонки на mock_exam_variants
-- ============================================================
ALTER TABLE public.mock_exam_variants
  ADD COLUMN IF NOT EXISTS listening_audio_url TEXT NULL;

ALTER TABLE public.mock_exam_variants
  ADD COLUMN IF NOT EXISTS listening_transcript TEXT NULL;

COMMENT ON COLUMN public.mock_exam_variants.listening_audio_url IS
  'Аудиотрек секции аудирования (storage://mock-exam-listening-audio/{tutorUserId}/...). NULL = вариант без аудирования; UI скрывает плеер. Условие задачи — отдаётся ученику в in_progress (signed URL через service_role edge, rewriteToProxy).';

COMMENT ON COLUMN public.mock_exam_variants.listening_transcript IS
  'Транскрипт аудиотрека (ручной ввод репетитором, v1). ANTI-LEAK (rule 45): это фактически ответы аудирования — НИКОГДА не отдавать ученику до сдачи. Раскрывается ТОЛЬКО post-submit в result-эндпоинте (как solution_text). НЕ добавлять в taking-select mock-exam-student-api и в pre-submit selects mock-exam-public.';

-- ============================================================
-- 2. Storage bucket mock-exam-listening-audio (private, 30 МБ, audio/*)
-- ============================================================
-- ⚠️ Lovable-quirk, УТОЧНЁН 2026-07-31 (эмпирика, сильнее чем board-images):
-- INSERT INTO storage.buckets в миграции НЕ применяется, а сам бакет на Lovable
-- Cloud создаётся БЕЗ file_size_limit и allowed_mime_types — и выставить их
-- НЕЧЕМ: service_role-ключ в окружении Lovable недоступен в принципе (PUT
-- /storage/v1/bucket → 403 с anon), psql заходит как sandbox_exec
-- (UPDATE storage.buckets → permission denied, SET ROLE supabase_storage_admin →
-- permission denied), а bucket-тул агента принимает только флаг `public`.
--
-- ⇒ ФАКТИЧЕСКИЙ ENFORCEMENT РАЗМЕРА И MIME — КЛИЕНТСКИЙ:
--   src/lib/mockExamApi.ts::validateListeningAudioFile
--   (MAX_LISTENING_AUDIO_BYTES = 30 МБ + whitelist 5 аудио-MIME).
--   Меняешь лимит — меняй ТАМ, здесь только документация намерения.
-- Бакет-уровневые лимиты остаются defense-in-depth «на когда сможем выставить».
-- Действующий потолок = глобальный лимит проекта (Supabase default 50 МБ,
-- эталонный файл 21.7 МБ проходит; проверяется E2E-загрузкой).
-- INSERT оставлен идемпотентным для сред, где миграции применяются напрямую.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mock-exam-listening-audio',
  'mock-exam-listening-audio',
  false,
  31457280,  -- 30 МБ: эталон Эмилии 21.7 МБ (24 мин mp3) × запас 2
  ARRAY['audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav']
)
ON CONFLICT (id) DO NOTHING;

-- Path convention: {tutorUserId}/{fileId}.{ext}
-- Репетитор льёт файл КЛИЕНТОМ напрямую в Storage (22 МБ через edge не гоняем —
-- план §3.2), edge принимает только storage:// ref. Ученик получает signed URL
-- из service_role edge (bypass RLS) — прямых политик для учеников нет.
DROP POLICY IF EXISTS "Mock listening audio tutor upload own" ON storage.objects;
CREATE POLICY "Mock listening audio tutor upload own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'mock-exam-listening-audio'
    AND owner = auth.uid()
    AND public.is_tutor(auth.uid())
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 1
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT own — client-side createSignedUrl в редакторе (плеер самопроверки).
DROP POLICY IF EXISTS "Mock listening audio tutor read own" ON storage.objects;
CREATE POLICY "Mock listening audio tutor read own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'mock-exam-listening-audio'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 1
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE own — замена трека в редакторе.
DROP POLICY IF EXISTS "Mock listening audio tutor delete own" ON storage.objects;
CREATE POLICY "Mock listening audio tutor delete own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'mock-exam-listening-audio'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 1
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 3. RPC: расширение мета-параметров listening-полями
-- ============================================================
-- mock_exam_variant_replace_tasks: + _listening_audio_url / _listening_transcript.
-- Сигнатура меняется → DROP старой (CREATE OR REPLACE не умеет менять список
-- аргументов с DEFAULT). Семантика COALESCE сохранена: NULL = не менять,
-- '' (пустая строка) = очистить (edge шлёт '' при явном удалении трека).

DROP FUNCTION IF EXISTS public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int);

CREATE OR REPLACE FUNCTION public.mock_exam_variant_replace_tasks(
  _variant_id uuid,
  _tasks jsonb,
  _title text DEFAULT NULL,
  _subject text DEFAULT NULL,
  _exam_type text DEFAULT NULL,
  _duration_minutes int DEFAULT NULL,
  _listening_audio_url text DEFAULT NULL,
  _listening_transcript text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF _tasks IS NOT NULL
     AND (jsonb_typeof(_tasks) <> 'array' OR jsonb_array_length(_tasks) = 0) THEN
    RAISE EXCEPTION 'TASKS_REQUIRED';
  END IF;

  -- TOCTOU-гард: лочим строку варианта до проверки «в работе».
  PERFORM 1 FROM public.mock_exam_variants WHERE id = _variant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VARIANT_NOT_FOUND';
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
    -- '' = явная очистка (NULLIF → NULL в колонке), NULL = не менять.
    listening_audio_url = CASE
      WHEN _listening_audio_url IS NULL THEN listening_audio_url
      ELSE NULLIF(_listening_audio_url, '')
    END,
    listening_transcript = CASE
      WHEN _listening_transcript IS NULL THEN listening_transcript
      ELSE NULLIF(_listening_transcript, '')
    END
  WHERE id = _variant_id;

  IF _tasks IS NULL THEN
    RETURN; -- meta-only
  END IF;

  DELETE FROM public.mock_exam_variant_tasks WHERE variant_id = _variant_id;

  INSERT INTO public.mock_exam_variant_tasks (
    variant_id, kim_number, part, order_num, task_text, task_image_url,
    correct_answer, check_mode, max_score, solution_text, solution_image_urls, topic
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
    (t->>'max_score')::int,
    NULLIF(t->>'solution_text', ''),
    NULLIF(t->>'solution_image_urls', ''),
    NULLIF(t->>'topic', '')
  FROM jsonb_array_elements(_tasks) AS t;

  UPDATE public.mock_exam_variants v
  SET
    part1_max = COALESCE((
      SELECT SUM(max_score) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id AND part = 1
    ), 0)::int,
    part2_max = COALESCE((
      SELECT SUM(max_score) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id AND part = 2
    ), 0)::int,
    total_max_score = (
      SELECT SUM(max_score) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id
    )::int,
    task_count = (
      SELECT COUNT(*) FROM public.mock_exam_variant_tasks
      WHERE variant_id = _variant_id
    )::int
  WHERE v.id = _variant_id;
END;
$$;

-- ⚠️ Тройной REVOKE (rule 99): default privileges схемы public грантят EXECUTE
-- ролям anon/authenticated напрямую — REVOKE FROM PUBLIC недостаточно.
REVOKE ALL ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text) TO service_role;

COMMENT ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int, text, text) IS
  'Атомарное сохранение контента варианта (2026-07-20) + listening-мета (2026-07-31): FOR UPDATE + in-use гард (VARIANT_IN_USE) + мета (NULL = не менять, '''' = очистить listening-поля) + замена задач + пересчёт тоталов одной транзакцией. _tasks NULL = только мета. service_role-only (edge mock-exam-tutor-api).';

-- mock_exam_variant_create_with_tasks: сигнатура (jsonb, jsonb) не меняется —
-- listening-поля едут внутри _meta. PERFORM replace_tasks совместим (новые
-- параметры имеют DEFAULT NULL = «не менять», а INSERT уже записал значения).
CREATE OR REPLACE FUNCTION public.mock_exam_variant_create_with_tasks(
  _meta jsonb,
  _tasks jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_p1 int;
  v_p2 int;
BEGIN
  IF _tasks IS NULL OR jsonb_typeof(_tasks) <> 'array' OR jsonb_array_length(_tasks) = 0 THEN
    RAISE EXCEPTION 'TASKS_REQUIRED';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN (t->>'part')::int = 1 THEN (t->>'max_score')::int ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN (t->>'part')::int = 2 THEN (t->>'max_score')::int ELSE 0 END), 0)
  INTO v_p1, v_p2
  FROM jsonb_array_elements(_tasks) AS t;

  INSERT INTO public.mock_exam_variants (
    title, exam_type, source, source_attribution, duration_minutes,
    total_max_score, part1_max, part2_max, task_count,
    created_by, owner_id, subject, variant_pdf_url,
    listening_audio_url, listening_transcript
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
    NULLIF(_meta->>'listening_transcript', '')
  ) RETURNING id INTO v_id;

  PERFORM public.mock_exam_variant_replace_tasks(v_id, _tasks);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) IS
  'Создание/дублирование варианта одной транзакцией (мета + задачи + тоталы). 2026-07-31: + listening_audio_url/listening_transcript в _meta. service_role-only (edge POST /variants и /variants/:id/duplicate).';

COMMIT;

-- Validation:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'mock_exam_variants' AND column_name LIKE 'listening%';
-- Expected: listening_audio_url, listening_transcript.
--
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'mock-exam-listening-audio';
-- Expected: 1 row, public=false, file_size_limit=31457280 (если бакет создан вручную — сверить).
--
-- SELECT COUNT(*) FROM pg_policies
--   WHERE tablename = 'objects' AND policyname LIKE 'Mock listening audio%';
-- Expected: 3.
