# Spec: «Виды работ» — режим «Самостоятельная» (минимальный срез Фазы 1, Т1–Т6)

Источник: [prd.md](./prd.md) (Т1–Т6). Задачи: [tasks.md](./tasks.md).
Статус: **минимальный срез для пилот-проверки фатального RAT R1** («ученики открывают и сдают самостоятельные не хуже ДЗ»). Всё, что не в скоупе среза, — в §10 «Отложено».

---

## Section 0: Job Context

- **Core Job (Т-СР):** «Когда тема пройдена, я хочу назначать ученику работу с нужной мне степенью участия AI — от тренировки с подсказками до среза без помощи — и видеть по каждой форме честную оценку, чтобы понимать, что ученик умеет САМ, а не с AI». Источник: `docs/discovery/research/11-ajtbd-users-jobs-segments-nmt-2026-07.md` §2.1 (бэклог #39, ранг 3).
- **Big Job:** С1 — «разорвать связь "доход = часы"»; С2 — «одна платформа для школы».
- **Wedge:** расширяет ядро «самостоятельная работа учеников между уроками», убивает причину держать CloudText/OnlineTestPad; AI-вывод заканчивается действием репетитора (назначить / посмотреть результат).
- **Aha-моменты:** репетитор — первый открытый результат самостоятельной («вижу, что умеет сам»); ученик — экран «Результат работы» с «X из Y» сразу после сдачи.

## 1. Скоуп среза

**В скоупе (Т1–Т6):**
1. Т1 — колонка `work_mode` на назначении и шаблоне, все write-paths.
2. Т2 — сегмент-контрол «Вид работы» в L0 конструктора + лок после первой сдачи.
3. Т3 — серверное отключение AI (hint / check / student-chat / бутстрап) + скрытие входов в UI.
4. Т4 — одна попытка на задачу, без деградации балла.
5. Т5 — state-aware сдача: проверка сразу (репетитор видит live), ученику — только после завершения работы; кнопка «Сдать работу» + автозавершение.
6. Т6 — экран ученика «Результат работы» (новый), включается и для обычной домашки по завершению.

**Не в скоупе (см. §10):** Т7 (% самостоятельности), Т8 (бейджи вида работы в списках/уведомлениях), Т9 (настройка момента разбора), Фаза 2 (сводка ошибок), таймер, запрет после дедлайна.

## 2. Модель данных

Миграция `20260724150000_homework_work_mode.sql` (additive, идемпотентная):

```sql
ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'homework'
  CHECK (work_mode IN ('homework','independent'));

ALTER TABLE public.homework_tutor_templates
  ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'homework'
  CHECK (work_mode IN ('homework','independent'));
```

- `DEFAULT 'homework'` покрывает ВСЕ существующие строки и все write-paths, не знающие о поле (HWDrawer path B **намеренно не пишет** `work_mode` → DB default; из корзины БЗ самостоятельную создать нельзя — осознанно, v1).
- Колонка student-safe (не вердикт): на `homework_tutor_assignments` нет column-GRANT whitelist (проверено — только table-level + RLS), поле автоматически читаемо учеником. Это нужно (клиентский гейт UI).

### 2.1 Anti-leak на уровне БД (Critical-кейс №3 PRD)

Факт разведки: student SELECT-политики (`20260306100000`) на `homework_tutor_thread_messages` / `homework_tutor_task_states` дают ученику **прямой PostgREST-доступ** к `ai_score`, `earned_score` и `check_result`-сообщениям своего треда — серверный strip в edge из консоли обходится. Для домашки это не было проблемой (ученик и так видит вердикты сразу); для самостоятельной это компрометирует срез.

Та же миграция добавляет (паттерн state-aware из rule 45, **additive** — существующие политики не трогаем):

```sql
CREATE OR REPLACE FUNCTION public.hw_thread_verdicts_visible(_thread_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM homework_tutor_threads t
    JOIN homework_tutor_student_assignments sa ON sa.id = t.student_assignment_id
    JOIN homework_tutor_assignments a ON a.id = sa.assignment_id
    WHERE t.id = _thread_id
      AND (a.work_mode <> 'independent' OR t.status = 'completed' OR a.tutor_id = auth.uid())
  );
$$;
-- тройной REVOKE + GRANT authenticated/service_role (инвариант rule 99)

CREATE POLICY hw_independent_verdict_block_messages
  ON public.homework_tutor_thread_messages AS RESTRICTIVE FOR SELECT TO authenticated
  USING (role IN ('user','tutor') OR public.hw_thread_verdicts_visible(thread_id));

CREATE POLICY hw_independent_verdict_block_task_states
  ON public.homework_tutor_task_states AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.hw_thread_verdicts_visible(thread_id));
```

- RESTRICTIVE **AND-ится** с существующими permissive-политиками → правки существующих не нужны.
- Репетитор-владелец проходит через ветку `a.tutor_id = auth.uid()` (его прямые PostgREST-чтения — `useTutorReviewQueue`, `useTutorStudentActivity`, realtime `GuidedThreadViewer` — не задеты).
- Ученик в самостоятельной до завершения: свои `user`-сообщения и человеческие `tutor`-сообщения видит, `assistant`/`system`-строки и ВСЕ строки `task_states` — нет. UI ученика на прямой PostgREST к этим таблицам не ходит (проверено grep'ом) — весь UI-путь через edge (service_role, RLS bypass), поэтому политика ничего не ломает.
- service_role (все edge) — RLS bypass, не затронут.
- Известный pre-existing gap вне скоупа: `visible_to_student=false` tutor-заметки читаемы из консоли и сегодня — не трогаем.

> ⚠️ **Security-adjacent:** новые RLS-политики — единственное изменение в security-слое; additive, но требует явного внимания на ревью владельца.

## 3. Backend — homework-api (`supabase/functions/homework-api/index.ts`)

### 3.1 Write/read plumbing `work_mode` (Т1)

| Точка | Строка (ориентир) | Действие |
|---|---|---|
| `handleCreateAssignment` валидация | ~1117 (рядом с exam_type) | `b.work_mode` ∈ enum, иначе 400 |
| `handleCreateAssignment` INSERT | ~1219–1240 | `work_mode: normalized ?? 'homework'` |
| `save_as_template` INSERT | ~1347–1361 | `work_mode` из создаваемого ДЗ |
| `handleUpdateAssignment` patch | ~2022–2076 | `if (b.work_mode !== undefined)` валидация + лок (§3.2) |
| `handleListAssignments` SELECT | ~1447–1450 | + `work_mode` (задел под Т8, поле уходит клиенту) |
| `handleGetAssignment` | `SELECT *` | автоматом; правок нет |
| `handleGetStudentAssignment` whitelist | ~8518 | + `work_mode` |
| `handleGetStudentProblem` assignment SELECT | ~8662 | + `work_mode`; в ответ `assignment.work_mode` |
| `handleCreateTemplateFromAssignment` INSERT + `TEMPLATE_RETURN_SELECT` | ~5891, 5910–5932 | + `work_mode` (из assignment) |
| `handleCreateTemplate` (legacy, обе ветви) | ~5412, ~5482 | optional `b.work_mode`, default 'homework' |
| `handleForkTemplate` явный column-list | ~5656–5672 | + `work_mode` (иначе форк теряет вид) |
| GET /templates/:id | `SELECT *` | автоматом |

### 3.2 Лок смены вида после первой сдачи (Т2, сервер)

- Хелпер `assignmentHasStudentInteractions(db, assignmentId)` — извлечь существующую детекцию `hasSubmissions` (~2171–2193: SA → threads → count `role='user'` messages) и переиспользовать в двух местах (ветка задач + гейт work_mode).
- В `handleUpdateAssignment`: если `b.work_mode !== undefined` и отличается от текущего → проверка; при interactions → **409 `WORK_MODE_LOCKED`** «Вид работы нельзя изменить: ученики уже начали работу».
- Семантика «первой сдачи» = существующая `has_interactions` (любое сообщение ученика) — строже PRD, зато совпадает с семантикой, которой клиент уже гейтит редактирование.

### 3.3 Серверное отключение AI (Т3)

Хелпер `getAssignmentWorkMode(db, assignmentId): Promise<'homework'|'independent'>` (точечный SELECT). Гейты — **403 `INDEPENDENT_AI_DISABLED`** («В самостоятельной работе подсказки и чат с Сократом недоступны») через существующий `jsonError` (формат `{error:{code,message}}`):

1. `handleRequestHint` (~10715) — сразу после `verifyThreadOwnership` + completed-check, **ДО `checkAiQuota`** (иначе спишется квота).
2. `handleCheckAnswer` (~10030) — аналогично, до квоты.
3. `handlePostThreadMessage` (~8979, student-путь) — блок для всех `role='user'` записей (чат-ввода в самостоятельной нет; сдача идёт отдельным эндпоинтом). Tutor-путь `handleTutorPostMessage` НЕ трогаем — репетитор может писать ученику.
4. `chat/index.ts::processAIRequest` — guided-ветка: добавить `work_mode` в server-side SELECT assignment (~1362–1367); при `independent` → ранний **403 JSON** до LLM (образец fail-closed «task_image_missing» ~1591). Покрывает и discussion, и bootstrap-интро (интро — тот же `/chat`).

Anti-tamper-инвариант: защита не зависит от клиента (deploy-skew кейс №11 PRD — старый бандл получает 403 с русской фразой).

### 3.4 Сдача задачи в самостоятельной (Т4 + Т5)

`handleStudentSubmission` (~10275), ветвление по `assignment.work_mode` (добавить в SELECT ~10459 **и** сделать доступным до квоты — перенести/продублировать SELECT `work_mode` раньше):

- **Одна попытка:** если `task_state.status === 'completed'` для целевой задачи → **409 `TASK_ALREADY_SUBMITTED`** («Ответ уже сдан»). Тред `completed` → существующий 409. `CHECK_FAILED` оставляет задачу active → попытка не сгорает (ученик пересдаёт).
- **Квота:** `checkAiQuota` для independent **не вызывается** (анти-требование PRD; AI-грейдинг остаётся, но квоту сообщений не расходует). Токены логируются как раньше (`token_usage_logs`, source не меняется).
- **Грейдинг без штрафов + forced-close** — новый флаг `independentMode: true` в `runStudentAnswerGrading`:
  - CORRECT: как сейчас (available = max — подсказок/повторов нет) → completed + advance.
  - ON_TRACK / INCORRECT: **вместо** веток с `computeAvailableScore`-деградацией → `status='completed'`, `earned_score = effectiveAiScore ?? 0`, `available_score` не деградирует, `ai_score`/`ai_score_comment`/`ai_criteria_json`/`ai_nodes_json` пишутся как обычно (репетитор видит всё) → `performTaskAdvance` (закрытие последней задачи выставляет `thread.status='completed'` — это и есть автозавершение Т5).
  - CHECK_FAILED: как сейчас (задача не закрывается).
  - Инвариант Т4: `final_score` задачи = результат проверки, `computeAvailableScore` в самостоятельной не применяется никогда.
- **Приглушённый ответ (Т5):** до завершения треда independent-ответ НЕ содержит `verdict`/`feedback`/баллов/criteria/flowchart: `{ independent: true, task_completed, check_failed?, thread_completed, next_task_order, next_task_id, total_tasks, thread }`. `check_failed: true` = сбой AI-проверки (не вердикт!) — задача осталась active, клиент просит отправить ещё раз. `thread` уже проходит через strip §3.5, поэтому: тред ещё активен → пусто; сдача последней задачи завершила тред → полный reveal в том же ответе.
- **Numeric-задачи (клиент):** inline-ответ в `HomeworkProblem` для independent маршрутизируется в `POST .../submission` (`submitSolution`), НЕ в legacy `POST /threads/:id/check` (тот 403-гейтится) — одна попытка и state-aware reveal работают для всех task_kind единообразно.

#### 3.4a Ревью-фиксы раунда 1 (ChatGPT-5.6, 2026-07-24) — НЕ откатывать

- **`GET /threads/:id` (legacy) идёт через `fetchStudentThread`.** Он читал `THREAD_SELECT` напрямую и обходил independent-strip: ученик знает свой `threadId` из problem-ответа и до завершения работы читал этим роутом `check_result`/`ai_score`/`earned_score`/criteria. **Инвариант: любой student-facing путь чтения треда — только через `fetchStudentThread`.**
- **`POST /threads/:id/advance` — RETIRED (410).** Guard требовал лишь ≥1 assistant-сообщения (а AI-интро создаётся само), после чего `performTaskAdvance` ставил `status='completed'` без баллов → `computeFinalScore` отдаёт **max**. Клиент роут не вызывал (`advanceTask` без call-site'ов с Phase 3 cutover). Дыра была и в обычной домашке. **Client-controlled advance не возрождать: любой путь, закрывающий задачу, обязан писать балл явно.**
- **`fetchStudentThread(db, id, { workMode })` — параметр ОБЯЗАТЕЛЬНЫЙ.** Раньше опциональный с fallback-резолвом и fail-closed трактовкой сбоя как `independent` — транзиентная ошибка опустошала чат ОБЫЧНОЙ домашки. Теперь режим резолвит вызыватель (он и так грузит assignment); check/hint передают `'homework'` явно (эти пути 403-гейтятся выше).
- **Атомарный claim попытки (Т4).** Conditional UPDATE `WHERE id=… AND status='active' AND attempts=N` перед AI-вызовом; проигравшие → 409. Без него два параллельных сабмита оба видели `active` (проверка — read, AI длится десятки секунд), оба грейдились, второй перетирал балл = вторая попытка + дублирующий неквотируемый AI-вызов.
- **Сбой персиста балла не продвигает задачу.** UPDATE в `independentMode`-ветке проверяет `error` и бросает; `handleStudentSubmission` ловит → 500 `GRADING_FAILED`, задача остаётся `active`. Иначе `performTaskAdvance` закрывал её без баллов → **max вместо 0** на INCORRECT.
- **`performTaskAdvance` не воскрешает завершённый тред** (`.eq("status","active")` на UPDATE курсора) — поздний грейдинг после «Сдать работу» не сбрасывал бы `status`/`current_task_id`.
- **RLS-helper знает админа.** `hw_thread_verdicts_visible` содержит ветку `has_role('admin') OR is_admin_email` — RESTRICTIVE AND-ится с permissive «Admin select …» (`20260320154843`), без неё админка теряла task_states и assistant-сообщения на активных самостоятельных.
- **`chat/index.ts`: work_mode-preflight ДО квоты** — гейт внутри `processAIRequest` отбивал запрос уже после инкремента лимита (старый бандл сжигал квоту ученика).
- **Редирект на результат — строго по `thread.status='completed'`.** «Все task_states completed при активном треде» вело на result → «не завершена» → «Продолжить» → detail → петля; такой рассинхрон открывает последнюю задачу read-only, как до Т6.
- **Live-скоринг у репетитора НЕ делаем через realtime-invalidate (отклонено осознанно).** Ревью просило обновлять балл в открытом `GuidedThreadViewer`. Пробный `invalidateQueries` на INSERT `check_result` откачен: `homework_tutor_task_states` отсутствует в publication `supabase_realtime` (там только `thread_messages`), а invalidate из realtime прямо запрещён rule 40 (merge-helper → иначе фликер ленты + лишние запросы). Фактическое поведение: сообщение-вердикт прилетает live, балл/статус — при обновлении страницы; деталка и heatmap показывают результаты по мере сдач при загрузке. Полноценный live-скоринг = миграция publication + подписка на UPDATE `task_states` — отдельная задача, не в срезе.

### 3.4b Ревью-фиксы раунда 2 (ChatGPT-5.6, 2026-07-24) — НЕ откатывать

- **Ветка `CORRECT` тоже проверяет персист балла.** Сбой UPDATE игнорировался, `performTaskAdvance` всё равно закрывал задачу → `computeFinalScore` = **max**. Для criteria-grading это порча балла (cascade К1=0 → earned 14/22, после сбоя 22/22). Теперь: `error` → `throw` → 500 `GRADING_FAILED`, задача остаётся `active`. **Инвариант: любая ветка, вызывающая `performTaskAdvance`, обязана сначала убедиться, что балл записан.**
- **Победитель гонки finish ↔ поздний грейдинг определён: finish.** UPDATE балла (обе ветки) стал CAS-ом `.eq("status","active")`; 0 строк = задачу уже финализировал `finish`/tutor force-complete → advance пропускается, лог `homework_api_grade_superseded`, зафиксированный ученику итог не переписывается. Клиент дополнительно блокирует кнопку «Сдать работу» во время сдачи задачи (защита только своей вкладки).
- **Claim попытки компенсируется на технических выходах ДО AI** (`releaseIndependentClaim`): сбой подписи/скачивания/Whisper, пустой STT, сбой INSERT сообщения. После вызова модели компенсации нет намеренно (деньги потрачены + анти-retry-спам). Верхний предел — `INDEPENDENT_MAX_ATTEMPTS = 10` → 429 `TOO_MANY_ATTEMPTS` с русской фразой: квота AI в самостоятельной отключена, без капа повторяемый `CHECK_FAILED` = безлимитный неквотируемый вызов модели.
- **Лок вида работы fail-CLOSED.** `assignmentHasStudentInteractions` возвращает `boolean | null`; `null` (сбой любого из трёх SELECT) → 503 `WORK_MODE_CHECK_FAILED`. Раньше сбой читался как «интеракций нет» и позволял переключить вид у ДЗ с ответами учеников. Ветка задач (destructive changes) сохраняет прежнюю семантику через `?? false`.
- **Read-пути не трактуют сбой резолва как `independent`.** Введён `resolveAssignmentWorkMode` (`| null`); `GET /threads/:id` и `GET /assignments/:id/thread` при `null` → 500. Fail-closed `'independent'` (`getAssignmentWorkMode`) остался ТОЛЬКО для AI-гейтов. Иначе транзиентная ошибка вырезала бы вердикты из обычной домашки → пустой чат.
- **check/hint перечитывают режим перед ответом** вместо хардкода `'homework'` — репетитор мог переключить работу, пока шёл AI-вызов; тогда ученику нельзя отдавать вердикты (fail-closed на сбое резолва).
- **`chat`: preflight в ОБЕИХ ветках** (authenticated + service-role) через общий `independentWorkModeBlockResponse` — Telegram-бот тоже не должен жечь квоту перед 403.

- **`threadCompleted: false` при superseded** (само-проверка перед раундом 3): сначала я возвращал `true`, но задачу мог закрыть **tutor force-complete** при живых остальных задачах — ответ «работа завершена» увёл бы ученика с активной работы. Завершённость independent-ответ определяет по перечитанному `thread.status`, обычная домашка это поле не использует.

**Известные остаточные риски (приняты для пилота):**
- `handleStudentFinishWork` — два независимых UPDATE (states → thread) без транзакции. После CAS-фикса грейдинга худший исход — тред остался `active` при занулённых задачах: ученик видит плашку «Сдать работу» (0 без ответа) и повторяет — идемпотентно. Транзакционный RPC — следующая итерация.
- `INDEPENDENT_MAX_ATTEMPTS` достигается только 10 реальными AI-вызовами подряд с `CHECK_FAILED` (технические сбои до модели компенсируются). Выход для ученика — репетитор ставит балл вручную (`EditScoreDialog`) и закрывает задачу; reopen в самостоятельной недоступен by design.
- Смена вида работы не сериализована с первой сдачей (окно в доли секунды между гейтом и вставкой сообщения). Последствие — один вердикт, показанный в уже переключённой работе. Полная сериализация = RPC с блокировкой assignment, отложено.

### 3.4c Ревью-фиксы раунда 3 (ChatGPT-5.6, 2026-07-24) — НЕ откатывать

- **`handleCheckAnswer` ловит `GRADE_PERSIST_FAILED`.** Бросок из `runStudentAnswerGrading` (фикс P0 р.2) был обёрнут только в `handleStudentSubmission` — legacy numeric/check-путь падал в общий обработчик и отдавал generic «Internal server error» вместо русского `GRADING_FAILED` (нарушение rule 97). **Инвариант: помощник грейдинга бросает — КАЖДЫЙ его вызыватель обязан иметь свой catch с rule-97-контрактом.**
- **Компенсация claim — только pre-provider ошибки.** `MISSING_API_KEY` / `EMPTY_AUDIO` / `AUDIO_TOO_LARGE` бросаются в `_shared/voice-transcribe.ts` ДО fetch к Groq → попытку возвращаем. `TRANSCRIPTION_FAILED` и **пустой транскрипт при 200** — провайдер отработал и вызов оплачен → **НЕ компенсируем**: иначе отправка тишины по кругу = безлимитные оплаченные Whisper-вызовы в обход `INDEPENDENT_MAX_ATTEMPTS`.
- **`chat`-preflight fail-CLOSED**: `error || !data` → 503 `WORK_MODE_CHECK_FAILED` (русская фраза) ДО квоты. Раньше сбой lookup читался как «homework» → запрос проходил, квота списывалась, а при повторном сбое внутреннего гейта доходил до модели.
- **Payload при CAS-miss не расходится с БД** (`readTaskStateScoreSnapshot`): обе ветки при `superseded` возвращают фактические `earned_score`/`ai_score`/`available_score`/`task_completed` из строки + флаг `superseded: true`. Раньше отдавались вычисленные значения, которых в базе нет (их записал другой финализатор).

## 3.5 State-aware reveal ученику (Т5)

Единая точка — `fetchStudentThread` (~9284): новый шаг strip'а при `work_mode='independent' && thread.status !== 'completed'`:

- **messages:** оставить только `role IN ('user','tutor')` (submission-пузыри ученика и человеческие сообщения репетитора); `assistant`/`system` (включая `check_result`) — выкинуть.
- **task_states:** занулить `ai_score`, `earned_score`, `best_score`, `available_score`, `wrong_answer_count`, `tutor_score_override*`, `ai_criteria_json`, `ai_nodes_json`, `last_ai_feedback` (если едет). Оставить: `id`, `task_id`, `status` (нужен для «Сдано»/лока ввода — вердикт из него не выводим, т.к. закрываем на любом вердикте), `attempts`, `hint_count`.
- Существующие strip'ы (`stripHiddenMessages`, `stripStudentSensitiveTaskStateFields`) — поверх, без изменений.
- `work_mode` в `fetchStudentThread` передают все вызыватели (`handleGetStudentProblem`, `handleStudentSubmission`, `GET /assignments/:id/thread`); если не передан — хелпер резолвит сам (fail-closed: не смогли резолвить → считаем independent-active и стрипаем).
- `handleGetStudentProblem`: `task_score = null` при independent-незавершённом.
- После `thread.status='completed'` — полный reveal (как обычная домашка): вердикты, фидбэк, criteria/flowchart, правки репетитора. Это IS the value (зеркало post-approval reveal пробников, rule 45).

### 3.6 «Сдать работу» — `POST /assignments/:id/student/finish` (Т5)

Новый хендлер `handleStudentFinishWork`:
- Ownership по `homework_tutor_student_assignments` (404 `NOT_FOUND` — паттерн student-эндпоинтов).
- `work_mode !== 'independent'` → 409 `WORK_NOT_INDEPENDENT` (у домашки завершение — естественное, кнопки нет).
- Тред не существует → 404; `status='completed'` → идемпотентный 200 `{completed:true}`.
- Для каждой задачи без `status='completed'`: UPDATE task_state `status='completed', earned_score=0` (⚠️ именно `earned_score=0`, НЕ голый completed — `computeFinalScore` при completed+все-null возвращает **max**, unanswered получил бы полный балл).
- UPDATE thread `status='completed', current_task_id=null`.
- Ответ `{completed:true, zeroed_count}`.

### 3.7 «Результат работы» — `GET /assignments/:id/student/result` (Т6)

Новый хендлер `handleGetStudentResult` — один round-trip:
- Ownership по SA (404).
- assignment whitelist: `id, title, subject, deadline, status, work_mode` + `tutor_overall_comment, tutor_overall_comment_at` (из SA-строки).
- tasks whitelist: `id, order_num, task_text, max_score, task_kind, check_format` (**без** solution/rubric — anti-leak инвариант student-эндпоинтов).
- thread через `fetchStudentThread` (strip-aware).
- `completed = thread?.status === 'completed'`. Не завершено → `{completed:false, work_mode}` (экран покажет «работа ещё не завершена», без баллов).
- Завершено → per-task: `{task_id, order_num, task_text, max_score, final_score (computeFinalScore), answered (есть user-сообщение kind submission/answer с этим task_id)}` + totals `{total_score, total_max}`.
- Вердикт-бакет («верно/частично/неверно/без ответа») дерайвится клиентом из `final_score`/`max_score`/`answered` — сервер не плодит новую типизацию.

## 4. Frontend — репетитор (Т2)

`src/pages/tutor/TutorHomeworkCreate.tsx` — **хроническая риск-зона (rule 40): обязателен manual QA checklist перед мержем.**

- `MetaState` (`homework-create/types.ts`) += `work_mode?: 'homework' | 'independent'`; lazy-init → `'homework'`.
- Сегмент-контрол «Вид работы» в L0 **после секции Предмет/Экзамен** (~:2100): «Домашка с Сократом · Самостоятельная» + однострочное пояснение «Самостоятельная: без подсказок AI, одна попытка на задачу, разбор после сдачи работы». Паттерн — существующие filter-group кнопки (`role="group"` + `aria-pressed`, `min-h-[44px]`, rule 90).
- Рядом ссылка «Нужен формат экзамена? → Пробник» → `/tutor/mock-exams` — только при `useTutorMockExamsFeatureFlag() === true` (тот же гейт, что пункт SideNav). Проверить smoke §8 (write-form invariant) — при конфликте читать флаг синхронно из кэша `['tutor','feature-flags']`.
- Plumbing (все точки из разведки): create body (`:1342`), edit patch при `metaDirty` (`:1684`), `buildEditSnapshot.meta` (`:223`), `metaDirty`-сравнение (`:268`), prefill из `existingAssignment` (`:831`, `a.work_mode ?? 'homework'`), `resolveTemplateLoad.meta` (`:417`, `tpl.work_mode ?? 'homework'`), deps submit-колбэков (паттерн `createFolderId`).
- **Лок:** в edit-режиме при `details.submissions_summary.has_interactions` контрол disabled + подпись «Вид работы нельзя менять: ученики уже начали». Сервер — авторитет (409).
- Типы: `CreateAssignmentPayload`, update-patch, `TutorHomeworkAssignmentDetails.assignment`, `HomeworkTemplate` (`src/lib/tutorHomeworkApi.ts`) += `work_mode?`.

## 5. Frontend — ученик (Т3 UI, Т4 UX, Т5, Т6)

### 5.1 Гейтинг AI-входов (`src/pages/student/HomeworkProblem.tsx`)

`isIndependent = data?.assignment.work_mode === 'independent'` (поле едет из `handleGetStudentProblem`; тип `StudentProblemAssignment` += `work_mode?`). Скрыть при independent:
- `ChatChipRow` (весь ряд: подсказка + мат-клавиатура — чат-композера нет).
- Chat composer (условие `+ && !isIndependent`).
- `NumericAnswerComposer`: `hideDiscussion={isTabletPlus || isIndependent}`.
- `handleChatSend`/`handleHintClick` — защитный ранний return (UI и так скрыт; сервер — авторитет).
- Deploy-skew: старый бандл покажет входы → сервер вернёт 403 с русской фразой (тост) — приемлемо.

### 5.2 Плашка правил + «Сдано» + «Сдать работу»

- **Плашка правил** (Critical-кейс №1): amber-паттерн `ProblemContext` (`:300`) — при independent-незавершённой: «Самостоятельная работа: подсказки и чат отключены, на задачу — одна попытка. Результат — после сдачи всей работы. Задачи можно решать в любом порядке».
- **После сдачи задачи** (`handleSubmissionSubmit`): ответ `independent:true` → без вердикт-пузырей и typing-dots; тост «Ответ сдан», задача в состоянии «Сдано» (status completed из strip'нутого треда; поля ввода лочатся существующей completed-логикой), CTA «Следующая задача». `thread_completed:true` → `navigate` на результат. Телеметрия/дрейфы: `response.verdict` использовать только при его наличии; черновик SubmitSheet чистить по `accepted`.
- Score-чипы/`CriteriaBreakdownTable`/`PhysicsFlowchartTrace` при independent-незавершённой не рендерятся сами (данные застрипаны) — проверить, что null-ы не ломают рендер.
- **CTA «Сдать работу»** (только independent, тред активен): кнопка в шапке/над контекстом задачи; при наличии несданных задач — AlertDialog «N задач без ответа — они получат 0 баллов. Сдать работу?» → `POST .../finish` → navigate на результат. Все задачи сданы — сервер уже автозавершил (кнопка в этом состоянии не показывается).
- Тип ответа сабмита: `SubmitSolutionResponse = CheckAnswerResponse | IndependentSubmissionAck` (`verdict` больше не безусловен).

### 5.3 Экран «Результат работы» (Т6)

- Новый роут `/student/homework/:hwId/result` (`App.tsx`, обычный `AuthGuard` с навигацией, `React.lazy`), страница `src/pages/student/HomeworkResult.tsx`.
- Данные: `getStudentHomeworkResult(hwId)` → `GET /assignments/:id/student/result` (через `requestStudentHomeworkApi` — 401-refresh/retry бесплатно).
- Контент: hero «X из Y баллов» (`formatHomeworkScore`-семейство, `tabular-nums`); список задач — №, `stripLatex(task_text)` clamp (dense-surface конвенция rule 40), чип вердикта, балл `final/max`; каждая строка → `/student/homework/:hwId/problem/:taskId` (разбор: фидбэк AI, criteria, правки репетитора — post-completion всё раскрыто); `TutorOverallCommentCard` при наличии комментария.
- Вердикт-бакеты и цвета (waiver-семантика rule 90): `!answered` → «Без ответа» slate; `final >= max` → «Верно» emerald; `final <= 0` → «Неверно» rose; иначе «Частично» amber.
- `completed:false` → «Работа ещё не завершена» + ссылка назад (**без** авто-редиректа — loop-safety).
- Safari 15: без lookbehind/`:has`/`dvh`-зависимостей, 16px инпутов нет, обычный CSS.

### 5.4 Редиректы по завершению (оба вида работ)

- `HomeworkProblem.navigateAfterCorrect` (`:1281`): ветка «все задачи решены» — `navigate('/homework')` → **`/student/homework/${hwId}/result`**.
- `StudentHomeworkDetail` all-completed (`:78–100`): вместо открытия последней задачи в review — `navigate(result, {replace:true})`. Loop-guard сохранён: экран результата никогда не редиректит сам, `HomeworkProblem` не bounce'ит на mount. Phase-12-ценность (ученик видит `tutor_overall_comment`) переезжает на экран результата — строго лучше.

## 6. Ошибки (формат homework-api `{error:{code,message}}`)

| Код | HTTP | Где | Фраза |
|---|---|---|---|
| `INDEPENDENT_AI_DISABLED` | 403 | hint / check / student post-message / chat guided | «В самостоятельной работе подсказки и чат с Сократом недоступны» |
| `TASK_ALREADY_SUBMITTED` | 409 | submission (independent, задача completed) | «Ответ уже сдан — в самостоятельной работе одна попытка» |
| `WORK_MODE_LOCKED` | 409 | update assignment | «Вид работы нельзя изменить: ученики уже начали работу» |
| `WORK_NOT_INDEPENDENT` | 409 | finish | «Эту работу не нужно сдавать отдельно» |
| `INVALID_WORK_MODE` | 400 | create/update/template | «Недопустимый вид работы» |

`chat/index.ts` отвечает плоским JSON `{error, code}` (свой существующий формат fail-closed ответов).

## 7. Приёмка (по Т)

- **Т1:** существующие ДЗ и все пути создания без изменения поведения (DEFAULT); `save-as-template` от самостоятельной → шаблон с `work_mode='independent'`; загрузка такого шаблона префиллит «Самостоятельная»; форк не теряет вид.
- **Т2:** контрол виден в L0 без раскрытия «Расширенных»; PUT со сменой вида при существующих интеракциях → 409; в edit-UI контрол задизейблен.
- **Т3:** прямые вызовы `POST /threads/:id/hint`, `/threads/:id/check`, `/threads/:id/messages` (user) и `/chat` (guided) на самостоятельной → 403 с русской фразой; квота НЕ списана; в UI входы отсутствуют; обычная домашка байт-в-байт не затронута.
- **Т4:** повторный `POST .../submission` по сданной задаче → 409; балл = AI-результат без `computeAvailableScore`-деградации; CHECK_FAILED не сжигает попытку.
- **Т5:** до завершения сырой ответ student-API (problem/thread/**`GET /threads/:id`**/submission) не содержит `verdict`/`feedback`/`ai_score`/`earned_score`/criteria/nodes и `check_result`-сообщений; прямой PostgREST ученика к `task_states`/`thread_messages` независимого активного треда → 0 строк / только свои+тьюторские сообщения; после завершения — полный reveal; репетитор видит результаты по мере сдач — деталка/heatmap отражают их при загрузке страницы, открытый `GuidedThreadViewer` досинхронизирует баллы по realtime-вердикту (не мгновенный push task_state, а invalidate на `check_result`).
- **Т6:** после сдачи ученик попадает на «Результат работы» ≤ 3 сек (один запрос); все строки кликабельны; обычная домашка по завершению ведёт на тот же экран; iOS Safari 15 ок.

## 8. Валидация и деплой

- `npm run lint` → `npm run build` → `npm run test` (smoke-check; следить за §8 write-form invariant из-за нового чтения флага в конструкторе).
- `npx esbuild supabase/functions/homework-api/index.ts --outfile=NUL` + то же для `chat/index.ts` (Deno-сборка, конвенция rule 100).
- Manual QA checklist конструктора (rule 40) — обязателен до мержа, коммит должен содержать подтверждение.
- **Порядок деплоя (строгий):** миграция → edge (Lovable на push: `homework-api`, `chat`) → фронт (`deploy-sokratai`). Edge раньше миграции = «column does not exist» на новых SELECT'ах (класс инцидента rule 45). Старый фронт на новом edge деградирует безопасно (403/скрытие серверные).
- **Rollback edge — небезопасен после первой созданной самостоятельной.** Откат `homework-api`/`chat` на версию без `work_mode` снимает 403-гейты и state-aware strip с УЖЕ существующих independent-ДЗ (AI разблокируется, вердикты раскрываются). Новый фронт на старом edge сам по себе безопасен: старый бэкенд поле не пишет и не отдаёт → ДЗ создастся как `homework`, клиент увидит обычный режим. Значит откатывать можно только фронт; edge — вперёд.
- **`npm run typecheck` не проверяет код** (корневой `tsconfig.json` = `files: []` + `references`; CI зовёт именно его). Реальная команда — `npx tsc -p tsconfig.app.json --noEmit`. На 2026-07-24 там 13 pre-existing ошибок (unified/remark `Pluggable` ×10, `HWDrawer.feature_mock_exams_enabled`, `pdfToImages` Worker, `mockExam` MockExamCheckMode) — скрипт не переключаем, пока они не починены отдельной задачей, иначе CI станет красным.

## 9. Осознанные решения / известные ограничения

- **Квота:** самостоятельная не расходует квоту AI-сообщений (анти-требование PRD); AI-грейдинг при этом реально вызывается — стоимость видна в `token_usage_logs` как обычно. Free-ученик не может застрять на 429 посреди среза.
- **Дедлайн:** после дедлайна сдача остаётся возможной (v1, PRD кейс №12) — поведения не меняем.
- **Reveal-гейт — per-student** (`thread.status`), не per-assignment: один ученик сдал → видит свой разбор, сосед ещё решает. Утечки между учениками нет (треды изолированы ownership'ом).
- **`has_interactions` как лок-сигнал** строже, чем «первая сдача» (любое сообщение ученика) — совпадает с семантикой существующего гейта редактирования задач.
- **Reopen:** независимые закрытия не ставят `tutor_force_completed_at` → «Открыть задачу обратно» недоступно (целостность среза); правка балла репетитором (`EditScoreDialog`) работает как обычно.
- **HWDrawer (path B)** самостоятельные не создаёт (нет контрола) — DB default страхует.

## 10. Отложено (вне среза, НЕ реализовывать сейчас)

| Что | Статус |
|---|---|
| **Т7** «% самостоятельности» | ✅ **сделано 2026-07-25**: `100% − 10 п.п. × обращений к AI`, балл задачи = лучший за все попытки, деградация балла отменена, агрегат взвешен по `max_score`; видят и репетитор, и ученик; в самостоятельной не показывается. Миграции `20260725140000` + `20260725150000`. Инварианты → skill `homework-system` §«% самостоятельности» |
| **Т8** бейджи вида работы | ✅ **сделано 2026-07-25** (T0): чип `WorkModeChip` в 4 списках + шапка деталки + оба канала уведомления + разделение работ в отчёте родителю. Детали → skill `homework-system` §«Виды работ» |
| **Т9** тумблер «разбор сразу по задаче / после сдачи работы» | второй срез Ф1 (v1 — один дефолт «после сдачи работы») |
| **Фаза 2** (Т10–Т12): предметная таксономия ошибок, сводка за работу, сводка за период + AI-саммари | отдельная итерация; гейт — офлайн-валидация категорий с Еленой (R5) |
| Таймер, запрет сдачи после дедлайна, real-time монитор, mock-чекеры Ч1 в ДЗ | out-of-scope PRD §7 |
