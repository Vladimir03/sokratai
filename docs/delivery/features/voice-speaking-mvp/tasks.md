# Tasks — Покритериальный грейдинг + голосовые задания (MVP)

Реализационные задачи для `spec.md` (`docs/delivery/features/voice-speaking-mvp/spec.md`, **v0.2**).

Каждая задача: привязана к разделу спеки, закреплена за агентом (Claude Code / Codex), ссылается на инварианты CLAUDE.md / rules. Полные промпты — в финальной секции.

Pipeline: **Spec → Plan → Code → Test**. Code review каждой задачи — **Codex** независимо.

> **Переопределение скоупа (v0.2):** ядро — **покритериальный разбор** (её «вау»), а не транскрипция. Эмилия мерит успех как «AI оценивает по критериям без моей помощи» и призналась, что на письме этого тоже нет. Поэтому **Этап 1 чинит покритериальный грейдинг на письменной части** (живой поток, валидируем сразу), **Этап 2 кладёт голос поверх готового грейдинга**.

**Rollout:** за feature-флагом, включается только Эмилии. Этап 1 (покритериальный разбор на письме) можно выкатить без флага раньше — он улучшает существующую языковую проверку для всех. Решить по результату валидации.

**⚠️ Deploy:** все frontend-задачи (TASK-4, TASK-9, TASK-10) требуют `deploy-sokratai` на Selectel VPS после merge (`.claude/rules/95-production-deploy.md`). Миграции + edge functions Lovable Cloud применяет сам.

---

## Phase 0 — Pre-flight (~30 мин)

### TASK-0 — Прочитать каноничные доки и зафиксировать reuse-точки

- **Agent:** Claude Code.
- **Что делаем (без кода):**
  - **Покритериальный паттерн:** `supabase/functions/mock-exam-grade/index.ts` + `_shared/mock-exam-prompts.ts` — как устроен `elements_check {I,II,III,IV}` (CLAUDE.md §12). Это образец для `criteria_breakdown`.
  - `supabase/functions/homework-api/guided_ai.ts` — `evaluateStudentAnswer` output schema (`verdict/feedback/ai_score/ai_score_comment`), `buildCheckPrompt`.
  - `supabase/functions/_shared/subject-rubrics/` — `resolveSubjectRubric`, `languages-ege.ts` (§19).
  - Voice (для этапа 2): `useVoiceRecorder`, `chatVoice.ts`, Whisper в `telegram-bot::handleVoiceMessage`.
  - CLAUDE.md §16 (submission + voice_ref), §17 (AI-квота), §0 (derive task_kind), §6 (override), §9/§27 (anti-leak).
- **Output:** 1 абзац «reuse как есть / новое» в PR-описании.

---

## Этап 1 — Покритериальный грейдинг (письмо) · ядро · ~4 часа

> **Статус 2026-05-27:** TASK-1..4 ✅ done + 2 раунда ChatGPT-5.5 review (3 P1 закрыты, см. CLAUDE.md §35). TASK-5 (валидация Эмилии) ⏳ после deploy. Файлы: миграция `20260527180000_add_ai_criteria_json_to_task_states.sql`, `_shared/subject-rubrics/{types,index,languages-ege,cefr-detector}.ts`, `homework-api/{guided_ai,index}.ts`, `src/components/homework/CriteriaBreakdownTable.tsx`, mount в `HomeworkProblem.tsx` + `GuidedThreadViewer.tsx`, `src/types/homework.ts`, smoke `scripts/test-criteria-templates.mjs` + `smoke-check.mjs` §9.

### TASK-1 — Миграция `ai_criteria_json` JSONB ✅ done (2026-05-27)

- **Spec §5 Data Model.** **Agent:** Claude Code.
- **Files:** `supabase/migrations/<ts>_add_ai_criteria_json.sql` (новый).
- **Что делаем:** `ALTER TABLE homework_tutor_task_states ADD COLUMN IF NOT EXISTS ai_criteria_json JSONB NULL;` + COMMENT (формат `[{label, score, max, comment}]`).
- **Guardrails:** additive, nullable, существующие строки не трогаются. Это feedback-поле (видно ученику post-submit) — НЕ tutor-only, в `stripStudentSensitiveTaskStateFields` не добавлять. Проверить, что новая колонка попадает в GRANT-whitelist на `homework_tutor_task_states` (CLAUDE.md §23 — column GRANT) для клиентского чтения.
- **Validation:** insert тестового JSON не падает; client `.select('ai_criteria_json')` под user JWT не даёт permission error.

### TASK-2 — Именованные критерии + балльная шкала в `languages-ege.ts`

- **Spec §3, §5.** **Agent:** Claude Code.
- **Files:** `supabase/functions/_shared/subject-rubrics/languages-ege.ts` (+ `index.ts` при необходимости).
- **Что делаем:** для каждого языкового формата дать **список критериев с именами и max-баллами**, по которым AI раскладывает оценку:
  - DELF B1/B2 production écrite + production orale (дескрипторы + диапазоны баллов).
  - ЕГЭ письмо (К1–К3 / К1–К5) + монолог; ОГЭ письмо + монолог.
  - Фонетика/произношение — пометить «оценивает репетитор на слух», AI не штрафует.
- **Guardrails:** письменные рубрики уже есть (§19) — расширяем структурой критериев, не ломаем физику/математику. Anti-spoiler контракт сохраняется.
- **Validation:** `resolveSubjectRubric` для `french` отдаёт критерии с балльной шкалой.

### TASK-3 — `criteria_breakdown` в output `evaluateStudentAnswer`

- **Spec §3, §5.** **Agent:** Claude Code.
- **Files:** `supabase/functions/homework-api/guided_ai.ts` (+ `index.ts` сохранение).
- **Что делаем:**
  1. Расширить output-схему `evaluateStudentAnswer`: nullable `criteria_breakdown: {label, score, max, comment}[]` (только языки).
  2. В `buildCheckPrompt` для языков попросить разложить балл по критериям из TASK-2; **сумма `score` = `ai_score`** (валидировать; при расхождении — нормализовать к `ai_score`).
  3. Сохранять breakdown в `homework_tutor_task_states.ai_criteria_json` в `runStudentAnswerGrading` (единый источник, не дублировать grading-логику, CLAUDE.md §16).
- **Guardrails:** физика/математика не затрагиваются (`criteria_breakdown` null). Шаг балла 0.1 (CLAUDE.md §6). Leak-check для humanities skip (§27). Anti-leak: критерии — feedback, tutor-only solution/rubric не утекают.
- **Validation:** `npm run build && smoke-check`. Manual: письменная DELF-работа → breakdown с критериями, сумма = ai_score.

### TASK-4 — Рендер таблицы критериев на 1 странице · ⚠️ deploy

- **Spec §6.** **Agent:** Claude Code.
- **Files:** `src/components/homework/` (общий компонент таблицы), точки рендера разбора у ученика (post-grade) и репетитора (`GuidedThreadViewer.tsx` / completed view).
- **Что делаем:** компактная таблица «критерий → балл/макс → комментарий» + итоговый балл. Рендерить когда `ai_criteria_json` непуст. **Жёсткий инвариант: всё на 1 странице** (требование Эмилии).
- **Guardrails:** не ломать существующий рендер для физики/математики (нет breakdown → старый вид). `MathText` для LaTeX. `loading="lazy"`. Один компонент переиспользуется письмом и голосом.
- **Validation:** `npm run build`. Manual: ученик и репетитор видят таблицу критериев на письменной работе.

### TASK-5 — Валидация покритериального разбора на письме (Эмилия)

- **Spec §7.** **Agent:** Vladimir + Claude Code (smoke).
- **Что делаем:** дать Эмилии проверить реальные письменные FR-работы с новым разбором. Мерить: приходит ли breakdown на ≥80% работ; override итога ≤30%; перестала ли она декомпозировать вручную.
- **Гейт:** если точность по критериям низкая — итерируем prompt (TASK-2/3) ДО старта этапа 2. Голос на плохом грейдинге не запускаем.

---

## Этап 2 — Голос поверх готового грейдинга · ~4 часа

> **Старт этапа 2 = ГЕЙТ:** только после того, как TASK-5 показала, что покритериальный
> разбор на письме точен (override ≤ 30%). Голос наследует тот же грейдинг — на плохом
> грейдинге его не запускаем (Spec §7, pipeline шаг 6 «feedback перед след. фазой»).
>
> **AC-нотация:** spec.md v0.2 не имеет нумерованных AC (это draft) — каждая задача ниже
> несёт inline Given/When/Then. При следующей правке спеки промотировать их в `## Acceptance
> Criteria` (pipeline шаг 4). Job по всем задачам этапа: **R1 — проверка работ по критериям
> экзамена** (расширение на устную часть) + student-job «подготовка к устной части с
> обратной связью здесь и сейчас» (Spec Section 0).
>
> **Newly-surfaced scope (важно — не было в v0.1 нарезке):** Spec §3 шаг 1 требует, чтобы
> репетитор **помечал задачу как устную**. Значит нужен tutor-side способ выставить
> `task_kind='speaking'` (UI-селектор + accept в create/update write-paths). Без этого flow
> не тестируется end-to-end. Backend-часть — в TASK-8, tutor-UI — в TASK-9 (Часть A).
> Это применение anti-scope-creep правила pipeline: requirement выведен из спеки, не добавлен
> «на ходу» — он был неявно в §3 с самого начала.

### TASK-6 — Миграции: `task_kind='speaking'` + feature flag + bucket-решение

- **Job:** R1. **Agent:** Claude Code. **Spec §5 (Миграции).**
- **Files:** `supabase/migrations/<ts>_add_speaking_task_kind.sql`, `supabase/migrations/<ts>_add_feature_voice_speaking_flag.sql` (+ опц. bucket-миграция).
- **AC (Given/When/Then):**
  - *Given* существующая задача `task_kind IN ('numeric','extended','proof')`, *When* применили миграцию, *Then* `INSERT ... task_kind='speaking'` проходит, старые строки не тронуты.
  - *Given* нового тутора, *When* `SELECT feature_voice_speaking_enabled`, *Then* `false` (default).
- **Что делаем:**
  1. **CHECK не аддитивен в Postgres** — нельзя «дополнить» список. Паттерн (идемпотентно): `ALTER TABLE homework_tutor_tasks DROP CONSTRAINT IF EXISTS <имя>; ALTER TABLE ... ADD CONSTRAINT ... CHECK (task_kind IN ('numeric','extended','proof','speaking'))`. Точное имя констрейнта — из миграции `20260509120000` (не угадывать, прочитать). НЕ менять DEFAULT (`'extended'`).
  2. `tutors.feature_voice_speaking_enabled boolean NOT NULL DEFAULT false` — mirror `feature_mock_exams_enabled` (канонический образец: миграция `20260508120000_mock_exams_v1_schema.sql` + клиентский флаг `src/hooks/useTutorMockExamsFeatureFlag.ts`): тот же тип, тот же default, тот же GRANT/RLS-контекст.
  3. **Bucket-решение (зафиксировать в PR):** переиспользовать `homework-submissions` (он уже в `THREAD_ATTACHMENT_BUCKETS`). Рекомендация — **тот же namespace `{userId}/{assignmentId}/threads/...`**, что и фото, чтобы `extractStudentThreadAttachmentRefs` (SSRF / per-student / bucket whitelist) прошёл **без изменений**. Подпапка `voice/` — только если готовы расширять namespace-валидатор (тогда — отдельная строка в guardrails ревью).
- **Guardrails:** additive, idempotent. Флаг default false. НЕ дропать/переименовывать колонки (AGENTS.md DB rules). Если выбрали отдельный bucket — обязательно private + RLS как у `homework-submissions`.

### TASK-7 — Shared helper транскрипции (Groq Whisper)

- **Job:** R1. **Agent:** Claude Code. **Spec §3, §5 (Subject → language map).**
- **Files:** `supabase/functions/_shared/voice-transcribe.ts` (новый). Reference: `chat/index.ts:899-958`, `telegram-bot/index.ts:6173-6243`.
- **AC (Given/When/Then):**
  - *Given* FR-аудио (m4a/webm) ≤ лимита, *When* `transcribeAudio(buf, { language:'fr', mimeType })`, *Then* возвращает непустой читаемый транскрипт.
  - *Given* Groq отдал 5xx, *When* вызов, *Then* 1 retry, при повторном fail — throw типизированной ошибки (не «успех с пустым текстом»).
  - *Given* тишина / нераспознаваемое, *When* Whisper вернул пустой `text`, *Then* helper отдаёт `{ text: '' }` (caller решает, что делать — НЕ throw).
- **Что делаем:** `transcribeAudio(audioBuffer: ArrayBuffer, { language, mimeType })` → multipart FormData → `POST https://api.groq.com/openai/v1/audio/transcriptions`, `model: whisper-large-v3-turbo`, параметрический `language`. Экспортировать `subjectToWhisperLang(subject)` map (`french→fr`, `english→en`, `spanish→es`, `russian→ru`, иначе `undefined` = auto). `GROQ_API_KEY` из env (503 если нет). Таймаут (`AbortController`, не `AbortSignal.timeout` — Safari, но это Deno-сервер, всё равно ручной для единообразия). 1 retry на 5xx/network.
- **Guardrails:** **PII-free логи** — никогда не логировать `text`/транскрипт, только `{ status, size, mimeType, lang, durationMs }`. **НЕ рефакторить** существующие вызовы бота/чата в этом PR (они hardcode `language='ru'` — отдельная задача). `MAX_VOICE_BYTES` — вынести константу, согласовать с TASK-9 cap (см. ниже).

### TASK-8 — Backend: speaking write-path accept + `handleStudentSubmission` ветка

- **Job:** R1. **Agent:** Claude Code. **Spec §3, §5 (API).** Depends on TASK-3 (тот же grading), TASK-7.
- **Files:** `supabase/functions/homework-api/index.ts`.
- **AC (Given/When/Then):**
  - *Given* tutor создаёт/правит задачу с `task_kind='speaking'`, *When* create/update write-path, *Then* в БД сохраняется `'speaking'` (НЕ перетёрто `deriveTaskKind`).
  - *Given* speaking-задача + валидный `voice_ref`, *When* submit, *Then* квота списана **до** Whisper, аудио транскрибировано, транскрипт прошёл `runStudentAnswerGrading`, в ответе есть `criteria_breakdown` + балл.
  - *Given* submit без `voice_ref` для speaking, *When* запрос, *Then* `400 VALIDATION`.
  - *Given* Whisper вернул пустой транскрипт, *When* submit, *Then* **НЕ** зовём Gemini, задача НЕ закрывается, ученику дружелюбное «не удалось распознать речь — перезапиши» (квота списана 1 раз — приемлемо, либо не инкрементить при пустом STT — решить и задокументировать).
- **Что делаем:**
  1. **Write-path accept (§0 dual-derive trap):** `'speaking'` НЕ выводится из `check_format`. В create/update (4 backend write-path + проверить HWDrawer client-path) — если клиент прислал явный `task_kind='speaking'`, персистить как есть, иначе `deriveTaskKind(check_format)`. Грепни `deriveTaskKind` — все сайты должны пропускать explicit speaking.
  2. **Submission branch:** detect `task_kind==='speaking'` → `checkAiQuota(userId, db, { context:'homework', incrementUsage:true })` **ДО** любого AI (§17) → валидация `voice_ref` через `extractStudentThreadAttachmentRefs` (а не вручную) → signed URL → `rewriteToDirect()` (server-to-server, §95) → `fetch` → `transcribeAudio` (TASK-7, `language` из `subject`) → `answerText = transcript` → `runStudentAnswerGrading({ feedbackKind:'check_result', ... })` (тот же helper этапа 1, НЕ дублировать grading).
  3. `submission_payload = { numeric:'', photos:[], text:'', voice_ref }` (поле `voice_ref` зарезервировано §16). Транскрипт идёт в `content`/answerText, аудио-ref — в payload.
- **Guardrails:** solution/rubric не утекают (§9 — те же поля идут только в grading, не в ответ). Не возрождать `homework_tutor_submissions` (§16). Quota-gate строго ДО Whisper И Gemini (две AI-операции, одна единица квоты). НЕ дублировать `runStudentAnswerGrading`.

### TASK-9 — Frontend: tutor speaking-mark (A) + student monologue recorder (B) · ⚠️ deploy

- **Job:** R1 (A) + student-job (B). **Agent:** Claude Code. **Spec §3 шаг 1-2, §6.**
- **Files (A):** `src/components/tutor/homework-create/HWTaskCard.tsx`, draft-типы (`DraftTask`/`HWDraftTask`), `src/lib/tutorHomeworkApi.ts`. **Files (B):** `src/pages/student/HomeworkProblem.tsx` (composer branch), `src/components/student/homework-problem/SubmitSheet.tsx`, `src/types/homework.ts` (`task_kind` union + `'speaking'`).
- **AC (Given/When/Then):**
  - *(A)* *Given* tutor в конструкторе ДЗ, *When* выбирает тип «Устный ответ (монолог)», *Then* `task_kind='speaking'` уходит в обе write-path (конструктор + HWDrawer, §0).
  - *(B)* *Given* ученик открыл speaking-задачу на iPhone Safari, *When* экран загрузился, *Then* виден рекордер (не numeric-input, не photo-only), один primary CTA, numeric-row скрыт.
  - *(B)* *Given* запись завершена, *When* «Отправить», *Then* аудио залито → `voice_ref` → submission endpoint → разбор по критериям.
- **Что делаем:**
  - **(A)** В `HWTaskCard` добавить `task_kind='speaking'` в существующий селектор типа задачи (рядом с `check_format`). Прокинуть в оба write-path (см. TASK-8 §0). Минимально — за feature-флагом тутора (не показывать всем).
  - **(B)** В `HomeworkProblem` composer добавить ветку `task_kind==='speaking'`: рекордер на **существующем** `useVoiceRecorder` (iOS Safari m4a/webm уже решён — НЕ вводить новый, `.claude/rules/80-cross-browser.md`). Upload через voice-helper (новый `uploadStudentThreadVoice` или generalize `uploadStudentThreadImage`) → `voice_ref` → submission. Скрыть numeric-row (как humanities §18). **Cap длительности ~7 мин** + size cap (согласовать с `MAX_VOICE_BYTES` TASK-7) — DELF B1 монолог 5-7 мин. Re-record до отправки разрешён.
- **Guardrails:** только `useVoiceRecorder`, никаких новых MediaRecorder-обёрток. `touch-action: manipulation` на контролах рекордера. `task_kind` union в `homework.ts` — additive optional (не сломать существующие 'numeric'|'extended'|'proof').

### TASK-10 — Frontend: плеер + транскрипт у репетитора · ⚠️ deploy

- **Job:** R1. **Agent:** Claude Code. **Spec §6.**
- **Files:** `src/components/tutor/GuidedThreadViewer.tsx` (+ `src/components/homework/` для shared плеера, если нужен).
- **AC (Given/When/Then):**
  - *Given* ученик сдал speaking-задачу, *When* репетитор открывает тред, *Then* на 1 странице: плеер (play/pause) + транскрипт + таблица критериев (компонент TASK-4) + «Изменить балл».
  - *Given* RU-юзер, *When* плеер грузит аудио, *Then* URL через `rewriteToProxy()` (browser-facing), аудио играет (не `*.supabase.co`).
- **Что делаем:** для speaking-submission рендерить `<audio>` плеер (play/pause), транскрипт под ним, переиспользовать `CriteriaBreakdownTable` (TASK-4) + existing override (§6). Аудио signed URL → `rewriteToProxy()`. Всё на 1 странице.
- **Guardrails:** тайм-коды «клик на момент» / голос-коммент репетитора — **OUT** (Spec §3). `loading="lazy"`, `touch-action: manipulation`. Не дублировать `CriteriaBreakdownTable`.

### TASK-11 — Включить флаг Эмилии + тест голоса (FEEDBACK gate)

- **Job:** R1. **Agent:** Vladimir (manual) + Claude Code (smoke).
- **AC / критерий успеха (Spec §7):** покритериальный разбор принимается без правок в большинстве случаев; транскрипт FR читаемый на реальной записи ученика; явное «беру / готова платить».
- **Что делаем:** `lint && build && smoke-check` → deploy (Lovable: миграции+functions, `deploy-sokratai`: frontend) → `UPDATE tutors SET feature_voice_speaking_enabled=true WHERE user_id='<emilia uuid>'` → тестовое speaking-ДЗ на FR → собрать signal (pipeline шаг 7, файл `docs/discovery/signals/`).

---

## Зависимости

```
TASK-0 → всё
Этап 1: TASK-1, TASK-2 → TASK-3 → TASK-4 → TASK-5 (валидация — ГЕЙТ для этапа 2)  ✅ done
Этап 2: TASK-6, TASK-7 → TASK-8 → (TASK-9, TASK-10) → TASK-11
  TASK-8 зависит от TASK-3 (тот же grading) и TASK-7 (транскрипция)
  TASK-9 Часть B зависит от TASK-8 (submission endpoint принимает voice_ref)
  TASK-9 Часть A (tutor mark) можно делать параллельно с TASK-6/7
  TASK-10 зависит от TASK-4 (CriteriaBreakdownTable) + TASK-8 (submission_payload.voice_ref)
```

---

## Copy-paste промпты для агентов

> Каждый промпт самодостаточен. Перед запуском любого — агент читает `spec.md v0.2` и соответствующий раздел `tasks.md`. После любой задачи: `npm run build && npm run smoke-check` (lint — если затронут TS).

### TASK-0 (pre-flight) — Claude Code

```
Прочитай spec.md v0.2 + tasks.md TASK-0. НЕ пиши код. Изучи и зафиксируй точки переиспользования:
1) supabase/functions/mock-exam-grade/index.ts + _shared/mock-exam-prompts.ts — как устроен elements_check (CLAUDE.md §12), это образец для criteria_breakdown.
2) supabase/functions/homework-api/guided_ai.ts — output evaluateStudentAnswer + buildCheckPrompt.
3) _shared/subject-rubrics/ (resolveSubjectRubric, languages-ege.ts, §19).
4) useVoiceRecorder, chatVoice.ts, telegram-bot::handleVoiceMessage (Whisper) — для этапа 2.
5) CLAUDE.md §16 (submission/voice_ref), §17 (квота), §0 (derive task_kind), §6 (override), §9/§27 (anti-leak), §23 (GRANT).
Верни 1 абзац «reuse как есть / новое» — это войдёт в PR-описание. Кода в этой задаче нет.
```

### TASK-1 (миграция ai_criteria_json) — Claude Code

```
Прочитай spec.md v0.2 (§5) + tasks.md TASK-1 + CLAUDE.md §23 (GRANT-whitelist на homework_tutor_task_states).
Создай миграцию supabase/migrations/<ts>_add_ai_criteria_json.sql:
ALTER TABLE homework_tutor_task_states ADD COLUMN IF NOT EXISTS ai_criteria_json JSONB NULL; + COMMENT (формат [{label,score,max,comment}]).
Это feedback-поле (видно ученику post-submit) — НЕ добавляй в stripStudentSensitiveTaskStateFields.
Расширь GRANT-whitelist на task_states, чтобы клиентский .select('ai_criteria_json') под user JWT не падал с permission error.
Additive, nullable, идемпотентно. Проверь номер миграции = следующий по таймстемпу.
```

### TASK-2 (критерии в languages-ege.ts) — Claude Code

```
Прочитай spec.md v0.2 (§3,§5) + tasks.md TASK-2 + CLAUDE.md §19 (subject-rubric layer).
В supabase/functions/_shared/subject-rubrics/languages-ege.ts дай для каждого языкового формата
СПИСОК КРИТЕРИЕВ с именами и max-баллами, по которым AI раскладывает оценку:
DELF B1/B2 production écrite + production orale; ЕГЭ письмо (К1–К3 / К1–К5) + монолог; ОГЭ письмо + монолог.
Фонетику/произношение пометь «оценивает репетитор на слух, AI не штрафует».
Не ломай физику/математику и письменные рубрики (§19). Anti-spoiler контракт сохраняется.
Проверь: resolveSubjectRubric('french') отдаёт критерии с балльной шкалой.
```

### TASK-3 (criteria_breakdown в output) — Claude Code

```
Прочитай spec.md v0.2 (§3,§5) + tasks.md TASK-3 + CLAUDE.md §12 (как elements_check устроен в mock-exam-grade), §16 (runStudentAnswerGrading — единый источник), §6 (шаг 0.1), §27 (humanities leak skip).
В supabase/functions/homework-api/guided_ai.ts расширь output evaluateStudentAnswer полем criteria_breakdown:
{label,score,max,comment}[] (nullable, только языки). В buildCheckPrompt для языков попроси разложить балл
по критериям из languages-ege.ts (TASK-2); сумма score = ai_score (валидируй/нормализуй).
Сохраняй breakdown в homework_tutor_task_states.ai_criteria_json внутри runStudentAnswerGrading.
Физика/математика не затрагиваются (null). solution/rubric не утекают клиенту.
```

### TASK-4 (рендер таблицы критериев) — Claude Code · ⚠️ deploy

```
Прочитай spec.md v0.2 (§6) + tasks.md TASK-4 + .claude/rules/90-design-system.md.
Сделай общий компонент таблицы критериев в src/components/homework/ («критерий → балл/макс → комментарий» + итоговый балл),
рендери его когда ai_criteria_json непуст — у ученика (post-grade) и репетитора (GuidedThreadViewer.tsx / completed view).
Жёсткий инвариант: всё на 1 странице. Нет breakdown (физика/математика) → старый вид без изменений.
MathText для LaTeX, loading="lazy". Один компонент переиспользуется письмом и голосом.
После merge — Deploy needed (deploy-sokratai).
```

### TASK-5 (валидация на письме) — Claude Code (smoke) + Vladimir (manual)

```
Claude: прогони npm run lint && npm run build && npm run smoke-check. Подготовь 2-3 тестовых письменных FR-задания
(DELF B1/B2) для проверки, что criteria_breakdown приходит и сумма критериев = ai_score.
Vladimir (manual): Эмилия проверяет реальные письменные FR-работы. Метрики (Spec §7): breakdown на ≥80% работ,
override итога ≤30%, перестала декомпозировать вручную. ГЕЙТ: если точность низкая — итерируем prompt (TASK-2/3) ДО этапа 2.
```

> **Преамбула (наследуется ВСЕМИ промптами ниже — doc 20, элементы 1-2).**
> Каждый промпт копируется в чистую сессию агента. В начало любого из них подставляется:
>
> ```
> Твоя роль: senior product-minded full-stack engineer проекта SokratAI.
> Контекст: B2B-сегмент — репетиторы иностранных языков (power-user Эмилия, DELF/ЕГЭ/ОГЭ).
> Wedge: проверка работ по критериям экзамена без рутины. Инвариант продукта: AI = ЧЕРНОВИК + действие
> (любой AI-вывод заканчивается действием тутора; финальный балл подтверждает репетитор).
> Перед кодом прочитай: docs/delivery/features/voice-speaking-mvp/spec.md v0.2 + соответствующий
> раздел tasks.md + перечисленные ниже CLAUDE.md §§ и .claude/rules/*.
> ```
>
> **Mandatory end block (элемент 7 — добавляй в КОНЕЦ ответа любой задачи):**
>
> ```
> В конце верни: (1) изменённые файлы; (2) краткое summary; (3) выполненные validation-команды
> с результатом; (4) docs-to-update (CLAUDE.md §§ / .claude/rules/* / spec / MEMORY); (5) self-check
> против .claude/rules/90-design-system.md (нет emoji в chrome, Golos Text, MathText для LaTeX,
> один primary CTA, разбор на 1 странице); (6) для frontend — блок «🚀 Deploy needed» (deploy-sokratai).
> ```

### TASK-6 (миграции speaking + флаг + bucket) — Claude Code

```
[+ Преамбула + Mandatory end block]
Прочитай: spec.md v0.2 §5 (Миграции) + tasks.md TASK-6 + образец feature-флага (миграция
20260508120000_mock_exams_v1_schema.sql + src/hooks/useTutorMockExamsFeatureFlag.ts) +
AGENTS.md «Database rules» (additive only, forbidden: drop/rename/modify existing).

Сделай 2 миграции (idempotent, следующие по таймстемпу):
1) <ts>_add_speaking_task_kind.sql — расширить CHECK на homework_tutor_tasks.task_kind.
   ВАЖНО: CHECK в Postgres НЕ аддитивен. Сначала прочитай точное имя констрейнта в миграции
   20260509120000, затем: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <имя>;
   ALTER TABLE ... ADD CONSTRAINT <имя> CHECK (task_kind IN ('numeric','extended','proof','speaking'));
   НЕ менять DEFAULT 'extended'.
2) <ts>_add_feature_voice_speaking_flag.sql — tutors.feature_voice_speaking_enabled boolean
   NOT NULL DEFAULT false. Грепни как сделан feature_mock_exams_enabled и повтори 1:1 (тип, default,
   GRANT/RLS если есть).

Bucket-решение зафиксируй в PR-описании: переиспользуем homework-submissions + namespace
{userId}/{assignmentId}/threads/... (тот же, что фото) → extractStudentThreadAttachmentRefs проходит
без правок. Новый bucket / подпапку voice/ НЕ заводи в этой задаче (потребует менять namespace-валидатор).

AC: INSERT task_kind='speaking' проходит; старые строки целы; новый тутор → флаг false.
Guardrails: additive, idempotent, без drop/rename существующих колонок.
```

### TASK-7 (Whisper helper) — Claude Code

```
[+ Преамбула + Mandatory end block]
Прочитай: spec.md v0.2 §3,§5 (Subject→language map) + tasks.md TASK-7. Изучи существующий Groq Whisper:
chat/index.ts:899-958 (transcribe path) + telegram-bot/index.ts:6173-6243 (handleVoiceMessage) — оба
hardcode language='ru'.

Создай supabase/functions/_shared/voice-transcribe.ts:
- transcribeAudio(audioBuffer: ArrayBuffer, { language?: string, mimeType: string }): Promise<{ text: string }>
  → multipart FormData → POST https://api.groq.com/openai/v1/audio/transcriptions,
    model whisper-large-v3-turbo, параметрический language.
- export subjectToWhisperLang(subject): french→'fr', english→'en', spanish→'es', russian→'ru', иначе undefined.
- export MAX_VOICE_BYTES (согласуй с TASK-9 cap, ~7 мин монолога).
- GROQ_API_KEY из env (бросай типизированную ошибку если нет). Таймаут через AbortController + 1 retry на 5xx/network.

AC: FR-аудио → непустой транскрипт; 5xx → 1 retry → throw (не «успех с пустым»); тишина → { text:'' } (НЕ throw).
Guardrails: PII-free логи (НИКОГДА не логируй text/транскрипт — только status/size/mime/lang/durationMs).
НЕ рефактори вызовы бота/чата в этом PR.
```

### TASK-8 (backend: speaking write-path + submission branch) — Claude Code

```
[+ Преамбула + Mandatory end block]
Прочитай: spec.md v0.2 §3,§5 (API) + tasks.md TASK-8 + CLAUDE.md §0 (двойной derive task_kind — 4 backend
write-path + HWDrawer), §16 (runStudentAnswerGrading — единый источник grading, voice_ref в submission_payload),
§17 (AI-квота ДО AI), §9 (anti-leak solution/rubric), §35 (criteria_breakdown — тот же grading этапа 1) +
.claude/rules/95-production-deploy.md (rewriteToDirect для server-side fetch).

В supabase/functions/homework-api/index.ts:
A) Write-path accept (§0): 'speaking' НЕ выводится из check_format. Грепни deriveTaskKind — в create/update
   (4 backend write-path) если клиент прислал явный task_kind='speaking' → персистить как есть, иначе derive.
   Проверь client HWDrawer path тоже.
B) handleStudentSubmission: detect task_kind==='speaking' →
   checkAiQuota(userId, db, { context:'homework', incrementUsage:true }) ДО Whisper И Gemini →
   валидация voice_ref ТОЛЬКО через extractStudentThreadAttachmentRefs (не вручную) →
   signed URL → rewriteToDirect() → fetch → transcribeAudio (TASK-7, language из subject) →
   answerText=transcript → runStudentAnswerGrading({ feedbackKind:'check_result' }) (НЕ дублируй grading).
   submission_payload = { numeric:'', photos:[], text:'', voice_ref }.
   Пустой транскрипт → НЕ зови Gemini, задачу НЕ закрывай, дружелюбное «не удалось распознать речь».

AC: tutor mark 'speaking' персистится (не перетёрт derive); submit без voice_ref → 400; валидный submit →
квота списана до AI + транскрипт + criteria_breakdown + балл; пустой STT → задача не закрыта.
Guardrails: solution/rubric только в grading, не в ответ (§9). Не возрождать homework_tutor_submissions.
Quota строго ДО обеих AI-операций. Не дублировать runStudentAnswerGrading.
```

### TASK-9 (frontend: tutor mark + student recorder) — Claude Code · ⚠️ deploy

```
[+ Преамбула + Mandatory end block]
Прочитай: spec.md v0.2 §3 шаг 1-2, §6 + tasks.md TASK-9 + .claude/rules/80-cross-browser.md (useVoiceRecorder,
iOS Safari m4a/webm) + CLAUDE.md §18 (humanities UX — скрытие numeric) + §0 (двойной write-path).

Часть A — tutor mark:
- HWTaskCard.tsx: добавить опцию типа задачи «Устный ответ (монолог)» = task_kind='speaking' рядом с
  существующим check_format-селектором. Прокинуть в DraftTask/HWDraftTask + tutorHomeworkApi → ОБА write-path (§0).
- Показывать опцию за feature-флагом тутора (feature_voice_speaking_enabled), не всем.

Часть B — student recorder:
- src/types/homework.ts: task_kind union + 'speaking' (additive optional, не сломать numeric/extended/proof).
- HomeworkProblem.tsx composer: ветка task_kind==='speaking' → рекордер на СУЩЕСТВУЮЩЕМ useVoiceRecorder
  (НЕ вводи новый MediaRecorder-wrapper). Скрыть numeric-row + photo (как humanities §18). Один primary CTA.
- Upload аудио (новый uploadStudentThreadVoice или generalize uploadStudentThreadImage) → voice_ref → submission.
- Cap длительности ~7 мин + size cap (= MAX_VOICE_BYTES из TASK-7). Re-record до отправки разрешён.

AC: tutor выбирает «устный» → 'speaking' в обе write-path; ученик на iPhone Safari видит рекордер (не numeric),
один CTA; запись → отправка → разбор по критериям.
Guardrails: только useVoiceRecorder. touch-action: manipulation на контролах. После merge — 🚀 Deploy needed.
Manual: iPhone Safari + Android Chrome.
```

### TASK-10 (плеер + транскрипт у репетитора) — Claude Code · ⚠️ deploy

```
[+ Преамбула + Mandatory end block]
Прочитай: spec.md v0.2 §6 + tasks.md TASK-10 + CLAUDE.md §35 (CriteriaBreakdownTable) + RU-bypass
(.claude/rules/95: rewriteToProxy для browser-facing signed URL).

В src/components/tutor/GuidedThreadViewer.tsx для speaking-submission рендери на 1 странице:
<audio> плеер (play/pause) + транскрипт под ним + CriteriaBreakdownTable (компонент TASK-4, НЕ дублируй) +
кнопку «Изменить балл» (override §6). Аудио signed URL через rewriteToProxy() (browser-facing).

AC: репетитор открывает тред speaking-задачи → слышит аудио, видит транскрипт + таблицу критериев + правит балл;
RU-юзер → аудио играет (URL не *.supabase.co).
Guardrails: тайм-коды «клик на момент» / голос-коммент репетитора — OUT (Spec §3). loading="lazy",
touch-action: manipulation. Не дублировать CriteriaBreakdownTable. После merge — 🚀 Deploy needed.
```

### TASK-11 (включить флаг + тест голоса) — Claude Code (smoke) + Vladimir (manual)

```
Claude: npm run lint && npm run build && npm run smoke-check.
Vladimir (manual): deploy (Lovable auto applies миграции+functions) → deploy-sokratai (frontend) →
UPDATE tutors SET feature_voice_speaking_enabled=true WHERE user_id='<emilia uuid>' → дать Эмилии speaking-ДЗ на FR.
Критерий успеха (Spec §7): покритериальный разбор принимается без правок в большинстве случаев,
транскрипт FR читаемый, «беру / готова платить». Собрать signal в docs/discovery/signals/ (pipeline шаг 7).
```

### Code review (каждая задача) — Codex / ChatGPT-5.5

> Pipeline шаг 6: независимый ревьюер, контекст автора недоступен. Verdict-формат **PASS /
> CONDITIONAL PASS / FAIL** + список находок (P0/P1/P2). Сначала product-альignment (read-order),
> затем технические hot-zones. Подставляй scope конкретной задачи в начало.

```
Ты — независимый ревьюер SokratAI. Контекст первого агента недоступен.

ПОРЯДОК ЧТЕНИЯ (строго):
1. docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. docs 16 (UX principles) + 17 (UI patterns)
3. docs/delivery/features/voice-speaking-mvp/spec.md v0.2 + tasks.md (ревьюируемая задача)
4. CLAUDE.md §§: 0 (task_kind derive), 9/27 (anti-leak), 12 (elements_check паттерн),
   16 (единый grading + voice_ref), 17 (квота ДО AI), 23 (GRANT task_states), 35 (criteria_breakdown)
5. git diff

PRODUCT-АЛИГНМЕНТ (pipeline questions): Job R1 alignment? UX drift vs 16/17? Scope creep
(тайм-коды/голос-коммент/IELTS-breakdown НЕ должны появиться)? AC выполнены? AI = черновик + действие?

ТЕХНИЧЕСКИЕ HOT-ZONES (этап 2):
- §0 dual-derive: task_kind='speaking' персистится во ВСЕХ write-path, НЕ перетёрт deriveTaskKind?
- Квота (§17): checkAiQuota ДО Whisper И Gemini (две AI-операции)? Двойного списания нет?
- voice_ref: валидируется через extractStudentThreadAttachmentRefs (SSRF/per-student/bucket whitelist),
  не вручную? Namespace {userId}/{assignmentId}/...?
- RU-bypass: server-side fetch аудио → rewriteToDirect()? browser-facing плеер → rewriteToProxy()?
- Anti-leak (§9): solution_text/rubric_* идут только в grading, НЕ в ответ ученику?
- Whisper robustness: 5xx → retry; пустой транскрипт → НЕ зовём Gemini, задача не закрыта; PII-free логи?
- Grading: НЕ продублирован runStudentAnswerGrading? criteria_breakdown Σ = ai_score (этап 1 инвариант)?
- Cross-browser: только useVoiceRecorder, без новых MediaRecorder-обёрток? touch-action на контролах?
- Миграция: CHECK через DROP+ADD (не аддитивно)? idempotent? без drop/rename колонок?
- Разбор / плеер / транскрипт — на 1 странице (жёсткий инвариант Эмилии)?

ФОРМАТ: PASS / CONDITIONAL PASS / FAIL. Для каждой находки — Severity (P0 correctness/security /
P1 broken edge / P2 polish) + File:line + repro/code-path + suggested fix. Если нет блокеров — PASS + P2 observations.
Сверься с Definition of Done (doc 19): Job linkage / spec / no UX-canon breakage / success signal defined.
```
