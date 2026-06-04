ALTER TABLE public.homework_tutor_templates
  ADD COLUMN IF NOT EXISTS exam_type text,
  ADD COLUMN IF NOT EXISTS feedback_language text,
  ADD COLUMN IF NOT EXISTS disable_ai_bootstrap boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.homework_tutor_templates.exam_type IS
  'ege | oge — saved from assignment so reuse keeps the FIPI grading methodology. NULL = unset.';
COMMENT ON COLUMN public.homework_tutor_templates.feedback_language IS
  'auto | russian | target — assignment-level AI feedback language. Only meaningful for language subjects (french/english/spanish). NULL = auto.';
COMMENT ON COLUMN public.homework_tutor_templates.disable_ai_bootstrap IS
  'Mirrors homework_tutor_assignments.disable_ai_bootstrap so reuse preserves the AI-intro toggle.';

ALTER TABLE public.kb_tasks
  ADD COLUMN IF NOT EXISTS rubric_text text,
  ADD COLUMN IF NOT EXISTS rubric_image_urls text;

COMMENT ON COLUMN public.kb_tasks.rubric_text IS
  'Grading criteria (rubric). Personal base only — never copied into the public catalog by the moderation triggers. Mirrors homework_tutor_tasks.rubric_text.';
COMMENT ON COLUMN public.kb_tasks.rubric_image_urls IS
  'Rubric photos (dual-format storage refs, limit 3). Personal base only; excluded from catalog publish. Read via parseAttachmentUrls().';