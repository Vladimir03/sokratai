# KB broken image refs — incident runbook

## Симптом

- Tutor открывает страницу каталога (`/tutor/knowledge/topic/:topicId`) и видит одну/несколько задач с **пустым местом** между шапкой и кнопками «К себе» / «В ДЗ»; либо amber-плашку «Фото недоступно — файл удалён из хранилища» (после frontend deploy 2026-05-20).
- DevTools → Console: `[kb-image] signed URL failed — storage object likely missing` с конкретными `bucket` и `objectPath`.
- DevTools → Network: статус **400** на запросах вида `/storage/v1/object/sign/kb-attachments/...`.

## Root cause

Физический файл удалён из bucket `kb-attachments`, но `kb_tasks.attachment_url` (или `solution_attachment_url`) всё ещё ссылается на него. `createSignedUrl` возвращает 400 «Object not found».

После миграции `20260520120000_protect_kb_attachments_from_orphan_delete.sql` триггер `trg_protect_kb_attachments_from_delete` блокирует удаление storage object, пока есть ссылка из `kb_tasks` → новый incident такого типа возможен только если:

1. Кто-то намеренно обходит триггер (`REVOKE`, `SET session_replication_role = replica`, `DROP TRIGGER`)
2. Pre-trigger orphans (файлы, удалённые ДО 2026-05-20) ещё остались в БД
3. Path-traversal или typo в `attachment_url` — ref никогда не указывал на реальный файл

## Diagnosis

### Шаг 1 — найти ВСЕ broken refs одним запросом

```sql
-- Возвращает все kb_tasks, чьи attachment_url / solution_attachment_url
-- указывают на отсутствующий объект в bucket kb-attachments.
-- Покрывает только single-ref формат (доминирующий в kb_tasks).
SELECT
  t.id            AS task_id,
  t.owner_id,
  t.kim_number,
  topics.name     AS topic_name,
  CASE
    WHEN t.attachment_url LIKE 'storage://kb-attachments/%'
         AND att_ok IS NULL                              THEN 'condition'
    WHEN t.solution_attachment_url LIKE 'storage://kb-attachments/%'
         AND sol_ok IS NULL                              THEN 'solution'
  END             AS kind,
  COALESCE(
    CASE WHEN att_ok IS NULL THEN t.attachment_url END,
    CASE WHEN sol_ok IS NULL THEN t.solution_attachment_url END
  )               AS broken_ref
FROM kb_tasks t
LEFT JOIN kb_topics topics ON topics.id = t.topic_id
LEFT JOIN LATERAL (
  SELECT 1 FROM storage.objects o
  WHERE o.bucket_id = 'kb-attachments'
    AND ('storage://kb-attachments/' || o.name) = t.attachment_url
) att_ok ON TRUE
LEFT JOIN LATERAL (
  SELECT 1 FROM storage.objects o
  WHERE o.bucket_id = 'kb-attachments'
    AND ('storage://kb-attachments/' || o.name) = t.solution_attachment_url
) sol_ok ON TRUE
WHERE
  (t.attachment_url LIKE 'storage://kb-attachments/%' AND att_ok IS NULL)
  OR (t.solution_attachment_url LIKE 'storage://kb-attachments/%' AND sol_ok IS NULL)
ORDER BY topics.name NULLS LAST, t.kim_number, t.id;
```

Если result пуст → каталог чистый, broken refs нет.

> ⚠️ **Dual-format note:** `kb_tasks.attachment_url` поддерживает (через `parseAttachmentUrls`) и single-ref `storage://...`, и JSON-array `["storage://...","storage://..."]`. Запрос выше покрывает только single-ref (доминирующий в seeds + UI-uploads). Для JSON-array нужно расширить через `jsonb_array_elements_text` — см. `src/lib/attachmentRefs.ts` за каноничный формат.

### Шаг 2 — посмотреть paired source + canonical

Каждый canonical (`owner_id IS NULL`) обычно имеет linked source через `source_task_id`. Получить пары:

```sql
SELECT
  c.id            AS canonical_id,
  c.source_task_id,
  s.owner_id      AS source_owner,
  s.folder_id     AS source_folder
FROM kb_tasks c
LEFT JOIN kb_tasks s ON s.id = c.source_task_id
WHERE c.id IN (
  '<canonical_id_1>'::uuid,
  '<canonical_id_2>'::uuid
);
```

Это нужно перед Путём B (hard delete), чтобы удалить и source-копии тоже.

## Recovery — 2 пути

### Путь A — re-upload (если оригиналы у автора)

**Когда:** автор задач (например, репетитор-модератор) находит у себя оригинальные файлы (Telegram-чат, локальный архив, скан из источника).

**Шаги:**
1. Lovable Cloud → **Storage** → bucket `kb-attachments` → папка `<owner_uuid>/`.
2. Залить файлы с **точно теми же именами**, что в broken `attachment_url` (UUID из конца пути).
3. Hard refresh страницы каталога → картинки появятся. БД править не надо — существующие `attachment_url` сразу заработают.

### Путь B — hard delete (если оригиналы потеряны)

**Когда:** оригиналов нет и не будет в обозримой перспективе. Задачи скрываются И из публичного каталога, И из папки автора.

**Что произойдёт:**
- Public каталог: задачи исчезают.
- Папка автора: source-копии удаляются.
- `homework_kb_tasks.task_id` → SET NULL (FK с ON DELETE SET NULL). Snapshot текста (`task_text_snapshot`) сохраняется → уже-выданные ДЗ ученикам продолжают работать без перебоев.
- `kb_moderation_log` — история публикаций сохраняется (log table, не FK на kb_tasks).
- Storage objects — уже не существуют (это был root cause). Триггер не сработает.

**SQL шаблон (в одной транзакции, с DRY-RUN и verify):**

```sql
BEGIN;

-- 1) DRY-RUN — подтверди что ожидаешь увидеть
SELECT
  c.id            AS canonical_id,
  c.owner_id      AS canonical_owner,   -- ожидаем NULL у всех
  c.kim_number,
  c.attachment_url,
  c.source_task_id,
  s.owner_id      AS source_owner       -- ожидаем UUID автора
FROM kb_tasks c
LEFT JOIN kb_tasks s ON s.id = c.source_task_id
WHERE c.id IN (
  '<canonical_id_1>'::uuid,
  '<canonical_id_2>'::uuid
  -- ... etc
);

-- 2) Удалить source-копии (если ещё linked через source_task_id)
DELETE FROM kb_tasks
WHERE id IN (
  SELECT source_task_id FROM kb_tasks
  WHERE id IN (
    '<canonical_id_1>'::uuid,
    '<canonical_id_2>'::uuid
  )
    AND source_task_id IS NOT NULL
);

-- 3) Удалить canonical-копии
DELETE FROM kb_tasks WHERE id IN (
  '<canonical_id_1>'::uuid,
  '<canonical_id_2>'::uuid
);

-- 4) Verify clean state — должно вернуть 0
SELECT COUNT(*) AS remaining FROM kb_tasks WHERE id IN (
  '<canonical_id_1>'::uuid,
  '<canonical_id_2>'::uuid
);

COMMIT;
-- Если DRY-RUN показал не то что ожидалось, или verify != 0 → ROLLBACK; вместо COMMIT.
```

**Order-of-operations note:** FK constraints `published_task_id` / `source_task_id` имеют `ON DELETE SET NULL` (self-referential). Порядок DELETE source vs canonical **не имеет значения** — обе SET NULL'ятся независимо. Делаем source первым только для читаемости.

## История инцидентов

| Дата | Раздел(ы) | Удалено | Причина | Путь | Источник |
|---|---|---|---|---|---|
| 2026-05-20 | Магнетизм, Динамика | 9 canonical + 9 source | Егор вручную удалил 9 файлов из `kb-attachments/a7212758-…d74c/` через Lovable Cloud Storage UI. Оригиналов не нашёл. | B | commit `f421406` |

## Prevention summary

После 2026-05-20 incident в репо лежат следующие защиты:

| Слой | Файл / артефакт | Что делает |
|---|---|---|
| DB | `supabase/migrations/20260520120000_protect_kb_attachments_from_orphan_delete.sql` | BEFORE DELETE trigger на `storage.objects` блокирует удаление, если `kb_tasks.attachment_url` или `solution_attachment_url` ссылается на объект. App-level flows (`useKnowledgeBase.removeTask`, `EditTaskModal`, `CreateTaskModal`) уже безопасны. |
| Frontend UX | `src/components/kb/TaskCard.tsx` | Amber-плашка «Фото недоступно — файл удалён из хранилища» вместо пустой карточки при `null` signed URL. |
| Diagnostics | `src/lib/kbApi.ts::getKBImageSignedUrl` | `console.warn` с bucket + path + error при любом failure. Видно в DevTools Console. |
| Документация | `.claude/rules/50-kb-module.md` секция «Storage protection» | Инвариант для будущих callsite'ов на `deleteKBTaskImage`. |
| Runbook | `docs/delivery/engineering/runbooks/kb-broken-storage-refs.md` | Этот файл. |

**Hard rule для нового кода:** любой callsite, удаляющий объект из bucket `kb-attachments`, **ОБЯЗАН** сначала очистить `kb_tasks.attachment_url` / `solution_attachment_url` (UPDATE SET NULL или DELETE FROM kb_tasks), и только потом вызывать `deleteKBTaskImage` / `supabase.storage.from('kb-attachments').remove(...)`. Иначе триггер выбросит `KB_STORAGE_PROTECTED` ошибку.
