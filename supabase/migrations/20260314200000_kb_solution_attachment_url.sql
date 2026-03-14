-- Add solution_attachment_url to kb_tasks for solution/explanation images.
-- Same format as attachment_url: single storage ref or JSON array of refs.
ALTER TABLE public.kb_tasks
  ADD COLUMN IF NOT EXISTS solution_attachment_url TEXT;
