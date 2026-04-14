ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS rubric_image_urls TEXT NULL;

COMMENT ON COLUMN public.homework_tutor_tasks.rubric_image_urls IS
  'Storage refs для фото критериев проверки. Dual-format: single "storage://..." ref ИЛИ JSON-array. Лимит 3. NULL = нет фото. Видимость: только репетитор.';

COMMENT ON COLUMN public.homework_tutor_tasks.task_image_url IS
  'Storage refs для фото условия задачи. Dual-format: single "storage://..." ref (legacy + когда одно фото) ИЛИ JSON-array "[...]". Лимит 5. Используй parseAttachmentUrls / serializeAttachmentUrls.';
