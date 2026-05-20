-- ════════════════════════════════════════════════════════════════════════════
-- Storage protection: prevent orphaning kb_tasks via manual Storage UI deletes
--
-- Background (2026-05-20):
-- 4+ физических файлов в bucket `kb-attachments` под папкой Егора были удалены
-- через Lovable Cloud Storage UI без предварительной очистки
-- kb_tasks.attachment_url. Результат: канонические копии в каталоге
-- (Магнетизм / возможно другие разделы) ссылаются на несуществующие объекты,
-- createSignedUrl возвращает 400, image-only карточки рендерятся пустыми.
--
-- Application-level flows безопасны — они уже УДАЛЯЮТ/ОЧИЩАЮТ kb_tasks ref
-- ДО удаления storage object:
--   - useKnowledgeBase.removeTask (src/hooks/useKnowledgeBase.ts:129) —
--     DELETE FROM kb_tasks → ПОТОМ deleteKBTaskImage(refs)
--   - EditTaskModal onSuccess — UPDATE kb_tasks SET attachment_url=<new>
--     → ПОТОМ deleteKBTaskImage(removedRefs)
--   - CreateTaskModal onError / catch — orphan blob cleanup перед INSERT
--     (kb_tasks row ещё не создан)
--
-- Этот триггер срабатывает ТОЛЬКО когда:
--   - кто-то идёт в Lovable Cloud Storage UI и удаляет файл вручную, ИЛИ
--   - бэкап/восстановление случайно удаляет blob без UPDATE на kb_tasks
-- В обоих случаях это unwanted behavior — триггер RAISE EXCEPTION с
-- понятным error message, заставляя оператора сначала очистить ref в БД.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_fn_protect_kb_attachments_from_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  _ref_storage TEXT;
  _used_by_id UUID;
BEGIN
  -- Fast path: protect only kb-attachments bucket.
  -- Other buckets (avatars, mock-exam-*, homework-*) have their own ownership
  -- patterns and не требуют такой защиты в этой миграции.
  IF OLD.bucket_id <> 'kb-attachments' THEN
    RETURN OLD;
  END IF;

  _ref_storage := 'storage://kb-attachments/' || OLD.name;

  -- Check if any kb_tasks row references this storage object.
  -- Covers both single-ref format ('storage://...') and JSON-array format
  -- (`["storage://...", "storage://..."]`) — dual-format invariant per
  -- src/lib/attachmentRefs.ts.
  SELECT id INTO _used_by_id
  FROM kb_tasks
  WHERE attachment_url = _ref_storage
     OR solution_attachment_url = _ref_storage
     OR (attachment_url LIKE '[%' AND attachment_url::jsonb @> to_jsonb(_ref_storage))
     OR (solution_attachment_url LIKE '[%' AND solution_attachment_url::jsonb @> to_jsonb(_ref_storage))
  LIMIT 1;

  IF _used_by_id IS NOT NULL THEN
    RAISE EXCEPTION
      'KB_STORAGE_PROTECTED: file % is still referenced by kb_tasks.id=%. Clear or update the kb_tasks row before deleting the storage object.',
      OLD.name, _used_by_id
      USING
        HINT = 'Run: UPDATE kb_tasks SET attachment_url=NULL WHERE id=''<id>''; before deleting storage object. Or use the app UI which handles cleanup correctly.',
        ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.trg_fn_protect_kb_attachments_from_delete IS
  'BEFORE DELETE guard on storage.objects: blocks deletes from kb-attachments bucket when a kb_tasks row still references the object. App-level flows already clear refs first, so this only fires on manual Storage UI deletes — preventing orphan attachment_url values (regression: 2026-05-20 Egor incident).';

DROP TRIGGER IF EXISTS trg_protect_kb_attachments_from_delete ON storage.objects;
CREATE TRIGGER trg_protect_kb_attachments_from_delete
  BEFORE DELETE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_protect_kb_attachments_from_delete();
