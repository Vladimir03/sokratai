-- =============================================================================
-- Homework assignment folders (tutor-only organization). Запрос Елены Ивановой:
-- «Упорядочивание Домашек по папкам». Зеркало kb_folders («Моя база»).
--
-- КРИТИЧНО — отличие от KB: удаление папки ДЗ НЕ удаляет задания внутри.
-- В папке лежат ЖИВЫЕ задания со сдачами учеников → ON DELETE SET NULL
-- переводит их в «Без папки», НИКОГДА не удаляет (в KB удаление папки удаляет
-- задачи — здесь это запрещено).
--
-- Additive only: новая таблица + новая nullable-колонка + индексы.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.homework_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- rule 40 FK-drift: homework_tutor_assignments.tutor_id → auth.users(id),
  -- поэтому папки тоже ссылаются на auth.users(id), не на tutors.id.
  tutor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- parent_id зарезервирован под будущую вложенность; в v1 всегда NULL (плоские папки).
  parent_id UUID REFERENCES public.homework_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ADD COLUMN — additive. ON DELETE SET NULL: задание возвращается в «Без папки»
-- при удалении папки, сдачи/треды (привязаны к assignment) не затрагиваются.
ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS folder_id UUID
  REFERENCES public.homework_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_homework_folders_tutor
  ON public.homework_folders(tutor_id);
CREATE INDEX IF NOT EXISTS idx_homework_folders_parent
  ON public.homework_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_hw_assignments_folder
  ON public.homework_tutor_assignments(folder_id);

-- RLS: репетитор владеет только своими папками (tutor_id = auth.uid()).
ALTER TABLE public.homework_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HW folders select own" ON public.homework_folders
  FOR SELECT TO authenticated USING (tutor_id = auth.uid());
CREATE POLICY "HW folders insert own" ON public.homework_folders
  FOR INSERT TO authenticated WITH CHECK (tutor_id = auth.uid());
CREATE POLICY "HW folders update own" ON public.homework_folders
  FOR UPDATE TO authenticated USING (tutor_id = auth.uid())
  WITH CHECK (tutor_id = auth.uid());
CREATE POLICY "HW folders delete own" ON public.homework_folders
  FOR DELETE TO authenticated USING (tutor_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.homework_folders TO authenticated;
