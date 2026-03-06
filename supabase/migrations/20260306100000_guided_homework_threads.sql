-- Phase 1: Guided Homework Chat — schema additions
-- Adds workflow_mode to assignments + thread/message/task_state tables

-- 1a. Column workflow_mode on homework_tutor_assignments
ALTER TABLE homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS workflow_mode text NOT NULL DEFAULT 'classic'
  CHECK (workflow_mode IN ('classic', 'guided_chat'));

-- 1b. Table homework_tutor_threads (1 thread = 1 student_assignment)
CREATE TABLE IF NOT EXISTS homework_tutor_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_assignment_id uuid NOT NULL REFERENCES homework_tutor_student_assignments(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  current_task_order int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_assignment_id)
);

-- 1c. Table homework_tutor_thread_messages
CREATE TABLE IF NOT EXISTS homework_tutor_thread_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES homework_tutor_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  image_url text,
  task_order int,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1d. Table homework_tutor_task_states
CREATE TABLE IF NOT EXISTS homework_tutor_task_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES homework_tutor_threads(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES homework_tutor_tasks(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'active', 'completed', 'skipped')),
  attempts int NOT NULL DEFAULT 0,
  best_score int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, task_id)
);

-- 1e. Indexes
CREATE INDEX IF NOT EXISTS idx_threads_student_assignment ON homework_tutor_threads(student_assignment_id);
CREATE INDEX IF NOT EXISTS idx_thread_messages_thread ON homework_tutor_thread_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_states_thread ON homework_tutor_task_states(thread_id);

-- 1f. RLS
ALTER TABLE homework_tutor_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_tutor_thread_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_tutor_task_states ENABLE ROW LEVEL SECURITY;

-- Student can read own threads
CREATE POLICY "student_read_own_threads" ON homework_tutor_threads
  FOR SELECT USING (
    student_assignment_id IN (
      SELECT id FROM homework_tutor_student_assignments WHERE student_id = auth.uid()
    )
  );

-- Student can read own thread messages
CREATE POLICY "student_read_own_thread_messages" ON homework_tutor_thread_messages
  FOR SELECT USING (
    thread_id IN (
      SELECT t.id FROM homework_tutor_threads t
      JOIN homework_tutor_student_assignments sa ON sa.id = t.student_assignment_id
      WHERE sa.student_id = auth.uid()
    )
  );

-- Student can read own task states
CREATE POLICY "student_read_own_task_states" ON homework_tutor_task_states
  FOR SELECT USING (
    thread_id IN (
      SELECT t.id FROM homework_tutor_threads t
      JOIN homework_tutor_student_assignments sa ON sa.id = t.student_assignment_id
      WHERE sa.student_id = auth.uid()
    )
  );
