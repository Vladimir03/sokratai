# Чат репетитор ↔ ученик («Чаты») + @СократAI + PWA-наджи

Telegram-подобный realtime-чат 1:1 репетитор↔ученик с вызовом AI (@СократAI) в общей переписке + умные наджи установки PWA/уведомлений. Реализовано 2026-07-12. История: `~/.claude/plans/functional-frolicking-flute.md` + memory `project_tutor_student_chat_2026_07_12.md`. **НЕ путать** с AI-чатом ученика (`chats`/`chat_messages`) — отдельная система.

## Модель данных (миграции `20260712150000…150300`)

- **`tutor_student_conversations`** — 1:1 с `tutor_students` (UNIQUE `tutor_student_id`, lazy-create). Денорм для списка: `last_message_at/preview/sender`; галочки-watermark: `tutor_last_read_at`/`student_last_read_at` («прочитано» ⇔ `msg.created_at <= peer_last_read_at`, БЕЗ per-message флагов); бейджи `tutor_unread_count`/`student_unread_count`; троттлинг `*_last_notified_at`.
- **`tutor_student_chat_messages`** — `sender_role ('tutor'|'student'|'assistant')`, `author_user_id → auth.users SET NULL`, `content ≤4000`, `attachment_url` (dual-format через `parseAttachmentUrls`), `client_msg_id` (идемпотентность), `created_at`. Индексы `(conversation_id, created_at DESC, id DESC)` + partial-unique `(conversation_id, client_msg_id)`.
- **RLS SELECT-only** через SECURITY DEFINER `is_chat_conversation_member(_conversation_id)` (JOIN `tutor_students`+`tutors`: `ts.student_id = auth.uid() OR t.user_id = auth.uid()` — **FK-дрейф: `tutor_students.tutor_id → tutors.id`, raw JOIN в USING() запрещён**). **Никаких INSERT/UPDATE/DELETE политик — ВСЕ записи через edge (service_role)**; денорм-счётчики нельзя доверять клиенту.

## Единственный write-path сообщений — RPC `tsc_post_message` (КРИТИЧНО)

Атомарно ОДНОЙ транзакцией: insert + идемпотентный дедуп по `client_msg_id` (ON CONFLICT → возврат существующей строки, денорм НЕ повторяется) + денорм. **preview монотонен** (обновляется только если `created_at >= last_message_at` — иначе поздний RPC откатывал список назад); unread инкрементится SQL-выражением (без read-modify-write гонки); assistant инкрементит ОБОИХ. **НЕ дробить на insert+денорм двумя запросами** (был баг: markRead между ними давал ложный unread; сбой денорма терял обновление списка). Новое поле сообщения → в `tsc_post_message` + `MESSAGE_SELECT` + тип `TutorStudentChatMessage`.

## Edge `tutor-student-chat-api` (`verify_jwt=true`, service_role внутри)

Роуты: `GET/POST /conversations`, `GET/POST /conversations/:id/messages`, `POST /conversations/:id/read`, `POST /internal/{notify,ai-reply}` (service-role bearer exact-match). Скаффолд — зеркало `tutor-progress-api`; `resolveTutorPkId` перед любым скоупом `tutor_students`; rule-97 flat-ошибки; **текст необработанного исключения — только в лог, клиенту generic** (утечка схемы).
- **Пагинация — составной keyset `before` + `before_id`**: курсор ОБЯЗАН нести `id` (сортировка `(created_at,id)` desc; иначе теряются сообщения с равным timestamp на границе страницы). PostgREST: `.or(\`created_at.lt."X",and(created_at.eq."X",id.lt."Y")\`)`.
- **Батч-списки — проверять `.error` каждого запроса**, не отдавать 200 с «пустыми» диалогами (клиентский кэш затрётся деградацией).
- Валидация `attachment_refs` — namespace `storage://tutor-chat-uploads/{convId}/{uid}/` + кап 5. Rate-limit 20 msg/60с.

## Realtime

- Публикация: обе таблицы. Messages → INSERT (открытая беседа), conversations → UPDATE (живые ✓✓/бейджи/пересортировка).
- **Merge ТОЛЬКО через `mergeChatMessage`** (дедуп по `id` И `client_msg_id` — realtime INSERT может обогнать POST-ответ) в `setQueryData`; **НИКОГДА `invalidateQueries` из realtime** (rule 40, фликер).
- **Каналы postgres_changes — уникальный суффикс топика на создание** (гонка unsubscribe/subscribe). **List-канал — ОДИН на роль с refcount** (`sharedListChannels` в `useChatConversations`): Navigation + ChatSidebar + SideNav монтируют хук одновременно → без refcount 3 подписки × тройная обработка каждого UPDATE. Typing-канал НАМЕРЕННО делит topic `tsc-typing-<id>` (broadcast-маршрутизация).
- **Reconnect gap-fill** (RU DPI рвёт WS): на `SUBSCRIBED` после обрыва — точечный fetch последней страницы + merge, не invalidate.

## Уведомления (`/internal/notify`)

Un-awaited self-fetch (паттерн `enqueueReferenceGeneration`; `EdgeRuntime.waitUntil` в репо не используется, rule 95). `sleep 15с` в отдельном isolate → re-check `recipient_last_read_at` (прочитал вживую → выходим молча) → троттлинг 5 мин. Каскад **push → telegram, БЕЗ email**. Ученик: `push_subscriptions` → `profiles.telegram_user_id` → `telegram_sessions`. Репетитор: `push_subscriptions` → `tutors.telegram_id` (**TEXT!** `Number()` + skip на NaN). Deep-link: ученик `/chat?id=tutor:<id>`, репетитор `/tutor/chat/<id>`. Assistant-ответы уведомлений НЕ шлют.

## @СократAI

- Mention-детект `/@\s?(сократ\s?ai|sokrat\s?ai)/iu` — зеркало фронт (`AI_MENTION_RE`)/edge, без lookbehind (rule 80).
- **Квота ДО gateway** (rule 99): ученик → `checkAiQuota(context:'chat')`; репетитор → cap **30/день**, **RESERVATION** (`logAnalyticsEvent('tutor_chat_ai_ran')` ПЕРЕД вызовом, НЕ post-hoc fire-and-forget — параллельные упоминания обходили cap). Неудачный вызов расходует слот (анти-retry-спам).
- Контекст: 15 сообщений ASC с префиксом «Репетитор {имя}:»/«Ученик {имя}:»; фото триггерного (≤2) inline. `callLovableJson` (буфер, не стрим — realtime доставит обоим), source `tutor_student_chat`. Промпт — **прямой помощник, не сократический** (репетитор присутствует). Сбой → assistant-строка с фразой ошибки.

## Bucket `tutor-chat-uploads` (приватный)

Путь `{conversationId}/{uploaderUid}/{fileId}.ext`. INSERT-политика: свой namespace + member + **кап 300 объектов/беседу через SECURITY DEFINER `tsc_chat_upload_count`** (анти-abuse: message-rate-limit срабатывает после upload). **ГОТЧА (баг превью 2026-07-13): подзапрос к `storage.objects` ВНУТРИ политики на `storage.objects` = Postgres 42P17 infinite recursion → storage-api 400 `DatabaseInvalidObjectDefinition` на КАЖДЫЙ upload.** Любой самоссылающийся счётчик в storage-политике — только через SECURITY DEFINER-хелпер (фикс-миграция `20260713090000`). Чтение: любой member (`createSignedUrl` клиентом — RU-safe `api.sokratai.ru`). `chat-images` НЕ подходит (owner-folder-only SELECT). Клиент `uploadChatImage` (`compressForUpload`); частичный сбой загрузки → `deleteChatUploads` сирот + черновик сохраняется (`allSettled`, не `Promise.all`).
- **Lovable-quirk (2026-07-12):** `INSERT INTO storage.buckets(...file_size_limit, allowed_mime_types)` в миграции **не применяется на Lovable** — платформа блокирует любой DML по `storage.buckets` (создаёт бакет своим API, но лимиты/mime не выставляет). Миграция корректна для стандартного Supabase; на Lovable **бакет-лимиты выставляются ВРУЧНУЮ** (Backend → Storage → bucket → Settings: 10485760 байт + image/*). Защита остаётся: RLS INSERT (own-folder + member + кап 300) + клиентский `MAX_CHAT_IMAGE_BYTES`/`compressForUpload`. Любой новый бакет через миграцию на этом проекте → тот же ручной шаг.

## Frontend

- **Shared** (`src/components/chat/*`, `src/hooks/chat/*`, `src/lib/tutorStudentChatApi.ts`, `src/types/tutorStudentChat.ts`) — нейтральная зона, НЕ импортит tutor/student модули. `ConversationView` (prop `perspective`), `ChatBubble` (KaTeX **только** для assistant), `ChatComposer` (свой, НЕ реюз `ChatInput` — тот однофайловый + voice-флоу), `ConversationRow`, `ReadTicks`.
- **Ученик**: закреп-диалоги в `ChatSidebar` + встройка в `Chat.tsx` **абсолютным оверлеем z-30** (`?id=tutor:<id>` → `currentChatId=undefined` отключает AI-запросы; **skeleton-гейт `!currentChatId && !tutorConversationId`** — иначе ветка репетитора недостижима; `preloadPyodide` гейтится). Бейдж на вкладке «Чат» в `Navigation`.
- **Репетитор**: `/tutor/chat(/:conversationId)` master/detail (detail в URL — push-deep-links бесплатно); `SideNav` «Чаты» + counter `unreadChats`; **empty-state гейтить `items !== undefined`** (не `error` — RQ v5 при сетевом сбое имеет окно `error=null, data=undefined` → ложное «Пока нет учеников»).
- `markRead` — только когда пользователь **реально у низа** ленты (синхронный DOM-замер, не state) + обработчик `visibilitychange`. FAB-счётчик считает по `id` хвоста (prepend старой страницы ≠ новые). Touch-targets ≥44px (rule 90).

## PWA-наджи установки + уведомлений

`NotificationsNudge` (**заменил `PushOptInBanner` — УДАЛЁН**) — умная кнопка value-first: push-permission → нативный install (Android `beforeinstallprompt`) → iOS-sheet (**Apple не даёт один клик; web push на iOS работает ТОЛЬКО из установленной PWA, 16.4+**).
- **VAPID public key ЗАХАРДКОЖЕН в `pushApi.ts`** (баг превью 2026-07-13: `VITE_VAPID_PUBLIC_KEY` не был задан НИГДЕ — ни в Lovable-env, ни на VPS, в бандле компилился в `undefined` → «мёртвая кнопка»; public key не секрет, mirror anon-ключа). **ОБЯЗАН совпадать с edge-секретами `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`** (пара сгенерирована `npx web-push generate-vapid-keys` 2026-07-13; ротация была безопасна — подписок в `push_subscriptions` не существовало, подписаться было нечем). Смена ключа → синхронно фронт-хардкод + оба edge-секрета. Любой сбой `runPush` → toast, НИКОГДА молча (`hasVapidKey()`-гейт прячет CTA без ключа).
- `src/lib/pwaInstall.ts`: `initPwaInstallCapture()` в `main.tsx` **ДО рендера** (событие фаерится рано). **`isPushSupported` — на общем `PROD_HOSTS`** (был захардкожен `lovable.app` → push мёртв на `sokratai.ru`). `granted`-без-`PushSubscription` = actionable «Требуется повторное включение» (`useNotificationsSetup.subscriptionMissing`).
- Точки монтажа: чат (обе роли), список ДЗ, `PostSubmissionNudge` (одноразовый sheet после первой сдачи — флаг жжётся **в момент показа**, не до), Главная репетитора (mobile-only), чеклист онбординга (шаг), `AppNotificationsCard` в профилях (постоянный вход). **Dismiss 14 дней** (общий ключ `sokrat-pwa-nudge-dismissed`; sheet-close тоже персистит). Иконки `public/icons/` (192/512/apple-touch-180); manifest подключён в `index.html` + apple-touch + iOS meta.

## Deploy (порядок обязателен)

Миграции → edge (Lovable на push в main) → фронт (`deploy-sokratai`, rule 95). **Фронт раньше edge = глобальные запросы в отсутствующую функцию из Navigation/SideNav.** Edge деплоит Lovable (CI сломан, rule 95). `config.toml` + deploy-workflow зарегистрированы. Новых секретов нет.

## При расширении

Новое поле сообщения → `tsc_post_message` + `MESSAGE_SELECT` + тип. Новый write — только через edge (RLS SELECT-only). Realtime — merge-helper, не invalidate; list-канал — refcount. Новый AI-путь в чате — квота-**reservation ДО** вызова. Новая точка наджа — через `NotificationsNudge`/`useNotificationsSetup`, не свой баннер. **Проверка edge перед коммитом: `npx esbuild supabase/functions/tutor-student-chat-api/index.ts --outfile=NUL`** (tsc Deno-код не ловит — `*/` в комментарии обрушил сборку в ревью).
