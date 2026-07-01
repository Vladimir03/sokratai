# Claude Code brief — Онбординг-активация v2 (хэндофф репетитор → ученик)

**Статус:** для реализации · **Версия:** v0.1 · **Дата:** 2026-06-26
**Что читать перед кодом (в этом порядке):**
1. `discovery-and-prd.md` — контракт фичи (Job Context, флоу, AC, RAT, метрики §7.2).
2. `mockups-brief.html` — состояния экранов (mid-fi). ⚠️ По таймингу регистрации смотри `design/*.dc.html`: регистрация обязательна ДО задачи (обновление 2026-06-26).
3. `design/*.dc.html` — hi-fi из Claude Design (дерево компонентов, токены, лэйаут).
4. Правила: `.claude/rules/60-telegram-bot.md`, `96-auth-ru-bypass.md`, `97-edge-function-error-contract.md`, `40-homework-system.md`, `99-ai-quota-subscriptions.md`, `95-production-deploy.md`, `90-design-system.md`.

---

## ⚠️ Главный принцип: REUSE, не REBUILD

Бóльшая часть того, что дизайн-хэндофф называет «спроектируй недостающее», **уже работает в репозитории**. НЕ переписывать. Эта фича — тонкий слой поверх существующего: добавление по имени, проводка подключения и беспарольного входа, обязательная регистрация до задачи, телеметрия.

| Уже есть (НЕ переписывать) | Где живёт | Как использовать в этой фиче |
|---|---|---|
| Конструктор ДЗ | `src/pages/tutor/TutorHomeworkCreate.tsx`, таблицы `homework_tutor_*`, edge `homework-api` | ДЗ создаётся как сейчас; онбординг лишь проводит выдачу и доставку |
| Реальное ДЗ + AI-проверка + guided chat | student problem screen (`/student/homework/:id/problem/:taskId`, `HomeworkProblem.tsx`), `homework-api`, `guided_ai.ts` | ученик попадает в **существующий** экран задачи |
| Инвайт / claim | `supabase/functions/claim-invite`, `invite-preview`, `src/pages/InvitePage.tsx`, `src/lib/inviteApi.ts`, `src/utils/telegramLinks.ts` | расширять, не заменять |
| Минтинг сессии (RU-bypass) | `supabase/functions/email-verify`, rule 96 | тем же паттерном минтить сессию по claim-токену |
| Статус активации ученика | `registration-onboarding` (Sprint 1), карточка ученика | переиспользовать «подключился / не подключился» |
| Доставка (push→telegram→email) | `homework-api` notify, `_shared/push-sender.ts`, email-шаблоны | доставка приглашения + ДЗ |
| Persistent session | Supabase (default) | повседневный вход без ввода |
| Паттерн телеметрии | `src/lib/homeworkTelemetry.ts` | расширить онбординг-событиями (§7.2) |
| Код инвайта | RPC `tutor_get_invite_code`, `getTutorInvitePreviewLink` | ссылка/QR/код для подключения |

---

## Реальная дельта (что строим и меняем) + точки интеграции

1. **Добавление по имени.** `AddStudentDialog.tsx` — имя обязательно, контакт опционален; bulk-список имён. Edge `tutor-manual-add-student` — снять обязательность контакта. **Синхронно обновить rule 60.** Плейсхолдер = `tutor_students` с контактом `NULL`. (Следить за AI-квотой, rule 99.)
2. **Share-gate (одноразовая модалка «Подключить ученика»).** Новый компонент (напр. `ConnectStudentSheet.tsx`). Триггер — в assign/notify пути `homework-api` при первой отправке ДЗ ученику **без канала и без claim**: backend возвращает `students_without_channel` (зеркало существующего `students_without_telegram_names` в `handleAssignStudents`/`handleQuickAssignStudentsWithNotify`, rule 40), фронт открывает sheet. 2 способа: QR + ссылка (reuse `getTutorInvitePreviewLink` + `tutor_get_invite_code`); вторым планом «отправить на email/Telegram» (captures канал + шлёт приглашение+ДЗ). **После подключения гейт не появляется** — отправка молча, как сейчас.
3. **Claim → сессия → «подключён» + превью.** `claim-invite` минтит сессию (беспарольно, паттерн `email-verify`) + per-student токен авто-привязывает без апрува. `InvitePage.tsx` после claim ведёт на экран «вы подключены к {репетитор}» + превью задания → **регистрация (п.5)** → задача (`/student/homework/:id/problem/:taskId`, reuse резолвера `current_task_id → first-unfinished → first by order_num`; иначе `/student/schedule`). Видимая обратная связь о привязке (фикс тихого claim, F3). **НЕ редиректить сразу в задачу мимо регистрации.**
4. **Беспарольный первый вход + persistent session.** Claim-ссылка минтит сессию (паттерн `email-verify`); **на claim-пути убрать обязательную доставку 4-значного пароля** (модель Sprint 1 остаётся для legacy). Persistent session — повседневный вход без ввода.
5. **Обязательная регистрация ДО задачи (решение 2026-06-26).** Флоу: вход по ссылке → «ты подключён» + превью задания → **экран регистрации** → задача. Регистрация: email (подставлен репетитором, если есть; иначе вводит ученик) + пароль (ученик задаёт). **Без «Позже», без верификации.** Причина мягкая — «чтобы не потерять прогресс». Регистрация = доустановка пароля поверх уже активной сессии (ссылку **не** хард-блокируем; гейт в UI). Wiring между «подключён» и задачей (`InvitePage.tsx` / редирект). **Экран «сохрани доступ» после ДЗ — убран.** **Механика:** `supabase.auth.updateUser({ email, password })` поверх существующей claim-сессии — НЕ новый `signUp` (пользователь уже создан claim'ом). Предзаполнять email только реальный; `@temp.sokratai.ru`/фейковые считать пустыми (ученик вводит свой).
5b. **Автосейв прогресса по токену.** Прогресс в задаче сохраняется по токену/сессии и не теряется, даже если ученик бросил до завершения (требование к `HomeworkProblem`).
6. **Вход с нового устройства + OTP.** Экран входа ученика: email + пароль, либо «войти по коду» (OTP/magic-link на email; короткоживущий). Фолбэк при отсутствии канала: «попроси у репетитора новую ссылку». **RU-трап (rule 96):** OTP/magic-link слать через RU-safe email-пайплайн (паттерн `email-verify` / `api.sokratai.ru`), НЕ дефолтные Supabase magic-link URL — они ведут на заблокированный в РФ `*.supabase.co`.
7. **Nudge на карточке ученика (репетитор).** Статус «не подключился» + «добавьте email или Telegram, чтобы ученик мог входить с любого устройства».
8. **Телеметрия-воронка.** Новая таблица `analytics_events` (миграция + RLS + регенерация `types.ts`; Supabase, queryable + JOIN) + серверные события §7.2: `tutor_first_student_added`, `invite_generated`, `invite_claimed`, `tutor_first_homework_created`, `homework_sent_to_student`, `student_received_and_opened` (cross-side «ага»), `student_first_login`, `student_first_homework_opened`, `student_first_submission`. PII-free, паттерн `homeworkTelemetry.ts`. **Не** Yandex Metrica (она остаётся только под лендинг).

---

## Инварианты (обязательны)

- **rule 60** — обновить синхронно с кодом: «минимум для добавления — имя; канал требуется до первой отправки ДЗ».
- **rule 96** — claim-токен **одноразовый / короткоживущий** (НЕ вечный bearer-login: пересланная ссылка не должна давать постоянный доступ). Сессию минтит edge server-side. `INITIAL_SESSION`-guard в `AuthGuard`. Exact allow-list tutor-role не трогать. Не логировать токены/PII.
- **rule 97** — edge-ошибки flat-shape `{ error: "<рус>", code }`; client через `extractEdgeFunctionError`.
- **rule 40** — если трогаешь `homework_tutor_tasks`/`assignments` — оба write-path. (Онбординг их в основном НЕ создаёт — выдача reuse существующих эндпоинтов.) Два assign-эндпоинта — править оба при изменении инварианта.
- **rule 99** — добавление по имени множит бесплатных учеников → следить за AI-квотой (`get_subscription_status`).
- **rule 95** — edge деплоит Lovable на push; фронт через `deploy-sokratai` (VPS). После фронт-изменений — блок «Deploy needed».
- **Anti-leak** — student-facing эндпоинты column-whitelist; не отдавать tutor-only поля. Новый student-fetch — через service_role edge, не direct PostgREST с RLS.
- **rule 90** — один primary-CTA на экран; sentence case; иконки Lucide; инпуты ≥16px (iOS, rule 80); без эмодзи/градиентов/теней; `data-sokrat-mode="tutor"|"student"`.
- **Автосейв прогресса по токену** — `HomeworkProblem` сохраняет прогресс по токену/сессии; прогресс не теряется при незавершённой задаче.

---

## Что НЕ делать

- НЕ строить новый конструктор ДЗ / новую систему ДЗ / новый guided chat / новую AI-проверку — всё это есть.
- НЕ возрождать legacy homework (`homework_sets`, classic mode) — дропнуто (rule 40).
- НЕ делать вечную login-ссылку (bearer-риск, rule 96).
- НЕ требовать контакт при добавлении ученика репетитором. (Регистрация ученика — обязательна ДО задачи, решение 2026-06-26; ссылку при этом **не** хард-блокировать — сессия минтится, гейт в UI.)
- НЕ телефон (только email); НЕ SMS-канал (P1+).
- НЕ класть продуктовую воронку в Yandex Metrica.

---

## Acceptance criteria + деплой

AC — в `tasks.md` (T1–T10) и `discovery-and-prd.md` §10 (AC-1..AC-8 + auth). Перед мержем: `npm run lint && npm run build && npm run smoke-check`. Constructor-зону (rule 40 QA-checklist) не задеть. Edge — Lovable; фронт — `deploy-sokratai`.

---

## Paste-ready инструкция для Claude Code (одно сообщение)

```
Реализуй фичу «Онбординг-активация v2 (хэндофф репетитор→ученик)» в этом репозитории.

Сначала прочитай: docs/delivery/features/onboarding-activation-v2/discovery-and-prd.md (контракт),
mockups-brief.html и design/*.dc.html (состояния экранов, дерево компонентов, токены),
и правила .claude/rules/{60,96,97,40,99,95,90}.

ГЛАВНЫЙ ПРИНЦИП: переиспользовать существующее, НЕ переписывать. Конструктор ДЗ
(TutorHomeworkCreate + homework_tutor_*), реальное ДЗ + AI-проверка + guided chat,
claim-invite/invite-preview/email-verify, registration-onboarding, notify-каскад —
УЖЕ работают. Карта переиспользования — в claude-code-brief.md.

Построить только дельту (точки интеграции — в брифе):
1. Добавление ученика по имени (контакт опционален) + bulk; ослабить rule 60 + edge tutor-manual-add-student.
2. Одноразовый share-gate «Подключить ученика» (QR + ссылка + отправить на email/Telegram);
   триггер в assign/notify пути homework-api (вернуть students_without_channel, зеркало
   students_without_telegram_names); reuse getTutorInvitePreviewLink + tutor_get_invite_code.
3. claim-invite минтит сессию (беспарольно, паттерн email-verify) → экран «подключён» + превью
   → регистрация (см. п.5) → задача (/student/homework/:id/problem/:taskId). НЕ редиректить мимо регистрации. Видимая привязка.
4. Persistent session для повседневного входа.
5. Обязательная регистрация ДО задачи: ссылка → «ты подключён» + превью → экран email(подставлен репетитором)+пароль (без «Позже»/верификации) → задача. Автосейв прогресса по токену. Экран «сохрани доступ» после ДЗ не делать.
6. Вход с нового устройства: email+пароль + «войти по коду» (OTP/magic-link на email).
7. Nudge на карточке ученика «добавьте email/Telegram».
8. Серверная телеметрия: таблица analytics_events + события §7.2 (не Yandex Metrica).

Инварианты (строго): rule 96 — claim-токен одноразовый/короткоживущий, НЕ вечный bearer-login,
сессию минтит edge; rule 97 — edge-ошибки {error рус, code}; rule 90 — один primary-CTA,
data-sokrat-mode, инпуты ≥16px; anti-leak — column-whitelist на student-эндпоинтах; только email,
без телефона/SMS. НЕ строить новый конструктор ДЗ / новую систему ДЗ / вечную login-ссылку.

Перед мержем: npm run lint && build && smoke-check. После фронт-изменений добавь блок «Deploy needed»
(rule 95): edge — Lovable на push, фронт — deploy-sokratai на VPS.
```
