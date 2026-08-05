# Чат репетитор↔ученик — инварианты (всегда в контексте)

Telegram-подобный realtime-чат 1:1 + групповые чаты учебных групп + @СократAI. **НЕ путать** с AI-чатом ученика (`chats`/`chat_messages`) — отдельная система. **Глубина — skill `tutor-student-chat`** (модель данных, группы и fan-out, уведомления и троттлинг, @СократAI, bucket, аватары, ссылки, PWA-наджи, история ревью).

## Единственный write-path сообщений — RPC `tsc_post_message`

Атомарно ОДНОЙ транзакцией: insert + идемпотентный дедуп по `client_msg_id` + денормализация. **НЕ дробить на insert + денорм двумя запросами** (был баг: `markRead` между ними давал ложный unread; сбой денорма терял обновление списка).

- `preview` **монотонен** (обновляется только если `created_at >= last_message_at`) — иначе поздний RPC откатывал список назад.
- `unread` инкрементится SQL-выражением, без read-modify-write гонки.
- Новое поле сообщения → в `tsc_post_message` + `MESSAGE_SELECT` + тип `TutorStudentChatMessage`. Пропустишь — поле молча не доедет.

## RLS — SELECT-only, все записи через edge

На обеих таблицах **нет INSERT/UPDATE/DELETE политик**. Все записи идут через edge `tutor-student-chat-api` под service_role: денорм-счётчики нельзя доверять клиенту.

Членство в группе **выводится живьём** из `tutor_group_memberships` JOIN `tutor_students` внутри `is_chat_conversation_member` — **никогда не копировать в свою таблицу**. Убрали из группы → мгновенно теряет всю историю; добавили → видит всю. Ноль синхронизации.

⚠️ **FK-дрейф:** `tutor_students.tutor_id → tutors.id`. Raw JOIN в `USING()` политики запрещён — только через SECURITY DEFINER хелпер (RLS на промежуточных таблицах иначе даёт false-negative).

## Realtime — merge, НИКОГДА invalidate

- **Merge только через `mergeChatMessage`** (дедуп по `id` И `client_msg_id` — realtime INSERT может обогнать POST-ответ) в `setQueryData`. **`invalidateQueries` из realtime ЗАПРЕЩЁН** (rule 40, фликер).
- **List-канал — ОДИН на роль с refcount** (`sharedListChannels`): Navigation + ChatSidebar + SideNav монтируют хук одновременно → без refcount 3 подписки × тройная обработка каждого UPDATE.
- Каналы `postgres_changes` — **уникальный суффикс топика на создание** (гонка unsubscribe/subscribe). Typing-канал намеренно делит топик (broadcast-маршрутизация).
- Reconnect gap-fill (RU DPI рвёт WS): на `SUBSCRIBED` после обрыва — точечный fetch последней страницы + merge, **не** invalidate.

## Группы — own-детект по `author_user_id`

**Own-детект ТОЛЬКО по `author_user_id`, НЕ по `sender_role`** — у двух учеников группы одинаковый `sender_role='student'`. Регресс = чужие сообщения справа как «свои».

- Любой новый хендлер/поверхность обязаны быть **kind-aware** (ветка через `resolveMemberContext.kind`).
- Новый тип беседы → расширять `kind`, не плодить таблицы.
- Member-события realtime до резолва uid — **скипать**: своя строка ушла бы в peer-ветку и монотонный MAX завысил бы `peer_last_read_at` навсегда → ложные ✓✓.

## Пагинация — составной keyset

Курсор ОБЯЗАН нести `id` (`before` + `before_id`; сортировка `(created_at, id)` desc) — иначе теряются сообщения с равным timestamp на границе страницы.

**Батч-списки — проверять `.error` каждого запроса**, не отдавать 200 с «пустыми» диалогами: клиентский кэш затрётся деградацией.

## @СократAI — фото контекста и квота ДО вызова

**Сообщение с фото и БЕЗ подписи нельзя выбрасывать из контекста** (`if (!h.content?.trim()) continue` делал ровно это) — присланная тетрадь становилась невидимой для AI дважды: и как сообщение, и как картинка. Фото привязывается к СВОЕМУ сообщению (`msgIndexByRowId`), не к хвосту: иначе решение ученика читается как приложенное к сообщению репетитора. Отбор — до 2 из триггерного, добор из истории от свежих к старым, общий кап 3. Глубина — skill `tutor-student-chat`.

Ученик → `checkAiQuota(context:'chat')`; репетитор → cap 30/день **RESERVATION** (`logAnalyticsEvent` **ПЕРЕД** вызовом, не post-hoc fire-and-forget — параллельные упоминания обходили cap). Неудачный вызов расходует слот (анти-retry-спам). Новый AI-путь в чате → квота-reservation ДО вызова.

## Storage: самоссылающийся счётчик — только SECURITY DEFINER

⚠️ **Подзапрос к `storage.objects` ВНУТРИ политики на `storage.objects` = Postgres 42P17 infinite recursion** → storage-api 400 на КАЖДЫЙ upload. Любой самоссылающийся счётчик в storage-политике — только через SECURITY DEFINER-хелпер (`tsc_chat_upload_count`).

**Lovable-quirk:** `INSERT INTO storage.buckets(...)` в миграции на Lovable **не применяется** — лимиты/mime выставляются ВРУЧНУЮ в дашборде. Любой новый бакет через миграцию → тот же ручной шаг.

## Push / VAPID

- **VAPID public key ЗАХАРДКОЖЕН** в `pushApi.ts` (env-переменная не была задана нигде → `undefined` в бандле → «мёртвая кнопка»). Public key не секрет. **ОБЯЗАН совпадать с edge-секретами** `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`. Смена ключа → синхронно фронт-хардкод + оба edge-секрета.
- `isPushSupported` — на общем `PROD_HOSTS` (был захардкожен один хост → push мёртв на проде).
- Любой сбой подписки → toast, **никогда молча**.
- Новая точка наджа — через `NotificationsNudge`/`useNotificationsSetup`, не свой баннер.

## Проверка перед коммитом

`npx esbuild supabase/functions/tutor-student-chat-api/index.ts --outfile=NUL` — tsc Deno-код не ловит (`*/` в комментарии обрушил сборку в ревью).
