-- Sprint 1.1: Homework Tutor DB core
-- NOTE:
-- We intentionally use homework_tutor_* names to avoid collisions with
-- existing legacy homework_* tables that are already used in production flows.

-- 1) Core tables
CREATE TABLE IF NOT EXISTS public.homework_tutor_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL CHECK (subject IN ('math', 'physics', 'history', 'social', 'english', 'cs')),
  topic TEXT NULL,
  description TEXT NULL,
  deadline TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.homework_tutor_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  order_num INT NOT NULL,
  task_text TEXT NOT NULL,
  task_image_url TEXT NULL,
  correct_answer TEXT NULL,
  solution_steps TEXT NULL,
  max_score INT NOT NULL DEFAULT 1,
  CONSTRAINT homework_tutor_tasks_assignment_order_unique UNIQUE (assignment_id, order_num)
);

CREATE TABLE IF NOT EXISTS public.homework_tutor_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_chat_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'ai_checked', 'tutor_reviewed')),
  submitted_at TIMESTAMPTZ NULL,
  total_score INT NULL,
  total_max_score INT NULL,
  CONSTRAINT homework_tutor_submissions_assignment_student_unique UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS public.homework_tutor_submission_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.homework_tutor_submissions(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.homework_tutor_tasks(id) ON DELETE RESTRICT,
  student_image_urls TEXT[] NULL,
  student_text TEXT NULL,
  recognized_text TEXT NULL,
  ai_is_correct BOOLEAN NULL,
  ai_confidence DOUBLE PRECISION NULL,
  ai_feedback TEXT NULL,
  ai_error_type TEXT NULL CHECK (
    ai_error_type IN (
      'calculation',
      'concept',
      'formatting',
      'incomplete',
      'factual_error',
      'weak_argument',
      'wrong_answer',
      'partial',
      'correct'
    )
  ),
  ai_score INT NULL,
  tutor_override_correct BOOLEAN NULL,
  tutor_comment TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT homework_tutor_submission_items_submission_task_unique UNIQUE (submission_id, task_id),
  CONSTRAINT homework_tutor_submission_items_images_limit CHECK (COALESCE(array_length(student_image_urls, 1), 0) <= 4)
);

CREATE TABLE IF NOT EXISTS public.homework_tutor_student_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notified BOOLEAN NOT NULL DEFAULT false,
  notified_at TIMESTAMPTZ NULL,
  CONSTRAINT homework_tutor_student_assignments_assignment_student_unique UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS public.homework_tutor_user_bot_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'IDLE' CHECK (state IN ('IDLE', 'HW_SELECTING', 'HW_SUBMITTING', 'HW_CONFIRMING', 'HW_REVIEW')),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) Indexes
CREATE INDEX IF NOT EXISTS idx_hw_tutor_assignments_tutor_status_deadline
  ON public.homework_tutor_assignments(tutor_id, status, deadline);

CREATE INDEX IF NOT EXISTS idx_hw_tutor_tasks_assignment_order
  ON public.homework_tutor_tasks(assignment_id, order_num);

CREATE INDEX IF NOT EXISTS idx_hw_tutor_student_assignments_student_assignment
  ON public.homework_tutor_student_assignments(student_id, assignment_id);

CREATE INDEX IF NOT EXISTS idx_hw_tutor_submissions_assignment_student_status
  ON public.homework_tutor_submissions(assignment_id, student_id, status);

CREATE INDEX IF NOT EXISTS idx_hw_tutor_submission_items_submission_task
  ON public.homework_tutor_submission_items(submission_id, task_id);

-- 3) RLS enable
ALTER TABLE public.homework_tutor_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_tutor_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_tutor_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_tutor_submission_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_tutor_student_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_tutor_user_bot_state ENABLE ROW LEVEL SECURITY;

-- 4) RLS policies: tutors
CREATE POLICY "HW tutor assignments select own"
  ON public.homework_tutor_assignments
  FOR SELECT
  TO authenticated
  USING (tutor_id = auth.uid());

CREATE POLICY "HW tutor assignments insert own"
  ON public.homework_tutor_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (tutor_id = auth.uid());

CREATE POLICY "HW tutor assignments update own"
  ON public.homework_tutor_assignments
  FOR UPDATE
  TO authenticated
  USING (tutor_id = auth.uid())
  WITH CHECK (tutor_id = auth.uid());

CREATE POLICY "HW tutor assignments delete own"
  ON public.homework_tutor_assignments
  FOR DELETE
  TO authenticated
  USING (tutor_id = auth.uid());

CREATE POLICY "HW tutor tasks select by assignment owner"
  ON public.homework_tutor_tasks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_tasks.assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

CREATE POLICY "HW tutor tasks insert by assignment owner"
  ON public.homework_tutor_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_tasks.assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

CREATE POLICY "HW tutor tasks update by assignment owner"
  ON public.homework_tutor_tasks
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_tasks.assignment_id
        AND a.tutor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_tasks.assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

CREATE POLICY "HW tutor tasks delete by assignment owner"
  ON public.homework_tutor_tasks
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_tasks.assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

CREATE POLICY "HW tutor student assignments select by owner"
  ON public.homework_tutor_student_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_student_assignments.assignment_id
        AND a.tutor_id = auth.uid()
    )
    AND public.is_tutor_of_student(homework_tutor_student_assignments.student_id)
  );

CREATE POLICY "HW tutor student assignments insert by owner"
  ON public.homework_tutor_student_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_student_assignments.assignment_id
        AND a.tutor_id = auth.uid()
    )
    AND public.is_tutor_of_student(homework_tutor_student_assignments.student_id)
  );

CREATE POLICY "HW tutor student assignments delete by owner"
  ON public.homework_tutor_student_assignments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_student_assignments.assignment_id
        AND a.tutor_id = auth.uid()
    )
    AND public.is_tutor_of_student(homework_tutor_student_assignments.student_id)
  );

CREATE POLICY "HW tutor submissions select by assignment owner"
  ON public.homework_tutor_submissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_submissions.assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

CREATE POLICY "HW tutor submissions update by assignment owner"
  ON public.homework_tutor_submissions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_submissions.assignment_id
        AND a.tutor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      WHERE a.id = homework_tutor_submissions.assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

CREATE POLICY "HW tutor submission items select by assignment owner"
  ON public.homework_tutor_submission_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_submissions s
      JOIN public.homework_tutor_tasks t ON t.id = homework_tutor_submission_items.task_id
      JOIN public.homework_tutor_assignments a ON a.id = s.assignment_id
      WHERE s.id = homework_tutor_submission_items.submission_id
        AND t.assignment_id = s.assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

CREATE POLICY "HW tutor submission items update by assignment owner"
  ON public.homework_tutor_submission_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_submissions s
      JOIN public.homework_tutor_tasks t ON t.id = homework_tutor_submission_items.task_id
      JOIN public.homework_tutor_assignments a ON a.id = s.assignment_id
      WHERE s.id = homework_tutor_submission_items.submission_id
        AND t.assignment_id = s.assignment_id
        AND a.tutor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_submissions s
      JOIN public.homework_tutor_tasks t ON t.id = homework_tutor_submission_items.task_id
      JOIN public.homework_tutor_assignments a ON a.id = s.assignment_id
      WHERE s.id = homework_tutor_submission_items.submission_id
        AND t.assignment_id = s.assignment_id
        AND a.tutor_id = auth.uid()
    )
  );

-- 5) RLS policies: students
CREATE POLICY "HW students select assigned assignments"
  ON public.homework_tutor_assignments
  FOR SELECT
  TO authenticated
  USING (
    status IN ('active', 'closed')
    AND EXISTS (
      SELECT 1
      FROM public.homework_tutor_student_assignments hsa
      WHERE hsa.assignment_id = homework_tutor_assignments.id
        AND hsa.student_id = auth.uid()
    )
  );

CREATE POLICY "HW students select tasks of assigned assignments"
  ON public.homework_tutor_tasks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      JOIN public.homework_tutor_student_assignments hsa ON hsa.assignment_id = a.id
      WHERE a.id = homework_tutor_tasks.assignment_id
        AND a.status IN ('active', 'closed')
        AND hsa.student_id = auth.uid()
    )
  );

CREATE POLICY "HW students select own assignment links"
  ON public.homework_tutor_student_assignments
  FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "HW students insert own submissions"
  ON public.homework_tutor_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      JOIN public.homework_tutor_student_assignments hsa ON hsa.assignment_id = a.id
      WHERE a.id = homework_tutor_submissions.assignment_id
        AND hsa.student_id = auth.uid()
        AND a.status IN ('active', 'closed')
    )
  );

CREATE POLICY "HW students select own submissions"
  ON public.homework_tutor_submissions
  FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "HW students update own in progress submissions"
  ON public.homework_tutor_submissions
  FOR UPDATE
  TO authenticated
  USING (
    student_id = auth.uid()
    AND status = 'in_progress'
  )
  WITH CHECK (
    student_id = auth.uid()
    AND status IN ('in_progress', 'submitted')
    AND EXISTS (
      SELECT 1
      FROM public.homework_tutor_assignments a
      JOIN public.homework_tutor_student_assignments hsa ON hsa.assignment_id = a.id
      WHERE a.id = homework_tutor_submissions.assignment_id
        AND hsa.student_id = auth.uid()
        AND a.status IN ('active', 'closed')
    )
  );

CREATE POLICY "HW students insert own submission items"
  ON public.homework_tutor_submission_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_submissions s
      JOIN public.homework_tutor_tasks t ON t.id = homework_tutor_submission_items.task_id
      WHERE s.id = homework_tutor_submission_items.submission_id
        AND t.assignment_id = s.assignment_id
        AND s.student_id = auth.uid()
        AND s.status = 'in_progress'
    )
  );

CREATE POLICY "HW students select own submission items"
  ON public.homework_tutor_submission_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_submissions s
      JOIN public.homework_tutor_tasks t ON t.id = homework_tutor_submission_items.task_id
      WHERE s.id = homework_tutor_submission_items.submission_id
        AND t.assignment_id = s.assignment_id
        AND s.student_id = auth.uid()
    )
  );

CREATE POLICY "HW students update own in progress submission items"
  ON public.homework_tutor_submission_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_submissions s
      JOIN public.homework_tutor_tasks t ON t.id = homework_tutor_submission_items.task_id
      WHERE s.id = homework_tutor_submission_items.submission_id
        AND t.assignment_id = s.assignment_id
        AND s.student_id = auth.uid()
        AND s.status = 'in_progress'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.homework_tutor_submissions s
      JOIN public.homework_tutor_tasks t ON t.id = homework_tutor_submission_items.task_id
      WHERE s.id = homework_tutor_submission_items.submission_id
        AND t.assignment_id = s.assignment_id
        AND s.student_id = auth.uid()
        AND s.status = 'in_progress'
    )
  );

CREATE POLICY "HW students select own bot state"
  ON public.homework_tutor_user_bot_state
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "HW students insert own bot state"
  ON public.homework_tutor_user_bot_state
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "HW students update own bot state"
  ON public.homework_tutor_user_bot_state
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 6) Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('homework-images', 'homework-images', false)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

-- 7) Storage policies for homework-images
CREATE POLICY "HW images upload as owner for own submission"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'homework-images'
  AND owner = auth.uid()
  AND COALESCE(array_length(storage.foldername(name), 1), 0) = 4
  AND (storage.foldername(name))[1] = 'homework'
  AND EXISTS (
    SELECT 1
    FROM public.homework_tutor_submissions s
    JOIN public.homework_tutor_tasks t ON t.id::text = (storage.foldername(name))[4]
    JOIN public.homework_tutor_assignments a ON a.id = t.assignment_id
    WHERE s.id::text = (storage.foldername(name))[3]
      AND a.id::text = (storage.foldername(name))[2]
      AND s.assignment_id = a.id
      AND s.student_id = auth.uid()
  )
);

CREATE POLICY "HW images read owner or assignment tutor"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'homework-images'
  AND COALESCE(array_length(storage.foldername(name), 1), 0) = 4
  AND (storage.foldername(name))[1] = 'homework'
  AND (
    owner = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.homework_tutor_submissions s
      JOIN public.homework_tutor_tasks t ON t.id::text = (storage.foldername(name))[4]
      JOIN public.homework_tutor_assignments a ON a.id = t.assignment_id
      WHERE s.id::text = (storage.foldername(name))[3]
        AND a.id::text = (storage.foldername(name))[2]
        AND s.assignment_id = a.id
        AND a.tutor_id = auth.uid()
    )
  )
);

CREATE POLICY "HW images update own upload"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'homework-images'
  AND owner = auth.uid()
  AND COALESCE(array_length(storage.foldername(name), 1), 0) = 4
  AND (storage.foldername(name))[1] = 'homework'
  AND EXISTS (
    SELECT 1
    FROM public.homework_tutor_submissions s
    JOIN public.homework_tutor_tasks t ON t.id::text = (storage.foldername(name))[4]
    JOIN public.homework_tutor_assignments a ON a.id = t.assignment_id
    WHERE s.id::text = (storage.foldername(name))[3]
      AND a.id::text = (storage.foldername(name))[2]
      AND s.assignment_id = a.id
      AND s.student_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'homework-images'
  AND owner = auth.uid()
  AND COALESCE(array_length(storage.foldername(name), 1), 0) = 4
  AND (storage.foldername(name))[1] = 'homework'
  AND EXISTS (
    SELECT 1
    FROM public.homework_tutor_submissions s
    JOIN public.homework_tutor_tasks t ON t.id::text = (storage.foldername(name))[4]
    JOIN public.homework_tutor_assignments a ON a.id = t.assignment_id
    WHERE s.id::text = (storage.foldername(name))[3]
      AND a.id::text = (storage.foldername(name))[2]
      AND s.assignment_id = a.id
      AND s.student_id = auth.uid()
  )
);

CREATE POLICY "HW images delete own upload"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'homework-images'
  AND owner = auth.uid()
  AND COALESCE(array_length(storage.foldername(name), 1), 0) = 4
  AND (storage.foldername(name))[1] = 'homework'
  AND EXISTS (
    SELECT 1
    FROM public.homework_tutor_submissions s
    JOIN public.homework_tutor_tasks t ON t.id::text = (storage.foldername(name))[4]
    JOIN public.homework_tutor_assignments a ON a.id = t.assignment_id
    WHERE s.id::text = (storage.foldername(name))[3]
      AND a.id::text = (storage.foldername(name))[2]
      AND s.assignment_id = a.id
      AND s.student_id = auth.uid()
  )
);
