
-- Moderators can see folders owned by other moderators
CREATE POLICY "KB folders select moderator peers"
ON public.kb_folders FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'moderator') AND public.has_role(owner_id, 'moderator')
);

-- Moderators can see tasks owned by other moderators
CREATE POLICY "KB tasks select moderator peers"
ON public.kb_tasks FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'moderator') AND public.has_role(owner_id, 'moderator')
);

-- Moderators can update tasks in peers' folders
CREATE POLICY "KB tasks update moderator peers"
ON public.kb_tasks FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'moderator') AND public.has_role(owner_id, 'moderator')
)
WITH CHECK (
  public.has_role(auth.uid(), 'moderator')
);

-- Moderators can delete tasks in peers' folders
CREATE POLICY "KB tasks delete moderator peers"
ON public.kb_tasks FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'moderator') AND public.has_role(owner_id, 'moderator')
);
