# Чат репетитор ↔ ученик («Чаты») + группы + @СократAI + PWA-наджи

Telegram-подобный realtime-чат 1:1 репетитор↔ученик + **групповые чаты учебных групп** (2026-07-13, секция ниже) с вызовом AI (@СократAI) в общей переписке + умные наджи установки PWA/уведомлений. Реализовано 2026-07-12. История: `~/.claude/plans/functional-frolicking-flute.md` (1:1) + `~/.claude/plans/virtual-giggling-duckling.md` (группы) + memory `project_tutor_student_chat_2026_07_12.md`. **НЕ путать** с AI-чатом ученика (`chats`/`chat_messages`) — отдельная система.

## Модель данных (миграции `20260712150000…150300`)

- **`tutor_student_conversations`** — 1:1 с `tutor_students` (UNIQUE `tutor_student_id`, lazy-create). Денорм для списка: `last_message_at/preview/sender`; галочки-watermark: `tutor_last_read_at`/`student_last_read_at` («прочитано» ⇔ `msg.created_at <= peer_last_read_at`, БЕЗ per-message флагов); бейджи `tutor_unread_count`/`student_unread_count`; троттлинг `*_last_notified_at`.
- **`tutor_student_chat_messages`** — `sender_role ('tutor'|'student'|'assistant')`, `author_user_id → auth.users SET NULL`, `content ≤4000`, `attachment_url` (dual-format через `parseAttachmentUrls`), `client_msg_id` (идемпотентность), `created_at`. Индексы `(conversation_id, created_at DESC, id DESC)` + partial-unique `(conversation_id, client_msg_id)`.
- **RLS SELECT-only** через SECURITY DEFINER `is_chat_conversation_member(_conversation_id)` (JOIN `tutor_students`+`tutors`: `ts.student_id = auth.uid() OR t.user_id = auth.uid()` — **FK-дрейф: `tutor_students.tutor_id → tutors.id`, raw JOIN в USING() запрещён**). **Никаких INSERT/UPDATE/DELETE политик — ВСЕ записи через edge (service_role)**; денорм-счётчики нельзя доверять клиенту.

## Групповые чаты (миграция `20260713120000`, решения владельца 2026-07-13)

Группа = **учебная** `tutor_groups` (`is_primary=true AND is_active=true`); метки чат НЕ получают. Не вторая система — обобщение той же: `tutor_student_conversations.kind ('direct'|'group')` + `tutor_group_id UNIQUE FK CASCADE` (+ `tutor_student_id` стал NULLable, CHECK «ровно один из двух»; `last_message_author_user_id` — автор последнего сообщения). **Индекс `uq_tsc_group` НЕ partial** — PostgREST `upsert(onConflict)` не инферит partial-индексы; NULL'ы direct-бесед в UNIQUE не конфликтуют.

- **Членство НЕ копируется — живьём** из `tutor_group_memberships(is_active)` JOIN `tutor_students(archived_at IS NULL)` внутри `is_chat_conversation_member` (group-ветка: владелец через `tutor_groups.tutor_id → tutors.user_id` ИЛИ активный член). Убрали из группы → мгновенно теряет ВСЮ историю (RLS); добавили → видит всю. Ноль синхронизации.
- **`tutor_chat_members` — per-member СОСТОЯНИЕ, НЕ членство**: `(conversation_id, user_id) PK`, `last_read_at`/`unread_count`/`last_notified_at`. SELECT-RLS через `is_chat_conversation_member` (члены видят read-state друг друга — нужно для ✓✓); write — только service_role. В realtime publication. Direct-чаты ОСТАЛИСЬ на двухпартийных колонках (гибрид намеренный — прод не мигрируем).
- **`tsc_post_message` ветвится по `c.kind`**: direct-путь прежний; group — тот же атомарный insert+денорм БЕЗ двухпартийных счётчиков + **fan-out unread** UPSERT'ом всем текущим получателям кроме автора (assistant → всем) + watermark автора (написал = прочитал). Мини-группы ≤ ~15 — fan-out тривиален.
- **Own-детект — ТОЛЬКО по `author_user_id`, НЕ по `sender_role`** (у двух учеников группы одинаковый `sender_role='student'`): `ConversationView.isOwnMessage` = `_localStatus ? true : kind==='group' ? author_user_id===myUserId : sender_role===perspective`. Регресс = чужие сообщения справа как «свои».
- **✓✓ в группе = «прочитал хотя бы один»** (решение владельца): `peer_last_read_at = MAX(last_read_at)` остальных членов; live — binding `tutor_chat_members` (open-беседа: filter conversation_id; список: unfiltered + клиентский фильтр `user_id===myUid` для своего бейджа). Group-строки в conversations-UPDATE хендлере НЕ читают `tutor_*/student_unread_count` (не про меня).
- **Превью списка**: имя автора **печётся сервером** (`previewPrefix` в `postMessageAtomic`, первое слово имени) — клиент добавляет только «СократAI:»; «Вы:» только в direct. Свой бейдж unread приходит событием member-строки, не conversations-UPDATE.
- **Lazy-создание**: список СИНТЕЗИРУЕТ строку для каждой учебной группы (`buildGroupListItems`) — чат виден сразу после создания группы; физическая беседа = `POST /conversations {tutor_group_id}` при первом открытии. Удаление группы → CASCADE беседы+сообщений (UI удаления групп пока нет).
- **Notify group**: `/internal/notify` БЕЗ `recipient` → после 15с резолвит АКТУАЛЬНЫХ членов, per-member re-check (`member.last_read_at`) + троттлинг 5 мин (`member.last_notified_at`), каскад push→telegram по роли. Title «{автор} · {группа}». Deep-link ученика `?id=group:<convId>` (Chat.tsx парсит оба префикса `tutor:`/`group:` в один overlay), репетитора — `/tutor/chat/<convId>`.
- **@СократAI в группе**: звать могут все; квота АВТОРА (student → `checkAiQuota`, tutor → cap 30/день по `group.tutor_id`); контекст с картой имён по `author_user_id`; group-промпт «обращайся по имени». Ответ assistant инкрементит unread всем через ту же RPC.
- **Typing payload** += `{user_id, display_name}` — self-фильтр по uid (роль не различает учеников), «Вася печатает…»; legacy payload без uid фильтруется по роли (1:1).
- **Markdown-фикс (2026-07-13)**: AI-промпт запрещает markdown + `MathText` opt-in `markdownLite` (`**`→`<strong>`, `` ` ``→`<code>`, только chat-assistant; KB не затронут). Плавающая дата-пилюля в `ConversationView` (data-chat-iso + бинарный поиск верхнего видимого, rAF).
- **UI группы**: `ConversationRow`/header — Users-иконка на `bg-socrat-folder-bg`; header-тап → Dialog со списком участников (`meta.members`; скролл даёт сам примитив `DialogContent` — `max-h-[85vh] overflow-y-auto`); цветные имена авторов над чужими пузырями (`authorColorClass(uid)`, палитра `*-700` — 12px на белом обязан давать AA ≥4.5:1).
- **Deploy-порядок**: миграция → edge (Lovable) → фронт (`deploy-sokratai`). Известный minor: в превью группы своё сообщение показывается своим именем, не «Вы:» (имя запечено сервером).

### Ревью р.2 ChatGPT-5.6 (2026-07-13) — фиксы, НЕ откатывать

- **`?groups=1` capability-флаг на GET /conversations**: edge отдаёт групповые строки ТОЛЬКО клиенту с флагом (deploy-skew: старый бандл/stale PWA ронял React-ключи на `tutor_student_id=null` и звал direct-create без ученика). Временный — убрать синхронно (edge+клиент) после стабилизации PWA-кэшей.
- **Снапшот первого непрочитанного — В РЕНДЕР-ФАЗЕ (write-once ref), НЕ в effect**: divider обязан попасть в тот же коммит, что и сообщения, иначе initial-scroll не находит его в DOM → лента уходит вниз → mark-read гасит всю пачку. Initial-scroll гейтится «снапшот взят» (+ группа ждёт `myUserId`).
- **Member-события realtime до резолва uid — СКИП** (`useChatRealtime`): своя строка ушла бы в peer-ветку и монотонный MAX завысил `peer_last_read_at` навсегда → ложные ✓✓.
- **Watermark-гард fan-out в `tsc_post_message`**: `ON CONFLICT DO UPDATE` НЕ инкрементит unread, если `last_read_at >= v_row.created_at` (конкурентный markRead коммитился первым → ложный бейдж 1).
- **Батчи member-state — проверять `.error`**: GET messages группы → 500 (не 200 с занулёнными watermark'ами — «мигали» бы ✓✓); notify группы → fail-closed skip (без state нельзя проверить read/throttle — лучше пропустить, чем спамить).
- **Notify группы — чанки по 4** (`Promise.allSettled`), не последовательный каскад ×15.
- **`ConversationRow.onSelect(item)` — стабильный колбэк с параметром** (не inline-замыкание) — иначе `memo` мёртв (конвенция PickerTaskCard, rule 50 W3.4).
- **Плавающая пилюля — кэш узлов** `dayNodesRef` (пересобирается на смену `messages`), не `querySelectorAll` на каждый scroll-кадр.
- **Мутации групп/членства инвалидируют `['chat','conversations']`** (список синтезируется из memberships, realtime-событий по ним нет): `invalidateGroupRosterCaches` + `AddStudentDialog` (оба блока) + `TutorStudentProfile` (смена основной группы). Новый write-path членства → тоже инвалидировать.

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

Новое поле сообщения → `tsc_post_message` + `MESSAGE_SELECT` + тип. Новый write — только через edge (RLS SELECT-only). Realtime — merge-helper, не invalidate; list-канал — refcount. Новый AI-путь в чате — квота-**reservation ДО** вызова. Новая точка наджа — через `NotificationsNudge`/`useNotificationsSetup`, не свой баннер. **Группы:** любой новый хендлер/поверхность обязаны быть kind-aware (ветка через `resolveMemberContext.kind`); own-детект — по `author_user_id`; членство — только живой вывод из memberships (никогда не копировать в свою таблицу); новый тип беседы → расширяй `kind`, не плоди таблицы. **Проверка edge перед коммитом: `npx esbuild supabase/functions/tutor-student-chat-api/index.ts --outfile=NUL`** (tsc Deno-код не ловит — `*/` в комментарии обрушил сборку в ревью).
