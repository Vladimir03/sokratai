-- KB Knowledge Base: core tables, homework link, RLS, indexes

-- 0) Enum: exam_type
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exam_type') THEN
    CREATE TYPE exam_type AS ENUM ('ege', 'oge');
  END IF;
END $$;

-- 1) kb_topics
CREATE TABLE IF NOT EXISTS public.kb_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  section TEXT NOT NULL,
  exam exam_type NOT NULL,
  kim_numbers INTEGER[] DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- kb_subtopics
CREATE TABLE IF NOT EXISTS public.kb_subtopics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES public.kb_topics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- 2) kb_folders
CREATE TABLE IF NOT EXISTS public.kb_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.kb_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3) kb_tasks
CREATE TABLE IF NOT EXISTS public.kb_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES public.kb_topics(id),
  subtopic_id UUID REFERENCES public.kb_subtopics(id),
  folder_id UUID REFERENCES public.kb_folders(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES auth.users(id),
  exam exam_type,
  kim_number INTEGER,
  text TEXT NOT NULL,
  answer TEXT,
  solution TEXT,
  answer_format TEXT,
  source_label TEXT DEFAULT 'socrat',
  attachment_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT kb_tasks_space_check CHECK (topic_id IS NOT NULL OR folder_id IS NOT NULL)
);

-- 4) kb_materials
CREATE TABLE IF NOT EXISTS public.kb_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES public.kb_topics(id),
  folder_id UUID REFERENCES public.kb_folders(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES auth.users(id),
  type TEXT NOT NULL CHECK (type IN ('file', 'link', 'media', 'board')),
  name TEXT NOT NULL,
  format TEXT,
  url TEXT,
  storage_key TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5) homework_kb_tasks
CREATE TABLE IF NOT EXISTS public.homework_kb_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_id UUID NOT NULL REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.kb_tasks(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0,
  task_text_snapshot TEXT NOT NULL,
  task_answer_snapshot TEXT,
  task_solution_snapshot TEXT,
  snapshot_edited BOOLEAN DEFAULT FALSE,
  added_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT homework_kb_tasks_hw_task_unique UNIQUE(homework_id, task_id)
);

-- 6) Indexes
CREATE INDEX IF NOT EXISTS idx_kb_folders_owner ON public.kb_folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_kb_folders_parent ON public.kb_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_kb_tasks_topic ON public.kb_tasks(topic_id);
CREATE INDEX IF NOT EXISTS idx_kb_tasks_folder ON public.kb_tasks(folder_id);
CREATE INDEX IF NOT EXISTS idx_kb_tasks_owner ON public.kb_tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_kb_tasks_exam ON public.kb_tasks(exam);
CREATE INDEX IF NOT EXISTS idx_kb_tasks_text_search ON public.kb_tasks USING gin(to_tsvector('russian', text));
CREATE INDEX IF NOT EXISTS idx_kb_materials_topic ON public.kb_materials(topic_id);
CREATE INDEX IF NOT EXISTS idx_kb_materials_folder ON public.kb_materials(folder_id);
CREATE INDEX IF NOT EXISTS idx_kb_topics_exam ON public.kb_topics(exam);
CREATE INDEX IF NOT EXISTS idx_homework_kb_tasks_homework ON public.homework_kb_tasks(homework_id);
CREATE INDEX IF NOT EXISTS idx_homework_kb_tasks_task ON public.homework_kb_tasks(task_id);

-- 7) RLS Enable
ALTER TABLE public.kb_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_subtopics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_kb_tasks ENABLE ROW LEVEL SECURITY;

-- Helper function
CREATE OR REPLACE FUNCTION public.kb_folder_owned_by(_folder_id uuid, _owner_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM kb_folders WHERE id = _folder_id AND owner_id = _owner_id)
$$;

-- 8) RLS Policies
CREATE POLICY "KB topics select all authenticated" ON public.kb_topics FOR SELECT TO authenticated USING (true);
CREATE POLICY "KB subtopics select all authenticated" ON public.kb_subtopics FOR SELECT TO authenticated USING (true);

CREATE POLICY "KB folders select own" ON public.kb_folders FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "KB folders insert own" ON public.kb_folders FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() AND (parent_id IS NULL OR public.kb_folder_owned_by(parent_id, auth.uid())));
CREATE POLICY "KB folders update own" ON public.kb_folders FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid() AND (parent_id IS NULL OR public.kb_folder_owned_by(parent_id, auth.uid())));
CREATE POLICY "KB folders delete own" ON public.kb_folders FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "KB tasks select public or own" ON public.kb_tasks FOR SELECT TO authenticated USING (owner_id IS NULL OR owner_id = auth.uid());
CREATE POLICY "KB tasks insert own" ON public.kb_tasks FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() AND (folder_id IS NULL OR public.kb_folder_owned_by(folder_id, auth.uid())));
CREATE POLICY "KB tasks update own" ON public.kb_tasks FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid() AND (folder_id IS NULL OR public.kb_folder_owned_by(folder_id, auth.uid())));
CREATE POLICY "KB tasks delete own" ON public.kb_tasks FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "KB materials select public or own" ON public.kb_materials FOR SELECT TO authenticated USING (owner_id IS NULL OR owner_id = auth.uid());
CREATE POLICY "KB materials insert own" ON public.kb_materials FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() AND (folder_id IS NULL OR public.kb_folder_owned_by(folder_id, auth.uid())));
CREATE POLICY "KB materials update own" ON public.kb_materials FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid() AND (folder_id IS NULL OR public.kb_folder_owned_by(folder_id, auth.uid())));
CREATE POLICY "KB materials delete own" ON public.kb_materials FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- homework_kb_tasks helper
CREATE OR REPLACE FUNCTION public.is_kb_homework_tutor(_homework_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM homework_tutor_assignments WHERE id = _homework_id AND tutor_id = auth.uid())
$$;

CREATE POLICY "KB hw tasks select by tutor" ON public.homework_kb_tasks FOR SELECT TO authenticated USING (public.is_kb_homework_tutor(homework_id));
CREATE POLICY "KB hw tasks insert by tutor" ON public.homework_kb_tasks FOR INSERT TO authenticated WITH CHECK (public.is_kb_homework_tutor(homework_id));
CREATE POLICY "KB hw tasks update by tutor" ON public.homework_kb_tasks FOR UPDATE TO authenticated USING (public.is_kb_homework_tutor(homework_id)) WITH CHECK (public.is_kb_homework_tutor(homework_id));
CREATE POLICY "KB hw tasks delete by tutor" ON public.homework_kb_tasks FOR DELETE TO authenticated USING (public.is_kb_homework_tutor(homework_id));

CREATE POLICY "KB hw tasks select by student" ON public.homework_kb_tasks FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.homework_tutor_student_assignments sa
    JOIN public.homework_tutor_assignments a ON a.id = sa.assignment_id
    WHERE sa.assignment_id = homework_kb_tasks.homework_id
      AND sa.student_id = auth.uid()
      AND a.status IN ('active', 'closed')
  )
);

-- 13) Grants
GRANT SELECT ON public.kb_topics TO authenticated;
GRANT SELECT ON public.kb_subtopics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_folders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_materials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homework_kb_tasks TO authenticated;