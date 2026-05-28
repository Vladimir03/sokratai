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

## Этап 2 — Голос поверх готового грейдинга · ~3.5 часа

### TASK-6 — Миграции `task_kind='speaking'` + флаг + bucket

- **Spec §5.** **Agent:** Claude Code.
- **Files:** 2–3 миграции (`<ts>_add_speaking_task_kind.sql`, `<ts>_add_feature_voice_speaking_flag.sql`, опц. bucket).
- **Что делаем:** CHECK `task_kind IN (...,'speaking')`; `tutors.feature_voice_speaking_enabled boolean default false` (mirror `feature_mock_exams_enabled`); bucket-решение (рекомендация — переиспользовать `homework-submissions` подпапкой `voice/`).
- **Guardrails:** additive. Флаг default false.
- **Validation:** insert speaking-задачи не падает; флаг включается per-tutor.

### TASK-7 — Shared helper транскрипции (Groq Whisper)

- **Spec §3, §5.** **Agent:** Claude Code.
- **Files:** `supabase/functions/_shared/voice-transcribe.ts` (новый).
- **Что делаем:** `transcribeAudio(buf, { language, mimeType })` → Groq `whisper-large-v3-turbo`, multipart FormData, `language`. Subject→lang map. Таймаут + 1 retry на 5xx. PII-free логи. Не рефакторить вызовы бота/чата в этом PR.
- **Validation:** тестовое FR-аудио → читаемый транскрипт.

### TASK-8 — `handleStudentSubmission`: ветка `speaking`

- **Spec §3, §5.** **Agent:** Claude Code.
- **Files:** `supabase/functions/homework-api/index.ts`.
- **Что делаем:** detect `task_kind='speaking'` → **AI-квота гейт ДО AI** (`checkAiQuota`, §17) → валидация `voice_ref` → signed URL `rewriteToDirect()` → fetch → `transcribeAudio` (TASK-7) → `answerText=transcript` → `runStudentAnswerGrading` (тот же покритериальный грейдинг этапа 1). `voice_ref` обязателен (400 иначе).
- **Guardrails:** `task_kind='speaking'` ставится явно, `deriveTaskKind` не перетирает (§0, 4 write-path + HWDrawer). solution/rubric не утекают (§9). Не дублировать grading.
- **Validation:** `npm run build && smoke-check`. Manual: speaking-submit → транскрипт + покритериальный разбор + балл.

### TASK-9 — UI записи монолога (ученик) · ⚠️ deploy

- **Spec §6.** **Agent:** Claude Code.
- **Files:** `src/components/student/homework-problem/SubmitSheet.tsx`, `src/types/homework.ts` (`task_kind` + `'speaking'`).
- **Что делаем:** для speaking — рекордер на `useVoiceRecorder` (iOS Safari m4a/webm уже решён — не вводить новый recorder, `.claude/rules/80-cross-browser.md`). Upload → `voice_ref` → submission. Скрыть numeric-row (как humanities, §18). Один primary CTA. Лимит длительности под монолог (~5–7 мин).
- **Validation:** `npm run build`. Manual iPhone Safari + Android Chrome.

### TASK-10 — Плеер + транскрипт (репетитор) · ⚠️ deploy

- **Spec §6.** **Agent:** Claude Code.
- **Files:** `src/components/tutor/GuidedThreadViewer.tsx` (+ `src/components/homework/`).
- **Что делаем:** для speaking-submission — плеер (play/pause) + транскрипт + таблица критериев (TASK-4) + override итога (§6). Аудио signed URL через `rewriteToProxy()`. Всё на 1 странице. Тайм-коды / голос-коммент — НЕ здесь (out of scope).
- **Validation:** `npm run build`. Manual: репетитор слышит аудио, видит транскрипт + критерии + правит балл.

### TASK-11 — Включить флаг Эмилии + тест голоса

- **Spec §7.** **Agent:** Vladimir + Claude Code (smoke).
- **Что делаем:** `lint && build && smoke-check` → deploy (Lovable auto + `deploy-sokratai`) → `UPDATE tutors SET feature_voice_speaking_enabled=true WHERE user_id='<emilia>'` → тестовое speaking-ДЗ FR.
- **Критерий успеха (Spec §7):** покритериальный разбор принимается без правок в большинстве случаев; транскрипт FR читаемый; «беру / готова платить».

---

## Зависимости

```
TASK-0 → всё
Этап 1: TASK-1, TASK-2 → TASK-3 → TASK-4 → TASK-5 (валидация — ГЕЙТ для этапа 2)
Этап 2: TASK-6, TASK-7 → TASK-8 → (TASK-9, TASK-10) → TASK-11
TASK-8 зависит от TASK-3 (тот же грейдинг)
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

### TASK-6 (миграции speaking + флаг + bucket) — Claude Code

```
Прочитай spec.md v0.2 (§5) + tasks.md TASK-6 + CLAUDE.md §11 (feature_mock_exams_enabled как образец).
Миграции: (1) CHECK task_kind IN (...,'speaking') на homework_tutor_tasks (mirror 20260509120000);
(2) tutors.feature_voice_speaking_enabled boolean NOT NULL DEFAULT false;
(3) опц. bucket — рекомендация переиспользовать homework-submissions подпапкой voice/ (новый bucket только если упрёмся).
Additive, флаг default false. Проверь: insert speaking-задачи не падает на CHECK.
```

### TASK-7 (Whisper helper) — Claude Code

```
Прочитай spec.md v0.2 (§3,§5) + tasks.md TASK-7.
Изучи Groq Whisper в supabase/functions/telegram-bot/index.ts (handleVoiceMessage) и chat voice path.
Создай supabase/functions/_shared/voice-transcribe.ts: transcribeAudio(audioBuffer, { language, mimeType }) →
multipart FormData → POST api.groq.com/openai/v1/audio/transcriptions, model whisper-large-v3-turbo, language.
Subject→lang map (french→fr и т.д.). Таймаут + 1 retry на 5xx. PII-free логи. GROQ_API_KEY из env.
Не рефактори вызовы бота/чата в этом PR.
```

### TASK-8 (speaking branch) — Claude Code

```
Прочитай spec.md v0.2 (§3,§5) + tasks.md TASK-8 + CLAUDE.md §16 (voice_ref), §17 (AI-квота), §0 (derive task_kind), §9 (anti-leak).
В supabase/functions/homework-api/index.ts расширь handleStudentSubmission веткой task_kind='speaking':
квота-гейт checkAiQuota(context:'homework') ДО AI → валидация voice_ref → signed URL rewriteToDirect() → fetch →
transcribeAudio (TASK-7, language из subject) → answerText=transcript → runStudentAnswerGrading (тот же покритериальный
грейдинг этапа 1). voice_ref обязателен. task_kind='speaking' не перетирается deriveTaskKind.
```

### TASK-9 (рекордер ученика) — Claude Code · ⚠️ deploy

```
Прочитай spec.md v0.2 (§6) + tasks.md TASK-9 + .claude/rules/80-cross-browser.md + CLAUDE.md §18 (humanities UX).
В src/components/student/homework-problem/SubmitSheet.tsx для task_kind='speaking' показывай рекордер
на базе useVoiceRecorder (НЕ вводи новый recorder — iOS Safari m4a/webm уже решён). После записи →
upload аудио в bucket (TASK-6) → voice_ref → submission endpoint. Скрой numeric-row (как humanities, §18).
Один primary CTA. Лимит длительности под монолог (~5–7 мин). src/types/homework.ts: task_kind union + 'speaking'.
После merge — Deploy needed (deploy-sokratai). Manual: iPhone Safari + Android Chrome.
```

### TASK-10 (плеер + транскрипт у репетитора) — Claude Code · ⚠️ deploy

```
Прочитай spec.md v0.2 (§6) + tasks.md TASK-10 + CLAUDE.md (RU-bypass: rewriteToProxy для browser-facing signed URL).
В src/components/tutor/GuidedThreadViewer.tsx (+ src/components/homework/) для speaking-submission рендери:
плеер (play/pause) + транскрипт под ним + таблицу критериев (компонент из TASK-4) + кнопку «Изменить балл» (override §6).
Аудио signed URL через rewriteToProxy(). Всё на 1 странице. Тайм-коды / голос-коммент репетитора — НЕ здесь (out of scope).
loading="lazy", touch-action: manipulation на контролах. После merge — Deploy needed (deploy-sokratai).
```

### TASK-11 (включить флаг + тест голоса) — Claude Code (smoke) + Vladimir (manual)

```
Claude: npm run lint && npm run build && npm run smoke-check.
Vladimir (manual): deploy (Lovable auto applies миграции+functions) → deploy-sokratai (frontend) →
UPDATE tutors SET feature_voice_speaking_enabled=true WHERE user_id='<emilia uuid>' → дать Эмилии speaking-ДЗ на FR.
Критерий успеха (Spec §7): покритериальный разбор принимается без правок в большинстве случаев,
транскрипт FR читаемый, «беру / готова платить».
```

### Code review (каждая задача) — Codex

```
Независимое ревью без контекста автора против spec.md v0.2 и CLAUDE.md: §12 (паттерн elements_check),
§16 (единый grading, voice_ref), §17 (квота ДО AI), §0 (task_kind derive), §6 (override/шаг 0.1),
§9/§27 (anti-leak: solution/rubric tutor-only, humanities verbatim skip), §23 (GRANT-whitelist на task_states),
cross-browser (только useVoiceRecorder), RU-bypass (rewriteToProxy browser / rewriteToDirect server),
разбор на 1 странице, сумма критериев = ai_score. Верни P0/P1/P2.
```
