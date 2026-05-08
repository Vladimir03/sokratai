-- Mock Exams v1 — Phase 1 Sellable MVP schema (TASK-1 of mock-exams-v1).
--
-- Параллельная сущность для пробных ЕГЭ по физике, отдельная от homework.
-- Diagnostic vs learning, разные visibility contracts (immediate vs gated),
-- разные UX surfaces. Reuse инфраструктуры (auth, storage, push), но
-- отдельная state machine: in_progress → submitted → ai_checking →
-- awaiting_review → approved (+ manually_entered как отдельный terminal).
--
-- Контракт: AI создаёт черновик Части 2; ТОЛЬКО tutor approval публикует
-- результат ученику и родителю. Часть 1 — deterministic auto-check
-- (5+ типов: strict/ordered/unordered/multi_choice/task20/pair).
--
-- Отдельно от старой таблицы public.tutor_student_mock_exams (manual entry
-- на странице ученика) — она deprecated, удаляется в TASK-17 вместе с
-- UI. Naming здесь использует префикс mock_exam_* без коллизий.
--
-- Spec: docs/delivery/features/mock-exams-v1/spec.md §5 Data Model
-- Acceptance Criteria: AC-1, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8

-- ============================================================
-- 1. mock_exam_variants — каталог готовых вариантов пробника
-- ============================================================
-- Catalog item. Создаётся seed-миграцией (TASK-2: Тренировочный 1
-- от Егора). Любой authenticated tutor может прочитать список,
-- запись только через service_role (seeds).

CREATE TABLE IF NOT EXISTS public.mock_exam_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  exam_type TEXT NOT NULL DEFAULT 'ege_physics'
    CHECK (exam_type IN ('ege_physics', 'oge_physics')),
  source TEXT NOT NULL CHECK (source IN ('tutor', 'fipi')),
  source_attribution TEXT NULL,
  duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
  total_max_score INT NOT NULL CHECK (total_max_score > 0),
  part1_max INT NOT NULL CHECK (part1_max >= 0),
  part2_max INT NOT NULL CHECK (part2_max >= 0),
  task_count INT NOT NULL CHECK (task_count > 0),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mock_exam_variants_created_by
  ON public.mock_exam_variants(created_by);

CREATE INDEX IF NOT EXISTS idx_mock_exam_variants_exam_type
  ON public.mock_exam_variants(exam_type);

COMMENT ON TABLE public.mock_exam_variants IS
  'Каталог готовых вариантов пробника. Создаётся seed-миграциями. Authenticated tutors могут читать; запись только service_role.';

COMMENT ON COLUMN public.mock_exam_variants.source IS
  'tutor — кастомный вариант от репетитора (Егор). fipi — официальный демо ФИПИ.';

COMMENT ON COLUMN public.mock_exam_variants.source_attribution IS
  'Текст для UI: "Егор Б." / "ФИПИ демо 2024" — отображается на карточке варианта.';

-- ============================================================
-- 2. mock_exam_variant_tasks — задачи варианта (26 для ЕГЭ физики)
-- ============================================================
-- KIM 1-20 → Часть 1 (auto-check); KIM 21-26 → Часть 2 (manual/AI).
-- check_mode применим только для Части 1; для Части 2 либо NULL,
-- либо 'manual'.

CREATE TABLE IF NOT EXISTS public.mock_exam_variant_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES public.mock_exam_variants(id) ON DELETE CASCADE,
  kim_number INT NOT NULL CHECK (kim_number > 0),
  part INT NOT NULL CHECK (part IN (1, 2)),
  order_num INT NOT NULL,
  task_text TEXT NOT NULL,
  task_image_url TEXT NULL,
  correct_answer TEXT NULL,
  check_mode TEXT NULL CHECK (
    check_mode IS NULL OR check_mode IN (
      'strict', 'ordered', 'unordered', 'multi_choice', 'task20', 'pair', 'manual'
    )
  ),
  max_score INT NOT NULL CHECK (max_score > 0),
  solution_text TEXT NULL,
  topic TEXT NULL,
  CONSTRAINT mock_exam_variant_tasks_part1_needs_check_mode CHECK (
    part = 2 OR check_mode IN ('strict', 'ordered', 'unordered', 'multi_choice', 'task20', 'pair')
  ),
  CONSTRAINT mock_exam_variant_tasks_kim_unique UNIQUE (variant_id, kim_number),
  CONSTRAINT mock_exam_variant_tasks_order_unique UNIQUE (variant_id, order_num)
);

CREATE INDEX IF NOT EXISTS idx_mock_exam_variant_tasks_variant_order
  ON public.mock_exam_variant_tasks(variant_id, order_num);

COMMENT ON TABLE public.mock_exam_variant_tasks IS
  '26 задач варианта (для ЕГЭ физики): KIM 1-20 part=1 (auto-check); KIM 21-26 part=2 (manual/AI).';

COMMENT ON COLUMN public.mock_exam_variant_tasks.check_mode IS
  'strict — точное совпадение. ordered — последовательность через запятую. unordered — множество без порядка. multi_choice — несколько вариантов. task20 — спец-логика для №20. pair — пара значение/единица. manual — оценивает tutor (Часть 2).';

-- ============================================================
-- 3. mock_exam_assignments — назначенный пробник (canonical)
-- ============================================================
-- Tutor назначает вариант ученикам ИЛИ создаёт manual_entry запись
-- для бэкфилла прошлого пробника вне Сократа.
--
-- Mutex invariant: (mode='manual_entry' → variant_id IS NULL и
-- variant_title IS NOT NULL) XOR (mode IN ('blank','form') →
-- variant_id IS NOT NULL).

CREATE TABLE IF NOT EXISTS public.mock_exam_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NULL REFERENCES public.mock_exam_variants(id) ON DELETE RESTRICT,
  variant_title TEXT NULL,
  tutor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('blank', 'form', 'manual_entry')),
  deadline TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mock_exam_assignments_mode_variant_mutex CHECK (
    (mode = 'manual_entry' AND variant_id IS NULL AND variant_title IS NOT NULL)
    OR (mode IN ('blank', 'form') AND variant_id IS NOT NULL AND variant_title IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mock_exam_assignments_tutor_status_deadline
  ON public.mock_exam_assignments(tutor_id, status, deadline);

CREATE INDEX IF NOT EXISTS idx_mock_exam_assignments_variant
  ON public.mock_exam_assignments(variant_id)
  WHERE variant_id IS NOT NULL;

COMMENT ON TABLE public.mock_exam_assignments IS
  'Назначенный пробник. mode=blank|form — обычный auto flow с variant_id; mode=manual_entry — backfill прошлого пробника вне Сократа со свободным variant_title.';

COMMENT ON COLUMN public.mock_exam_assignments.variant_title IS
  'Свободный текст для manual_entry ("Демо ФИПИ 2024"). Для blank/form — NULL, тогда название берётся из variant.title.';

COMMENT ON COLUMN public.mock_exam_assignments.deadline IS
  'NULL для manual_entry (прошлая дата фиксируется в attempt.manual_entered_date).';

-- ============================================================
-- 4. mock_exam_attempts — попытка прохождения
-- ============================================================
-- Authenticated student или anonymous lead. Mutex:
-- student_id XOR anonymous_id.

CREATE TABLE IF NOT EXISTS public.mock_exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.mock_exam_assignments(id) ON DELETE CASCADE,
  student_id UUID NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymous_id UUID NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN (
    'in_progress',
    'submitted',
    'ai_checking',
    'awaiting_review',
    'approved',
    'manually_entered'
  )),
  started_at TIMESTAMPTZ NULL,
  submitted_at TIMESTAMPTZ NULL,
  total_time_minutes INT NULL,
  blank_photo_url TEXT NULL,
  total_part1_score INT NULL,
  total_part2_score INT NULL,
  total_score INT NULL,
  manual_entered_date DATE NULL,
  manual_comment TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mock_exam_attempts_owner_xor CHECK (
    (student_id IS NOT NULL) <> (anonymous_id IS NOT NULL)
  ),
  CONSTRAINT mock_exam_attempts_unique_student_per_assignment UNIQUE (assignment_id, student_id)
);

-- Per spec: индекс по (assignment_id, status) для tutor dashboard
CREATE INDEX IF NOT EXISTS idx_mock_exam_attempts_assignment_status
  ON public.mock_exam_attempts(assignment_id, status);

-- Per spec: индекс по student_id для student "мои пробники" view
CREATE INDEX IF NOT EXISTS idx_mock_exam_attempts_student
  ON public.mock_exam_attempts(student_id)
  WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mock_exam_attempts_anonymous
  ON public.mock_exam_attempts(anonymous_id)
  WHERE anonymous_id IS NOT NULL;

COMMENT ON TABLE public.mock_exam_attempts IS
  'Попытка прохождения пробника. student_id XOR anonymous_id (через CHECK). Status manually_entered — terminal для backfill (started_at NULL, total_score сразу заполнен tutor).';

COMMENT ON COLUMN public.mock_exam_attempts.anonymous_id IS
  'UUID для anonymous лида (с invite-link). Связан с mock_exam_anonymous_leads.attempt_id. service_role-only write через edge function.';

COMMENT ON COLUMN public.mock_exam_attempts.blank_photo_url IS
  'storage:// ref на фото бланка ЕГЭ (для mode=blank). NULL для form/manual_entry.';

-- ============================================================
-- 5. mock_exam_attempt_part1_answers — ответы Части 1 (KIM 1-20)
-- ============================================================
-- Auto-saved на каждое изменение (debounced). Composite PK по
-- (attempt_id, kim_number) — upsert-friendly.

CREATE TABLE IF NOT EXISTS public.mock_exam_attempt_part1_answers (
  attempt_id UUID NOT NULL REFERENCES public.mock_exam_attempts(id) ON DELETE CASCADE,
  kim_number INT NOT NULL CHECK (kim_number > 0),
  student_answer TEXT NULL,
  earned_score INT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, kim_number)
);

COMMENT ON TABLE public.mock_exam_attempt_part1_answers IS
  'Ответы Части 1 ученика. Auto-saved во время прохождения. earned_score рассчитывается deterministic checker-ом на submit.';

-- ============================================================
-- 6. mock_exam_attempt_part2_solutions — решения Части 2
-- ============================================================
-- Photo (бланк-режим) или text (form-режим), AI draft в JSONB,
-- tutor approval via tutor_score + tutor_comment + status transition.

CREATE TABLE IF NOT EXISTS public.mock_exam_attempt_part2_solutions (
  attempt_id UUID NOT NULL REFERENCES public.mock_exam_attempts(id) ON DELETE CASCADE,
  kim_number INT NOT NULL CHECK (kim_number > 0),
  photo_url TEXT NULL,
  ai_draft_json JSONB NULL,
  tutor_score INT NULL,
  tutor_comment TEXT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_review' CHECK (status IN (
    'awaiting_review',
    'tutor_approved',
    'tutor_modified'
  )),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, kim_number)
);

COMMENT ON TABLE public.mock_exam_attempt_part2_solutions IS
  'Решения Части 2 (KIM 21-26). ai_draft_json: { suggested_score, confidence, elements_check, comment_for_tutor, flags }. status: awaiting_review (AI draft готов) → tutor_approved (без правок) | tutor_modified (с правками).';

COMMENT ON COLUMN public.mock_exam_attempt_part2_solutions.ai_draft_json IS
  'AI draft от mock-exam-grade edge function. Структура: { suggested_score: int, confidence: "low"|"medium"|"high", elements_check: { I: bool, II: bool, III: bool, IV: bool }, comment_for_tutor: string, flags: string[] }.';

-- ============================================================
-- 7. mock_exam_anonymous_leads — лиды через invite-link
-- ============================================================
-- Tutor создаёт public invite-link → anonymous пользователь
-- проходит → оставляет имя + контакт + consent → этот лид
-- принадлежит tutor-у. service_role-only write.

CREATE TABLE IF NOT EXISTS public.mock_exam_anonymous_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.mock_exam_attempts(id) ON DELETE CASCADE,
  lead_name TEXT NOT NULL,
  lead_contact TEXT NOT NULL,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('telegram', 'email')),
  tutor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per spec: tutor lead notification queries — sort by tutor_id + created_at DESC
CREATE INDEX IF NOT EXISTS idx_mock_exam_anonymous_leads_tutor_created
  ON public.mock_exam_anonymous_leads(tutor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mock_exam_anonymous_leads_attempt
  ON public.mock_exam_anonymous_leads(attempt_id);

COMMENT ON TABLE public.mock_exam_anonymous_leads IS
  'Лиды из public invite-link. service_role-only write через edge function mock-exam-public. Tutor читает свои через RLS tutor_id = auth.uid().';

COMMENT ON COLUMN public.mock_exam_anonymous_leads.consent_at IS
  'Timestamp галочки consent на лидген. Юридический trail для privacy policy clause.';

-- ============================================================
-- 8. mock_exam_public_links — public ссылки (invite + parent_result)
-- ============================================================
-- slug — 8-char random, generated в edge function. scope='invite'
-- ведёт на anonymous lead-flow; scope='parent_result' — на share
-- финального результата для родителя без auth.

CREATE TABLE IF NOT EXISTS public.mock_exam_public_links (
  slug TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('invite', 'parent_result')),
  attempt_id UUID NULL REFERENCES public.mock_exam_attempts(id) ON DELETE CASCADE,
  mock_exam_id UUID NULL REFERENCES public.mock_exam_assignments(id) ON DELETE CASCADE,
  tutor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NULL,
  CONSTRAINT mock_exam_public_links_scope_target_mutex CHECK (
    (scope = 'invite' AND mock_exam_id IS NOT NULL AND attempt_id IS NULL)
    OR (scope = 'parent_result' AND attempt_id IS NOT NULL AND mock_exam_id IS NULL)
  )
);

-- slug уже PRIMARY KEY (UNIQUE автоматически), но явный per-spec.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mock_exam_public_links_slug_unique
  ON public.mock_exam_public_links(slug);

CREATE INDEX IF NOT EXISTS idx_mock_exam_public_links_tutor
  ON public.mock_exam_public_links(tutor_id);

CREATE INDEX IF NOT EXISTS idx_mock_exam_public_links_invite_target
  ON public.mock_exam_public_links(mock_exam_id)
  WHERE scope = 'invite';

CREATE INDEX IF NOT EXISTS idx_mock_exam_public_links_parent_target
  ON public.mock_exam_public_links(attempt_id)
  WHERE scope = 'parent_result';

COMMENT ON TABLE public.mock_exam_public_links IS
  'Public read-only ссылки /p/mock-invite/:slug (lead-gen) и /p/mock-result/:slug (parent share). Чтение через edge function mock-exam-public под service_role. RLS защищает только authenticated PostgREST доступ.';

COMMENT ON COLUMN public.mock_exam_public_links.slug IS
  '8-char base36, генерируется в edge function через crypto.randomUUID slice. Collision retry на backend.';

-- ============================================================
-- 9. ALTER tutors — per-tutor feature flag
-- ============================================================
-- Защита от «4 первых впечатления одновременно проваливаются».
-- Day 3 утром — только Егор (true). Если 3-4 часа без багов —
-- включаем остальных 3 tutors к концу дня.

ALTER TABLE public.tutors
  ADD COLUMN IF NOT EXISTS feature_mock_exams_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tutors.feature_mock_exams_enabled IS
  'Per-tutor feature flag для mock-exams-v1. Tutor с false не видит "Пробники" в SideNav и получает 404 на /tutor/mock-exams (AC-8). Staggered roll-out для пилотных tutors.';

-- ============================================================
-- 10. RLS — enable + policies
-- ============================================================
-- Anonymous flows используют service_role через edge functions
-- (mock-exam-grade, mock-exam-public). Service_role bypasses RLS.
-- Authenticated policies покрывают:
--   - tutor self-manage own assignments / attempts / leads / links
--   - student self-read own attempts + self-update during in_progress
--   - все authenticated tutors могут читать каталог variants

ALTER TABLE public.mock_exam_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_exam_variant_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_exam_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_exam_attempt_part1_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_exam_attempt_part2_solutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_exam_anonymous_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_exam_public_links ENABLE ROW LEVEL SECURITY;

-- ---------- mock_exam_variants ----------
-- Catalog: read by any authenticated tutor; write only service_role (seed).

CREATE POLICY "Mock variants read by authenticated"
  ON public.mock_exam_variants
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------- mock_exam_variant_tasks ----------

CREATE POLICY "Mock variant tasks read by authenticated"
  ON public.mock_exam_variant_tasks
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------- mock_exam_assignments ----------
-- Tutor self-manage; students see only assignments they have an attempt for.

CREATE POLICY "Mock assignments tutor select own"
  ON public.mock_exam_assignments
  FOR SELECT
  TO authenticated
  USING (tutor_id = auth.uid());

CREATE POLICY "Mock assignments tutor insert own"
  ON public.mock_exam_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (tutor_id = auth.uid());

CREATE POLICY "Mock assignments tutor update own"
  ON public.mock_exam_assignments
  FOR UPDATE
  TO authenticated
  USING (tutor_id = auth.uid())
  WITH CHECK (tutor_id = auth.uid());

CREATE POLICY "Mock assignments tutor delete own"
  ON public.mock_exam_assignments
  FOR DELETE
  TO authenticated
  USING (tutor_id = auth.uid());

CREATE POLICY "Mock assignments student select assigned"
  ON public.mock_exam_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.assignment_id = mock_exam_assignments.id
        AND a.student_id = auth.uid()
    )
  );

-- ---------- mock_exam_attempts ----------
-- Tutor sees attempts on own assignments; student sees + updates own.

CREATE POLICY "Mock attempts tutor select via assignment"
  ON public.mock_exam_attempts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_assignments a
      WHERE a.id = mock_exam_attempts.assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

-- Tutor updates attempts on own assignments (для approve flow + manual_entry write).
-- Note: for approve флоу используется service_role в edge function;
-- эта policy покрывает manual_entry write через PostgREST.
CREATE POLICY "Mock attempts tutor update via assignment"
  ON public.mock_exam_attempts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_assignments a
      WHERE a.id = mock_exam_attempts.assignment_id
        AND a.tutor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_assignments a
      WHERE a.id = mock_exam_attempts.assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

CREATE POLICY "Mock attempts tutor insert via assignment"
  ON public.mock_exam_attempts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_assignments a
      WHERE a.id = mock_exam_attempts.assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

CREATE POLICY "Mock attempts student select own"
  ON public.mock_exam_attempts
  FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Mock attempts student update own in progress"
  ON public.mock_exam_attempts
  FOR UPDATE
  TO authenticated
  USING (
    student_id = auth.uid()
    AND status = 'in_progress'
  )
  WITH CHECK (
    student_id = auth.uid()
    AND status IN ('in_progress', 'submitted')
  );

-- ---------- mock_exam_attempt_part1_answers ----------

CREATE POLICY "Mock part1 student select own"
  ON public.mock_exam_attempt_part1_answers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
        AND a.student_id = auth.uid()
    )
  );

CREATE POLICY "Mock part1 tutor select via assignment"
  ON public.mock_exam_attempt_part1_answers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      JOIN public.mock_exam_assignments asg ON asg.id = a.assignment_id
      WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
        AND asg.tutor_id = auth.uid()
    )
  );

CREATE POLICY "Mock part1 student insert own in progress"
  ON public.mock_exam_attempt_part1_answers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
  );

CREATE POLICY "Mock part1 student update own in progress"
  ON public.mock_exam_attempt_part1_answers
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
  );

-- ---------- mock_exam_attempt_part2_solutions ----------

CREATE POLICY "Mock part2 student select own"
  ON public.mock_exam_attempt_part2_solutions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part2_solutions.attempt_id
        AND a.student_id = auth.uid()
    )
  );

CREATE POLICY "Mock part2 tutor select via assignment"
  ON public.mock_exam_attempt_part2_solutions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      JOIN public.mock_exam_assignments asg ON asg.id = a.assignment_id
      WHERE a.id = mock_exam_attempt_part2_solutions.attempt_id
        AND asg.tutor_id = auth.uid()
    )
  );

CREATE POLICY "Mock part2 student insert own in progress"
  ON public.mock_exam_attempt_part2_solutions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part2_solutions.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
  );

CREATE POLICY "Mock part2 student update own in progress"
  ON public.mock_exam_attempt_part2_solutions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part2_solutions.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part2_solutions.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
  );

-- ---------- mock_exam_anonymous_leads ----------
-- Tutor reads own; writes via service_role (edge function mock-exam-public).

CREATE POLICY "Mock leads tutor select own"
  ON public.mock_exam_anonymous_leads
  FOR SELECT
  TO authenticated
  USING (tutor_id = auth.uid());

-- ---------- mock_exam_public_links ----------
-- Tutor manages own (TASK-3 endpoint POST /assignments/:id/invite-link).
-- Public read через edge function под service_role.

CREATE POLICY "Mock public links tutor manage own"
  ON public.mock_exam_public_links
  FOR ALL
  TO authenticated
  USING (tutor_id = auth.uid())
  WITH CHECK (tutor_id = auth.uid());

-- ============================================================
-- 11. Grants
-- ============================================================

GRANT SELECT ON public.mock_exam_variants TO authenticated;
GRANT SELECT ON public.mock_exam_variant_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exam_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mock_exam_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mock_exam_attempt_part1_answers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mock_exam_attempt_part2_solutions TO authenticated;
GRANT SELECT ON public.mock_exam_anonymous_leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mock_exam_public_links TO authenticated;
