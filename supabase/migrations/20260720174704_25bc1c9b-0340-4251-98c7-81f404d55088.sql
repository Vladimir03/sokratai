ALTER TABLE public.mock_exam_variants
  ADD COLUMN IF NOT EXISTS owner_id UUID NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS subject TEXT NULL;

COMMENT ON COLUMN public.mock_exam_variants.owner_id IS
  'NULL = каталожный вариант (сиды, видят все). Non-NULL = личный вариант репетитора (видит только владелец). НЕ путать с created_by (у каталожных = Егор, живой пилотный аккаунт).';

COMMENT ON COLUMN public.mock_exam_variants.subject IS
  'Канонический id предмета (src/types/homework.ts SUBJECTS). NULL = легаси-строки до backfill; читатели используют subject ?? ''physics''. Управляет subject-рубрикой AI-грейдера Части 2.';

UPDATE public.mock_exam_variants SET subject = 'physics' WHERE subject IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mock_exam_variants'::regclass
      AND conname = 'mock_exam_variants_subject_check'
  ) THEN
    ALTER TABLE public.mock_exam_variants
      ADD CONSTRAINT mock_exam_variants_subject_check CHECK (
        subject IS NULL OR subject IN (
          'maths', 'physics', 'informatics',
          'russian', 'literature', 'history', 'social',
          'english', 'french', 'spanish',
          'chemistry', 'biology', 'geography', 'other'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mock_exam_variants_owner
  ON public.mock_exam_variants(owner_id)
  WHERE owner_id IS NOT NULL;

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.mock_exam_variants'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%exam_type%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.mock_exam_variants DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE public.mock_exam_variants
    ADD CONSTRAINT mock_exam_variants_exam_type_check CHECK (
      exam_type IN ('ege_physics', 'oge_physics', 'ege', 'oge')
    );
END $$;

COMMENT ON COLUMN public.mock_exam_variants.exam_type IS
  'ege_physics/oge_physics — легаси-значения ФИЗИКИ (на них гейтится getEgePhysicsBenchmarks: порог/хорошо/тестовый балл — новые физ-варианты ОБЯЗАНЫ писаться ими же). ege/oge — generic для остальных предметов (пороговые метки скрываются).';

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mock_exam_variants'
      AND cmd IN ('SELECT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.mock_exam_variants', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "Mock variants read catalog or own"
  ON public.mock_exam_variants
  FOR SELECT
  TO authenticated
  USING (owner_id IS NULL OR owner_id = auth.uid());

COMMENT ON POLICY "Mock variants read catalog or own" ON public.mock_exam_variants IS
  'Каталог (owner_id IS NULL) — все authenticated; личные варианты — только владелец. Чужой репетитор личный вариант не видит.';

CREATE OR REPLACE FUNCTION public.is_student_assigned_to_mock_variant(_variant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.mock_exam_assignments a
    JOIN public.mock_exam_attempts t ON t.assignment_id = a.id
    WHERE a.variant_id = _variant_id
      AND t.student_id = auth.uid()
  )
$$;

REVOKE ALL ON FUNCTION public.is_student_assigned_to_mock_variant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_student_assigned_to_mock_variant(uuid) TO authenticated;

CREATE POLICY "Mock variants student read assigned"
  ON public.mock_exam_variants
  FOR SELECT
  TO authenticated
  USING (public.is_student_assigned_to_mock_variant(id));

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mock_exam_variant_tasks'
      AND cmd IN ('SELECT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.mock_exam_variant_tasks', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "Mock variant tasks tutor read catalog or own"
  ON public.mock_exam_variant_tasks
  FOR SELECT
  TO authenticated
  USING (
    public.is_tutor(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.mock_exam_variants v
      WHERE v.id = mock_exam_variant_tasks.variant_id
        AND (v.owner_id IS NULL OR v.owner_id = auth.uid())
    )
  );

COMMENT ON POLICY "Mock variant tasks tutor read catalog or own" ON public.mock_exam_variant_tasks IS
  'Rule 45 anti-leak: задачи вариантов (с ответами/эталонами) читают ТОЛЬКО репетиторы, и только каталожных или своих вариантов. Ученик — ноль строк (его данные идут через service_role edge).';

CREATE OR REPLACE FUNCTION public.mock_exam_variant_usable_by(_variant_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mock_exam_variants v
    WHERE v.id = _variant_id
      AND (v.owner_id IS NULL OR v.owner_id = _user_id)
  )
$$;

REVOKE ALL ON FUNCTION public.mock_exam_variant_usable_by(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_usable_by(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.mock_exam_variant_usable_by(uuid, uuid) IS
  'Ревью 5.6 P0 #1: variant_id в назначении обязан быть каталожным или своим. SECURITY DEFINER — обходит RLS variants внутри WITH CHECK (личный вариант чужого владельца невидим политике, но проверить принадлежность нужно).';

DROP POLICY IF EXISTS "Mock assignments tutor insert own" ON public.mock_exam_assignments;
CREATE POLICY "Mock assignments tutor insert own"
  ON public.mock_exam_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tutor_id = auth.uid()
    AND (variant_id IS NULL OR public.mock_exam_variant_usable_by(variant_id, auth.uid()))
  );

DROP POLICY IF EXISTS "Mock assignments tutor update own" ON public.mock_exam_assignments;
CREATE POLICY "Mock assignments tutor update own"
  ON public.mock_exam_assignments
  FOR UPDATE
  TO authenticated
  USING (tutor_id = auth.uid())
  WITH CHECK (
    tutor_id = auth.uid()
    AND (variant_id IS NULL OR public.mock_exam_variant_usable_by(variant_id, auth.uid()))
  );

CREATE OR REPLACE FUNCTION public.mock_exam_variant_replace_tasks(
  _variant_id uuid,
  _tasks jsonb,
  _title text DEFAULT NULL,
  _subject text DEFAULT NULL,
  _exam_type text DEFAULT NULL,
  _duration_minutes int DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF _tasks IS NOT NULL
     AND (jsonb_typeof(_tasks) <> 'array' OR jsonb_array_length(_tasks) = 0) THEN
    RAISE EXCEPTION 'TASKS_REQUIRED';
  END IF;

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
    duration_minutes = COALESCE(_duration_minutes, duration_minutes)
  WHERE id = _variant_id;

  IF _tasks IS NULL THEN
    RETURN;
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

REVOKE ALL ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int) TO service_role;

COMMENT ON FUNCTION public.mock_exam_variant_replace_tasks(uuid, jsonb, text, text, text, int) IS
  'Фаза 2 (2026-07-20): атомарное сохранение контента варианта — FOR UPDATE + in-use гард (VARIANT_IN_USE) + мета (COALESCE, NULL = не менять) + замена задач + пересчёт тоталов одной транзакцией. _tasks NULL = только мета. service_role-only (edge mock-exam-tutor-api). Бизнес-валидация — в edge; схемные CHECK''и — backstop.';

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
    created_by, owner_id, subject, variant_pdf_url
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
    NULLIF(_meta->>'variant_pdf_url', '')
  ) RETURNING id INTO v_id;

  PERFORM public.mock_exam_variant_replace_tasks(v_id, _tasks);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.mock_exam_variant_create_with_tasks(jsonb, jsonb) IS
  'Фаза 2 (2026-07-20, ревью P1 #5): создание/дублирование варианта одной транзакцией (мета + задачи + тоталы). service_role-only (edge POST /variants и /variants/:id/duplicate).';