# Mock Exams v1 — Tutor-side improvements (TASK-16 + R2 + R3)

**Status:** R3 fixes landed
**Created:** 2026-05-15
**Updated:** 2026-05-17 (R3 — ChatGPT-5.5 P0/P1/P2 findings after R2 review)
**Trigger:** Vladimir QA после TASK-15. 6 tutor-side improvements: AI OCR fix +
Part 1 batch finalize + photo multi-select + heatmap data + result page student
answer + secondary score conversion. **R2:** все 5 P1 от ChatGPT-5.5 (post-TASK-16).
**R3:** 1 P0 (security) + 2 P1 + 1 P2 от ChatGPT-5.5 (post-R2).

Связанные документы:
- `~/.claude/plans/wobbly-crafting-starlight.md` — план реализации
- `docs/delivery/features/mock-exams-v1-pilot-polish/spec.md` — общая spec пилота
- `docs/delivery/features/mock-exams-v1-pilot-polish/review-fixes-spec.md` — предыдущая итерация

---

## Section 0 — Job Context

**Core Job (Vladimir):** Дать репетитору быстро и без ошибок проверить пробник
ученика, чтобы он выдал результат родителям и подтянул слабые места ученика.

После Phase 6 (Phase 5 + AI bulk grader) накопились 6 проблем при первом
живом прохождении пилотного flow blank-mode учеником (15.05.2026):

1. AI OCR не распознал хорошо заполненный бланк → tutor вводит баллы вручную (медленно)
2. Tutor не получает confirm-dialog перед «Часть 1 проверена» → промахи неисправимы
3. Photo может относиться к нескольким задачам, текущий single Select это не поддерживает
4. Heatmap пустой после approval — value-proposition «увидел прогресс» сломан
5. «✓ без ответа» на result page после blank confirm — confusing для ученика
6. Нет конвертации первичный→тестовый по ФИПИ шкале — родитель не понимает 18/45

---

## Section 1 — Acceptance Criteria

### AC-T16-1: AI Часть 1 OCR fix + retry

- **AC-T16-1a** Модель OCR: `google/gemini-3-flash-preview` заменена на `google/gemini-2.5-pro`. Только OCR endpoint — Часть 2 grader остаётся на `flash` (cost).
- **AC-T16-1b** При parse failure / empty result / exception в `runPart1OCR`: backend сохраняет в `mock_exam_attempts.ai_part1_ocr_json` структуру `{ cells: {}, __meta: { gemini_model, recognized_cells, raw_length, error?, raw_response? } }`. Tutor может проверить через `/tutor/mock-exams/.../review/...` (логи доступны через Supabase Studio).
- **AC-T16-1c** Verbose logging `mock_exam_grade_part1_ocr_response` при success — PII-free (attempt_id + lengths only).
- **AC-T16-1d** Tutor видит в `Part1BlankReviewPanel` кнопку «🔄 Запустить AI OCR заново» рядом с info-баннером. Disabled при `attempt.status ∈ {approved, manually_entered}`. Click → POST `/attempts/:id/retry-part1-ocr` → backend clear'ит `ai_part1_ocr_json` + service-role fetch на `mock-exam-grade` с `force_retry_ocr: true`.
- **AC-T16-1e** Frontend показывает toast «AI OCR перезапущен, обновляем…» с loading state + delayed invalidate (8s) для refetch attempt → новые OCR values pre-fill inputs в `Part1BlankReviewPanel`.

### AC-T16-2: Part 1 batch finalize confirm dialog

- **AC-T16-2a** Backend `POST /attempts/:id/part1-finalize` (`handlePart1Finalize`):
  - SELECT всех Часть 1 KIM для variant
  - Для каждого KIM без row в `mock_exam_attempt_part1_answers` → INSERT `{kim_number, student_answer: null, earned_score: 0}` через upsert с `ignoreDuplicates: true` (не overwrite existing tutor entries)
  - SUM(earned_score) → UPDATE `attempt.total_part1_score`
  - Idempotent: повторный вызов даёт тот же total
- **AC-T16-2b** Frontend `Part1BlankReviewPanel`: button «Часть 1 проверена» → AlertDialog (не immediate API call). Dialog содержит:
  - Заголовок «Подтвердить баллы Часть 1»
  - Sticky-header таблица 20 rows: `№N | answer | balls`
  - Для пустых KIM: chip «0 (не введено)» amber + value = 0
  - Sum preview: «Итого: X / 28»
  - Buttons «Отмена» + «Сохранить и отправить ученику»
- **AC-T16-2c** На confirm → `finalizeMockExamPart1` (existing API) → invalidate + toast + auto-close dialog.
- **AC-T16-2d** Result page: KIM без введённого балла теперь показывают «0/max» вместо «—» (за счёт INSERT'а на step AC-T16-2a).

### AC-T16-3: Part 2 photo multi-select chips

- **AC-T16-3a** Backend `POST /attempts/:id/assign-part2-photos` (existing endpoint) уже поддерживает multi-select. Body `{ assignments: Record<number, number[]> }` — один и тот же `photo_idx` может быть в нескольких kim массивах. AI grader Pass 2 уже умеет это (`gradePart2TaskBulk` принимает filtered photos for each kim).
- **AC-T16-3b** Frontend `BulkPhotosAssignmentGallery` (TutorMockExamReview.tsx):
  - Local state — `Map<photoIdx, Set<kim>>`
  - Replace single `<Select>` на chip grid: 6 кнопок №21..№26 + кнопка «— не подошла»
  - `toggleAssignment(photoIdx, kim)`: если kim уже в set → remove; else → add
  - `setNoneAssignment(photoIdx)`: clear all kims в set
  - Debounced save (500ms) через `assignMockExamPart2Photos`
  - «Перепроверить AI» button работает как раньше (regradeMutation)
- **AC-T16-3c** Initial state derivation из `ai_draft.assigned_photo_indices` — каждое фото может оказаться в нескольких kim'ов одновременно (AI bulk grader pass 1 уже это допускает).
- **AC-T16-3d** A11y: каждая кнопка-чип имеет `aria-pressed`. Группа кнопок — `role="group" aria-label="Привязка фото N к задачам"`.
- **AC-T16-3e** Mobile: chips `min-h-9` + `touch-manipulation`. Emerald active state + slate inactive.

### AC-T16-4: Heatmap per-task data hydration

- **AC-T16-4a** Backend `handleGetAssignment` (mock-exam-tutor-api/index.ts):
  - Batch SELECT `mock_exam_attempt_part1_answers` + `mock_exam_attempt_part2_solutions` `.in("attempt_id", attemptIds)`
  - Group by attempt_id → mutate каждый `attempt.part1_answers` + `attempt.part2_solutions`
  - Anti-leak: НЕ возвращать `student_answer` (Часть 1 leak risk для form-mode) и НЕ возвращать `ai_draft_json` (CLAUDE.md §15)
- **AC-T16-4b** Frontend types `MockExamAttemptListItem`:
  - `part1_answers?: Array<{ kim_number, earned_score }>` (optional для backward compat)
  - `part2_solutions?: Array<{ kim_number, tutor_score, status }>`
- **AC-T16-4c** Frontend `MockExamHeatmap.tsx`:
  - Lookup map per row: `part1Map: Map<kim, earned_score>` + `part2Map: Map<kim, {tutor_score, status}>`
  - Часть 1 cells (kim 1-20): score = part1Map.get(kim) ?? null, maxScore = KIM_MAX_SCORE[kim]
  - Часть 2 cells (kim 21-26): если `tutor_score !== null` → реальный балл; иначе если `status='awaiting_review'` или attempt в submitted/awaiting_review → `forcedKind='draft'`; иначе `null` → cell-empty
  - `KIM_MAX_SCORE` — single source of truth для ЕГЭ физика 2026 (часть 1: 28, часть 2: 17)
- **AC-T16-4d** Frontend `TutorMockExamDetail.tsx`: hint «Цветные клетки 1-26 появятся...» скрыт когда есть хотя бы одна approved/manually_entered attempt.

### AC-T16-5: Result page «без ответа» fix

- **AC-T16-5a** Student result page Part1Card row render:
  - `student_answer` есть → показывать как раньше
  - `student_answer === null` И `isCorrect` И `correct_answer` → показывать `{correct_answer} (по фото бланка)` (suffix серым)
  - Иначе → italic «без ответа»
- **AC-T16-5b** Edge cases:
  - KIM с partial score (1/2 in form mode): остаётся «без ответа» если student_answer null — не leak partial correct
  - KIM с 0 score: остаётся «без ответа» + ✗
  - KIM с full score + student_answer есть (form mode): показывает student_answer как раньше

### AC-T16-6: ФИПИ 2025 шкала первичный → тестовый

- **AC-T16-6a** New file `src/lib/mockExamScaleEge2025.ts`:
  - Hardcoded `PRIMARY_TO_SECONDARY_EGE_PHYSICS_2025: Record<number, number>` для 0..45 → 0..100
  - Constants: `MAX_PRIMARY_EGE_PHYSICS_2025 = 45`, `MAX_SECONDARY_EGE_PHYSICS_2025 = 100`
  - `primaryToSecondary(primary): number | null` — null-safe converter
  - **TODO comment** для Vladimir: проверить точные значения против fipi.ru до прод-merge
- **AC-T16-6b** `TutorMockExamDetail` KPI «Средний первичный» — добавить вторую строку «≈ N тестовых» когда есть approved attempts. Расчёт по `total_score` approved attempts (не только Часть 1 — шкала применима к полному первичному).
- **AC-T16-6c** `StudentMockExamResult::FinalSummary` — под основным первичным баллом «≈ N тестовых баллов» (только когда `totalMax === 45`, т.е. variant1 ЕГЭ физика).
- **AC-T16-6d** Текст под итоговым баллом меняется на «Ориентировочная оценка по шкале ФИПИ 2025. Точная — после публикации шкалы 2026.» когда показан secondary; для других variant'ов остаётся «Тестовый балл будет известен после публикации шкалы ЕГЭ-2026».

---

## Section 2 — Implementation files

| File | Type | Change |
|---|---|---|
| `supabase/functions/mock-exam-grade/index.ts` | MODIFY | model swap для OCR + verbose logging + `force_retry_ocr` flag + structured failure snapshot в `ai_part1_ocr_json.__meta` |
| `supabase/functions/mock-exam-tutor-api/index.ts` | MODIFY | new `/retry-part1-ocr` endpoint; `/part1-finalize` INSERT-on-missing pattern; `handleGetAssignment` per-task batch hydration |
| `src/lib/mockExamApi.ts` | MODIFY | `retryMockExamPart1OCR` API function |
| `src/lib/mockExamScaleEge2025.ts` | NEW | hardcoded ФИПИ 2025 шкала + helper |
| `src/types/mockExam.ts` | MODIFY | `MockExamAttemptListItem.part1_answers` + `part2_solutions` optional |
| `src/pages/tutor/mock-exams/TutorMockExamReview.tsx` | MODIFY | retry button, AlertDialog finalize, multi-select chips |
| `src/components/tutor/mock-exams/MockExamHeatmap.tsx` | MODIFY | derive score per kim из hydrated arrays + KIM_MAX_SCORE constant |
| `src/pages/tutor/mock-exams/TutorMockExamDetail.tsx` | MODIFY | conditional hint + secondary score KPI footer |
| `src/pages/student/StudentMockExamResult.tsx` | MODIFY | conditional «(по фото бланка)» display + secondary в FinalSummary |
| `docs/delivery/features/mock-exams-v1-pilot-polish/tutor-improvements-spec.md` | NEW | this spec doc |

---

## Section 3 — Verification

1. **OCR retry**: открыть review для blank-mode attempt с failed OCR (`ai_part1_ocr_json.__meta.error` IS NOT NULL) → click «Запустить AI OCR заново» → toast + spinner → через ~8с refetch → если Gemini 2.5-pro распознал, cells заполнены. Если опять не распознал — `ai_part1_ocr_json.__meta.raw_response` содержит debug info.
2. **Confirm dialog**: ввод 5 KIM баллов, остальные пустые → click «Часть 1 проверена» → AlertDialog показывает таблицу 20 rows с «0 (не введено)» chips для 15 пустых + sum «5 / 28» preview. Confirm → save → result page показывает «0/max» для всех 15 пустых, не «—».
3. **Multi-select chips**: одно фото → click chips №22 + №23 + №24 → 3 chips активны (emerald) → debounce 500ms → backend `assignments` теперь содержит photoIdx=0 в массивах для kim 22/23/24. Click №22 второй раз → toggle off.
4. **Heatmap**: detail page после approve attempt — клетки 1-26 colored (verно/частично/неверно по earned_score / tutor_score). Hint «Цветные клетки 1–26 появятся…» скрыт. Pre-approval — клетки Часть 1 colored по earned_score, клетки Часть 2 показывают `cell-draft` (AI ещё не подтверждён) или пустые.
5. **Result page (blank mode)**: ученик-blank после full approve видит № 1: `225 (по фото бланка)` (если tutor подтвердил полный балл). KIM с 0 score остаётся «без ответа».
6. **Secondary score**: detail page «Средний первичный 38/28 ≈ 90 тестовых» (для approved attempts). Result page FinalSummary: «38 / 45» + «≈ 90 тестовых баллов» + текст про ориентировочную шкалу.
7. `npm run build` ✅
8. `npm run smoke-check` ✅

---

## Section 4 — Vladimir manual after deploy

- **(#1) OCR**: убедиться через Lovable Studio что `LOVABLE_API_KEY` имеет доступ к `google/gemini-2.5-pro`. Если access denied — оставит на flash + tutor вводит вручную (graceful degrade).
- **(#6) Шкала**: **прислать в чат точную таблицу ФИПИ 2025 (45 значений)**. Сейчас в `mockExamScaleEge2025.ts` стартовые значения, помечены `TODO (Vladimir)`. После уточнения — обновить файл + commit без code change.
- **(#3) Multi-select**: после первого реального ученика, проверить что AI bulk pass корректно мапит фото которое содержит 2 задачи (если он распознаёт его номера) — assignments на сервере должно быть `[idx]` в обоих kim arrays.

---

## Section 5 — Out of scope (deferred)

- Per-task hydration для тестов backward-compat (multi-variant) — текущая 2-query approach OK для пилот scale (1 variant 26 tasks × ≤10 students)
- Real-time refresh для tutor когда student submit — push notification → query invalidate работает через TASK-15 polling
- Per-photo zoom modal вместо new tab (UX nice-to-have)
- Multi-variant secondary score таблицы (только 2025 в этом sprint, ОГЭ / другие предметы — отдельно)
- Voice-driven «Часть 1 проверена» (а-ля dictation для быстрого ввода 20 баллов) — out of P0

---

## Section 6 — Rollback

- Frontend: `git revert <hash> && deploy-sokratai` (~3 мин на VPS)
- Backend edge functions: Lovable Studio → rollback prior deployment
- TASK-16 itself — никаких schema migrations (только в R2 — см. ниже)
- **R2 migration** `20260516130000_part1_answers_score_source.sql` (additive `score_source` column) — backward compatible (default DEFAULT 'ocr'); rollback = DROP COLUMN, runPart1OCR fallback на `earned_score IS NOT NULL` heuristic.
- Phase 6 миграции `20260515120000_attempt_ai_part1_ocr.sql` + `20260515130000_attempt_updated_at.sql` остаются.

---

## Section 7 — R2 fixes (2026-05-16)

ChatGPT-5.5 review TASK-16 нашёл 5 P1 findings. Все исправлены в TASK-16-R2.

### R2-AC-1: OCR retry actually overwrites prior OCR scores

**Problem:** `runPart1OCR` использовал `earned_score IS NOT NULL` как signal "tutor preserved row" — после первого OCR run все 20 rows имели non-null earned_score → второй retry пропускал ВСЕ KIM → новые OCR values попадали только в `ai_part1_ocr_json`, но scores оставались stale.

**Fix:** new migration `20260516130000_part1_answers_score_source.sql` — добавлен `score_source TEXT NOT NULL CHECK IN ('ocr','tutor','finalize_default','student_form')`. 4 write-path обновлены чтобы писать правильный provenance:
- `runPart1OCR` → `'ocr'`
- `handlePart1ManualScore` → `'tutor'`
- `handlePart1Finalize` INSERT-on-missing → `'finalize_default'`
- Student form auto-check (submit) + autosave → `'student_form'`

Read-path в `runPart1OCR.tutorScoredKims` теперь filter ТОЛЬКО `score_source === 'tutor'`. Backfill: все pre-existing rows → `'tutor'` (safest — preserves any uncertain manual edits).

### R2-AC-2: `/retry-part1-ocr` rejects `ai_checking`

**Problem:** retry endpoint допускал `status='ai_checking'`, clear'ил `ai_part1_ocr_json`, и fire-and-forget'ил grader. Grader CAS guard возвращал 202 ALREADY_GRADING, но retry endpoint всё равно отвечал `"queued"` — tutor видел false success без реального retry.

**Fix:** `/retry-part1-ocr` теперь возвращает 409 `GRADING_IN_PROGRESS` при `status='ai_checking'`. Mirror `/regrade-part2` Round 3 contract.

### R2-AC-3: Part 1 confirm dialog не finalize'ит stale DB

**Problem:** `handleScoreBlur` async save + быстрый click «Часть 1 проверена» → confirm dialog показывал draft sum (local), но `finalizeMockExamPart1` SUM'ил DB rows которые ещё не сохранили last edit → mismatch preview vs finalized result.

**Fix:** в `Part1BlankReviewPanel`:
- `savingKim: number | null` → `savingKims: Set<number>` (parallel saves возможны)
- New `dirtyKims` useMemo — derives kims с draft ≠ saved value
- `handleFinalize`: перед `finalizeMockExamPart1` flush'ит все `dirtyKims` через Promise.all `setMockExamPart1ManualScore`. На flush failure — toast.error и НЕ идём в finalize.
- Confirm button и AlertDialog action **disabled** пока `savingKims.size > 0` + visual indicator «сохраняем N…»

### R2-AC-4: Canonical `__meta` shape + failure UI

**Problem:** `runPart1OCR` failure писал `{ cells: {}, raw_response, error, gemini_model, failed_at }` top-level. Frontend проверял `attempt.ai_part1_ocr_json &&` (truthy) → показывал emerald «✅ AI распознал бланк» даже на failure.

**Fix:** canonical shape `{ cells: Record<number, Cell>, __meta: { status: 'success' | 'failed', ... } }`:
- Backend success: `{ cells: ocrResult, __meta: { status: 'success', gemini_model, recognized_cells, raw_length, generated_at } }`
- Backend failure: `{ cells: {}, __meta: { status: 'failed', gemini_model, error, raw_response, failed_at, generated_at } }`
- Frontend type `MockExamPart1OCRResult` reflects nested shape. Cell access: `ai_part1_ocr_json.cells[kim]` (was top-level).
- Frontend UI ветвит на 3 состояния: failed (rose), success+0 recognized (amber soft warning), success+N>0 (emerald success с counter «N/20 клеток»).

### R2-AC-5: KPI mismatch fix

**Problem:** «Средний первичный» KPI смешивал avg part1 (/28) value с secondary footer (/45). UI показывал нонсенс типа «20 / 28 ≈ 80 тестовых».

**Fix:** rename label на «Средняя Часть 1», убран secondary footer. Новый 6-й KPI «Средний общий балл» рендерится ТОЛЬКО при `approvedFinal > 0` (когда secondary действительно meaningful) — value `avgTotal/totalMax`, footer `≈ N тестовых`. Grid: `lg:grid-cols-5` (5 baseline) → `lg:grid-cols-6` (при approved KPI present).

### R2 verification

1. **OCR retry test:** blank-mode attempt → submit → grader OCR scores 15/20 → click «Перезапустить AI» → grader re-runs → new OCR rewrites all 20 OCR-source rows. Tutor manual edits (если были) — preserved.
2. **Grading-in-progress test:** force attempt в `status='ai_checking'` (можно через manual UPDATE) → click retry → 409 toast «Grader running, wait».
3. **Race test:** type «5» в KIM 19 → быстро (<300ms) click «Часть 1 проверена» → confirm → result page показывает 5 (не 0). Visual: «Сохраняем баллы…» state в button перед dialog opens.
4. **OCR failure test:** force LOVABLE_API_KEY error → submit blank attempt → grader fails OCR → tutor видит rose «AI OCR не сработал» banner + Retry button (не зелёный success).
5. **KPI test:** detail с 2 approved + 1 in_progress → KPI grid показывает 6 cards including «Средний общий балл = X/45 ≈ N тестовых». Detail с 0 approved → 5 cards.

### R2 files

| File | Type | Change |
|---|---|---|
| `supabase/migrations/20260516130000_part1_answers_score_source.sql` | NEW | additive `score_source` column + backfill 'tutor' |
| `supabase/functions/mock-exam-grade/index.ts` | MODIFY | `runPart1OCR` filter on `score_source='tutor'` + write 'ocr'; canonical `{cells, __meta}` shape (success + failed) |
| `supabase/functions/mock-exam-tutor-api/index.ts` | MODIFY | `/retry-part1-ocr` reject `ai_checking` (409); `handlePart1ManualScore` writes 'tutor'; `handlePart1Finalize` writes 'finalize_default' |
| `supabase/functions/mock-exam-student-api/index.ts` | MODIFY | autosave + submit auto-check write `'student_form'` |
| `src/types/mockExam.ts` | MODIFY | `MockExamPart1OCRResult` → nested `{cells, __meta}` interface |
| `src/pages/tutor/mock-exams/TutorMockExamReview.tsx` | MODIFY | 3-state OCR banner (failed/empty/success); `savingKims: Set<number>` + dirty flush before finalize |
| `src/pages/tutor/mock-exams/TutorMockExamDetail.tsx` | MODIFY | rename label «Средняя Часть 1»; new 6th KPI «Средний общий балл» (conditional) |

---

## Section 8 — R3 fixes (2026-05-17)

ChatGPT-5.5 review R2 нашёл 4 findings (1 P0 + 2 P1 + 1 P2). Все исправлены.

### R3-AC-1 (P0): RLS hardening — block student spoof of `score_source='tutor'`

**Problem:** базовые RLS policies на `mock_exam_attempt_part1_answers`
(`20260508120000_mock_exams_v1_schema.sql` line 507-542) разрешают student'у
INSERT/UPDATE для своего in_progress attempt **без column-level guards**.
После R2 введения `score_source` enum, rogue student через authenticated
PostgREST client мог писать `earned_score=1, score_source='tutor'` напрямую.
OCR retry skip'ал этот faked row (R2 filter `score_source='tutor'`), tutor
видел fake score в Part1BlankReviewPanel; на blank-mode approve без ручной
проверки fake score принимался валидным.

**Attack vector:** только в blank-mode (form-mode submit handler overwrites
через `score_source='student_form'` upsert).

**Fix:** new migration `20260516140000_part1_answers_rls_hardening.sql` —
DROP+CREATE student INSERT/UPDATE policies с tight WITH CHECK guards:
`earned_score IS NULL AND score_source = 'student_form'`. Server-side writes
через `service_role` (все edge functions) НЕ затронуты.

**Validation:**
1. Connect as authenticated student. Try direct PostgREST insert с
   `score_source='tutor'` → 42501 RLS rejection.
2. Same insert с `score_source='student_form', earned_score=NULL` → OK.
3. Tutor manual score через `/part1-manual-score` (service_role) → OK.
4. OCR run через `mock-exam-grade` (service_role) → OK.

### R3-AC-2 (P1): Legacy OCR JSON normalizer

**Problem:** R2 fix #4 ввёл canonical `{cells, __meta}` shape. Pre-R2 pilot
attempts (Egor 2026-05-15+) могут содержать legacy shapes:
- Legacy success: `{ 1: {...}, ..., 20: {...}, __meta: {...} }` (flat numeric keys)
- Legacy failure: `{ cells: {}, error, raw_response, gemini_model, failed_at }`

Frontend ожидает только canonical → cell display не работает на pilot
attempts, failure banner не отображается.

**Fix:** `normalizePart1OCRJson(raw)` helper в `mock-exam-tutor-api/index.ts`,
применяется в `handleGetAttempt` перед serialize. 3 case:
- Already canonical (`__meta.status` present) → no-op
- Legacy failure → wrap top-level error fields в `__meta.status='failed'`
- Legacy success → move numeric keys в `cells`, build `__meta.status='success'`
  (используя `legacyMeta` если был сохранён + counting recognized_cells)

Идемпотентен — повторное применение не ломает. Student endpoint (`handleGetResult`
в `mock-exam-student-api`) НЕ селектит `ai_part1_ocr_json` — anti-leak invariant
сохраняется.

### R3-AC-3 (P1 forward-only mitigation): Migration safe-rerun note

**Problem:** `20260516130000_part1_answers_score_source.sql` контент:
```sql
ALTER TABLE ... ADD COLUMN IF NOT EXISTS score_source TEXT NOT NULL DEFAULT 'ocr' ...;
UPDATE ... SET score_source = 'tutor' WHERE score_source = 'ocr';
```
При повторном прогоне (e.g., `supabase db reset` локально на dev env с уже
существующими данными) ADD COLUMN no-op'ит, но UPDATE затрёт ВСЕ real OCR
rows на 'tutor' — возвращает R2 fix #1 bug.

**Mitigation (forward-only):** Supabase tracks applied migrations в
`supabase_migrations.schema_migrations` и НЕ reapply'ет. В production prod env
миграция применилась ровно один раз (Lovable Cloud auto-deploy после commit
8fa907a). Существующая база защищена.

**Caveat для dev environments:** если разработчик делает `supabase db reset`
с pre-existing data, миграция reapply'ется. Но в этом сценарии:
1. Reset обычно drops + recreates все tables → fresh DB → UPDATE no-op (rows = 0)
2. Точечный re-run против non-reset env — anti-pattern, не Supabase workflow

Документировано в comments новой `20260516140000_part1_answers_rls_hardening.sql`
(P1 #3 mitigation note секции). Если когда-нибудь понадобится hard idempotent
вариант — отдельная forward migration с DO block + column-existence check.

### R3-AC-4 (P2): Manual patch Supabase generated types

**Problem:** `src/integrations/supabase/types.ts` авто-генерируется Lovable Cloud.
После migration `20260516130000` (column added), regen pickup может быть
delayed. До auto-regen TypeScript Row/Insert/Update types не содержат
`score_source` → typed reads/writes расходятся со схемой.

**Fix:** manual patch `mock_exam_attempt_part1_answers` Row/Insert/Update
с `score_source: string` (Row) / `score_source?: string` (Insert/Update).
Comment в файле помечает риск перезатирания при Lovable auto-regen.

**Impact:** текущий build не ломается (writes идут через edge API в Deno-side,
TypeScript types для browser-side reads). Manual patch — defense-in-depth.

### R3 files

| File | Type | Change |
|---|---|---|
| `supabase/migrations/20260516140000_part1_answers_rls_hardening.sql` | NEW | DROP+CREATE student INSERT/UPDATE policies с tight `WITH CHECK` (earned_score IS NULL AND score_source='student_form') |
| `supabase/functions/mock-exam-tutor-api/index.ts` | MODIFY | `normalizePart1OCRJson` helper + apply в `handleGetAttempt` response |
| `src/integrations/supabase/types.ts` | MODIFY | manually added `score_source` field to mock_exam_attempt_part1_answers Row/Insert/Update |

### R3 verification

1. **Security test (P0):** authenticated student через DevTools console:
   ```
   const { error } = await supabase
     .from('mock_exam_attempt_part1_answers')
     .insert({ attempt_id: '<own_in_progress>', kim_number: 1, earned_score: 1, score_source: 'tutor' });
   ```
   Expected: `error.code = '42501'` (RLS rejection). Compare with valid
   shape `{ earned_score: null, score_source: 'student_form' }` → success.

2. **Legacy compat test (P1 #2):** open pilot attempt (Egor с pre-R2 OCR) →
   Part1BlankReviewPanel renders cells from `ai_part1_ocr_json.cells[kim]`
   correctly, OCR banner shows right state. До R3 cell access was broken
   (top-level numeric keys → `.cells[k]` undefined).

3. **Build / smoke-check:** `npm run build` ✅, `npm run smoke-check` ✅.

