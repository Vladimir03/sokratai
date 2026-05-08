-- ============================================================================
-- MOCK EXAMS V1 — APPLY ALL
-- ============================================================================
-- Скопируй ВСЁ содержимое этого файла в Lovable Studio SQL Editor → Run
-- Объединяет 3 файла: schema + storage_buckets + seed (вариант 1)
-- Безопасно: все INSERT'ы идемпотентны (ON CONFLICT DO NOTHING)
-- ============================================================================

-- ─── Часть 1: Schema (20260508120000) ──────────────────────────────────────
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

-- ─── Часть 2: Storage buckets (20260508120100) ─────────────────────────────
-- Mock Exams v1 — Storage buckets (TASK-2 prerequisite for seed).
--
-- Создаём 4 bucket-а сразу — TASK-4/TASK-12 не понадобится отдельная миграция:
--   1. mock-exam-variant-tasks (private) — картинки задач варианта (графики, схемы).
--      Default fallback для parseStorageRef в supabase/functions/mock-exam-public/
--      (TASK-6, см. CLAUDE.md §10).
--   2. mock-exam-blanks (private) — фото заполненного бланка от ученика
--      (бланк-режим). TASK-12 path: {studentId}/{attemptId}/blank-{uuid}.{ext}.
--   3. mock-exam-part2-photos (private) — фото решений Части 2 от ученика.
--      TASK-12 path: {studentId}/{attemptId}/{kim}/{uuid}.{ext}.
--   4. mock-exam-blank-templates (public-read) — PDF templates бланка ФИПИ для
--      скачивания учеником. Без PII, public OK.
--
-- Vladimir загружает variant images + blank PDF template через Lovable Cloud
-- Studio UI. Student photos uploads — через edge function под service_role.
-- RLS policies ниже защищают direct PostgREST/Storage API доступ.
--
-- Spec: docs/delivery/features/mock-exams-v1/spec.md §3.1 (бланк-режим default)
-- Tasks: docs/delivery/features/mock-exams-v1/tasks.md (TASK-12 Storage paths §216-217)

-- =====================================================================
-- 1. mock-exam-variant-tasks — приватные task images per variant
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('mock-exam-variant-tasks', 'mock-exam-variant-tasks', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Authenticated read: любой залогиненный tutor/student может читать (через
-- signed URL). Содержание задач не PII; защита от crawling — signed URL TTL.
CREATE POLICY "Mock variant tasks authenticated read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'mock-exam-variant-tasks');

-- Write — только service_role (Lovable Studio UI / edge functions).

-- =====================================================================
-- 2. mock-exam-blanks — фото заполненного бланка ученика (private)
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('mock-exam-blanks', 'mock-exam-blanks', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Path convention: {studentId}/{attemptId}/blank-{uuid}.{ext}
-- foldername(name)[1] == auth.uid()::text gates ownership.
CREATE POLICY "Mock blanks student upload own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'mock-exam-blanks'
    AND owner = auth.uid()
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 2
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Mock blanks student read own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'mock-exam-blanks'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 2
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Tutor reads через signed URLs из edge function под service_role (bypass RLS).

-- =====================================================================
-- 3. mock-exam-part2-photos — фото решений Части 2 (private)
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('mock-exam-part2-photos', 'mock-exam-part2-photos', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

CREATE POLICY "Mock part2 photos student upload own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'mock-exam-part2-photos'
    AND owner = auth.uid()
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 3
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Mock part2 photos student read own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'mock-exam-part2-photos'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) >= 3
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- =====================================================================
-- 4. mock-exam-blank-templates — PDF templates бланка ФИПИ (public-read)
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('mock-exam-blank-templates', 'mock-exam-blank-templates', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- public=true → anonymous SELECT через
-- https://<project>.supabase.co/storage/v1/object/public/mock-exam-blank-templates/<file>
-- Содержимое — публичные PDF без PII; дополнительные policies не нужны.

-- ─── Часть 3: Seed Тренировочный 1 (с UUID Егора) ──────────────────────────
-- Mock Exams v1 — Тренировочный вариант 1 от Егора Иванова (физика ЕГЭ-2026)
-- ----------------------------------------------------------------------
-- Этот файл сгенерирован скриптом scripts/build-mock-exam-seed.py из
-- tasks.json. НЕ редактировать вручную — править tasks.json и пересобирать.
--
-- Provenance:
--   source docx: 'Тр_вариант 1.docx' от Егора Иванова, 2026-05-07
--   parser: scripts/parse-mock-exam-docx.py
--   structurer: scripts/structure-mock-exam.py
--   generator: scripts/build-mock-exam-seed.py
--   review file: docs/delivery/features/mock-exams-v1/source/variant1-review.md
--
-- UUIDs derived deterministically via uuid5(ns=00000000-0000-0000-0000-000000005ec0).
-- Re-running generator with same tasks.json produces identical UUIDs.
--
-- Storage refs:
--   storage://mock-exam-variant-tasks/variant1/<filename>
-- Vladimir загружает картинки в Lovable Cloud Studio (bucket mock-exam-variant-tasks,
-- папка variant1/). WMF/EMF ДОЛЖНЫ быть конвертированы в PNG до загрузки —
-- браузеры не рендерят WMF/EMF. Список файлов: docs/delivery/features/mock-exams-v1/source/storage-upload-checklist.md
--
-- Применяется через Lovable Cloud auto-deploy после push в main.
-- AC-3 (deterministic checker): ответы Части 1 пред-вычислены и видны
-- в `correct_answer` ниже. После seed применения — `SELECT COUNT(*) FROM
-- mock_exam_variant_tasks WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131';' = 26.

BEGIN;

-- =====================================================================
-- 1. Вариант — мета-данные
-- =====================================================================

INSERT INTO public.mock_exam_variants (
  id, title, exam_type, source, source_attribution,
  duration_minutes, total_max_score, part1_max, part2_max, task_count,
  created_by
) VALUES (
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  'Тренировочный вариант 1 (физика ЕГЭ-2026)',
  'ege_physics',
  'tutor',
  'Источник: репетитор Егор Иванов',
  235,  -- 3ч 55мин
  45,   -- 28 (Часть 1) + 17 (Часть 2), verified against source docx criteria
  28,
  17,
  26,
  -- Egor Blinov (egor.o.blinov@gmail.com) — pilot tutor, owner of variant 1.
  -- UUID resolved 2026-05-08 via SQL JOIN auth.users × public.tutors.
  'a7212758-8cdd-4d7c-8608-4fedcb34d74c'::uuid
) ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- 2. Задачи варианта (26 шт)
-- =====================================================================

-- --- Задание 1 (part 1, kim=1, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'f004fdf0-ea4e-5bba-9716-2fb2746ebcea'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  1, 1, 1,
  'Тело движется вдоль оси Ox. На рисунке приведён график зависимости проекции $v_x$ скорости тела от времени t.

Определите путь, пройденный телом в интервале времени от 0 до 20 с.',
  'storage://mock-exam-variant-tasks/variant1/image6.png',
  '225',
  'strict',
  1,
  NULL,
  'Кинематика — графики движения'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 2 (part 1, kim=2, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '1a446c98-a7c9-509a-9a1e-252d777d03d1'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  2, 1, 2,
  'В инерциальной системе отсчёта сила величиной 70 Н сообщает телу массой 10 кг некоторое ускорение. Сила какой величины сообщит телу массой 9 кг в этой же системе отсчёта такое же ускорение?',
  NULL,
  '63',
  'strict',
  1,
  NULL,
  'Динамика — 2-й закон Ньютона'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 3 (part 1, kim=3, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '3b48e80d-d870-5ee5-9b86-772d1d02d338'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  3, 1, 3,
  'Тело массой 200 г, брошенное вертикально вверх с поверхности Земли, 
в момент броска обладало кинетической энергией, равной 20 Дж. На какую максимальную высоту поднялось тело? Сопротивлением воздуха пренебречь.',
  NULL,
  '10',
  'strict',
  1,
  NULL,
  'Энергия — кинетическая, потенциальная'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 4 (part 1, kim=4, max_score=1, check_mode=strict) ---
-- ⚠️ layout anomaly в docx: маркер kim=4 стоял ПОСЛЕ тела задачи.
--    structurer перенёс body+images назад. Проверить визуально перед commit.
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'db730331-0514-52d9-aedd-7cf052d05d6f'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  4, 1, 4,
  'Груз, подвешенный на лёгкой пружине жёсткостью 50 Н/м, совершает свободные вертикальные гармонические колебания. Пружину какой жёсткости надо взять вместо этой пружины, чтобы период свободных вертикальных колебаний этого груза стал в 2 раза меньше?',
  NULL,
  '200',
  'strict',
  1,
  NULL,
  'Колебания — пружинный маятник'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 5 (part 1, kim=5, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'ad9d1ffa-a314-5e3b-ab21-a1bb25acc420'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  5, 1, 5,
  'На рисунке показан график зависимости координаты х тела, движущегося вдоль оси Ох, от времени t. Из приведённого ниже списка выберите все верные утверждения.

1)

В точке A скорость тела равна нулю.

2)

В точке B проекция ускорения тела на ось Ox отрицательна.

3)

Проекция перемещения тела на ось Ox при переходе из точки B в точку C положительна.

4)

В точке D проекция скорости тела на ось Ox положительна.

5)

На участке CD модуль скорости тела уменьшается.',
  'storage://mock-exam-variant-tasks/variant1/image7.png',
  '123',
  'multi_choice',
  2,
  NULL,
  'Кинематика — анализ графика x(t)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 6 (part 1, kim=6, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '93a586d8-bd20-5ea3-bdb6-32db9375fd5a'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  6, 1, 6,
  'Камень брошен вверх под углом к горизонту. Сопротивление воздуха пренебрежимо малó. Как меняются модуль ускорения камня и его кинетическая энергия в поле тяжести при движении камня вверх?

Для каждой величины определите соответствующий характер изменения:

1)

увеличивается

2)

уменьшается

3)

не изменяется

Запишите в таблицу выбранные цифры для каждой физической величины. Цифры в ответе могут повторяться.

Модуль ускорения камня

Кинетическая энергия камня',
  NULL,
  '32',
  'ordered',
  2,
  NULL,
  'Динамика — броски, кинематика и энергия'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 7 (part 1, kim=7, max_score=1, check_mode=strict) ---
-- ⚠️ layout anomaly в docx: маркер kim=7 стоял ПОСЛЕ тела задачи.
--    structurer перенёс body+images назад. Проверить визуально перед commit.
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '9b0d3dc8-67c1-5e4e-8129-78761190dfad'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  7, 1, 7,
  'На рисунке приведён график процесса 1–2, в котором участвует аргон. Объём, занимаемый газом в состоянии 1, равен 15 л. Определите объём аргона в состоянии 2.',
  'storage://mock-exam-variant-tasks/variant1/image8.png',
  '3',
  'strict',
  1,
  NULL,
  'МКТ — изопроцессы'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 8 (part 1, kim=8, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '5f44fbb4-3735-53b5-91c1-aaa853bf9527'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  8, 1, 8,
  'Газ в сосуде сжали, совершив работу, равную 500 Дж. Внутренняя энергия газа при этом увеличилась на 350 Дж. Какое количество теплоты отдал газ окружающей среде?',
  NULL,
  '150',
  'strict',
  1,
  NULL,
  'Термодинамика — 1-е начало'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 9 (part 1, kim=9, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '252ee894-9616-5cf1-abc9-98c22b342907'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  9, 1, 9,
  'Идеальный газ переводят из состояния 1 в состояние 3 так, как показано на графике зависимости давления р газа от объёма V. Масса газа в процессе остаётся постоянной.

Из приведённого ниже списка выберите все верные утверждения, характеризующие процессы на графике.

1)

Абсолютная температура газа минимальна в состоянии 2.

2)

В процессе 1–2 абсолютная температура газа изобарно увеличилась 
в 2 раза.

3)

В процессе 2–3 абсолютная температура газа изохорно уменьшилась 
в 2 раза.

4)

Концентрация газа минимальна в состоянии 1.

5)

В ходе процесса 1–2–3 среднеквадратичная скорость теплового движения молекул газа уменьшается в 4 раза.',
  'storage://mock-exam-variant-tasks/variant1/image9.png',
  '34',
  'multi_choice',
  2,
  NULL,
  'МКТ — диаграмма p-V'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 10 (part 1, kim=10, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'e6003bcf-082c-5f84-b156-09948da93a44'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  10, 1, 10,
  'В сосуде неизменного объёма находилась при комнатной температуре смесь двух идеальных газов, по 2 моль каждого. Половину содержимого сосуда выпустили, а затем добавили в сосуд 1 моль первого газа. Температура 
в сосуде поддерживалась неизменной. Как изменились в результате проведённых экспериментов парциальное давление первого газа и давление смеси газов?

Для каждой величины определите соответствующий характер изменения:

1)

увеличилась

2)

уменьшилась

3)

не изменилась

Запишите в таблицу выбранные цифры для каждой физической величины. Цифры в ответе могут повторяться.

Парциальное давление

первого газа

Давление смеси газов',
  NULL,
  '32',
  'ordered',
  2,
  NULL,
  'МКТ — смесь газов'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 11 (part 1, kim=11, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '4868c950-a3ad-58a6-b973-5d6a40e49799'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  11, 1, 11,
  'По проводнику течёт постоянный электрический ток. Заряд, прошедший через поперечное сечение проводника, растёт с течением времени согласно представленному графику (см. рисунок).

Определите силу тока в проводнике.',
  'storage://mock-exam-variant-tasks/variant1/image10.png',
  '1',
  'strict',
  1,
  NULL,
  'Электричество — постоянный ток, q(t)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 12 (part 1, kim=12, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'c450bd77-11c5-5ec5-96fb-85a731843369'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  12, 1, 12,
  'Определите энергию магнитного поля катушки индуктивностью $3\cdot10^{-4}$ Гн, если сила тока в ней равна 1 А.',
  NULL,
  '0,15',
  'strict',
  1,
  NULL,
  'Магнетизм — энергия катушки'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 13 (part 1, kim=13, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '600e82ad-b881-522b-8146-93218d999e2c'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  13, 1, 13,
  'На рисунке приведён график зависимости силы тока I от времени t при свободных электромагнитных колебаниях в идеальном колебательном контуре. Каким станет период свободных электромагнитных колебаний в контуре, если конденсатор в нём заменить на другой конденсатор, ёмкость которого в 4 раза меньше?',
  'storage://mock-exam-variant-tasks/variant1/image11.png',
  '2',
  'strict',
  1,
  NULL,
  'Колебательный контур — период'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 14 (part 1, kim=14, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '8b0f039a-8e50-5e3a-809d-abcc856f18bf'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  14, 1, 14,
  'В идеальном колебательном контуре, состоящем из конденсатора и катушки индуктивности, происходят свободные электромагнитные колебания. Изменение заряда конденсатора в колебательном контуре с течением времени показано в таблице.

$t, 10^{-6}$ c: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9

$q, 10^{-9}$ Кл: 1, 0,71, 0, –0,71, –1, –0,71, 0, 0,71, 1, 0,71

Выберите все верные утверждения о процессах, происходящих в контуре.

1)

Период колебаний равен $8\cdot10^{-6}$ с.

2)

Частота колебаний равна 250 кГц.

3)

В момент времени $t=2\cdot10^{-6}$ с модуль силы тока в контуре максимален.

4)

В момент времени $t=8\cdot10^{-6}$ с энергия магнитного поля катушки индуктивности максимальна.

5)

В момент времени $t=4\cdot10^{-6}$ с энергия электрического поля конденсатора минимальна.',
  NULL,
  '13',
  'multi_choice',
  2,
  NULL,
  'Колебательный контур — динамика q(t)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 15 (part 1, kim=15, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'c7c31277-8e6e-5990-89b2-59da75f97228'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  15, 1, 15,
  'При настройке колебательного контура радиопередатчика увеличивают электроёмкость его конденсатора. Как при этом изменяются частота колебаний силы тока в контуре и длина волны излучения передатчика?

Для каждой величины определите соответствующий характер изменения:

1)

увеличивается

2)

уменьшается

3)

не меняется

Запишите в таблицу выбранные цифры для каждой физической величины. Цифры в ответе могут повторяться.

Частота колебаний силы тока

Длина волны излучения',
  NULL,
  '21',
  'ordered',
  2,
  NULL,
  'Радиосвязь — частота колебаний'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 16 (part 1, kim=16, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'de3406a5-4290-595e-b739-8fc23b3fc673'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  16, 1, 16,
  'Ядро изотопа тория $^{234}_{90}\mathrm{Th}$ испытывает электронный $\beta^-$-распад, при этом образуется ядро элемента $^{A}_{Z}X$. Каков заряд Z образовавшегося ядра X (в единицах элементарного заряда)?',
  NULL,
  '91',
  'strict',
  1,
  NULL,
  'Ядерная физика — β⁻-распад'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 17 (part 1, kim=17, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '77bffdcf-04fe-58c1-89f6-79766dcc2ba4'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  17, 1, 17,
  'Как изменятся при $\alpha$-распаде радиоактивного изотопа висмута $^{212}_{83}\mathrm{Bi}$ массовое число ядра и число протонов в ядре? Для каждой величины определите соответствующий характер изменения:

1)

увеличится

2)

уменьшится

3)

не изменится

Запишите в таблицу выбранные цифры для каждой физической величины. Цифры в ответе могут повторяться.

Массовое число ядра

Число протонов в ядре',
  NULL,
  '22',
  'ordered',
  2,
  NULL,
  'Ядерная физика — α-распад изотопа'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 18 (part 1, kim=18, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '481910e5-3709-5bae-b2a0-a8400b898fe6'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  18, 1, 18,
  'Выберите все верные утверждения о физических явлениях, величинах и закономерностях. Запишите цифры, под которыми они указаны.

1)

Импульсом силы называется величина, равная произведению массы тела на его ускорение.

2)

В изотермическом процессе для постоянной массы газа отношение объёма газа к его давлению остаётся постоянным.

3)

Модуль сил взаимодействия двух точечных неподвижных заряженных тел обратно пропорционален квадрату расстояния между ними.

4)

Период свободных электромагнитных колебаний в идеальном колебательном контуре увеличивается прямо пропорционально увеличению электроёмкости конденсатора.

5)

В планетарной модели атома число протонов в ядре равно числу электронов в электронной оболочке нейтрального атома.',
  NULL,
  '35',
  'multi_choice',
  2,
  NULL,
  'Общие закономерности (множественный выбор)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 19 (part 1, kim=19, max_score=1, check_mode=pair) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'b5d4f449-2826-512e-a3f3-af83f63fb4c9'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  19, 1, 19,
  'Запишите показания динамометра с учётом абсолютной погрешности измерений. Абсолютная погрешность прямого измерения равна цене деления динамометра. Шкала проградуирована в ньютонах (Н).',
  'storage://mock-exam-variant-tasks/variant1/image15.png',
  '2,70,1',
  'pair',
  1,
  NULL,
  'Измерения — динамометр с погрешностью'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 20 (part 1, kim=20, max_score=1, check_mode=task20) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '7c5fd36e-dd0b-5415-8d9c-51889a259eee'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  20, 1, 20,
  'Необходимо экспериментально обнаружить зависимость силы тока, протекающего в цепи, от внутреннего сопротивления источника тока. 
Какие две схемы следует использовать для проведения такого исследования?

1)

4)

2)

5)

3)

Запишите в ответ номера выбранных схем.',
  '["storage://mock-exam-variant-tasks/variant1/image16.png", "storage://mock-exam-variant-tasks/variant1/image17.png", "storage://mock-exam-variant-tasks/variant1/image18.png", "storage://mock-exam-variant-tasks/variant1/image19.png", "storage://mock-exam-variant-tasks/variant1/image20.png"]',
  '14',
  'task20',
  1,
  NULL,
  'Эксперимент — выбор схем'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 21 (part 2, kim=21, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '6f49dbbb-5243-56ed-8619-900416792a26'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  21, 2, 21,
  'Постоянная масса разреженного азота участвует в процессах 1–2–3, график которого изображён на рисунке в координатах p–n, где p – давление газа, n – концентрация молекул газа. Опираясь на законы молекулярной физики, объясните, как изменяются в ходе процессов 1–2–3 абсолютная температура газа T и плотность газа $\rho$.',
  'storage://mock-exam-variant-tasks/variant1/image22.png',
  NULL,
  'manual',
  3,
  '1. Концентрация газа определяется соотношением $n=\frac{N}{V}$, где N – число молекул газа, V – занимаемый газом объём. Плотность газа определяется соотношением $\rho=\frac{m}{V}=\frac{m_0N}{V}=m_0n$, где $m_0$ – масса одной молекулы газа. Таким образом, плотность газа прямо пропорциональна концентрации его молекул.

2. Согласно графику, в процессе 1–2 концентрация молекул газа остаётся постоянной, а в процессе 2–3 увеличивается. Следовательно, и плотность газа в процессе 1–2 остаётся постоянной, а в процессе 2–3 увеличивается.

3. Давление газа связано с его абсолютной температурой и концентрацией его молекул уравнением $p=nkT$. В процессе 1–2 концентрация молекул газа остаётся постоянной при возрастающем давлении газа, следовательно, абсолютная температура газа будет увеличиваться. В процессе 2–3 концентрация молекул газа увеличивается при постоянном давлении, следовательно, абсолютная температура газа будет уменьшаться.

4. Таким образом, плотность газа в процессе 1–2 остаётся постоянной, в процессе 2–3 увеличивается; абсолютная температура газа в процессе 1–2 увеличивается, а в процессе 2–3 уменьшается.',
  'МКТ — концентрация и плотность газа (объяснение)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 22 (part 2, kim=22, max_score=2, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '4d55b92e-040f-5686-bc8d-71c320f7ba8d'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  22, 2, 22,
  'В процессе прямолинейного равноускоренного движения тело за 2 с
увеличило свою скорость в 4 раза. Какой путь прошло тело за это время, если его начальная скорость была равна 3 м/с?',
  NULL,
  NULL,
  'manual',
  2,
  '1. Согласно законам равноускоренного прямолинейного движения:

$s=v_0t+\frac{at^2}{2}$,   $4v_0=v_0+at$,

где $v_0$ – начальная скорость тела, a – модуль ускорения тела, s – путь, пройденный телом за время t.

2. Решая уравнения, получим выражение для ускорения тела: $a=\frac{3v_0}{t}$ и для пути, пройденного телом за время t:

$s=\frac{5v_0t}{2}=\frac{5\cdot3\cdot2}{2}=15$ м.

Ответ: 15 м',
  'Кинематика — равноускоренное движение (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 23 (part 2, kim=23, max_score=2, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '11418d43-f243-5d2d-be52-463677024566'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  23, 2, 23,
  'К аккумулятору с ЭДС $\mathcal{E}=15$ В подключили лампочку сопротивлением $R=8$ Ом. Определите внутреннее сопротивление аккумулятора, если на лампочке выделяется мощность, равная 18 Вт.',
  NULL,
  NULL,
  'manual',
  2,
  '1. В соответствии с законом Ома для полной цепи $\mathcal{E}=I(R+r)$ имеем:

$r=\frac{\mathcal{E}}{I}-R$,

где I – сила тока, r – внутреннее сопротивление аккумулятора.

2. Мощность, потребляемая лампочкой, определяется формулой $P=I^2R$, откуда

$I=\sqrt{\frac{P}{R}}$.

3. В итоге получим:

$r=\mathcal{E}\sqrt{\frac{R}{P}}-R=15\sqrt{\frac{8}{18}}-8=2$ Ом.

Ответ: 2 Ом',
  'Электричество — внутреннее сопротивление (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 24 (part 2, kim=24, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '9d1827fb-888e-5edc-8ffc-321f06098b7a'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  24, 2, 24,
  'В комнате размерами 6 м × 5 м × 3 м, в которой воздух имеет температуру 25 °C и относительную влажность 20%, включили увлажнитель воздуха производительностью 0,2 л/ч. Чему станет равна относительная влажность воздуха в комнате через 2 ч? Давление насыщенного водяного пара при температуре 25 °C равно 3,17 кПа. Комнату считать герметичным сосудом.',
  NULL,
  NULL,
  'manual',
  3,
  'Относительная влажность определяется парциальным давлением водяного пара p и давлением $p_{\text{нас}}$ насыщенного пара при той же температуре:

$\varphi=\frac{p}{p_{\text{нас}}}$.

За время $\tau$ работы увлажнителя с производительностью I испаряется масса воды $m=\rho I\tau$ плотностью $\rho$.

В результате исходная влажность в комнате $\varphi_1=\frac{p_1}{p_{\text{нас}}}$ возрастает до значения

$\varphi_2=\frac{p_2}{p_{\text{нас}}}=\frac{p_1+\Delta p}{p_{\text{нас}}}=\varphi_1+\frac{\Delta p}{p_{\text{нас}}}$.

Водяной пар в комнате объёмом V является разреженным газом, который подчиняется уравнению Менделеева – Клапейрона:

$pV=\frac{M}{\mu}RT$,

где M – масса водяного пара, p – парциальное давление, $\mu$ – его молярная масса. Увеличение массы пара в комнате на m (от $m_1$ до $m_2=m_1+m$) приводит к увеличению парциального давления на величину, пропорциональную испарившейся массе:

$\Delta p=\frac{mRT}{\mu V}=\frac{\rho I\tau RT}{\mu V}$.

Отсюда:

$\varphi_2=\varphi_1+\frac{\Delta p}{p_{\text{нас}}}=\varphi_1+\frac{\rho I\tau RT}{\mu p_{\text{нас}}V}$.

Подставляя значения физических величин, получим:

$\varphi_2=0{,}2+\frac{10^3\cdot0{,}2\cdot10^{-3}\cdot2}{18\cdot10^{-3}}\cdot\frac{8{,}31\cdot298}{3{,}17\cdot10^3\cdot6\cdot5\cdot3}\approx0{,}39=39\%$.

Ответ: $\varphi_2\approx39\%$',
  'МКТ — увлажнитель воздуха (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 25 (part 2, kim=25, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'e9fd88a9-0969-5419-a9c5-012e506682e2'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  25, 2, 25,
  'Два точечных источника света находятся на главной оптической оси тонкой собирающей линзы с оптической силой 2 дптр на некотором расстоянии L друг от друга. Линза находится между ними. Расстояние от линзы до одного из источников x = 30 см. Изображения обоих источников получились в одной точке. Найдите расстояние L. Постройте на отдельных рисунках изображения двух источников в линзе, указав ход лучей.',
  NULL,
  NULL,
  'manual',
  3,
  '1. Так как источники находятся с разных сторон от линзы, то для одного из них изображение должно быть действительным, а для другого – мнимым (см. рисунки в исходном docx: image55.emf, image56.emf).

2. Мнимое изображение даёт источник, который находится на расстоянии x = 30 см от линзы, так как $x<F=\frac{1}{D}=0{,}5$ м.

3. Формулы тонкой линзы для двух источников имеют вид:

$\frac{1}{x}-\frac{1}{f}=\frac{1}{F}$,   (1)

минус перед $f>0$, как на рисунке, так как изображение мнимое,

$\frac{1}{L-x}+\frac{1}{f}=\frac{1}{F}$,   (2)

где F – фокусное расстояние линзы, f – расстояние от линзы до точки, в которой находятся оба изображения.

4. Решая систему уравнений (1)–(2), получим:

$F=\frac{2x(L-x)}{L}$.

5. Так как оптическая сила линзы $D=\frac{1}{F}$, тогда получим:

$D=\frac{L}{2x(L-x)}$.

Окончательно $L=\frac{2Dx^2}{2Dx-1}=\frac{2\cdot2\cdot0{,}3^2}{2\cdot2\cdot0{,}3-1}=1{,}8$ м.

Ответ: L = 1,8 м',
  'Оптика — линза и источники (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 26 (part 2, kim=26, max_score=4, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '6f2508b7-6902-567c-9b0f-2afe0b0ea796'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  26, 2, 26,
  'На столе лежит доска массой M = 6 кг, на которой покоится брусок массой m = 2 кг. Доску начинают тянуть влево с постоянной горизонтальной силой F = 48 Н. При каком минимальном коэффициенте трения между бруском 
и доской μ1 груз будет оставаться неподвижным относительно доски? Коэффициент трения между доской и столом μ2 = 0,2. Сделайте схематичные рисунки с указанием сил, действующих на доску и на брусок.

Обоснуйте применимость законов, используемых для решения задачи.',
  NULL,
  NULL,
  'manual',
  4,
  'Обоснование

1. Рассмотрим задачу в инерциальной системе отсчёта (ИСО) «Стол».

2. Доска M и брусок m движутся в выбранной ИСО поступательно, поэтому описываем их моделью материальной точки. Тогда к описанию их движения можно применить второй закон Ньютона, справедливый для материальных точек в ИСО.

3. Для сил $\vec F_{\text{тр}1}$ и $\vec F_{\text{тр}2}$ из третьего закона Ньютона следует: $F_{\text{тр}1}=F_{\text{тр}2}$.

4. Так как коэффициент трения между грузом и доской $\mu_1$ минимальный, силы трения $F_{\text{тр}1}$ и $F_{\text{тр}2}$, действующие соответственно на груз и доску, – максимальные силы трения покоя, равные по модулю: $F_{\text{тр}1}=F_{\text{тр}2}=\mu_1N$.

5. Так как брусок покоится относительно доски, то $a_1=a_2=a$.

6. Для сил $N_1$ и P из третьего закона Ньютона следует: $N_1=P$.

Решение

1. На брусок, движущийся вместе с доской с ускорением $\vec a_1$, действуют сила тяжести $m\vec g$, нормальная составляющая силы реакции опоры $\vec N_1$ и сила трения $\vec F_{\text{тр}1}$ (см. рисунок в исходном docx: image70.emf).

2. На доску, движущуюся по поверхности стола с ускорением $\vec a_2$, действуют сила тяжести $M\vec g$, нормальная составляющая силы реакции опоры $\vec N_2$, силы трения $\vec F_{\text{тр}2}$ и $\vec F_{\text{тр}3}$, а также нормальная составляющая силы со стороны бруска $\vec P$ и сила тяги $\vec F$.

3. Запишем второй закон Ньютона для бруска: $m\vec a_1=\vec F_{\text{тр}1}+m\vec g+\vec N_1$, или в проекциях на оси:

$ma=F_{\text{тр}1}$,   $0=N_1-mg$.

И для доски: $M\vec a_2=\vec F+M\vec g+\vec N_2+\vec F_{\text{тр}2}+\vec F_{\text{тр}3}+\vec P$, или в проекциях на оси:

$Ma=F-F_{\text{тр}2}-F_{\text{тр}3}$,   $0=N_2-Mg-P$.

4. Модули сил трения, действующих на доску со стороны стола и на груз, определяются выражениями:

$F_{\text{тр}1}=\mu_1N_1$,   $F_{\text{тр}3}=\mu_2N_2$.

5. Из формул, учитывая, что $a_1=a_2=a$, по третьему закону Ньютона $F_{\text{тр}1}=F_{\text{тр}2}$, а $N_1=P$, найдём коэффициент трения $\mu_1$:

$\mu_1=\frac{F}{(M+m)g}-\mu_2=\frac{48}{(6+2)\cdot10}-0{,}2=0{,}4$.

Ответ: $\mu_1=0{,}4$',
  'Динамика — доска с бруском, трение (расчёт)'
) ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Validation:
-- SELECT COUNT(*) FROM public.mock_exam_variant_tasks WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131';
-- Expected: 26
-- SELECT kim_number, part, check_mode, max_score, correct_answer FROM public.mock_exam_variant_tasks WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131' ORDER BY kim_number;
                                                                                                                                                                                     
-- ─── Validation ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'Mock exams v1 apply complete';
  RAISE NOTICE 'Buckets: %', (SELECT COUNT(*) FROM storage.buckets WHERE id LIKE 'mock-exam-%');
  RAISE NOTICE 'Tables: %', (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'mock_exam%');
  RAISE NOTICE 'Variants: %', (SELECT COUNT(*) FROM public.mock_exam_variants);
  RAISE NOTICE 'Tasks: %', (SELECT COUNT(*) FROM public.mock_exam_variant_tasks);
END $$;
