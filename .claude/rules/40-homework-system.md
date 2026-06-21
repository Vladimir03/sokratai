# Homework System

## Система домашних заданий

В проекте **ОДНА** система ДЗ — tutor-connected (`homework_tutor_*` таблицы), работает через **guided chat** (пошаговый AI-чат: ведёт ученика через каждую задачу с подсказками и проверкой).

Удалённые подсистемы:
- Legacy student-only (`homework_sets`, `homework_tasks`, `homework_chat_messages`) — дроп `20260310110000_drop_legacy_homework.sql`.
- Classic mode (photo upload + OCR) — дроп `20260406120000_drop_classic_homework.sql`. Колонка `workflow_mode` и таблицы `homework_tutor_submissions`/`homework_tutor_submission_items` дропнуты. **Не возрождать.**

### Двойной write-path в `homework_tutor_tasks` — КРИТИЧНО при добавлении новых колонок

**ДВА независимых места** инсертят строки в `homework_tutor_tasks`. При добавлении новой колонки / нового поля в AI-prompt / любом cross-cutting изменении — править **ОБА**, иначе feature молча ломается через один flow.

| Путь | Entry point | Источник данных | Kто пишет в БД |
|---|---|---|---|
| **A — через edge function** | «+ из БЗ» в конструкторе (`TutorHomeworkCreate.tsx`) → `KBPickerSheet` → `HWTasksSection.handleAddFromKB` → `kbTaskToDraftTask` | `DraftTask[]` local state | `POST /assignments` → `homework-api/index.ts::handleCreateAssignment` / `handleUpdateAssignment` |
| **B — напрямую из клиента** | «В ДЗ» на карточке БЗ (`src/components/kb/TaskCard.tsx` → `onAddToHW`) → `hwDraftStore.addTask` (Zustand, persisted `sokrat-hw-draft` в localStorage) → корзина `HWDrawer` | `HWDraftTask[]` из Zustand | **Прямой** `supabase.from('homework_tutor_assignments').insert(...)` + `from('homework_tutor_tasks').insert(...)` в `HWDrawer.tsx` |

**Типы-носители (правь ВСЕ при изменениях):**
- Path A: `DraftTask` (`src/components/tutor/homework-create/types.ts`) + `CreateAssignmentTask` / `UpdateAssignmentTask` (`src/lib/tutorHomeworkApi.ts`) + `KBTask` конвертер (`HWTasksSection.kbTaskToDraftTask`).
- Path B: `HWDraftTask` (`src/types/kb.ts`) + `hwDraftStore.addTask` (`src/stores/hwDraftStore.ts`) + прямой INSERT в `HWDrawer.tsx`.

**Симптом пропуска:** fix работает в конструкторе, но ДЗ из «В ДЗ» с KB-карточки — с NULL в новой колонке (path B пропущен).

**Перед мержем PR, меняющим homework_tutor_tasks, проверь:**
1. `grep -rn "from('homework_tutor_tasks')\.insert\|from('homework_tutor_tasks')\.update" src/ supabase/`
2. Оба пути пишут новое поле.
3. `HWDraftTask` + `DraftTask` содержат новое поле (если оно переносится через корзину/конструктор).
4. `handleGetStudentAssignment` (student-side API) НЕ селектит поля, которые должны оставаться tutor-only.

### Два endpoint'а для assign students — quick-add vs edit-flow

**Два независимых endpoint'а** пишут в `homework_tutor_student_assignments`. При изменении общего инварианта (новая колонка, изменение `provisionGuidedThread` / draft→active activation / RLS) — править **оба**.

| Endpoint | Когда | Notify cascade | Body | Возврат |
|---|---|---|---|---|
| `POST /assignments/:id/assign` (`handleAssignStudents`) | Edit-flow (`TutorHomeworkCreate.tsx` после save) | НЕТ (отдельный `/notify` после) | `student_ids: string[]` + `group_id?: string \| null` | `students_without_telegram_names: string[]` |
| `POST /assignments/:id/assign-students` (`handleQuickAssignStudentsWithNotify`) | Quick-add (`AddStudentsToHomeworkDialog` в шапке `TutorHomeworkDetail`) | ДА (push → telegram, **БЕЗ email** — mirror моков, rule 45) | `student_ids: string[]` + `notify?: boolean` (default true) | `notify: {sent_push, sent_telegram, failed, failed_no_channel}` + `skipped_existing` |

**Общая логика (sync при изменениях):**
- `getOwnedAssignmentOrThrow` для ownership.
- Whitelist `tutor_students.student_id` (anti-injection: 403 `INVALID_STUDENTS`).
- Idempotent upsert через UNIQUE `(assignment_id, student_id)` с `ignoreDuplicates: true`.
- `provisionGuidedThread(db, assignmentId, sa.id)` для каждого newly-inserted student_assignment id (eager bootstrap).
- Activate `draft → active` если первый assign триггерит status flip.

**Отличия:**
- Group resolution: `/assign` принимает `group_id` и резолвит `tutor_group_memberships` server-side; `/assign-students` принимает **только flat** `student_ids[]` (`HWAssignSection` резолвит группы клиент-сайд).
- Notify scope: quick-add = push + telegram (НЕ email). Bulk `/notify` (`handleNotifyStudents`) = полный cascade push → telegram → email + per-student `delivery_status` enum. Не консолидировать — разная UX-семантика.

**При добавлении нового assign-endpoint:** не плоди N-й write-path. Сначала проверь — нельзя ли расширить существующий opt-in параметром (e.g. `notify: 'auto' | 'silent'`). Если строго нужен — обнови эту таблицу + оба cascade-цепочки.

### Score step invariants — два разных шага для двух разных полей

**Два** numeric поля с независимыми step-инвариантами. **НЕ путать:**

| Поле | Шаг | Backend validator | Frontend input | DB column |
|---|---|---|---|---|
| `homework_tutor_tasks.max_score` | **0.5** | `isPositiveHalfStepNumber(v)` в `homework-api/index.ts` (`scaled = v*2; Math.abs(scaled - Math.round(scaled)) < 1e-9`) | `<Input step={0.5} min={0.5} inputMode="decimal">` + snap-on-blur в `HWTaskCard.tsx` | `numeric(6,1)` (миграция `20260523120000`) |
| `homework_tutor_task_states.tutor_score_override` + `ai_score` | **0.1** | `isPositiveTenthStep`-pattern (`scaled = v*10`) в `handleSetTutorScoreOverride` | `<input step={0.1}>` + validator в `EditScoreDialog.tsx` | `numeric(5,2)` (миграция `20260408120000`) |

**Почему два шага:** `max_score` = баллность задачи (ФИПИ физика № 21-26 имеют half-step max); шаг 0.1 здесь — лишняя свобода. `tutor_score_override`/`ai_score` = балл ученика в `[0, max_score]`, AI ставит дробные по шагу 0.1.

**6 callsite `max_score` в `homework-api/index.ts` — ВСЕ используют `isPositiveHalfStepNumber`:**
1. `handleCreateAssignment` validator (~561)
2. `handleCreateAssignment` taskRows insert default (~629)
3. `handleUpdateAssignment` validator (~1288)
4. `handleUpdateAssignment` update-with-submissions field (~1426)
5. `handleUpdateAssignment` new-insert-no-submissions (~1489)
6. `handleUpdateAssignment` update-no-submissions (~1577)

**НЕ** возвращай ни одно к `isPositiveInt` — дробные 12.5 silently коллапсятся в 1 через `? t.max_score : 1` fallback (а validator пропустит запрос, т.к. валидируется ДРУГОЕ поле). Грепни `isPositive(Int|HalfStepNumber)\((t|task)\.max_score` — все совпадения должны быть `HalfStepNumber`. Двойной write-path применим: HWDrawer (path B) **пишет** `max_score` из `HWDraftTask.maxScoreSnapshot` (= KB `primary_score ?? 1`; fallback 1 для старых черновиков) — review fix 2026-06-21, иначе KB-задача с авто-баллом по КИМ / уровнем сложности олимпиады (>1) молча падала в DB DEFAULT 1. Раньше HWDrawer полагался на DEFAULT 1 (балл у физ-ЕГЭ KB-задач почти всегда был 1, но Phase 1 KB-loader сделал баллы значимыми).

**0.1-шаг для `tutor_score_override`/`ai_score` — 5 точек в синхроне:**
1. `homework-api/index.ts::handleSetTutorScoreOverride` validator.
2. `guided_ai.ts::buildAiScoreGuidance` prompt text (запрашивает шаг 0.1 у модели).
3. `EditScoreDialog.tsx` validator (`validationError` useMemo).
4. `EditScoreDialog.tsx` `<input step={0.1}>`.
5. `EditScoreDialog.tsx` hint text `0..N, шаг 0.1`.

Validator pattern: `const scaled = value*10; if (Math.abs(scaled - Math.round(scaled)) > 1e-9) return error('multiple of 0.1');`. Backward compat: 0.5 ∈ multiples of 0.1, data-миграция не нужна. DB `numeric(5,2)` поддерживает 0.1.

**Frontend UX контракт (`HWTaskCard.tsx`):** локальный `scoreText: string` (раздельно от `task.max_score: number`) — тутор может печатать «12.» прежде «5». Sync извне через `useEffect([task.max_score])`. Snap-on-blur: 12.7 → 12.5 silently (без error modal); negative/NaN/< 0.5 → 1. Hint: «Шаг 0.5 — например 1, 1.5, 12, 12.5».

### Invite preview edge function — отдельный share URL

**Два** канонических helper'а в `src/utils/telegramLinks.ts` — **НЕ путать:**

| Helper | URL | Назначение |
|---|---|---|
| `getTutorInviteWebLink(code)` | `https://sokratai.ru/invite/{code}` | **Внутренняя** навигация (редирект после claim, deep-link из push, internal routing). НЕ для share. |
| `getTutorInvitePreviewLink(code)` | `https://api.sokratai.ru/functions/v1/invite-preview?c={code}` | **Share-сценарии** (clipboard, QR, отправка через Telegram/WhatsApp/Discord). |

**Почему два:** `sokratai.ru/invite/{code}` обслуживается SPA fallback из глобального `index.html` — OG там под main landing для репетиторов («200 ₽ в месяц…»), что пугало ученика в Telegram-чате. Endpoint `supabase/functions/invite-preview/index.ts` отдаёт invite-specific OG (title «Тебя пригласили в Сократ AI», description с именем репетитора, og:image `sokratai.ru/sokrat-logo.png`). Browser fallback — `<meta http-equiv="refresh">` + `window.location.replace()` → редирект на canonical `/invite/{code}`. Telegram bot НЕ выполняет refresh/JS → видит только OG.

**Hard invariants:**
1. **`tutors.name` lookup через `service_role`** (нет JWT). `firstName(fullName)` режет до первого слова.
2. **`escapeHtml(str)` обязателен** для всего user input в HTML (og:description, og:title, body redirect link, canonical URL) — tutor может ввести `<script>`.
3. **Invalid/отсутствующий invite code → generic fallback preview**, не 404 (broken preview убивает доверие тутора).
4. **`Cache-Control: no-store, must-revalidate`**.
5. **Telemetry server-side только**, PII-free: `{event, has_code, valid_code, has_tutor_name}`. **Никогда** не логировать invite_code (= bearer token; знание чужого кода допускает hijack ученика).
6. **Tutor share UI source-of-truth** = 4 файла (`TutorStudents.tsx`, `TutorHome.tsx`, `TutorHomeworkCreate.tsx`, `mock-exams/AddStudentsToMockExamDialog.tsx`) — ВСЕ компьютят `inviteWebLink` через `getTutorInvitePreviewLink`. Downstream (`AddStudentDialog`, `HWAssignSection`, `HWSubmitSuccess`) получают URL через props. Новый share-surface — **обязательно** через `getTutorInvitePreviewLink`.

Backward compat: legacy `sokratai.ru/invite/{code}` URLs продолжают работать (claim flow intact); их preview-card в legacy сообщениях показывает старый текст (Telegram кеш не сбрасывается ретроактивно). Новый share-channel (WhatsApp) — тот же preview URL (OG работает для всех scrapers).

### AI image bucket whitelist invariant

Любой storage bucket, ссылка на который может попасть в `homework_tutor_tasks.task_image_url` / `solution_image_urls` / `rubric_image_urls`, **обязан** быть в `supabase/functions/_shared/image-domains.ts::HOMEWORK_AI_BUCKETS`. Если bucket отсутствует:
- `chat/index.ts::isValidImageUrl` отклонит signed URL → AI получит только текст «[Задача на фото]» → **галлюцинация**.
- `guided_ai.ts::evaluateStudentAnswer` и `generateHint` **fail closed** при отсутствии резолвленной картинки + placeholder-тексте (`failure_reason: "task_image_missing"`, telemetry `guided_{check,hint,chat}_task_image_missing`).

**Перед мержем PR, добавляющего новый storage bucket в KB/homework write-path:**
1. Расширь `HOMEWORK_AI_BUCKETS`.
2. `npm run smoke-check` — SELECTит distinct prefixes из `homework_tutor_tasks.{task_image_url,solution_image_urls,rubric_image_urls}` через `storage://([^/]+)/` и падает на bucket вне whitelist.
3. Передеплой `chat` и `homework-api`.

**Patch B+2 dual-host validator invariant:** signed URLs могут попадать в БД с **обоими** host'ами — direct `*.supabase.co` (legacy + server-side SDK) и `api.sokratai.ru` (после `rewriteToProxy()`, типичный flow для `homework_tutor_thread_messages.image_url`). Все 4 validator'а (`chat::isValidImageUrl` через `ALLOWED_IMAGE_DOMAINS`, `guided_ai::isAllowedSignedStorageUrl`, `homework-api/index::getLatestStudentImageUrls`, shared `image-domains::isAllowedSignedUrl`) **обязаны** принимать оба host'а через OR. JWT подписан project signing key, не зависит от хоста.

При добавлении нового signed-URL validator'а:
- Импортировать `SUPABASE_PROXY_URL` из `_shared/proxy-url.ts` (single source of truth).
- Pattern: `(supabaseUrl && url.startsWith(${supabaseUrl}/storage/v1/object/sign/)) || url.startsWith(${SUPABASE_PROXY_URL}/storage/v1/object/sign/)`.
- Direct path **первым** в OR. **НЕ удалять** direct path при добавлении proxy — оба нужны.
- Server-side `fetch()` на validated URL — оборачивать в `rewriteToDirect()` из `_shared/proxy-url.ts` (экономит 200-400ms).

Симптом нарушения: AI говорит «ты прислал только фотографию условия, но твоего решения здесь нет» при наличии user-uploaded photo.

### Task identity — canonical source of truth

`task_id` (UUID FK → `homework_tutor_tasks.id`) — единственный immutable identity для привязки сообщений, AI-контекста и state. `task_order` — display/sort field, может меняться при reorder.

**Правила:**
- Все новые message-insert'ы ОБЯЗАНЫ включать `task_id`. `task_order` пишется для backward compat, но не для filtering.
- Все message-filter'ы (backend и frontend) ОБЯЗАНЫ использовать `task_id` как primary match. Fallback на `task_order` ТОЛЬКО для pre-migration messages (`task_id IS NULL`).
- Номер задачи в UI — resolve через `task_id → tasks[].order_num` (текущий порядок), НЕ stored `message.task_order` (stale после reorder).
- AI context (history, task text, image) строится ТОЛЬКО по `task_id`-scoped messages.

Миграция: `20260410153000_guided_thread_task_identity_foundation.sql` (добавила `task_id` в `homework_tutor_thread_messages`, `current_task_id` в `homework_tutor_threads`, backfill по `order_num`).

**Дефолты конструктора (`TutorHomeworkCreate.tsx`):** `subject: 'physics'` (целевой сегмент). Смена предмета → открыть L1.

### Subject AI-промпты — все 3 пути

Все три AI-пути guided chat (`check` / `hint` / `chat`) обязаны получать `homework_tutor_assignments.subject` и адаптировать system prompt. Симптом нарушения: ученик на ДЗ с `subject != 'physics'` получает «физическую величину» / «формулу Ньютона». (Контракт mirror'ит «имя ученика в AI-промпте» — AGENTS.md.)

| Путь | Файл | Subject параметр | Как используется |
|---|---|---|---|
| Check | `guided_ai.ts::buildCheckPrompt` | `params.subject` | `Предмет: ${params.subject}` в systemContent |
| Hint | `guided_ai.ts::buildHintPrompt` | `params.subject` | `buildHintRoleLine(subject)` + `buildHintExamplesLine(subject)` — switch по предметам |
| Hint fallback | `guided_ai.ts::buildFallbackHint` + `buildValidatedFallbackHint` | optional `subject` в `taskContext` | branch: physics → физическая фраза; humanities → грамматика/правила; maths → формулы/теоремы; default → нейтрально |
| Chat | `chat/index.ts::processAIRequest` | `ChatRequestBody.subject` + **server-side подтверждение** через SELECT `homework_tutor_assignments.subject` | DB value WINS (anti-tamper); subject-aware блок инжектируется в `effectiveSystemPrompt` после base `SYSTEM_PROMPT` |

**Server-side подтверждение (chat path, КРИТИЧНО):** при наличии `guidedHomeworkAssignmentId`, `processAIRequest` параллельно (`Promise.all` с taskRow fetch) фетчит `subject` через service_role. **Серверное значение WINS** над client-supplied (ученик не может подставить `subject='physics'` на чужом French ДЗ). Latency overhead = 0.

**Frontend цепочка — 3 callsite пробрасывают `assignment.subject` в `streamChat` body:** `src/lib/streamChat.ts` (`StreamChatOptions.subject` + body field), `GuidedHomeworkWorkspace.tsx` (legacy desktop: main + bootstrap streamChat), `HomeworkProblem.tsx` (mobile/Phase 3).

**Subject helpers — двойной источник, синхронизация вручную:**
- Frontend (TS): `getSubjectLabel(id)` в `src/types/homework.ts`.
- Deno: локальные `SUBJECT_LABELS_DENO` + `getSubjectLabelDeno()` дублируются inline **в двух** файлах: `guided_ai.ts` и `chat/index.ts` (Deno не может импортировать `src/types/homework.ts`). При добавлении subject в `SUBJECTS` — синхронно обновить обе Deno-копии.

**`isHumanitiesWritingSubject` (`src/lib/subjectHelpers.ts`):** `true` для `russian / literature / english / french / spanish` (+ legacy `rus`). Применяется в **3 точках UX-адаптации** (только при `task_kind === 'extended'`):
- `ProblemContext.tsx` amber banner: «Это письменная задача — напиши развёрнутый ответ…».
- `SubmitSheet.tsx`: numeric input row **скрыт**. Backend `handleStudentSubmission` уже разрешает `photos.length >= 1 OR text.trim().length > 0` для extended — миграций нет.
- `SubmitCtaBar.tsx` + mobile big-CTA в `HomeworkProblem.tsx`: subtitle «Текст или фото готового решения».

**При добавлении нового AI-пути:** новый prompt-builder в `guided_ai.ts` — **обязательно** принимай `subject: string` в `Params`, хотя бы одна subject-aware строка через `getSubjectLabelDeno`. Новый `/chat` endpoint — `subject` в body (server-side подтверждает через DB). Расширение humanities-writing UX — расширь `subjectHelpers.ts`, не ad-hoc switch'и. Грепнуть: `grep -nE "buildFallbackHint|buildHintPrompt|streamChat\(" src/ supabase/functions/` — каждый call site передаёт `subject`.

Spec: `~/.claude/plans/1-functional-meteor.md`.

### Subject-rubric layer — методология ЕГЭ 2026

Subject-aware prompts получают полную методологию ФИПИ / DELF / IELTS.

**Архитектура — `supabase/functions/_shared/subject-rubrics/`:**
- `index.ts::resolveSubjectRubric({ subject, exam_type, kim_number, task_kind, task_text, tutor_rubric })` — single entry point. Возвращает `SubjectRubric { role, methodology, hint_examples, fallback_hint, subject_label, cefr_level, tutor_rubric_active, criteria_breakdown_template }`.
- `physics-ege.ts` — ФИПИ № 21-26 (№ 21 качественная 0-3 балла; полные критерии 2026).
- `math-ege.ts` — ЕГЭ 2026 № 13-19 (**НЕ** № 12-17 — устаревший формат до реформы 2024).
- `chemistry-ege.ts` — ЕГЭ 2026 № 29-34 (**НЕ** № 30-34).
- `languages-ege.ts` — ЕГЭ EN № 38/39 + DELF B1/B2 + IELTS Task 1/2 (format auto-detect).
- `cefr-detector.ts` — auto-detect B1/B2/C1 из task_text. `types.ts` — общие типы.

**Где интегрирован:** `guided_ai.ts::buildCheckPrompt` (methodology + role), `buildHintPrompt` (role + hint_examples + methodology), `chat/index.ts::processAIRequest` (subject-block + tutor priority marker).

**SELECT extensions (`handleCheckAnswer` / `handleRequestHint` / `handleStudentSubmission` / chat):** `homework_tutor_assignments` — `exam_type` (был только `subject`); `homework_tutor_tasks` — `kim_number`, `task_kind`, `check_format`. Pass через `EvaluateStudentAnswerParams.examType/kimNumber/taskKind` и `GenerateHintParams.*`.

**`kim_number` WRITE-path (Phase 2 KB-loader, 2026-06-21) — зеркало `cefr_level`.** Grading читал `kim_number`, но он не **записывался** при создании ДЗ → KB-задачи с № КИМ грейдились по общей рубрике предмета, не по критериям ФИПИ конкретного номера. Теперь `kim_number` доезжает KB→ДЗ всеми write-path (dual-write): `kbTaskToDraftTask` → `DraftTask` → `CreateAssignmentTask`/`UpdateAssignmentTask` → backend `handleCreateAssignment` + `handleUpdateAssignment` (4 пути) через `normalizeKimNumber` (1..40|null); GET-select (`handleGetAssignment`) round-trip на edit; шаблоны (save_as_template / handleCreateTemplate spread / save-as-template) + `HomeworkTemplateTask.kim_number`; **path B** `HWDraftTask.kim_number` → `hwDraftStore` → прямой insert `HWDrawer`. Колонка `homework_tutor_tasks.kim_number` существует с subject-rubric layer (миграций нет). В UI конструктора № КИМ не правится — провенанс из KB для grading. Грепни `from('homework_tutor_tasks').insert|update` — все 5 write-site (backend create + update×3 + HWDrawer) пишут `kim_number`. Новый write-path в `homework_tutor_tasks` → дописывать `kim_number` (и `max_score`, см. dual-write выше).

**Tutor rubric merge contract (КРИТИЧНО):** если `homework_tutor_tasks.rubric_text` непуст → resolver prepend его ПЕРЕД default methodology с маркером:
```
ПРИОРИТЕТНЫЕ КРИТЕРИИ ОТ РЕПЕТИТОРА (используй ПРЕЖДЕ ВСЕГО, при конфликте они выигрывают):
<tutor_rubric>

ДОПОЛНИТЕЛЬНЫЕ СТАНДАРТНЫЕ КРИТЕРИИ (используй как baseline, если tutor явно их не отменил):
<default methodology>
```
AI инструктирован: tutor rubric WINS. `SubjectRubric.tutor_rubric_active: boolean` — exposed для telemetry.

**Server-side подтверждение (anti-tamper):** chat path re-fetch'ит subject/exam_type/kim_number/task_kind/rubric_text через service_role параллельно с solution fetch. DB value WINS over client-supplied.

**ОГЭ — отложено (P0 = ЕГЭ-only):** resolver использует ЕГЭ rubric даже при `exam_type='oge'`. При ОГЭ rollout — создать `physics-oge.ts` etc., добавить branch на `exam_type === 'oge'`.

**При расширении на новый предмет с полной методологией:**
1. Создать `_shared/subject-rubrics/<subject>-ege.ts` (mirror `chemistry-ege.ts` или `languages-ege.ts`).
2. Export `build<Subject>EgeRubric(kimNumber: number | null): Omit<SubjectRubric, "tutor_rubric_active" | "cefr_level" | "subject_label">`.
3. В `index.ts::resolveSubjectRubric` добавить branch до generic fallback.
4. Никаких изменений в `guided_ai.ts` / `chat/index.ts` / callsite — резолвер сам подхватит.

**Источник критериев:** ФИПИ «Изменения в КИМ ЕГЭ 2026»: «Изменений нет» для физики/математики/химии → структура 2025 = 2026.

Spec: `~/.claude/plans/1-functional-meteor.md` Phase 2.

### Покритериальный грейдинг языков — criteria_breakdown

Для языковых ДЗ (DELF / ЕГЭ EN / ОГЭ — письмо + устный монолог) AI раскладывает `ai_score` по именованным критериям. Хранится в `homework_tutor_task_states.ai_criteria_json JSONB` (миграция `20260527180000`, формат `[{label, score, max, comment, kind?}]`), рендерится `CriteriaBreakdownTable` (shared student+tutor). `ai_criteria_json` GRANT'ится (feedback), **НЕ** в strip. **Голос (Этап 2) — см. секцию «Голосовые задания (`task_kind='speaking'`)» ниже.**

**Template критериев:** `_shared/subject-rubrics/languages-ege.ts::CRITERIA_*` (`SubjectCriterionTemplate[]`), пропагируются через `SubjectRubric.criteria_breakdown_template`. При добавлении формата — `METHODOLOGY_*` + `CRITERIA_*` + ветка в `getLanguagesMethodology` + кейс в `scripts/test-criteria-templates.mjs`.

**Инварианты:**
- **Sum-агрегация ONLY** — IELTS (average band) отдаёт `criteria = null`, breakdown не рендерится. Non-language / numeric → null.
- **Σ AI-graded score == ai_score**; `ai_score` (task scale) ремапится на template scale (`mapAiScoreToTemplateScale`). Репетитор ставит `max_score` = экзаменационный AI-gradable total.
- **`tutor_only`** (phonétique) — `score = max`, вне суммы, рендерится `—/max` + «оценивает репетитор».
- **Re-normalize при downgrade** через `renormalizeCriteriaToScore` (CORRECT→ON_TRACK).
- **Anti-leak на comments** — тот же `detectLeak`, scrub при утечке (telemetry `check_criteria_comment_leak_scrubbed`).
- **Cyrillic `\b` ЗАПРЕЩЁН** в Deno subject-rubric regexes — `/\bЕГЭ/`, `/\bэссе/`, `/\bустн/` не матчат кириллицу (JS `\b` ASCII-only). Только `hasWord` / `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])` с флагом `u`. Lookbehind безопасен (server/Deno, не Safari).

**Smoke-guard:** `scripts/test-criteria-templates.mjs` (секция 9 в `smoke-check.mjs`) — sum-тоталы каждого формата, IELTS→null, non-language→null, numeric→null.

Spec: `docs/delivery/features/voice-speaking-mvp/spec.md`.

### Уровень CEFR языковых ДЗ — `cefr_level` (явный, форсит рубрику)

Баг (репортер — Эмилия, FR/DELF, 2026-05-29): письменные работы ВСЕХ уровней проверялись по критериям **B1**. Причина: уровень определялся ТОЛЬКО эвристикой `cefr-detector.ts::detectCefrLevel` из `task_text` с **дефолтом B1**, поле «Критерии» не читалось, а во французской ветке вообще **не было A2-рубрики** (A2 проваливался в B1). Тот же класс, что speaking→oral: heuristic вместо explicit signal.

**Fix — явный `homework_tutor_tasks.cefr_level`** (миграция `20260529180000`, nullable + CHECK `A2/B1/B2/C1`). Селектор «Уровень (CEFR)» в `HWTaskCard` (gated `cefrLevelEnabled` = subject ∈ {french, english, spanish}). `null` = авто-детект (прежнее поведение).

**Контракт (КРИТИЧНО — explicit wins over heuristic):**
- `resolveSubjectRubric({ ..., cefr_level })` → `buildLanguagesRubric(..., forcedCefr)` → `getLanguagesMethodology(..., forcedCefr)` → `detectLanguageFormat(..., forcedCefr)`: `const cefr = forcedCefr ?? detectCefrLevel(text).level;`. Явный уровень ПОБЕЖДАЕТ текст-эвристику.
- Французская ветка: `A2 → delf-a2-*`, `B2/C1 → delf-b2-*`, `B1/else → delf-b1-*`. **A2-рубрика добавлена** (`METHODOLOGY/CRITERIA_DELF_A2_ECRITE/ORALE`; Σ écrite=25, Σ orale AI-gradable=23 + phonétique tutor_only). **A2-критерии = DRAFT, валидирует Эмилия.** C1 пока маппится на B2 (селектор offers A2/B1/B2).
- **Write-path:** `cefr_level` персистится во всех 4 backend write-path (`normalizeCefrLevel`) + edit round-trip (`handleGetAssignment` SELECT + detail-тип + prefill + **`buildTaskSignature`/`tasksDirty`** — иначе правка ТОЛЬКО уровня = no-op).
- **Grading paths:** `runStudentAnswerGrading` (check + submission) + `generateHint` + `chat/index.ts` (discussion) читают `task.cefr_level` → `EvaluateStudentAnswerParams.cefrLevel` / `SubjectRubricInput.cefr_level`. Grading SELECTs включают `cefr_level`; student-display SELECT (`handleGetStudentProblem`) — НЕ включает (ученику не нужно).
- **Гейтинг** — foreign-language subjects, default «Авто» (null) → не ломает существующие/не-языковые ДЗ. Не за feature-флагом (фикс грейдинга для всех языковых туторов).
- **Smoke-guard:** `scripts/test-criteria-templates.mjs` — «cefr_level forces the rubric level» (A2→A2, B2→B2, null→B1) + A2 sum-templates.

**При расширении:** новый язык с уровнями → добавь рубрику уровня (mirror `delf-a2-*`); новый grading-путь → читай `cefr_level` и прокидывай в `resolveSubjectRubric`; уровень — explicit-signal-first, эвристика только fallback.

Spec: `docs/delivery/features/voice-speaking-mvp/spec.md` (CEFR-level fix 2026-05-29).

### Phase 11 (2026-05-31) — CEFR обязателен (assignment-level) + детерминированный язык feedback

Расширение CEFR-fix после повторного репорта Эмилии: несмотря на per-task селектор `cefr_level` (2026-05-29), **все** её French-задачи остались `cefr_level=NULL` (диагностика: 100% NULL в БД). Причины: (1) per-task селектор не замечен («не видела опцию»); (2) задачи картинками (`task_text="[Задача на фото]"`, `has_rubric_text=false`) → авто-детект нечего сканировать → silent B1; (3) топик-банки по 10 задач → per-task friction. Плюс новый баг: **язык ответа недетерминирован** (один ученик — русский, другой — французский на одном ДЗ).

**Архитектурный сдвиг — CEFR теперь assignment-level (каскад), НЕ per-task:**
- Селектор «Уровень CEFR» + «Язык объяснений AI» — в **L0 конструктора** (`TutorHomeworkCreate`, всегда видно, gated `isLanguageSubject` = french/english/spanish). НЕ в L1 (required-поле в свёрнутой секции = повтор бага «не видела опцию»).
- Хранение остаётся **per-task** (`homework_tutor_tasks.cefr_level`). Селектор каскадит `meta.cefr_level` во **все** задачи: (а) onChange → `setTasks(map cascade)` (триггерит `tasksDirty` через `buildTaskSignature`); (б) belt-and-suspenders в create/update body (`cefr_level: isLanguageSubject ? meta.cefr_level : null` для каждой задачи — покрывает задачи, добавленные после смены уровня).
- Per-task селектор в `HWTaskCard` **удалён** → read-only бейдж «Уровень CEFR: A2 — задан для всего ДЗ».
- Edit prefill: `meta.cefr_level` ← `existingAssignment.tasks[0].cefr_level`; `meta.feedback_language` ← `assignment.feedback_language`.

**CEFR обязателен (kill silent B1):**
- Frontend `validateAll`: language subject + хоть одна письменная/устная задача (`extended`/`proof`/`speaking`) без `meta.cefr_level` → `errs.cefr_level` блокирует save (scroll target `hw-cefr-section`).
- Backend defense (`homework-api/index.ts` create validator): `LANGUAGE_SUBJECTS_REQUIRING_CEFR` (french/english/spanish) + `resolveWriteTaskKind` extended/proof/speaking + нет `cefr_level` → 400 `MISSING_CEFR_LEVEL` (russian phrase).
- Авто-подстановка (bonus, `src/lib/cefrDetect.ts::detectCefrLevelFromText` — explicit-marker mirror, **без** B1-default): при смене subject на язык + cefr пуст → скан `title + task_texts` на «DELF A2»/«A2» → prefill. Для image-задач Эмилии маркера нет → required = backstop.

**Детерминированный язык feedback (`feedback_language`):**
- Миграция `20260531120000` — `homework_tutor_assignments.feedback_language TEXT NULL CHECK IN ('auto','russian','target') DEFAULT 'auto'`. Assignment-level (одна политика на ДЗ).
- `'auto'` = A2 → русские объяснения (примеры на изучаемом), B1+ → иммерсия на изучаемом. `'russian'`/`'target'` — явный override.
- Резолвится в `_shared/subject-rubrics`: `SubjectRubricInput.feedback_language` → `buildResponseLanguageInstruction(subject, cefr, feedback_language)` (`languages-ege.ts`) → `SubjectRubric.response_language_instruction` (optional, null для не-языковых). Инжектится во **все 3 AI-пути**: `guided_ai.ts::buildCheckPrompt`/`buildHintPrompt` (после role+cefr line) + `chat/index.ts` subjectBlock. chat path **server-side подтверждает** `feedback_language` из assignment (anti-tamper).
- SELECT extensions: 3 grading paths (`runStudentAnswerGrading` assignment arg + handleRequestHint + chat) добавили `feedback_language`. `normalizeFeedbackLanguage` helper. evaluateStudentAnswer/generateHint params: `feedbackLanguage`.

**Инварианты:**
- `response_language_instruction` НЕ трогает anti-spoiler/solution/rubric leak — только инструкция стиля ответа.
- Non-language subjects: `response_language_instruction = null`, CEFR не required (физика/математика не затронуты).
- Backward compat: existing French ДЗ с `cefr_level=NULL` грейдились B1 до пересохранения. **Backfill `20260531130000`** проставил уровень из НАЗВАНИЯ ДЗ (Vladimir подтвердил: уровень подписан в title — «DELF A2 …», «… B1 …» — и критерии того же уровня загружены): word-boundary regex `\y(A2|B1|B2|C1)\y` (POSIX `~*`), только NULL + writing/speaking + french, идемпотентно. Titles без явного маркера остаются NULL → tutor задаёт через edit (required форсит).
- `feedback_language` DEFAULT 'auto' покрывает HWDrawer path B (не пишет колонку явно).

**При расширении:** новый язык feedback override → расширь `VALID_FEEDBACK_LANGUAGES` + `buildResponseLanguageInstruction`; CEFR-required для нового языкового subject → добавь в `LANGUAGE_SUBJECTS_REQUIRING_CEFR` (backend) + `isLanguageSubject` (frontend, 3 callsite); язык — assignment-level, CEFR — per-task storage но assignment-level UI (каскад).

Spec: `~/.claude/plans/1-functional-meteor.md` Phase 11.

### Голосовые задания (`task_kind='speaking'`) — voice-speaking-mvp Этап 2

Устный монолог: ученик записывает голос → Whisper транскрибирует → транскрипт идёт в **тот же** `runStudentAnswerGrading` + criteria_breakdown (Этап 1). Аудио сохраняется; репетитор переслушивает в `GuidedThreadViewer`. За feature-флагом тутора (Эмилия). **Статус:** TASK-6..10 ✅; TASK-11 (включить флаг Эмилии + тест на реальной FR-записи) — pending.

**Миграции:** `20260529120000_add_speaking_task_kind.sql` (CHECK через DROP+ADD: `task_kind IN ('numeric','extended','proof','speaking')`, DEFAULT `'extended'` не тронут) + `20260529120100_add_feature_voice_speaking_flag.sql` (`tutors.feature_voice_speaking_enabled BOOLEAN NOT NULL DEFAULT false`, mirror `feature_mock_exams_enabled`; table-level GRANT покрывает — column GRANT не нужен).

**`task_kind='speaking'` НЕ выводится из `check_format` (§0 dual-derive extension).** `'speaking'` = явный выбор тутора. Helper `resolveWriteTaskKind(clientTaskKind, checkFormat)` в `homework-api/index.ts`: `clientTaskKind === 'speaking' ? 'speaking' : deriveTaskKind(checkFormat)`. **Все 4 backend write-path** используют его (НЕ `deriveTaskKind` напрямую) — грепни `resolveWriteTaskKind`/`deriveTaskKind`, speaking-сайтов должно быть 4 (create + 3 update-ветки; update-with-submissions дополнительно ставит `'speaking'` явно, если пришёл без `check_format`).

**Origin — только конструктор (path A).** Селектор «Тип ответа: Письменный / Устный (монолог)» в `HWTaskCard` (за флагом `voiceSpeakingEnabled`, прокинут `TutorHomeworkCreate → HWTasksSection → HWTaskCard`). `DraftTask.task_kind?` → mapping в create/update (`CreateAssignmentTask`/`UpdateAssignmentTask.task_kind?`) → backend. **HWDrawer (path B) speaking НЕ создаёт** (KB-карточки = физ/письм., нет type-селектора) → его `deriveTaskKindFromCheckFormat` корректен. *Forward-invariant (review P2 #2):* если KB начнёт хранить устные задачи — добавить `taskKindSnapshot` в `HWDraftTask` (`src/types/kb.ts`) + `resolveCheckFormatFromKb`-аналог, и persist explicit `'speaking'` в прямом INSERT `HWDrawer.tsx`, иначе устная KB-задача молча станет письменной. **Edit round-trip:** `handleGetAssignment` SELECT включает `task_kind`, detail-тип + prefill (`TutorHomeworkCreate`) его несут — иначе update перетёр бы speaking через derive. **`buildTaskSignature` + `tasksDirty` ОБЯЗАНЫ включать speaking-бит** (`task_kind === 'speaking' ? 'speaking' : null`) — иначе смена ТОЛЬКО типа ответа (без правки других полей) не помечает `tasksDirty` → `patch.tasks` не отправляется → speaking молча не сохраняется (review fix #1; non-speaking уже покрыт `check_format` в сигнатуре). Manual QA item 8.

**Bucket — reuse, без новых.** `voice_ref` = `storage://homework-submissions/{userId}/{assignmentId}/threads/{taskOrder}/...` (тот же namespace, что фото). Валидация **только** через `extractStudentThreadAttachmentRefs(..., allowedExtensions)` — добавлен опциональный 5-й параметр (default `THREAD_ATTACHMENT_EXTENSIONS` → путь фото идентичен); speaking передаёт `THREAD_VOICE_EXTENSIONS` (webm/m4a/mp4/ogg/oga/mp3/wav). Не вручную. SSRF / per-student / bucket whitelist — те же.

**Shared транскрипция:** `supabase/functions/_shared/voice-transcribe.ts` — `transcribeAudio(buf, { language?, mimeType })` (Groq `whisper-large-v3-turbo`, AbortController timeout 45s + 1 retry на 5xx/429/network), `subjectToWhisperLang(subject)` (french→fr/english→en/spanish→es/russian→ru, иначе undefined=auto), `MAX_VOICE_BYTES` (20 МБ, под Groq 25 МБ), типизированная `VoiceTranscriptionError` (`MISSING_API_KEY`/`EMPTY_AUDIO`/`AUDIO_TOO_LARGE`/`TRANSCRIPTION_FAILED`). **PII-free логи** — никогда `text`/транскрипт/тело ответа, только `{status,size,mimeType,lang,durationMs}`. **Bot/chat (`telegram-bot`, `chat/index.ts`) ru-only inline вызовы НЕ рефакторены** (отдельная задача). Требует `GROQ_API_KEY` в Supabase secrets.

**`handleStudentSubmission` speaking-ветка:**
- **Квота (`checkAiQuota`) — ПОСЛЕ всей валидации** (ownership + task load + `voice_ref`/photo), непосредственно перед первой AI-операцией (review fix #3). Невалидный submit (нет/битый `voice_ref`, missing numeric) больше НЕ списывает квоту. Одна единица на валидный submit покрывает обе AI-операции (Whisper + Gemini); пустой STT всё равно списывает 1 (Whisper отработал) — приемлемо.
- `voice_ref` required (иначе 400 `VALIDATION`) → `extractStudentThreadAttachmentRefs(THREAD_VOICE_EXTENSIONS)` → `createSignedStorageUrl` → **`rewriteToDirect()`** (server-to-server fetch, rule 95) → `fetch` → `transcribeAudio(language=subjectToWhisperLang(subject))` → `answerText = transcript` → `runStudentAnswerGrading({ feedbackKind:'check_result' })` (**НЕ дублировать**).
- **`task_kind='speaking'` форсит oral-рубрику (review fix #2):** `runStudentAnswerGrading.taskKind` allowlist включает `'speaking'` → `evaluateStudentAnswer` → `resolveSubjectRubric` → `languages-ege.ts::detectLanguageFormat(forceOral=true)`. НЕ полагаться на `isOralFormat(task_text)` — explicit signal wins (sujet может не содержать «orale»/«монолог», но голос — однозначно устный → иначе DELF oral грейдится по écrite-критериям). Guard: `scripts/test-criteria-templates.mjs` «speaking task_kind forces oral rubric».
- **Пустой транскрипт / сбой Whisper → return ДО insert'а submission + ДО grading** → задача НЕ закрывается (ученик перезаписывает). Friendly RU (rule 97): 422 `VOICE_EMPTY_TRANSCRIPT` / 503 `VOICE_UNAVAILABLE` / 413 `VOICE_TOO_LARGE` / 502.
- `submission_payload = { numeric:'', photos:[], text:'', voice_ref }`. **`voice_ref` живёт в `submission_payload`, НЕ в `image_url`** (голос ≠ картинка; TASK-10 плеер читает `submission_payload.voice_ref`).
- Anti-leak (§9): `solution_*`/`rubric_*` в SELECT для grading, но **только** в `runStudentAnswerGrading`, не в ответ. `submission_payload` без solution/rubric.

**Frontend (student):** `SpeakingComposer.tsx` — self-contained, **СОБСТВЕННЫЙ** `useVoiceRecorder` (не пересекается с discussion-mic — разные task_kind, одновременно не пишут). Запись → **[P0] playback `<audio controls>` ДО отправки + «Перезаписать»** (отправка вслепую запрещена) → «Отправить». **[P1]** хард-кап 7:00 (auto-stop) + warning 6:00; size-cap `MAX_STUDENT_VOICE_BYTES`. `uploadStudentThreadVoice` (`studentHomeworkApi.ts`) — **БЕЗ compression** (audio, не image) → `voice_ref` → `submitSolution({voice_ref})`. **[P0] транскрипт** под лейблом «Распознанная речь» (не raw user-bubble) над `CriteriaBreakdownTable`. **[P1] двухфазный прогресс** «Распознаю речь… → Проверяю по критериям…» (TypingDots). Для speaking chat/numeric/chip-row/SubmitCtaBar/big-CTA **подавлены** (один primary CTA). `SubmitSheet` narrow'ит speaking→`'extended'` (никогда не открывается). `ProblemContext` writing-banner естественно не показывается (только extended/proof).

**Frontend (tutor, TASK-10):** `GuidedThreadViewer.tsx` → module-scope `SpeakingSubmissionPlayer` (на той же поверхности, что «Изменить балл» + `CriteriaBreakdownTable`, при выбранной задаче): **нативный `<audio controls preload="metadata">`** (scrubbing + скорость 1.5× бесплатно — для 5-7 мин фонетики) + транскрипт под «Распознанная речь». Аудио signed URL через `getHomeworkImageSignedUrl(voiceRef, {defaultBucket:'homework-submissions'})` — client `supabase` hardcode'ит хост `api.sokratai.ru` ⇒ URL уже browser-proxied (RU-safe, **НЕ** `*.supabase.co`), отдельный `rewriteToProxy()` не нужен. `voiceRef` берётся из `submission_payload.voice_ref` последней submission задачи (`THREAD_SELECT` его несёт; tutor thread не strip'ит). **Realtime INSERT-merge (`GuidedThreadViewer` + `mergeThreadMessage`) ОБЯЗАН копировать `submission_payload`** (review fix #4) — иначе при live-submit (тред открыт во время сдачи) аудио-плеер не появляется до полного refetch. **Не дублировать** `CriteriaBreakdownTable`. Тайм-коды «клик на момент» / голос-коммент репетитора — **OUT** (Spec §3).

**Guardrails при расширении:** только `useVoiceRecorder` (без новых MediaRecorder-обёрток) · `URL.revokeObjectURL` на unmount + re-record · `touch-action: manipulation` · новый AI-путь с голосом → `transcribeAudio` (не inline Groq) + квота ДО STT · новый voice write-path → `THREAD_VOICE_EXTENSIONS` + `submission_payload.voice_ref` (не `image_url`) · `task_kind='speaking'` персистить явно во всех write-path (грепни `resolveWriteTaskKind`) · browser-facing аудио/фото URL — через client `getHomeworkImageSignedUrl` (уже proxied), server-side fetch — `rewriteToDirect`.

Spec: `docs/delivery/features/voice-speaking-mvp/spec.md` v0.3 §3/§5/§6 + tasks.md TASK-6..11.

### Student assignment load — service_role, draft-tolerant

**Инвариант:** ВСЕ student-facing загрузки ДЗ (`/homework/:id` redirect-entry, problem-screen, list) идут через **service_role edge function** с ownership по `homework_tutor_student_assignments` link — **НЕ** через direct PostgREST на `homework_tutor_assignments` с RLS.

**Почему:** RLS policy «HW students select assigned assignments» (миграция `20260215100000`) фильтрует `status IN ('active','closed')`. Direct `.single()` для `status='draft'` (или RLS edge) возвращал 0 строк → throw → ученик на `/homework/:id` видел «Не удалось загрузить» ДО редиректа на рабочий problem-screen.

**Канонический путь:** `getStudentAssignment` (`src/lib/studentHomeworkApi.ts`) → `GET /assignments/:id/student` (`handleGetStudentAssignment`, service_role) + `GET /assignments/:id/identity` параллельно. Ownership по link, тот же anti-leak whitelist. Backend резолвит `userId` из JWT. 404 только когда ученик реально не привязан.

**При добавлении нового student-facing fetch:** НЕ direct PostgREST на `homework_tutor_assignments` (RLS спрячет draft) — service_role edge endpoint с link-ownership. Whitelist field — расширять edge handler, не клиентский select.

**Известный secondary gap (не критичный):** `listStudentAssignments` (список `/homework`) всё ещё direct PostgREST `!inner` join → draft не появляется в списке. Не блокер; при правке списка — тоже на service_role.

### Эталонное решение для AI и anti-leak

`homework_tutor_tasks.solution_text` + `solution_image_urls` — единое tutor-only поле «Решение для AI». Видно AI на **всех 3 путях** (check/hint/chat) как референс. **НИКОГДА не возвращается ученику.** Миграция `20260418120000_add_homework_task_solution.sql`. `MAX_SOLUTION_IMAGES = 5`.

**DB контракт:** `solution_text TEXT NULL`; `solution_image_urls TEXT NULL` — dual-format (single ref ИЛИ JSON-array), читать только через `parseAttachmentUrls` / `serializeAttachmentUrls`.

**Student leak invariant (КРИТИЧНО):**
- `handleGetStudentAssignment` НЕ селектит `solution_*` и `rubric_*` — проверяется ревью при расширении student endpoints.
- `StudentHomeworkTask` тип (`src/types/homework.ts`, `studentHomeworkApi.ts`) НЕ содержит этих полей (compile-time гарантия).

**AI inject points:**
- `handleCheckAnswer` SELECT включает `solution_text, solution_image_urls` → `evaluateStudentAnswer` → `buildCheckPrompt`.
- `handleRequestHint` SELECT включает `solution_*` + `rubric_*` → `generateHint` → `buildHintPrompt`.
- `/chat` (`chat/index.ts`) — принимает `guidedHomeworkAssignmentId + guidedHomeworkTaskId`; service-role фетчит `solution_*` после верификации `homework_tutor_student_assignments`. Клиент НЕ передаёт текст/фото решения напрямую.

**Anti-spoiler защита:**
- `getGeneratedHintCheck(hint, solutionText, taskText)` в `guided_ai.ts`: extractSignificantTokens из solution минус task givens; reject при совпадении → retry-once → fallback. Telemetry `hint_solution_leak_rejected`.
- `evaluateStudentAnswer` применяет тот же leak-check к `feedback` и `ai_score_comment`. **Retry — cosmetic rewrite**: сохраняет `verdict`/`confidence`/`error_type`/`ai_score` от первого result, свапает только `feedback` + `ai_score_comment`. Grading детерминирован — не менять без осознанного решения.
- `/chat` guided path — **buffered** (не streamed): ответ собирается server-side, leak-детектор, fallback при утечке. Обычные /chat (без guided context) стримятся.

**Image-only anti-leak gate (v3):** `SOLUTION_TEXT_ANCHOR_MIN_CHARS = 20` во всех 3 путях. Если `solution_text.trim().length < 20` — `solution_image_urls` **ДРОПАЮТСЯ** (leak-детектор работает только по тексту; тривиальный anchor не даёт токенов; image-only эталон экстрактируется через «transcribe image» jailbreak). Telemetry `guided_{check,hint,chat}_solution_images_dropped_no_text`. Продуктово: репетитор должен написать ≥ 20 симв текста, если хочет чтобы AI видел фото эталона.

**KB-мост:** `kbTaskToDraftTask` копирует `kb.solution → draft.solution_text`, `kb.solution_attachment_url → draft.solution_image_paths` (truncation до `MAX_SOLUTION_IMAGES`). Возвращает `{ draft, truncatedFrom, solutionTruncatedFrom }` — два toast.

**Templates round-trip:** `HomeworkTemplateTask` содержит `solution_text`, `solution_image_urls`, `rubric_image_urls`. Save: `templateTasksJson` в `handleCreateAssignment`. Load: оба места в `TutorHomeworkCreate.tsx` (URL-param + picker sheet). Новое AI-видимое поле — синхронно обновить тип + оба load path + save path.

### Student Homework Problem Screen — single-task surface + submission contract

Mobile-first single-task screen использует **два student endpoint'а** в `homework-api/index.ts`. Старая `/homework/:id` (`GuidedHomeworkWorkspace`) — для desktop/tablet до Phase 4 cutover.

**Migrations (2):**
- `20260509120000_add_task_kind_to_homework_tasks.sql` — `task_kind text NOT NULL DEFAULT 'extended' CHECK IN ('numeric','extended','proof')` + backfill (`short_answer→numeric`, `detailed_solution→extended`).
- `20260509120100_add_submission_payload_to_thread_messages.sql` — `submission_payload jsonb NULL` + extended CHECK на `message_kind` (NULL OR IN 11 значений включая `'submission'`).

**Endpoint 1 — `GET /student/problem/:hwId/:taskId`** (`handleGetStudentProblem`): single round-trip `{assignment, task, task_total, task_score, thread, student, hints_used}`.
- **Ownership** через `homework_tutor_student_assignments` — 404 `NOT_FOUND` для не-assigned (не 403 — keeps existence private).
- **Lazy thread provisioning** через `provisionGuidedThread` если thread row нет.
- **Whitelist на каждом SELECT'е:** `homework_tutor_assignments`: `id, title, subject, deadline, status` (никаких `notes_for_student`/`tutor_id`/`disable_ai_bootstrap`). `homework_tutor_tasks`: `id, order_num, task_text, task_image_url, max_score, check_format, task_kind` — `solution_*`/`rubric_*` ИСКЛЮЧЕНЫ.
- **Thread hydration** — только через `fetchStudentThread(threadId)` (strip'ит `ai_score_comment` через `stripStudentSensitiveTaskStateFields` + hidden tutor notes через `stripHiddenMessages` + атачит `tutor_profile`). Не дублировать strip-логику.
- `task_score` через `computeFinalScore(target_state, max_score)` — chain `tutor_score_override → earned_score → ai_score → status`.

**Endpoint 2 — `POST /student/problem/:hwId/:taskId/submission`** (`handleStudentSubmission`): body `{numeric: string, photos: string[], text: string}`.

**task_kind requirements (server-side enforced):**
- `numeric` → `numeric.trim()` обязателен; photos игнорируются.
- `extended` → `photoRefs.length >= 1 || textTrim.length > 0`; numeric always optional.
- `proof` → `photoRefs.length >= 1 || textTrim.length > 0`; numeric hidden + ignored.

400 `VALIDATION` с missing field. Defensive default для unknown task_kind = treat как `extended`.

**Photo refs validation** через `extractStudentThreadAttachmentRefs` — Patch B+2 / SSRF / bucket whitelist (`THREAD_ATTACHMENT_BUCKETS = {"homework-submissions", "homework-images"}`) / per-student namespace (`{userId}/{assignmentId}/threads/...`). 400 `INVALID_ATTACHMENT_REF` иначе.

**answerText synthesis** (что AI видит как «ответ ученика»):
```ts
const lines = [];
if (taskKind !== 'proof' && numeric.trim()) lines.push(`Числовой ответ: ${numeric.trim()}`);
if (text.trim()) lines.push(text.trim());
const answerText = lines.length > 0 ? lines.join('\n') : '(см. фото решения)';
```

**Submission row** в `homework_tutor_thread_messages`: `role: "user"`, `message_kind: "submission"`, `content: answerText`, `image_url: serializeThreadAttachmentRefs(photos)`, `submission_payload: {numeric, photos, text}` (JSONB — **строго** structured, никаких raw полей рендеримых как HTML), `task_id`, `task_order: ctx.currentOrder`. **AI feedback row** — `message_kind: "check_result"` (semantically distinct verdict bubble).

**Shared helper `runStudentAnswerGrading` (single source of truth для AI grading):** owns image/OCR/student-name resolution → `evaluateStudentAnswer` → confidence guard → effective `ai_score` derivation → AI feedback message insert (`feedbackKind` param) → verdict branching + state update + `performTaskAdvance`. `handleCheckAnswer` (`feedbackKind='ai_reply'`) и `handleStudentSubmission` (`feedbackKind='check_result'`) используют его. **Не дублировать grading logic** — правь helper.

**Anti-leak invariants (КРИТИЧНО):**
1. `submission_payload` echoed back через `THREAD_SELECT` — raw client input (`storage://` refs, не resolved URLs). Никакой URL transformation.
2. `evaluateStudentAnswer` НЕ получает submission-specific hints в Phase 1 (Phase 2 owns OCR + 4-verdict pipeline).
3. Никакой новой submissions-таблицы (legacy `homework_tutor_submissions` дропнута, не возрождать).
4. `handleStudentSubmission` SELECT включает `solution_text, solution_image_urls, rubric_*` (для grading), но эти поля НЕ возвращаются клиенту — только в `evaluateStudentAnswer` server-side через helper.

**THREAD_SELECT:** добавлен `submission_payload` в nested message select:
```
homework_tutor_thread_messages(id, role, content, image_url, task_id, task_order, message_kind, submission_payload, created_at, author_user_id, visible_to_student)
```
При добавлении нового nullable поля, видимого ученику — расширять `THREAD_SELECT` явно (не `select("*")`).

**THREAD_SELECT task_states invariant (КРИТИЧНО):** ⚠️ **НЕ добавлять `task_order` в `homework_tutor_task_states(...)` subselect** — такой колонки в схеме **нет** (см. `20260306100000_guided_homework_threads.sql`). Добавление → PostgREST 500 на любой THREAD_SELECT → stuck loading + empty chat. Каноничный subselect:
```
homework_tutor_task_states(id, task_id, status, attempts, best_score, available_score, earned_score, wrong_answer_count, hint_count, ai_score, ai_score_comment, tutor_score_override, tutor_score_override_comment, tutor_score_override_at)
```
Frontend resolution `task_order` из task_state — через lookup `assignmentDetails.tasks[].order_num` по `task_id` (`taskById.get(s.task_id)?.order_num`). НЕ читать `s.task_order` напрямую (всегда `undefined`). `HomeworkTaskState.task_order` optional в TS. Понадобится `task_order` на row directly — добавлять колонку через миграцию, не select alias.

**При расширении endpoint'а:**
1. Никакого `select("*")` на `homework_tutor_tasks` / `homework_tutor_assignments` — column whitelist жёсткий.
2. Новое поле в `homework_tutor_tasks`, видимое ученику → явное решение: tutor-only (default, paranoid) / student-visible (требует обоснования).
3. Новое поле в `submission_payload` JSONB (e.g. `voice_ref` Phase 2) — синхронно расширять frontend type (`src/lib/studentProblemApi.ts`) + spec.
4. Новый bucket для photo refs → расширять `THREAD_ATTACHMENT_BUCKETS` И smoke-check грепа `homework_tutor_thread_messages.image_url`.
5. Phase 2 grading pipeline (Gemini OCR + 4 verdict states) — отдельная спека. Шить новый prompt/verdict в `evaluateStudentAnswer` без отдельной spec **ЗАПРЕЩЕНО** («AI = draft + action»).

Spec: `docs/delivery/features/student-homework-problem-screen/spec.md` (Phase 1, AC-1..AC-11).

### Multi-photo на задачу и рубрику

`homework_tutor_tasks.task_image_url` и `rubric_image_urls` — оба dual-format TEXT: single `storage://...` ref (legacy + одно фото) ИЛИ JSON-array `["storage://...", ...]` (2+ фото). Чтение/запись только через `parseAttachmentUrls` / `serializeAttachmentUrls` из `@/lib/attachmentRefs` (Deno-клон `supabase/functions/_shared/attachment-refs.ts`).

**Лимиты (hard):** условие ≤ `MAX_TASK_IMAGES = 5`, рубрика ≤ `MAX_RUBRIC_IMAGES = 3`. `MAX_TASK_IMAGES` импортировать из `@/lib/attachmentRefs`.

**Правила:**
- Не парсить JSON вручную. Не читать поле как строку (single-ref) — всегда через helper.
- `DraftTask` держит `task_image_path: string | null` и `rubric_image_paths: string | null` (dual-format).
- `TutorHomeworkCreate.tsx` НЕ комбинирует `task_image_path || kb_attachment_url` в body — только `task_image_path ?? null` (`kb_attachment_url` = провенанс, не отправляется).
- KB-импорт (`HWTasksSection.kbTaskToDraftTask`) сохраняет до 5 фото из `attachment_url`; > 5 → `toast.info('Из БЗ импортировано 5 из N фото')`.
- Рубрика — ТОЛЬКО репетитору; `getStudentAssignment` не возвращает `rubric_image_urls`.
- Миграция `20260414120000_homework_rubric_images.sql` (additive `ADD COLUMN IF NOT EXISTS`). Legacy single-ref работают без data migration.

Spec: `docs/delivery/features/homework-multi-photo/spec.md`.

### Формат проверки задач (`check_format`)

Колонка `check_format` в `homework_tutor_tasks` определяет как AI проверяет ответ.

**Значения:** `'short_answer'` (default) — краткий ответ; `'detailed_solution'` — развёрнутое решение, AI отклоняет голые ответы без хода (`verdict: INCORRECT`).

**Ключевые решения:**
- Deterministic fast path (`tryDeterministicShortAnswerMatch`) **отключён** для `detailed_solution`.
- `buildCheckFormatGuidance()` в `guided_ai.ts` добавляет enforcement-промпт + hint при коротком ответе (`< 30 символов`).
- KB-импорт приоритет: `task.check_format` → `mapAnswerFormatToCheckFormat(task.answer_format)` → `inferCheckFormat(kim_number)` (КИМ 21-26 → `detailed_solution`). Legacy `answer_format` (`detailed`/`number`/`text`/`choice`/`matching`) маппятся в `mapAnswerFormatToCheckFormat()` (`HWTasksSection.tsx`).

**Student-facing UX:** `StudentHomeworkTask.check_format`; `getStudentAssignment()` грузит из БД; amber notice banner (только `detailed_solution`); dynamic placeholder (`answerPlaceholder` prop). AI bootstrap — `buildGuidedSystemPrompt('bootstrap', { checkFormat })`.

**Файлы:** `guided_ai.ts` (`buildCheckFormatGuidance`, `EvaluateStudentAnswerParams.checkFormat`); `index.ts` (`VALID_CHECK_FORMATS`, create/update/check SELECT); `GuidedChatInput.tsx` (`answerPlaceholder` prop); `src/types/homework.ts`; `studentHomeworkApi.ts`. Миграция `20260401120000`.

**Tutor UI:** `HWTaskCard.tsx` нативный `<select>` (`font-size: 16px` + `touch-action: manipulation` для iOS auto-zoom). Inline badge «из БЗ» когда `kb_task_id` и `max_score > 1`.

Spec: `docs/delivery/features/check-format/spec.md`.

### Ключевые файлы
- `src/lib/studentHomeworkApi.ts` — API-клиент студентов.
- `src/hooks/useStudentHomework.ts` — React hooks студенческого ДЗ.
- `src/components/homework/` — Guided homework UI (GuidedHomeworkWorkspace, GuidedChatInput, GuidedChatMessage, TaskStepper).
- `src/components/tutor/GuidedThreadViewer.tsx` — просмотр guided-чата тутором.
- `src/lib/tutorHomeworkApi.ts` — API-клиент репетиторов.
- `supabase/functions/homework-api/` — Edge function CRUD.
- `supabase/functions/homework-reminder/` — напоминания (cron).

### «Последние действия учеников» + tutor_last_viewed_at

Блок `RecentDialogsBlock` на `/tutor/home` берёт данные из **edge function** `GET /recent-dialogs` (`handleGetRecentDialogs`), не PostgREST (nested `.eq()` через 3 JOIN молча возвращал 0 строк при RLS drift; service_role обходит).

**Инварианты:**
- `homework_tutor_threads.tutor_last_viewed_at TIMESTAMPTZ NULL` (миграция `20260422120000`). `NULL` = «никогда не открыт» = `unread=true`.
- `unread = latestEventAt > (tutor_last_viewed_at ?? 0)` — comparison на edge function, не на фронте.
- `POST /threads/:id/viewed-by-tutor` (`handleMarkThreadViewed`) обновляет timestamp. Ownership: `thread → student_assignment → assignment.tutor_id === auth.uid()`.
- `GuidedThreadViewer` при mount вызывает `markThreadViewedByTutor(threadId)` fire-and-forget + invalidates `['tutor','home','recent-dialogs']` (ref-sentinel — одна сессия на mount).
- Partial index `idx_homework_tutor_threads_student_message_desc`.
- Dedup by `student_id` в Deno (PostgREST не имеет `DISTINCT ON`). `visible_to_student=false` (hidden tutor notes) и `role!='user'` исключаются из latest-student-message lookup.

**Genuine-activity filter (KEEP/DROP — фикс бага «Открыл задачу №1»):** тред показывается ТОЛЬКО при реальной активности ученика: `last_student_message_at IS NOT NULL` **ИЛИ** какой-то task_state имеет `attempts/hint_count/wrong_answer_count > 0` **ИЛИ** `student_opened_at IS NOT NULL` **ИЛИ** `thread.status='completed'`. Иначе тред отбрасывается. Причина бага: `provisionGuidedThread` пишет task_states с `updated_at=now()` при выдаче ДЗ, поэтому старый сигнал `max(task_states.updated_at)` ложно срабатывал на просто выданном (никогда не открытом) ДЗ. **`task_states.updated_at` БОЛЬШЕ НЕ сигнал** «открыл» — не возрождать.

**`student_opened_at` (миграция `20260601120000`, `homework_tutor_task_states`):** реальный сигнал «ученик открыл условие». Записывается в `handleGetStudentProblem` (guarded `IS NULL`-update, fire-and-forget, первое открытие задачи) — открытие иначе не оставляет следа в БД (чистая frontend-навигация). **Service-role only:** НЕ GRANT'ится authenticated (как `tutor_force_completed_by`), НЕ в student-facing SELECT / `THREAD_SELECT`. Без backfill (исторические открытия = NULL).

**Event-feed `kind` (v2.0, payload discriminator) — приоритет high→low при совпадении сигналов:**
1. `completed` — `thread.status='completed'`. Preview «Завершил ДЗ».
2. `stuck` — `max(wrong_answer_count) >= RECENT_DIALOGS_STUCK_WRONG (3)` ИЛИ `max(hint_count) >= RECENT_DIALOGS_STUCK_HINT (3)`. Preview «Застрял на задаче №N».
3. `submitted` — последнее сообщение ученика (`role='user'`, visible) `message_kind ∈ {submission, answer}`. `taskOrder` из `task_order` сообщения. Preview «Сдал задачу №N».
4. `wrote` — последнее сообщение ученика `message_kind ∈ {question, hint_request}` (hint_request → «Попросил подсказку»; иначе content preview).
5. `opened` — `student_opened_at` есть, но НЕТ сообщений и counters. Preview «Открыл условие задачи №N».

Продуктовая цель: различать «не решил, потому что не смог» (`opened`/`stuck`) от «даже не открывал» (тред скрыт фильтром). «Не приступал» вообще — surface в `StudentsActivityBlock` («Нет сдач»), не здесь.

**Инварианты:**
- `latestEventAt = max(last_student_message_at, max(student_opened_at per thread))`. Sort items `latestEventAt DESC`, затем dedup by `student_id` (один ученик = один row, его свежайшее событие).
- `taskOrder`: для `submitted` — `task_order` сообщения; для `stuck`/`opened` — `order_num` соответствующего task_state (embed `homework_tutor_tasks(order_num)` через FK `task_id`); fallback `thread.current_task_order`.
- `unread = latestEventAt > tutor_last_viewed_at`. **Frontend driver = `chat.unread`** (bold name + dot); `unreadCount` (student messages since viewed) — badge при `> 0`, для `opened` всегда 0 → dot.
- `lastAuthor` — **backward-compat only** (wire `'student'`); старые клиенты рендерят чип, новый `ChatRow` branch-ит по `kind`. Палитра/иконка (round 3): gray `opened` (BookOpen) / gray `wrote` (MessageCircle) / blue `submitted` (Send) / green `completed` (CheckCircle2) / **amber `stuck`** (`SokratBearIcon`, чип «Нужна помощь · №N» — тёплый брендовый акцент, **НЕ** красный alarm). Все `.t-chip--*` токены (rule 90). **Чип несёт действие, preview — только название ДЗ** для событий-фактов (`«${hwTitle}»`); для `wrote` preview = текст сообщения (anti-duplication). `eventDescription()` даёт полную фразу для aria/title. `SokratBearIcon` — кастомная line-art SVG (не эмодзи, не кадр мультфильма; rule 90 waiver-таблица).
- Backward/forward deploy: backend auto-деплоится раньше frontend (`deploy-sokratai`); `preview` несёт человекочитаемую строку для каждого `kind` (старый `ChatRow` отрендерит её). `useTutorRecentDialogs.mapItem.normalizeKind` маппит legacy `'task_opened'→'opened'`, `'conversation'→'wrote'`, unknown→`'wrote'`.
- **Prefetch ordering:** без `.order(...)` + LIMIT 500, sort по `latestEventAt` в Deno.
- Новые signal'ы — в Deno-side aggregate, не в SQL GROUP BY.

**Deep-link contract:** `/tutor/homework/:hwId?student=:sid` → `TutorHomeworkDetail` через `useSearchParams` сидирует `expandedStudentId`, scroll один раз per id+student pair. Manual collapse сохраняется.

Spec: `docs/delivery/features/tutor-dashboard-v2/phase-1-follow-up-recent-dialogs.md`.

### Tutor RLS policies on guided-chat tables

На `homework_tutor_threads`, `homework_tutor_thread_messages`, `homework_tutor_task_states` **обязательны** tutor SELECT policies, если tutor-side UI читает их через PostgREST. Базовая `20260306100000_guided_homework_threads.sql` создала только student policies; tutor-specific:
- `thread_messages` — `20260406173000_enable_tutor_realtime_read_homework_thread_messages.sql`.
- `threads` + `task_states` — `20260422130000_add_tutor_select_policies_on_threads_and_task_states.sql`.

**Invariant:** tutor видит threads/task_states только если owner `homework_tutor_assignments` (`tutor_id = auth.uid()`). Все 3 policies используют JOIN-chain `thread → student_assignment → assignment.tutor_id = auth.uid()`.

**Write-path** (`UPDATE`/`INSERT`/`DELETE`) для tutor — **только через edge function `homework-api`** (service_role). Никаких tutor write policies без обоснованной spec.

**Симптом отсутствия policy:** hook возвращает пустой массив, UI показывает «Неактивен» / empty strip / нулевая статистика. Новая tutor-analytics surface, читающая guided-chat таблицу через PostgREST — **обязательно** проверить SELECT policy.

Spec: `docs/delivery/features/tutor-dashboard-v2/phase-1-follow-up-student-activity.md`.

### Group-by-group rendering в StudentsActivityBlock

`StudentsActivityBlock` на `/tutor/home` группирует учеников по `tutor_groups`. Режим Segment-sort `'groups'` рендерит interleaved header rows (`role="rowheader"`, `colspan=7`) + student rows в одном `<tbody>`.

**Инварианты:**
- Default sort = `'groups'` если есть активная группа (`items.some((s) => s.groupId !== null)`); fallback `'attention'` при 0 групп.
- Группы alphabetically по `short_name || name` (`localeCompare('ru')`); «Без группы» в конце.
- `tutor_group_memberships` UNIQUE `(tutor_student_id) WHERE is_active=true` — один активный membership; код читает как `Map<studentId, GroupRow>`. Multi-group → `Map<studentId, GroupRow[]>` + UI решение про primary.
- Fetch errors (RLS/network) не блокируют рендер — hook warning + `groupId=null` для всех.
- `useState` default — lazy initializer (один раз). Группа изменена в другой вкладке — ручной refresh.
- `ActivityRow` memoised поштучно; `GroupRowsFragment` не применяет `React.memo` (section identity нестабилен).

Spec: `docs/delivery/features/tutor-dashboard-v2/phase-1-follow-up-group-by-group.md`.

### GuidedChatMessage perspective contract

`src/components/homework/GuidedChatMessage.tsx` — **shared** renderer для обеих сторон guided chat. Мемоизирован (`memo()`); все props кроме `message` опциональны + backward-compatible defaults. Рендерит и student `GuidedHomeworkWorkspace`, и tutor `GuidedThreadViewer`.

**Four invariants (МУСТ):**

1. **`perspective='student'` (default) backward-compat.** Callsite без `perspective` рендерит как раньше: tutor=left avatar+name, user=right primary bg без identity («я»), assistant=left muted.

2. **`perspective='tutor'` orientation — mirror flip.**
   - `tutor` role → **right**, primary palette (emerald), avatar+name справа.
   - `user` (студент) → **left**, muted bubble, **с** avatar+name.
   - `assistant` (AI) → **left**, **с** AI identity (см. инвариант 4).
   - Шесть props: `studentDisplayName`, `studentAvatarUrl`, `studentGender`, `taskMarker`, `hiddenFromStudent`, `imageResolver`. Все опциональны но работают вместе.

3. **Identity props chain — single source of truth.**
   - `tutor_profile` — из `thread.tutor_profile`. Backend атачит через `resolveTutorProfileForAssignment(db, assignmentId)`. Не дублировать резолвер.
   - `student.display_name` — backend через `resolveStudentDisplayName(db, studentAssignmentId)`. Каскад: `tutor_students.display_name → profiles.full_name → profiles.username (filtered) → null`. Та же функция в AI prompt path (`handleCheckAnswer`/`handleRequestHint`) — изменения каскада влияют на обе поверхности.
   - Frontend defensive fallback в `GuidedThreadViewer`: `student.display_name ?? student.full_name ?? student.username (filtered) ?? "Ученик"`.

4. **AI identity:** `role='assistant'` рендерится с brand-identity на **обеих** сторонах. Avatar = `AI_AVATAR_URL` (`src/assets/sokrat-chat-icon.png`), name = `AI_DISPLAY_NAME` (`'Сократ AI'`) — две константы в `GuidedChatMessage.tsx`. Bubble muted без primary palette. tutorAvatarUrl/tutorDisplayName props для assistant игнорируются (brand consistency).

**Image resolver per-perspective:** tutor uploads → bucket `homework-images`, student-side → `homework-task-images`. `imageResolver?: (ref) => Promise<string | null>` prop, default = `getStudentTaskImageSignedUrl`. Tutor viewer передаёт `(ref) => getHomeworkImageSignedUrl(ref, { defaultBucket: 'homework-images' })`. Новый bucket — обнови оба callsite.

**Student name override:** `GuidedThreadViewer` принимает `studentNameOverride?: string | null` (из `TutorHomeworkDetail.details.assigned_students[*].name`) — **wins over** `student.display_name` своего fetch'а (deploy-independent fix). Каскад: `studentNameOverride → student.display_name → student.full_name → student.username (filtered) → "Ученик"`.

**Timestamp format:** student-side — только `HH:MM` (real-time); tutor-side — дата+время через `showDateInTimestamp` (старые треды). Не убирать без UX-решения.

**Files:** `GuidedChatMessage.tsx`, `GuidedHomeworkWorkspace.tsx` (student callsite), `GuidedThreadViewer.tsx` (tutor callsite + 6 props), `homework-api/index.ts::handleGetTutorStudentThread` (backend атачит `tutor_profile` + резолвит `student.display_name`).

### Realtime thread viewer

- Таблица `public.homework_tutor_thread_messages` должна быть в publication `supabase_realtime`. Каноничная миграция `20260406143000_enable_realtime_homework_tutor_thread_messages.sql`. Scope: только `INSERT` события guided chat; не расширять без отдельной spec.
- `GuidedThreadViewer.tsx` подписывается на `INSERT` с фильтром `thread_id=eq.${threadId}`. Query cache `['tutor','homework','thread', threadId]`.
- **Каноничный merge path:** `mergeThreadMessage()` в `src/lib/tutorHomeworkApi.ts` — дедупит по `message.id`, сохраняет сортировку по `created_at`. Использовать merge-helper, а **не** `invalidateQueries()` (иначе flicker + лишние запросы).
- Cleanup обязателен: `channel.unsubscribe()` в `useEffect` return (критично при rapid expand/collapse и смене `threadId`).
- Sticky-bottom: автоскролл только если репетитор почти внизу. `STICKY_BOTTOM_THRESHOLD_PX = 100`. Если проскроллил вверх — realtime не дёргает scroll.
- Tutor `SELECT` RLS policy для Realtime не строить через raw JOIN на `homework_tutor_threads` внутри `USING (...)` — использовать `SECURITY DEFINER` helper (иначе policy ломается от RLS на промежуточных таблицах).
- Новые realtime-подписки в viewer — только через merge-helper в `tutorHomeworkApi.ts`.

Spec: `docs/delivery/features/realtime-thread/spec.md`.

### LaTeX в деталях и результатах ДЗ
- `TutorHomeworkDetail.tsx` — task_text, correct_answer, student_text, ai_feedback через `MathText`.
- `TutorHomework.tsx` — сортировка (created_desc/deadline_asc) + deadline urgency badges.
- **Правило:** dense surfaces (collapsed headers, lists) → `stripLatex` + truncation; expanded/detail → полный `MathText`.

### GuidedThreadViewer — блок «Условие задачи» + click-to-zoom
- Collapsible-блок «Условие задачи #N» — только при `taskFilter !== 'all'`. Локальный `isTaskContextExpanded` (default `true`, сброс при смене `taskFilter`).
- `task_text` через `MathText`; `max-h-[200px] overflow-y-auto`.
- Изображение — `TaskContextGallery` (module-scope): dual-format `task_image_url` через `parseAttachmentUrls`, batch signed URLs через `/assignments/:id/tasks/:taskId/images`. Tutor-only cache key `['tutor','homework','task-images-preview', assignmentId, taskId]`.
- 1 фото → single-thumbnail zoom; 2+ → ряд миниатюр + fullscreen carousel (counter + стрелки).
- `key={selectedTask.id}` на `TaskContextGallery` — remount закрывает Dialog.
- Не трогать `ThreadAttachments` и student-side `GuidedChatMessage`.

Spec: `docs/delivery/features/thread-viewer-task-context/spec.md`.

### Merged Detail + Results страница
- `TutorHomeworkResults.tsx` **удалён** — функциональность (`ResultsHeader`, `ResultsActionBlock`, telemetry `results_v2_opened`) переехала в `TutorHomeworkDetail.tsx`.
- Каноничный URL — `/tutor/homework/:id`. Route `/tutor/homework/:id/results` = `<Navigate to="/tutor/homework/:id" replace>` (`RedirectHomeworkResultsToDetail` в `App.tsx`) — backward compat для Telegram/push.
- `ResultsHeader` имеет optional `rightSlot?: ReactNode` + `backTo?: string`. Detail передаёт `rightSlot={<DetailActions status=... />}` (status badge + «Редактировать» + «Удалить»). На мобиле icon-only.
- Секция «Задачи» — **collapsible**, свёрнута по умолчанию.
- **Semantic invariant: метрика «Требует внимания»** = `notStarted + per_student.filter(s => s.needs_attention).length`. Backend считает `needs_attention` для сдавших (`final_score < 0.3 × max_score` OR `hint_total >= ceil(tasks.length * 0.6)`), явно `false` для не сдавших и in-progress. Frontend **обязан** прибавлять `notStarted`.
- Условия «Требует внимания» (ИЛИ): (1) не приступал (`notStarted`, frontend); (2) сдал `final_score < 30%` (`lowScore`, backend); (3) сдал + `hint_total >= ceil(tasks.length*0.6)` (`overuse`, backend). **In-progress НЕ входят** — отдельная метрика «В процессе».
- Query keys: Detail использует `['tutor','homework','detail', id]` (assignment) + `['tutor','homework','results', id]` (results). Старый `['tutor','homework','assignment', id]` **больше не используется**.
- `hintTotalByStudent: Map` строится **внутри** `HeatmapGrid` из `results.per_student`.
- Defensive guards обязательны: `results.per_student ?? []` (telemetry useEffect), `perStudent ?? []` + `assignedStudents ?? []` (`ResultsActionBlock.useMemo`), `per_student ?? []` (`HeatmapGrid` useMemo) — backend может транзиентно вернуть response без `per_student`.

### Shared homework status module + tutor homework a11y baseline

Не откатывать без явного решения:
- **Single source of truth для status badge:** `src/lib/homeworkStatus.ts` экспортирует `HOMEWORK_STATUS_CONFIG: Record<HomeworkAssignmentStatus, {label, className}>` + `formatHomeworkScore(score, maxScore)`. Локальные `STATUS_CONFIG`/`formatScore` копии **запрещены**.
- **Subject label = `getSubjectLabel(item.subject as string)`** из `@/types/homework`. Локальные `SUBJECT_LABELS` карты запрещены (legacy `math`/`rus` через `LEGACY_SUBJECT_LABELS`).
- **Никаких subject emoji** на tutor homework карточках (rule 90 Anti-patterns #1). Нужен маркер → Lucide icon. Empty state — Lucide `Inbox` в circular muted bg.
- **`AssignmentCard` — `React.memo` + `animate={false}` + `transition-shadow`** (не `transition-all`). Skeleton cards тоже `animate={false}`.
- **Detail page lookups — `useMemo`:** `expandedStudent`/`expandedPerStudent` обёрнуты в `useMemo([expandedStudentId, details/results])`.
- **Filter group = `<div role="group" aria-label="Фильтр…">` + `<button aria-pressed>`** с `min-h-[44px]` + focus-visible ring. **Не** `<TabsList>`, не bare `<button>` без ARIA.
- **Sort `<select>` — `text-base` (16px) на ВСЕХ viewport-ах** + `aria-label` + `min-h-[44px]`. **Не** `sm:text-sm` (Safari iPad auto-zoom, rule 80).
- **Stats spans — `aria-label` + `title`** оба; lucide icons `aria-hidden="true"`.
- **`TasksList` disclosure:** `aria-expanded` + `aria-controls={panelId}` (`panelId = useId()`), `min-h-[44px]` + focus-visible ring. ChevronDown `aria-hidden`.
- **`TaskImagePreview` ZoomIn button — `aria-label` + `title`**. Декоративный overlay span `aria-hidden`.
- **`MaterialsList.handleOpen` — `toast.error('Не удалось открыть материал')` на ОБА failure path-а** (catch + null url). `alert()` запрещён.

### Homework Student Totals — backend contract

`handleGetResults` возвращает в каждом `per_student` четыре additive-поля:
- `total_score: number` — Σ `final_score` через `computeFinalScore(ts, maxScore)` (приоритет `tutor_score_override → earned_score → ai_score → status`). Не дублировать формулу. Для in-progress — партиальная сумма. `0` для не приступавших и при `total_max === 0`.
- `total_max: number` — `assignmentMaxScoreTotal`, считается один раз вне цикла. **Одинаков для всех `per_student`** — не пересчитывать per-student.
- `hint_total: number` — = `acc.hints`.
- `total_time_minutes: number | null` — wall-clock минуты между min/max `created_at` по тредам **любого статуса**. `Math.max(1, round(diff_ms/60000))`. `null` если нет thread/messages. Фронт: связка `submitted` + `total_time_minutes` для 3-state.

**Time агрегация — два round-trip'а, без N+1 и без RPC:** (1) `homework_tutor_threads` (all statuses) `.in('student_assignment_id', saIds)`; (2) `homework_tutor_thread_messages` `.select('thread_id, created_at')` → группировка в JS в `Map<thread_id, {first,last}>` → `Map<student_id, {first,last}>`. Использует индекс `idx_thread_messages_thread`. **Helper:** `computeTotalMinutes(times)` (защитный `!Number.isFinite(diffMs) || diffMs < 0 → null`).

**TS-тип:** `TutorHomeworkResultsPerStudent` расширен required `total_score`, `total_max`, `total_time_minutes`.

Spec: `docs/delivery/features/homework-student-totals/spec.md`.

### Homework Student Totals — frontend

Три правые колонки в `HeatmapGrid` — Балл / Подсказки / Время (в том же `<table>`, после task cells).

**heatmapStyles.ts — single source of truth для формата времени:** экспортирует `StudentDisplayStatus = 'completed'|'in_progress'|'not_started'` + `formatTotalTime(minutes, status)` (`not_started → '—'`, `in_progress → '— в процессе'`, `completed+null → '—'`, `completed+N → '${N} мин'`). **НЕ дублировать**.

**`<colgroup>`:** после task `<col>` — три: `90px` (Балл), `60px` (Подсказки), `90px` (Время). Table width = `220 + 56·N + 240` px. `width: max-content` + `table-layout: fixed`.

**`<thead>`:** три `<th>`, **не sticky**, `text-right`. Балл имеет `border-l-2 border-slate-200`. «Подсказки» — Lucide `Lightbulb` + `aria-label` + `title`.

**HeatmapRow props:** `totalScore`, `totalMax`, `totalTimeMinutes`, `displayStatus` — scalar (`React.memo` shallow stable). Деривация `displayStatus` в map-loop `HeatmapGrid`: `submitted → 'completed'`; `!submitted && total_time_minutes !== null → 'in_progress'`; иначе `'not_started'`.

**`perStudentByStudent: Map`** — новый `useMemo` рядом с `taskScoresByStudent`/`hintTotalByStudent`. Не консолидировать (поломает TASK-5/6 memoization).

**Рендер `<td>`:** Балл — `completed && totalMax > 0` → `formatScore(totalScore)/formatScore(totalMax)`, иначе `—`. Подсказки — `completed` + overuse → amber chip (`hintOveruseThreshold(taskCount)`, **одна** константа); без overuse → число; иначе `—`. Время — `formatTotalTime(...)`.

**Все новые `<td>` — `text-sm` (14px) + `tabular-nums`.** Чип «Много подсказок» в sticky name column **удалён** — единственный сигнал hint overuse = amber chip в колонке «Подсказки».

**Partial aggregates for in-progress:** backend fetches ALL threads, populates `task_scores` для active (только individually-completed) + партиальные агрегаты. Метрика «В процессе» — отдельная карточка в `ResultsHeader`.

Spec: `docs/delivery/features/homework-student-totals/spec.md`.

### HeatmapGrid (Results v2)

`src/components/tutor/results/HeatmapGrid.tsx` — единая таблица students × tasks (заменил `StudentsList`). Локальный `DeliveryBadge` живёт внутри (не дублировать).

**Backend:** `handleGetResults` возвращает в `per_student` поле `task_scores: { task_id; final_score; hint_count; has_override; ai_score; ai_score_comment; tutor_score_override; tutor_score_override_comment }[]` (см. «Manual score override» ниже). Сборка через `taskScoresByStudent` в основном цикле task_states — `final_score` через `computeFinalScore(ts, maxScore)` (не дублировать). `not_started` → `task_scores: []`; `in_progress` → individually-completed. Отсутствие task_id = серая клетка с em-dash. Не сужать `ai_score` через `?? earned_score` — нужен raw AI score.

**Цвета клеток (single source of truth `getCellStyle`):** `null` → `bg-slate-100 text-slate-400` «—»; `< 0.3` → `bg-red-100 text-red-900`; `0.3 ≤ ratio < 0.8` → `bg-amber-100 text-amber-900`; `≥ 0.8` → `bg-emerald-100 text-emerald-900`. Текст `score/max` через `formatScore()` (trim trailing zero). **НЕ дублировать** color helper — импортировать из `heatmapStyles.ts`.

**Layout (КРИТИЧНО iOS Safari):**
- `<table>`: `border-separate border-spacing-0` + inline `{ tableLayout: 'fixed', width: 'max-content' }` + `<colgroup>` `220px` (имя) + `56px` × N.
- **НЕ менять** на `border-collapse` — `position: sticky` на `<td>` ломается в WebKit (rule 80).
- **НЕ возвращать** `w-full` — table-layout сожмёт колонки и съест scroll.
- Wrapping `<div>`: `overflow-x-auto touch-pan-x` (`touch-pan-x` обязателен, иначе row onClick съест touchstart на iOS).
- Sticky-колонка имени: `sticky left-0 z-10` (`<td>`), `z-20` (`<th>`). Бэкграунд `bg-white`/`bg-slate-50` (не прозрачный).
- Высота клетки `h-11` (44px), `text-sm`.

**Memoization (обязательно):** `React.memo` на `HeatmapRow` + `HeatmapCell` (260 ячеек без memo лагают). `taskScoresByStudent`/`hintTotalByStudent` — `useMemo`. `EMPTY_TASK_SCORES_MAP` — module-scope shared empty map. НЕ оборачивать tasks в useMemo (стабильная ссылка).

**Drill-down:** клик/Enter/Space по строке → `onToggleExpand(student_id)` → один ученик за раз. Раскрытая строка `bg-slate-50` (без `ring-*`). Отдельная Card `StudentDrillDown` под Materials (не inline — sticky-колонка ломается). `expandedStudentId` + `drillDownTaskId` → `null` через useEffect при смене `id`. **Cell click:** `handleCellClick(studentId, taskId)` → set both; `e.stopPropagation()` обязателен.

Spec: `docs/delivery/features/homework-results-v2/spec.md`.

### Manual score override + entry points

**EditScoreDialog инварианты (`src/components/tutor/results/EditScoreDialog.tsx`):**
- Префилл `valueText = currentOverride ?? finalScore ?? aiScore ?? 0`. **НЕ** `aiScore` first — иначе при `currentOverride=null && aiScore=1 && earned_score=0.8` префилит `1`, и сохранение `1` блокируется, хотя создаёт реальный override.
- `isUnchanged` сравнивает только с `currentOverride` (нет override → любое сохранение = создание строки, не no-op).
- Заголовок: `Текущий балл: X/Y (AI: Z/Y, снижено на Δ за подсказки/неверные попытки)`. AI-комментарий отдельной строкой.
- Props (additive): `finalScore: number | null`, `aiScoreComment: string | null` (tutor-only).

**`THREAD_SELECT` invariant:** включает `tutor_score_override, tutor_score_override_comment, tutor_score_override_at` (override visibility ученику и тутору) + `ai_score, ai_score_comment` (tutor edit dialog). `stripStudentSensitiveTaskStateFields` удаляет **только** `ai_score_comment`. Все три override-поля идут к ученику намеренно (UX: ученик видит обе оценки).

**`handleGetResults.task_scores[*]` shape:**
```ts
{ task_id: string; final_score: number; hint_count: number; has_override: boolean;
  ai_score: number | null;             // raw AI (NOT degraded earned_score)
  ai_score_comment: string | null;     // tutor-only — exposed via results endpoint
  tutor_score_override: number | null;
  tutor_score_override_comment: string | null; }
```

**Entry points (два, оба обязательны):**
1. **Primary — `GuidedThreadViewer`:** под header'ом «Условие задачи #N» строка `Балл: X/Y · AI: Z/Y · [chip ручная правка] · [Pencil] Изменить балл`. Только при `selectedTask !== null` + task_state существует. На мобиле icon-only.
2. **Secondary — `TaskMiniCard` Pencil:** 12px иконка в углу мини-карточки drill-down.

Оба mount'ят один `EditScoreDialog`.

**Student dual-score visibility:** `HomeworkTaskState` расширен `ai_score`, `ai_score_comment` (tutor-only — strip удаляет), `tutor_score_override`, `tutor_score_override_comment`, `tutor_score_override_at`. `TaskStepper` tooltip: override → `Балл репетитора: X/Y` + `AI: Z/Y` + публичный комментарий; без override → `Балл: X/Y` (resolved final_score). `GuidedHomeworkWorkspace` completed view: итог через **`final_score` sum** (mirror `computeFinalScore`, не `earned_score`); секция «Правки репетитора» при `tasksWithOverride.length > 0`.

**При расширении:** новый source балла (e.g. `peer_score`) → расширяй `computeFinalScore` priority chain в backend + mirror'ь в client-side helpers (`taskStepItems` в `GuidedHomeworkWorkspace`, `selectedTaskFinalScore` в `GuidedThreadViewer`) — три mirror'а уже на грани. Новое tutor-only поле в task_state → добавляй в `stripStudentSensitiveTaskStateFields`.

**Heatmap cell inclusion invariant:** task_state попадает в `taskScoresByStudent` cellMap И в accumulator `studentAcc/activeStudentAcc.{final,max,hints}` при ЛЮБОМ scoring-сигнале:
- `status === 'completed'`, ИЛИ `tutor_score_override !== null` (ручная правка даже на active task), ИЛИ `ai_score !== null` (partial AI scores ON_TRACK/INCORRECT).
- Skip: thread активен И ни один сигнал (`provisionGuidedThread`-stub `status='active'` без override и ai_score) — защита от false-zero.
- Side effect: aggregate `acc.final`/`acc.max` для in-progress включают partial AI scores. `lowScore = acc.max > 0 && acc.final < 0.3 * acc.max` остаётся консистентным.
- Симптом нарушения: override в БД, но клетка показывает «—». Грепнуть `if (!isCompleted && !isTaskCompleted` в `homework-api/index.ts` — должно быть `&& !hasOverride && !hasAiScore`.

### Tutor force-complete + reopen + bulk

Репетитор может вручную закрыть задачу в guided homework без AI verdict (use-case: не-физические предметы, где AI verdict path не всегда работает — см. «Subject-rubric layer»).

**Schema:**
- `homework_tutor_task_states.tutor_force_completed_at TIMESTAMPTZ NULL` (migration `20260516120000`) — видна ученику (бейдж «Закрыто репетитором»). NULL = AI-CORRECT verdict ИЛИ статус не completed.
- `tutor_force_completed_by UUID NULL` — audit-only, tutor_id. **Strip'ается** в `stripStudentSensitiveTaskStateFields` И не GRANT'ится на authenticated (migration `20260516120100`).

**Column GRANT whitelist (КРИТИЧНО, defense-in-depth, migration `20260516120100`):** REVOKE SELECT на `homework_tutor_task_states` FROM anon/authenticated, затем GRANT только safe columns. **Three tutor-only fields НЕ грантятся** на authenticated: `ai_score_comment`, `tutor_score_override_by`, `tutor_force_completed_by` (PostgREST с user JWT не может прочитать — permission error; доступ только service_role). При добавлении новой клиентской колонки — **ОБЯЗАТЕЛЬНО** расширить GRANT в новой миграции. При добавлении tutor-only audit колонки — не GRANT'ить + обновить strip (double layer).

**Atomic RPC functions (миграции `20260516120200` + `20260516120300`):** force-complete и bulk-close используют SECURITY DEFINER RPC вместо multi-query (transactional atomicity; иначе partial-failure → неконсистентное состояние, retry не лечил).

| RPC | Назначение | Args | Returns | Errors |
|---|---|---|---|---|
| `hw_tutor_force_complete_task` | Single-task close + advance + system message | `assignment, student, task, tutor, score?, comment?` | `JSONB { task_state_id, final_status, final_score, advanced_to_task_id, thread_completed }` | `ASSIGNMENT_NOT_OWNED` (42501), `TASK_NOT_FOUND`/`THREAD_NOT_FOUND`/`TASK_STATE_NOT_FOUND` (42704), `TASK_NOT_ACTIVE` (22023, **race guard**), `SCORE_OUT_OF_RANGE`/`SCORE_STEP_INVALID` (22023) |
| `hw_tutor_force_complete_all_tasks` | Bulk close + thread cursor reconcile | `assignment, student, tutor` | `JSONB { closed_count, advanced_to_task_id }` | `ASSIGNMENT_NOT_OWNED`, `THREAD_NOT_FOUND` |

**Race guard `TASK_NOT_ACTIVE` (КРИТИЧНО):** двойной клик «Сохранить и закрыть» — оба request'а проходят edge pre-check, второй RPC ждёт `FOR UPDATE` lock, видит already-completed row, **RAISE EXCEPTION** вместо silent double-write. Edge function → **409 Conflict**. Без guard'а — перезапись marker timestamp + duplicate system message.

**REVOKE/GRANT:** обе RPC `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role` (клиент не может через PostgREST `.rpc(...)`).

**При расширении:** новый transactional action на `homework_tutor_task_states` (e.g. `skip_task`) — новая RPC (multi-query flow НЕ воспроизводить). Изменение body существующей RPC — `CREATE OR REPLACE` в новой миграции (GRANT/REVOKE сохраняется от первой).

**Anti-leak инварианты:**
1. `tutor_force_completed_by` — strip + не GRANT'ится.
2. `tutor_force_completed_at` — видна ученику (нужно для бейджа). GRANT'ится.
3. RPC возвращает `final_score` через priority chain (override → earned → ai → max) safely. Не raw `tutor_force_completed_by`.
4. `THREAD_SELECT` включает оба поля; `fetchStudentThread` → strip; `fetchFullThread` (tutor) — оставляет.

**Reopen path:** только для `tutor_force_completed_at !== NULL` (AI-CORRECT **не** reopen'абельны). Edge function (НЕ RPC) — single UPDATE на `status='active'` + clear marker + thread status flip. 409 `AI_COMPLETED_NOT_REOPENABLE` для reopen AI-CORRECT.

**UX контракт (EditScoreDialog footer):** one primary CTA `Сохранить балл` ИЛИ `Сохранить и закрыть задачу` (label по checkbox state). Checkbox «Закрыть задачу после сохранения» — default ON, ТОЛЬКО при `status === 'active'` (для completed скрыт). Derived flag `willCloseAfterSave = showCloseCheckbox && closeAfterSave` — single source of truth. Ghost CTAs: `Сбросить правку` (если override exists) + `Открыть задачу обратно` (если force-completed by tutor, AlertDialog).

**Bulk action (`StudentDrillDown` → `force-complete-all-tasks`):** counter `activeTasksCount = taskMeta.filter(t => t.status === 'active').length` — **строго совпадает** с RPC `WHERE status = 'active'`. Не `!== 'completed'`. AlertDialog подтверждение.

**Telemetry (PII-free):** `homework_task_force_completed` (`{ assignmentId, studentId, taskId, source: 'dialog'|'bulk', hadScore }`, fired при `mode === 'save' && willCloseAfterSave`), `homework_task_reopened`, `homework_bulk_force_completed`. `manual_score_override_saved` (existing) — **ТОЛЬКО** для `mode === 'save'|'reset'` (reopen preserves `currentOverride` → не logging).

**Student-side visibility:** `TaskStepper` circle `UserCheck` вместо `Check` при `tutor_force_completed_at !== null`. `HomeworkProblem` mobile big-CTA subtitle `'Закрыто репетитором'`. `SubmitCtaBar` optional `isTutorClosed` prop. `GuidedHomeworkWorkspace` completed view: секция «Закрыто репетитором».

Spec: `~/.claude/plans/lexical-brewing-gadget.md`.

### Tutor review «галочка проверено» (`tutor_reviewed_at`)

R1 фичи «Прогресс по ученикам» (student-progress): репетитор подтверждает AI-черновик балла перед показом ученику/родителю. Паритет с approve-экраном пробника (rule 45), но через **новую ортогональную колонку**, НЕ через `status`.

**Schema (`homework_tutor_task_states`, миграция `20260602090000`):**
- `tutor_reviewed_at TIMESTAMPTZ NULL` — подтверждено репетитором. **Видна ученику** (бейдж «Проверено»). Явный `GRANT SELECT (tutor_reviewed_at) ... TO authenticated` (после table-level REVOKE из `20260516120100` новые колонки НЕ грантятся автоматически).
- `tutor_reviewed_by UUID NULL` — audit, **tutor-only**: НЕ GRANT'ится authenticated + добавлена в `stripStudentSensitiveTaskStateFields` (mirror `tutor_force_completed_by`).

**Ортогональность `status` (КРИТИЧНО):** `tutor_reviewed_at` ≠ `status` ≠ `tutor_force_completed_at`. Задача может быть `completed` (AI-CORRECT) но `reviewed_at IS NULL` (ждёт подтверждения). Reopen-review (`hw_tutor_reopen_review`) чистит **только** флаг — status НЕ трогает. Bulk-review **не меняет** баллы/статус.

**RPC (миграция `20260602090100`, SECURITY DEFINER, `REVOKE ALL FROM PUBLIC` + `GRANT service_role`, race-guard как force-complete):**
- `hw_tutor_review_task(assignment, student, task, tutor, score?, comment?)` — ставит `tutor_reviewed_at`+`tutor_reviewed_by` (+опц. override). **Для `status='active'` делегирует закрытие/advance существующему `hw_tutor_force_complete_task` через `PERFORM`** (re-entrant `FOR UPDATE` в одной транзакции безопасен → НЕ дублируем advance). Для `completed` — только флаг (+override). Race-guard: `tutor_reviewed_at IS NOT NULL` → `ALREADY_REVIEWED` (22023 → 409).
- `hw_tutor_review_all_ai(assignment, student, tutor)` — bulk: флаг всем `ai_score IS NOT NULL AND tutor_reviewed_at IS NULL`. **Баллы/status не трогает.** Returns `{reviewed_count}`. **WHERE строго совпадает** с frontend `reviewableCount` (mirror `activeTasksCount` инвариант).
- `hw_tutor_reopen_review(assignment, student, task, tutor)` — `tutor_reviewed_at=NULL`. Race-guard `NOT_REVIEWED` (22023 → 409).

**Edge (`tutor-progress-api`, новый, `verify_jwt=true` per spec §3, config.toml + deploy workflow без `--no-verify-jwt`):** `POST /assignments/:id/students/:sid/{review-task,review-all-ai,reopen-review}`. Тонкие обёртки над RPC + GoTrue auth → userId как `p_tutor_id` (ownership внутри RPC). Ошибки **rule 97 flat-shape** `{ error: "<рус>", code }`. Будущие R2-эндпоинты (агрегат/обзор/цель) — в этот же роутер.

**Client (`src/lib/tutorProgressApi.ts`):** `reviewTask` / `reviewAllAi` / `reopenReview` через свой `requestTutorProgressApi` (НЕ `extractApiErrorMessage` — он трактует строковый `error` как code; flat-shape парсится напрямую). Инвалидация: `['tutor','homework',{results,detail}, id]` + `['tutor','homework','thread', id, studentId]`.

**Read-path wiring (homework-api):** `THREAD_SELECT` + `handleGetResults.task_scores` несут `tutor_reviewed_at`. Студент видит через `fetchStudentThread` (strip оставляет `tutor_reviewed_at`, убирает `tutor_reviewed_by`).

**Frontend surfaces (reuse, НЕ новый /review-роут):**
- `EditScoreDialog` — чекбокс «Подтвердить задачу» (default ON, скрыт если reviewed) → `reviewTask`; CTA «Сохранить и подтвердить»/«Подтвердить»/«Поставить балл и подтвердить» (manual без AI); review закрывает force-complete-чекбокс на active; ghost «Снять подтверждение» → `reopenReview`; **anti-leak плашка** (ShieldCheck, нейтральный фон). Override шлётся только если балл/коммент менялись («AI-балл не перезаписывается») **ИЛИ `aiScore == null`** (manual/no-AI: `finalScore` приходит `0`-fallback'ом, поэтому ввод балла `0` иначе выглядел бы как «не изменилось» → `score:null` → force_complete → итог fallback'ился в max; **`reviewWantsOverride` ОБЯЗАН включать `aiScore == null`**, иначе manual-`0` молча даёт максимум).
- `GuidedThreadViewer` per-task row: бейдж «Проверено» + быстрая «Подтвердить» (только `ai_score != null`; manual → диалог).
- `StudentDrillDown`: bulk «Подтвердить всё, что AI проверил ({reviewableCount})» + **AlertDialog** → `reviewAllAi`. `TaskMiniCard` — `isReviewed` BadgeCheck-индикатор.
- `StudentProgressPanel` (R2, встроен ПЕРВОЙ вкладкой «Прогресс» в карточку ученика `TutorStudentProfile` — UX-fix 2026-06-04, Эмилия не нашла задания в карточке): сверху **«Требует моей проверки сейчас»** (actionable, фикс Q3), затем цель/метрики/работы. Page-level bulk «Подтвердить всё…» — **через AlertDialog** (паритет, spec §4.3); loop `reviewAllAi` per assignment, ловит per-assignment 409 `NOTHING_TO_REVIEW`/`ALREADY_REVIEWED` и продолжает. Старый `/tutor/students/:id/progress` → redirect на карточку.
- Student: «Проверено» приоритет над «Закрыто репетитором» в `SubmitCtaBar` / `HomeworkProblem` big-CTA / `TaskStepper` tooltip.

**`hw_tutor_review_all_ai` race-guard (spec §10):** атомарный условный `UPDATE ... WHERE tutor_reviewed_at IS NULL` уже не допускает double-write, но при 0 строк бросает **`NOTHING_TO_REVIEW` (22023 → 409)** — explicit сигнал клиенту «обновись» (паритет с per-task 409). Кнопка bulk видна только при count>0, поэтому в норме 409 не бывает; loop на странице ученика обрабатывает gracefully.

**Телеметрия (PII-free):** `task_reviewed` (`{assignmentId, studentId, taskId|null, source:'single'|'dialog'|'bulk', hadOverride, reviewedCount?}`), `task_review_reopened`.

**При расширении:** новое scoring/review-действие на `task_states` → новая SECURITY DEFINER RPC (multi-query НЕ воспроизводить); review-флаг — explicit-orthogonal (не выводить из status); bulk-count на фронте = RPC WHERE; manual/no-AI grade → персистить override даже при значении `0` (`aiScore == null` → always-override).

Spec: `docs/delivery/features/student-progress/spec.md` (§2.1, §3.1, §4.3, §5, §8 R1) + `~/.claude/plans/senior-scalable-scott.md`.

### Прогресс по ученикам R2 — агрегат ДЗ+пробники (`tutor-progress-api`)

Кросс-ученический обзор «Успеваемость» + страница ученика `/tutor/students/:id/progress` (агрегат всех работ «по ученику»). Read-only эндпоинты в **существующей** `tutor-progress-api` (R1 review там же). v1 = физика-ЕГЭ; ОГЭ/школа — UI-каркас.

**Цель — reuse `tutor_students` (НЕ новая таблица, решение Vladimir 2026-06-02):** `target_score`/`exam_type`/`subject` уже есть. `PATCH /students/:id/target` пишет туда (ownership через `tutors.id`). `tutor_student_targets`/multi-subject/school-target — P2.

**Эндпоинты (service_role + Deno-агрегация, без N+1, column-whitelist):**
- `GET /students/progress-overview` — items[]: scale-agnostic метрики (`pct_to_goal`, `reviewed_pct`) + **два сигнала раздельно** `signals:{review_backlog, overdue, behind_goal, declining}` (risk ≠ backlog; mirror `usp/data.js`). Группы через `tutor_group_memberships`. **Сырого балла НЕТ** (нельзя сравнить 100-шкалу и оценку 2–5).
- `GET /students/:id/progress` — `{student, target, works[], summary}`. works = ДЗ (`score_kind:'primary'`) + пробники (`ege_scaled`). `reviewed` ДЗ = `reviewed_count==total` (Q1); пробник = `status IN (approved, manually_entered)`. `current_level` = scaled последнего подтверждённого пробника (Q2; нет → null + «нужен пробник»). cells = только score/max.
- `PATCH /students/:id/target` — UPDATE `tutor_students` (track ege 0-100 / oge 2-5; school → 400, каркас).

**Инварианты (КРИТИЧНО):**
- **FK-конверсия (rule 40):** `tutor_students`/группы — через `tutors.id` (resolveTutorPkId: `auth.uid → tutors.id`); homework/mock assignments — `auth.uid` напрямую (их `tutor_id` → `auth.users.id`). `resolveTutorPkId` обязателен перед любым `tutor_students` JOIN.
- **`computeFinalScore` НЕ дублирован** — вынесен в `supabase/functions/_shared/score-compute.ts`, импортируют ОБА (`homework-api` + `tutor-progress-api`). `TaskStateScoreFields` структурно совместим с `FinalScoreFields`.
- **Шкалы — mirror-synced** `src/lib/scoreScales.ts` ↔ `supabase/functions/_shared/score-scales.ts` (`EGE_PHYS_2026.map`, `egePrimaryToScaled`, `ogeMark`). Smoke-guard секция 10 (`egePrimaryToScaled(21)=59`, 46 entries, map-drift). Цвет ячеек = % от max везде (`getCellStyle`), exam-agnostic. **НЕ усреднять разные шкалы в «средний /5»** (Q2).
- **Anti-leak (spec §5):** агрегат НЕ селектит `solution_*`/`rubric_*`/`ai_score_comment`/hints; cells = score/max; пробник — только агрегаты подтверждённого (rule 45 state-aware).
- **Frontend:** подвкладка `StudentsProgressOverview` (tab `?view=progress` в `TutorStudents`); **`StudentProgressPanel` встроен ПЕРВОЙ вкладкой «Прогресс» (default) в карточку `TutorStudentProfile` `/tutor/students/:id`** (UX-fix: репетитор кликает ученика → сразу видит работы, а не пустой профиль). `:id` = `tutor_students.id`. Старый `/tutor/students/:id/progress` → `RedirectStudentProgressToCard`. Клик по ученику в overview/home-блоке → `/tutor/students/:id` (карточка). Drill-down работы → navigate `/tutor/homework/:id?student=` (реюз R1 HeatmapGrid/StudentDrillDown, НЕ embed). Home-блок `StudentsAtRiskBlock` (reuse overview-query cache). Новые `useQuery` → `refetchOnWindowFocus:false`. Перф 100+: `React.memo` строки (без virt-deps).

Spec: `spec.md` (§2.2 revised, §3.2/§3.3, §4.0-4.2, §8 R2, §11 Q1-Q3) + `~/.claude/plans/senior-scalable-scott.md` (R2).

### Drill-down (Results v2)
- `src/components/tutor/results/heatmapStyles.ts` — single source of truth для `getCellStyle` + `formatScore` (вынесено из `HeatmapGrid.tsx` — react-refresh/only-export-components). **НЕ дублировать** color/format helpers.
- `src/components/tutor/results/TaskMiniCard.tsx` — `React.memo`. Props `{ taskOrder, taskId, score, maxScore, hintCount, isSelected, isAllTasks?, onSelect }`. Цвет через `getCellStyle`. `ring-2 ring-slate-800 ring-offset-1` при selected. Lucide `Lightbulb` 12px при `hintCount >= 1`. `touch-action: manipulation`, `aria-pressed`, `role="button"`, `tabIndex={0}`.
- `src/components/tutor/results/StudentDrillDown.tsx` — контейнер. Scroll-ряд («Все задачи» + `TaskMiniCard[]`) + `GuidedThreadViewer`. `key={selectedTaskId ?? 'all'}` форсит ремоунт viewer (сброс realtime channel/context/scroll). `hideTaskFilter={true}`. `touch-pan-x` на scroll-ряду. Нет вложенных Card.
- `GuidedThreadViewer` props (additive): `initialTaskFilter?: number | 'all'` (default `'all'`), `hideTaskFilter?: boolean` (default `false`).
- `TutorHomeworkDetail` state `drillDownTaskId: string | null`. `handleCellClick = useCallback(...)` set both; `handleToggleExpand` сбрасывает `drillDownTaskId` при collapse / expand другого.
- Telemetry `drill_down_expanded` — payload `{ assignmentId, studentId, firstProblemTaskOrder }`. Fired один раз (через `lastDrillTrackedRef`). `firstProblemTaskOrder`: первая где `< 0.3 || hint_count >= 1`; иначе первая `< 0.8`; иначе `null`.

### Реминдер ученику с выбором канала
- `RemindStudentDialog.tsx` — Radix Dialog с **tabs** `[Telegram] [Email]`. Default = Telegram если `hasTelegram`, иначе Email. Недоступные табы `disabled` + `aria-disabled` + `title`. Props: `hasTelegram: boolean` + `hasEmail: boolean`. `<textarea>` — `text-base` (16px).
- `ResultsActionBlock.tsx` — «Напомнить» дизейблится если `!hasTelegram && !hasEmail` (`title="Нет каналов"` + `MailX`). Label: оба → `Напомнить`, только email → `Напомнить на email`, ни одного → `Нет каналов`.
- Backend `handleGetAssignment` возвращает на assigned student: `has_telegram_link` (через `profiles.telegram_user_id` OR `telegram_sessions.user_id`), `has_email` (через `auth.admin.getUserById`, фильтр `@temp.sokratai.ru`).
- Backend `POST /assignments/:id/students/:sid/remind` принимает optional `channel: 'auto'|'telegram'|'email'`. `'auto'` (default) = cascade Telegram → Email. `'telegram'` explicit = только Telegram (422 `NO_TELEGRAM`, 502 `TELEGRAM_FAILED` без fallback). `'email'` explicit = только Email (422 `NO_EMAIL`).
- Push-канал вне P0. Telemetry `telegram_reminder_sent_from_results` принимает `channel: res.channel` из ответа.

### Общий комментарий репетитора к ДЗ — `tutor_overall_comment` (Phase 12, 2026-06-07)

Репетитор оставляет **один свободный комментарий ко ВСЕМУ ДЗ** конкретному ученику (per-student wrap-up, напр. «Вася, ты молодец, но было две ошибки на закон Ома, повтори его»). Запрос Елены Ивановой. **НЕ путать** с пер-задачным `tutor_score_override_comment` (комментарий к правке балла одной задачи).

**Хранение:** `homework_tutor_student_assignments.tutor_overall_comment TEXT` + `tutor_overall_comment_at TIMESTAMPTZ` + `tutor_overall_comment_by UUID` (миграция `20260607140000`). Per-student link-таблица (1:1 на пару ученик+ДЗ). **GRANT:** таблица использует table-level GRANT + RLS (НЕ column-grant whitelist как `homework_tutor_task_states`) → новые колонки покрыты, отдельный GRANT не нужен.

**Anti-leak:**
- `tutor_overall_comment` + `_at` — **student-visible BY DESIGN** (mirror `tutor_score_override_comment`). Отдаются ученику через `handleGetStudentProblem` / `handleGetStudentAssignment` (service_role) + RLS list-select (бейдж).
- `tutor_overall_comment_by` — **audit-only, НИКОГДА не в client-ответ** (mirror `tutor_force_completed_by`). Ни один student/tutor SELECT его не возвращает.

**Single write-path** — `POST /assignments/:id/students/:sid/overall-comment` (`handleSetStudentOverallComment`): ownership `getOwnedAssignmentOrThrow` + проверка link-row (anti id-spoofing, mirror `handleRemindStudent`); пусто/пробелы → очистка (NULL); `OVERALL_COMMENT_MAX = 2000`; UPDATE comment+_at+_by. **Notify push→telegram (БЕЗ email)** через `notifyHomeworkOverallComment` (sibling `notifyHomeworkStudentAssigned`) **ТОЛЬКО** на непустой ИЗМЕНЁННЫЙ текст (очистка/неизменный — без notify). Rule-97 ошибки. PII-free telemetry `homework_overall_comment_saved` (без текста/имён).

**Read-paths (3):** `handleGetResults` → `per_student[*].tutor_overall_comment(+_at)` (post-pass из `overallCommentByStudent`); `handleGetStudentProblem` + `handleGetStudentAssignment` → `assignment.tutor_overall_comment(+_at)`; `listStudentAssignments` (direct PostgREST `!inner`) → `has_tutor_comment: boolean` (только факт, текст не грузится).

**Frontend:**
- Tutor write: `StudentDrillDown.tsx::OverallCommentCard` — **первым элементом** drill-down (над mini-cards). Read/edit/save inline (`useAutoResizeTextarea` + `setStudentOverallComment` + invalidate results/detail). Toast «…ученик уведомлён» / «…(нет каналов)».
- Student read: `TutorOverallCommentCard.tsx` (accent-card, `MessageSquare`, plain text) на `HomeworkProblem` (left aside + mobile peek) при непустом `assignment.tutor_overall_comment`. Бейдж «Комментарий репетитора» на карточке `StudentHomework`.
- **Review-режим завершённого ДЗ (КРИТИЧНО):** `StudentHomeworkDetail` all-completed БОЛЬШЕ НЕ редиректит на `/homework` — открывает последнюю задачу в режиме просмотра (current → last by order_num → first), чтобы ученик увидел комментарий. **Loop-guard:** `HomeworkProblem` НЕ авто-bounce'ит на mount; завершение последней задачи уходит на `/homework` напрямую (`navigateAfterCorrect`), минуя detail-страницу. При правке этого редиректа — повторно проверить отсутствие redirect-loop (это была preview-QA #10 fix).

**При расширении:** новое per-student tutor-поле, видимое ученику → решить tutor-only vs student-visible (default paranoid); audit-`_by`-поля не GRANT'ить и не селектить в client; новый notify-повод — reuse `notifyHomeworkStudentAssigned`-паттерн (push→telegram, без email); telemetry-событие — добавить в типизированный реестр `homeworkTelemetry.ts` (иначе build падает).

Spec/build-лог: `~/.claude/plans/1-functional-meteor.md` Phase 12.

### Homework share links / public `/p/:slug`

`homework_share_links` (migration `20260422160000`) — множественные read-only ссылки на одно ДЗ с флагами `show_answers` / `show_solutions` / `expires_at`. Tutor CRUD в `homework-api/index.ts`; публичное чтение — отдельный edge function `public-homework-share` под `service_role`. Множественные ссылки на одно ДЗ **разрешены намеренно** (родителю без ответов, коллеге с ответами) — не дедуплицировать.

**Tutor API (три route'а):**
- `POST /assignments/:id/share-links` — body `{ show_answers, show_solutions, expires_in_days? }` (positive int ≤ 365). Slug = `crypto.randomUUID().replace(/-/g, "").slice(0, 8).toLowerCase()` (`generateShareLinkSlug()`, retry на UNIQUE collision ≤ 3). Ownership `getOwnedAssignmentOrThrow`. Response `{ slug, url, ... }` где `url = getShareLinkAppBaseUrl() + /p/ + slug`.
- `GET /assignments/:id/share-links` — фильтр `created_by = tutorUserId`, sort `created_at DESC`, `{ items }`.
- `DELETE /share-links/:slug` — ownership через `.eq('created_by', tutorUserId)`; `.select('slug')` после delete: 0 строк → 404 (не раскрываем чужие slug'и).

**Инварианты:**
- Slug regex `/^[a-z0-9]{8}$/i` (`SHARE_LINK_SLUG_RE`) валидируется в DELETE **до** DB-запроса. Public endpoint применяет тот же regex независимо; при смене формата слага — синхронно обновить обе стороны.
- `getShareLinkAppBaseUrl()` читает `PUBLIC_APP_URL` env (обязателен в prod), fallback `https://sokratai.lovable.app`. URL генерится **серверно**.
- Публичное чтение **НЕ через RLS** tutor-side (RLS policy `Tutors manage own share links` защищает только authenticated PostgREST). Public endpoint — `service_role`.

**Frontend (`ShareLinkDialog.tsx`):** Radix Dialog. API `createHomeworkShareLink` / `listHomeworkShareLinks` / `deleteHomeworkShareLink` в `tutorHomeworkApi.ts`. Query key `['tutor','homework','share-links', assignmentId]`. Toggle «Истекает через 30 дней» (один option). Clipboard: primary `navigator.clipboard.writeText` (guard `window.isSecureContext`) + fallback `document.execCommand('copy')` через hidden textarea (**не удалять** — http preview / Safari < 15.4). Telemetry `homework_share_link_created` (один раз; PII-free `{ assignmentId, showAnswers, showSolutions, hasExpiry }` — **без slug, без url**).

**Не путать:** `homework_share_links.slug` — public bearer-token, не FK к ученику, не раскрывает кто решал.

### Public share endpoint `/p/:slug`

Edge function `supabase/functions/public-homework-share/index.ts` — read-only snapshot ДЗ по slug'у. **Единственный публичный endpoint**, трогающий `homework_tutor_*`. Frontend `src/pages/PublicHomeworkShare.tsx` на route `/p/:slug` **вне AppFrame** (sibling к `/invite/:inviteCode`).

**Endpoint контракт:**
- `GET /share/:slug` — **без JWT**. Slug через regex `/\/share\/([^/?#]+)$/` на `URL.pathname`.
- CORS `Access-Control-Allow-Origin: *` + `GET, OPTIONS`. `service_role` client с `auth.persistSession: false`.
- Slug regex `/^[a-z0-9]{8}$/i` (`SLUG_RE`) **обязательно до DB-запроса** → `invalid_slug` 400. Должен совпадать с tutor-side `SHARE_LINK_SLUG_RE`.

**Anti-leak — column-whitelisted SELECT (КРИТИЧНО):**
- `homework_tutor_assignments`: **только** `id, title`. Не `notes_for_student`/`tutor_id`/`status`/`disable_ai_bootstrap`.
- `homework_tutor_tasks`: базовый whitelist `id, order_num, task_text, task_image_url, max_score, kim_number, check_format`.
- `correct_answer` — в SELECT **только** при `show_answers === true` (отсутствует в памяти процесса иначе).
- `solution_text, solution_image_urls` — только при `show_solutions === true`.
- `rubric_text`, `rubric_image_urls` — **никогда** не селектятся (tutor-only invariant).
- `homework_tutor_student_assignments` и имена учеников — **никогда не JOIN-ятся**.

**Expiry:** `expires_at !== null && Date.parse(expires_at) < Date.now()` → `{ expired: true }` 200 OK (не 410/404 — frontend различает «истекло» vs «не найдено»). Not-found → 404 `{ error: "not_found" }`.

**Signed URLs:** TTL = 3600s (`SIGNED_URL_TTL_SEC`), re-issued на каждый запрос. `parseAttachmentUrls` из `_shared/attachment-refs.ts` (не парсить JSON вручную). Локальный `parseStorageRef` + `hasUnsafeObjectPath` (path traversal). Default bucket `homework-task-images`. `createSignedUrl` failures **silent** (картинка исчезает, не ломает страницу).

**Telemetry:** `homework_share_link_visited` — **server-side only**, анонимно (`console.warn(JSON.stringify({ event, slug, timestamp }))`, без user_id/IP/UA).

**Frontend (`PublicHomeworkShare.tsx`):** route `/p/:slug` **вне AppFrame** (нет TutorGuard). Header = logo + optional CTA «Открыть в Сократе» (если `getSession()` вернул session). API `src/lib/publicShareApi.ts::fetchPublicHomeworkShare(slug)` → discriminated union `{status: 'ok'|'expired'|'not_found'|'invalid_slug'|'error'}`. `MathText` через `React.lazy` + Suspense. Все `<img>` `loading="lazy"`. Click-to-zoom через Radix Dialog (`ZoomableImage`).

**При расширении:** никогда `SELECT *`; новое публично-видимое поле → явное решение (tutor-only / show_answers-gated / show_solutions-gated / всегда-видимое, default tutor-only); не добавлять JOIN'ы на студент-таблицы; новый bucket → проверить `createSignedUrl` путь.

### Homework preview surface — `/tutor/homework/:id/preview` + shared `/p/:slug`

Tutor-only route `/tutor/homework/:id/preview` (внутри AppFrame) — читаемое представление всех задач, native `window.print()`, copy-to-Telegram. Через **stateless shared component**, который public `/p/:slug` переиспользует.

**Архитектура (shared component contract):**
- `src/components/tutor/homework-reuse/HomeworkPreviewContent.tsx` — **pure, stateless**, без data-fetching/auth-context. Props `{ title, tasks: HomeworkPreviewTask[], showAnswers, showSolutions }`. Тип `HomeworkPreviewTask` wire-совместим с `PublicShareTask` в `src/lib/publicShareApi.ts`.
- `src/pages/tutor/TutorHomeworkPreview.tsx` — tutor wrapper (React Query, batched signed-URL, toolbar, toggles, telemetry).
- `src/pages/PublicHomeworkShare.tsx` — public wrapper (URL'ы уже signed).
- **Не создавать dependency** обратно от `HomeworkPreviewContent` на tutor-specific — новый функционал оборачивает компонент.

**Anti-leak инварианты:**
- `HomeworkPreviewTask` тип **НЕ содержит** `rubric_text`/`rubric_image_urls` — compile-time гарантия (рубрика остаётся tutor-only). При расширении типа — любое поле безопасно для публичного показа.
- `showAnswers`/`showSolutions` дефолт **OFF** на toolbar и в `ShareLinkDialog`.
- `solution_text`/`solution_image_urls` рендерятся **только** при `showSolutions=true` И наличии контента.

**Image resolution:**
- **Tutor path:** `TutorHomeworkPreview` батчит `task_image_url` + `solution_image_urls` refs через `useKBImagesSignedUrls` (один вызов на gallery type с дедупом). **НЕ** per-task `getTutorTaskImagesSignedUrls` (N запросов).
- **Public path:** edge function подписывает через `service_role`, возвращает готовые `string[]`.
- `HomeworkPreviewContent` всегда получает готовые URL'ы (не знает о `storage://`). `PhotoGallery` из `src/components/homework/shared/PhotoGallery.tsx` (thumbnails + fullscreen + swipe + arrow keys + counter).

**Print CSS (Safari-safe, rule 80):** `src/styles/homework-preview-print.css` — **linked stylesheet** через `import` (Vite emits external `<link>`). **НЕ** inline `<style>` с `@media print` (Safari/WebKit игнорирует при `window.print()`). Правила: hide rail/topbar/toolbar; `.sokrat.t-app { display: block }`; `.preview-task { break-inside: avoid; page-break-inside: avoid }`; `@page { margin: 1.5cm }`.

**Copy-to-Telegram:** `buildTelegramCopyText` (`№N. <stripLatex(task_text)>` + `[см. рисунок]` + `Ответ: <stripLatex(correct_answer)>` при `showAnswers`). `stripLatex` из `src/components/kb/ui/stripLatex.ts` (reuse). `copyTextToClipboard` — primary + fallback (как `ShareLinkDialog`, **не удалять**).

**Design deviations:** `kim_number: null` всегда на tutor path (`homework_tutor_tasks` не имеет колонки); компонент рендерит `· ЕГЭ №M` только при `kim_number != null`.

**Telemetry (PII-free):** `homework_preview_opened` (fire-once-per-mount через `useRef` sentinel по `assignmentId`), `homework_preview_printed` (до `window.print()` через `requestAnimationFrame`), `homework_preview_copied_text` (`{ assignmentId, tasksCount, withAnswers }`).

Spec: `docs/delivery/features/homework-reuse-v1/spec.md`.

### Save homework tasks to «Мою базу» — `POST /assignments/:id/save-tasks-to-kb`

`handleSaveTasksToKB` — единственный путь, которым homework-задачи попадают в персональную KB (`kb_tasks.owner_id = tutor`). Используется bulk-диалогом `SaveTasksToKBDialog` и per-task `BookmarkPlus` на `HWTaskCard` (edit-mode).

**Контракт:** body `{ task_ids: string[] (≤50, UUID), folder_id?: UUID | null, new_folder_name?: string (≤120) | null }` (обязательно одно). Ownership `getOwnedAssignmentOrThrow` + `.eq('assignment_id', id)` на tasks + `.eq('owner_id', tutorUserId)` на folder. Response `{ saved, skipped, created_folder }`.

**Fingerprint-based dedup — единственный путь (КРИТИЧНО):** `rpc('kb_normalize_fingerprint', { p_text, p_answer, p_attachment_url })` (3-arg). SELECT `kb_tasks WHERE owner_id = tutor AND fingerprint = fp` → если найден, `already_in_base=true` с **его** фактической folder (не выбранной). Покрывает все три провенанса (catalog copy / personal-already / manual duplicate). Не найден → INSERT с fingerprint, `source_label: 'my'`. **Нет** unique index на `(owner_id, fingerprint)` — SELECT-then-INSERT best-effort.

**Anti-leak invariant (обновлено 2026-06-03):** копирует `task_text`, `task_image_url`, `correct_answer`, `solution_text`, `solution_image_urls` + **`rubric_text`/`rubric_image_urls`** (field-parity fix — рубрика теперь едет в «Мою базу», запрос Эмилии). Это **НЕ** утечка в Каталог: moderation-триггеры публикации (`kb_publish_task`/`kb_resync_task`) копируют явный список колонок без rubric → каталожная копия (`owner_id IS NULL`) рубрику не несёт. `check_format`/`cefr_level` обратно в Базу **НЕ** дописываются (Q3, отложено) — задача из ДЗ при повторном импорте получит check_format по эвристике. См. секцию «Field-parity (2026-06-03)».

**Inline folder create:** при `new_folder_name` — `SELECT id, name FROM kb_folders WHERE owner_id = tutor AND parent_id IS NULL AND name ILIKE ?` + `.find(lowercase match)`. Совпадение → reuse (`created_folder = null`); иначе INSERT. Двойной клик не плодит близнецов.

**Per-task icon:** `HWTaskCard` рендерит `BookmarkPlus` ТОЛЬКО когда `onRequestSaveToKB` передан И `task.id` = persisted UUID. `HWTasksSection` пропагирует prop ТОЛЬКО при заданном `assignmentId` (`TutorHomeworkCreate` задаёт `isEditMode ? editId : null` → в create-mode невидим). Не добавлять `BookmarkPlus` на dense-row карточки / read-only views.

**Telemetry (PII-free):** `homework_saved_to_kb` (bulk), `homework_saved_to_kb_per_task` (single) — один раз на success, без `task_text`/`folder_name`/имён.

**Entry points:** bulk — `SaveTasksToKBDialog` из Actions-меню; single — `BookmarkPlus` (React.lazy из `HWTasksSection`). Cache invalidation: `['tutor', 'kb']` (весь scope).

Spec: `docs/delivery/features/homework-reuse-v1/spec.md`.

### Save-as-template post-factum — `POST /assignments/:id/save-as-template` + `PATCH /templates/:id`

Два handler'а в `homework-api/index.ts`: `handleCreateTemplateFromAssignment` (POST, snapshot из ДЗ), `handleUpdateTemplate` (PATCH, метаданные title/tags/topic, hard whitelist).

**Отличие от существующих:** `POST /templates` — legacy (клиент передаёт `tasks_json` явно). `HWActionBar` checkbox «Сохранить как шаблон» при создании (`save_as_template: true` в `POST /assignments`) — **независимый** путь (коэкзистируют, не консолидировать). Новый `POST /save-as-template` — читает tasks server-side с ownership-check; клиент передаёт `{ title, tags, include_rubric, include_materials, include_ai_settings }`.

**`include_*` toggles:**
- `include_rubric=false` → `rubric_text`/`rubric_image_urls` в `tasks_json[*]` **зануляются** (не опускаются): `includeRubric ? (t.rubric_text ?? null) : null`.
- `include_ai_settings=false` → ключ `check_format` **опускается** (не зануляется): `if (includeAiSettings && isNonEmptyString(t.check_format)) base.check_format = t.check_format`.
- `include_materials` — **принимается, но noop** (templates не хранят materials). Логирует `console.info("homework_api_template_materials_noop")`. UI рендерит switch **disabled** + amber-hint. Telemetry НЕ включает `includeMaterials`.

**Provenance `source_kb_task_id`:** в `tasks_json[i]` additive optional, пишется ТОЛЬКО при `kb_task_id IS NOT NULL` (валидный UUID). Backward-compatible. Для sync-feature — резолвить NULL gracefully (задача могла быть удалена).

**PATCH whitelist:** `UPDATE_TEMPLATE_ALLOWED_KEYS = new Set(["title", "tags", "topic"])`. Любой другой ключ (включая `tasks_json`/`subject`/`tasks`) → 400 **жёстко**, НЕ silent ignore (иначе stale `tasks_json` затрёт валидные задачи). 404/403 не дифференцируются.

**Редактирование задач шаблона — вне scope** (требует отдельной spec с task picker + provenance sync).

**Known schema drift:** `homework_tutor_templates.subject` CHECK constraint (`20260226100000_homework_20.sql`) принимает только legacy subjects `math, physics, history, social, english, cs`. Новые canonical (`maths`, `russian`, etc.) **не проходят** — save-as-template вернёт DB error. Затрагивает все 3 пути. Требует миграции по паттерну `20260414150000_unify_homework_subject_check.sql` для таблицы `homework_tutor_templates`. До фикса QA с subject `physics`.

**Telemetry (PII-free):** `homework_saved_as_template_post_factum` (`{ assignmentId, templateId, includeRubric, includeAiSettings }`, один раз; `include_materials` намеренно НЕ включён).

**Dialog (`SaveAsTemplateDialog.tsx`):** prefill title `${assignment.title} — шаблон` (idempotent suffix guard); prefill tags `[subjectLabel, topic?]` (dedupe); multi-chip tag input (Enter/comma adds, Backspace deletes last). Три toggle default ON.

Spec: `docs/delivery/features/homework-reuse-v1/spec.md`.

### Field-parity: Создание ДЗ ↔ Шаблоны ↔ База задач (2026-06-03)

Источник дрейфа: «Создание ДЗ» обросло полями (`check_format`, `task_kind`, `cefr_level`, рубрика, `exam_type`, `feedback_language`), а Шаблоны и База строились раньше → теряли их при переиспользовании. Баги: (1) «развёрнутый → краткий» после загрузки шаблона; (2) «добавила из базы — критерии не прикрепились».

**Шаблоны несут ВСЕ поля задачи (КРИТИЧНО).** Миграция `20260603120000` добавила в `homework_tutor_templates`: `exam_type`, `feedback_language`, `disable_ai_bootstrap`. Per-task `check_format`/`task_kind`/`cefr_level` живут в `tasks_json` (тип `HomeworkTemplateTask`).
- **Save-path'ы (КРИТИЧНО — клиентский payload тоже считается write-path):** (1) **видимый чекбокс «Сохранить как шаблон»** при создании ДЗ → **клиентский** `createTutorHomeworkTemplate` (`TutorHomeworkCreate.tsx`, ~стр.1219) → legacy `POST /templates` (`handleCreateTemplate`). **НЕ `save_as_template`-флаг** — тот в `handleCreateAssignment` живёт, но UI его НЕ шлёт (мёртвый путь, оставлен defensive). Review P0: клиентский payload ОБЯЗАН слать `check_format`/`task_kind`/`cefr_level` + `exam_type`/`feedback_language`/`disable_ai_bootstrap`, иначе бага #1 живёт на кнопке несмотря на backend-фикс. (2) `handleCreateTemplateFromAssignment` post-factum (`check_format`/`task_kind`/`cefr` под `include_ai_settings`). `handleCreateTemplate` нормализует AI-поля server-side (review P1-3: валидный `check_format`, `resolveWriteTaskKind`, cefr lang-only) — паритет с `handleCreateAssignment`.
- **2 load-path через единый `resolveTemplateLoad(tpl)`** в `TutorHomeworkCreate.tsx` (URL-param + picker) — НЕ дублировать; раньше load хардкодил `check_format='short_answer'` и игнорировал поле. Читает `t.check_format`/`t.task_kind`/`t.cefr_level` из шаблона; meta ← `exam_type`/`disable_ai_bootstrap`/`feedback_language`.
- **CEFR + feedback_language — только для языковых** (`french/english/spanish`, mirror `LANGUAGE_SUBJECTS_REQUIRING_CEFR` бэка / inline `['french','english','spanish']` фронта). На физике/математике этих полей НЕТ. `exam_type`/`disable_ai_bootstrap` — для всех.
- Backward-compat: старые шаблоны без полей → fallback (`short_answer` / derive / авто-детект CEFR). Forward-only — старые шаблоны данные не восстанавливают (Q4), репетиторов уведомить пересохранить.

**Рубрика — first-class поле «Моей базы» (НЕ Каталога).** Миграция `20260603120100` добавила `kb_tasks.rubric_text`/`rubric_image_urls`. Триггеры публикации в Каталог **НЕ трогаем** → рубрика остаётся в личной базе (owner=tutor), в общий Каталог не утекает. **Путь рубрики — правь ВСЕ write-site'ы (КРИТИЧНО, легко пропустить):** `KBTask` тип → `kbTaskToDraftTask` (import path A) → `hwDraftStore.addTask`+`HWDrawer` INSERT (import path B) → `handleSaveTasksToKB` (save-back; review P1-1: fingerprint без рубрики → при already_in_base **fill-blank** апдейт рубрики, не перезатирая) → **`copyTaskToFolder` (`useFolders.ts`) — base→base копия, lossless** (review P1-2: добавлены `rubric_*` + `check_format`) → `KBTask` Create/Edit modal (текст видим/редактируем; update через `.update(input)` не зануляет). `check_format`/`cefr` ДЗ→Base save-back — отложено (Q3), но base→base копия их сохраняет.

Spec/build-лог: `~/.claude/plans/atomic-humming-pumpkin.md` + memory `project_field_parity_template_kb.md`.

### Fallback для legacy subject ids
- `src/types/homework.ts` — `LEGACY_SUBJECT_LABELS: Record<string, string>` (`math` → `Математика`, `rus` → `Русский язык`). В `getSubjectLabel()` как второй fallback после `SUBJECT_NAME_MAP`.
- Существующие ДЗ с `subject: 'math'` рендерятся с русским лейблом.

### GuidedThreadViewer — UX improvements
- Тред загружается автоматически при раскрытии ученика (нет «Показать переписку»). `enabled` prop контролирует lazy-loading.
- Сообщения через `MathText`. `ThreadAttachments` резолвит `storage://` refs через signed URLs.
- Репетитор может прикрепить изображение (upload через `uploadTutorHomeworkTaskImage`, ref в `image_url`). Backend `handleTutorPostMessage` принимает optional `image_url`.
- Student-side `GuidedChatMessage` отображает `image_url` через `ThreadAttachments` (резолвит через `getStudentTaskImageSignedUrl`).
- **Авто-рост composer'а (фидбэк Эмилии 2026-06-03):** поле ввода сообщения репетитору растёт под текст через `useAutoResizeTextarea(messageTextareaRef, messageText, halfViewportPx)`, cap = `window.innerHeight * 0.5` (не `dvh` — rule 80), `rows={2}` resting + `overflow-y-auto` для скролла за капом. Сброс высоты на отправку — автоматический (`setMessageText('')` → effect). Лента сообщений выше — отдельный sibling с `max-h-[320px]`, авто-рост её не сжимает. При расширении composer'а — этот же хук, не локальная копия.

### Guided chat media upload
- **Transport/persist:** `handlePostThreadMessage` принимает optional `image_url` (только `storage://...` refs). `saveThreadMessage()` отправляет как `image_url` в `POST /threads/:id/messages`.
- **Upload UI (`GuidedChatInput.tsx`):** кнопка 📎 (Paperclip), hidden `<input type="file" accept="image/*,.pdf" multiple>`, `AttachmentPreview`. Валидация JPG/PNG/HEIC/WebP/PDF, ≤ 10 МБ, max 3 файла. `URL.revokeObjectURL` cleanup.
- **`uploadStudentThreadImage(file, assignmentId, threadId, taskOrder)`** → bucket `homework-submissions`, path `{studentId}/{assignmentId}/threads/{taskOrder}/{fileId}.{ext}`. ID файла `Date.now()-Math.random()` (**не** `crypto.randomUUID` — Safari < 15.4).
- **answer+image / retry+image:** `checkAnswer()` принимает attachment refs; `handleCheckAnswer` валидирует ownership + сохраняет serialized attachments; retry передаёт serialized `image_url` из сохранённого сообщения. AI path использует latest student images для `answer`/`hint`/`question`; PDF сохраняется/отображается, но в AI пока не передаётся.
- **Clipboard paste:** `onPaste` handler — `clipboardData.files` + fallback `clipboardData.items` + `getAsFile()` (Safari/Firefox). `preventDefault()` только после валидации (type/size/max). Text paste не перехватывается.
- **`touch-action: manipulation`** на всех interactive (📎, Шаг, Ответ, ✕) — против 300ms tap delay iOS.

### Таблицы БД
- `homework_tutor_assignments` — задания (draft/active/archived).
- `homework_tutor_tasks` — задачи внутри заданий.
- `homework_tutor_threads` — guided chat threads.
- `homework_tutor_thread_messages` — сообщения.
- `homework_tutor_task_states` — прогресс по задачам.
- `homework_tutor_templates` — шаблоны.
- `homework_tutor_materials` — материалы (PDF, images, links).
- `homework_share_links` — публичные read-only ссылки `/p/:slug` (множественные на одно ДЗ разрешены; tutor CRUD через `homework-api`, публичное чтение через `public-homework-share` под `service_role`).

### Важно
- Система попыток (attempts) **удалена** — ученик может пересдавать без ограничений.
- `src/types/homework.ts` содержит legacy-типы `HomeworkSet`/`HomeworkTask` (для SUBJECTS конфига) — не путать с активной системой.

### Передача изображений задач в AI (КРИТИЧНО)

`task_image_url` в БД = `storage://homework-task-images/...` — **внутренняя** ссылка Supabase, не HTTP URL. AI её не откроет.

**Правило** — перед передачей в AI **ОБЯЗАТЕЛЬНО**:
1. `storage://` → подписанный HTTP URL через `db.storage.createSignedUrl()` (service_role) или `GET /assignments/:id/tasks/:taskId/image-url`.
2. Если Lovable gateway не скачивает remote image сам — заинлайнить в `data:image/...;base64,...`.
3. Передать как multimodal `{ type: "image_url", image_url: { url } }` или `data:` URL в массиве `content`.
4. **НИКОГДА** не вставлять `storage://` или raw URL как текст — AI его не увидит.

**Четыре пути к AI в guided chat** (все должны передавать изображение корректно):
- `answer` → `handleCheckAnswer` → `evaluateStudentAnswer` (task dual-format → `taskImageUrls: string[]`; rubric отдельно `rubricImageUrls?`; latest student images отдельным массивом, inline в `guided_ai.ts`).
- `hint` → `handleRequestHint` → `generateHint` (task → `taskImageUrls: string[]`; rubric не передаётся; student images отдельно).
- `question` → `streamChat()` → `/functions/v1/chat` (frontend `taskImageUrls: string[]`, backend режет до `MAX_TASK_IMAGES_FOR_AI`, резолвит + inline base64; `studentImageUrls` отдельно).
- `bootstrap` → `streamChat()` → `/chat` (только `taskImageUrls`; student image на intro не передаётся по дизайну).

**Dual-format invariant:** `task_image_url`/`rubric_image_urls` = single `storage://...` ИЛИ JSON-array. Frontend через `parseAttachmentUrls` (`@/lib/attachmentRefs`); backend через `_shared/attachment-refs.ts`. В AI-path резолвить ref → signed URL / `data:` URL.

При добавлении нового пути к AI с изображениями — проверить ВСЕ вызывающие точки.

### Hint quality — FORBIDDEN_HINT_PHRASES + retry-once + fallback
- `generateHint` в `guided_ai.ts` использует deterministic ban list `FORBIDDEN_HINT_PHRASES` + post-gen `validateHintContent`.
- Запрещённые фразы: «перечитай условие», «выдели ключевые данные», «подумай внимательнее», «вспомни материал», «что тебе дано».
- Flow: `generate -> validate -> 1 retry` (replacement prompt) -> `buildFallbackHint`. Контракт `<= 1 retry`, никогда больше (циклы regen → latency blowout).
- Fallback deterministic: упоминать существительное/термин из `task_text` или фразу про изображение; длина `>= 40` символов.
- Telemetry `console.warn(JSON.stringify(...))` события `hint_rejected` и `hint_fallback_used`; без текста hint, без `task_text`, без PII.
- Phase B (level escalation 1-3) — отдельная итерация, не добавлять в текущий flow.

Spec: `docs/delivery/features/hint-quality/spec.md`.

### Student Guided Homework UX (legacy GuidedHomeworkWorkspace)
- **MathText в условии:** `task_text` через lazy `MathText` (+ `Suspense`), `whitespace-pre-wrap` для plain-text.
- **Bootstrap для всех задач:** убрано ограничение `order_num !== 1`. AI intro при первом открытии задачи без сообщений. Backend system messages (`role: 'system'`) исключаются из `hasAnyTaskMessages`; integrity check (`INVALID_ORDER`) обходится для `message_kind: 'system'`.
- **Label «Введение»:** `formatMessageKind('system')` → `'Введение'`. В tutor `GuidedThreadViewer` — badge только для `role: 'assistant'` + `message_kind: 'system'`.
- **Shared preprocessLatex:** импорт из `@/components/kb/ui/preprocessLatex.ts` (inline версия имела баг: `'$$'` — спецсимвол в `String.replace`).
- **Race guard:** `handleTaskClick` блокирует навигацию при `isStreaming || isCheckingAnswer || isRequestingHint`.

### Свободный порядок задач в guided mode

Ученик решает задачи в **любом порядке** (как на ЕГЭ/ОГЭ).

**Backend:** `provisionGuidedThread` создаёт **все** `task_states` как `"active"` (было: только первая). `/threads/:id/check` и `/hint` принимают optional `task_order` — backend работает с указанной клиентом задачей. `loadAdvanceContext` принимает `overrideTaskOrder`. `handleRequestHint` ищет task_state по `task_order`, а не первый `status = 'active'`.

**Frontend:** `activeTaskOrder = currentTaskOrder` (следует за выбором). `isViewingActiveTask` проверяет `currentActiveTaskState?.status === 'active'`. `checkAnswer(threadId, answer, taskOrder)` / `requestHint(threadId, taskOrder)` передают `task_order`. `TaskStepper`: `isActive = order_num === currentTaskOrder`.

**Важно:** `thread.current_task_order` остаётся в БД как fallback (primary source для check/hint от клиента). `performTaskAdvance` обновляет `current_task_order` при завершении, но не блокирует навигацию. Ученик **НЕ МОЖЕТ** отправлять ответы/подсказки для `completed` задач (проверка `status === 'active'` на обеих сторонах).

### Два поля ввода «Ответ» и «Обсуждение»

Два раздельных поля в `GuidedChatInput.tsx`:
- **AnswerField** (зелёная рамка `border-2 border-green-600`, сверху): Enter = `onSendAnswer` → AI проверяет.
- **DiscussionField** (серая рамка, снизу): Enter = `onSendStep` → AI обсуждает.

**Ключевые решения:** два независимых state (`answerText` + `discussionText`, очищаются раздельно). Ctrl+Enter / Cmd+Enter **полностью убран**. `attachedFiles` — shared. `placeholder` prop удалён (hardcoded `Ответ...` / `Обсуди с AI...`). Discussion свёрнуто (аккордеон) по умолчанию на всех экранах.

### Mobile UX polish
- **Навигация (`Navigation.tsx`):** логотип + вкладки + logout в одну строку `h-14`. Вкладка «Главная» удалена (логотип ведёт на `/`). На мобиле текст «Сократ» скрыт.
- **Layout workspace:** блок с названием ДЗ/предметом/статусом удалён. Условие задачи collapsible (раскрыто по умолчанию). Кнопки «Предыдущая»/«Следующая» icon-only на мобиле.

### Task-lock fix — фиксация задачи при check/hint

**Проблема:** `syncThreadFromResponse()` перезаписывал `currentTaskOrder` из БД → ученик перебрасывался.

**Решение:**
- `syncThreadDataOnly()` — обновляет messages/task_states/status **без** изменения навигации. `handleCheckAnswer`/`handleHint` используют его.
- При `CORRECT` — 1200ms celebration (`celebratingTaskOrder` state + CSS ring/scale/bounce, no framer-motion), затем auto-advance. `celebrationTimerRef` + cleanup useEffect (memory leak). `switchToTask` очищает pending timer.
- Race guard в `handleTaskClick`: блокирует при `celebratingTaskOrder !== null`.
- **Init-once навигация:** `hasInitializedRef` — `setCurrentTaskOrder` только при первом получении `thread`, не при каждом refetch (`invalidateQueries` после check/hint вызывал refetch → init effect перезаписывал). `assignment.id` change → ref сбрасывается. После init навигацию контролируют `switchToTask()` (клик) + auto-advance.
- **Completed view:** экран результатов **НЕ** показывается автоматически. Кнопка «Завершить и посмотреть результаты» inline после последнего сообщения. `GuidedChatInput` скрывается при `threadStatus === 'completed'`.

Spec: `docs/delivery/features/guided-chat/task-lock-spec.md`.

### Bootstrap hallucination fix + disable toggle
- **Fix hallucination:** `buildTaskContext()` поддерживает `sendMode: 'bootstrap'` (отдельный `modeHint`). Bootstrap call передаёт `'bootstrap'` вместо `'question'` → AI не галлюцинирует «вижу твоё решение». `isMinimalText` порог `length <= 20` + regex `/^\[.*\]$/` для placeholder. Bootstrap system prompt усилен (запрет упоминать «решение ученика», fallback для нечитаемых изображений).
- **Disable toggle:** колонка `disable_ai_bootstrap boolean NOT NULL DEFAULT false` в `homework_tutor_assignments`. Toggle «AI-вступление к задачам» в L1 `HWExpandedParams.tsx`. Backend create+update принимают. Student-side guard в `GuidedHomeworkWorkspace.tsx`.

### Конструктор ДЗ — L0/L1 архитектура

`TutorHomeworkCreate.tsx` — single-page конструктор с progressive disclosure:
- **L0 (всегда видно):** Тема → Кому (`HWAssignSection`) → Задачи (`HWTasksSection`) → `HWActionBar`.
- **L1 (collapsible, «Расширенные параметры»):** `HWExpandedParams` (название, предмет, дедлайн, AI-вступление) + `HWMaterialsSection`.

Правила: dot indicator на L1-кнопке если `title` / `subject !== 'physics'` / `deadline` / `materials.length > 0`. L1 auto-expand при ошибке валидации `subject`. `_topicHint` — soft warning (ключи с суффиксом `Hint` не blocking). Поле «Тема» в L0, НЕ в `HWExpandedParams`.

### Edit-mode: порядок useEffect'ов prefill/reset

Два связанных useEffect:
1. **Reset** (`[editId]`): сбрасывает `editPrefilledRef`, `editInitialSnapshot`, `deferredImageDeletesRef`.
2. **Prefill** (`[isEditMode, existingAssignment]`): заполняет форму + ставит `editInitialSnapshot`.

**КРИТИЧНО: reset объявлен РАНЬШЕ prefill** (оба фаерятся на mount в порядке деклараций; React батчит setState из эффектов, последний `setEditInitialSnapshot` выигрывает). Если reset после prefill — затрёт snapshot в том же commit-cycle.

**Симптом нарушения:** на flow `/tutor/homework/:id → /edit` (react-query кеш свежий) `editInitialSnapshot` остаётся `null` → `isEditSnapshotReady=false` → кнопка «Сохранить» залипает на «Подготавливаем…».

**Архитектура edit-diff state:**
- `editInitialSnapshot: EditSnapshot | null` — snapshot (мета, taskSignature, studentIds, materialSignature).
- `isEditSnapshotReady = !isEditMode || editInitialSnapshot !== null` — гейт submit button и `hasUnsavedChanges`.
- `editDiffState` — `useMemo` над snapshot + live state; `null` пока snapshot не готов.
- `buildMaterialSignature` НЕ должна включать `localId` (client-side UUID) — иначе `materialsDirty` всегда `true` после prefill.
- `isSubmitDisabled = isSubmitting || (isEditMode && !isEditSnapshotReady)`. `submitLabel` = `'Подготавливаем...'` пока не готов.

### Тренажёр формул — Formula Rounds (standalone pivot)

Standalone public trainer `/trainer` (пивот из homework-embedded preview). Источник: `docs/delivery/features/formula-round-phase-1/spec.md`. GDD (source of truth для gameplay): `docs/SokratAI_physics_game-design-document.md`.

**Архитектура:**
- **Formula engine — client-side** (`src/lib/formulaEngine/`). Нет AI-вызовов. Генерация из статической базы формул кинематики (новые разделы → DB).
- **Три типа заданий** (слои знания): Layer 3 `TrueOrFalseCard` (формула верна/неверна, мутации `MUTATION_LIBRARY`); Layer 2 `BuildFormulaCard` (собери из токенов); Layer 1 `SituationCard` (ситуация → формула).

**Критичное — structured answer validation:**
- `BuildFormulaAnswer { numerator: string[]; denominator: string[] }` — НЕ flat array. `BUILD_RECIPES` хранит `numeratorTokens`/`denominatorTokens`.
- **Все карточки возвращают raw answer**, correctness определяется ТОЛЬКО в `FormulaRoundScreen.handleAnswer` (single source of truth). НЕ ПЕРЕНОСИТЬ проверку обратно в карточки.
- Дистракторы: `relatedFormulas` first → sameSection backfill. НЕ shuffle(merged).

**Backend groundwork:**
- Миграция `20260408160000_trainer_standalone_schema.sql`: `student_id` nullable, добавлены `session_id`/`source`/`ip_hash`, partial index `idx_formula_round_results_trainer_recent`, RLS policy `trainer_results_no_anon_read`, `round_id` nullable (schema drift).
- Edge function `supabase/functions/trainer-submit/index.ts`: без JWT, `service_role`, валидирует payload, `ip_hash = sha256(ip + TRAINER_IP_SALT)`, rate-limit по `formula_round_results`.

**Schema drift (учитывать):** таблица `formula_round_results` использует `student_id`/`round_id` (не `user_id`/`formula_round_id`), сохраняет `duration_seconds` (не `duration_ms`). Не предполагать колонки `homework_assignment_id`/`formula_round_id`/`client_started_at` пока миграция явно не добавит.

**Component contract:**
- `FormulaRoundScreen` props `{ questions: FormulaQuestion[]; onComplete: (result: RoundResult) => void; onExit: () => void }`. Не держит `lives`. Back button (Lucide `ArrowLeft`, 44×44, `touchAction: manipulation`). Timing — `performance.now()` (монотонно).
- `RoundProgress` props `{ current, total }`. Hearts удалены. Counter `text-base` (16px).
- `RoundResultScreen` props `{ result: RoundResult; onRetryWrong: () => void; onExit: () => void }`. Две CTA: «Пройти ещё раз» (primary, только при `weakFormulas.length > 0`) + «Назад».
- `RoundResult` type: required `durationMs: number` + legacy `durationSeconds`.
- `handleAnswer` correctness checking — single source of truth (карточки возвращают raw answer).

**Legacy cleanup:** `StudentFormulaRound.tsx`, `formulaRoundApi.ts`, `useFormulaRound.ts`, preview auth bypass, route `/homework/:id/round/:roundId` подлежат удалению (TASK-5). Новый код **не должен** их импортировать.

**v1 ветки (кураторские, hand-craft в `egorFormulas.ts`, вне auto-generation):** три под-темы кинематики, все `mode:'v1'` (только Layer 2 + Layer 3, без SituationCard):
- **Прямолинейное движение** (`egor-linear`, `kin.57-69_e`, 9 формул — равномерное+равноускоренное). **⚠️ DRAFT (2026-06-19): авторский контент — в листе Механика_v1 были только LaTeX+переменные, остальные поля (physicalMeaning/memoryHook/whenToUse/commonMistakes/мутации/recipe) написаны вручную. Егор/Елена выверяют формулировки/мутации.**
- **Вращение по окружности** (`egor-v1`, `kin.13-22_e`, 10).
- **Движение по параболе** (`egor-parabola`, `kin.23-35_e`, 13). В листе есть ещё 6 «помнить с выводом» (`kin.29,30,36,37,38,39`) — не загружены (кандидаты в TrueOrFalse-only).
- Экспорт `egorFormulas`, `EGOR_BUILD_RECIPES`, `EGOR_SUPPORTED_BUILD_FORMULA_IDS` (= keys рецептов → buildable), `EGOR_MUTATION_LIBRARY`. v1 НЕ в `mechanicsFormulas` (дубли), но в `formulasById`. `relatedFormulas` v1 — **только** внутрь v1 (`_e`). `RoundConfig.mode` default `'v2'`; v1 → `selectV1Distribution`. `isEgorFormulaId(id)=id.endsWith('_e')`.
- **Разделы (`TrainerPage`):** v2-авто-разделы (Вся механика/Кинематика/Динамика/Статика/Гидростатика) **убраны из UI** (формулы в `formulas.generated.ts` живут, но не в тренажёре). Остались 3 v1 с префиксом «Кинематика · Прямолинейное/Вращение/Парабола» (фильтр по `topic`: `прямолинейн`/`вращение`/`парабол`; default — `egor-linear`). `SectionKey` (store): `egor-linear`/`egor-v1`/`egor-parabola`. **Новый раздел/расширение v1 — синхронно:** `egorFormulas.ts` (+recipe+мутации) → `TrainerPage` (`SectionType`/`SECTION_POOLS`/фильтр) → store `SectionKey` → `BestScoreCard.SECTION_OPTIONS`; не трогать `formulas.generated.ts`.

**Рендер-баги формул (2026-06-19, КРИТИЧНО) — одинарный `\` в JS-строке:** LaTeX в JS-строках `egorFormulas.ts` обязан **удваивать каждый бэкслеш** (`\\frac`, `\\text{цс}`, `\\cos(\\alpha)`). Одинарный → JS-escape бьёт: `\t`=TAB (чип рендерит «extцс»), `\c`/`\s`/`\a`→буква съедается (чип рендерит литерал «cos(alpha)»). Касается `variables[].symbol` **и** recipe-токенов. **Smoke-guard секция 11** (`scripts/smoke-check.mjs`): collapse `\\`-пар → любой оставшийся `\`+буква = фейл (ловит оба класса для всех текущих+будущих v1-формул). НЕ рантайм-ремаппер (Safari lookbehind запрещён, rule 80).

**«Ловушка с размерностями» убрана (2026-06-19):** `questionGenerator.ts` — `trap` фидбэка = `commonMistakes[0]` (не `formula.dimensions`); из `generateFeedback` убраны «Размерность согласуется»/«Проверь размерность». Поле `Formula.dimensions` оставлено (нигде не показывается).

**Подсказки по желанию (`FormulaHintPanel.tsx`, 2026-06-19):** свёрнутые «Что значат величины» (`variables`) + «Как рассуждать» (`physicalMeaning`). Button+useState+aria-expanded (НЕ `<details>`, iOS, rule 80). Монтаж: BuildFormula — оба блока; **TrueOrFalse — ТОЛЬКО величины** («как рассуждать» спойлит «Формула верна?»). Карточки резолвят `getFormulaById(question.formulaId)`; название формулы (`formula.name`) — eyebrow на карточках.

**Шкала «% правильных» вместо абстрактных XP (2026-06-19):** `RoundResultScreen` герой = `percentage` («85% · 8 из 10»). `trainerGamificationStore`: `bestScoreBySection` хранит **%** (не XP), `isNewBest` по %, **version 1→2 + migrate сбрасывает `bestScoreBySection={}`** (старые XP как % бессмысленны; стрик/`totalXp`/даты сохранены). XP-движок (`xpCalculator`) внутренний (телеметрия `xpEarned`), ученику не показывается. `XpCard`→«Цель дня», `XpBreakdown`→серия+бейджи (без XP), `BestScoreCard`→«%». Смена шкалы хранения → бампать `version` + migrate.

**Build-recipe — структура токенов (2026-06-19, important при добавлении buildable-формул):** карточка «Собери формулу» имеет ОДИН числитель + ОДИН знаменатель и различает варианты по **instance-key** (`BuildFormulaCard`), а `generateBuildFormula` **НЕ дедупит** `options` (distractors уже uniq + не пересекаются с correct) → формула с повторяющимся оператором (`A + B + C` нуждается в ДВУХ `+`) собирается корректно. Дробное слагаемое в сумме (`A + \frac{C}{2}`) задаётся **единым композитным токеном** `\\frac{C}{2}` (один чип, `denominatorTokens` пуст), НЕ раскладкой по общему знаменателю — иначе сборщик дал бы `(A+C)/2`. Сгруппированный числитель (`\frac{(v+v_0)t}{2}`) — композитный токен `(v + v_0)`. Образцы: `kin.25_e` (√ как чип), `kin.66/68/69_e`, `kin.28/34_e`. `areTokenListsEquivalent` — операторно-сегментный multiset-compare (порядок сегментов/операторов строгий, термы внутри сегмента — bag).

**DB таблицы:** `formula_rounds` (конфигурация), `formula_round_results` (результаты, `source`/`session_id`/`ip_hash` для trainer pivot). RLS: student видит свои; trainer — `trainer_results_no_anon_read`; tutor read для Phase 1b.

**Phase 1b tutor UI guardrails (future):** НЕ создавать новый top-level tutor route. Встраивать только в существующие surfaces (`TutorHomeworkCreate`, `TutorHomeworkDetail`, `TutorHomeworkResults`). Formula round = часть homework workflow, не «игровой модуль». Primary CTA связан с job репетитора. Использовать существующие данные/policies, без generic analytics dashboard.

**Seed:** `supabase/seed/formula-round-seed.sql` (фиксированные UUID, НЕ заменять на `gen_random_uuid()`; password `FormulaRound123!`). Legacy preview QA path (`StudentFormulaRound.tsx` + `?student=<uuid>`) не расширять — для QA ориентир `/trainer` + `trainer-submit`.

**Ключевые файлы:** `formulas.ts` (aggregator), `egorFormulas.ts` (v1), `questionGenerator.ts` (генерация/мутации/дистракторы), `types.ts`, `FormulaRoundScreen.tsx`, `RoundResultScreen.tsx`, `trainer-submit/index.ts`.

### Reorder задач в конструкторе ДЗ
- `HWTaskCard.tsx` — props `onMoveUp`, `onMoveDown`, `isFirst`, `isLast` (`ChevronUp`/`ChevronDown`).
- **Backend:** `hw_reorder_tasks(assignment_id, task_order_jsonb)` — PL/pgSQL, `SECURITY DEFINER`, атомарная транзакция. **Порядок операций в PUT /assignments/:id:** reorder RPC → field updates → insert → delete.
- **KB provenance sync:** `hw_reorder_tasks` атомарно пересчитывает `homework_kb_tasks.sort_order` по pre-mutation snapshot (иначе `handleGetAssignment` отрисует `kb_source_label`/`kb_snapshot_solution` на чужой задаче — tutor-only surface). Join `sort_order ↔ order_num - 1`. Новый write-path на `homework_tutor_tasks.order_num` мимо RPC — синхронизируй `sort_order` вручную. Миграция `20260415120000_hw_reorder_tasks_sync_kb.sql`.

### Student Homework Problem Screen — viewport routing (rollout invariants)

Endpoint/migration/handler/anti-leak детали — в секции «Student Homework Problem Screen — single-task surface + submission contract» выше. Эта секция — rollout invariants.

**Routing invariants (без feature flag):**
- Новый screen на route `/student/homework/:hwId/problem/:taskId` (`App.tsx`, обёрнут в `<AuthGuard fullBleed>`).
- `StudentHomeworkDetail` использует hook `@/hooks/useIsMobile.ts` (inclusive `(max-width: 768px)`, SSR-safe, `matchMedia('change')` reactive — **НЕ** legacy `@/hooks/use-mobile.tsx`). После Phase 3 стал redirect-only для **всех** viewport'ов.
- **Routing = `useEffect` auto-redirect, smart fallback chain:** `thread.current_task_id` → first task без `task_state.status='completed'` → `tasks[0].id`. `useStudentThread` **обязателен** для resolve `current_task_id` до redirect (иначе всегда `tasks[0]`). `onTaskClickOverride` prop в `GuidedHomeworkWorkspace` оставлен для будущих consumers.
- **Step navigation в HomeworkProblem:** клик по цифре в `StepIndicator` → `navigate(/student/homework/<hwId>/problem/<task[i].id>)`. URL = source of truth. Free order разрешён.
- Rollback = `git revert <hash> && deploy-sokratai`.

**Submission storage:** в **существующую** `homework_tutor_thread_messages` с `message_kind='submission'` (**не возрождать** legacy `homework_tutor_submissions`). `submission_payload JSONB` shape `{numeric, photos[], text, voice_ref?}`. `image_url` параллельно = serialized photos refs (backward-compat с tutor `GuidedThreadViewer`).

**Grading invariants (hybrid first-completed-wins):**
- **Mobile chat = discussion only.** Каждое user-сообщение → `streamChat` `/chat` (server-side fetches reference solution). Persist через `saveThreadMessage(..., 'question', taskId)`, AI reply `'ai_reply'`. **`handleCheckAnswer` НЕ вызывается из chat path.** Чат не закрывает задачу.
- **Scoring-neutral discussion invariant** (КРИТИЧНО): `saveThreadMessage` backend инкрементит `task_states.attempts` **ТОЛЬКО** для `role='user' && message_kind === 'answer'`. Все остальные user kinds (`'question'`/`'hint_request'`/`'submission'`) — scoring-neutral. Без guard'а discussion chat силенциально снижал `available_score` через ON_TRACK degradation. `SCORING_MESSAGE_KINDS` константа = canonical source of truth.
- **SubmitSheet single-shot — единственный путь triggering grading на mobile:** `POST /student/problem/:hwId/:taskId/submission` → reuse `runStudentAnswerGrading`. AI verdict закрывает задачу при CORRECT.
- **Hybrid first-completed-wins:** если `status='completed'` уже стоит (через legacy desktop answer-input), новый UI блокирует повторное закрытие — primary CTA «Следующая задача →».
- **Hint path:** `POST /threads/:id/hint` — degrades `available_score` через %-rules, добавляет `hint_reply` bubble. Не закрывает задачу. Без cap'а (B5).
- Phase 2 (отдельная спека) добавляет explicit OCR pipeline + 4 verdict states. Шить prompt/verdict в `evaluateStudentAnswer` без отдельной spec **ЗАПРЕЩЕНО**.

**`task_kind` invariant:** `enum('numeric'|'extended'|'proof')` NOT NULL DEFAULT `'extended'` (миграция `20260509120000`). Backfill `check_format='short_answer' → 'numeric'`, `'detailed_solution' → 'extended'`. `'proof'` — manual mark тутором (Phase 2). Server-side validation в `handleStudentSubmission`: `numeric` requires `numeric.trim()`; `extended`/`proof` requires `photos.length ≥ 1 OR text.trim().length > 0`. Defensive default unknown = `extended`.

**Hint behavior — без cap'а:** существующая `available_score` %-degradation в `handleRequestHint` сохраняется. UI «Подсказок: N» **без** 3-cap (cap — отдельная спека, продуктовое решение).

**Phase split:**

| Phase | Scope | Spec |
|---|---|---|
| 1 (done) | Mobile ≤768px + chat + ProblemContext + SubmitSheet с reuse `handleCheckAnswer` | `docs/delivery/features/student-homework-problem-screen/spec.md` |
| 2 (deferred) | Gemini OCR pipeline + 4 verdict states + voice recorder + autosave + tutor `task_kind` selector | `student-homework-problem-grading-pipeline.md` |
| 3 (done) | Tablet/Desktop split layouts + Math keyboard popover. Hint ladder отложен. Student-side `GuidedHomeworkWorkspace` рендеринг отключён. | `~/.claude/plans/toasty-weaving-meerkat.md` |
| 4 (cleanup deferred) | Удалить `GuidedHomeworkWorkspace.tsx`, `GuidedChatInput.tsx`, `TaskStepper.tsx` после Phase 3 stable | `student-homework-problem-cutover.md` |

**При расширении:** column-whitelist invariant; `useIsMobile` hook canonical для routing + viewport-зависимых prop adaptations (CSS `md:`/`xl:` для чисто визуальных); новые routes под `/student/homework/:hwId/...` — то же 404-`NOT_FOUND` (не 403).

Spec: `docs/delivery/features/student-homework-problem-screen/spec.md`.

### Student Homework Problem Screen — Phase 3 split layouts

Расширение mobile-first screen на tablet (769–1279) + desktop (≥1280). Единственный entry point для всех viewport'ов: `/student/homework/:hwId/problem/:taskId`. `StudentHomeworkDetail` — redirect-only (universal).

**`StudentHomeworkDetail` edge cases:** empty tasks (после fetch) → redirect `/homework` (иначе бесконечное «Открываем задачу…»). All-completed → redirect `/homework`. Loading → placeholder пока `data` null / `thread` fetching (useEffect re-fires).

**Один компонент, три viewport'а:** `HomeworkProblem.tsx` единый файл. Layout branches через Tailwind (`md:`, `xl:`) + один JS prop branch для `NumericAnswerComposer.hideDiscussion`. Никаких отдельных `Mobile/Tablet/Desktop` файлов.

**Breakpoints:** Mobile `≤768px` (`useIsMobile()`); Tablet `769–1279px` (`md:` минус xl:); Desktop `≥1280px` (`xl:`).

**AuthGuard responsive fullBleed (`src/components/AuthGuard.tsx`):**
- Prop value `fullBleed='below-xl'` — backward-compat с `boolean`. На `<1280px` без `<Navigation />`; на `≥1280px` рендерит nav в `hidden xl:block` + `xl:pt-14` padding.
- Children учитывают `xl:pt-14` через CSS-var: `style={{ '--vv-h': vvHeight }}` + className `h-[var(--vv-h,100vh)] xl:h-[calc(var(--vv-h,100vh)-56px)]`. **Передавать `vvHeight` напрямую** — `useVisualViewportHeight()` уже возвращает CSS value string; дописывать `${vvHeight}px` создаёт invalid `pxpx`.
- Fallback `100vh` (НЕ `100dvh`) намеренно для Safari 15.0–15.3 (Vite таргет `safari15` не покрывает `dvh`, поддержка с 15.4). Post-hydration CSS var ресолвится в реальные пиксели.

**Root container responsive grid (`HomeworkProblem.tsx`):**
```
flex flex-col w-full bg-socrat-surface overflow-hidden
h-[var(--vv-h,100vh)]
md:grid md:grid-cols-[420px_1fr]
xl:grid-cols-[460px_1fr] xl:h-[calc(var(--vv-h,100vh)-56px)]
```

**Left aside (tablet + desktop):** tablet breadcrumb topbar `md:flex xl:hidden`; desktop hidden (global nav). Scrollable inner div: `<ProblemContext hideToggle collapsed={false} onToggle={() => undefined}>` (всегда expanded). Sticky bottom footer `<SubmitCtaBar>` **только** при `task_kind !== 'numeric'`.

**Right column:**
- Mobile-only topbar + ProblemContext peek (`md:hidden`).
- Chat thread (`flex-1 min-h-0 overflow-y-auto`) + `xl:max-w-3xl xl:mx-auto xl:w-full`.
- ChatChipRow `hidden md:flex` (tablet+desktop only).
- NumericAnswerComposer (numeric): `hideDiscussion={!useIsMobile()}`.
- **Chat composer row рендерится:** mobile — ТОЛЬКО extended/proof (numeric mobile использует NumericAnswerComposer.Row3 как discussion); tablet/desktop — **ВСЕ task_kinds** включая numeric (chat composer заменяет hidden discussion row — без него numeric tablet+ ученик не может задать AI вопрос). Условие `(data.task.task_kind !== 'numeric' || isTabletPlus)`.
- Mobile-only big-CTA «Сдать решение задачи» в extended/proof (`md:hidden` + `task_kind !== 'numeric'`). Tablet+desktop CTA в `SubmitCtaBar`. Numeric — submit через inline answer field.
- Inline hint button `md:hidden` на tablet+desktop. Forced expanded mic group на tablet+ через `micHintExpanded || recorder.isRecording || isTabletPlus`.

**One primary CTA per screen:** mobile — big-CTA (extended/proof) или inline answer (numeric); tablet/desktop — `SubmitCtaBar` или inline NumericAnswerComposer. ChatChipRow **намеренно не дублирует** «Сдать решение» — только Подсказка + Σ Формула slot.

**Chip-row composition:** Подсказка chip только при `showHint=true` (parent передаёт `false` для numeric). Math slot — `<MathQuickPicker trigger={...} />` (slot pattern, не callback — Radix Popover нужен button как anchor). **«Не понял» chip НЕ реализуется.**

**MathQuickPicker:** простой popover ~15-18 LaTeX/Unicode templates (**не MathLive**). Parent tracks `lastFocusedInputRef` через `onFocusCapture`. `insertAtCursor` использует `setRangeText(snippet, start, end, 'end')` + manual `dispatchEvent(new Event('input', { bubbles: true }))` (Safari quirk — `setRangeText` не fires input). `onOpenAutoFocus={(e) => e.preventDefault()}` (keep textarea focus, иначе snippet в position 0).

**SubmitSheet — `sm:max-w-2xl` уже на месте (Phase 1).** Mobile (<640px) full-width bottom-sheet; tablet+desktop bottom-centered max-w-2xl.

**Additive props:** `ProblemContext.hideToggle` (default `false`, скрывает toggle при `true`). `NumericAnswerComposer.hideDiscussion` (default `false`, скрывает Row 2 toggle + Row 3 discussion при `true` — на tablet/desktop chat composer redundant).

**Переиспользовано без изменений:** `StepIndicator`, `TaskImagesGallery`, `PhotoStrip`, `TypingDots`, `GuidedChatMessage`; hooks `useStudentProblemTask`/`useStudentAssignment`/`useSubmitSolution`/`useVoiceRecorder`/`useVisualViewportHeight`/`useIsMobile`; API `studentProblemApi`/`studentHomeworkApi.*`/`streamChat`. Backend (`homework-api/index.ts`) не тронут.

**Файлы Phase 3:** `AuthGuard.tsx` (fullBleed), `App.tsx` (route fullBleed="below-xl"), `StudentHomeworkDetail.tsx` (redirect-only), `HomeworkProblem.tsx`, `ProblemContext.tsx` (hideToggle), `NumericAnswerComposer.tsx` (hideDiscussion), `ChatChipRow.tsx` (NEW), `SubmitCtaBar.tsx` (NEW), `MathQuickPicker.tsx` (NEW).

**При расширении:** новый primary CTA — НЕ добавлять второй в правую колонку (SubmitCtaBar канонический). Доп chip в ChatChipRow — только через slot pattern. Hint ladder card — отложить. True hint cap (`max_hints` колонка) — no cap везде (B5). Phase 4 cleanup grep'нуть `GuidedHomeworkWorkspace`/`GuidedChatInput`/`TaskStepper` (все три legacy student-side отключены).

Spec: `~/.claude/plans/toasty-weaving-meerkat.md`.

### Student Homework Problem Screen — Phase 3.1 hotfixes

**Bug #3 — Graceful 401 handling:**
- **Инвариант:** `requestStudentHomeworkApi` (`src/lib/studentHomeworkApi.ts`) — единая точка для всех student-side API — детектит 401 → `supabase.auth.refreshSession()` → retry один раз. На persistent 401 → `supabase.auth.signOut()` → throw `StudentHomeworkApiError` с `code='SESSION_EXPIRED'`. `AuthGuard.onAuthStateChange` подхватывает SIGNED_OUT → `/login`.
- **Не добавляй** свой fetch к `/functions/v1/homework-api/...` мимо helper'а (теряешь refresh+retry).
- `StudentHomeworkApiError.code` — additive optional. Stable codes: `NO_SESSION`, `SESSION_EXPIRED`. Новые codes — расширять enum в JSDoc + UI branches.
- Error UI в `HomeworkProblem.tsx` для `SESSION_EXPIRED`: «Сессия истекла. Перенаправляем…» + spinner (refetch бесполезен).

**Bug #1 — `task_kind` / `check_format` sync (КРИТИЧЕСКИЙ инвариант):**
- ЛЮБОЙ write-path к `homework_tutor_tasks`, который трогает `check_format`, ОБЯЗАН также писать `task_kind` через `deriveTaskKind(checkFormat)` (backend) или `deriveTaskKindFromCheckFormat(checkFormat)` (frontend).
- Без этого DB default `task_kind='extended'` → все «Краткий ответ» становятся `task_kind='extended'` → `ProblemContext.tsx` рендерит warn banner «Это задача с развёрнутым решением» на ВСЕХ задачах.
- **Backend `homework-api/index.ts` — 4 write-paths:** `handleCreateAssignment` (~604, taskRows insert); `handleUpdateAssignment` (~1430 in-submissions update; ~1490 no-submissions new insert; ~1577 no-submissions existing update).
- **Frontend HWDrawer** (`src/components/kb/HWDrawer.tsx`) — client INSERT использует `checkFormatSnapshot` (из `hwDraftStore.addTask` через `resolveCheckFormatFromKb`) + `deriveTaskKindFromCheckFormat`.
- **Shared helpers** `src/lib/checkFormatHelpers.ts`: `mapAnswerFormatToCheckFormat`, `inferCheckFormatFromKim`, `resolveCheckFormatFromKb`, `deriveTaskKindFromCheckFormat` (mirror backend `deriveTaskKind`). Future write-paths импортируют отсюда.
- **`HWDraftTask.checkFormatSnapshot`** optional (backward-compat; undefined → fallback `'short_answer'`).
- Backfill migration `20260513120000_resync_task_kind_from_check_format.sql` (idempotent, **не reapply**).
- **При добавлении нового write-path:** пишешь `check_format` → **обязательно** `task_kind` в тот же payload. Smoke check: `SELECT COUNT(*) FROM homework_tutor_tasks WHERE (check_format='short_answer' AND task_kind!='numeric') OR (check_format='detailed_solution' AND task_kind!='extended');` → Expected 0.
- Симптом: репетитор сохранил «Краткий ответ», но ученик видит warn banner + полную SubmitSheet вместо inline `NumericAnswerComposer`.

**Bug #2 — SubmitSheet Ctrl+V paste:**
- `SubmitSheet.tsx` принимает `onPaste` на `<DialogPrimitive.Content>` через `handlePaste`. Dual path `clipboardData.files` + `clipboardData.items.getAsFile()` fallback (Safari/Firefox). `e.preventDefault()` **только** при image MIME. Lock check `photos.length < 5` + `isPasteUploading`. Upload через `uploadStudentThreadImage`.
- Pattern source: `GuidedChatInput.tsx` (Phase 5.1 clipboard paste) — каноническая reference.

Spec: `~/.claude/plans/toasty-weaving-meerkat.md`.

### Submit-nudge маршрутизация в обсуждении (2026-06-10)

Пилотный фидбэк (Егор/Ульяна): ученики писали финальные ответы («0,1») и крепили фото готовых решений в **scoring-neutral** поле обсуждения (`/chat`) → AI вёл сократический диалог, задача не закрывалась. Фикс — nudge-баннер «зачёт в один тап»: распознанный финальный ответ маршрутизируется в **нормальный грейдинг** (`checkAnswer` / SubmitSheet → `submitSolution`).

**Главный инвариант — НИКАКОГО тихого авто-зачёта (решение Vladimir 2026-06-10).** `/chat` остаётся scoring-neutral; nudge только подсвечивает CTA. Не возрождать идею «бот сам засчитывает из обсуждения».

**Три триггера одного баннера (`SubmitNudgeBanner.tsx`, state `submitNudge` в `HomeworkProblem.tsx`):**
1. `heuristic` — pre-send intercept в `handleChatSend` на numeric: `looksLikeBareAnswer` (`src/lib/answerLikeHeuristic.ts`). **Shape-гейт обязателен**: кандидат после среза связок (`extractAnswerCandidate`) должен начинаться с `[-+=≈]?\d` — без него «у меня не получается» / «не понимаю шаг 2» ловились баннером (review P1). `dismissedNudgeTextRef` пропускает тот же текст после «Просто обсудить».
2. `ai_marker` — guided `/chat` помечает финальный ответ токеном `[[SUBMIT_CTA]]` в конце реплики.
3. `photo_intent` — фото через скрепку в обсуждение на extended/proof → выбор «Сдать на проверку» (SubmitSheet с prefill, refs убираются из chat-вложений) / «Спросить Сократа».

**Token-контракт `[[SUBMIT_CTA]]` (КРИТИЧНО):**
- **Capability flag**: сервер инжектит инструкцию детекции ТОЛЬКО при `submitCtaMarker: true` в body (`streamChat.ts` опция → `ChatRequestBody` → `processAIRequest(submitCtaMarkerSupported)`). Флаг шлёт только `HomeworkProblem`. Это deploy-skew guard (edge деплоится Lovable раньше VPS-фронта) — старый бандл не стрипает токен. Новая поверхность с маркером — обязана стрипать токен И слать флаг.
- Токен вырезается клиентом **ДО** `saveThreadMessage` (`stripSubmitMarker`) — в БД и в `GuidedThreadViewer` токена нет.
- Streaming-display — через `stripSubmitMarkerStreaming` (придерживает хвост-префикс маркера): guided-задачи **без** эталона идут pass-through SSE (`guardedAgainstSolutionLeak = hasTutorSolution`), маркер может прийти разрезанным по дельтам.
- Telegram-бот не затронут: инструкция живёт в guided subjectBlock (`guidedHomeworkAssignmentId && resolvedSubject`) + за флагом, бот ни того ни другого не шлёт.

**SubmitSheet prefill**: props `prefillPhotos`/`prefillText` мержатся с restored draft при open (dedup, cap 5; текст — только если draft пуст; читаются через ref в restore-эффекте). **Persist-on-close** в `onOpenChange` обязателен (review P1): закрытие до 5s-autosave-тика теряло форму, включая prefill-фото, чьи refs уже убраны из chat-вложений.

**Визуальный контракт**: send обсуждения = серый `bg-slate-700` (зелёный — только «сдать», один primary на экран) + caption «Обсуждение с Сократом — не идёт на проверку». Telemetry: `submit_nudge_{shown,accepted,dismissed}` `{assignmentId, taskId, source}` — PII-free, без текста сообщений.

План/лог: `~/.claude/plans/graceful-stirring-treasure.md` + memory `project_submit_nudge_2026_06_10.md`.

### Homework constructor QA checklist

ДЗ-конструктор — **ключевой функционал**, регрессии блокируют пилот. Перед merge'ем любого PR трогающего `src/pages/tutor/TutorHomeworkCreate.tsx`, `src/components/tutor/homework-create/{HWTasksSection,HWTaskCard,HWMaterialsSection}.tsx` — **ОБЯЗАТЕЛЬНО** прогнать manual QA checklist на dev preview ИЛИ production после deploy. Это **хроническая риск-зона** (state-management regressions фиксились многократно).

**Manual QA checklist (ВСЕ пункты):**

1. **Tab-switch preservation (P0):** открыть ДЗ через `/tutor/homework/:id/edit` → дождаться prefill → добавить 2-3 задачи («+ Добавить задачу» + KB picker) → переключиться на другую вкладку, подождать **31+ секунд** → вернуться → **все задачи на месте**, list unchanged → save → verify в БД.

1a. **Image-original-task signed URL race (P0):** открыть ДЗ с **картинкой в условии** → сразу (signed URL pending) добавить новые задачи → **БЫСТРО** переключиться на другую вкладку (signed URL throttled) → подождать 30-60s → вернуться → **все задачи на месте**, картинки имеют preview, user additions НЕ overwritten signed URL `.then()` callback'ом.

2. **Edit-mode save button readiness (P0):** открыть `/tutor/homework/:id/edit` → verify «Сохранить изменения» active **в течение ~1 секунды** (не зависает на «Подготавливаем...»).

3. **KB picker append (двойной write-path):** «+ из БЗ» → выбрать 2 задачи → добавить → verify `kb_source` бейдж → save → reload → verify `kb_task_id` в БД.

4. **HWDrawer path («В ДЗ» с KB карточки) — двойной write-path:** «В ДЗ» → `hwDraftStore` → HWDrawer «Создать ДЗ» → verify `task_kind`/`check_format` derived через `deriveTaskKindFromCheckFormat`.

5. **Drag-and-drop в секциях task/solution/rubric/materials:** перетащить фото → `ring-2 ring-dashed ring-accent` + overlay «Отпустите для добавления» → drop → фото в галерее. Ctrl+V paste в textarea тоже (regression check).

6. **Subject = french/russian/literature:** создать ДЗ с subject «Французский язык» → verify save без ошибок (`homework_tutor_templates.subject` CHECK) → verify в Detail.

6a. **CEFR обязателен + язык feedback (Phase 11, french/english/spanish):** выбрать subject «Французский язык» → в L0 появляются селекторы «Уровень CEFR *» + «Язык объяснений AI» → попытка save **без** уровня → блок с «Укажите уровень CEFR» (scroll к `hw-cefr-section`). Вписать «DELF A2» в текст задания → селектор авто-prefill «A2». Выбрать A2 → save → reload `/edit` → уровень round-trip из первой задачи. Ученик A2 сдаёт → AI feedback по-русски (auto+A2), word count A2 (60-80, НЕ 160). Переключить «Язык объяснений» → «Изучаемый» → AI отвечает по-французски даже на A2. Backend defense: прямой insert language-задачи без cefr → 400 `MISSING_CEFR_LEVEL`.

7. **Max score шаг 0.5:** «Макс. баллов» — `12.5` → blur → сохранилось `12.5`; `12.7` → blur → snap на `12.5` без error modal.

8. **Speaking type-селектор (только при `feature_voice_speaking_enabled`):** выбрать «Тип ответа: Устный ответ (монолог)» → «Формат проверки» скрывается → save → reload `/edit` → тип **сохранён** как «Устный» (round-trip через `handleGetAssignment` task_kind SELECT). Переключить обратно на «Письменный» → save → verify `task_kind` derive'ится из check_format. Без флага — селектора нет (не показывать всем).

**При расширении constructor'а:**
- Любая новая `useQuery` в TutorHomeworkCreate / TutorMockExamCreate / new write-form page → **ОБЯЗАТЕЛЬНО** `{ refetchOnWindowFocus: false, staleTime: 10 * 60 * 1000 }`. Иначе smoke check Section 8 (`scripts/smoke-check.mjs`) fail'нит. (Root cause tab-switch bug: default `refetchOnWindowFocus: true` triggered refetch для `editQuery`, новый `existingAssignment` reference → race с prefill effect → overwrite unsaved tasks.)
- Любое изменение `editPrefilledRef` / `editInitialSnapshot` / reset effect ordering — повторно run QA checklist (чувствительный класс bug'ов).
- Любое изменение в `useEffect` deps для prefill effect — проверить guard'ы на refetch.

**Hard rule:** commit, трогающий constructor files, **ОБЯЗАН** содержать строку `Manual QA: checklist в .claude/rules/40-homework-system.md пройден` или эквивалентное явное подтверждение (запрос-гейт, не silent assumption).

Spec: `~/.claude/plans/1-functional-meteor.md` Phase 10.

### Папки для ДЗ — `homework_folders` (запрос Елены, 2026-06-17)

Репетитор раскладывает ДЗ по папкам (`/tutor/homework` стал folder-first, реюз UX «Моей базы»). Миграции `20260617120000` (таблица+колонка) + `20260617140000` (owner-guard триггер).

- **Таблица `homework_folders`:** `tutor_id → auth.users(id)` (FK-дрейф — как assignments, НЕ `tutors.id`), `parent_id` nullable (зарезервировано под вложенность, **v1 плоский**), `name`, `sort_order`. RLS `tutor_id=auth.uid()` → CRUD папок прямым PostgREST (`src/lib/tutorHomeworkFoldersApi.ts` + `src/hooks/useHomeworkFolders.ts`, ключ `['tutor','homework','folders']`).
- **`homework_tutor_assignments.folder_id` → `ON DELETE SET NULL` (КРИТИЧНО — отличие от KB):** удаление папки переводит ДЗ в «Без папки», **НИКОГДА не удаляет** (в папке живые задания со сдачами). `deleteHomeworkFolder` = `DELETE FROM homework_folders` only; НЕ копировать KB `removeFolder` (тот удаляет задачи). `DeleteHomeworkFolderDialog` несёт безопасный текст «задания не удалятся».
- **`folder_id` пишется ТОЛЬКО через edge** (`handleCreateAssignment`/`handleUpdateAssignment` → `validateOwnedFolderId`, рус. ошибки rule 97) **+ DB-триггер `hw_assignment_folder_owner_guard`** (defense-in-depth: `folder_id` обязан принадлежать `tutor_id` ДЗ — закрывает прямой PostgREST/import-пути; реюз `homework_folder_owned_by`). `HWDrawer` (path B) `folder_id` НЕ пишет (NULL/«Без папки»).
- **Список:** `handleListAssignments` отдаёт `folder_id` (tutor-only — student-эндпоинты его НЕ селектят); клиент делит «Без папки» (`folder_id==null`) / по папкам + счётчики (клиентский дерайв из того же списка; отражают текущий статус-фильтр). Нет серверного folder-фильтра. Страница папки `HomeworkFolderPage` фильтрует тот же кэш по `folder_id`.
- **Конструктор:** селектор «Папка» = **create-only** (отдельный стейт `createFolderId`, НЕ в `meta`) → edit-snapshot/dirty логика не задета, правка ДЗ folder_id не теряет. `FolderCard` обобщён (`taskWord`/`showChildCount`) — реюз для папок ДЗ.
- **При расширении:** новый write-path к `folder_id` → через edge + триггер уже покрывает; новый surface со списком ДЗ → реюз `folder_id` из ответа, не дублируй серверный фильтр; вложенность → задействуй `parent_id` (UI флэт сейчас).

Build-лог: memory `project_elena_requests_2026_06_17.md`. План: `~/.claude/plans/1-linked-treehouse.md`.

### Главная «Требует проверки» — точность по `tutor_reviewed_at` + отметка «Проверено» (запрос Елены, 2026-06-18)

Репорт Елены: блок **«Требует проверки»** на `/tutor/home` показывал ДЗ, которые она **уже подтвердила**. Корень: `useTutorReviewQueue` включал работы только по `thread.status='completed'`+48ч, **не сверяясь с `tutor_reviewed_at`**; review-мутации не инвалидировали ключ блока.

- **Единый source of truth «полностью проверено»** — `src/lib/homeworkReview.ts::isStudentWorkFullyReviewed(allTasks, taskScores)`: каждая задача ДЗ имеет task_score с непустым `tutor_reviewed_at`. **Пустой `allTasks` (ДЗ без задач, edge) → `true`** (vacuously — нечего проверять, иначе висит вечно). Mirror в Deno-роллапе (`handleListAssignments`). Реюз в очереди + heatmap-бейдже.
- **Очередь (`useTutorReviewQueue.fetchReviewQueue`) — двухшагово (P1 фикс):** overfetch `REVIEW_PREFETCH_THREADS=60` completed-тредов → **дешёвый** reviewed-чек (1 запрос `task_states.tutor_reviewed_at` + 1 `homework_tutor_tasks`) фильтрует проверенные **ДО** display-лимита → тяжёлый `getTutorHomeworkResults` только для финальных ≤`MAX_REVIEW_ITEMS=5`. Не фильтровать ПОСЛЕ limit (иначе пачка свежих проверенных вытеснит старую непроверенную → очередь занижается). Дедуп по ученику: проверенную работу пропускаем БЕЗ `seen` (старшая непроверенная всплывёт).
- **Инвалидация (`src/lib/tutorReviewCacheSync.ts`):** `invalidateAfterReview` (results+detail+thread+`['tutor','home','review-queue']`+`['tutor','homework','assignments']`) / `invalidateReviewHomeSurfaces` (только home, для bulk по неск. ДЗ). Подключён во ВСЕ review-мутации: `EditScoreDialog`, `StudentDrillDown` (reviewAllAi + bulkForceComplete), `GuidedThreadViewer`, `StudentProgressPanel`. Любая новая review/score/complete-мутация ДЗ → звать helper (иначе главная/карточка отстают).
- **Отметка «✓ Проверено»:** `HeatmapGrid` — emerald-бейдж у ячейки «Балл» при `displayStatus==='completed' && fullyReviewed`; `AssignmentCard` (список ДЗ) — чип «✓ Проверено»/«N на проверку» из бэкенд-роллапа `review_pending_count` (`handleListAssignments` SELECT'ит `tutor_reviewed_at`, считает сдавших-непроверенных). `review_pending_count?` optional (backward-compat).
- **0-task guard:** `handleUpdateAssignment` теперь **отклоняет `tasks: []`** (mirror create) — иначе 0-task ДЗ ломает рассчёты очереди/роллапа (review P2).
- **При расширении:** новый источник «проверено» → `isStudentWorkFullyReviewed` (не дублировать определение); новая мутация, меняющая review/completion → `invalidateAfterReview`; фильтровать reviewed дёшево ДО display-лимита, тяжёлые results — только для финальных.

Build-лог: memory `project_elena_requests_2026_06_17.md` (секция 2026-06-18). План: `~/.claude/plans/1-linked-treehouse.md`.
