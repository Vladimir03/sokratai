# Telegram Bot & Onboarding

## Мобильная отметка оплат через Telegram (Sprint «Mobile Pay»)

- Репетитор может отметить оплату прямо из Telegram-бота, не открывая кабинет
- Команда `/pay` в боте → список должников с кнопками по ученикам
- Нажатие на ученика → кнопки по каждому занятию с реальной датой урока (`tutor_lessons.start_at`)
- Нажатие на дату → оплата отмечена, кабинет обновляется при следующем открытии

### Дата занятия — единый источник
- **Кабинет** (`TutorPayments.tsx`): primary `tutor_lessons.start_at`, fallback `tutor_payments.due_date`
- **Бот** (`/pay` flow): то же самое — RPC возвращает `lesson_start_at`
- `tutor_payments.due_date` = `CURRENT_DATE` при создании платежа (≠ дата занятия!). **Никогда не показывай `due_date` как "дату занятия"** без проверки `lesson_start_at`

### Callback-формат (Telegram, ≤64 байт)
- `paym_list` — показать/обновить список должников
- `paym_s:{tutor_student_id}` — детали ученика (44 байта ✓)
- `paym_ok:{payment_id}` — отметить одну оплату (45 байт ✓)
- `paym_oks:{tutor_student_id}` — отметить все оплаты ученика (46 байт ✓)
- Не пересекаются с существующими `payment:` и `payment_remind:` callback-ами

### Вспомогательные функции в боте
- `formatLessonDate(row)` — русский короткий формат «21 февраля»
- `formatRub(amount)` — форматирование суммы в рублях
- `getPendingPaymentsByTelegram(telegramUserId)` — обёртка над RPC
- Все `paym_*` handlers зарегистрированы в `handleCallbackQuery` **до** блока `payment_remind:` / `payment:`

## Web invite flow (Phase 0 onboarding, 2026-03-26)

Telegram заблокирован в РФ → invite-ссылка ведёт на web-регистрацию, не на Telegram-бота.

### Ключевые файлы
- `src/pages/InvitePage.tsx` — invite-страница (`/invite/:code`)
- `src/lib/inviteApi.ts` — `claimInvite(code)` и `claimPendingInvite()`
- `supabase/functions/claim-invite/index.ts` — edge function: JWT → tutor_students link
- `src/pages/Login.tsx`, `src/pages/SignUp.tsx` — `claimPendingInvite()` после email auth
- `src/components/TelegramLoginButton.tsx` — `claimPendingInvite()` после `setSession()`

### Claim flow
- **InvitePage**: после auth → `claimInvite(inviteCode)` напрямую. При ошибке → fallback в `localStorage('pending_invite_code')`
- **Login/SignUp/Telegram**: после auth → `claimPendingInvite()` читает localStorage, вызывает claim, чистит при успехе
- **Non-blocking**: ошибка claim не блокирует вход
- **Terminal errors**: 400/404 → localStorage чистится. 5xx/network → остаётся для retry
- **Идемпотентность**: повторный claim → `already_linked` (200)

## AddStudentDialog — email поле (Phase 5, 2026-03-26)

Репетитор может добавить ученика по email (альтернатива telegram_username). Хотя бы одно из двух обязательно.

### Invite link parity (2026-04-11)
- Во вкладке `По ссылке` в `AddStudentDialog.tsx` QR-код должен кодировать **тот же web invite URL**, что и кнопка `Копировать ссылку`
- Не кодировать в QR Telegram deep link `t.me/.../start=tutor_<invite_code>` для tutor invite dialog
- Telegram deep link остаётся допустимым только как secondary / fallback path на `InvitePage.tsx`

### Логика edge function (email path)
1. Поиск auth user по email через `auth.admin.getUserByEmail()`
2. Если найден → использовать его id. Если profile отсутствует — создать
3. Если не найден → `admin.createUser({ email, email_confirm: true, password: random })`
4. Race-safe: unique constraint violation → fallback select

### Обязательные поля ученика — имя + 1 контакт (2026-06-07)

Решение Vladimir: минимум для **добавления** — имя + **хотя бы один контакт** (email ИЛИ telegram). Для **редактирования** — **только имя** (ученик уже существует с логин-email; повторно навязывать контакт нельзя — у части учеников нет Telegram).
- **`tutor-manual-add-student`** (add): gate `email || telegram` сохранён; `learning_goal` **опц.** (не блокирует).
- **`tutor-update-student`** (edit): **telegram больше НЕ required** (был баг — правка требовала Telegram); пустой telegram → `null`; `learning_goal` опц. (пишется только если непусто); +gender passthrough (фронт пишет gender отдельным `updateTutorStudent`, edge-passthrough — defensive).
- Прочие поля (Пол, Цель, Часовая ставка) — **необязательны, в аккордеоне «Дополнительно»** (`AddStudentDialog` + edit-форма `TutorStudentProfile`). Часовая ставка `null` → оплата не создаётся при amount ≤ 0 (rule 60 деньги).
- Edge-ошибки — rule 97 flat-shape `{code, error: рус}` (catch включает `e.message`).
- **Телефон/MAX как отдельные поля НЕ добавляли** — email = альтернатива Telegram (решение владельца).

### Инвайт-код «По ссылке» — RPC `tutor_get_invite_code` (2026-06-07)

Вкладка «По ссылке» больше НЕ зависит от тяжёлого `['tutor','profile']` (зависал под RU DPI → бесконечная «Загрузка кода…»). `AddStudentDialog` фетчит код через лёгкую SECURITY DEFINER RPC `tutor_get_invite_code()` (генерит-если-NULL **атомарно**: `UPDATE ... WHERE invite_code IS NULL RETURNING` + re-read при гонке) с таймаутом ~10с + retry + 3-state UI (spinner/error+«Повторить»/QR), seed `initialData` из пропса. Новая клиентская RPC → запись в `types.ts` Functions (`Args: never`).

### Режим работы (мини-группы) — в профиле, default ВКЛ (2026-06-07)

`tutors.mini_groups_enabled` **DEFAULT true** (миграция `20260607120100` + backfill всех в true). Самовыключавшийся тумблер из шапки `/tutor/students` **удалён**; выбор «Только индивидуальные / Индивидуальные + мини-группы» — радио **«Формат занятий»** в `/tutor/profile` (`WorkModeSection` → `useSetTutorMiniGroupsEnabled`). `TutorStudents` читает `Boolean(tutor?.mini_groups_enabled ?? true)` (read-only, дерайв). Флаг читается на 8 surface (students/schedule/homework/mock + диалоги). **Query-key split (P1, см. performance.md §2c):** профиль-карточка и `useTutor` теперь на РАЗНЫХ ключах — мутации профиля инвалидируют оба.

## Надёжность Telegram-бота (2026-04-04)

### Защита от silent failures
- Все message routing ветки (text/photo/voice) имеют `else` с `safeSendError` — бот **ВСЕГДА** отвечает пользователю, даже если нет сессии или онбординг не завершён
- Top-level `catch`: отправляет ошибку пользователю. Если доставка удалась → HTTP 200 (Telegram не ретраит). Если нет → HTTP 500 (Telegram ретраит)
- `safeSendError()` — обёртка `sendTelegramMessage` в try-catch, чтобы ошибка доставки error message не ломала flow

### fetchChatWithTimeout — единый вызов AI
- **ВСЕ** вызовы `/functions/v1/chat` проходят через `fetchChatWithTimeout` (private, group, button flows)
- Таймаут: `TELEGRAM_CHAT_TIMEOUT_MS` (55 сек) через `AbortController`
- Retry: 1 повтор через 2 сек — и на network errors, и на HTTP 5xx
- При исчерпании попыток — fallback сообщение пользователю, return null
- **НЕ ДОБАВЛЯТЬ** прямые `fetch` к `/functions/v1/chat` мимо этой функции

### mergeConsecutiveUserMessages — лимит длины (2026-04-04)
- Склеивает последовательные user-сообщения через `\n\n` для корректного turn-taking
- `MERGED_MESSAGE_MAX_CHARS = 8000` — при превышении обрезает начало, сохраняя последний контекст
- `chat/index.ts` валидирует `MAX_MESSAGE_LENGTH = 10000` — **НЕ СНИЖАТЬ** ниже `MERGED_MESSAGE_MAX_CHARS`
- **История бага**: при лимите 2000 бот возвращал «Произошла ошибка» на длинных диалогах — склеенные сообщения превышали лимит

### sendTypingLoop — безопасный typing indicator
- `sendTypingLoop()` ловит ошибки `fetch` внутри себя (try-catch в цикле)
- Typing indicator — non-critical; его сбой **НЕ ДОЛЖЕН** ломать основной flow
- **НЕ НУЖНО** добавлять `.catch(() => {})` на call site

### Формат ответов Telegram-бота (2026-04-04)
- `responseProfile: "telegram_compact"` — компактный формат для Telegram
- `buildTelegramCompactAppendix()` в `chat/index.ts` задаёт стиль: естественный сократический диалог
- **Жёсткий шаблон «Идея/Мини-шаг/Вопрос» УДАЛЁН** — бот отвечает в свободной форме, как веб-чат
- `parseTelegramBlocks()` разбирает структуру ответа, но **НЕ навязывает** 3-блочный формат
- `TELEGRAM_DIALOG_MAX_CHARS = 1000` (было 700) — лимит символов для dialog mode

## Telegram-бот — команда /homework удалена (2026-03-27, дочищено 2026-04-06)

Команда `/homework` и весь classic-режим ДЗ в боте **полностью удалены**.

- Команды `/homework` и `/cancel` удалены из меню бота (`setMyCommands`)
- State machine ДЗ (`HW_SELECTING`, `HW_SUBMITTING`, `HW_CONFIRMING`, `HW_REVIEW`) и вся поддиректория `supabase/functions/telegram-bot/homework/` **удалены полностью** вместе с удалением classic режима (миграция `20260406120000_drop_classic_homework.sql`)
- Фото от ученика вне guided-контекста обрабатывается обычным `handlePhotoMessage` (веб-чат)
- `homework-reminder` отправляет web-ссылку на `/student/homework` вместо `/homework`
- После деплоя бота необходимо вызвать `?action=set_commands` для обновления меню

## Подтверждение прошедших занятий (schedule-bulk-complete, 2026-06-02)

Презумпция «проведено» для прошедших `booked` занятий: баннер на `/tutor/schedule` → sheet с редактируемыми суммами → «Подтвердить все». Spec: `docs/delivery/features/schedule-bulk-complete/spec.md`. Build-лог: memory `project_schedule_bulk_complete.md`.

**Главный инвариант (финансы):** «провести» = и `status='completed'`, и создание `tutor_payments` (питают `/pay`-бот + reminder). Поэтому **деньги/любой outbound создаются ТОЛЬКО на явное «Подтвердить», никогда молча** при наступлении времени. До подтверждения — ноль записей в `tutor_payments` и ноль смены статуса.

**2 client-callable RPC (SECURITY DEFINER, ownership по `auth.uid()` внутри, REVOKE ALL FROM PUBLIC + GRANT authenticated/service_role):**
- `tutor_confirm_lessons(p_lessons jsonb)` — bulk, group-aware, per-lesson подтранзакция (`BEGIN…EXCEPTION` → ошибка одного занятия не валит остальные, без partial-corruption). Гейт: только `status='booked'` + `lesson_type='regular'` + ownership (`tutor_lessons.tutor_id → tutors.id`, иначе `skipped('not_eligible')`). **Reuse `complete_lesson_and_create_payment` — НЕ менять** (coexist с 3-кнопочным flow, rule 10). Миграции `20260602150000` (база) + `20260602200000` (guard).
- `tutor_revert_lesson(p_lesson_id uuid)` — откат: удаляет **только** `status='pending'` платежи (paid сохраняет + возвращает флаг `had_paid`), `status→cancelled`. `cancelLesson` сам по себе платежи НЕ сторнирует → revert делает это явно.

**Anti-overcharge для групп (КРИТИЧНО):** unified-группа = одна `tutor_lessons` (`student_id IS NULL`) + участники в `tutor_lesson_participants`. По каждому участнику `[✓ был]` + editable сумма; снял «был» → **0**; `amount ≤ 0` → платёж НЕ создаётся. **Группу подтверждаем ТОЛЬКО с явным непустым `participants[]` в payload** — иначе RPC `skipped('no_participants')` (guard `20260602200000`), а фронт **дизейблит CTA пока участники грузятся** (`ConfirmLessonsSheet`). Иначе гонка: подтверждение из сохранённых `payment_amount` без снятия no-show = переплата.

**Прочее:** amount в этих RPC = **РУБЛИ** (integer), не копейки — нет двойного `/100`. Идемпотентность `(lesson_id, tutor_student_id)` (через базовую RPC `ON CONFLICT`). Список баннера — клиентский дерив (`useTutorLessons`, без нового read): `booked` + `regular` + конец+3ч < now + start_at > now−14д; без cron. Отмены в sheet — через `Promise.allSettled`, считать только успешные (иначе ложное «Отменено: N»). Файлы: `src/lib/scheduleBulkComplete.ts`, `src/components/tutor/schedule/{PastLessonsConfirmBanner,ConfirmLessonsSheet}.tsx`, минимальный entry в `TutorSchedule.tsx` (rule 10).

**При расширении:** новый источник создания оплаты — только на явное подтверждение; группу — всегда через participants + явный payload (не из stored сумм вслепую); персист посещаемости (attended-флаг) — отдельная spec (v1 «был/не был» = UI-контрол дефолта суммы, не персистится).

## Удаление занятий + серии (scope) + drag групп (schedule parity, 2026-06-04)

Google-Calendar-паритет управления занятиями. Spec/план: `~/.claude/plans/rustling-herding-hare.md` (активная секция). Build-лог: memory `project_schedule_parity.md`.

**Отмена vs Удаление — РАЗНЫЕ по смыслу (НЕ путать):** Отмена = soft (`status='cancelled'`, остаётся для истории/no-show, не сторнирует платежи сама). Удаление = hard (строка исчезает).

**Жёсткое удаление — ТОЛЬКО через RPC `tutor_delete_lessons(_lesson_id, _scope)`** (миграция `20260604120000`, SECURITY DEFINER, ownership `tutor_lessons.tutor_id → tutors.id` по `auth.uid()`, REVOKE ALL FROM PUBLIC + GRANT authenticated/service_role). **Никогда не делать raw `.delete()` на `tutor_lessons`** — FK осиротит платежи (`tutor_payments.lesson_id → SET NULL`), разорвёт серию (`parent_lesson_id → SET NULL`); `deleteLesson()`/`deleteLessonsScoped()` в `tutorSchedule.ts` идут через RPC.
- **Денежный гейт (КРИТИЧНО):** блокирует, если у любого занятия набора есть `status='paid'` → RAISE `HAS_PAID_PAYMENT` (клиент → рус. фраза, rule 97). Снимает `pending`/`overdue` платежи набора ПЕРЕД delete (overdue включён намеренно — defensive, чтобы не осиротить legacy-строку; rule 60 продуктово `pending/paid`, но историческая схема допускает overdue). Никогда не осиротит оплаченные деньги.
- **Re-parent серии:** при удалении корня — самый ранний выживший становится новым корнем (`parent_lesson_id=NULL`), остальные перевешиваются на него ДО `DELETE` (иначе SET NULL делает каждого сиротой-корнем).
- `_scope ∈ 'this' | 'this_and_following' | 'all'`; расширение набора ТОЛЬКО при `is_recurring`. participants/materials удаляются каскадом (желаемо для настоящего delete).

**Серии — 3-way «Только это · Это и последующие · Вся серия» для правки/отмены/удаления** (было 2-way):
- `updateLessonSeries(lesson, { scope })`: `'all'` передаёт `_from_start_at = эпоха (1970)`, расширяя фильтр RPC `update_lesson_series` `(id=selected OR start_at>=from)` на все booked; `'this_and_following'` → from=selected. Фильтр `status='booked'` в RPC сохраняется (прошлые completed не трогаются).
- `cancelLessonSeries(lesson, scope)`: `'all'` = все booked серии; `'this_and_following'` = `.or(series).eq('status','booked').gte('start_at', lesson.start_at)`.

**Перетаскивание групповых занятий:** `GroupLessonBlock` draggable ТОЛЬКО для unified-группы (`!isLegacyFallback && groupSessionId && lessons.length===1 && lessons[0].status==='booked'`) — реюз `handleLessonDrop → updateLesson(start_at)` на единственной строке (участники едут с ней). Legacy multi-row — click-only (нужен N-строчный move). Материалы у групп: кнопка «Материалы» в `GroupDetailsDialog` → `onOpenMaterials(mainLesson)` → drawer (бэкенд `student_can_see_lesson` уже group-visible).

**Round B (2026-06-04):**
- **B1 — длительность в правке:** форма правки занятия получила селектор «Длительность»; `update_lesson_series` расширена параметром `_duration_min` (миграция `20260604130000`, DROP+CREATE из-за смены арности; `duration_min = COALESCE(_duration_min, duration_min)`) → длительность редактируется и для одиночного, и для серии (3-way).
- **B2 — состав группы:** add/remove участников у существующего **группового** занятия (booked) через SECURITY DEFINER RPC `tutor_add_lesson_participant` / `tutor_remove_lesson_participant` (миграция `20260604140000`, ownership `tutors.id`, junction без client-write RLS). Нельзя убрать последнего участника. `payment_amount` нового участника = РУБЛИ (mirror `calculateLessonPaymentAmount`). UI — секция «Состав группы» в `GroupDetailsDialog` (× убрать + пикер «Добавить ученика»). **v1 scope:** одиночное занятие, только unified-группы; individual→group конверсия + series-wide правка состава — отложены (v2-объединение).
- **B3 — edit-паритет группы:** `GroupDetailsDialog` секция «Изменить детали» (**Предмет/Заметки** — series 3-way, reuse `updateLesson`/`updateLessonSeries`; group-row `student_id` NULL → COALESCE no-op). Отмена группы — 3-way для серий (`cancelLessonSeries(scope)`; single occurrence — прежний `runCancelGroupLesson`). Время — через «Перенести группу» (single occurrence).
  - **Длительность у групп НЕ редактируется (КРИТИЧНО, money):** completion группы берёт **сохранённый** `tutor_lesson_participants.payment_amount` (снимок rate×duration при создании), НЕ пересчитывает — поэтому правка длительности оставила бы устаревший заряд (Codex P1, `f85612d`). У **индивидуальных** длительность редактируема (B1) — там сумма пересчитывается из `duration_min` на завершении. Групповой репрайсинг при смене длительности — только с v2 (`price_cents`) или отдельным resync-RPC.

**При расширении:** новый delete/cancel-путь — только через guarded RPC с money-guard (никогда raw `.delete()`); новый scope-вариант — синхронно в RPC + клиентских `*Series`-функциях + 3-way диалогах; новая правка состава — через `tutor_*_lesson_participant`-RPC (не прямой PostgREST на junction); остаток — Round C (resize, тянуть за край) + series-wide time-move (minor). Под v2 balance-модель money-guard удаления свапнётся на reversal ledger-debit.

## Серия занятий для групп — `createMiniGroupLessonSeries` (2026-06-07)

Еженедельная серия теперь создаётся и для **мини-групп** (раньше recurring-UI гейтился `{!isMiniGroupMode && …}`). `src/lib/tutorScheduleGroupCreate.ts::createMiniGroupLessonSeries` зеркалит individual `createLessonSeries` (`tutorSchedule.ts`): MAX 60 еженедельных, неизменяемое прибавление календарных дней (DST-safe), `parent_lesson_id` связывает серию.
- **Каждый повтор — отдельный unified group lesson** (`student_id NULL`) со **СВОИМ `group_session_id`** (через `makeGroupSessionId` factory = `generateGroupSessionId`) + полным набором участников. `payment_amount` каждого повтора = снимок `hourly_rate_cents` (как single, без двойного `/100`).
- **best-effort:** падение повтора не валит серию; функция возвращает `{ count, expected, failedCount }` → UI показывает `toast.warning('создано N из M')` при `failedCount > 0` (НЕ скрывать частичный провал).
- Совместимо с series 3-way edit/delete групп (ключ на `parent_lesson_id`) — созданная серия сразу управляема. `MiniGroupCreateLessonInput`/`createMiniGroupLesson` расширены `is_recurring`/`recurrence_rule`/`parent_lesson_id` → `createLesson`.
- **Длительность у групп по-прежнему НЕ редактируется** (money, см. выше) — это про правку, не про создание серии.

## UX «после занятия» — PostLessonSheet (индивидуальные, 2026-06-08)

Прошедшее `booked` **индивидуальное** занятие: в `LessonDetailsDialog` блок из 3 денежных кнопок («жду оплату»/«оплачено»/«отменён») заменён ОДНОЙ CTA **«Провести и оформить»** → открывает `src/components/tutor/schedule/PostLessonSheet.tsx` — гайд-чеклист в scrollable Sheet:
- **① Провести + оплата** — реюз `handleCompleteLesson(lessonId, amount, 'pending'|'paid')`; сумма в **РУБЛЯХ** через `calculateLessonPaymentAmount(duration, rate)` (без `/100`), идентично заменённому диалогу; ghost «Урок не состоялся» → `handleCancelLessonFromSheet` (single-occurrence `cancelLesson`; **серия-scope cancel остаётся в диалоге**).
- **②③ Запись/конспект/ДЗ** — shared `LessonMaterialsPanel` (rule 98).
- **④ Уведомить** = footer «Готово» (on-close notify-дайджест панели, TASK-7).
- После завершения step ① оптимистично → ✓ (`setPostLessonSheetLesson` patch на `status:'completed'` + payment) — тутор продолжает к материалам без переоткрытия; старый TASK-9 нудж в `handleCompleteLesson` **убран** (шит сам — материалы-поверхность).

**Scope: ТОЛЬКО индивидуальные.** Групповой диалог сохраняет прежний `LessonMaterialsDrawer` (групповой post-lesson UX — позже). Money-путь (`complete_lesson_and_create_payment`/grid/drag) не тронут (rule 10).

**Переполнение модалок (group + individual lesson dialog):** shared `src/components/ui/dialog.tsx` + `ui/alert-dialog.tsx` `DialogContent`/`AlertDialogContent` дефолты теперь несут `max-h-[85vh] overflow-y-auto`. `cn`=twMerge → диалоги со СВОИМ `max-h`/`overflow` (ChatMessage `overflow-hidden`, PaymentModal/AddStudents `max-h-[9Nvh]`, command) переопределяют чисто; только un-capped (переполнявшиеся `GroupDetailsDialog`/`LessonDetailsDialog`) получают скролл. Новый высокий диалог — НЕ дублируй cap, он уже в примитиве.
