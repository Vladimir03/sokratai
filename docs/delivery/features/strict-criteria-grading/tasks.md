# Tasks: Единая строгая покритериальная AI-проверка (`grading_discipline`)

Spec: `spec.md`. Backend/edge-only. Deploy = Lovable синк на push (НЕ `deploy-sokratai`).

## Итерация 1 — Русский-first (реализовано)

- [x] **TASK-1** `types.ts` — добавить `grading_discipline?: string | null` в `SubjectRubric` (по образцу `response_language_instruction`).
- [x] **TASK-2** `russian-ege.ts` — константа `STRICT_ESSAY_27_DISCIPLINE` (текст-старт, филолог калибрует) + возврат `grading_discipline: isEssay27 ? … : null` (carve-out К7–К10).
- [x] **TASK-3** `index.ts` — в return `resolveSubjectRubric`: `grading_discipline: isNumeric ? null : (core.grading_discipline ?? null)`.
- [x] **TASK-4** `guided_ai.ts::buildCheckPrompt` — инжект `rubric.grading_discipline ?? ""` после `...criteriaPromptBlock`, перед «ПРАВИЛА ОЦЕНКИ».
- [x] **TASK-5** `mock-exam-prompts.ts::buildMockExamPart2Prompt` — инжект `rubric.grading_discipline ?? ""` после `rubric.methodology` (no-op для физики).
- [x] **TASK-6** `scripts/test-criteria-templates.mjs` — forward-guard: эссе № 27 → клауза; numeric/не-эссе русский/физика/языки/математика → null.
- [x] **TASK-7** Спека + tasks (этот файл) по rule 30 с Section 0.

### Review-фиксы (ChatGPT-5.5 CONDITIONAL PASS, 2026-06-29) — реализовано

- [x] **TASK-R4** (#4, P1) `RUSSIAN_EGE_27_PRESET` дополнен `description` (byte-mirror backend). Кнопка пресета теперь несёт band-описания → тутор видит/правит → AI грейдит по ним (не label+max). ⚠ `src/` → нужен `deploy-sokratai`.
- [x] **TASK-R2** (#2, P1) `STRICT_GRADING_DISCIPLINE` сделан GENERIC (без номеров К) + условный грамотность-carve-out → когерентен с пресетом И кастомными критериями репетитора.
- [x] **TASK-R3** (#3, P2) `matchTemplateEntry` — `criterionCode` code-pass против коллизии «К1»⊂«К10» substring; ordinal-сеть сохранена.
- [x] **TASK-R-guard** smoke-guard `russian preset descriptions mirror frontend` (31/31 pass) + rule 40 mirror-note обновлён.
- [ ] **TASK-R1** (#1, P1) **FOLLOW-UP, не в этом раунде:** деривация `ai_score` = Σ критериев при активном template (сейчас критерии нормализуются ПОД холистический ai_score). Трогает общую нормализацию (языки + downgrade `renormalizeCriteriaToScore`) → отдельная задача + своя валидация. Не корень 22/22.
- [ ] **TASK-R5** (#5, P2) HWDrawer path B structured criteria — known limitation, later.

- [ ] **TASK-8** Verification: `npm run lint && npm run build && npm run smoke-check` (зелёный).
- [ ] **TASK-9** Deploy: commit + push → проверить, что Lovable передеплоил edge (`curl` → 401, не 503).
- [ ] **TASK-10** Validation: пере-сдать сочинение (ДЗ `c4384c4e-…`, задача `40e4e689-…`) → сравнить с оценкой филолога → при необходимости итерировать текст клаузы в `russian-ege.ts` (single-point правка + повторный push).
- [ ] **TASK-11** Канон в rule 40 («Subject-rubric layer» / новая под-секция про `grading_discipline` + tone-split) после валидации.

## Отложено (следующие итерации, отдельные PR)

- [ ] **TASK-12** Физика: `grading_discipline` в `physics-ege.ts` (активирует строгость mock Часть 2). Валидирует Егор.
- [ ] **TASK-13** Французский: `languages-ege.ts`. Сначала закрыть Open Question 1 (Gemini-флоу Эмилии).
- [ ] **TASK-14** Математика: `math-ege.ts`.
- [ ] **TASK-15** (опц.) Generic strict для любой задачи с `criteria_breakdown_template`.
- [ ] **TASK-16** (отложено, decision #4) Физ/мат покритериальные пресеты.
