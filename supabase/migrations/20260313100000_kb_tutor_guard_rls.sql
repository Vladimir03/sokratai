-- KB: restrict write operations to tutors only
-- Catalog reads remain open to all authenticated users (public reference data).
-- Personal KB write operations (folders, tasks, materials) require tutor role.
-- Uses existing is_tutor(_user_id) SECURITY DEFINER function.

-- ═══ kb_folders: replace write policies with tutor-guarded versions ═══

DROP POLICY IF EXISTS "KB folders insert own" ON public.kb_folders;
DROP POLICY IF EXISTS "KB folders update own" ON public.kb_folders;
DROP POLICY IF EXISTS "KB folders delete own" ON public.kb_folders;

CREATE POLICY "KB folders insert own tutor"
  ON public.kb_folders FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND public.is_tutor(auth.uid())
    AND (parent_id IS NULL OR public.kb_folder_owned_by(parent_id, auth.uid()))
  );

CREATE POLICY "KB folders update own tutor"
  ON public.kb_folders FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND public.is_tutor(auth.uid())
    AND (parent_id IS NULL OR public.kb_folder_owned_by(parent_id, auth.uid()))
  );

CREATE POLICY "KB folders delete own tutor"
  ON public.kb_folders FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND public.is_tutor(auth.uid()));

-- ═══ kb_tasks: replace write policies with tutor-guarded versions ═══

DROP POLICY IF EXISTS "KB tasks insert own" ON public.kb_tasks;
DROP POLICY IF EXISTS "KB tasks update own" ON public.kb_tasks;
DROP POLICY IF EXISTS "KB tasks delete own" ON public.kb_tasks;

CREATE POLICY "KB tasks insert own tutor"
  ON public.kb_tasks FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND public.is_tutor(auth.uid())
    AND (folder_id IS NULL OR public.kb_folder_owned_by(folder_id, auth.uid()))
  );

CREATE POLICY "KB tasks update own tutor"
  ON public.kb_tasks FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND public.is_tutor(auth.uid())
    AND (folder_id IS NULL OR public.kb_folder_owned_by(folder_id, auth.uid()))
  );

CREATE POLICY "KB tasks delete own tutor"
  ON public.kb_tasks FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND public.is_tutor(auth.uid()));

-- ═══ kb_materials: replace write policies with tutor-guarded versions ═══

DROP POLICY IF EXISTS "KB materials insert own" ON public.kb_materials;
DROP POLICY IF EXISTS "KB materials update own" ON public.kb_materials;
DROP POLICY IF EXISTS "KB materials delete own" ON public.kb_materials;

CREATE POLICY "KB materials insert own tutor"
  ON public.kb_materials FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND public.is_tutor(auth.uid())
    AND (folder_id IS NULL OR public.kb_folder_owned_by(folder_id, auth.uid()))
  );

CREATE POLICY "KB materials update own tutor"
  ON public.kb_materials FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND public.is_tutor(auth.uid())
    AND (folder_id IS NULL OR public.kb_folder_owned_by(folder_id, auth.uid()))
  );

CREATE POLICY "KB materials delete own tutor"
  ON public.kb_materials FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND public.is_tutor(auth.uid()));

-- ═══ kb_search: grant execute to authenticated ═══
-- Without this, the SECURITY DEFINER function is not callable by app users.
GRANT EXECUTE ON FUNCTION public.kb_search TO authenticated;
