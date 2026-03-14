

## Проблема

Ответ Storage API: `{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}`.

Миграция `20260313120000_kb_attachments_bucket.sql` существует в файлах, но бакет `kb-attachments` не создан в базе. Нужно выполнить создание бакета и RLS-политик через новую миграцию.

## План

### 1. Создать бакет `kb-attachments` через миграцию

SQL-миграция:
- `INSERT INTO storage.buckets (id, name, public) VALUES ('kb-attachments', 'kb-attachments', false) ON CONFLICT DO NOTHING`
- RLS-политики на `storage.objects`:
  - **INSERT**: authenticated, `bucket_id = 'kb-attachments'` AND первая папка = `auth.uid()`
  - **SELECT**: authenticated, `bucket_id = 'kb-attachments'`
  - **UPDATE**: authenticated, `bucket_id = 'kb-attachments'` AND первая папка = `auth.uid()`
  - **DELETE**: authenticated, `bucket_id = 'kb-attachments'` AND первая папка = `auth.uid()`

Это повторяет содержимое существующей миграции, но с `IF NOT EXISTS` / `ON CONFLICT` для идемпотентности.

### 2. Никаких изменений в коде

Код в `kbApi.ts` и `CreateTaskModal.tsx` корректен — проблема только в отсутствующем бакете.

