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

### Обязательные поля ученика — ТОЛЬКО имя (онбординг v2, 2026-07-01)

Решение Vladimir (онбординг-активация v2): минимум для **добавления** — **только имя** (контакт опционален). Контакт/канал нужен **до первой отправки ДЗ**, а не до создания: репетитор заводит плейсхолдер по имени, копит ему ДЗ, и подключает ссылкой/QR (share-gate) при первой выдаче (create-then-claim). Это **ослабляет** прежнее правило «имя + 1 контакт» (2026-06-07) — баг «репетитор не знает контакт → заводит фейковый email». Для **редактирования** — тоже только имя.
- **`tutor-manual-add-student`** (add): contact-gate `email || telegram` **УДАЛЁН** (был ~стр. 181–186); имя — единственный обязательный gate; email-формат проверяется только если задан; нет контакта → temp-email плейсхолдер (`manual_{uuid}@temp.sokratai.ru`, Step 3). Новый action **`bulk-add-students`** `{ names: string[] }` (≤50) → per-name `createPlaceholderByName` (partial success `{created[], errors[]}`). Телеметрия `tutor_first_student_added` (`logAnalyticsEventOnce` scope tutor_id).
- **`AddStudentDialog`** (frontend): contact-gate-toast убран; плашка «без контакта — это нормально»; bulk-режим (textarea имён + `bulkAddTutorStudents`); для name-only плейсхолдера (temp-email / нет контакта) **НЕ** показывается `StudentCredentialsModal` (логин/пароль бесполезны — доставка через share-gate).
- **`tutor-update-student`** (edit): только имя (как было); пустой telegram → `null`; `learning_goal` опц.; +gender passthrough.
- Прочие поля (Пол, Цель, Часовая ставка) — **необязательны, в аккордеоне «Дополнительно»**.
- Edge-ошибки — rule 97 flat-shape `{code, error: рус}`.
- **Телефон/SMS НЕ добавляли** — только email как канал (решение владельца, онбординг v2).

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

## Баланс ученика — ledger (Phase 2a, 2026-06-09)

Кошелёк ученика: `tutor_students.balance` (**РУБЛИ integer**, без копеек/×100) = Σ signed записей `tutor_ledger_entries` (append-only). Идея Егора (модель баланса вместо per-lesson paid/unpaid); 2a — аддитивный слой, `tutor_payments` живёт параллельно и в баланс НЕ агрегируется. Spec: `docs/delivery/features/scheduling-payments-balance/spec.md` (v6, 4 раунда независимого ревью) + `prd.md` + `tasks.md`. Build-лог: memory `project_scheduling_v2_balance.md`. Миграции `20260609120000…120500`.

**Инварианты (деньги, КРИТИЧНО):**
- **Append-only:** записи ledger НИКОГДА не UPDATE/DELETE — только offsetting reverse (`reverses_entry_id`/`reversed_by_entry_id`; one-reversal unique index). «Правка» суммы = reverse + новая запись.
- **Запись ТОЛЬКО через SECURITY DEFINER** (table REVOKE INSERT/UPDATE/DELETE от authenticated; RLS SELECT `owns_tutor_student`): lesson-debit — **`_sync_lesson_debit`** (единственная точка: идемпотентный + amount-aware; `pg_advisory_xact_lock(lesson,student)` само-сериализация; derive authoritative `tutor_id` из `tutor_students` + RAISE `STUDENT_TUTOR_MISMATCH`; conflict-mismatch → RAISE `LEDGER_DEBIT_RACE`, не silent NULL; **amount<=0 = чистый no-op, НЕ reverse** — v6 single-responsibility); reverse — `_reverse_lesson_debit`/`_reverse_ledger_entry` (no-op-safe, `FOR UPDATE` + `ON CONFLICT DO NOTHING`); клиентские RPC `tutor_record_topup` (credit) + `tutor_reverse_ledger_entry` (ownership + `ALREADY_REVERSED`).
- **Debit пишется АДДИТИВНО внутри money-RPC (extend-RPC, НЕ триггеры):** `complete_lesson_and_create_payment` (group loop по участнику + individual, ПОСЛЕ payment-upsert, финальная сумма) + `update_group_participant_payment_status`. Bulk `tutor_confirm_lessons` покрыт транзитивно. **Новый payment-write сайт с `lesson_id` ОБЯЗАН звать `_sync_lesson_debit`** (rule-40 dual-write-path; грепни `INSERT INTO ...tutor_payments`). Reverse — внутри `tutor_delete_lessons`/`tutor_revert_lesson` (где сносятся pending/overdue, ДО удаления строки занятия). `_actor = COALESCE(auth.uid(), tutors.user_id)` (Telegram/service-role-safe), `created_by` nullable.
- **`balance` ledger-managed:** AFTER-INSERT триггер (+delta, transaction-local GUC `app.ledger_op`); прямой `UPDATE balance` → RAISE (guarded BEFORE-UPDATE; правка профиля без balance — проходит). В `types.ts` `balance` только в `Row` (НЕ Insert/Update — compile-time guard). Reconcile: `recompute_student_balance()` (service_role).
- **Seed one-shot** через marker `tutor_ledger_seed_runs(tutor_student_id PK)` (НЕ note/created_by); per-row debit на каждую `tutor_payments` + credit на каждую `paid` → opening = **−Σ(pending+overdue)** (текущий долг, не выручка); lesson-linked → `source_kind='lesson'` (идемпотентность будущего re-complete), manual → `'adjustment'`; `ROUND(amount)::int`.
- **Re-complete-to-0 НЕ реверсит debit** (структурно: `_sync(<=0)`=no-op; мирроринг frozen payment — payment-row тоже остаётся); снять заряд = delete/revert. **Soft `cancelLesson` не реверсит** (оплату не сносит — заряд стоит).
- **Frontend:** `src/lib/tutorBalanceApi.ts` (RAISE-код→RU mapping, rule 97; рубли) + `StudentBalanceCard` (первым блоком вкладки «Обзор» карточки ученика, «Внести оплату» = одно поле ₽ + дата). Query keys `['tutor','balance',sid]` / `['tutor','ledger',sid]`, `refetchOnWindowFocus:false`.
- **TASK-6 (2026-06-10) — лента + правка записей:** `tutor_edit_topup` (атомарный reverse+new, ТОЛЬКО topup-credit; `replaces_entry_id` для collapse «исправлено» в `LedgerFeed`) — миграция `20260610120000`. **Списания НИКОГДА не правятся прямой записью в ledger:** сумма (индивидуальное) → re-complete через `complete_lesson_and_create_payment` (payment+debit синхронно, paid-статус читается с error-гейтом — сбой фетча НЕ деградирует paid→pending); группа → в карточке занятия; отмена → `tutor_revert_lesson` с **paid-гейтом** (preflight `tutor_payments.status='paid'` → блок «сначала снимите отметку»; гонка → `had_paid` → toast.warning, не молча); занятие удалено → plain reverse. Деньги в UI парсятся ТОЛЬКО `parseRubleAmount` (`tutorBalanceApi`; «-5000»/«1,5» → invalid, не «другое число»).
- **Чипы «Долг» = balance (single source, фикс «два долга» 2026-06-10):** шапка `TutorStudentProfile` + `StudentCard` дерайвят из `tutor_students.balance`, НЕ из legacy `debt_amount` (тот = Σ pending+overdue из `tutor_payments`; расходится после mark-paid/delete на «Оплатах» и живёт только внутри «Оплат» до 2b); `balance>0` → «Предоплата». «Получил деньги» = «Внести оплату» (ledger), а не legacy «отметить оплачено».
- **Инвалидации (КРИТИЧНО при расширении):** новый UI-путь, дёргающий money-RPC занятий (complete / group-toggle / delete / revert / bulk), **ОБЯЗАН** инвалидировать `['tutor','balance'|'ledger'|'students'|'student']` — хелпер `invalidateBalanceCaches` в `TutorSchedule.tsx` (wired: complete, group participant toggle, delete оба диалога, `ConfirmLessonsSheet` bulk). Иначе stale-чипы долга.
- **Доход за месяц над календарём (`MonthIncomeStrip`, 2026-06-10, запрос Егора):** на `/tutor/schedule` между легендой и week-nav — «Июнь: X ₽ из Y ₽» + прогресс-бар. **earned** = ОДИН ledger-запрос (активные lesson-debits, `occurred_on` в месяце видимой недели, anchor = чт = weekStart+3д); **expected** = earned + цены booked месяца (индивид: `calculateLessonPaymentAmount`; группа: Σ `tutor_lesson_participants.payment_amount`). `getMonthIncome` в `tutorBalanceApi.ts`. **Query key НАМЕРЕННО под `['tutor','ledger','month-income',ym]`** — money-инвалидации (`invalidateBalanceCaches`/bulk/LedgerFeed) обновляют цифру без новой проводки; НЕ переименовывать ключ без переноса инвалидаций. Месяц без занятий → полоска скрыта; ошибка → тихий null (rule 95, не баннер). Cancelled не считаются; прошедшие-неподтверждённые booked сидят в expected до «Провести».
- **2b+ (Parking Lot):** заморозить `tutor_payments` (cutover, убрать payment-write из complete), авто-debit cron + сводка, абонементы (3). Отчёт родителю (2c) и reframe «Оплаты»/`/pay` на баланс — **частично сделаны 2026-06-15, см. ниже.**

## Любая полученная оплата → CREDIT на баланс + «Оплаты» на ledger (частичный 2b, 2026-06-15)

Репорт Егора: «+ Добавить» на странице «Оплаты» писал в legacy `tutor_payments` (`createTutorPayment`), минуя баланс → ученик 0. Плюс пробел: пометка занятия оплаченным создавала ledger-**debit**, но НЕ **credit** → оплаченные занятия уводили баланс в минус. Решения владельца (locked): «Оплаты» → ledger как источник правды; **любая «деньги получены» зачисляется на баланс**; ручная запись всегда «получено», без подтверждения; **всё одним релизом** + проверка на данных Егора перед выкаткой. План/SQL-гейты: `~/.claude/plans/1-glowing-spindle.md`. Build-лог: memory `project_scheduling_v2_balance.md`. Миграции `20260615150000…150200`.

**Модель:** оплаченное занятие = debit + credit = **net 0**; неоплаченное = только debit (−amount); ручная оплата/topup = только credit (+amount). Инвариант: у каждого оплаченного занятия ровно один активный lesson-debit И lesson-credit равной суммы.

**`_sync_lesson_credit` (M1 `20260615150000`)** — структурное зеркало финального `_sync_lesson_debit` (тот же `pg_advisory_xact_lock`, derive+validate `tutor_id`→`STUDENT_TUTOR_MISMATCH`, amount<=0 → pure no-op, amount-aware, `LEDGER_CREDIT_RACE/LOST`). Ключ — `source_kind='lesson'`+`kind='credit'`+`source_lesson_id` (CHECK не трогали) + новый partial-unique `idx_ledger_active_lesson_credit`. `_reverse_lesson_credit` — зеркало `_reverse_lesson_debit`. service_role-only.

**Wiring (M2 `20260615150100`, rule-10 frozen — VERBATIM + пометки `-- CREDIT`):** оплачено → `_sync_lesson_credit`, НЕ оплачено/снятие → `_reverse_lesson_credit`. Покрыты ВСЕ payment-write-сайты (rule-40): `complete_lesson_and_create_payment` (group+individual), `update_group_participant_payment_status` (paid↔pending toggle), **`mark_payment_as_paid_by_telegram`** (новый ledger-сайт; сигнатура `(_payment_id, _telegram_id)`; `RETURNING…INTO` + credit для lesson-привязанных; manual `lesson_id IS NULL` /pay-строки — descoped). `tutor_revert_lesson`/`tutor_delete_lessons` теперь сторнируют И debit, И credit (`kind IN ('debit','credit')`) — **фикс латентного бага**: revert оплаченного занятия сторнил только debit → баланс прыгал +amount. `tutor_confirm_lessons` (bulk) всегда `'pending'` → credit не создаёт (корректно).

**Reconcile (M3 `20260615150200`, one-shot, marker `tutor_ledger_credit_recon_runs`, balance-neutral для сид-набора):** сид зачёл исторические `paid` строки credit'ом `source_kind='adjustment'` БЕЗ `source_lesson_id` → `_sync_lesson_credit` (ключ по lesson) их не видит → двойной зачёт при re-mark. Фикс — «reverse-all-then-rebuild»: (1) сторнировать все активные сидовые `'seed: оплачено (история)'` credit'ы; (2a) создать lesson-keyed credit на каждую `paid` lesson-строку (`ON CONFLICT DO NOTHING`); (2b) adjustment-credit на каждую `paid` manual-строку. **НЕ матчить credit↔занятие по сумме** (same-amount неоднозначность). Δ для сид-набора = 0; post-seed `paid` занятия/manual (напр. Lera «+ Добавить» 13.06) дополнительно зачисляются (**намеренный сдвиг балансов** — долг уменьшится; владелец подтвердил, перед выкаткой snapshot-diff + сверка с Егором).

**«Оплаты» reframe (frontend):** список = кросс-ученический журнал ПОЛУЧЕННЫХ оплат (active credits) `listTutorReceivedPayments` (`tutor_ledger_entries` `.eq(kind,'credit').is(reverses_entry_id,null).is(reversed_by_entry_id,null)`, hook `useTutorReceivedPayments` key `['tutor','received-payments',...]`); сводки переосмыслены (Получено = Σ credits периода; Ожидается = Σ(−balance); Доход за месяц = `getMonthIncome`); «+ Добавить» → `recordTopup` (всегда «получено», без подтверждения) через `TopupDialog` с пропом `students` (select-режим); удаление = `reverseLedgerEntry` (только topup+adjustment; lesson-оплата правится в занятии); «Напомнить» переехала в `DebtorsCard`. Legacy `createTutorPayment`/`markPaymentAsPaid`/`deleteTutorPayment` — мёртвые (без UI-вызовов), оставлены defined; `getTutorPayments`/`useTutorPayments` ещё нужны `useTutorHomeData`.

**Round-2 (ревью ChatGPT-5.5, закрыты 6 находок):** (1) **manual `/pay`** (`lesson_id IS NULL`) тоже зачисляет — `_credit_manual_payment` + колонка `source_payment_id` + partial-unique (идемпотентность; M3 step2b тоже проставляет `source_payment_id` → нет двойного зачёта с будущим `/pay`). (2) **reconcile step2a гейтится `EXISTS(active lesson-debit)`** — reverted-paid занятие (debit сторнирован, paid-строка осталась) больше НЕ даёт orphan-credit `+amount` (балансово-нейтрально для нормальных, исправляет orphan/дрейф). (3) **lesson-credit НЕЛЬЗЯ сторнировать напрямую**: `tutor_reverse_ledger_entry` reject `source_kind='lesson'` (`LESSON_ENTRY_NOT_REVERSIBLE`) + `LedgerFeed.canCancel` исключает lesson-credit (занятие отменяется через строку списания → revert реверсит ОБА). (4) **прямой клиентский DML на `tutor_payments` REVOKE'нут** от authenticated (defense-in-depth: мёртвые `createTutorPayment`/`markPaymentAsPaid`/`deleteTutorPayment` + stale-вкладка теперь fail-loud, не тихий bypass; SECURITY DEFINER money-RPC не затронуты). (6) **«Получено» = точный aggregate** (`getReceivedPaymentsTotal`, отдельно от капнутого 200-списка) + invalidation `['tutor','received-payments']` во ВСЕХ money-путях (`TopupDialog` core + `LedgerFeed` + `invalidateBalanceCaches`). (7) `criticalError` гейтится `students.length===0` (rule 95). **(5, осознанно НЕ чиним):** lock-ordering revert/delete (ledger-row ДО lesson-row) vs complete (наоборот) → теоретический 40P01 при конкурентных revert+re-complete одного занятия — **пред-существует** (2a debit-loop), деньги НЕ коррумпирует (deadlock=чистый rollback, retryable); полный фикс = advisory-lock до `UPDATE tutor_lessons` в frozen complete-RPC → отдельный раунд.

**Round-3 (повторное ревью — закрыты replay-дыры):** (1) **manual-payment credit идемпотентен НАВСЕГДА** — индекс `idx_ledger_manual_payment_credit_once` на `(source_payment_id) WHERE source_payment_id IS NOT NULL AND kind='credit'` (НЕ partial-active): replay старой /pay-кнопки после удаления оплаты НЕ создаёт credit заново (offsetting от reverse имеет `source_payment_id=NULL` → не конфликтует). (2) **`_sync_lesson_credit` требует active lesson-debit ТОЙ ЖЕ суммы** (runtime-гейт): replay /pay по reverted-but-paid занятию → нет debit → no-op, нет orphan +amount. **M3 step2a — гейт по СУЩЕСТВОВАНИЮ active debit, БЕЗ amount-match** (round-4): сверка balance-neutral by construction (credit = ROUND(tp.amount) = сторнированный сидовый credit, независимо от суммы debit); amount-match в M3 СКИНУЛ бы аномальную строку и сдвинул баланс. Amount-match — только в runtime helper (credit = новые деньги), не в reconcile. (3) **reject в `tutor_reverse_ledger_entry` — ТОЛЬКО linked** (`source_kind='lesson' AND source_lesson_id IS NOT NULL`); orphan (удалённое занятие) реверсится обычным путём; `LedgerFeed` paid-preflight УБРАН (revert теперь paid-safe — сторнирует обе стороны), `canCancel` блокирует только linked lesson-credit. (6) **«Получено» — SQL-aggregate RPC `tutor_received_payments_summary`** (точный Σ+count, без клиент-капа); на ошибке UI показывает «—», не молчаливый неверный фолбэк. (7) `LessonChargeDialog` тоже инвалидирует `received-payments`.

**При расширении:** новый «деньги получены»-путь → `_sync_lesson_credit` (lesson, требует active debit) / `_credit_manual_payment` (manual `tutor_payments`, идемпотентен по `source_payment_id` навсегда) / `tutor_record_topup` (свободный), НИКОГДА прямой `tutor_payments.status='paid'` без credit; новый payment-write-сайт грепни `status='paid'` + `INSERT…tutor_payments`; revert/delete — симметрично И debit, И credit; lesson-entry правится ТОЛЬКО через занятие (linked); credit-хелперы — byte-mirror `_sync_lesson_debit` (amount-aware + active-debit gate); reconcile — marker-guarded reverse-rebuild с гейтом active-debit-same-amount; кросс-ученический итог — SQL-aggregate, не клиент-сумма.

## Phase 2b cutover — cost-driven списание + заморозка `tutor_payments` + `/pay` на баланс (2026-06-15)

Полный 2b-cutover (B4 + B5) поверх «Любая полученная оплата → CREDIT». ОС Егора: «у занятия нет статуса оплачено/жду; прошло время → списать стоимость с баланса; поменял стоимость прошедшего → пересчёт; не хочу списывать → цена 0; будущее → не списывается». **Money-critical, ОБЯЗАТЕЛЬНОЕ независимое ревью** (ChatGPT-5.5: 2×P0 + P1 + P2 закрыты). Миграции `20260615160000` (foundation) + `190000` (B4) + `200000` (B5). План `~/.claude/plans/1-glowing-spindle.md` (Phase 2b). НЕ задеплоено.

**Главный инвариант (money):** у каждого занятия **≤ 1 active lesson-debit**; credit создаётся ТОЛЬКО явно (topup / `/pay`-settle / `_credit_manual_payment`). Нет пути «деньги получены без credit» и нет «прощённое занятие с висящим debit».

**Биллинг решает ЦЕНА, не статус (status-independent):**
- прошедшее (`start_at + duration ≤ now`) + `cost > 0` → debit; `cost 0/NULL` → waive (reverse) / skip; будущее → нет debit.
- **`_apply_lesson_debit_from_current_cost(lesson, student, actor)`** — ЕДИНСТВЕННАЯ TOCTOU-safe точка применения: читает `cost = COALESCE(участник override, занятие override, derived rate×duration)` ПОД 2-key advisory-lock `pg_advisory_xact_lock(hashtext(lesson), hashtext(student))` (тот же, что у `_sync_lesson_debit`, реентерабелен), past-gate, затем sync (>0) / reverse (≤0) / skip (NULL). Cron, setters, complete, cancel — ВСЕ через него или под тем же lock'ом. **Cost-формула строго `COALESCE(participant, lesson, derived)`** — не «participant ∥ derived» (P1 review fix).
- **`tutor_auto_debit_due_lessons(_tutor_id?)`** — скан `end ≤ now`, окно 60 дней, per-lesson `BEGIN…EXCEPTION`, счётчик `processed`; идемпотентен (повторный скан = no-op через amount-aware `_sync`). `tutor_ids_with_due_lessons()` → edge **`lesson-auto-debit`** (SCHEDULER_SECRET-guard, `verify_jwt=false`, per-tutor отдельными транзакциями). pg_cron — через Management API (как `process-email-queue`, **не миграцией**). Lazy-reconcile на mount `TutorSchedule` (`tutor_sync_my_due_debits()`).
- **Setters** `tutor_set_lesson_cost(lesson, amount)` / `tutor_set_participant_cost(lesson, student, amount)` (ownership `auth.uid→tutors.id`; участник доп.-валидируется через `tutor_students.tutor_id` — P2 review fix): UPDATE цены → `_apply` (no-op для будущего; пересчёт для прошедшего amount-aware; 0 → reverse).

**Отмена vs Удаление (КРИТИЧНО, разная money-семантика):**
- **Удаление** (`tutor_delete_lessons`) → строка исчезает, **списания НЕТ** (reverse debit+credit).
- **Отмена** (`tutor_cancel_lesson_with_charge(lesson, amount)`, **individual only**, group → `GROUP_LESSON`) → **immediate** (НЕ past-gated — отменённое = долг сейчас) debit на введённую репетитором сумму (`>0`) / reverse (`=0`). **Берёт тот же 2-key advisory-lock** перед UPDATE+apply (**P0 fix**: иначе нулевой reverse расходился с параллельным cron `_apply` → устаревший active debit на «прощённом» занятии). Default суммы в UI = текущая стоимость, `0` = не списывать.
- Soft `cancelLesson` (status→cancelled без суммы) — НЕ трогает деньги (заряд стоит).

**Заморозка `tutor_payments` (B4):** `complete_lesson_and_create_payment` + `update_group_participant_payment_status` — **verbatim база `20260615182853` МИНУС `INSERT…tutor_payments` и credit-on-paid (2a wiring), ПЛЮС debit через `_apply`** (reverse-on-0). Per-lesson «оплачено/жду» больше нет (cosmetic). `tutor_confirm_lessons` **REVOKE FROM authenticated** (UI `ConfirmLessonsSheet`/`PastLessonsConfirmBanner` удалены). Деньги получены = topup.

**`/pay`-бот на баланс (B5, миграция `200000`):** «должник» = `balance < 0` (НЕ pending `tutor_payments`). `get_tutor_balance_debtors_by_telegram(telegram_id)` (mirror DebtorsCard: `debt = -balance`, каскад имени, service_role-only). «✅ Получил оплату» = `tutor_settle_debt_by_telegram(telegram_id, student)` — topup-credit ровно текущего долга → balance 0; **single-key advisory-lock** сериализует double-tap (второй тап balance≥0 → `credited:0` no-op; single-key ≠ 2-key lesson-lock namespace). Бот: list debtors → детали (одна кнопка settle) → settle. `mark_payment_as_paid_by_telegram`/`get_tutor_pending_payments_by_telegram` — dormant (в БД, бот не зовёт).

**Legacy per-lesson reminder retired (P0 fix):** старые кнопки `payment:paid/pending/cancelled` ПОСЛЕ cutover завершали+списывали занятие БЕЗ credit'а (= минус баланса при «оплачено») и отменяли мимо cost-driven waive. **`payment-reminder` edge → no-op stub** (SCHEDULER_SECRET-guard оставлен, кнопок не шлёт); **bot `handlePaymentCallback` → dormant fail-loud** (НЕ трогает деньги/занятие, edit'ит сообщение → «кнопка устарела, открой /pay»). Cron `payment-reminder` ретайрить отдельно.

**Frontend cost-UX (единственный денежный контрол):** `LessonDetailsDialog` (individual) — редактируемая стоимость (`setLessonCost`) + cancel-with-amount AlertDialog (`cancelLessonWithCharge`); `GroupDetailsDialog` — per-participant cost editor (`setParticipantCost`, 0 = waive) вместо paid/pending тумблера; `PostLessonSheet` — materials-only (без платёжного шага); bulk-banner удалён. `handleCompleteLesson` стал dead (нет вызова — cabinet НЕ complete-with-paid). Все money-пути инвалидируют `invalidateBalanceCaches`. `tutorBalanceApi.ts`: `setLessonCost`/`setParticipantCost`/`cancelLessonWithCharge`/`syncMyDueDebits` + `mapLessonCostError` (RAISE→RU, rule 97).

**При расширении:** новый charge-путь → ТОЛЬКО через `_apply` (cost-driven, под 2-key lock) или immediate `tutor_cancel_lesson_with_charge`-паттерн (С lock'ом); новый «деньги получены» → topup/settle/`_credit_manual_payment` (НИКОГДА complete-with-paid / `tutor_payments.status='paid'` без credit); cost = `COALESCE(participant, lesson, derived)`; reminder/legacy `payment:*` — НЕ возрождать money-мутацию (только informational → /pay); ownership участника — через `tutor_students.tutor_id`.

Spec: `docs/delivery/features/scheduling-payments-balance/spec.md` (§Phase 2b cutover). Build-лог: memory `project_scheduling_v2_balance.md`.

## Архивирование ученика — `tutor_students.archived_at` (запрос Елены, 2026-06-17)

Репетитор архивирует ученика, с которым прекратил заниматься (обратимо, история цела). Миграция `20260617130000`.

- **Ортогональная колонка `archived_at TIMESTAMPTZ NULL`** (НЕ `status`): `status` — прогрессия (`active/paused/completed`); `archived_at` — видимость. **КРИТИЧНО:** архивный ученик остаётся `status='active'` → `get_subscription_status` (AI-квота платного репетитора, rule 99) **не задет**. NULL=активный, NOT NULL=в архиве.
- **`getTutorStudents()` фильтрует `archived_at IS NULL`** — **единый источник** для ВСЕХ пикеров (создание занятий/ДЗ/пробников), главного списка, должников → архив скрыт везде одним фильтром. Отдельный `getArchivedTutorStudents()` + `useArchivedTutorStudents(enabled)` для управления архивом. Мутация `setTutorStudentArchived(id, archived)` (direct PostgREST + RLS; `invalidateTutorStudentDependentQueries` рефетчит активный И архивный список — `['tutor','students','archived']` субключ `['tutor','students']`).
- **`tutor-progress-api::handleProgressOverview` фильтрует `.is('archived_at', null)` ОТДЕЛЬНО** — `status='active'` НЕ исключает архивных (ортогональность) → иначе архив всплывал бы в «Успеваемости»/«Требуют внимания». Per-student progress/target (один ученик по id) — НЕ фильтруется (тутор открыл явно).
- **UI:** профиль (`TutorStudentProfile`) — кнопка «В архив»/«Из архива» + янтарный баннер; `/tutor/students` — тоггл «Архив»/«К активным» + карточки с бейджем «Архив» и инлайн «Вернуть» (`StudentCard` опц. `onUnarchive`). История (занятия/ДЗ/платежи/баланс) сохраняется.
- **При расширении:** новый surface со списком учеников для выбора → реюз `getTutorStudents()` (архив уже скрыт); новый server-side enumerate (edge) — добавь `.is('archived_at', null)` явно (`status='active'` не покрывает); home-блоки «активность/последние действия» НЕ фильтруют (архивный = неактивный, естественно не всплывает).

Build-лог: memory `project_elena_requests_2026_06_17.md`.

## Удаление ученика — каскад участников групп + архив-альтернатива (запрос Елены, 2026-06-18)

Репорт Елены: ученик не удаляется («Не удалось удалить ученика»). Причина: `tutor_lesson_participants.tutor_student_id` ссылался на `tutor_students(id)` **БЕЗ `ON DELETE`** (= RESTRICT) → удаление участника групповых занятий падало FK-violation (23503). Остальные FK (payments/ledger/memberships/mock/report-links) уже CASCADE — participant был единственным блокером.

- **Миграция `20260617150000`:** `tutor_lesson_participants_tutor_student_id_fkey` → `ON DELETE CASCADE` (DROP+ADD, консистентно с остальными). Каскад убирает только строки-участники удаляемого ученика; занятие + другие участники целы.
- **Удаление деструктивно по дизайну** (каскадит ledger/payments → исторический доход меняется задним числом). Безопасная альтернатива — **архив** (`archived_at`, см. секцию «Архивирование ученика»). `removeStudentFromTutor` возвращает `{ ok, error? }` (не `boolean`); `23503` → рус. подсказка про архив (rule 97). Диалог удаления: усиленное предупреждение «безвозвратно сотрёт историю» + кнопка «Заархивировать вместо удаления».
- **При расширении:** новая FK-ссылка на `tutor_students(id)` — задавай `ON DELETE` явно (CASCADE для зависимых записей репетитора, иначе тихо блокирует удаление); деструктивное удаление учеников с историей — предлагай архив.

Build-лог: memory `project_elena_requests_2026_06_17.md` (секция 2026-06-18).

## Группы и метки учеников — единая сущность `tutor_groups.is_primary` (запрос Елены/Егора, 2026-06-18)

Организация учеников: поиск + основные группы + метки (#интенсив). **Не плодим сущности** (просьба Елены) — расширяем `tutor_groups` флагом `is_primary` (миграция `20260618120000`). Модель Егора main/additional. v1 = «Ядро».

- **`tutor_groups.is_primary BOOLEAN DEFAULT false`** (FK `tutor_id → tutors.id`, как раньше): `true` = **основная (учебная) группа** — ≤1 активная на ученика, хостит групповые занятия (`group_source_tutor_group_id`), дефолтная группировка списка `/tutor/students`. `false` = **метка** — ∞ на ученика, для фильтра/массовой выдачи. Backfill: все прежние группы → `true` (one-shot; код меток деплоится вместе → на момент применения `is_primary=false` строк ещё нет).
- **Снят `idx_tutor_group_memberships_active_student_unique`** («одна активная группа на ученика»). Инвариант «≤1 активная ОСНОВНАЯ группа» теперь — **guard-триггер `tutor_group_memberships_single_primary_guard`** (BEFORE INSERT/UPDATE, auto-replace прежней основной; метки не трогает; без рекурсии). Защищает и прямой PostgREST-write (RLS пускает authenticated). Дубль-гард `(tutor_student_id, tutor_group_id)` остаётся.
- **Write-path (`src/lib/tutors.ts`):** `setStudentPrimaryGroup(id, groupId|null)` (основная; `null` снимает ТОЛЬКО основную — метки живут), `addStudentTag`/`removeStudentTag` (метки), `createTutorGroup({is_primary})`. **`upsertTutorGroupMembership` БОЛЬШЕ НЕ деактивирует прочие** (иначе снёс бы метки — single-primary обеспечивает триггер); `deactivateTutorGroupMembership` снимает ВСЕ (legacy, только новый ученик). `getTutorGroupMemberships` nested-select несёт `is_primary`. Мутации инвалидируют `['tutor','groups']` + `['tutor','group-memberships']` (+ students — общий кэш).
- **Инвариант контекстов (КРИТИЧНО):** учебные контексты → **только `is_primary=true`** (создание группового занятия `AddLessonDialog` в `TutorSchedule` получает `primaryGroupsForLesson`; селектор «основной группы» в профиле/`AddStudentDialog`; `createTutorGroup` оттуда → `is_primary:true`). Фильтр/массовая выдача/теггинг → все/метки (`HWAssignSection` показывает 2 секции «Учебные группы»/«Метки», юнион общий; фильтр меток + чипы на `/tutor/students`). Новый read-site `useTutorGroups`/`getTutorGroups` — классифицировать (грепни перед мержем).
- **Frontend:** `/tutor/students` — поиск (имя/username/telegram, маркировка репетитора, не данные ученика), фильтр по метке, дефолт-группировка по основной группе (секции-заголовки; плоский+пагинация при активном поиске/фильтре), чипы меток на `StudentCard` (проп `tags`). Профиль — селектор основной группы (только primary) + `StudentTagsEditor` (чип-инпут create-or-reuse → реюз, защита от дублей «как попало»; мгновенный persist, не в общий save). `StudentsToolbar.FilterValues.tagId`.
- **Deploy-ПОРЯДОК (КРИТИЧНО):** миграция ПЕРВОЙ (Lovable на push) — фронт зависит от **снятого** unique-индекса (иначе `addStudentTag` = 2-я активная группа → violation) + колонки `is_primary` (классификация через `getTutorGroups` `select('*')`; nested-select memberships `is_primary` НЕ селектит — deploy-skew-proof, review F2) → фронт `deploy-sokratai`. **Edge `tutor-progress-api` тоже изменён** (группа ученика = только основная, review F3) — деплоит Lovable на push. Выдача ДЗ — существующий `/assign` (membership — прямой PostgREST под RLS).
- **Скрин 3 (отдельный фронт-фикс):** кликабельные материалы у репетитора (`LessonMaterialsPanel`) — PDF подписывается клиентом (`createSignedUrls`, RU-safe `api.sokratai.ru`, bucket `lesson-materials` имеет `tutor read own`), чип ДЗ → `/tutor/homework/:id`. Не зависит от миграции.
- **Phase 2 (отложено):** экран управления группами (создать/переименовать/удалить/состав, `sort_order`) + массовое выделение (галочки → архив/метка/ДЗ).

Build-лог: memory `project_student_groups_tags_2026_06_18.md`. План `~/.claude/plans/crispy-soaring-lobster.md`.

## Ручная цена при создании + единый перенос серии + личные дела (запросы Егора/др., 2026-06-19)

Три группы по календарю `/tutor/schedule`. НЕ задеплоено. Миграция `20260620120000_tutor_calendar_events.sql` (только Группа C). План `~/.claude/plans/1-recursive-bentley.md`. Build-лог: memory `project_schedule_cost_move_events_2026_06_19.md`.

### A — ручная цена занятия при создании (money-critical)
- `AddLessonDialog` (`TutorSchedule.tsx`): поле «Стоимость, ₽» (индивид. — одно; группа — по каждому участнику), **предзаполняется последней ценой ученика**, редактируемо. `0`=waive, пусто=derived. `parseLessonPriceInput` (распознаёт `0`, в отличие от `parseRubleAmount`).
- Бэкенд дебета НЕ менялся: списание читает `COALESCE(participant.payment_amount, lesson.payment_amount, ставка×длит)` в `_apply_lesson_debit_from_current_cost` (Phase 2b). Поэтому запись `payment_amount` при создании = цена списания (рубли).
- **Write-path (rule 40, оба):** `CreateLessonInput.payment_amount` + `createLessonSeries` копирует его в КАЖДЫЙ повтор (иначе цена только в корне); `MiniGroupCreateMember.overrideAmount ?? derived` в `createMiniGroupLesson` (серия прокидывает member во все повторы).
- **`getLastLessonPriceForStudent` (`tutorSchedule.ts`)** — последняя цена для предзаполнения: **ТОЛЬКО `payment_amount > 0` И НЕ `cancelled`** (review P0×2; иначе waived-0 заморозил бы «не списывать», а отменённое дало бы неверный дефолт). Индивид. + групповой источник, самое позднее по `start_at`, best-effort (ошибка→null).
- **Семантика freeze (решение владельца):** показанная цена замораживается в `payment_amount` (WYSIWYG; смена ставки потом НЕ влияет на созданные занятия — «цена на год»). `priceTouchedRef` — поздний async-prefill не затирает уже введённую тутором цену (review P1).

### B — единый перенос серии со scope (frontend-only)
- Drag занятия из серии (индивид. **и** unified-группа, общий `handleLessonDrop`) → диалог «Только это / Это и последующие / Вся серия» (Google Calendar). `this`→`updateLesson(start_at)`; следующие/вся→`updateLessonSeries({applyTimeShift, shiftMinutes, scope})` (RPC `update_lesson_series` уже умеет time-shift). Кнопка «Перенести группу» — тот же scope (`doMoveGroup`).
- **Money-guard переноса (review P1 #5, интерим):** прошедшие booked-занятия/группы **НЕ перетаскиваются** (`isDraggable && !isPast` в `LessonBlock`/`GroupLessonBlock` + defensive-guard в `handleLessonDrop` + guard на кнопке группы), а **scope='all' клампится к `now`** через `updateLessonSeries({fromStartAtOverride})` — перенос серии НЕ сдвигает уже прошедшее занятие (иначе past→future оставил бы висящий debit). Полный money-aware reconcile переноса (reverse/reapply под lock) — follow-up под v2 balance.

### C — личные дела (busy blocks), таблица `tutor_calendar_events`
- Схема: `tutor_id→tutors.id` (FK-дрейф как у занятий), `start_at`, `duration_min`, `title`, `notes`, `is_recurring`, `recurrence_rule 'weekly'`, `parent_event_id` (self-FK) — серийная модель зеркалит занятия (тот же 3-way scope). RLS tutor-owns-own, **GRANT только authenticated, БЕЗ anon-grant и публичной SELECT-политики** (anti-leak).
- RPC `tutor_delete_calendar_events(_event_id,_scope)` (зеркало `tutor_delete_lessons` минус money-guard, с re-parent серии) + `update_calendar_event_series(...)` (зеркало `update_lesson_series`).
- **Скрытие из публичной записи (anti-leak ключевое):** `CREATE OR REPLACE` `get_available_booking_slots` + `book_lesson_slot` — добавлен второй `EXISTS` против `tutor_calendar_events` (CTE `booked` + conflict-check брони). Обе SECURITY DEFINER → читают время событий в обход RLS, наружу отдают **только `is_booked`/uuid** (title/notes не проецируются, anon-grant не нужен).
- Клиент `src/lib/tutorCalendarEvents.ts` (CRUD/series/чистый `findConflicts`), хук `useTutorCalendarEvents` (key `['tutor','calendar-events',...]`), `CalendarEventBlock` (штрихованный, `z-0` под занятиями), `AddEventDialog`/`EventDetailsDialog` (drag+правка+удаление со scope). **`db = supabase as unknown as {...}` escape-hatch** — types.ts ещё без таблицы/RPC (регенерация Lovable после миграции).
- **Детект конфликтов (мягко):** амбер-баннер в `AddLessonDialog` при наложении на личное дело **или другое занятие** (новое — раньше lesson↔lesson не проверялось). НЕ блокирует создание (решение владельца). Публичная запись — жёстко скрыта server-side.

### Известные follow-ups (пред-существующее, не блокеры)
- `book_lesson_slot` не валидирует availability/exception/min_notice (пред-существующий зазор публичной брони) — отдельный hardening-PR.
- Событие/занятие через полночь: `start_at::date = slot_date` пропускает overlap (book_lesson_slot ловит fallback'ом) — range-overlap фиксить заодно для занятий.

**Deploy:** миграция ПЕРВОЙ (Lovable на push — фронт C зависит от таблицы+booking-RPC) → регенерация `types.ts` → `deploy-sokratai`. Группа A опирается на задеплоенный Phase 2b. Manual QA (money/Safari/конструктор расписания high-risk) перед прод-анонсом.

Build-лог: memory `project_schedule_cost_move_events_2026_06_19.md`.

## DateTimeField + roster-driven «ученик во все будущие занятия группы» (запросы Елены, 2026-07-02)

P0-разблокировка: (1) единый пикер даты/времени (native `datetime-local` не давал ставить минуты/19:00), (2) добавление ученика во все будущие занятия группы (добавление в состав группы не долетало до серии). НЕ задеплоено. Миграция `20260702130000`. План `~/.claude/plans/1-1-lexical-stallman.md`. Build-лог: memory `project_tutor_datetime_group_p0_2026_07_02.md`.

### Единый `DateTimeField` (см. также rule 90)
`src/components/ui/date-time-field.tsx` — **drop-in замена native `<input type="datetime-local">`**: публичный контракт значения = локальная строка `YYYY-MM-DDTHH:mm` (`''`=пусто), поэтому существующие конвертеры (`fromDateTimeLocalValue`/`toDateTimeLocalValue`, `parseDeadlineInput`, `toLocalDatetimeString`, `meta.deadline`) НЕ тронуты. Календарь (reuse `ui/calendar`, RU) + время **шаг 15 мин** (список слотов 00:00–23:45 + ручной ввод `HH:MM`, snap на blur). Rule 80: без native `type=time`/`datetime-local`, без `new Date("строка")` (ручной сплит), 16px, `touch-action`. Применён: `TutorSchedule` group-move + дедлайны ДЗ/пробников. `AddLessonDialog`/`AddEventDialog`/`EventDetailsDialog` пока на своём Calendar+15-мин-Select (консолидация на общий TimeField отложена).

### Roster-driven пропагация состава
- **RPC `tutor_add_student_to_group_future_lessons(_tutor_group_id, _tutor_student_id)`** (миграция `20260702130000`, зеркало `20260604140000`): добавляет ученика во ВСЕ future booked unified-занятия группы (`group_source_tutor_group_id=group AND status='booked' AND start_at>=now() AND group_session_id NOT NULL`), идемпотентно (`NOT EXISTS`+`ON CONFLICT DO NOTHING`). SECURITY DEFINER; ownership `tutor_groups.tutor_id→tutors.id` (`NOT_OWNED`); **is_primary guard** (`NOT_LEARNING_GROUP` — тег не хостит занятия); student-validation (`INVALID_STUDENT`); advisory-lock. **Деньги: только строки участников — НИ ledger, НИ payments** (дебет будущих занятий возникает при завершении, не при add); `payment_amount` РУБЛИ per-lesson `GREATEST(ROUND((dur/60)*(rate/100)),0)`, NULL/0 rate → 0 (waive, ученик добавлен). Пересчёт `group_size_snapshot`. Return `{ok, added_count, future_count}`. Клиент `addStudentToGroupFutureLessons`/`countGroupFutureLessons` (`tutorScheduleGroupCreate.ts`, RPC-имя `as never` до регена types).
- **3 поверхности** (общий `AddToGroupLessonsPrompt`): `AddStudentDialog` single-add (finalize/credentials отложены через `finalizeAfterAdd`; bulk — не трогали); `TutorStudentProfile` (гейт: prompt ТОЛЬКО при реальной смене primary-группы, иначе несвязанный сейв нудит+молча создаёт обязательства); schedule `GroupDetailsDialog` scope-Select `this`/`future` (**reset на смену `bucket?.key`** — иначе scope залипает и создаёт обязательства на след. группе). Cache: `invalidateGroupRosterCaches` (`tutorStudentCacheSync.ts`; schedule-путь — через parent `onActionApplied` = refetchLessons+invalidateBalanceCaches). Модель roster-driven (владелец): добавил в группу → предложить занятия. Remove-из-серии + roster→новые-серии + страница групп + терминология «Группа/Метка» — **v2**.

### ⚠️ RLS `tutor_lesson_participants` НЕ write-protected (КРИТИЧНО — hardening pending)
Таблица **ИМЕЕТ клиентские INSERT/UPDATE/DELETE RLS-политики** (`20260224123937` строки 46/51/56, `WITH CHECK owns_lesson`, никогда не дропались) → тутор может писать участников (вкл. произвольный `payment_amount`) напрямую PostgREST в обход RPC-гардов. **НЕ считать таблицу «RPC-only write».** `createMiniGroupLesson` (`tutorScheduleGroupCreate.ts`) полагается на INSERT-политику. Bypass ограничен своими занятиями (`owns_lesson`, не cross-tenant; тутор и так ставит цены) → низкий риск, не блокер. Комментарий «no client write policy» в `20260604140000` **устарел — не верить.** Hardening (drop политик + insert через SECURITY DEFINER RPC) — отдельная money-critical задача.
