## Что сломано

Во вкладках **CRM** и **ДЗ** в `/admin` пусто, в консоли сыпется `TypeError: Failed to fetch` от запросов через `api.sokratai.ru`.

Причина одна и та же:

- `src/components/admin/AdminCRM.tsx` — напрямую делает `supabase.from('chats').select(...)`, потом `chat_messages`, потом `profiles` из браузера.
- `src/lib/adminHomeworkApi.ts` (используется `AdminHomeworkChats` → `AdminTutorList` / `AdminTutorAssignmentList` / …) — то же самое: 5–7 последовательных SELECT-ов из `homework_tutor_assignments`, `homework_tutor_student_assignments`, `homework_tutor_thread_messages`, `tutors`, `profiles` из браузера.

Два независимых эффекта от этого:

1. **RLS режет данные.** Эти таблицы защищены RLS на уровне «свои данные» (студент видит свои чаты, репетитор — своих учеников). У админа нет policy «вижу всё», поэтому ответы возвращаются пустыми или частичными → «Чаты не найдены», «Нет активности».
2. **`Failed to fetch` через прокси.** Запрос вида `chat_messages?chat_id=in.(...очень длинный список UUID)` улетает в URL, проходит через Cloudflare/Selectel прокси, и на больших объёмах роняется (длина URL, таймаут, лимит 1000 строк PostgREST). Отсюда красные ошибки в консоли.

При этом вкладка **Аналитика** работает — потому что она уже ходит через edge function `admin-analytics` с `service_role` (см. паттерн в `supabase/functions/admin-analytics/index.ts`: проверка `is_admin` RPC + второй клиент на service key).

## Решение

Полностью повторить паттерн `admin-analytics` для CRM и ДЗ. Никаких костылей с RLS-policy «admin sees all» — это менее безопасно и труднее аудитить. Edge function проверяет admin-роль один раз и затем читает что нужно service-role клиентом.

### 1. Новая edge function `admin-crm`

`supabase/functions/admin-crm/index.ts`. Один POST-эндпоинт, тело: `{ search?: string, limit?: number, offset?: number }`.

Делает на сервере (service-role, bypass RLS):

- Берёт все `chats` за разумное окно (по умолчанию последние 90 дней по `updated_at`, `limit` 500 — хватит для UI).
- Одним запросом читает агрегаты по `chat_messages`: `count(*) filter (role='user')`, `max(created_at)` через RPC или `select chat_id, role, created_at` с серверной агрегацией.
- Подтягивает `profiles` (`username`, `telegram_username`, `grade`) одним IN-запросом.
- Возвращает уже готовый JSON в формате `ChatWithUser[]`, который сейчас ожидает `AdminCRM`.

Также добавить `GET /messages?chatId=...` (или второй action в том же body) — для `AdminChatView`, чтобы и просмотр конкретной переписки шёл через service-role и не упирался в RLS.

### 2. Новая edge function `admin-homework`

`supabase/functions/admin-homework/index.ts`. Один эндпоинт с router-полем `action` в body, чтобы не плодить функции:

- `action: "tutors"` → возвращает `TutorOverview[]` (то, что сейчас собирает `fetchTutorsOverview` — но за один проход, на сервере, без N+1 round-trip через прокси).
- `action: "assignments", tutorId` → `AssignmentOverview[]`.
- `action: "students", assignmentId` → `AssignmentStudentRow[]`.
- `action: "thread", threadId` → сообщения треда + хедер (для `AdminHWThreadView`).

Каждый action: проверка `is_admin` (общий хелпер в начале файла), затем чтение через service-role клиент.

### 3. Переписать клиент

- `src/components/admin/AdminCRM.tsx`: убрать прямые `supabase.from(...)` запросы, заменить на `supabase.functions.invoke('admin-crm', { body: { search } })`. Типы `ChatWithUser` оставить, ответ функции уже в этом формате.
- `src/lib/adminHomeworkApi.ts`: четыре функции (`fetchTutorsOverview`, `fetchAssignmentsForTutor`, `fetchStudentsForAssignment`, `fetchThreadMessages`) превратить в тонкие обёртки вокруг `supabase.functions.invoke('admin-homework', { body: { action, ... } })`. Возвращаемые типы не меняются — компоненты `AdminTutorList`/`AdminTutorAssignmentList`/`AdminAssignmentStudentList`/`AdminHWThreadView` править не нужно.
- `AdminChatView` (просмотр конкретного чата) — тоже перевести на `admin-crm` action `messages`.

### 4. Безопасность

- Обе функции **обязательно** проверяют `is_admin(auth.uid())` через service-role клиент **до** любых чтений. Без этого получится, что любой залогиненный пользователь сможет читать чужие чаты.
- Никаких изменений в RLS-policy таблиц `chats`, `chat_messages`, `homework_tutor_*` — текущие ограничения для обычных пользователей остаются как есть.
- Функции деплоятся с `verify_jwt = true` (default).

### 5. Никаких изменений инфры

Frontend bundle меняется → потребуется `deploy-sokratai` на VPS после мержа (правило `.claude/rules/95-production-deploy.md`). Edge functions деплоятся автоматически Lovable Cloud при push.

## Что НЕ трогаем

- `supabase/functions/admin-analytics/index.ts`, `admin-business-dashboard`, `admin-product-discovery` — они работают.
- `AdminPayments` — отдельная вкладка, не упоминалась как сломанная (если там тоже direct-SELECT, можно отдельной итерацией).
- RLS-policy на таблицах чатов и ДЗ — оставляем «вижу свои».
- `src/lib/supabaseClient.ts`, прокси-конфигурация, `_shared/proxy-url.ts` — не относятся к проблеме.

## Технические детали для реализации

```text
supabase/functions/
  admin-crm/
    index.ts          ← list chats + get messages (service-role, is_admin gate)
  admin-homework/
    index.ts          ← router: tutors | assignments | students | thread

src/components/admin/AdminCRM.tsx           ← invoke('admin-crm')
src/components/admin/AdminChatView.tsx      ← invoke('admin-crm', {action:'messages'})
src/lib/adminHomeworkApi.ts                 ← invoke('admin-homework', {action})
```

Шаблон auth-блока берём 1-в-1 из `supabase/functions/admin-analytics/index.ts` (lines 1–55): bearer → `getUser` → `rpc('is_admin')` → 403 либо service-role чтения.

После мержа: `deploy-sokratai` на VPS (frontend изменился).
