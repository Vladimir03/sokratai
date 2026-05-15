# Homework System

## Система домашних заданий

В проекте **ОДНА** система домашних заданий — tutor-connected (`homework_tutor_*` таблицы), работает через **guided chat** (пошаговый AI-чат, ведёт ученика через каждую задачу с подсказками и проверкой).

Удалённые подсистемы:
- Legacy student-only (`homework_sets`, `homework_tasks`, `homework_chat_messages`) — удалена миграцией `20260310110000_drop_legacy_homework.sql`
- Classic mode (photo upload + OCR) — удалён миграцией `20260406120000_drop_classic_homework.sql`. Колонка `workflow_mode` и таблицы `homework_tutor_submissions`/`homework_tutor_submission_items` дропнуты

### Двойной write-path в `homework_tutor_tasks` — КРИТИЧНО при добавлении новых колонок (2026-04-18)

В репо есть **ДВА независимых места**, которые инсертят строки в `homework_tutor_tasks`. При добавлении новой колонки / нового поля в AI-prompt / любом cross-cutting изменении — надо править **ОБА**, иначе feature работает через один flow и молча ломается через другой.

| Путь | Entry point | Источник данных | Kто пишет в БД |
|---|---|---|---|
| **A — через edge function** | Кнопка «+ из БЗ» в конструкторе ДЗ (`TutorHomeworkCreate.tsx`) → `KBPickerSheet` → `HWTasksSection.handleAddFromKB` → `kbTaskToDraftTask` | `DraftTask[]` local state | `POST /assignments` в `homework-api/index.ts::handleCreateAssignment` / `handleUpdateAssignment` |
| **B — напрямую из клиента** | Кнопка «В ДЗ» на карточке задачи в БЗ (`src/components/kb/TaskCard.tsx` → `onAddToHW`) → `hwDraftStore.addTask` (Zustand, persisted to `sokrat-hw-draft` в localStorage) → UI корзины `HWDrawer` | `HWDraftTask[]` из Zustand | **Прямой** `supabase.from('homework_tutor_assignments').insert(...)` + `supabase.from('homework_tutor_tasks').insert(...)` в `HWDrawer.tsx` |

**Типы-носители (правь ВСЕ при изменениях):**
- Path A: `DraftTask` (`src/components/tutor/homework-create/types.ts`) + `CreateAssignmentTask` / `UpdateAssignmentTask` (`src/lib/tutorHomeworkApi.ts`) + `KBTask` конвертер (`HWTasksSection.kbTaskToDraftTask`)
- Path B: `HWDraftTask` (`src/types/kb.ts`) + `hwDraftStore.addTask` (`src/stores/hwDraftStore.ts`) + прямой INSERT в `HWDrawer.tsx`

**Симптом пропуска:** fix работает в конструкторе ДЗ, но ДЗ, созданные через «В ДЗ» с KB-карточки, оказываются с NULL в новой колонке. Именно это случилось с `solution_text` в коммите `adcdc12` и было исправлено в `f454f6e` (path B был пропущен).

**Перед мержем PR, меняющим homework_tutor_tasks, проверь:**
1. `grep -rn "from('homework_tutor_tasks')\\.insert\\|from('homework_tutor_tasks')\\.update" src/ supabase/`
2. Оба пути пишут новое поле
3. `HWDraftTask` + `DraftTask` содержат новое поле (если оно должно переноситься через корзину и конструктор)
4. `handleGetStudentAssignment` (student-side API) НЕ селектит поля, которые должны оставаться tutor-only

### AI image bucket whitelist invariant (2026-04-22)

Любой Supabase storage bucket, ссылка на который может попасть в `homework_tutor_tasks.task_image_url`, `solution_image_urls` или `rubric_image_urls`, **обязан** быть перечислен в `supabase/functions/_shared/image-domains.ts::HOMEWORK_AI_BUCKETS`. Если bucket отсутствует в whitelist:

- `chat/index.ts::isValidImageUrl` отклонит signed URL → AI получит только текст «[Задача на фото]» → **галлюцинация** (наблюдаемый случай: KB-задача по электростатике из bucket `kb-attachments` → AI описал термодинамику с P-V диаграммой).
- `homework-api/guided_ai.ts::evaluateStudentAnswer` и `generateHint` теперь **fail closed** при отсутствии резолвленной картинки + placeholder-тексте (`failure_reason: "task_image_missing"`, telemetry `guided_check_task_image_missing` / `guided_hint_task_image_missing` / `guided_chat_task_image_missing`).

**Перед мержем PR, который добавляет новый storage bucket в KB / homework write-path:**
1. Расширь `HOMEWORK_AI_BUCKETS` в `supabase/functions/_shared/image-domains.ts`.
2. `npm run smoke-check` — он SELECTит distinct prefixes из `homework_tutor_tasks.{task_image_url,solution_image_urls,rubric_image_urls}` через `storage://([^/]+)/` и падает, если найден bucket вне whitelist.
3. Передеплой `chat` и `homework-api` (whitelist используется обоими).

**Patch B+2 dual-host validator invariant (2026-05-04, PR #107/#108):** signed URLs от Supabase Storage могут попадать в БД с **обоими** host'ами — direct `*.supabase.co` (legacy + server-side SDK) и `api.sokratai.ru` (после `rewriteToProxy()` в edge function вернувшей URL клиенту, который потом сохранил его обратно — типичный flow для `homework_tutor_thread_messages.image_url`). Все 4 validator'а (`chat::isValidImageUrl` через `ALLOWED_IMAGE_DOMAINS`, `guided_ai::isAllowedSignedStorageUrl`, `homework-api/index::getLatestStudentImageUrls`, shared `image-domains::isAllowedSignedUrl`) **обязаны** принимать оба host'а через OR. JWT-токен подписан project signing key, не зависит от хоста — оба URL равноценны для Supabase Storage при resolve.

При добавлении нового signed-URL validator'а:
- Импортировать `SUPABASE_PROXY_URL` из `_shared/proxy-url.ts` (single source of truth)
- Использовать паттерн: `(supabaseUrl && url.startsWith(${supabaseUrl}/storage/v1/object/sign/)) || url.startsWith(${SUPABASE_PROXY_URL}/storage/v1/object/sign/)`
- Direct path всегда **первым** в OR (legacy и server-side SDK URLs более частый кейс)
- НЕ удалять direct path при добавлении proxy — оба нужны
- Для server-side `fetch()` на validated URL — оборачивать в `rewriteToDirect()` из `_shared/proxy-url.ts` (экономит 200-400ms на server-to-server fetch)

Симптом нарушения инварианта: AI говорит «ты прислал только фотографию условия задачи, но твоего решения здесь нет» при наличии user-uploaded photo (наблюдаемый случай: Egor 2026-05-04 после Phase B → PR #107 fix).

### Task identity — canonical source of truth (2026-04-10)

`task_id` (UUID FK to `homework_tutor_tasks.id`) — единственный immutable identity для привязки сообщений, AI-контекста и state к задаче. `task_order` — display/sort field, может меняться при reorder.

**Правила:**
- Все новые message-insert'ы ОБЯЗАНЫ включать `task_id`. `task_order` пишется для backward compat, но не используется для filtering
- Все message-filter'ы (backend и frontend) ОБЯЗАНЫ использовать `task_id` как primary match. Fallback на `task_order` допускается ТОЛЬКО для pre-migration messages (где `task_id IS NULL`)
- При отображении номера задачи в UI — resolve через `task_id → tasks[].order_num` (текущий порядок), НЕ использовать stored `message.task_order` (может быть stale после reorder)
- AI context (conversation history, task text, image) строится ТОЛЬКО по `task_id`-scoped messages

**Миграция:** `20260410153000_guided_thread_task_identity_foundation.sql` — добавила `task_id` в `homework_tutor_thread_messages` и `current_task_id` в `homework_tutor_threads`, backfill по `order_num`

**Дефолты конструктора ДЗ** (`TutorHomeworkCreate.tsx`):
- `subject: 'physics'` — предмет по умолчанию (целевой сегмент: репетиторы физики ЕГЭ/ОГЭ)
- Если репетитор меняет предмет — открыть L1 («Расширенные параметры»)

### Subject AI-promts — все 3 пути (2026-05-15)

Все три AI-пути в guided homework chat (`check` / `hint` / `chat`) обязаны получать `homework_tutor_assignments.subject` и адаптировать system prompt. До этого правила `buildHintPrompt` был hardcoded под физику («Ты — физик-наставник» + Ньютон/Ом/Кирхгоф), `buildFallbackHint` отдавал «Какая физическая величина…», `chat/index.ts SYSTEM_PROMPT` вообще не знал предмет. Симптом — репетитор по французскому языку задал ДЗ на письмо DELF B1, ученик получил от AI «Назови физическую величину».

**Контракт (mirror `Имя ученика в AI-промпте — все три пути` в `CLAUDE.md §8`):**

| Путь | Файл | Subject параметр | Как используется |
|---|---|---|---|
| Check | `guided_ai.ts::buildCheckPrompt` | `params.subject` (existed) | `Предмет: ${params.subject}` в systemContent (string `1043`) |
| Hint | `guided_ai.ts::buildHintPrompt` | `params.subject` (existed, **теперь used**) | `buildHintRoleLine(subject)` + `buildHintExamplesLine(subject)` — switch по предметам |
| Hint fallback | `guided_ai.ts::buildFallbackHint` + `buildValidatedFallbackHint` | новый optional `subject` в `taskContext` | branch: physics → старая физическая фраза; humanities → грамматика/правила; maths → формулы/теоремы; default → нейтрально |
| Chat | `chat/index.ts::processAIRequest` | `ChatRequestBody.subject` + **server-side подтверждение** через SELECT `homework_tutor_assignments.subject` | DB value WINS (anti-tamper); subject-aware блок инжектируется в `effectiveSystemPrompt` после base `SYSTEM_PROMPT` |

**Server-side подтверждение (chat path, КРИТИЧНО):**
- Если `guidedHomeworkAssignmentId` присутствует, `processAIRequest` параллельно (`Promise.all`) с taskRow fetch'ит `homework_tutor_assignments.subject` через service_role. **Серверная значение выигрывает** над client-supplied — защита от tampering (ученик не может подставить `subject='physics'` чтобы получить «физические» подсказки на чужом French ДЗ).
- Latency overhead = 0 (один Promise.all с уже-существующим taskRow fetch).

**Frontend цепочка — 3 callsite пробрасывают `assignment.subject` в `streamChat` body:**
- `src/lib/streamChat.ts` — `StreamChatOptions.subject` + body field `subject`.
- `src/components/homework/GuidedHomeworkWorkspace.tsx` — legacy desktop (main streamChat + bootstrap streamChat).
- `src/pages/student/HomeworkProblem.tsx` — mobile/Phase 3 single callsite.

**Subject helpers — двойной источник, синхронизация вручную:**
- **Frontend (TS):** `getSubjectLabel(id)` в `src/types/homework.ts:52`. Используй для UI.
- **Deno edge functions:** локальные `SUBJECT_LABELS_DENO` + `getSubjectLabelDeno()` дублируются inline **в двух** файлах: `guided_ai.ts` и `chat/index.ts`. Deno cannot import `src/types/homework.ts`. При добавлении нового subject в `SUBJECTS` — синхронно обновить обе Deno-копии, иначе AI получит raw id (`"french"`) вместо человеческого («Французский язык») в system prompt.

**`isHumanitiesWritingSubject` — UX-маркер для humanities-extended (`src/lib/subjectHelpers.ts`):**
- `true` для `russian / literature / english / french / spanish` (+ legacy `rus`).
- Применяется в **3 точках UX-адаптации** (только когда `task_kind === 'extended'`):
  - `ProblemContext.tsx` amber banner: «Это письменная задача — напиши развёрнутый ответ с ходом рассуждений» вместо «покажи ход рассуждений» (физико-математическая формулировка).
  - `SubmitSheet.tsx`: numeric input row **скрыт** (не показываем «числовой ответ» для письма / эссе). Backend `handleStudentSubmission` уже разрешает `photos.length >= 1 OR text.trim().length > 0` для extended (см. preview-QA #9 relax 2026-05-11) — никаких миграций.
  - `SubmitCtaBar.tsx` + mobile inline big-CTA в `HomeworkProblem.tsx`: subtitle переключается с «Ответ + фото решения от руки» на «Текст или фото готового решения».

**При добавлении нового AI-пути в guided chat (mirror §«Эталонное решение для AI и anti-leak»):**
- Если новый prompt-builder в `guided_ai.ts` — **обязательно** принимай `subject: string` в `Params` interface. Хотя бы одна subject-aware строка в systemContent через `getSubjectLabelDeno(params.subject)`. НЕ копируй pattern «Ты — физик-наставник».
- Если новый endpoint использует `/chat` — добавь `subject` в body (frontend источник: страница с `assignment.subject`); server-side `processAIRequest` сам подтвердит через DB.
- Если humanities-writing UX расширяется (новый предмет / новый компонент) — расширь `subjectHelpers.ts`, не делай ad-hoc switch'и в компонентах.

**Симптом нарушения:** ученик на ДЗ с `subject != 'physics'` получает от AI ответы про «физическую величину» / «закон» / «формулу Ньютона». Грепнуть:
```
grep -nE "buildFallbackHint|buildHintPrompt|streamChat\\(" src/ supabase/functions/
```
Каждый call site должен передавать `subject` (либо явно через body, либо через params).

**Спека:** `~/.claude/plans/1-functional-meteor.md`.

### Эталонное решение для AI и anti-leak (2026-04-18)

`homework_tutor_tasks.solution_text` + `homework_tutor_tasks.solution_image_urls` — единое tutor-only поле «Решение для AI». Видно AI на **всех 3 путях** (check / hint / chat) как референс для Сократовского ведения ученика. НИКОГДА не возвращается ученику. Миграция: `supabase/migrations/20260418120000_add_homework_task_solution.sql`. Лимит фото — `MAX_SOLUTION_IMAGES = 5`.

**DB контракт:**
- `solution_text TEXT NULL` — текст эталона
- `solution_image_urls TEXT NULL` — dual-format (single ref ИЛИ JSON-array), как `rubric_image_urls` / `task_image_url`. Читать только через `parseAttachmentUrls` / `serializeAttachmentUrls`

**Student leak invariant (КРИТИЧНО):**
- `handleGetStudentAssignment` в `homework-api/index.ts` НЕ селектит `solution_*` и `rubric_*` — это проверяется ревью при любом расширении student endpoints
- `StudentHomeworkTask` тип в `src/types/homework.ts` и `studentHomeworkApi.ts` НЕ содержат этих полей (compile-time гарантия)

**AI inject points:**
- `handleCheckAnswer` SELECT включает `solution_text, solution_image_urls`, передаёт в `evaluateStudentAnswer` → `buildCheckPrompt`
- `handleRequestHint` SELECT включает `solution_*` + `rubric_*` (до 2026-04-18 rubric в hint ИГНОРИРОВАЛСЯ — регресс закрыт), передаёт в `generateHint` → `buildHintPrompt`
- `/chat` edge function (`chat/index.ts`) — принимает `guidedHomeworkAssignmentId + guidedHomeworkTaskId` в body; service-role фетчит `solution_*` после верификации `homework_tutor_student_assignments`. Клиент (`streamChat` в `GuidedHomeworkWorkspace.tsx`) НЕ передаёт текст/фото решения напрямую

**Anti-spoiler защита:**
- `getGeneratedHintCheck(hint, solutionText, taskText)` в `guided_ai.ts`: extractSignificantTokens из solution минус task givens; reject при совпадении → existing Е10 retry-once → fallback. Telemetry `hint_solution_leak_rejected`
- `evaluateStudentAnswer` применяет тот же leak-check к `feedback` и `ai_score_comment`. **Retry — cosmetic rewrite**: сохраняет `verdict` / `confidence` / `error_type` / `ai_score` от первого result, свапает только `feedback` + `ai_score_comment` от retry. Grading остаётся детерминированным — не менять без осознанного решения
- `/chat` guided path — buffered (не streamed): весь ответ собирается server-side, leak-детектор, fallback-сообщение при утечке. Обычные /chat (без guided context) стримятся как раньше

**Image-only anti-leak gate (v3):**
- Константа `SOLUTION_TEXT_ANCHOR_MIN_CHARS = 20` во всех 3 путях
- Если `solution_text.trim().length < 20` — `solution_image_urls` **ДРОПАЮТСЯ** и не прикладываются к AI-промпту. Причина: leak-детектор работает только по тексту; тривиальный anchor не даёт токенов для матчинга. Image-only эталон может быть экстрактирован через «transcribe image» jailbreak
- Telemetry: `guided_check_solution_images_dropped_no_text`, `guided_hint_solution_images_dropped_no_text`, `guided_chat_solution_images_dropped_no_text`
- Продуктово: репетитор должен написать хотя бы короткий текстовый summary (≥ 20 симв), если хочет чтобы AI видел фото эталона

**KB-мост:**
- `kbTaskToDraftTask` копирует `kb.solution → draft.solution_text`, `kb.solution_attachment_url → draft.solution_image_paths` с truncation до `MAX_SOLUTION_IMAGES`
- Возвращает `{ draft, truncatedFrom, solutionTruncatedFrom }` — два отдельных toast для фото условия и фото решения

**Templates round-trip:**
- `HomeworkTemplateTask` содержит `solution_text`, `solution_image_urls`, `rubric_image_urls`
- Save: `templateTasksJson` в `handleCreateAssignment` (`homework-api/index.ts`). Load: оба места в `TutorHomeworkCreate.tsx` (URL-param + picker sheet)
- Если добавляется новое поле, видное AI, — синхронно обновить тип + оба load path'а + save path, иначе template round-trip теряет данные

**Спека:** `C:\Users\kamch\.claude\plans\wild-swinging-nova.md`

### Student Homework Problem Screen — single-task surface + submission contract (Phase 1, 2026-05-09)

Phase 1 student-side mobile-first homework problem screen использует **два новых student endpoint'а** в `supabase/functions/homework-api/index.ts`. Старая `/homework/:id` поверхность (`GuidedHomeworkWorkspace`) остаётся для desktop/tablet (viewport > 768px). Mobile (≤768px) переходит на новый screen `/student/homework/:hwId/problem/:taskId`. Спека: `docs/delivery/features/student-homework-problem-screen/spec.md`.

**Migrations (2):**
- `20260509120000_add_task_kind_to_homework_tasks.sql` — колонка `homework_tutor_tasks.task_kind text NOT NULL DEFAULT 'extended' CHECK IN ('numeric','extended','proof')` + backfill (`short_answer→numeric`, `detailed_solution→extended`).
- `20260509120100_add_submission_payload_to_thread_messages.sql` — `homework_tutor_thread_messages.submission_payload jsonb NULL` + extended CHECK constraint на `message_kind` (NULL OR IN 11 значений включая `'submission'`).

**Endpoint 1 — `GET /student/problem/:hwId/:taskId`** (`handleGetStudentProblem`):

Single-task surface: возвращает в **одном** round-trip всё, что нужно новому screen — `{assignment, task, task_total, task_score, thread, student, hints_used}`. Не chain'ить через `/assignments/:id/student` + `/assignments/:id/thread` + per-task lookups.

- **Ownership** через `homework_tutor_student_assignments` — 404 `NOT_FOUND` для не-assigned (не 403 — keeps existence private; mirrors `handleGetStudentAssignment`).
- **Lazy thread provisioning** через `provisionGuidedThread` если thread row не существует — first-open после assign работает.
- **Whitelist на каждом SELECT'е**:
  - `homework_tutor_assignments`: `id, title, subject, deadline, status` (никаких `notes_for_student` / `tutor_id` / `disable_ai_bootstrap` leak).
  - `homework_tutor_tasks`: `id, order_num, task_text, task_image_url, max_score, check_format, task_kind` — `solution_*` / `rubric_*` ИСКЛЮЧЕНЫ.
- **Thread hydration**: только через `fetchStudentThread(threadId)` — единая каноничная точка, которая strip'ит `ai_score_comment` (через `stripStudentSensitiveTaskStateFields`) + hidden tutor notes (`stripHiddenMessages`) + атачит `tutor_profile`. Не дублировать strip-логику в новом коде.
- `task_score` через `computeFinalScore(target_state, max_score)` — единый chain `tutor_score_override → earned_score → ai_score → status`.

**Endpoint 2 — `POST /student/problem/:hwId/:taskId/submission`** (`handleStudentSubmission`):

Single-shot submit для нового screen. Body `{numeric: string, photos: string[], text: string}` — `numeric` / `text` обязательно строки, `photos` массив `storage://...` refs.

**task_kind requirements (server-side enforced):**
- `numeric` → `numeric.trim()` обязателен; photos игнорируются
- `extended` → **photo OR text** (хотя бы одно); numeric **always optional** (preview-QA #9 relax 2026-05-11). Backend: `photoRefs.length >= 1 || textTrim.length > 0`.
- `proof` → **photo OR text** (хотя бы одно); numeric **hidden + ignored** (preview-QA #10 relax 2026-05-11 — proof = задача без числового ответа, но фото и/или text вывод допустимы; mirror extended без numeric). Backend: `photoRefs.length >= 1 || textTrim.length > 0`.
- `proof` → `photos.length ≥ 1`; numeric игнорируется

400 `VALIDATION` с конкретным missing field. Defensive default для unknown task_kind = treat как extended.

**Photo refs validation** через canonical `extractStudentThreadAttachmentRefs` — Patch B+2 / SSRF / bucket whitelist (`THREAD_ATTACHMENT_BUCKETS = {"homework-submissions", "homework-images"}`) / per-student namespace check (`{userId}/{assignmentId}/threads/...`). 400 `INVALID_ATTACHMENT_REF` иначе.

**answerText synthesis** (то, что AI видит как «ответ ученика»):
```ts
const lines = [];
if (taskKind !== 'proof' && numeric.trim()) lines.push(`Числовой ответ: ${numeric.trim()}`);
if (text.trim()) lines.push(text.trim());
const answerText = lines.length > 0 ? lines.join('\n') : '(см. фото решения)';
```

**Submission row** в `homework_tutor_thread_messages`:
- `role: "user"`, `message_kind: "submission"`
- `content: answerText` (synthesized)
- `image_url: serializeThreadAttachmentRefs(photos)` (dual-format string)
- `submission_payload: {numeric, photos, text}` (JSONB) — **строго** structured object, **никаких** raw user-input полей которые render'ятся как HTML
- `task_id`, `task_order: ctx.currentOrder`

**AI feedback row** использует `message_kind: "check_result"` (отличается от chat-path `ai_reply`) — semantically distinct verdict bubble для explicit submission.

**Shared helper `runStudentAnswerGrading` (single source of truth для AI grading):**

Извлечён из `handleCheckAnswer` 2026-05-09. Owns: image/OCR/student-name resolution → `evaluateStudentAnswer` → confidence guard → effective `ai_score` derivation → AI feedback message insert (`feedbackKind` параметр) → verdict branching + state update + `performTaskAdvance`. Both `handleCheckAnswer` (`feedbackKind='ai_reply'`) and `handleStudentSubmission` (`feedbackKind='check_result'`) используют его. **Не дублировать grading logic**: при изменении state-machine / AI-call правь helper, callers только differ в pre/post setup и user-message kind.

**Anti-leak invariants (КРИТИЧНО):**
1. `submission_payload` echoed back через `THREAD_SELECT` — это raw client input (`storage://` refs, не resolved signed URLs). Никакой URL transformation внутри.
2. `evaluateStudentAnswer` НЕ получает submission-specific hints в Phase 1 prompt — Phase 2 owns OCR + 4-verdict pipeline (см. spec §3 "Out of scope").
3. Никакой новой submissions-таблицы (legacy `homework_tutor_submissions` была удалена `20260406120000_drop_classic_homework.sql`, не возрождать).
4. `handleStudentSubmission` SELECT на `homework_tutor_tasks` включает `solution_text, solution_image_urls, rubric_*` (для grading), но эти поля НЕ возвращаются клиенту — они идут только в `evaluateStudentAnswer` сервер-сайд через helper.

**THREAD_SELECT extension (2026-05-09):**

Добавлен `submission_payload` в nested message select:
```
homework_tutor_thread_messages(id, role, content, image_url, task_id, task_order, message_kind, submission_payload, created_at, author_user_id, visible_to_student)
```
Submission rows доходят до клиента через `fetchStudentThread` без потерь. При добавлении нового nullable поля в messages, видимого ученику — расширять `THREAD_SELECT` явно (не `select("*")`).

**THREAD_SELECT task_states invariant (preview-QA #11 hotfix, 2026-05-11 — ROLLED BACK):**

⚠️ **НЕ добавлять `task_order` в `homework_tutor_task_states(...)` subselect** — в этой таблице такой колонки **нет** в DB schema (`homework_tutor_task_states` имеет только `id, thread_id, task_id, status, attempts, best_score, scoring fields...`, см. migration `20260306100000_guided_homework_threads.sql`).

Phase 1.5 codex fix #2 ошибочно добавил `task_order` в subselect → PostgREST возвращал 500 на любой THREAD_SELECT → student/tutor видели stuck loading + empty chat thread. **Hotfix** в Phase 1.5.1: subselect возвращён к виду:
```
homework_tutor_task_states(id, task_id, status, attempts, best_score, available_score, earned_score, wrong_answer_count, hint_count, ai_score, ai_score_comment, tutor_score_override, tutor_score_override_comment, tutor_score_override_at)
```

**Frontend контракт для resolution `task_order` из task_state:** через lookup в `assignmentDetails.tasks[].order_num` по `task_id` (mirror legacy `GuidedHomeworkWorkspace` pattern: `taskById.get(s.task_id)?.order_num`). НЕ читать `s.task_order` напрямую — всегда `undefined`. `HomeworkTaskState.task_order` теперь optional в TypeScript type.

Если в будущем понадобится `task_order` на task_state row directly — добавлять колонку через DB migration, не через select alias.

**Viewport routing (frontend):**

`StudentHomeworkDetail` через `useIsMobile()` hook (`window.innerWidth ≤ 768`) делает navigate на `/student/homework/:hwId/problem/:taskId`; иначе inline `GuidedHomeworkWorkspace`. **Без feature flag** — раскатка сразу всем mobile-юзерам. Rollback при критическом баге = `git revert <hash> && deploy-sokratai` (~3 мин). Старый `GuidedHomeworkWorkspace` остаётся в коде до Phase 4 cutover (отдельная спека).

**При расширении endpoint'а:**
1. Никакого `select("*")` на `homework_tutor_tasks` или `homework_tutor_assignments` — column whitelist остаётся жёстким.
2. Новое поле в `homework_tutor_tasks`, видимое ученику → явное решение: tutor-only (default, paranoid) / student-visible (требует обоснования).
3. Новое поле в submission_payload JSONB (например `voice_ref` Phase 2) — синхронно расширять frontend type (`src/lib/studentProblemApi.ts`) + spec §5.
4. Новый bucket для photo refs → расширять `THREAD_ATTACHMENT_BUCKETS` И smoke-check грепа `homework_tutor_thread_messages.image_url` для запрещённых хостов.
5. Phase 2 grading pipeline (Gemini OCR + 4 verdict states) — это отдельная спека `student-homework-problem-grading-pipeline.md`. Шить новый prompt/verdict в `evaluateStudentAnswer` без отдельной spec **ЗАПРЕЩЕНО** — это «AI = draft + action» инвариант.

**Спека:** `docs/delivery/features/student-homework-problem-screen/spec.md` (Phase 1, AC-1..AC-11).

### Multi-photo на задачу и рубрику (2026-04-14, frontend TASK-3..5)

`homework_tutor_tasks.task_image_url` и `homework_tutor_tasks.rubric_image_urls` — оба dual-format TEXT поля. Значение либо single `storage://...` ref (legacy + когда одно фото), либо JSON-array `["storage://...", ...]` (2+ фото). Чтение/запись через `parseAttachmentUrls` / `serializeAttachmentUrls` из `@/lib/attachmentRefs` (и Deno-клон `supabase/functions/_shared/attachment-refs.ts`).

**Лимиты (hard):** условие ≤ `MAX_TASK_IMAGES = 5`, рубрика ≤ `MAX_RUBRIC_IMAGES = 3`.

**Правила:**
- Не парсить JSON вручную. Не читать поле напрямую как строку, предполагая single-ref — всегда через helper.
- `DraftTask` в конструкторе держит `task_image_path: string | null` и `rubric_image_paths: string | null` — оба в том же dual-format.
- `TutorHomeworkCreate.tsx` не комбинирует `task_image_path || kb_attachment_url` в body — только `task_image_path ?? null`. `kb_attachment_url` остаётся в DraftTask как провенанс, не отправляется.
- KB-импорт (`HWTasksSection.kbTaskToDraftTask`) сохраняет до 5 фото из `attachment_url`; если > 5 — `toast.info('Из БЗ импортировано 5 из N фото')`. Snapshot-механика (`kb_snapshot_*`) не тронута.
- Рубрика видна ТОЛЬКО репетитору — `getStudentAssignment` не возвращает `rubric_image_urls` (RLS в TASK-6 backend).
- Миграция: `supabase/migrations/20260414120000_homework_rubric_images.sql` (additive `ADD COLUMN IF NOT EXISTS rubric_image_urls TEXT NULL` + COMMENT'ы). Legacy single-ref задачи работают без data migration.
- Frontend status: TASK-3 (HWTaskCard gallery), TASK-4 (KB-импорт), TASK-5 (TutorHomeworkCreate 3 точки записи), TASK-10 (student `TaskConditionGallery` + fullscreen carousel), TASK-11 (student batch signed-URL hook), TASK-8/9 (AI multimodal arrays), TASK-12 (TutorHomeworkDetail multi-photo + rubric section), TASK-13 (GuidedThreadViewer multi-photo task context) — ✅ done.

Спека: `docs/delivery/features/homework-multi-photo/spec.md`.

### Формат проверки задач (`check_format`, Phase 1, 2026-04-01)

Колонка `check_format` в `homework_tutor_tasks` определяет как AI проверяет ответ ученика в guided chat.

**Значения:**
- `'short_answer'` (default) — краткий ответ (число, слово, формула). AI проверяет как обычно
- `'detailed_solution'` — развёрнутое решение. AI отклоняет голые ответы без хода решения (`verdict: INCORRECT`)

**Ключевые решения:**
- Deterministic fast path (`tryDeterministicShortAnswerMatch`) **отключён** для `detailed_solution` — AI должен оценить наличие хода решения
- `buildCheckFormatGuidance()` в `guided_ai.ts` добавляет enforcement-промпт + hint при коротком ответе (`< 30 символов`)
- При добавлении задачи из KB: приоритет `task.check_format` → `mapAnswerFormatToCheckFormat(task.answer_format)` → `inferCheckFormat(kim_number)` (КИМ 21-26 → `detailed_solution`). Legacy `answer_format` значения (`detailed`, `number`, `text`, `choice`, `matching`) маппятся в `mapAnswerFormatToCheckFormat()` в `HWTasksSection.tsx`

**Student-facing UX (R8, 2026-04-02):**
- `StudentHomeworkTask` включает `check_format: 'short_answer' | 'detailed_solution'`
- `getStudentAssignment()` загружает `check_format` из БД
- **Notice banner** (amber) в `GuidedHomeworkWorkspace.tsx` под условием задачи: показывается только для `detailed_solution`
- **Dynamic placeholder** в `GuidedChatInput.tsx`: `answerPlaceholder` prop — `'Напиши решение с ходом рассуждений...'` для `detailed_solution`, `'Ответ...'` для `short_answer`
- **AI bootstrap**: `buildGuidedSystemPrompt('bootstrap', { checkFormat })` добавляет инструкцию упомянуть требование хода решения в intro

**Файлы:**
- `guided_ai.ts`: `buildCheckFormatGuidance()`, `EvaluateStudentAnswerParams.checkFormat`
- `index.ts`: `VALID_CHECK_FORMATS`, `handleCreateAssignment`, `handleUpdateAssignment`, `handleCheckAnswer` (SELECT + pass to AI)
- `GuidedHomeworkWorkspace.tsx`: banner, bootstrap checkFormat, answerPlaceholder pass-through
- `GuidedChatInput.tsx`: `answerPlaceholder` prop
- `src/types/homework.ts`: `StudentHomeworkTask.check_format`
- `src/lib/studentHomeworkApi.ts`: `check_format` в SELECT query
- Миграция: `20260401120000_add_check_format_to_homework_tutor_tasks.sql`
- Спека: `docs/delivery/features/check-format/spec.md`

**Tutor UI (Phase 2, 2026-04-02):**
- `HWTaskCard.tsx`: нативный `<select>` для `check_format` (Краткий ответ / Развёрнутое решение) + hint text под selector
- `HWTaskCard.tsx`: inline badge «из БЗ» (без flex на Label — flex ломает выравнивание grid) рядом с «Макс. баллов» когда `kb_task_id` и `max_score > 1`
- `HWTasksSection.tsx`: `mapAnswerFormatToCheckFormat()` — маппинг legacy `answer_format` → `check_format` enum
- `select` элемент: `font-size: 16px` + `touch-action: manipulation` (iOS Safari auto-zoom prevention)

### Ключевые файлы
- `src/lib/studentHomeworkApi.ts` — API-клиент для студентов (задания, submissions, guided chat)
- `src/hooks/useStudentHomework.ts` — React hooks для студенческого ДЗ
- `src/components/homework/` — Guided homework UI (GuidedHomeworkWorkspace, GuidedChatInput, GuidedChatMessage, TaskStepper)
- `src/components/tutor/GuidedThreadViewer.tsx` — просмотр guided-чата со стороны репетитора
- `src/lib/tutorHomeworkApi.ts` — API-клиент для репетиторов
- `supabase/functions/homework-api/` — Edge function CRUD (8 маршрутов)
- `supabase/functions/homework-reminder/` — напоминания о ДЗ (cron)

### «Последние диалоги» + tutor_last_viewed_at (2026-04-22, TASK-7)

Блок `RecentDialogsBlock` на `/tutor/home` берёт данные из **edge function** `GET /recent-dialogs` (`homework-api/index.ts::handleGetRecentDialogs`), не через PostgREST. Это намеренно: PostgREST nested `.eq()` через 3 уровня JOIN молча возвращал 0 строк при drift RLS / embed semantics; service_role обходит и консистентен с `handleGetThread`.

**Инварианты:**
- `homework_tutor_threads.tutor_last_viewed_at TIMESTAMPTZ NULL` (миграция `20260422120000_add_tutor_last_viewed_at_to_homework_threads.sql`) — timestamp последнего открытия треда репетитором.
- `NULL` трактуется как "никогда не открыт" = `unread=true`. Это intentional для всех pre-migration threads с сообщениями ученика.
- `unread = last_student_message_at > (tutor_last_viewed_at ?? 0)`. Comparison на стороне edge function, не на фронте.
- `POST /threads/:id/viewed-by-tutor` (`handleMarkThreadViewed`) обновляет `tutor_last_viewed_at`. Ownership-check: `thread → student_assignment → assignment.tutor_id === auth.uid()`.
- `GuidedThreadViewer` при mount вызывает `markThreadViewedByTutor(threadId)` fire-and-forget + invalidates `['tutor','home','recent-dialogs']`. Реф-sentinel — одна сеть-сессия на mount.
- Partial index `idx_homework_tutor_threads_student_message_desc` (student_assignment_id, last_student_message_at DESC) поддерживает aggregation-запрос.
- Dedup by `student_id` в Deno — PostgREST не имеет `DISTINCT ON`. Первое вхождение по `last_student_message_at DESC` = latest thread ученика.
- `visible_to_student=false` сообщения (hidden tutor notes) **исключаются** из latest-message lookup — они не "dialog activity".
- `lastAuthor` derivation: `role='user' → 'student'`, `role='tutor' → 'tutor'`, `role='assistant'|'system' → 'ai'`.

**Deep-link contract:**
- `/tutor/homework/:hwId?student=:sid` → `TutorHomeworkDetail` через `useSearchParams` сидирует `expandedStudentId`, scroll to `Card ref={drillDownRef}` один раз per id+student pair.
- Manual collapse сохраняется — scroll-sentinel не re-scroll'ит на последующих mount-ах того же URL.

**TASK-8 extension — Case A / Case B split (2026-04-22):**

Блок переименован в «Последние действия учеников». Payload расширен `kind` discriminator:

- `kind='task_opened'` — ученик перешёл на задачу, но не писал по ней. Signal: `max(homework_tutor_task_states.updated_at) per thread > last_student_message_at` (или student не писал вовсе). Bootstrap AI intro **не** считается за переписку per product решению. Preview = `Открыл задачу №N`, `lastAuthor='system'`, `taskOrder = thread.current_task_order`.
- `kind='conversation'` — идёт переписка. Signal: `last_student_message_at ≥ max(task_states.updated_at)`. Preview = content latest visible message. Поведение TASK-7 без изменений.

**Инварианты:**
- `latestEventAt = max(last_student_message_at, max(task_states.updated_at per thread))`. Sort all items `latestEventAt DESC` перед dedup by student.
- `unread = latestEventAt > tutor_last_viewed_at` — task-advance тоже триггерит unread (не только student message). **Frontend driver для visual state = `chat.unread` boolean** (bold name + dot при Case A); `unreadCount` рендерится только как Telegram-style counter badge при `> 0`.
- `unreadCount` для Case A всегда 0 (student не писал) — отдельный COUNT query пропускается.
- Треды без ни одного signal (`latestEventAt === 0`) отбрасываются — provisioned thread без activity репетитору не нужен.
- **Prefetch ordering**: handler НЕ использует `.order('updated_at')` — student paths (check/hint) не бампили эту колонку, top-50 LIMIT мог терять свежие items. Fetch без ORDER BY + LIMIT 500 (pilot safety cap), sort по `latestEventAt` в Deno. Belt-and-suspenders: `handleCheckAnswer` / `handleRequestHint` теперь тоже обновляют `thread.updated_at` — для будущих consumer-ов, не критично для recent-dialogs.
- **Wire-level `lastAuthor` backward compat**: union `'student' | 'tutor' | 'ai'`. Для Case A backend возвращает `'ai'` на wire (legacy-safe fallback). Новый UI branch-ит на `kind` и игнорирует `lastAuthor` в Case A, рендерит BookOpen + «Задача №N».
- Backward compat: старый deploy edge function без `kind` → фронт дефолтит `'conversation'` в `mapItem`.
- При расширении signal'ов (e.g. «ученик просмотрел материалы») — добавлять в Deno-side aggregate, не в SQL GROUP BY (PostgREST не умеет).

**Спека:** `docs/delivery/features/tutor-dashboard-v2/phase-1-follow-up-recent-dialogs.md`.

### Tutor RLS policies on guided-chat tables (TASK-9, 2026-04-22)

На таблицах `homework_tutor_threads`, `homework_tutor_thread_messages`, `homework_tutor_task_states` **обязательны** tutor SELECT policies, если tutor-side UI читает их через PostgREST. Базовая миграция `20260306100000_guided_homework_threads.sql:55-80` создала только student policies; tutor-specific policies добавлены отдельными миграциями:

- `thread_messages` — `20260406173000_enable_tutor_realtime_read_homework_thread_messages.sql` (TASK-7 эпоха)
- `threads` + `task_states` — `20260422130000_add_tutor_select_policies_on_threads_and_task_states.sql` (TASK-9)

**Invariant:** tutor видит threads / task_states только если он owner соответствующего `homework_tutor_assignments` (`tutor_id = auth.uid()`). Все 3 policies используют один JOIN-chain `thread → student_assignment → assignment.tutor_id = auth.uid()`.

**Write-path** (`UPDATE` / `INSERT` / `DELETE`) для tutor остаётся **только через edge function `homework-api`** (service_role обход RLS). Никаких tutor write policies на этих таблицах нет и не должно быть без обоснованной spec.

**Симптом отсутствия policy:** hook возвращает пустой массив, UI показывает ученика как «Неактивен» / empty weekly strip / нулевая статистика. При добавлении новой tutor-analytics surface, которая читает любую guided-chat таблицу через PostgREST, **обязательно** проверять что соответствующая SELECT policy существует.

**Спека:** `docs/delivery/features/tutor-dashboard-v2/phase-1-follow-up-student-activity.md`.

### Group-by-group rendering в StudentsActivityBlock (TASK-10, 2026-04-22)

`StudentsActivityBlock` на `/tutor/home` умеет группировать учеников по `tutor_groups`. Новый режим Segment-sort `'groups'` рендерит interleaved header rows (`role="rowheader"`, `colspan=7`) + student rows в одном `<tbody>`.

**Инварианты:**
- Default sort = `'groups'` если у репетитора есть хотя бы одна активная группа (`items.some((s) => s.groupId !== null)`). Fallback на `'attention'` когда 0 групп.
- Группы сортируются alphabetically по `short_name || name` (`localeCompare('ru')`). Секция «Без группы» всегда в конце.
- `tutor_group_memberships` имеет UNIQUE constraint `(tutor_student_id) WHERE is_active=true` — один активный membership на ученика. Код читает это как `Map<studentId, GroupRow>` (one-to-one). При изменении на multi-group понадобится `Map<studentId, GroupRow[]>` + UI решение про primary group.
- Fetch groups/memberships errors (RLS / network) не блокируют рендер — hook логгирует warning и продолжает с `groupId=null` для всех → все ученики попадают в «Без группы».
- `useState` default инициализируется один раз (via lazy initializer). Tutor added/removed группу в другой вкладке — нужен ручной refresh.
- ActivityRow memoisation сохраняется — `GroupRowsFragment` не применяет `React.memo` (section identity нестабилен между renders), но внутренние `ActivityRow` memoised поштучно.

**Спека:** `docs/delivery/features/tutor-dashboard-v2/phase-1-follow-up-group-by-group.md`.

### GuidedChatMessage perspective contract (2026-05-09)

`src/components/homework/GuidedChatMessage.tsx` — **shared** message renderer для обеих сторон guided chat. Компонент мемоизирован (`memo()`); все props кроме `message` опциональны и имеют backward-compatible defaults. После 2026-05-09 этот компонент рендерит и студенческий `GuidedHomeworkWorkspace`, и тутор-side `GuidedThreadViewer` (раньше тутор-side имел собственный inline-рендеринг с бейджами).

**Three invariants (МУСТ при любых изменениях):**

1. **`perspective='student'` (default) backward-compat.** Все callsite-ы без `perspective` prop'а должны рендерить ровно как до 2026-05-09 — это student-side `GuidedHomeworkWorkspace`. Никаких визуальных регрессий: tutor=left с avatar+name (Telegram-style identity), user=right primary bg без identity (это «я» — сам ученик), assistant=left muted. Если что-то меняется в student-side рендеринге — обновляй и spec, и student callsite одновременно.

2. **`perspective='tutor'` orientation — mirror flip.**
   - `tutor` role → **right**, primary palette (emerald, как student-side bubble), avatar+name над bubble справа (Telegram-«ты»).
   - `user` role (студент) → **left**, muted bubble, **с** avatar+name над bubble (Telegram-style identity для ученика).
   - `assistant` (AI) → **left**, **с** AI identity (см. инвариант 4 ниже) — Sokrat icon + «Сократ AI».
   - Шесть props контролируют tutor-side: `studentDisplayName`, `studentAvatarUrl`, `studentGender`, `taskMarker`, `hiddenFromStudent`, `imageResolver`. Все опциональны, но **обязаны** работать вместе — нельзя передать `studentDisplayName` без `studentAvatarUrl=null` (UserAvatar fallback'ит на инициалы).

3. **Identity props chain — single source of truth.**
   - `tutor_profile` (имя/аватар/gender репетитора) — берётся из `thread.tutor_profile`. Backend атачит через **существующий** `resolveTutorProfileForAssignment(db, assignmentId)` (`homework-api/index.ts:4733`). Не дублировать резолвер ни на frontend, ни на backend.
   - `student.display_name` — backend резолвит через **существующий** `resolveStudentDisplayName(db, studentAssignmentId)` (`homework-api/index.ts:4808`). Каскад: `tutor_students.display_name → profiles.full_name → profiles.username (filtered) → null`. Эту же функцию использует AI prompt path (`handleCheckAnswer` / `handleRequestHint`) — изменения каскада влияют на обе поверхности.
   - Frontend defensive fallback в `GuidedThreadViewer`: `student.display_name ?? student.full_name ?? student.username (filtered) ?? "Ученик"`. Защищает на момент когда frontend bundle deployed, а edge function ещё нет.

**Image resolver per-perspective:** tutor uploads landed в bucket `homework-images`, student-side uploads — в `homework-task-images`. `GuidedChatMessage` принимает `imageResolver?: (ref) => Promise<string | null>` prop, default = `getStudentTaskImageSignedUrl` (student bucket). Tutor viewer передаёт `(ref) => getHomeworkImageSignedUrl(ref, { defaultBucket: 'homework-images' })`. Если добавляется новый bucket для homework media — обнови оба callsite.

**Invariant 4 — AI identity (2026-05-09):** `role='assistant'` сообщения рендерятся с brand-identity на **обеих** сторонах (`perspective='student'` и `perspective='tutor'`). Avatar = `src/assets/sokrat-chat-icon.png` (импортируется через Vite, single source of truth — константа `AI_AVATAR_URL` в файле `GuidedChatMessage.tsx`). Display name = `'Сократ AI'` (константа `AI_DISPLAY_NAME` в том же файле). Layout: avatar слева, имя над muted bubble (Telegram-style), bubble остаётся muted без primary palette. При rebrand'е AI persona — менять только две константы. Не передавать tutorAvatarUrl/tutorDisplayName props для `role='assistant'` сообщений — они игнорируются, идентичность assistant не конфигурируется через props по дизайну (brand consistency).

**Student name override (2026-05-09):** `GuidedThreadViewer` принимает опциональный `studentNameOverride?: string | null` — имя ученика, уже резолвлёное родителем (например `TutorHomeworkDetail.details.assigned_students[*].name`). Когда передано, **wins over** `student.display_name` из своего fetch'а. Это deploy-independent fix: имя появляется мгновенно, не требует redeploy edge function. Каскад в `studentDisplayLabel` useMemo: `studentNameOverride → student.display_name → student.full_name → student.username (filtered) → "Ученик"`.

**Timestamp format per-perspective:** student-side показывает только время (`HH:MM`) — диалог идёт в реальном времени. Tutor-side показывает дату+время через prop `showDateInTimestamp` — сообщения могут быть из давних тредов. Не убирать без отдельного UX-решения.

**Files:**
- `src/components/homework/GuidedChatMessage.tsx` — компонент
- `src/components/homework/GuidedHomeworkWorkspace.tsx` — student callsite (`perspective='student'`)
- `src/components/tutor/GuidedThreadViewer.tsx` — tutor callsite (`perspective='tutor'` + 6 props)
- `supabase/functions/homework-api/index.ts::handleGetTutorStudentThread` — backend атачит `tutor_profile` к thread + резолвит `student.display_name`

### Realtime thread viewer (E9, 2026-04-06)
- Для live-обновлений треда репетитора таблица `public.homework_tutor_thread_messages` должна быть добавлена в publication `supabase_realtime`
- Каноничная миграция: `20260406143000_enable_realtime_homework_tutor_thread_messages.sql`
- Scope realtime Phase 1: только `INSERT` события сообщений guided chat; не расширять эту настройку на другие homework-таблицы без отдельной spec

### LaTeX в деталях и результатах ДЗ (Sprint 1, 2026-03-17)
- `TutorHomeworkDetail.tsx` — task_text, correct_answer, student_text, ai_feedback рендерятся через `MathText`
- `TutorHomework.tsx` — сортировка (created_desc / deadline_asc) + deadline urgency badges (overdue/today/soon/normal)
- **Правило**: dense surfaces (collapsed card headers, lists) → `stripLatex` + truncation; expanded/detail views → полный `MathText`

### Merged Detail + Results страница (2026-04-07)
- `TutorHomeworkResults.tsx` **удалён**. Полезная функциональность (v2-шапка `ResultsHeader`, `ResultsActionBlock`, hint chip «Много подсказок», telemetry `results_v2_opened`) переехала в `TutorHomeworkDetail.tsx`. Причина: на `/tutor/homework/:id/results` из UI никто не линковал — туда вели только Telegram deep links
- Каноничный URL для детальной страницы ДЗ — `/tutor/homework/:id`
- Route `/tutor/homework/:id/results` оставлен как `<Navigate to="/tutor/homework/:id" replace>` (local helper `RedirectHomeworkResultsToDetail` в `App.tsx`) — backward compat для старых Telegram/push уведомлений
- `ResultsHeader` получил optional `rightSlot?: ReactNode` + `backTo?: string`. Detail передаёт `rightSlot={<DetailActions status=... />}` — внутри status badge («Черновик»/«Активное»/«Завершено») + «Редактировать» + «Удалить ДЗ». На мобиле кнопки = icon-only (`hidden md:inline` для текста)
- Секция «Задачи» в Detail — **collapsible**, свёрнута по умолчанию (`useState(false)`). Раскрытие по клику на заголовок с chevron
- **Semantic invariant: метрика «Требует внимания»** в шапке = `notStarted + per_student.filter(s => s.needs_attention).length`. Backend считает `needs_attention` для сдавших (`final_score < 0.3 × max_score` OR `hint_total >= ceil(tasks.length * 0.6)`) и явно ставит `false` для не сдавших и in-progress. Frontend **обязан** прибавлять `notStarted` — иначе метрика в шапке не согласуется с action block. In-progress студенты выделены в отдельную метрику «В процессе» в `ResultsHeader` и отдельную секцию в `ResultsActionBlock`
- Условия попадания в «Требует внимания» (логическое ИЛИ):
  1. Не приступал (нет thread вообще) — `notStarted` на frontend
  2. Сдал с `final_score < 30% max_score` — `lowScore` в backend
  3. Сдал + `hint_total >= ceil(tasks.length * 0.6)` — `overuse` в backend
- **In-progress студенты НЕ входят в «Требует внимания»** — они отображаются отдельно (метрика «В процессе» + своя секция в action block)
- Query key unification: Detail использует `['tutor','homework','detail', id]` для assignment query, `['tutor','homework','results', id]` для results query. `TutorHomeworkResults` раньше использовал `['tutor','homework','assignment', id]` — этот ключ **больше не используется**, не копировать в новый код
- `hintTotalByStudent: Map<string, number>` строится **внутри** `HeatmapGrid` из `results.per_student` (прежде в Detail) — чип «Много подсказок» рендерится рядом с delivery badge при `hintTotal >= hintOveruseThreshold(taskCount)`
- Defensive guards обязательны: `results.per_student ?? []` в telemetry useEffect, `perStudent ?? []` + `assignedStudents ?? []` в `ResultsActionBlock.useMemo`, `per_student ?? []` в `HeatmapGrid` useMemo — backend может транзиентно вернуть response без `per_student` поля

### Shared homework status module + tutor homework a11y baseline (2026-04-07)

Audit/normalize/optimize/harden pass на `/tutor/homework` и `/tutor/homework/:id` зафиксировал ряд инвариантов — не откатывать без явного решения:

- **Single source of truth для status badge:** `src/lib/homeworkStatus.ts` экспортирует `HOMEWORK_STATUS_CONFIG: Record<HomeworkAssignmentStatus, { label, className }>` + `formatHomeworkScore(score, maxScore)`. Оба consumer-а (`TutorHomework.tsx`, `TutorHomeworkDetail.tsx`) импортируют отсюда; локальные `STATUS_CONFIG` / `formatScore` копии **запрещены** — раньше они дрейфовали (detail-копия теряла `dark:` варианты на draft)
- **Subject label на ДЗ-карточках = `getSubjectLabel(item.subject as string)`** из `@/types/homework`. Локальные `SUBJECT_LABELS` карты в tutor-страницах запрещены — тип `HomeworkSubject` в `tutorHomeworkApi.ts` **уже** чем реальные runtime значения (`algebra` / `geometry` / `russian` / ...), а legacy `math` / `rus` обрабатываются через `LEGACY_SUBJECT_LABELS` внутри `getSubjectLabel`
- **Никаких subject emoji на tutor homework карточках.** `SUBJECT_EMOJI` map был удалён 2026-04-07; subject row = text-only. Per `.claude/rules/90-design-system.md` "Anti-patterns #1". Если новый дизайн просит визуальный маркер — Lucide icon, не emoji
- **Empty state — Lucide `Inbox` в circular muted bg**, не emoji. Тот же запрет
- **`AssignmentCard` — `React.memo` + `animate={false}` + `transition-shadow`** (не `transition-all`). Per `.claude/rules/performance.md` ("List-item компоненты обёрнуты в `React.memo`") + `.claude/rules/10-safe-change-policy.md` ("Card in grid: animate={false}"). Skeleton cards — тоже `animate={false}`
- **Detail page lookups — `useMemo`:** `expandedStudent` / `expandedPerStudent` обёрнуты в `useMemo([expandedStudentId, details/results])`. До этого две `find` walks выполнялись на каждом unrelated render (delete dialog, refetch races, telemetry effects)
- **Filter group = `<div role="group" aria-label="Фильтр…">` + `<button aria-pressed>`** с `min-h-[44px]` и focus-visible ring. **Не** `<TabsList>` (это фильтр одного списка, не реальный tablist) и **не** bare `<button>` без ARIA. Если нужен arrow-key keyboard support — добавлять явно, не подменять primitive
- **Sort `<select>` — `text-base` (16px) на ВСЕХ viewport-ах** + `aria-label` + `min-h-[44px]`. **Не** `sm:text-sm` — Safari iPad Auto-zoom (см. `.claude/rules/80-cross-browser.md`)
- **Stats spans на assignment card — `aria-label` (для AT) + `title` (для desktop hover)** оба, lucide icons получают `aria-hidden="true"`. `title` сам по себе не обеспечивает screen reader name
- **`TasksList` collapsible disclosure:** `aria-expanded` + `aria-controls={panelId}` где `panelId = useId()`, на `<CardContent id={panelId}>`. `min-h-[44px]` + focus-visible ring на trigger. ChevronDown — `aria-hidden`
- **`TaskImagePreview` ZoomIn button — `aria-label="Открыть фото задачи во весь экран"`** + `title` (desktop hover). Декоративный hover-overlay span — `aria-hidden`
- **`MaterialsList.handleOpen` — `toast.error('Не удалось открыть материал')` на ОБА failure path-а** (catch + null url). `alert()` запрещён — рвёт toast-driven UX, блокирует viewport на mobile, не локализуется

### Homework Student Totals — backend contract (TASK-1, 2026-04-08)

`handleGetResults` возвращает в каждом `per_student` четыре additive-поля для правых колонок HeatmapGrid (фича `homework-student-totals`):

- `total_score: number` — Σ `final_score` через **существующий** `computeFinalScore(ts, maxScore)`. Приоритет: `tutor_score_override → earned_score → ai_score → status fallback`. Не дублировать формулу. Для in-progress студентов — партиальная сумма по individually-completed задачам. `0` для не приступавших и при `total_max === 0`.
- `total_max: number` — `assignmentMaxScoreTotal`, считается один раз вне цикла per_student. Одинаков для всех учеников данного ДЗ. `0` только если у ДЗ нет задач.
- `hint_total: number` — уже существовал, оставлен как есть (= `acc.hints`).
- `total_time_minutes: number | null` — wall-clock минуты между min/max `created_at` по всем тредам ученика **любого статуса** (completed И in-progress). `Math.max(1, round(diff_ms/60000))`. `null` если нет thread/messages. Фронт использует связку `submitted` + `total_time_minutes` для 3-state рендеринга (`{N} мин` / `— в процессе` / `—`).

**Time агрегация — два round-trip'а, без N+1 и без RPC** (консистентно с остальным файлом — `handleGetResults` нигде не использует RPC):
1. `homework_tutor_threads` (all statuses) `.in('student_assignment_id', saIds)` — получить `(id, student_assignment_id)`.
2. `homework_tutor_thread_messages` `.select('thread_id, created_at').in('thread_id', allThreadIds)` — группируется в JS в `Map<thread_id, {first, last}>`, затем через `studentBySa` мапится в `Map<student_id, {first, last}>`.

Использует индекс `idx_thread_messages_thread (thread_id, created_at)` (миграция `20260306100000_guided_homework_threads.sql:46`). EXPLAIN должен показывать `Bitmap Index Scan` / `Index Scan`, **не** `Seq Scan`.

**Helper:** `computeTotalMinutes(times)` — локальный в `supabase/functions/homework-api/index.ts`, рядом с `computeFinalScore`. Защитный `!Number.isFinite(diffMs) || diffMs < 0 → null`.

**TS-тип:** `TutorHomeworkResultsPerStudent` в `src/lib/tutorHomeworkApi.ts` расширен required additive-полями `total_score`, `total_max`, `total_time_minutes` (+ JSDoc с правилами 3-state рендеринга). `hint_total` не трогали.

**Инвариант:** `total_max` одинаков у всех `per_student` одного response — не пересчитывать per-student.

Спека: `docs/delivery/features/homework-student-totals/spec.md`.

### Homework Student Totals — frontend (TASK-2, 2026-04-08)

Три правые колонки в `HeatmapGrid` — Балл / Подсказки / Время. Рендерятся в том же `<table>`, что и матрица задач, после task cells, в том же горизонтальном скролле.

**heatmapStyles.ts — single source of truth для формата времени:**
- Экспортирует тип `StudentDisplayStatus = 'completed' | 'in_progress' | 'not_started'`
- Экспортирует `formatTotalTime(minutes: number | null, status: StudentDisplayStatus): string` — ветки `not_started → '—'`, `in_progress → '— в процессе'`, `completed + null → '—'`, `completed + N → '${N} мин'`. **НЕ дублировать** — только импортировать отсюда в `HeatmapGrid`

**HeatmapGrid `<colgroup>`:** после task `<col>` добавлены три: `90px` (Балл), `60px` (Подсказки), `90px` (Время). Итог table width = `220 + 56·N + 240` px. `width: max-content` + `table-layout: fixed` — правила sticky name column не меняются

**HeatmapGrid `<thead>`:** три новых `<th>`, **не sticky** (правый край). Все `text-right`. Первый (Балл) имеет `border-l-2 border-slate-200` — визуальный сепаратор между «задачами» и «итого». Заголовок «Подсказки» — Lucide `Lightbulb` icon с `aria-label="Подсказки"` + `title="Подсказки"` (иконка сама по себе не accessible name)

**HeatmapRow props:** `totalScore`, `totalMax`, `totalTimeMinutes`, `displayStatus` — все scalar, `React.memo` shallow comparison остаётся стабильной. Деривация `displayStatus` — в map-loop `HeatmapGrid`, не внутри `HeatmapRow`:
- `submitted=true → 'completed'`
- `submitted=false && total_time_minutes !== null → 'in_progress'`
- иначе `'not_started'`

**`perStudentByStudent: Map<student_id, TutorHomeworkResultsPerStudent>`** — новый `useMemo` рядом с существующими `taskScoresByStudent` и `hintTotalByStudent`. Не консолидировать с ними — это поломает TASK-5/6 memoization, а дополнительный один проход по `per_student` дешевле регрессии

**Рендер трёх `<td>`:**
- Балл — `completed && totalMax > 0` → `formatScore(totalScore)/formatScore(totalMax)` в `font-semibold text-slate-900`; иначе `—` в `text-slate-400`. `border-l-2 border-slate-200`
- Подсказки — `completed` + `showHintOveruse` → amber chip (`bg-amber-100 text-amber-900` + Lucide `Lightbulb` 12px + `{hintTotal}`); `completed` без overuse → `{hintTotal}` в `text-slate-500`; иначе `—`. Константа `hintOveruseThreshold(taskCount)` — **одна** на весь HeatmapGrid, не создавать вторую
- Время — `formatTotalTime(totalTimeMinutes, displayStatus)`. Цвет: `completed` → `text-slate-700 tabular-nums`; `in_progress` / `not_started` → `text-slate-400`

**Все новые `<td>` используют `text-sm` (14px) + `tabular-nums`.** `text-xs` из оригинальной спеки отвергнут — 14px минимум для читаемости и для защиты от iOS auto-zoom в будущем (если `<td>` станут interactive)

**Чип «Много подсказок» в sticky name column удалён.** Единственный визуальный сигнал hint overuse теперь — amber chip в колонке «Подсказки». Это single source of truth, не дублируется

**Partial aggregates for in-progress (2026-04-10):** backend теперь fetches ALL threads (не только completed), populates `task_scores` для active threads (только individually-completed задачи), и строит партиальные агрегаты (`total_score`, `hint_total`) для in-progress студентов. Frontend показывает частичные баллы для in-progress студентов. Метрика «В процессе» выделена в отдельную карточку в `ResultsHeader`

Спека: `docs/delivery/features/homework-student-totals/spec.md` (P0-2 ✅ Done 2026-04-08).

### HeatmapGrid (Results v2 TASK-5, 2026-04-07)

`src/components/tutor/results/HeatmapGrid.tsx` — единая таблица students × tasks. **Заменил** локальный `StudentsList` в `TutorHomeworkDetail.tsx`. Локальный `DeliveryBadge` (раньше жил в Detail) **переехал внутрь** HeatmapGrid — других потребителей нет, не дублировать. Phase 2 спеки: `docs/delivery/features/homework-results-v2/spec.md` (P0-3, AC-2). TASK-3 (header), TASK-4 (action block), TASK-5 (heatmap), TASK-6 (drill-down) ✅ done.

**Backend extension (Phase 2 prerequisite, в одном PR с TASK-5):**
- `handleGetResults` (`supabase/functions/homework-api/index.ts`) теперь возвращает в каждом `per_student` поле `task_scores: { task_id; final_score; hint_count }[]`
- Сборка через `taskScoresByStudent: Record<student_id, Record<task_id, ...>>` в основном цикле task_states — `final_score` идёт через тот же `computeFinalScore(ts, maxScore)` что и агрегаты, не дублировать формулу
- Для `not_started` студентов (нет thread) → `task_scores: []`. Для `in_progress` студентов → `task_scores` содержит individually-completed задачи (не все). Отсутствие task_id в массиве = «не приступал к задаче» = серая клетка с em-dash на фронте
- Тип в `src/lib/tutorHomeworkApi.ts` → `TutorHomeworkResultsPerStudent.task_scores` — additive поле, остальные не трогали

**Цвета клеток (AC-2, single source of truth `getCellStyle`):**
- `null` (нет в `task_scores`) → `bg-slate-100 text-slate-400`, текст «—»
- `< 0.3` → `bg-red-100 text-red-900`
- `0.3 ≤ ratio < 0.8` → `bg-amber-100 text-amber-900`
- `≥ 0.8` → `bg-emerald-100 text-emerald-900`
- Текст клетки: `score/max` через `formatScore()` (trim trailing zero для 0.5 step → `2.5/4`, `10/16`)
- **НЕ дублировать** color helper в TASK-6/7/8 — импортировать из HeatmapGrid (если нужно — экспортировать) или вынести в `homeworkResultsConstants.ts`

**Layout (КРИТИЧНО для iOS Safari):**
- `<table>`: `border-separate border-spacing-0` + inline style `{ tableLayout: 'fixed', width: 'max-content' }` + `<colgroup>` с фиксированными ширинами `220px` (имя) + `56px` × N (задачи)
- **НЕ менять** на `border-collapse` — `position: sticky` на `<td>` ломается в WebKit при `border-collapse`. См. `.claude/rules/80-cross-browser.md`
- **НЕ возвращать** `w-full` на table — table-layout сожмёт колонки под container и съест горизонтальный скролл. `width: max-content` + colgroup = таблица растёт ровно на `220 + 56·N` px
- Wrapping `<div>`: `overflow-x-auto touch-pan-x` — `touch-pan-x` обязателен, иначе row `onClick` может съесть touchstart на iOS и блокировать swipe
- Sticky-колонка имени: `sticky left-0 z-10` на `<td>`, `z-20` на `<th>`. Бэкграунд = `bg-white` или `bg-slate-50` (expanded) — sticky прозрачным быть не должен, иначе содержимое будет просвечивать
- Высота клетки `h-11` (44px), `text-sm` (14px) — это не input, iOS auto-zoom не сработает

**Memoization (обязательно для перформанса):**
- `React.memo` на `HeatmapRow` и `HeatmapCell`. При 26 × 10 = 260 ячеек без memo expand/collapse заметно лагает
- `taskScoresByStudent` и `hintTotalByStudent` — `useMemo` на `per_student`. `EMPTY_TASK_SCORES_MAP` — module-scope shared empty map, чтобы не инвалидировать `HeatmapRow` memo для не сдавших
- НЕ оборачивать tasks в useMemo — это уже стабильная ссылка из props

**Drill-down (TASK-5 версия → TASK-6 ✅):**
- Клик/Enter/Space по строке → `onToggleExpand(student_id)` → state `expandedStudentId` в `TutorHomeworkDetailContent`. Только один ученик раскрыт за раз (AC-3 совместимо)
- Раскрытая строка подсвечена `bg-slate-50` (без `ring-*` — конфликтует с sticky-колонкой, выглядит грязно)
- Отдельная Card «Разбор ученика: {имя}» с `StudentDrillDown` рендерится **под** Materials в Detail. Не inline в таблице — sticky-колонка и horizontal-scroll иначе ломаются
- `expandedStudentId` + `drillDownTaskId` сбрасываются в `null` через useEffect при смене `id` (assignment)
- **Cell click (TASK-6 ✅):** `handleCellClick(studentId, taskId)` → `setExpandedStudentId(studentId)` + `setDrillDownTaskId(taskId)`. `e.stopPropagation()` обязателен — иначе всплывёт row click и toggle collapse

**Out of scope для текущей итерации (TASK-7..9):**
- `EditScoreDialog` (`tutor_score_override`) + `setTutorScoreOverride` API + Pencil-icon на клетке — TASK-7
- Telemetry `manual_score_override_saved` — TASK-8 (`results_v2_opened`, `drill_down_expanded` уже работают)
- Lightbulb-иконка на клетке при `hint_count >= 1`, title tooltip `Балл: X/Y · подсказок: Z`, footer row с avg per task, правая колонка row с total — P0-3 full, не AC-2 minimum
- KIM number в заголовке колонки — нет `kim_number` в `homework_tutor_tasks`, требует расширения схемы

### Manual score override — post-pilot fix + entry points (2026-05-08)

После пилота вылез баг: репетитор не мог поставить балл, равный AI-оценке, при наличии earned_score-деградации (см. AC-5a в `docs/delivery/features/homework-results-v2/spec.md`). Параллельно добавлены primary entry point в GuidedThreadViewer и dual-score visibility для ученика.

**EditScoreDialog инварианты (`src/components/tutor/results/EditScoreDialog.tsx`):**
- Префилл `valueText = currentOverride ?? finalScore ?? aiScore ?? 0`. **НЕ** `aiScore` first — иначе при `currentOverride=null && aiScore=1 && earned_score=0.8` диалог префилит `1`, и попытка сохранить `1` блокируется, хотя это создаёт реальный override.
- `isUnchanged` сравнивает только с **`currentOverride`** (когда override-а нет, любое сохранение — создание новой строки, не no-op).
- Заголовок-блок: `Текущий балл: X/Y (AI: Z/Y, снижено на Δ за подсказки/неверные попытки)` — explicit спред между AI raw и displayed final. AI-комментарий (`ai_score_comment`) рендерится отдельной строкой когда есть.
- Props (additive): `finalScore: number | null`, `aiScoreComment: string | null` (tutor-only).

**`THREAD_SELECT` invariant (`supabase/functions/homework-api/index.ts`):**
- Включает `tutor_score_override, tutor_score_override_comment, tutor_score_override_at` (для override visibility ученику и туторy).
- Включает `ai_score, ai_score_comment` (для tutor edit dialog).
- `stripStudentSensitiveTaskStateFields` удаляет **только** `ai_score_comment` (tutor-only). Все три override-поля идут к ученику намеренно (UX: ученик видит обе оценки при правке).

**`handleGetResults.task_scores[*]` shape (extended 2026-05-08):**
```ts
{
  task_id: string; final_score: number; hint_count: number; has_override: boolean;
  ai_score: number | null;             // raw AI (NOT degraded earned_score)
  ai_score_comment: string | null;     // tutor-only — exposed via results endpoint
  tutor_score_override: number | null;
  tutor_score_override_comment: string | null;
}
```
Не сужать `ai_score` через `?? earned_score` — нужен raw AI score для дисплея «AI: Z/Y» в диалоге.

**Entry points для EditScoreDialog (два, оба обязательны):**
1. **Primary — `GuidedThreadViewer`**: под header'ом «Условие задачи #N» строка `Балл: X/Y · AI: Z/Y · [chip ручная правка] · [Pencil] Изменить балл`. Естественный workflow: тутор читает переписку → не согласен с AI → жмёт «Изменить балл». Рендерится только когда `selectedTask !== null` и task_state существует. На мобиле кнопка icon-only (`md:inline` для текста).
2. **Secondary — `TaskMiniCard` Pencil**: 12px иконка в правом-нижнем углу мини-карточки в drill-down (как было).

Оба mount'ят один `EditScoreDialog`, передают тот же набор props.

**Student dual-score visibility (UX answer C, 2026-05-08):**
- `HomeworkTaskState` тип расширен `ai_score`, `ai_score_comment` (tutor-only — strip helper удаляет), `tutor_score_override`, `tutor_score_override_comment`, `tutor_score_override_at`.
- `TaskStepper` tooltip: при override → `Балл репетитора: X/Y` (главное) + `AI: Z/Y` + публичный комментарий в плашке. Без override → `Балл: X/Y` (resolved final_score, не raw earned_score).
- `GuidedHomeworkWorkspace` completed view:
  - Итог считается через **`final_score` sum** (через mirror `computeFinalScore`), не `earned_score`. Иначе после override итоги ученика и тутора расходятся.
  - Секция «Правки репетитора» рендерится при `tasksWithOverride.length > 0` — per-task разбор для мобильных пользователей (tooltip недоступен).

**При расширении в будущем:**
- Если добавляешь новый source балла (e.g. `peer_score` в групповом ДЗ) — расширяй `computeFinalScore` priority chain в backend, и синхронно mirror'ь в client-side helpers (`taskStepItems` builder в `GuidedHomeworkWorkspace`, `selectedTaskFinalScore` в `GuidedThreadViewer`). НЕ дублируй формулу больше чем нужно — три mirror'а уже на грани.
- Если добавляешь новое tutor-only поле в task_state — добавляй в `stripStudentSensitiveTaskStateFields`, иначе утечёт ученику через guided thread endpoints.

**Heatmap cell inclusion invariant (post-pilot 2026-05-09):**
- task_state попадает в `taskScoresByStudent` cellMap И в accumulator `studentAcc/activeStudentAcc.{final,max,hints}` при ЛЮБОМ scoring-сигнале:
  - `task_state.status === 'completed'` (исторический контракт)
  - `tutor_score_override !== null` (явная ручная правка — даже на active task без AI-оценки)
  - `ai_score !== null` (AI частично оценил ON_TRACK / INCORRECT — partial AI scores на незавершённых задачах теперь видны в heatmap)
- Skip-условие: thread активен И ни один сигнал не присутствует (`provisionGuidedThread`-stub строки со `status='active'` БЕЗ override и БЕЗ ai_score). Это защищает от false-zero ячеек на нетронутых задачах.
- Side effect, который нужно учесть при изменениях: aggregate `acc.final` и `acc.max` для in-progress students теперь включают partial AI scores. `lowScore = acc.max > 0 && acc.final < 0.3 * acc.max` — semantically остаётся консистентным (числитель и знаменатель расширяются согласованно).
- Симптом нарушения инварианта: override сохранён в БД (видно через `GET /threads/...` или прямым SQL), но клетка в `HeatmapGrid` или `TaskMiniCard` показывает «—». Грепнуть `if (!isCompleted && !isTaskCompleted` в `homework-api/index.ts` — должно быть полное условие с `&& !hasOverride && !hasAiScore`.

**Score step invariant (post-pilot 2026-05-09):**
- `tutor_score_override` И `ai_score` валидируются как multiples of **0.1** с tolerance `1e-9` (защита от floating-point junk типа `1.7 * 10 = 16.999...`).
- Validator pattern (используется и в frontend, и в backend):
  ```ts
  const scaled = value * 10;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) return error('multiple of 0.1');
  ```
- AI prompt в `buildAiScoreGuidance` (`guided_ai.ts`) запрашивает шаг 0.1 у модели.
- DB precision уже `numeric(5,2)` (миграция `20260408120000`) — поддерживает 0.1 без изменений.
- Backward compat: старые 0.5-стэппед записи остаются валидными (0.5 ∈ multiples of 0.1). Не нужна data-миграция.
- 5 точек, которые **обязаны** оставаться в синхроне при будущих изменениях шага:
  1. `supabase/functions/homework-api/index.ts::handleSetTutorScoreOverride` validator
  2. `supabase/functions/homework-api/guided_ai.ts::buildAiScoreGuidance` prompt text
  3. `src/components/tutor/results/EditScoreDialog.tsx` validator (`validationError` useMemo)
  4. `src/components/tutor/results/EditScoreDialog.tsx` `<input step={0.1}>`
  5. `src/components/tutor/results/EditScoreDialog.tsx` hint text `0..N, шаг 0.1`

### Drill-down (Results v2 TASK-6, 2026-04-07)

- `src/components/tutor/results/heatmapStyles.ts` — single source of truth для `getCellStyle` + `formatScore`. Вынесено из `HeatmapGrid.tsx` — react-refresh/only-export-components предупреждение при экспорте non-component из component file. **НЕ дублировать** color/format helpers — импортировать отсюда.
- `src/components/tutor/results/TaskMiniCard.tsx` — `React.memo` мини-карточка задачи. Props: `{ taskOrder, taskId, score, maxScore, hintCount, isSelected, isAllTasks?, onSelect }`. Цвет фона через `getCellStyle`. `ring-2 ring-slate-800 ring-offset-1` при `isSelected`. Lucide `Lightbulb` 12px при `hintCount >= 1`. `touch-action: manipulation`. `aria-pressed`, `role="button"`, `tabIndex={0}`.
- `src/components/tutor/results/StudentDrillDown.tsx` — контейнер drill-down. Горизонтальный scroll-ряд (кнопка «Все задачи» + `TaskMiniCard[]`) + `GuidedThreadViewer` ниже. `key={selectedTaskId ?? 'all'}` форсит ремоунт viewer при смене задачи — сбрасывает E9 realtime channel, E8 collapsible context, scroll. `hideTaskFilter={true}` скрывает внутренний ряд pill в viewer. `touch-pan-x` на scroll-ряду. Нет вложенных Card (правило design system).
- `GuidedThreadViewer` props (additive): `initialTaskFilter?: number | 'all'` (default `'all'`), `hideTaskFilter?: boolean` (default `false`).
- `TutorHomeworkDetail` state: `drillDownTaskId: string | null`. `handleCellClick = useCallback((studentId, taskId) => { setExpandedStudentId(studentId); setDrillDownTaskId(taskId); }, [])`. `handleToggleExpand` сбрасывает `drillDownTaskId` при collapse или при expand другого ученика.
- Telemetry `drill_down_expanded` — payload `{ assignmentId, studentId, firstProblemTaskOrder }`. Fired ОДИН раз на expand, отслеживается через `lastDrillTrackedRef`. `firstProblemTaskOrder`: первая задача где `score/max < 0.3 || hint_count >= 1`; иначе первая где `< 0.8`; иначе `null`.

### Реминдер ученику с выбором канала (2026-04-07)
- `RemindStudentDialog.tsx` — Radix Dialog с **tabs** `[Telegram] [Email]` сверху. Дефолтная активная вкладка = Telegram если `hasTelegram`, иначе Email. Недоступные табы рендерятся `disabled` + `aria-disabled` + `title="У ученика не привязан Telegram" / "У ученика нет email"`
- Props: `hasTelegram: boolean` + `hasEmail: boolean` (заменили старый single `channel` prop)
- `<textarea>` использует `text-base` (16px) — iOS Safari auto-zoom prevention
- `ResultsActionBlock.tsx` — кнопка «Напомнить» на row дизейблится если `!hasTelegram && !hasEmail`, с `title="Нет каналов для уведомления"` и иконкой `MailX`. Label: оба канала → `Напомнить`, только email → `Напомнить на email`, ни одного → `Нет каналов`
- Backend `handleGetAssignment` возвращает два флага на каждого assigned student: `has_telegram_link` (через `profiles.telegram_user_id` OR `telegram_sessions.user_id`) и `has_email` (через `auth.admin.getUserById` с фильтром `@temp.sokratai.ru`)
- Backend `POST /assignments/:id/students/:sid/remind` принимает optional `channel: 'auto' | 'telegram' | 'email'` в body. **`'auto'` (default)** = cascade Telegram → Email (текущее поведение). **`'telegram'` explicit** = только Telegram, 422 `NO_TELEGRAM` если не привязан, 502 `TELEGRAM_FAILED` без fallback на email. **`'email'` explicit** = только Email, 422 `NO_EMAIL` если нет email
- Push-канал **вне скоупа P0** (отложен в P1) — в UI только Telegram + Email
- Telemetry `telegram_reminder_sent_from_results` принимает `channel: res.channel` из ответа (не из выбранной tab — backend может fallback'нуться в auto-режиме)

### Homework share links / public `/p/:slug` (homework-reuse-v1 TASK-7, 2026-04-22)

`homework_share_links` (migration `20260422160000_homework_share_links.sql`, TASK-1) — множественные read-only ссылки на одно ДЗ с флагами `show_answers` / `show_solutions` / `expires_at`. Tutor-side CRUD в `homework-api/index.ts`; публичное чтение — отдельный edge function `public-homework-share` под `service_role` (TASK-4, scope не трогать отсюда).

**Tutor API контракт (`homework-api`, три новых route'а):**
- `POST /assignments/:id/share-links` — body `{ show_answers, show_solutions, expires_in_days? }`. `expires_in_days` validated positive int ≤ 365. Slug генерится через `crypto.randomUUID().replace(/-/g, "").slice(0, 8).toLowerCase()` в `generateShareLinkSlug()`, retry на UNIQUE collision ≤ 3. Ownership — `getOwnedAssignmentOrThrow` (assignment.tutor_id = auth.uid()). Response `{ slug, url, show_answers, show_solutions, expires_at, created_at }` где `url = getShareLinkAppBaseUrl() + /p/ + slug`.
- `GET /assignments/:id/share-links` — только свои ссылки на это ДЗ (фильтр `created_by = tutorUserId`), сортировка `created_at DESC`, `{ items }` wrapper.
- `DELETE /share-links/:slug` — ownership-check через фильтр `.eq('created_by', tutorUserId)` в DELETE. `.select('slug')` после delete: если 0 строк → 404 (покрывает и «не найдено», и «не твой» — **не** раскрываем существование чужих slug'ов третьему тутору, знающему формат).

**Инварианты:**
- Slug regex `/^[a-z0-9]{8}$/i` (константа `SHARE_LINK_SLUG_RE`) валидируется в DELETE **до** DB-запроса. Public endpoint TASK-4 обязан применить тот же regex на свою сторону независимо.
- `getShareLinkAppBaseUrl()` читает `PUBLIC_APP_URL` env (обязателен в prod), fallback `https://sokratai.lovable.app`. Используется и в create response, и в list items — URL генерится **серверно**, фронт не склеивает.
- Публичное чтение **НЕ через RLS** tutor-side — только RLS policy `Tutors manage own share links` защищает authenticated PostgREST доступ. Публичный endpoint использует `service_role`, обходит RLS.
- Несколько ссылок на одно ДЗ **разрешены намеренно** — родителю без ответов, коллеге с ответами, пропустившему ученику с expiry. Не пытайся дедуплицировать по `assignment_id + created_by`.

**Frontend (`ShareLinkDialog.tsx`):**
- Radix Dialog. Функции API — `createHomeworkShareLink` / `listHomeworkShareLinks` / `deleteHomeworkShareLink` в `tutorHomeworkApi.ts`. Query key `['tutor','homework','share-links', assignmentId]`.
- Toggle «Истекает через 30 дней» — один option (не селект дней), продуктово фиксирован. При off → `expires_in_days` не отправляется (никогда не истекает).
- Clipboard: primary path `navigator.clipboard.writeText` с guard `window.isSecureContext`. Fallback — legacy `document.execCommand('copy')` через hidden textarea (required для http preview / Safari < 15.4). **Не удалять fallback** — ломает копирование в preview-окружениях.
- Telemetry `homework_share_link_created` fires **один раз** в `handleCreate` success branch. Typed PII-free payload `{ assignmentId, showAnswers, showSolutions, hasExpiry }` — **без slug, без url** (slug = bearer-токен, не клади в tracker).

**Не путать с:** `homework_tutor_student_assignments` (persistent per-student assignment). `homework_share_links.slug` — отдельный public bearer-token, не FK к ученику, не раскрывает кто решал.

**Wiring:** Dialog сейчас открывается только программно. Связка с Actions-меню на `TutorHomeworkDetail` — в TASK-10. До TASK-10 через `ShareLinkDialog` из кода нет entry point в UI.

### Public share endpoint `/p/:slug` (homework-reuse-v1 TASK-4, 2026-04-22)

Edge function `supabase/functions/public-homework-share/index.ts` отдаёт read-only snapshot ДЗ по slug'у из `homework_share_links`. **Единственный публичный endpoint**, который трогает `homework_tutor_*` таблицы — для него действует отдельный anti-leak контракт. Frontend — `src/pages/PublicHomeworkShare.tsx` на route `/p/:slug` **вне AppFrame группы** (App.tsx), sibling к `/invite/:inviteCode`.

**Endpoint контракт:**
- `GET /share/:slug` — **без JWT**. Deno уровень достаёт slug через regex `/\/share\/([^/?#]+)$/` на `URL.pathname` (поддерживает и pretty-path, и прямой `/public-homework-share/share/:slug`).
- CORS `Access-Control-Allow-Origin: *` + `GET, OPTIONS`. Preflight возвращает пустой 200.
- `service_role` client с `auth.persistSession: false`. RLS обходится намеренно.
- Slug regex `/^[a-z0-9]{8}$/i` (`SLUG_RE`) **обязательно до DB-запроса** → `invalid_slug` 400. Тот же regex должен совпадать с tutor-side TASK-7 `SHARE_LINK_SLUG_RE`; **если кто-то меняет длину/формат слага в TASK-7 — синхронно обновить здесь**, иначе public endpoint отбросит валидные свежесозданные ссылки.

**Anti-leak — column-whitelisted SELECT (КРИТИЧНО):**
- `homework_tutor_assignments`: **только** `id, title`. Не селектить `notes_for_student`, `tutor_id`, `status`, `disable_ai_bootstrap`. Если в будущем понадобится поле — расширяй whitelist осознанно, не `select("*")`.
- `homework_tutor_tasks`: базовый whitelist — `id, order_num, task_text, task_image_url, max_score, kim_number, check_format`.
- `correct_answer` добавляется в SELECT **только** при `show_answers === true`. Иначе вообще не селектится (не просто скрывается на сериализации — отсутствует в памяти процесса).
- `solution_text, solution_image_urls` — аналогично, только при `show_solutions === true`.
- `rubric_text`, `rubric_image_urls` — **никогда** не селектятся (вне зависимости от флагов). Это tutor-only invariant из `.claude/rules/40-homework-system.md` §«Эталонное решение для AI и anti-leak».
- `homework_tutor_student_assignments` и имена учеников — **никогда не JOIN-ятся**. Public страница не раскрывает кто решал ДЗ.

**Expiry поведение:**
- Если `expires_at !== null && Date.parse(expires_at) < Date.now()` → response `{ expired: true }` с 200 OK. Не 410 Gone и не 404 — frontend различает «истекло» (семантический UX) vs «не найдено».
- Not-found slug → 404 `{ error: "not_found" }`.

**Signed URLs:**
- TTL = 3600s (`SIGNED_URL_TTL_SEC`). Re-issued на каждый запрос.
- `parseAttachmentUrls` из `supabase/functions/_shared/attachment-refs.ts` — единственный путь к dual-format `storage://...` полям. Не парсить JSON вручную.
- Локальный `parseStorageRef` (копия паттерна из `homework-api/index.ts`) + `hasUnsafeObjectPath` защищают от path traversal. Default bucket для task и solution images — `homework-task-images`.
- Failures `createSignedUrl` **роняются silent** (картинка исчезает из массива) — не ломают всю страницу ради одной битой ссылки.

**Telemetry:**
- `homework_share_link_visited` — **server-side only**, анонимно. Логируется как `console.warn(JSON.stringify({ event, slug, timestamp }))`. Fire только после успешной (не expired) сборки response. Без user_id, без IP, без User-Agent — slug и так достаточно для корреляции. TASK-11 может позже обернуть это в proper telemetry_events INSERT.

**Frontend контракт (`PublicHomeworkShare.tsx`):**
- Route `/p/:slug` mounted **вне AppFrame** — никакого TutorGuard. Header = logo «Сократ AI» + optional CTA «Открыть в Сократе» (показывается если `supabase.auth.getSession()` вернул session; логично для tutor'а на чужом preview, безвредно для залогиненого student'а — TutorGuard внутри отпинает).
- API клиент `src/lib/publicShareApi.ts::fetchPublicHomeworkShare(slug)` возвращает discriminated union: `{status: 'ok', data}` / `'expired'` / `'not_found'` / `'invalid_slug'` / `'error'`. 5-state UI в одном `useMemo`.
- Task rendering **inline** в этой странице (не shared). Когда TASK-3 положит `HomeworkPreviewContent` — вынесем сюда через тот же компонент, но сейчас не создавай его в TASK-4 scope (см. «Не путать» ниже).
- `MathText` загружается через `React.lazy` + Suspense с plain-text fallback (LaTeX весит ~400KB gzipped).
- Все `<img>` с `loading="lazy"` (правило performance.md). Click-to-zoom через Radix Dialog (один common `ZoomableImage` компонент).

**Не путать с:**
- TASK-3 `HomeworkPreviewContent` — shared component для tutor preview `/tutor/homework/:id/preview` и public `/p/:slug`. На момент TASK-4 ещё не существует; rendering inline в `PublicHomeworkShare.tsx`, но контрактно совместим.
- tutor-side `GET /assignments/:id/share-links` — возвращает `url: PUBLIC_APP_URL + '/p/' + slug`, т.е. именно эту страницу. Если меняется маршрут `/p/:slug` — синхронно проверь tutor-side URL генерацию в TASK-7 и memory `project_homework_reuse_v1.md`.

**При расширении endpoint:**
1. Никогда не SELECT *. Whitelist колонок остаётся жёстким.
2. Любое новое поле в `homework_tutor_tasks`, видимое публично, требует явного решения: tutor-only / show_answers-gated / show_solutions-gated / всегда-видимое. Default = tutor-only (не раскрывать).
3. Не добавлять JOIN'ы на студент-таблицы. Если нужна «кто решал» статистика — это отдельный tutor-side endpoint, не public.
4. При добавлении нового storage bucket — проверь, что `createSignedUrl` путь резолвится (default bucket `homework-task-images` может не покрыть).

### Homework preview surface — `/tutor/homework/:id/preview` + shared `/p/:slug` (homework-reuse-v1 TASK-3, 2026-04-22)

Tutor-only route `/tutor/homework/:id/preview` (внутри AppFrame) — читаемое представление всех задач одним scroll'ом с optional ответами/решениями, native `window.print()`, copy-to-Telegram. Реализовано через **stateless shared component**, чтобы public `/p/:slug` (TASK-4, отдельная секция выше) переиспользовал без изменений.

**Архитектура (shared component contract):**
- `src/components/tutor/homework-reuse/HomeworkPreviewContent.tsx` — **pure, stateless**, без data-fetching, auth-context или зависимостей от `TutorHomeworkDetail`. Props: `{ title, tasks: HomeworkPreviewTask[], showAnswers, showSolutions }`. Экспортируемый тип `HomeworkPreviewTask` wire-format совместим с `PublicShareTask` в [`src/lib/publicShareApi.ts`](../../src/lib/publicShareApi.ts) — те же поля в том же порядке.
- `src/pages/tutor/TutorHomeworkPreview.tsx` — tutor wrapper: React Query (`['tutor','homework','detail', id]`), batched signed-URL resolution, toolbar, toggles, telemetry.
- `src/pages/PublicHomeworkShare.tsx` (TASK-4) — public wrapper: URL'ы уже signed из edge function, передаёт тот же компонент.
- **Не создавать dependency** обратно от `HomeworkPreviewContent` на что-либо tutor-specific. Новый функционал (e.g. «похожие задачи», «оценить гармоничность» — Sprint 2+) должен оборачивать компонент, а не расширять его props для tutor-only полей.

**Anti-leak инварианты (параллель с TASK-4 public contract):**
- `HomeworkPreviewTask` тип **НЕ содержит** `rubric_text` / `rubric_image_urls` — compile-time гарантия, что рубрика не попадает ни в tutor preview, ни в public `/p/:slug`. Рубрика остаётся tutor-only для Detail / Edit surfaces. При расширении типа соблюдать: любое поле должно быть безопасно для публичного показа — tutor-side оборачивание «поверх» не защищает.
- `showAnswers` / `showSolutions` дефолт **OFF** на tutor toolbar и в `ShareLinkDialog` (TASK-7). Safe default — репетитор должен осознанно включить.
- `solution_text` / `solution_image_urls` рендерятся **только** при `showSolutions=true` И при наличии контента. Пустые solution-блоки не рендерятся (нет пустой секции «Решение»).

**Image resolution (две стратегии для одного компонента):**
- **Tutor path:** `TutorHomeworkPreview` батчит все `task_image_url` и `solution_image_urls` refs через [`useKBImagesSignedUrls`](../../src/hooks/useKBImagesSignedUrls.ts) (тот же pattern, что edit-mode [`HWTaskCard`](../../src/components/tutor/homework-create/HWTaskCard.tsx)). Один вызов на gallery type с дедупом по ref. **НЕ** использовать per-task `getTutorTaskImagesSignedUrls` — это N запросов вместо 1. Результат — `Record<ref, url>`, из которого `useMemo` собирает `HomeworkPreviewTask[]`.
- **Public path:** edge function `public-homework-share` подписывает URL'ы через `service_role` и возвращает готовые `string[]`. Клиент ничего не резолвит.
- `HomeworkPreviewContent` всегда получает массивы **готовых direct/signed URL'ов** — не знает о `storage://` refs. `PhotoGallery` из [`src/components/homework/shared/PhotoGallery.tsx`](../../src/components/homework/shared/PhotoGallery.tsx) рендерит thumbnails + fullscreen Dialog с swipe + arrow keys + counter.

**Print CSS — delivery contract (Safari-safe, см. `.claude/rules/80-cross-browser.md`):**
- `src/styles/homework-preview-print.css` — **linked stylesheet** через `import '@/styles/homework-preview-print.css'` в tsx (Vite emits external `<link>`). **НЕ** встраивать `@media print` через inline `<style>` тег, генерируемый runtime — Safari/WebKit исторически не учитывает такие правила при `window.print()`.
- Правила: hide `.sokrat .t-app__rail` + `.sokrat .t-app__mobile-topbar` + `.preview-toolbar`; `.sokrat.t-app { display: block }` для сброса grid; каждая задача `.preview-task { break-inside: avoid; page-break-inside: avoid }`; `@page { margin: 1.5cm }` для PDF.
- KaTeX-rendered HTML сохраняется как есть — формулы печатаются нативно без трансформаций.

**Copy-to-Telegram (AC-5):**
- Helper `buildTelegramCopyText` в `TutorHomeworkPreview.tsx`: формат `№N. <stripLatex(task_text)>` + `[см. рисунок]` если картинки есть + `Ответ: <stripLatex(correct_answer)>` если `showAnswers=true`. `stripLatex` из [`src/components/kb/ui/stripLatex.ts`](../../src/components/kb/ui/stripLatex.ts) — reuse, не дублировать.
- `copyTextToClipboard` — primary `navigator.clipboard.writeText` с guard `window.isSecureContext`; fallback на `document.execCommand('copy')` через hidden textarea (required для http preview / Safari < 15.4). Та же pattern, что в [`ShareLinkDialog`](../../src/components/tutor/homework-reuse/ShareLinkDialog.tsx) (TASK-7). **Не удалять fallback.**

**Design deviations от спек-wireframe:**
- Заголовок карточки в спеке: `Задача №N · ЕГЭ №M · X баллов`. На tutor path `kim_number: null` всегда — `homework_tutor_tasks` не имеет `kim_number` колонки. Public endpoint может заполнить через `kb_task_id` provenance → `kb_tasks.kim_number`. Компонент рендерит `· ЕГЭ №M` только при `kim_number != null`. Добавление `kim_number` в tutor API — отдельная фича (не в scope TASK-3).
- Share button в tutor toolbar — stub `toast.info('Диалог ...')` до TASK-10 integration. TASK-10 свяжет его с `ShareLinkDialog` из TASK-7.

**Telemetry (PII-free, только id + counts + boolean):**
- `homework_preview_opened` — fire-once-per-mount через `useRef<string | null>` sentinel по `assignmentId`. **Не** на каждый refetch. Payload `{ assignmentId, tasksCount }`.
- `homework_preview_printed` — в click handler Print, **до** `window.print()` через `requestAnimationFrame` (чтобы telemetry успела emit'нуться до блокировки main thread print dialog'ом). Payload `{ assignmentId, tasksCount }`.
- `homework_preview_copied_text` — после успешного `copyTextToClipboard`. Payload `{ assignmentId, tasksCount, withAnswers }`. `withAnswers` = state toggle в момент копирования — не конфигурация в момент open.

**Общий принцип при расширении:** если понадобится preview от шаблона (`homework_tutor_templates.tasks_json`) или от результата (Results v2) — соберите `HomeworkPreviewTask[]` из нужного источника и отрендерите `HomeworkPreviewContent` без изменений. Компонент не знает об источнике данных.

### Save homework tasks to «Мою базу» — `POST /assignments/:id/save-tasks-to-kb` (homework-reuse-v1 TASK-5, 2026-04-22)

Endpoint `POST /assignments/:id/save-tasks-to-kb` в `supabase/functions/homework-api/index.ts::handleSaveTasksToKB` — единственный путь, которым homework-задачи попадают в персональную KB репетитора (`kb_tasks.owner_id = tutor`). Используется и bulk-диалогом `SaveTasksToKBDialog`, и per-task `BookmarkPlus` на `HWTaskCard` в edit-mode.

**Контракт:**
- Body: `{ task_ids: string[] (≤50, UUID), folder_id?: string (UUID) | null, new_folder_name?: string (≤120) | null }`. Обязательно одно из `folder_id` / `new_folder_name`.
- Ownership: `getOwnedAssignmentOrThrow(assignmentId)` + explicit `.eq('assignment_id', id)` на tasks select + `.eq('owner_id', tutorUserId)` на folder select (если передан `folder_id`).
- Response: `{ saved: SavedEntry[], skipped: string[], created_folder: { id, name } | null }`.

**Fingerprint-based dedup — единственный путь (КРИТИЧНО):**
- Для каждой задачи вызов `rpc('kb_normalize_fingerprint', { p_text, p_answer, p_attachment_url })` (3-arg signature, мoderation V2).
- SELECT `kb_tasks WHERE owner_id = tutor AND fingerprint = fp` → если найден, возвращаем `already_in_base=true` с **его** фактической `folder_id/folder_name` (НЕ с выбранной при save). Это покрывает все три провенанса ровно: catalog copy, personal-already, manual duplicate — без спец-кейсинга `kb_task_id`.
- Если не найден — INSERT новой строки с fingerprint, `source_label: 'my'`, `folder_id` из запроса.
- **Нет** unique index на `(owner_id, fingerprint)` — SELECT-then-INSERT best-effort; конкурирующие запросы в одну миллисекунду могут создать дубли (редкий edge case). Если понадобится строгая гарантия — отдельная миграция с unique partial index `WHERE owner_id IS NOT NULL`.

**Anti-leak invariant (AC-12):**
- Handler копирует ТОЛЬКО: `task_text`, `task_image_url`, `correct_answer`, `solution_text`, `solution_image_urls`.
- `rubric_text` / `rubric_image_urls` **НИКОГДА** не селектятся из `homework_tutor_tasks` и не передаются в INSERT. Рубрика ДЗ-специфична, не часть сущности задачи. При расширении whitelist — grep SELECT-колонки на code-review.

**Inline folder create:**
- Если `new_folder_name` передан — перед INSERT делается `SELECT id, name FROM kb_folders WHERE owner_id = tutor AND parent_id IS NULL AND name ILIKE ? ` с `.find(lowercase match)` в JS (ilike не гарантирует locale-совпадение, явный `toLowerCase()` финализирует).
- Если совпадение найдено — reuse существующую, `created_folder` = `null`. Иначе INSERT новую, `created_folder = { id, name }`.
- Поведение «дважды клик по Создать» не плодит близнецов «Физика»/«Физика».

**Per-task icon (AC-13):**
- `HWTaskCard` рендерит `BookmarkPlus` ТОЛЬКО когда `onRequestSaveToKB` проп передан И `task.id` является persisted UUID (новый draft без id — иконка не рендерится, потому что backend требует реальный task_id).
- `HWTasksSection` пропагирует `onRequestSaveToKB` ТОЛЬКО когда `assignmentId` задан. `TutorHomeworkCreate` задаёт его как `isEditMode ? editId : null` → в create-mode иконка невидима.
- **Не добавлять** `BookmarkPlus` на dense-row карточки учеников / read-only views (Detail, public preview) — только в HW Create/Edit конструктор.

**Telemetry (PII-free):**
- `homework_saved_to_kb` (bulk): `{ assignmentId, tasksCount, folderId, createdFolder, alreadyInBaseCount, skippedCount }`.
- `homework_saved_to_kb_per_task` (single): `{ assignmentId, taskId, folderId, createdFolder, alreadyInBase }`.
- Оба fire **ровно один раз** на successful response. Никаких `task_text`, `folder_name`, имён — grep перед merge.

**Entry points:**
- Bulk: `SaveTasksToKBDialog` из Actions-меню на `TutorHomeworkDetail` (wiring — TASK-10).
- Single: `BookmarkPlus` на `HWTaskCard` в edit-mode `TutorHomeworkCreate`. Диалог лениво импортируется через `React.lazy` из `HWTasksSection` — bundle остаётся лёгким на create-path.

**Cache invalidation:** после save диалог инвалидирует `['tutor', 'kb']` — весь KB-scope, включая `['tutor','kb','root-folders']` и per-folder keys. Это overkill для одного save, но гарантирует консистентность при любых будущих ключах.

**Спека:** `docs/delivery/features/homework-reuse-v1/spec.md` AC-10..AC-13.

### Save-as-template post-factum — `POST /assignments/:id/save-as-template` + `PATCH /templates/:id` (homework-reuse-v1 TASK-6, 2026-04-22)

Два независимых handler'а в `supabase/functions/homework-api/index.ts`:
- `handleCreateTemplateFromAssignment` (POST) — создаёт `homework_tutor_templates` snapshot из существующего ДЗ пост-фактум.
- `handleUpdateTemplate` (PATCH) — обновляет метаданные шаблона (title / tags / topic). Hard whitelist.

**Отличие от существующих путей:**
- `POST /templates` — legacy (остаётся для tutor-inputs из template picker). Клиент передаёт `tasks_json` явно.
- `HWActionBar` checkbox «Сохранить как шаблон» при создании ДЗ (`save_as_template: true` в `POST /assignments` body) — остаётся **независимым** путём (AC-16). Два пути коэкзистируют, создают разные строки с разным `created_at`. Не пытаться их консолидировать.
- Новый `POST /assignments/:id/save-as-template` — читает tasks server-side с ownership-check; клиент передаёт только `{ title, tags, include_rubric, include_materials, include_ai_settings }`.

**`include_*` toggles — семантика:**
- `include_rubric=false` → `rubric_text` / `rubric_image_urls` в `tasks_json[*]` зануляются (не опускаются — поле остаётся с значением `null`). Backend: `includeRubric ? (t.rubric_text ?? null) : null`.
- `include_ai_settings=false` → ключ `check_format` **опускается** из `tasks_json[i]` (не зануляется). При последующем использовании шаблона применится runtime default. Backend: `if (includeAiSettings && isNonEmptyString(t.check_format)) base.check_format = t.check_format`.
- `include_materials` — **принимается, но noop** на уровне schema: `homework_tutor_templates` не хранит materials (они живут в `homework_tutor_materials` per-assignment). Handler логирует `console.info("homework_api_template_materials_noop")` для observability. UI рендерит switch как **disabled** с amber-hint «Появится в следующей версии» — AC-16 compliance + honest UX. Telemetry намеренно НЕ включает `includeMaterials`.

**Provenance `source_kb_task_id` (AC-15):**
- В `tasks_json[i]` — additive optional поле. Пишется ТОЛЬКО когда `homework_tutor_tasks.kb_task_id IS NOT NULL` (и валидный UUID).
- Backward-compatible внутри JSONB — старые template parsers игнорируют.
- Для Sprint 2+ sync-feature («обновить шаблон из базы»): следующий агент должен резолвить NULL gracefully (задача могла быть удалена из KB).

**PATCH whitelist (AC-17):**
- Константа `UPDATE_TEMPLATE_ALLOWED_KEYS = new Set(["title", "tags", "topic"])`. Любой другой ключ в body (включая `tasks_json`, `subject`, `tasks`) → 400 `"Only title, tags, topic can be updated"` **жёстко**, НЕ silent ignore. Иначе клиент с устаревшим кешем может прислать stale `tasks_json` и затереть валидные задачи шаблона.
- 404/403 не дифференцируются — не leak'аем существование чужих шаблонов (знание template id злоумышленником не должно раскрывать, что это за template).

**Редактирование задач шаблона — вне scope Sprint 1.** Добавление/удаление/правка `tasks_json[i]` требует отдельного dialog с task picker + provenance tracking для `source_kb_task_id` sync. Не добавлять в PATCH handler без отдельной spec.

**Known schema drift:**
- `homework_tutor_templates.subject` CHECK constraint (`supabase/migrations/20260226100000_homework_20.sql:40`) принимает только legacy subjects: `math, physics, history, social, english, cs`. Новые canonical subjects (`maths`, `russian`, `informatics`, etc.) **не проходят** — save-as-template для ДЗ с canonical subject вернёт DB error. Пре-existing баг, затрагивает и `POST /templates`, и legacy `save_as_template` checkbox, и новый POST `/save-as-template`. Требует отдельной миграции по паттерну `20260414150000_unify_homework_subject_check.sql`, но для таблицы `homework_tutor_templates`. Задача заспавнена; до её выполнения QA делать с subject `physics` (основной предмет пилота).

**Telemetry (PII-free):**
- `homework_saved_as_template_post_factum`: `{ assignmentId, templateId, includeRubric, includeAiSettings }`. `include_materials` намеренно НЕ включён в payload — он noop, его значение ничего не говорит о retention.
- Fire ровно один раз на successful create.

**Dialog (`SaveAsTemplateDialog.tsx`):**
- Prefill title: `${assignment.title} — шаблон` с idempotent suffix guard (при повторном сохранении не удваивается).
- Prefill tags: `[subjectLabel, topic?]` через `getSubjectLabel(assignment.subject)` + trimmed `topic`, с dedupe.
- Multi-chip tag input: Enter / comma adds, Backspace на пустом — удаляет последний, blur/submit commits draft.
- Три toggle default ON: `include_rubric`, `include_materials` (hardcoded disabled + hint), `include_ai_settings`.

**Спека:** `docs/delivery/features/homework-reuse-v1/spec.md` AC-14..AC-17.

### Fallback для legacy subject ids (2026-04-07)
- `src/types/homework.ts` — `LEGACY_SUBJECT_LABELS: Record<string, string>` для устаревших ключей предметов (`math` → `Математика`, `rus` → `Русский язык`). Применяется в `getSubjectLabel()` как второй fallback после `SUBJECT_NAME_MAP`
- Существующие ДЗ с `subject: 'math'` (до разделения на `algebra`/`geometry`) теперь рендерятся с русским лейблом, не с raw english id

### GuidedThreadViewer — UX improvements (Sprint 2, 2026-03-17)
- Убран лишний клик «Показать переписку» — тред загружается автоматически при раскрытии ученика
- `enabled` prop контролирует lazy-loading запроса (на Results-странице — по expand ученика)
- Сообщения рендерятся через `MathText` (LaTeX формулы в AI/tutor сообщениях)
- `ThreadAttachments` резолвит `storage://` refs через signed URLs и отображает как изображения или file cards
- Репетитор может прикрепить изображение к сообщению (upload через `uploadTutorHomeworkTaskImage`, ref сохраняется в `image_url`)
- Student-side `GuidedChatMessage` тоже отображает `image_url` через `ThreadAttachments` (резолвит через `getStudentTaskImageSignedUrl`)
- Backend `handleTutorPostMessage` принимает optional `image_url` в body

### GuidedThreadViewer — блок «Условие задачи» + click-to-zoom (Е8, 2026-04-06)
- Collapsible-блок «Условие задачи #N» рендерится в `GuidedThreadViewer.tsx` между row фильтров и контейнером сообщений — только при `taskFilter !== 'all'`
- Локальный state `isTaskContextExpanded` (default `true`), сбрасывается в `true` при смене `taskFilter`
- `task_text` рендерится через `MathText`; `max-h-[200px] overflow-y-auto` предотвращает переполнение при длинных условиях
- Изображение условия — `TaskContextGallery` (module-scope в `GuidedThreadViewer.tsx`): dual-format `task_image_url` читается через `parseAttachmentUrls`, batch signed URLs идут через tutor-friendly endpoint `/assignments/:id/tasks/:taskId/images`
- `TaskContextGallery` использует tutor-only cache key `['tutor', 'homework', 'task-images-preview', assignmentId, taskId]` — отдельный cache scope от student hooks, без пересечения query space
- При 1 фото — single-thumbnail zoom-dialog; при 2+ — ряд миниатюр + fullscreen carousel с counter и стрелками, визуально совпадающий со student-side `TaskConditionGallery`
- `key={selectedTask.id}` на `TaskContextGallery` — remount при переключении задачи закрывает открытый Dialog и сохраняет E8/E9 invariant
- Не трогать `ThreadAttachments` и `GuidedChatMessage` (student-side) — изолировано в tutor-домене
- Спека: `docs/delivery/features/thread-viewer-task-context/spec.md`

### Realtime thread viewer (Е9, 2026-04-07)
- `GuidedThreadViewer.tsx` подписывается на Supabase Realtime `INSERT` по `public.homework_tutor_thread_messages` с фильтром `thread_id=eq.${threadId}`
- Query cache для viewer: `['tutor', 'homework', 'thread', threadId]`; новые сообщения мержатся локально, без полного refetch
- Каноничный merge path: `mergeThreadMessage()` в `src/lib/tutorHomeworkApi.ts`
- `mergeThreadMessage()` обязан дедупить по `message.id` и сохранять сортировку по `created_at`
- Для realtime callback использовать merge-helper, а не `invalidateQueries()` — иначе будет flicker списка и лишние запросы
- Cleanup обязателен: `channel.unsubscribe()` в `useEffect` return
- Этот cleanup критичен при rapid expand/collapse viewer и при смене `threadId`
- Sticky-bottom поведение: автоскролл только если репетитор уже почти внизу треда
- Каноничный порог: `STICKY_BOTTOM_THRESHOLD_PX = 100`
- Если пользователь проскроллил вверх и читает историю, realtime не должен дёргать scroll
- Таблица `homework_tutor_thread_messages` должна быть опубликована в `supabase_realtime`
- Каноничная миграция publication: `supabase/migrations/20260406143000_enable_realtime_homework_tutor_thread_messages.sql`
- Для tutor-side Realtime нужен отдельный `SELECT` RLS policy на `homework_tutor_thread_messages`; backend `handleGetThread` сам по себе подписку не открывает
- Tutor `SELECT` policy для Realtime не строить через raw JOIN на `homework_tutor_threads` внутри `USING (...)`; использовать `SECURITY DEFINER` helper, иначе policy ломается от RLS на промежуточных таблицах
- Не добавлять новые realtime-подписки в viewer без merge-helper слоя в `tutorHomeworkApi.ts`
- Спека: `docs/delivery/features/realtime-thread/spec.md`

### Guided chat media upload — Phase 1 (2026-03-20)
- Student backend `handlePostThreadMessage` принимает optional `image_url`, принимает только `storage://...` refs и сохраняет `image_url` в `homework_tutor_thread_messages`
- `saveThreadMessage()` в `src/lib/studentHomeworkApi.ts` принимает optional `imageUrl` и отправляет его как `image_url` в `POST /threads/:id/messages`
- Phase 1 покрывает только transport/persist layer; student upload UI, Storage upload и передача student image в AI остаются в следующих фазах

### Guided chat media upload — Phase 2 (2026-03-20)
- **GuidedChatInput.tsx** — кнопка 📎 (Paperclip) слева от textarea, hidden `<input type="file" accept="image/*,.pdf" multiple>`, `AttachmentPreview` компонент (thumbnail/file card 48px, имя, размер, ✕/spinner)
- Валидация: JPG/PNG/HEIC/WebP/PDF, ≤ 10 МБ, max 3 файла
- `URL.revokeObjectURL` cleanup при unmount и remove файла
- **GuidedHomeworkWorkspace.tsx** — `attachedFiles` / `isUploading` state, file handlers, `sendUserMessage(text, mode, files?)` с multi-upload flow
- `isUploading` добавлен в race guard (`controlsDisabled`, `handleTaskClick`)
- `content` для file-only сообщений строится через placeholder (`(фото)`, `(PDF)`, `(вложения xN)`)
- **studentHomeworkApi.ts** — `uploadStudentThreadImage(file, assignmentId, threadId, taskOrder)` → upload в `homework-submissions` bucket, path `{studentId}/{assignmentId}/threads/{taskOrder}/{fileId}.{ext}`, возвращает `storage://` ref
- ID файла: `Date.now()-Math.random()` (не `crypto.randomUUID` — Safari < 15.4)
- **answer+image end-to-end**: `checkAnswer()` принимает attachment refs, backend `handleCheckAnswer` валидирует student path ownership и сохраняет serialized attachments в `homework_tutor_thread_messages`
- **retry+image**: retry failed user message передаёт serialized `image_url` из сохранённого сообщения, не теряет вложения
- AI path использует latest student images для `answer`, `hint` и `question`; PDF сохраняется и отображается, но в AI пока не передаётся

### Guided chat media upload — Phase 5 (2026-03-20)
- **5.1 Clipboard paste**: `onPaste` handler на container div в `GuidedChatInput.tsx`. Перехватывает image paste через `clipboardData.files` с fallback на `clipboardData.items` + `getAsFile()` (Safari/Firefox). Text paste не перехватывается. `preventDefault()` вызывается только после успешной валидации (type/size/max files)
- **5.2 Mobile camera**: `<input type="file" accept="image/*,.pdf" multiple>` — native file picker на iOS/Android предлагает камеру/галерею/документ picker. Bottom sheet (Variant B) отложен в P1
- **touch-action: manipulation** добавлен на все interactive элементы: 📎, Шаг, Ответ, ✕ (remove attachment) — предотвращает 300ms tap delay на iOS Safari
- **НЕ реализовано (P1)**: bottom sheet, drag-and-drop, HEIC конвертация, image compression

### Таблицы БД
- `homework_tutor_assignments` — задания (draft/active/archived)
- `homework_tutor_tasks` — задачи внутри заданий
- `homework_tutor_threads` — guided chat threads
- `homework_tutor_thread_messages` — сообщения в guided chat
- `homework_tutor_task_states` — прогресс по задачам в guided mode
- `homework_tutor_templates` — шаблоны заданий
- `homework_tutor_materials` — материалы к заданиям (PDF, images, links)
- `homework_share_links` — публичные read-only ссылки `/p/:slug` на ДЗ (homework-reuse-v1 TASK-1/TASK-7, 2026-04-22). Множественные ссылки на одно ДЗ разрешены. Tutor CRUD через `homework-api` (см. правило «Homework share links / public /p/:slug»). Публичное чтение — отдельный edge function `public-homework-share` под `service_role`

### Важно
- Система попыток (attempts) **удалена** — ученик может пересдавать без ограничений
- `src/types/homework.ts` содержит legacy-типы `HomeworkSet`/`HomeworkTask` (пока используются SUBJECTS конфиг) — не путать с активной системой

### Передача изображений задач в AI (КРИТИЧНО)

`task_image_url` в БД хранится как `storage://homework-task-images/...` — это **внутренняя** ссылка Supabase, **не HTTP URL**. AI API не может её открыть.

**Правило**: перед передачей изображения в AI (Lovable/Gemini) **ОБЯЗАТЕЛЬНО**:
1. Преобразовать `storage://` → подписанный HTTP URL через `db.storage.createSignedUrl()` (service_role) или через бэкенд-эндпоинт `GET /assignments/:id/tasks/:taskId/image-url`
2. Если путь идёт через Lovable gateway, который не скачивает remote image сам, подписанный URL нужно дополнительно заинлайнить в `data:image/...;base64,...` перед вызовом модели
3. Передать как multimodal `{ type: "image_url", image_url: { url: "https://..." } }` или `data:` URL в массиве `content` user-сообщения
4. **НИКОГДА** не вставлять `storage://` или raw URL как текст в промпт — AI его не увидит

**Четыре пути к AI в guided chat** (все должны передавать изображение корректно):
- `answer` → `handleCheckAnswer` → `evaluateStudentAnswer` в `guided_ai.ts` (в backend task читается как dual-format, резолвится в `taskImageUrls: string[]`; rubric отдельно как `rubricImageUrls?: string[]`; latest student images идут отдельным массивом и inline-ятся в `guided_ai.ts`)
- `hint` → `handleRequestHint` → `generateHint` в `guided_ai.ts` (task читается как dual-format и передаётся как `taskImageUrls: string[]`; rubric в hint не передаётся; latest student images идут отдельным массивом)
- `question` → `streamChat()` → `/functions/v1/chat` (frontend передаёт `taskImageUrls: string[]`, backend режет до `MAX_TASK_IMAGES_FOR_AI`, резолвит каждый ref и inline-ит в base64/data URL; `studentImageUrls` остаётся отдельным массивом)
- `bootstrap` → `streamChat()` → `/functions/v1/chat` (frontend передаёт только `taskImageUrls: string[]`; student image на intro не передаётся по дизайну)

**Dual-format invariant для homework images:**
- `task_image_url` и `rubric_image_urls` в БД хранятся как TEXT: single `storage://...` ref ИЛИ JSON-array refs
- frontend всегда читает через `parseAttachmentUrls` из `@/lib/attachmentRefs`
- backend edge functions читают через `_shared/attachment-refs.ts`
- в AI-path не передавать raw `storage://` как текст; сначала резолвить ref → signed URL / `data:` URL

При добавлении нового пути к AI с изображениями — проверить ВСЕ вызывающие точки, не только основную.

### Hint quality — FORBIDDEN_HINT_PHRASES + retry-once + fallback (Е10, 2026-04-06)

- `generateHint` в `supabase/functions/homework-api/guided_ai.ts` использует deterministic ban list `FORBIDDEN_HINT_PHRASES` и post-gen `validateHintContent`
- Запрещённые фразы для hint: «перечитай условие», «выдели ключевые данные», «подумай внимательнее», «вспомни материал», «что тебе дано»
- Flow: `generate -> validate -> 1 retry` с replacement prompt -> `buildFallbackHint`
- Контракт: `<= 1 retry`, никогда больше. Циклы regen запрещены, иначе latency blowout
- Fallback должен быть deterministic: упоминать существительное/термин из `task_text` или фразу про изображение задачи; длина `>= 40` символов
- Telemetry: `console.warn(JSON.stringify(...))` с событиями `hint_rejected` и `hint_fallback_used`; без текста hint, без `task_text`, без PII
- Phase B (`level escalation 1-3`) — отдельная итерация после `2026-04-08`, не добавлять в текущий flow
- Спека: `docs/delivery/features/hint-quality/spec.md`

### Student Guided Homework UX (Sprint S1, 2026-03-19)

Реализованы 5 quick wins для guided mode прорешивания:

- **S1-1: MathText в условии задачи** — `GuidedHomeworkWorkspace.tsx` рендерит `task_text` через lazy `MathText` (с `Suspense` fallback). `whitespace-pre-wrap` сохранён для plain-text задач
- **S1-2: Bootstrap для всех задач** — убрано ограничение `order_num !== 1`. AI intro генерируется при первом открытии любой задачи без сообщений. Backend system messages (`role: 'system'`) исключаются из проверки `hasAnyTaskMessages`. Backend integrity check (`INVALID_ORDER`) обходится для `message_kind: 'system'` — bootstrap сохраняется в БД и виден репетитору
- **S1-3: Enter = отправить** — `Enter` в AnswerField → проверка ответа, `Enter` в DiscussionField → обсуждение с AI. Два раздельных поля (см. Sprint S2)
- **S1-4: Label «Введение»** — `formatMessageKind('system')` → `'Введение'` в student view. В tutor `GuidedThreadViewer` — badge «Введение» только для `role: 'assistant'` + `message_kind: 'system'` (не для transition messages с `role: 'system'`)
- **S1-5: Shared preprocessLatex** — удалён inline дубликат из `GuidedChatMessage.tsx`, импорт из `@/components/kb/ui/preprocessLatex.ts`. Inline версия имела баг: `'$$'` — спецсимвол в `String.replace`

**Race guard**: `handleTaskClick` блокирует навигацию при `isStreaming || isCheckingAnswer || isRequestingHint`

### Свободный порядок задач в guided mode (2026-03-19)

Ученик может решать задачи в **любом порядке** (как на ЕГЭ/ОГЭ), а не строго последовательно.

**Backend:**
- `provisionGuidedThread` создаёт **все** `task_states` как `"active"` (было: только первая, остальные `"locked"`)
- `/threads/:id/check` и `/threads/:id/hint` принимают optional `task_order` в body — backend работает с задачей, указанной клиентом
- `loadAdvanceContext` принимает `overrideTaskOrder` — используется вместо `thread.current_task_order` когда клиент указал task_order
- `handleRequestHint` теперь получает body и ищет task_state по `task_order`, а не берёт первый `status = 'active'`

**Frontend:**
- `activeTaskOrder` = `currentTaskOrder` (следует за выбором ученика)
- `isViewingActiveTask` проверяет `currentActiveTaskState?.status === 'active'` (разрешает ввод для любой незавершённой задачи)
- `checkAnswer(threadId, answer, taskOrder)` и `requestHint(threadId, taskOrder)` передают `task_order` на backend
- `TaskStepper`: `isActive` = `order_num === currentTaskOrder` (кольцо только на текущей задаче, не на всех active)
- `activeRef` привязан только к текущей задаче для корректного auto-scroll

**Важно:**
- `thread.current_task_order` остаётся в БД, но используется как fallback — primary source of truth для check/hint теперь приходит от клиента
- `performTaskAdvance` по-прежнему обновляет `current_task_order` при завершении задачи, но это не блокирует навигацию
- Ученик НЕ МОЖЕТ отправлять ответы/подсказки для `completed` задач — проверка `status === 'active'` на обоих сторонах

### Два поля ввода «Ответ» и «Обсуждение» (Sprint S2, 2026-03-22)

Заменено одно текстовое поле на два раздельных в `GuidedChatInput.tsx`:

- **AnswerField** (зелёная рамка `border-2 border-green-600`, сверху): Enter = `onSendAnswer` → AI проверяет ответ
- **DiscussionField** (серая рамка `border border-slate-200`, снизу): Enter = `onSendStep` → AI обсуждает шаг

**Причина:** ученик путал Enter (обсуждение) и Ctrl+Enter (проверка) → AI начинал обсуждать вместо проверки → churn

**Ключевые решения:**
- Два независимых state: `answerText` + `discussionText`. Каждое поле очищается только при своей отправке
- Ctrl+Enter / Cmd+Enter **полностью убран** — больше не нужен
- `attachedFiles` — shared (один `<input type="file">`), `AttachmentPreview` фиксированно над answer-полем
- `placeholder` prop удалён — каждое поле имеет короткий hardcoded placeholder (`Ответ...` / `Обсуди с AI...`)
- Props `onSendAnswer(text)` и `onSendStep(text)` — без изменений сигнатуры

**Фазы:**
- Phase 1 (done): рефакторинг GuidedChatInput → два поля
- Phase 2 (done): аккордеон обсуждения — discussion свёрнуто по умолчанию на **всех** экранах
- Phase 3 (done): обновление GuidedHomeworkWorkspace + per-task drafts
- Phase 4 (pending): QA кросс-браузерная проверка

### Mobile UX polish (Sprint S3, 2026-03-23)

Оптимизация мобильного и десктоп-UX guided homework chat для максимизации пространства чата.

**Навигация (`Navigation.tsx`):**
- Логотип + вкладки + logout объединены в одну строку `h-14`
- Вкладка «Главная» удалена — логотип «Сократ» ведёт на `/`
- На мобиле текст «Сократ» скрыт (`hidden md:inline`), вкладки горизонтально скроллятся

**Layout workspace (`GuidedHomeworkWorkspace.tsx`):**
- Блок с названием ДЗ / предметом / статусом **удалён** (был desktop-only `hidden md:block`)
- Условие задачи: collapsible toggle работает и на mobile и на desktop
- Условие раскрыто по умолчанию (`useState(true)`) — ученик видит задачу при первом заходе
- Кнопки «Предыдущая» / «Следующая»: icon-only на мобиле (`hidden md:inline` для текста)

### Task-lock fix — фиксация задачи при check/hint (2026-04-01)

**Проблема:** при check/hint `syncThreadFromResponse()` перезаписывал `currentTaskOrder` из БД → ученик перебрасывался на другую задачу.

**Решение:**
- `syncThreadDataOnly()` — обновляет messages/task_states/status **без** изменения навигации
- `handleCheckAnswer` и `handleHint` используют `syncThreadDataOnly` вместо `syncThreadFromResponse`
- При `CORRECT` — 1200ms celebration анимация на TaskStepper (`celebratingTaskOrder` state + CSS ring/scale/bounce), затем auto-advance на следующую active задачу
- `celebrationTimerRef` (useRef) + cleanup useEffect предотвращают memory leak при unmount
- `switchToTask` очищает pending celebration timer при ручном переключении
- Race guard в `handleTaskClick`: блокирует навигацию при `celebratingTaskOrder !== null`
- Restore-on-load: `thread.current_task_order` используется только при mount; fallback на first active если target completed

**Ключевые файлы:**
- `GuidedHomeworkWorkspace.tsx` — `syncThreadDataOnly`, celebration logic, timer cleanup
- `TaskStepper.tsx` — `celebratingTaskOrder` prop, CSS animation (no framer-motion)

**Init-once навигация (2026-04-02):**
- `hasInitializedRef` — навигация (`setCurrentTaskOrder`) устанавливается только при первом получении `thread`, не при каждом refetch
- Причина: `queryClient.invalidateQueries` после check/hint вызывал refetch → init effect перезаписывал `currentTaskOrder` серверным `current_task_order` → ученик перебрасывался на другую задачу
- `assignment.id` change → ref сбрасывается (поддержка навигации между ДЗ без remount)
- После инициализации навигацию контролируют только `switchToTask()` (клик) и auto-advance (CORRECT + 1200ms)

**Completed view UX (2026-04-02):**
- Экран результатов **НЕ** показывается автоматически — ученик сначала видит чат с решениями
- Кнопка «Завершить и посмотреть результаты» рендерится inline в области сообщений после последнего сообщения (под «Все задачи выполнены!»)
- `GuidedChatInput` скрывается при `threadStatus === 'completed'` (нет ложного поля ввода)
- На экране результатов только «Назад к заданиям» (без «Посмотреть решения задач» — вызывало путаницу с заблокированным вводом)

**Спека:** `docs/delivery/features/guided-chat/task-lock-spec.md`

### Bootstrap hallucination fix + disable toggle (Sprint S4, 2026-03-27)

**TASK-0A: Fix Bootstrap Hallucination (CRITICAL)**
- `buildTaskContext()` в `GuidedHomeworkWorkspace.tsx` теперь поддерживает `sendMode: 'bootstrap'` — отдельный `modeHint` для стартового сообщения
- Bootstrap call передаёт `'bootstrap'` вместо `'question'` → AI больше не галлюцинирует «вижу твоё решение»
- `isMinimalText` порог расширен: `length <= 20` + regex `/^\[.*\]$/` для placeholder-ов вроде `[Задача на фото]`
- Bootstrap system prompt усилен: явный запрет упоминать «решение ученика», fallback для нечитаемых изображений

**TASK-0B: Disable AI Bootstrap Toggle**
- Колонка `disable_ai_bootstrap boolean NOT NULL DEFAULT false` в `homework_tutor_assignments`
- Toggle «AI-вступление к задачам» (позитивная формулировка) в L1 `HWExpandedParams.tsx`
- Backend: `homework-api/index.ts` — create + update handlers принимают `disable_ai_bootstrap`
- Student-side: guard в `GuidedHomeworkWorkspace.tsx` пропускает bootstrap если `assignment.disable_ai_bootstrap`

### Конструктор ДЗ — L0/L1 архитектура (Phase 3, 2026-03-17)

`TutorHomeworkCreate.tsx` — single-page конструктор с progressive disclosure:

**L0 (всегда видно):** Тема → Кому (`HWAssignSection`) → Задачи (`HWTasksSection`) → `HWActionBar`
**L1 (collapsible, «Расширенные параметры»):** `HWExpandedParams` (название, предмет, дедлайн, AI-вступление) + `HWMaterialsSection`

Правила:
- Dot indicator на L1-кнопке: показывается если `title`, `subject !== 'physics'`, `deadline` или `materials.length > 0`
- L1 auto-expand при ошибке валидации `subject`
- `_topicHint` — soft warning (non-blocking): ключи с суффиксом `Hint` не считаются blocking errors
- Поле «Тема» в L0 (контейнере), НЕ в `HWExpandedParams`

### Edit-mode: порядок useEffect'ов prefill/reset (2026-04-17)

`TutorHomeworkCreate.tsx` имеет два связанных useEffect для edit-mode:
1. **Reset** (`[editId]`): сбрасывает `editPrefilledRef`, `editInitialSnapshot`, `deferredImageDeletesRef`
2. **Prefill** (`[isEditMode, existingAssignment]`): заполняет форму из `existingAssignment` и ставит `editInitialSnapshot`

**КРИТИЧНО: reset должен быть объявлен РАНЬШЕ prefill** (строки ~373 vs ~395). Оба эффекта фаерятся на mount в порядке деклараций. Если reset пойдёт после prefill, он затрёт только что установленный snapshot в том же commit-cycle (React батчит setState из эффектов; последний `setEditInitialSnapshot` выигрывает).

**Симптом при нарушении:** на типичном flow `/tutor/homework/:id → /edit` в пределах `staleTime: 30s` (react-query кеш уже содержит данные) `editInitialSnapshot` остаётся `null` навсегда → `isEditSnapshotReady=false` → кнопка «Сохранить» залипает на «Подготавливаем…» до полного refresh страницы.

**Архитектура edit-diff state:**
- `editInitialSnapshot: EditSnapshot | null` — snapshot на момент загрузки (мета, taskSignature, studentIds, materialSignature)
- `isEditSnapshotReady = !isEditMode || editInitialSnapshot !== null` — гейт для submit button и `hasUnsavedChanges`
- `editDiffState` — `useMemo` над snapshot + live form state; возвращает `null` пока snapshot не готов
- `buildMaterialSignature` НЕ должна включать `localId` (client-side UUID) — иначе `materialsDirty` будет всегда `true` после prefill, ломая `hasUnsavedChanges` и triggering beforeunload на выходе без реальных изменений
- `isSubmitDisabled = isSubmitting || (isEditMode && !isEditSnapshotReady)` передаётся в `HWActionBar`
- `submitLabel` показывает `'Подготавливаем...'` пока `isEditSnapshotReady=false`

### Тренажёр формул — Formula Rounds (standalone pivot, 2026-04-08)

Phase 1 пивотится из homework-embedded preview в standalone public trainer `/trainer`. Backend groundwork для pivot уже реализован, но frontend route / cleanup preview-flow ещё идут отдельными TASK-ами. Источник требований: `docs/delivery/features/formula-round-phase-1/spec.md`.

**Архитектура:**
- **Formula engine — client-side** (`src/lib/formulaEngine/`). Нет AI-вызовов. Генерация заданий из статической базы 12 формул кинематики. При добавлении разделов (динамика, etc.) — формулы переедут в DB
- **Три типа заданий** по слоям знания (GDD §4.1, §4.5, §4.8):
  - Layer 3: `TrueOrFalseCard` — формула верна/неверна (мутации из `MUTATION_LIBRARY`)
  - Layer 2: `BuildFormulaCard` — собери формулу из токенов (числитель/знаменатель)
  - Layer 1: `SituationCard` — ситуация → выбери формулу

**Критичное: structured answer validation**
- `BuildFormulaAnswer { numerator: string[]; denominator: string[] }` — НЕ flat array
- `BUILD_RECIPES` в `questionGenerator.ts` хранит `numeratorTokens` / `denominatorTokens`
- **Все карточки возвращают raw answer**, correctness определяется ТОЛЬКО в `FormulaRoundScreen.handleAnswer` (single source of truth). НЕ ПЕРЕНОСИТЬ проверку обратно в карточки
- Дистракторы: `relatedFormulas` first → sameSection backfill (GDD §6.4). НЕ shuffle(merged)

**Уже реализовано в backend groundwork (2026-04-08):**
- Миграция `supabase/migrations/20260408160000_trainer_standalone_schema.sql`:
  - делает `student_id` nullable,
  - добавляет `session_id`, `source`, `ip_hash`,
  - создаёт partial index `idx_formula_round_results_trainer_recent`,
  - добавляет RLS policy `trainer_results_no_anon_read`,
  - дополнительно делает `round_id` nullable из-за реальной schema drift.
- Публичная edge function `supabase/functions/trainer-submit/index.ts`:
  - без JWT-check и без чтения `Authorization`,
  - использует `service_role`,
  - валидирует payload,
  - считает `ip_hash = sha256(ip + TRAINER_IP_SALT)`,
  - rate-limit'ит по таблице `formula_round_results`.

**Schema drift, который обязаны учитывать следующие агенты:**
- В текущем репо таблица `formula_round_results` использует `student_id` и `round_id`, а не `user_id` / `formula_round_id`.
- В текущем репо сохраняется `duration_seconds`, не `duration_ms`.
- Не предполагать существование колонок `homework_assignment_id`, `formula_round_id`, `client_started_at` в `formula_round_results`, пока новая миграция явно их не добавит.

**Текущие фазы:**
- **Phase 1 standalone** (в работе): `/trainer`, без auth, анонимная сессия, запись результата в `formula_round_results` через `trainer-submit`

**TASK-3 screens migration ✅ Done (2026-04-08):**
- `FormulaRoundScreen` props = `{ questions: FormulaQuestion[]; onComplete: (result: RoundResult) => void; onExit: () => void }`. Не принимает `roundConfig`, не держит `lives` state, не показывает section-label в header. Back button (Lucide `ArrowLeft`, 44×44, `touchAction: manipulation`, `aria-label="Выйти из раунда"`) слева от `RoundProgress`. Timing — `performance.now()` на mount и per-question, монотонно.
- `RoundProgress` props = `{ current: number; total: number }`. Hearts полностью удалены (нет `Heart` import, нет `lives`/`maxLives` props). Counter — `text-base` (16px) для iOS Safari.
- `RoundResultScreen` props = `{ result: RoundResult; onRetryWrong: () => void; onExit: () => void }`. Lives row / `MAX_LIVES` / `Heart` import удалены. Две CTA: «Пройти ещё раз» (primary, `bg-accent`, только при `weakFormulas.length > 0`, вызывает `onRetryWrong`) + «Назад» (вызывает `onExit`, full-width когда `weakFormulas.length === 0`). Weak-formulas rendering не тронут — AC-4 не регрессировал.
- `RoundResult` type extended (не replaced): добавлено required поле `durationMs: number` рядом с существующим `durationSeconds`. `buildResult` в `FormulaRoundScreen` populate оба; `livesRemaining: 0`, `completed: true` теперь hardcoded. `durationSeconds` остаётся в type до TASK-5 cleanup (нужен `formulaRoundApi.ts`).
- `FeedbackOverlay` переиспользован 1:1 без правок — `livesLost={0}` триггерит `!isCorrect && livesLost > 0` guard и heart badge не рендерится.
- `handleAnswer` структурно не тронут — correctness checking остаётся single source of truth в `FormulaRoundScreen` (см. инвариант выше). Карточки по-прежнему возвращают raw answer.
- `src/pages/StudentFormulaRound.tsx` получил минимальный compat patch (3 строки) чтобы prod build остался зелёным после смены сигнатур: `roundConfig` prop убран, `onRetryErrors → onRetryWrong`, `onClose → onExit`. **Файл целиком удалит TASK-5** вместе с `formulaRoundApi.ts`, `useFormulaRound.ts`, preview auth bypass и route `/homework/:id/round/:roundId`. Новый код **не должен** импортировать эти legacy-модули.
- Следующий агент, делающий **TASK-4** (TrainerPage state machine), должен реализовать landing→round→result и передать в `FormulaRoundScreen` / `RoundResultScreen` только те props, которые они теперь принимают. `onNewRound` / `onChangeTopic` из оригинальной спек-цепочки state machine на уровне компонентов **не существуют** — обёртка над ними реализуется целиком внутри `TrainerPage` через `onExit` (возврат на landing) и условный re-generation раунда.
- **Phase 1b** (future work, после standalone validation): tutor assignment UI в TutorHomeworkCreate + tutor visibility в TutorHomeworkDetail/Results + homework completion integration

**DB таблицы:**
- `formula_rounds` — конфигурация раунда (привязана к assignment, section, lives, question count)
- `formula_round_results` — результаты прохождения; для trainer pivot уже используются `source`, `session_id`, `ip_hash`
- RLS: student видит свои rounds/results. Для standalone trainer добавлена policy `trainer_results_no_anon_read`; tutor read policy сохраняется для future Phase 1b

**Legacy preview / seed notes:**
- `supabase/seed/formula-round-seed.sql` — каноничный dev seed для formula rounds
- Seed создаёт:
  - `test-tutor`
  - `test_student_1` ... `test_student_5`
  - один `homework_tutor_assignment`
  - один `formula_round`
  - 5 записей в `homework_tutor_student_assignments`
- Все UUID в seed фиксированные. НЕ заменять на `gen_random_uuid()` — прямые ссылки должны оставаться воспроизводимыми
- Password для seed students: `FormulaRound123!`
- Старый preview QA path через `StudentFormulaRound.tsx` и `?student=<seed_uuid>` считается legacy и не должен расширяться для standalone trainer. Для QA текущего pivot ориентир = `/trainer` + `trainer-submit`, не preview bypass.

**Phase 1b tutor UI guardrails (future work — после Phase 1 standalone validation):**
- НЕ создавать новый top-level tutor route ради formula rounds
- Встраивать formula rounds только в существующие tutor surfaces:
  - `TutorHomeworkCreate.tsx` — assignment-time configuration
  - `TutorHomeworkDetail.tsx` — block/status inside assignment detail
  - `TutorHomeworkResults.tsx` — visibility по ученикам и попыткам
- Formula round в tutor UI = часть homework workflow, не отдельный "игровой модуль"
- На tutor-экранах primary CTA должен оставаться связанным с job репетитора (`Создать ДЗ`, `Отправить`, `Открыть результаты`), а не с абстрактным "управлением тренажёром"
- Для Phase 1b использовать уже существующие данные (`formula_rounds`, `formula_round_results`, `tutor_read_results` policy), а не вводить отдельную tutor-only схему
- Не добавлять generic analytics dashboard без прямой связи с homework result flow

**v1 ветка тренажёра — «Базовый курс · Вращение» (2026-04-18):**
- Параллельный каталог из 10 формул Егора (`kin.13_e..kin.22_e`) для нулевого уровня. Файл `src/lib/formulaEngine/egorFormulas.ts` (Variant B: hand-craft, **вне** auto-generation pipeline). Экспортирует `egorFormulas`, `EGOR_BUILD_RECIPES`, `EGOR_SUPPORTED_BUILD_FORMULA_IDS`, `EGOR_MUTATION_LIBRARY`
- v1 НЕ включён в `mechanicsFormulas` (избегаем v2 дубликатов), но входит в `formulasById` lookup
- `relatedFormulas` v1 указывают **только** внутрь v1 (с `_e` суффиксом). Cross-reference на v2 запрещён
- `RoundConfig.mode: 'v1' | 'v2'` (default `'v2'`); v1 использует `selectV1Distribution` — только Layer 2 (BuildFormula) + Layer 3 (TrueOrFalse), без SituationCard
- Детекция каталога — `isEgorFormulaId(id) → id.endsWith('_e')`
- Gamification: `SectionKey = 'egor-v1'` — отдельный bucket в `bestScoreBySection`. Store version **не бампалась** (`Partial<Record<...>>` forward-compatible)
- При расширении v1 — добавлять всё в `egorFormulas.ts`, не трогать `formulas.generated.ts`. Новый v1-раздел = ещё один pool с `mode: 'v1'` в `SECTION_POOLS`

**Ключевые файлы:**
- `src/lib/formulaEngine/formulas.ts` — aggregator (v2 каталог + lookup map с v1)
- `src/lib/formulaEngine/egorFormulas.ts` — v1 каталог (10 формул Егора, recipes, мутации)
- `src/lib/formulaEngine/questionGenerator.ts` — генерация заданий, мутации, дистракторы, feedback (v1/v2 branch)
- `src/lib/formulaEngine/types.ts` — `FormulaQuestion`, `BuildFormulaAnswer`, `RoundResult`
- `src/components/homework/formula-round/FormulaRoundScreen.tsx` — основной экран раунда (fullscreen, correctness checking)
- `src/components/homework/formula-round/RoundResultScreen.tsx` — итоговый экран (score, weak formulas, retry)
- `supabase/functions/trainer-submit/index.ts` — public submit endpoint for standalone trainer
- `supabase/migrations/20260405083400_b315170e-7b05-4d42-941d-eb08b678cf2f.sql` — базовая preview schema
- `supabase/migrations/20260408160000_trainer_standalone_schema.sql` — standalone trainer adjustments

**Спека:** `docs/delivery/features/formula-round-phase-1/spec.md`
**GDD (source of truth для gameplay):** `docs/SokratAI_physics_game-design-document.md`

### Reorder задач в конструкторе ДЗ (2026-03-19)

- `HWTaskCard.tsx` — props: `onMoveUp`, `onMoveDown`, `isFirst`, `isLast`. Кнопки `ChevronUp`/`ChevronDown`
- **Backend**: `hw_reorder_tasks(assignment_id, task_order_jsonb)` — PL/pgSQL, `SECURITY DEFINER`, атомарная транзакция
- **Порядок операций в PUT /assignments/:id**: reorder RPC → field updates → insert → delete
- **KB provenance sync (2026-04-15)**: `hw_reorder_tasks` также атомарно пересчитывает `homework_kb_tasks.sort_order` по pre-mutation snapshot, иначе после reorder `handleGetAssignment` отрисовывает `kb_source_label` / `kb_snapshot_solution` на чужой задаче (tutor-only surface, не student leak). Join остаётся `sort_order ↔ order_num - 1`; если добавляешь новый write-path на `homework_tutor_tasks.order_num` мимо RPC — синхронизируй `homework_kb_tasks.sort_order` вручную. Миграция: `20260415120000_hw_reorder_tasks_sync_kb.sql`

### Student Homework Problem Screen — viewport routing + submission contract (2026-05-09)

Phase 1 rollout-summary section. **Endpoint / migration / handler / shared-helper / anti-leak детали** — не дублируем здесь, см. секцию выше «Student Homework Problem Screen — single-task surface + submission contract (Phase 1, 2026-05-09)» (≈line 110). Эта секция покрывает только rollout invariants, которые не вписывались в endpoint-spec и нужны при будущих изменениях flow'а.

**Routing invariants (mobile ≤768px, без feature flag, revised 2026-05-10 после preview QA #1):**

- Новый screen на route `/student/homework/:hwId/problem/:taskId` (зарегистрирован в `App.tsx`, обёрнут в `<AuthGuard fullBleed>`).
- Старая `/homework/:id` поверхность (`GuidedHomeworkWorkspace`) остаётся для desktop / tablet (>768px) до Phase 4 cutover.
- `StudentHomeworkDetail` использует hook `@/hooks/useIsMobile.ts` (inclusive `(max-width: 768px)`, SSR-safe, `matchMedia('change')` reactive — НЕ legacy `@/hooks/use-mobile.tsx`).
- **Routing implementation = `useEffect` auto-redirect on mobile, smart fallback chain:** `thread.current_task_id` → first task without `task_state.status='completed'` → `tasks[0].id`. На mobile `StudentHomeworkDetail` НЕ монтирует `GuidedHomeworkWorkspace` — useEffect редиректит на per-task screen после resolve `useStudentAssignment` + `useStudentThread`.
- **History note (2026-05-09 → 2026-05-10):** TASK-8 первоначально делал auto-redirect на `tasks[0].id`. Codex re-review #3 указал что это не давало выбрать конкретную задачу — switched to click-intercept через `onTaskClickOverride`. Preview QA #1 (2026-05-10) показал что click-intercept confused students who didn't realise they had to tap a circle to enter the new UI — вернулись к auto-redirect, но с **smart fallback на `current_task_id`** (решает «всегда task #1» concern). `onTaskClickOverride` prop в `GuidedHomeworkWorkspace` оставлен для будущих consumers, на mobile не используется.
- **Step navigation внутри HomeworkProblem (Q7):** клик по любой цифре в `StepIndicator` → `navigate('/student/homework/<hwId>/problem/<task[i].id>')`. URL = source of truth. Free order разрешён (все клики кликабельны, mirror legacy «Свободный порядок задач»).
- **Без feature flag.** Раскатка сразу всем mobile-юзерам. Rollback = `git revert <hash> && deploy-sokratai` (~3 мин).
- **При расширении routing**: новые student-side surfaces, mobile auto-redirect — стандарт. `useStudentThread` обязателен для resolve `current_task_id` до redirect (иначе ученик отправляется в `tasks[0]` всегда, что мы только что починили).

**Submission storage invariants (rollout-level summary):**

- Submissions пишутся в **существующую** `homework_tutor_thread_messages` с `message_kind='submission'`. **Не возрождать** legacy `homework_tutor_submissions` (была дропнута миграцией `20260406120000_drop_classic_homework.sql`).
- `submission_payload JSONB` shape — строго structured object `{numeric, photos[], text, voice_ref?}`. Подробная shape + AI-feedback contract — в детальной секции выше.
- `image_url` параллельно заполняется serialized photos refs — это требование backward-compat с tutor `GuidedThreadViewer` и существующим chat display (там нет нового submission renderer).

**Grading invariants (hybrid first-completed-wins, Phase 1.x revision 2026-05-10 после preview QA + codex re-review #2):**

- **Mobile chat = discussion only.** Каждое user-сообщение → `streamChat` `/chat` endpoint с `guidedHomeworkAssignmentId + guidedHomeworkTaskId` (server-side fetches tutor's reference solution). Persist через `saveThreadMessage(..., 'question', taskId)`. AI reply persist'ится с `'ai_reply'`. **`handleCheckAnswer` НЕ вызывается из chat path.** Чат не закрывает задачу.
- **Scoring-neutral discussion invariant** (codex review #1 fix, preview-QA #10 2026-05-11): `saveThreadMessage` backend handler инкрементит `task_states.attempts` **ТОЛЬКО** для `role='user' && message_kind === 'answer'` (legacy answer-input path). Все остальные user kinds (`'question'`, `'hint_request'`, `'submission'`, etc.) — scoring-neutral. Без этого guard'а discussion chat в mobile UI силенциально снижал `available_score` через ON_TRACK degradation в `runStudentAnswerGrading`. `SCORING_MESSAGE_KINDS` константа в backend = canonical source of truth — расширять её только при осознанном решении добавить новый path к scoring.
- **SubmitSheet single-shot — единственный путь triggering grading на mobile:** через `POST /student/problem/:hwId/:taskId/submission` → backend синтезирует answer + reuse `runStudentAnswerGrading` helper. AI verdict закрывает задачу при CORRECT.
- **Hybrid first-completed-wins** означает: если `task_state.status='completed'` уже стоит (например через legacy desktop `GuidedHomeworkWorkspace` answer-input), новый mobile UI это видит и блокирует повторное закрытие — primary CTA сразу «Следующая задача →», SubmitSheet не открывает submission flow. Score фиксируется тем path, который первым выставил completed.
- **Hint path:** `POST /threads/:id/hint` (`requestHint` API) — degrades `available_score` через %-rules, добавляет `hint_reply` AI bubble в чат. Не закрывает задачу. Без cap'а — sticky продуктовое решение Phase 1 (B5).
- Phase 2 (отдельная спека) добавляет explicit OCR pipeline + 4 verdict states. Шить дополнительный prompt/verdict в `evaluateStudentAnswer` без отдельной spec **ЗАПРЕЩЕНО** — это «AI = draft + action» инвариант.

**`task_kind` invariant:**

- `homework_tutor_tasks.task_kind enum('numeric'|'extended'|'proof')`, NOT NULL DEFAULT `'extended'` (миграция `20260509120000`).
- Backfill: `check_format='short_answer' → 'numeric'`, `check_format='detailed_solution' → 'extended'`. `'proof'` — manual mark тутором (Phase 2 tutor UI).
- Server-side validation в `handleStudentSubmission` (детальная секция выше): `numeric` requires `numeric.trim()`; `extended` requires `photos.length ≥ 1 OR text.trim().length > 0` (preview-QA #9 relax 2026-05-11 — photo OR text); `proof` requires `photos.length ≥ 1 OR text.trim().length > 0` (preview-QA #10 relax 2026-05-11 — mirror extended, без numeric).
- Defensive default для unknown task_kind = treat как `extended`.

**Hint behavior — без cap'а 3:**

- Существующая `available_score` %-degradation в `handleRequestHint` сохраняется. UI показывает «Подсказок: N» **без** жёсткого 3-cap.
- Дизайн-handoff содержит mock «Подсказка 1/3» — это был визуальный mock, мы **намеренно не реализуем** cap. Phase 1 не меняет hint backend logic.
- Если когда-то понадобится cap — отдельная спека (продуктовое решение, не cosmetic UI change).

**Phase split:**

| Phase | Scope | Spec |
|---|---|---|
| 1 (✅ TASKS 1–8 done 2026-05-09) | Mobile ≤768px + chat + ProblemContext + SubmitSheet с reuse `handleCheckAnswer` | `docs/delivery/features/student-homework-problem-screen/spec.md` |
| 2 (deferred) | Real Gemini OCR pipeline + 4 verdict states (`no-work` / `step-error` / `unclear`) + voice recorder + autosave drafts + tutor `task_kind` selector в `TutorHomeworkCreate` | TBD — `student-homework-problem-grading-pipeline.md` |
| 3 (✅ done 2026-05-12) | Tablet (769–1279) + Desktop (≥1280) split layouts. Math keyboard popover. **Hint ladder UI block отложен** (отдельная спека). Phase 4 cutover **частично** залендился — student-side `GuidedHomeworkWorkspace` рендеринг отключён, файл оставлен для Phase 4 cleanup. | См. секцию «Phase 3 split layouts» ниже + plan `~/.claude/plans/toasty-weaving-meerkat.md` |
| 4 (partially landed 2026-05-12 / cleanup deferred) | Phase 3 уже включил universal redirect в `StudentHomeworkDetail` (mobile + tablet + desktop). Осталось: физически удалить `GuidedHomeworkWorkspace.tsx`, `GuidedChatInput.tsx`, `TaskStepper.tsx` после Phase 3 stable. | TBD — `student-homework-problem-cutover.md` |

**При расширении Phase 1 / при добавлении новых student-side endpoint'ов:**
1. Соблюдать column-whitelist invariant (см. детальную секцию).
2. `useIsMobile` hook — canonical для problem-screen routing + viewport-зависимых prop adaptations (e.g. `NumericAnswerComposer.hideDiscussion`). Не дублировать `window.innerWidth` checks по компонентам. CSS-responsive классы (`md:`, `xl:`) предпочтительнее для чисто визуальных адаптаций.
3. Новые routes под `/student/homework/:hwId/...` мониторят то же 404-`NOT_FOUND` semantic для не-assigned (не 403 — keeps existence private).
4. **Легаси `/homework/:id`** (`StudentHomeworkDetail`) после Phase 3 стал redirect-only route для **всех** viewport'ов. `GuidedHomeworkWorkspace` inline рендеринг удалён со student-side; физическое удаление файла отложено на Phase 4 cleanup spec.

**Спека:** `docs/delivery/features/student-homework-problem-screen/spec.md` (Phase 1, AC-1..AC-11).

### Student Homework Problem Screen — Phase 3 split layouts (2026-05-12)

Phase 3 расширяет mobile-first screen на tablet (769–1279) + desktop (≥1280). Единственный entry point для всех viewport'ов: `/student/homework/:hwId/problem/:taskId`. `StudentHomeworkDetail` стал redirect-only (universal). Spec — отдельная сессия plan `~/.claude/plans/toasty-weaving-meerkat.md` (4 раунда walkthrough с Vladimir 2026-05-12 + 2 раунда ChatGPT-5.5 code review).

**`StudentHomeworkDetail` edge cases (codex re-review fix 2026-05-12):**
- **Empty tasks** (assignment без задач, после `data` fetched): redirect на `/homework`. Без этого пользователь видел «Открываем задачу...» бесконечно — после Phase 3 route стал redirect-only, fallback inline render удалён.
- **All-completed:** redirect на `/homework` (preview-QA #10).
- **Loading state:** placeholder «Загрузка...» / «Открываем задачу...» рендерится пока `data` ещё `null` или `thread` fetching — useEffect re-fires когда data приходит.

**Один компонент, три viewport'а:** `HomeworkProblem.tsx` остаётся единым файлом. Layout branches через Tailwind responsive классы (`md:`, `xl:`) + один JS-уровневый prop branch для `NumericAnswerComposer.hideDiscussion`. Никаких отдельных `MobileHomeworkProblem` / `TabletHomeworkProblem` / `DesktopHomeworkProblem` файлов.

**Breakpoints (canonical):**
- Mobile: `≤768px` через `useIsMobile()` hook (Phase 1 inclusive `<=` invariant сохранён).
- Tablet: `769–1279px` через Tailwind `md:` (≥768) минус xl: branches.
- Desktop: `≥1280px` через Tailwind `xl:` (default Tailwind xl breakpoint).

**AuthGuard responsive fullBleed (`src/components/AuthGuard.tsx`):**
- Новый prop value `fullBleed='below-xl'` — backward-compat с `boolean`. На `<1280px` рендерится без `<Navigation />` (full-bleed как `fullBleed=true`). На `≥1280px` рендерит `<div className="hidden xl:block"><Navigation /></div>` + `<div className="xl:pt-14">{children}</div>`.
- Children обязаны учитывать `xl:pt-14` padding-top через CSS-var trick на собственной height: `style={{ '--vv-h': vvHeight } as React.CSSProperties}` + className `h-[var(--vv-h,100vh)] xl:h-[calc(var(--vv-h,100vh)-56px)]`. **Передавать `vvHeight` напрямую** в CSS var — `useVisualViewportHeight()` уже возвращает CSS value string (`'1234px'` или `'100dvh'`). Дописывать `${vvHeight}px` шаблон создаёт invalid `pxpx` (codex re-review fix 2026-05-12).
- Fallback `100vh` (НЕ `100dvh`) выбран намеренно для Safari 15.0–15.3 compat — наш Vite таргет `safari15` не покрывает `dvh` (стал поддерживаться только с Safari 15.4 в марте 2022). Post-hydration CSS var ресолвится в `${vv.height}px` — реальные пиксели, не зависит от поддержки `dvh`.

**Root container responsive grid (`HomeworkProblem.tsx`):**
```
flex flex-col w-full bg-socrat-surface overflow-hidden
h-[var(--vv-h,100vh)]
md:grid md:grid-cols-[420px_1fr]
xl:grid-cols-[460px_1fr] xl:h-[calc(var(--vv-h,100vh)-56px)]
```
Mobile: single-column `flex-col`. Tablet: 2-column grid с 420px sidebar. Desktop: 2-column grid с 460px sidebar + total height `var(--vv-h) - 56px` (56px нав).

**Left aside contract (tablet + desktop):**
- Tablet breadcrumb topbar `md:flex xl:hidden` — back arrow + eyebrow + ДЗ title. Desktop hidden (global `<Navigation />` от AuthGuard выше).
- Scrollable inner div: `<ProblemContext hideToggle collapsed={false} onToggle={() => undefined}>` — всегда expanded.
- Sticky bottom footer: `<SubmitCtaBar>` **только** при `task_kind !== 'numeric'`. Numeric tasks используют inline answer field в правой колонке.

**Right column contract:**
- Mobile-only topbar `md:hidden`.
- Mobile-only ProblemContext peek `md:hidden` (left aside owns expanded view).
- Chat thread (`flex-1 min-h-0 overflow-y-auto`) + Tailwind `xl:max-w-3xl xl:mx-auto xl:w-full` (chat bubbles остаются читабельны на 1920×1080+ мониторах).
- ChatChipRow `hidden md:flex` — tablet+desktop only. Mobile inline hint/mic группа в composer остаётся.
- NumericAnswerComposer (numeric only): `hideDiscussion={!useIsMobile()}` — на tablet+desktop discussion row + toggle скрыты.
- **Chat composer row рендерится для (codex re-review fix 2026-05-12):**
  - Mobile: ТОЛЬКО extended/proof (numeric mobile использует NumericAnswerComposer.Row3 как discussion field).
  - Tablet/desktop: **ВСЕ task_kinds**, включая numeric. На numeric tablet+ chat composer заменяет hidden discussion row — без него ученик не может задать AI свободный вопрос (это была реальная регрессия первого raft'а Phase 3, поймана reviewer'ом). Условие: `(data.task.task_kind !== 'numeric' || isTabletPlus)`.
- Mobile-only big-CTA «Сдать решение задачи» в extended/proof composer (`md:hidden` + `task_kind !== 'numeric'` guard). Tablet+desktop CTA в `SubmitCtaBar` левой колонки. Numeric (любой viewport) — submit через inline answer field, big-CTA не рендерится.
- Inline hint button в extended/proof composer `md:hidden` на tablet+desktop (chip-row выше уже даёт hint). Forced expanded mic group на tablet+ через `micHintExpanded || recorder.isRecording || isTabletPlus`.

**One primary CTA per screen invariant:**
- Mobile: big-CTA в composer (extended/proof) или inline answer (numeric).
- Tablet/desktop: `SubmitCtaBar` (extended/proof) или inline `NumericAnswerComposer` answer field (numeric).
- ChatChipRow **намеренно не дублирует** «Сдать решение» button — только Подсказка (опционально) + Σ Формула slot.

**Chip-row composition (Round 2 walkthrough решение):**
- Подсказка chip — рендерится только при `showHint=true` (default), parent передаёт `false` для numeric task_kind (hint уже inline в NumericAnswerComposer).
- Math slot — parent передаёт `<MathQuickPicker trigger={...} />`. Slot pattern (а не `onMathKeyboardClick` callback) нужен чтобы Radix Popover использовал button как positioning anchor — без slot popover открывался бы у `(0,0)` экрана.
- **«Не понял» chip НЕ реализуется** (Round 2 решение). Не добавлять без отдельной спеки.

**MathQuickPicker контракт:**
- Phase 3 = простой popover с ~15-18 LaTeX/Unicode templates (`x²`, `\frac{}{}`, греческие, операторы). **Не MathLive** — отложен в Open Question 1 design-handoff.
- Parent (`HomeworkProblem`) tracks `lastFocusedInputRef` через `onFocusCapture` на right section. Любой `<input>` / `<textarea>` focus event обновляет ref.
- `insertAtCursor(snippet)` использует `setRangeText(snippet, start, end, 'end')` + manual `dispatchEvent(new Event('input', { bubbles: true }))` (Safari quirk — `setRangeText` не fires `input` events автоматически, React state не обновляется). Try/catch fallback на старых Safari.
- `onOpenAutoFocus={(e) => e.preventDefault()}` на PopoverContent — keep textarea focus, иначе Radix steals focus и snippet вставляется в position 0.

**SubmitSheet — `sm:max-w-2xl` уже на месте (Phase 1).** Никаких Phase 3 изменений в SubmitSheet.tsx. Mobile (<640px) — full-width bottom-sheet. Tablet+desktop — bottom-centered, max-w-2xl (672px). Animation остаётся `translateY(100% → 0)`.

**ProblemContext.hideToggle (additive prop, default `false`):**
- При `true` скрывает «Показать задачу / Свернуть» button (Phase 3 always-expanded на tablet/desktop).
- Mobile (default `false`) — toggle остаётся для peek/expand UX.

**NumericAnswerComposer.hideDiscussion (additive prop, default `false`):**
- При `true` скрывает Row 2 (toggle button) + Row 3 (collapsible discussion field). Mobile keeps full 3-row layout.
- На tablet/desktop discussion редundant — chat composer в правой колонке выполняет ту же роль. Без `hideDiscussion` discussion textarea был бы вторым input с теми же event handlers, что путало UX.

**Что переиспользовано без изменений (за исключением additive props выше):**
- `StepIndicator`, `TaskImagesGallery`, `PhotoStrip`, `TypingDots`, `GuidedChatMessage`.
- `useStudentProblemTask`, `useStudentAssignment`, `useSubmitSolution`, `useVoiceRecorder`, `useVisualViewportHeight`, `useIsMobile`.
- API: `studentProblemApi`, `studentHomeworkApi.{requestHint, checkAnswer, saveThreadMessage, uploadStudentThreadImage, transcribeThreadVoice}`, `streamChat`.
- Backend (`homework-api/index.ts`): не тронут. `handleGetStudentProblem` / `handleStudentSubmission` / `runStudentAnswerGrading` / `THREAD_SELECT` остались Phase 1.

**Файлы Phase 3 (для grep + код-ревью):**
```
src/components/AuthGuard.tsx                                          ← fullBleed: boolean | 'below-xl'
src/App.tsx                                                            ← route: fullBleed="below-xl"
src/pages/StudentHomeworkDetail.tsx                                    ← redirect-only, universal
src/pages/student/HomeworkProblem.tsx                                  ← responsive grid + left aside + chip-row + math picker wiring
src/components/student/homework-problem/ProblemContext.tsx             ← hideToggle prop
src/components/student/homework-problem/NumericAnswerComposer.tsx      ← hideDiscussion prop
src/components/student/homework-problem/ChatChipRow.tsx                ← NEW
src/components/student/homework-problem/SubmitCtaBar.tsx               ← NEW
src/components/student/homework-problem/MathQuickPicker.tsx            ← NEW
```

**При расширении Phase 3:**
1. Новые виды primary CTA (Phase 2 OCR pipeline → 4-verdict overlay etc.) — НЕ добавлять второй primary в правую колонку. SubmitCtaBar остаётся каноническим entry point.
2. Если понадобится дополнительный chip в ChatChipRow (e.g. «Сбросить чат») — добавлять только через `mathSlot`-style slot, не как hardcoded button. Иначе сломаешь параметризацию.
3. Hint ladder card в левой колонке desktop — Phase 3 решение **отложить**. Не реализовывать без отдельной спеки. До тех пор hint counter рендерится только в chip-row.
4. True hint cap (backend `max_hints` колонка в `homework_tutor_tasks`) — Phase 3 решение **no cap везде** (B5 invariant). UI counter остаётся плоским числом, без «N/3» формата.
5. Phase 4 cleanup spec должен grep'нуть `GuidedHomeworkWorkspace`, `GuidedChatInput`, `TaskStepper` — все три legacy student-side компонента полностью отключены после Phase 3 и могут быть удалены вместе.

**Backward compat & rollback:**
- Phase 3 backward-compatible с Phase 1 mobile flow (никаких breaking changes на ≤768).
- Все новые компоненты — additive (новые файлы) или additive props (default-false / backward-compat).
- `AuthGuard.fullBleed: boolean | 'below-xl'` сохраняет старое поведение для callsite'ов с `fullBleed` или `fullBleed={true}`.
- Rollback стратегия: `git revert <Phase 3 commits> && deploy-sokratai` (~3 мин).

**Спека:** plan `~/.claude/plans/toasty-weaving-meerkat.md` (4 раунда AskUserQuestion с Vladimir 2026-05-12 + verification checklist).

### Student Homework Problem Screen — Phase 3.1 hotfixes (2026-05-13)

Pilot QA после Phase 3 deploy выявил 3 бага. Хотфиксы залендились в одной сессии (commits `c879b29` / `ca1ed1c` / `52681af`). Каждый bug добавляет **production-критичный инвариант**, который future agents должны соблюдать.

**Bug #3 — Graceful 401 handling (commit `c879b29`):**

- **Инвариант:** `requestStudentHomeworkApi` (`src/lib/studentHomeworkApi.ts:71`) — единая точка для всех student-side API вызовов — детектит 401 → вызывает `supabase.auth.refreshSession()` → retry один раз. На persistent 401 (refresh тоже failed) → `supabase.auth.signOut()` → throw `StudentHomeworkApiError` с `code='SESSION_EXPIRED'`. `AuthGuard.onAuthStateChange` listener подхватывает SIGNED_OUT и редиректит на `/login`.
- **Не добавляй** свой fetch к `/functions/v1/homework-api/...` мимо этого helper'а — теряешь refresh+retry. Все student endpoints (thread, hint, checkAnswer, submission, transcribe, image signed-url, etc.) уже идут через него.
- `StudentHomeworkApiError.code` — additive optional поле. Stable codes: `NO_SESSION` (null access_token), `SESSION_EXPIRED` (refresh failed). При добавлении новых codes — расширять enum в JSDoc + UI branches.
- Error UI в `HomeworkProblem.tsx` (`src/pages/student/HomeworkProblem.tsx`) для `SESSION_EXPIRED` показывает «Сессия истекла. Перенаправляем на страницу входа…» + spinner вместо кнопки «Повторить» (refetch бесполезен при broken session — auto-redirect уже идёт).

**Bug #1 — `task_kind` / `check_format` sync (commit `ca1ed1c`):**

- **КРИТИЧЕСКИЙ инвариант:** ЛЮБОЙ write-path к `homework_tutor_tasks`, который трогает `check_format`, ОБЯЗАН также писать `task_kind` через `deriveTaskKind(checkFormat)` (backend) или `deriveTaskKindFromCheckFormat(checkFormat)` (frontend).
- Без этого DB default `task_kind='extended'` применяется → все «Краткий ответ» (`check_format='short_answer'`) задачи становятся `task_kind='extended'` в БД → `ProblemContext.tsx` рендерит warn banner «Это задача с развёрнутым решением» на ВСЕХ задачах. Это был root cause Bug #1.
- **Backend `homework-api/index.ts` — 4 write-paths патчены:**
  1. `handleCreateAssignment` (line ~604) — taskRows insert
  2. `handleUpdateAssignment` (line ~1430) — in-submissions update path
  3. `handleUpdateAssignment` (line ~1490) — no-submissions new tasks insert
  4. `handleUpdateAssignment` (line ~1577) — no-submissions existing tasks update
- **Frontend HWDrawer** (`src/components/kb/HWDrawer.tsx`) — client-side direct INSERT теперь использует `checkFormatSnapshot` (snapshot из `hwDraftStore.addTask` через `resolveCheckFormatFromKb`) + `deriveTaskKindFromCheckFormat`.
- **Shared helpers** в `src/lib/checkFormatHelpers.ts`: `mapAnswerFormatToCheckFormat`, `inferCheckFormatFromKim`, `resolveCheckFormatFromKb`, `deriveTaskKindFromCheckFormat`. Mirror backend `deriveTaskKind`. Future client write-paths должны импортировать отсюда, не дублировать.
- **`HWDraftTask.checkFormatSnapshot`** optional для backward-compat с pre-fix localStorage drafts — undefined → fallback на `'short_answer'` в HWDrawer (safe default для физика ЕГЭ KB задач).
- Backfill migration `20260513120000_resync_task_kind_from_check_format.sql` исправил existing affected rows. **Не reapply** — она idempotent но не нужна повторно.

**При добавлении нового write-path к `homework_tutor_tasks`:**
1. Если пишешь `check_format` → **обязательно** добавить `task_kind: deriveTaskKind(check_format)` (backend) или `deriveTaskKindFromCheckFormat(check_format)` (frontend) в тот же payload.
2. Если пишешь только `task_kind` (без `check_format`) — это допустимо (e.g. seeding tests), но рассмотри — может надо писать оба для consistency.
3. Smoke check после deploy:
   ```sql
   SELECT COUNT(*) FROM homework_tutor_tasks
    WHERE (check_format='short_answer' AND task_kind!='numeric')
       OR (check_format='detailed_solution' AND task_kind!='extended');
   -- Expected: 0
   ```

**Симптом нарушения инварианта:** репетитор сохранил «Краткий ответ», но ученик видит warn banner «Это задача с развёрнутым решением» + полную SubmitSheet форму вместо inline `NumericAnswerComposer`. Грепнуть write-path который пропустил `task_kind`.

**Bug #2 — SubmitSheet Ctrl+V paste (commit `52681af`):**

- `src/components/student/homework-problem/SubmitSheet.tsx` теперь принимает `onPaste` на `<DialogPrimitive.Content>` через `handlePaste` callback.
- Dual path: `clipboardData.files` (Chrome / большинство) + `clipboardData.items.getAsFile()` fallback (Safari desktop, Firefox).
- `e.preventDefault()` **только** когда image MIME найден — text paste работает нативно в textarea.
- Lock check `photos.length < 5` (зеркалит PhotoStrip default max) + `isPasteUploading` guard.
- Upload через существующий `uploadStudentThreadImage` → append в `photos` array → toast success/error.
- UX hint: textarea placeholder «Напиши решение текстом или вставь скриншот (Ctrl+V)…» + inline `<kbd>Ctrl</kbd> + <kbd>V</kbd>` под photo-strip + loader-indicator во время upload.
- Pattern source: `src/components/homework/GuidedChatInput.tsx:507-560` (Phase 5.1 mobile clipboard paste 2026-03-20).
- **При расширении paste на другие surfaces:** reuse этот pattern. Текст в `GuidedChatInput` устаревший (студентам уже не показывается после Phase 3), но handler структура — каноническая reference.

**Files touched (Phase 3.1 hotfix grep cheatsheet):**
```
Bug #3:
  src/lib/studentHomeworkApi.ts                       ← requestStudentHomeworkApi refresh+retry + Error.code
  src/pages/student/HomeworkProblem.tsx               ← SESSION_EXPIRED error UI

Bug #1:
  supabase/functions/homework-api/index.ts            ← deriveTaskKind + 4 write-paths
  src/lib/checkFormatHelpers.ts                       ← NEW shared helpers
  src/types/kb.ts                                     ← HWDraftTask.checkFormatSnapshot
  src/stores/hwDraftStore.ts                          ← snapshot resolution
  src/components/kb/HWDrawer.tsx                      ← client INSERT writes both columns
  supabase/migrations/20260513120000_resync_task_kind_from_check_format.sql  ← backfill (NEW)

Bug #2:
  src/components/student/homework-problem/SubmitSheet.tsx  ← onPaste handler + textarea hint
```

**Спека:** plan `~/.claude/plans/toasty-weaving-meerkat.md` (Phase 3.1 hotfix section).
