ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS solution_text TEXT NULL,
  ADD COLUMN IF NOT EXISTS solution_image_urls TEXT NULL;

COMMENT ON COLUMN public.homework_tutor_tasks.solution_text IS
  'Эталонное решение от репетитора (текст). Единое поле "Решение для AI": используется AI на путях check/hint/chat как референс. НИКОГДА не возвращается ученику через getStudentAssignment. Может быть заполнено автоматически при импорте из KB (kb_tasks.solution).';

COMMENT ON COLUMN public.homework_tutor_tasks.solution_image_urls IS
  'Фото эталонного решения. Dual-format TEXT: single "storage://..." ref ИЛИ JSON-array refs. Лимит 5. Используй parseAttachmentUrls / serializeAttachmentUrls. Видимость: только репетитор + AI-промпт. НИКОГДА не отдаётся ученику.';