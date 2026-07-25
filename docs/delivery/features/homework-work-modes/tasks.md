# Tasks: homework-work-modes — минимальный срез Ф1 (Т1–Т6)

Спека: [spec.md](./spec.md). Порядок задач = порядок реализации (backend раньше frontend; деплой — миграция → edge → фронт).

> **Статус 2026-07-24: TASK-1…TASK-9 реализованы; закрыты раунды 1–3 внешнего ревью (ChatGPT-5.6).**
> Р.1 — 4×P0, 5×P1, 2×P2 → [spec.md §3.4a](./spec.md). Р.2 — 1×P0 (CORRECT без проверки персиста), 4×P1 (finish↔grading, компенсация claim, fail-open лока, fail-closed в read-путях), 1×P2 → [§3.4b](./spec.md). Р.3 — новых P0 нет; 3×P1 (catch в `handleCheckAnswer`, компенсация claim после оплаченного Whisper, fail-open chat-preflight) + 1×P2 (payload при CAS-miss) → [§3.4c](./spec.md).
> Валидация после каждого раунда: `vite build` ✓, `smoke-check` 19/19 ✓, `esbuild` обеих edge ✓, `tsc -p tsconfig.app.json --noEmit` — 0 ошибок фичи (13 pre-existing чужих).
>
> Осталось: подтверждение блокеров р.3 ревьюером · manual QA checklist конструктора (rule 40) · сырые API-проверки приёмок Т3/Т4/Т5 на живом бэкенде · деплой (миграция → edge Lovable → `deploy-sokratai`) · пилот RAT R1.
>
> **Статус 2026-07-25 (T0, второй заход):** Т8 (бейджи вида работы) реализован + наблюдаемость AI-шлюза и UX сбоя автопроверки — миграция `20260725120000`, `_shared/{ai-credits,ai-gateway-errors}.ts`, `message_kind='check_failed'`, `kind='check_failed'` в ленте главной, блок расхода AI в daily-дайджесте + алерты (90% лимита, ≥3 отказа за 15 мин). Причина репорта Ульяны установлена: исчерпан лимит AI-кредитов Lovable (18/мес → поднят до 30), к релизу `cedc920` отношения не имеет. Валидация: `tsc -p tsconfig.app.json` — 13 pre-existing (0 новых), `vite build` ✓, `smoke-check` 21/21 ✓, `esbuild` 5 тронутых edge ✓. Т7 («% самостоятельности») — следующий, модель в spec §10.

---

## TASK-1 — Миграция: `work_mode` + anti-leak RLS

**Файл:** `supabase/migrations/20260724150000_homework_work_mode.sql` (новый)

1. `ALTER TABLE homework_tutor_assignments ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'homework' CHECK (work_mode IN ('homework','independent'))`.
2. То же для `homework_tutor_templates`.
3. `CREATE OR REPLACE FUNCTION public.hw_thread_verdicts_visible(_thread_id uuid)` — SECURITY DEFINER, STABLE, `SET search_path = public`; тройной REVOKE (PUBLIC, anon, authenticated→нет: authenticated нужен для политик) — итог: `REVOKE ALL FROM PUBLIC; REVOKE ALL FROM anon; GRANT EXECUTE TO authenticated, service_role;`.
4. `DROP POLICY IF EXISTS` + `CREATE POLICY ... AS RESTRICTIVE FOR SELECT TO authenticated` на `homework_tutor_thread_messages` (`role IN ('user','tutor') OR hw_thread_verdicts_visible(thread_id)`) и `homework_tutor_task_states` (`hw_thread_verdicts_visible(thread_id)`).

**Приёмка:** идемпотентный повторный прогон; существующие ДЗ читаются как раньше (default покрывает); tutor-пути (review-queue, realtime) не задеты (ветка `a.tutor_id = auth.uid()`).

---

## TASK-2 — homework-api: plumbing `work_mode` (Т1) + лок смены (Т2 сервер)

**Файл:** `supabase/functions/homework-api/index.ts`

1. Константа `VALID_WORK_MODES = new Set(['homework','independent'])` + `normalizeWorkMode(v): 'homework'|'independent'|null`.
2. `handleCreateAssignment`: валидация `b.work_mode` (400 `INVALID_WORK_MODE`) рядом с exam_type (~1117); INSERT (~1219–1240) += `work_mode`; ветка `save_as_template` INSERT (~1347) += `work_mode`.
3. `handleUpdateAssignment`: извлечь детекцию `hasSubmissions` (~2171–2193) в хелпер `assignmentHasStudentInteractions(db, assignmentId)`; в patch-блоке (~2022–2076): `b.work_mode !== undefined` → валидация; если отличается от `assignment.work_mode` и есть интеракции → 409 `WORK_MODE_LOCKED`; иначе `patch.work_mode`.
4. `handleListAssignments` SELECT (~1447) += `work_mode`; объект карточки += `work_mode`.
5. Student-whitelist'ы: `handleGetStudentAssignment` (~8518) и `handleGetStudentProblem` (~8662) += `work_mode`; в ответ problem-эндпоинта — `assignment.work_mode`.
6. Шаблоны: `handleCreateTemplateFromAssignment` INSERT (~5910) + `TEMPLATE_RETURN_SELECT` (~5891) += `work_mode` (значение — из assignment-строки); `handleCreateTemplate` (обе ветви ~5412/~5482) — optional `b.work_mode` через normalize, default 'homework'; `handleForkTemplate` явный column-list (~5656) += `work_mode`.

**Приёмка:** create/update/шаблон/форк round-trip'ят `work_mode`; PUT со сменой вида при интеракциях → 409; HWDrawer path B без правок (DB default).

---

## TASK-3 — Серверное отключение AI (Т3)

**Файлы:** `supabase/functions/homework-api/index.ts`, `supabase/functions/chat/index.ts`

1. Хелпер `getAssignmentWorkMode(db, assignmentId)` (точечный SELECT, сбой чтения → throw 500, НЕ молчаливый 'homework' — fail-closed).
2. `handleRequestHint` (~10715) и `handleCheckAnswer` (~10030): после `verifyThreadOwnership`/completed-check, **ДО `checkAiQuota`** — гейт `independent` → 403 `INDEPENDENT_AI_DISABLED` (jsonError).
3. `handlePostThreadMessage` (~8979): тот же гейт для student-записей (все `role='user'`).
4. `chat/index.ts` guided-ветка: SELECT assignment (~1362–1367) += `work_mode`; при `independent` → ранний плоский JSON 403 `{error, code:'INDEPENDENT_AI_DISABLED'}` до любого LLM-вызова (образец — гард `task_image_missing` ~1591).

**Приёмка:** прямые API-вызовы на самостоятельной → 403 с русской фразой, квота не списана; обычная домашка не затронута (гейт строго по `work_mode`).

---

## TASK-4 — Сдача в самостоятельной: одна попытка + грейдинг без штрафов + приглушённый ответ (Т4, часть Т5)

**Файл:** `supabase/functions/homework-api/index.ts`

1. `handleStudentSubmission` (~10275): ранний резолв `work_mode` (до квоты); для independent:
   - целевой task_state `status='completed'` → 409 `TASK_ALREADY_SUBMITTED`;
   - `checkAiQuota` НЕ вызывается;
   - `runStudentAnswerGrading({..., independentMode: true})`.
2. `runStudentAnswerGrading` (~9591): параметр `independentMode?: boolean`. При true ветки ON_TRACK/INCORRECT заменяются на «final»: UPDATE task_state `{status:'completed', earned_score: effectiveAiScore ?? 0, attempts, ai_score, ai_score_comment, ai_criteria_json, ai_nodes_json, last_ai_feedback}` (БЕЗ `computeAvailableScore`, без инкремента hint_count/wrong_answer_count-штрафов) + `performTaskAdvance`. CORRECT/CHECK_FAILED — как есть.
3. Ответ клиенту при independent и незавершённом треде: `{independent:true, task_completed, thread_completed, next_task_order, next_task_id, total_tasks, thread}` — без verdict/feedback/баллов/criteria/flowchart. Если сабмит завершил тред — thread в ответе уже полный (после TASK-5 strip снимается сам).

**Приёмка:** повторный сабмит → 409; неверный ответ закрывает задачу с `earned_score = ai_score` (без −10%-деградации); CHECK_FAILED оставляет active; сдача последней задачи выставляет `thread.status='completed'`.

---

## TASK-5 — State-aware reveal + finish + result endpoints (Т5, Т6 бэкенд)

**Файл:** `supabase/functions/homework-api/index.ts`

1. `fetchStudentThread` (~9284): опция `{workMode?}`; не передан — резолв через SA→assignment (fail-closed: не удалось → стрипаем). При `independent && status !== 'completed'`: messages → только `role IN ('user','tutor')`; task_states → занулить `ai_score, earned_score, best_score, available_score, wrong_answer_count, tutor_score_override, tutor_score_override_comment, tutor_score_override_at, ai_criteria_json, ai_nodes_json` (оставить id, task_id, status, attempts, hint_count). Прокинуть `workMode` из всех вызывателей: `handleGetStudentProblem`, `handleStudentSubmission`, `GET /assignments/:id/thread`.
2. `handleGetStudentProblem`: `task_score = null` при independent-незавершённом.
3. Новый `handleStudentFinishWork` — `POST /assignments/:id/student/finish`: ownership → 404; не-independent → 409 `WORK_NOT_INDEPENDENT`; тред completed → 200 идемпотентно; иначе незакрытые task_states → `{status:'completed', earned_score:0}` (⚠️ не голый completed — computeFinalScore дал бы max), thread → `{status:'completed', current_task_id:null}`; ответ `{completed:true, zeroed_count}`.
4. Новый `handleGetStudentResult` — `GET /assignments/:id/student/result` (спека §3.7): assignment+tasks whitelist (без solution/rubric), thread strip-aware; `completed:false` — без баллов; `completed:true` — per-task `{task_id, order_num, task_text, max_score, final_score, answered}` + totals. `answered` = существует user-сообщение `message_kind IN ('submission','answer')` с этим `task_id`.
5. Роутер: зарегистрировать оба пути рядом с существующими `/assignments/:id/student*`.

**Приёмка (сырыми вызовами):** до завершения problem/thread/submission-ответы без вердиктов; после — полный reveal; finish зануляет несданные и идемпотентен; result отдаёт корректные totals (Σ computeFinalScore / Σ max_score).

**Проверка Deno-сборки:** `npx esbuild supabase/functions/homework-api/index.ts --outfile=NUL` и `supabase/functions/chat/index.ts`.

---

## TASK-6 — Конструктор: сегмент-контрол «Вид работы» (Т2 UI)

**Файлы:** `src/components/tutor/homework-create/types.ts`, `src/pages/tutor/TutorHomeworkCreate.tsx`, `src/lib/tutorHomeworkApi.ts`

⚠️ Риск-зона rule 40 — минимальные правки, после — manual QA checklist.

1. `MetaState` += `work_mode?: 'homework' | 'independent'`; lazy-init → `'homework'`.
2. Типы API: `CreateAssignmentPayload` += `work_mode?`; update-patch += `work_mode?`; `TutorHomeworkAssignmentDetails['assignment']` += `work_mode?`; `HomeworkTemplate` += `work_mode?`.
3. JSX: секция «Вид работы» в L0 после Предмет/Экзамен (~:2100): две кнопки (`role="group"`, `aria-pressed`, `min-h-[44px]`, 16px) + подпись «Самостоятельная: без подсказок AI, одна попытка, разбор после сдачи» + (при `useTutorMockExamsFeatureFlag()`) ссылка «Нужен формат экзамена? → Пробник» на `/tutor/mock-exams`.
4. Plumbing: create body (`:1342`) += `work_mode: meta.work_mode ?? 'homework'`; edit patch при `metaDirty` (`:1684`) += `work_mode`; `buildEditSnapshot.meta` (`:223`) += `work_mode`; `metaDirty` (`:268`) += сравнение `work_mode`; prefill (`:831`) += `work_mode: a.work_mode ?? 'homework'`; `resolveTemplateLoad.meta` (`:417`) += `work_mode: tpl.work_mode ?? 'homework'`; deps submit-колбэков не расширять сверх meta (поле внутри `meta` — уже в deps).
5. Лок: в edit при `existingAssignment.submissions_summary.has_interactions` — контрол disabled + подпись «Нельзя изменить: ученики уже начали работу».
6. Smoke §8: если хук `useTutorMockExamsFeatureFlag` триггерит write-form invariant — заменить на синхронный `queryClient.getQueryData(['tutor','feature-flags'])`.

**Приёмка:** create → самостоятельная создаётся; edit round-trip (prefill → save без изменений = не dirty); шаблон переносит вид; tab-switch P0-сценарий не регрессит.

---

## TASK-7 — Student UI: гейтинг AI + плашка правил + «Сдать работу» (Т3 UI, Т4 UX, Т5 UI)

**Файлы:** `src/pages/student/HomeworkProblem.tsx`, `src/components/student/homework-problem/ProblemContext.tsx`, `src/lib/studentProblemApi.ts`, `src/lib/studentHomeworkApi.ts`, `src/types/homework.ts`

1. Типы: `StudentProblemAssignment` += `work_mode?`; `StudentHomeworkAssignmentDetails` += `work_mode?`; `SubmitSolutionResponse = CheckAnswerResponse | IndependentSubmissionAck` (`{independent:true, task_completed, thread_completed, next_task_order, next_task_id, total_tasks, thread}`).
2. `HomeworkProblem`: `isIndependent` из `data.assignment.work_mode`; скрыть `ChatChipRow`, chat composer, discussion (`NumericAnswerComposer hideDiscussion={isTabletPlus || isIndependent}`); ранний return в `handleChatSend`/`handleHintClick`.
3. Плашка правил (amber-паттерн `ProblemContext:300`) при independent-незавершённой работе.
4. `handleSubmissionSubmit`: ветка `('independent' in response)` — без typing-dots/verdict-обработки; тост «Ответ сдан»; `thread_completed` → `navigate('/student/homework/${hwId}/result')`; телеметрия и очистка черновика — по факту принятия, не по `verdict`.
5. CTA «Сдать работу» (только independent + тред активен): кнопка + AlertDialog «N задач без ответа — они получат 0 баллов» → новый клиент `finishStudentWork(hwId)` (`studentHomeworkApi.ts`, POST `/assignments/:id/student/finish`) → navigate на результат. N = количество задач без `status='completed'`.
6. Проверить null-устойчивость: score-чип/`CriteriaBreakdownTable`/`PhysicsFlowchartTrace` при застрипанных task_states не рендерятся и не падают.

**Приёмка:** на самостоятельной нет ни одного AI-входа; после сдачи задачи — «Сдано» без вердикта; «Сдать работу» с пропусками работает; обычная домашка не изменилась.

---

## TASK-8 — Экран «Результат работы» + редиректы (Т6)

**Файлы:** `src/pages/student/HomeworkResult.tsx` (новый), `src/App.tsx`, `src/lib/studentHomeworkApi.ts`, `src/pages/StudentHomeworkDetail.tsx`, `src/pages/student/HomeworkProblem.tsx`

1. Клиент `getStudentHomeworkResult(hwId)` → `GET /assignments/:id/student/result` (через `requestStudentHomeworkApi`).
2. Страница `HomeworkResult` (React.lazy, route `/student/homework/:hwId/result`, обычный `AuthGuard`): hero «X из Y баллов»; список задач (№ + `stripLatex` clamp + чип вердикта + `final/max`), строки → problem-screen; `TutorOverallCommentCard` при комментарии; `completed:false` → «Работа ещё не завершена» + ссылка на `/homework/:id` (без авто-редиректа).
3. Вердикт-бакеты: `!answered`→slate «Без ответа»; `final>=max`→emerald «Верно»; `final<=0`→rose «Неверно»; иначе amber «Частично».
4. Редиректы: `navigateAfterCorrect` ветка «все решены» (`HomeworkProblem:1298`) → result; `StudentHomeworkDetail` all-completed (`:96`) → result (`replace:true`). Loop-guard: result-экран никогда не навигирует автоматически.

**Приёмка:** после завершения (оба вида работ) ученик попадает на результат ≤3 сек; строки кликабельны; редирект-петли нет (detail → result → клик по задаче → problem → назад).

---

## TASK-9 — Валидация

1. `npm run lint` (информационно) → `npm run build` → `npm run test` (smoke-check) — последовательно, не параллельно.
2. `npx esbuild supabase/functions/homework-api/index.ts --outfile=NUL`; то же `chat/index.ts`.
3. Manual QA checklist конструктора (rule 40) — прогнать перед мержем; коммит с правками конструктора обязан содержать строку «Manual QA: checklist в .claude/rules/40-homework-system.md пройден».
4. Деплой-порядок: миграция (Lovable на push) → edge (`homework-api`, `chat`) → `deploy-sokratai`.

---

## Отложено (НЕ делать в этом срезе)

- **Т7** % самостоятельности; **Т8** бейджи/уведомления (поле в list-SELECT уже проброшено — задел); **Т9** тумблер момента разбора; **Фаза 2** (Т10–Т12); таймер/дедлайн-запрет/real-time монитор. Детали — spec.md §10.
