# Code Review Prompt — TASK-16 Mock Exams Tutor Improvements

Скопируй текст ниже в ChatGPT-5.5 (или в VSCode Chat с GPT-5.5) после открытия проекта.

---

## Контекст

Я разрабатываю **SokratAI** — AI-платформу для репетиторов физики ЕГЭ. Пилот пробных экзаменов
(`mock-exams-v1`). После TASK-15 (предыдущий ревью-fix) Vladimir прошёл blank-mode flow с реальным учеником
и нашёл 6 issues. Я их закрыл в **TASK-16** (commit `957e994`) + **TASK-16 polish** (текущая ветка):
исправлены docx artefacts в solution_text для KIM 25/26 + точные значения ФИПИ 2025 шкалы.

**Stack:**
- Frontend: React + TypeScript + Vite + React Query + shadcn UI
- Backend: Supabase Edge Functions (Deno) + Postgres + RLS
- AI: Lovable Gateway → Gemini (gemini-2.5-pro для OCR, gemini-3-flash-preview для grading)
- Pilot scale: 1 variant (ЕГЭ физика, 26 задач) × 5-10 учеников per tutor

**Critical invariants** (не нарушать):
1. **Anti-leak (CLAUDE.md §10, §12, §15):** `ai_draft_json` — tutor-only, ученику ВО ВРЕМЯ pre-approval НЕ передаётся; reveal только post-approval. `solution_text` — tutor-only до approval, reveal post-approval как разбор. `correct_answer` — Часть 1 reveal post-submit, Часть 2 reveal post-approval. См. `.claude/rules/40-homework-system.md` для контекста.
2. **Tutor preservation race (CLAUDE.md §22):** rows со `status='tutor_approved'` или `'tutor_modified'` НЕ перезаписываются grader'ом. CAS guards на `mock_exam_attempts.status` и `mock_exam_attempts.updated_at` (для stale lock detection ~120s).
3. **Idempotent migrations (CLAUDE.md §11):** `mock_exam_variant_tasks` НЕ имеет `updated_at` колонки — `SET updated_at = now()` в миграции упадёт.
4. **iOS Safari sticky table fix (.claude/rules/80-cross-browser.md):** `border-separate border-spacing-0` + `<colgroup>` + `width: max-content` (НЕ `w-full` + `border-collapse`).
5. **Mock-exams Phase 6 (CLAUDE.md §22):** AI bulk grader two-pass (assign → grade), one-button approval, multi-select photo→kim mapping (одно фото → несколько задач).

## Что я изменил в TASK-16

Три скриншота, которые Vladimir показал → 6 issues:

| # | Issue | Fix |
|---|---|---|
| 1 | AI OCR failure (Gemini-3-flash-preview не распознал ФИПИ бланк) | Swap → `google/gemini-2.5-pro` для OCR endpoint only (Часть 2 grader остался на flash) + structured failure snapshot в `ai_part1_ocr_json.__meta` + new `POST /attempts/:id/retry-part1-ocr` endpoint |
| 2 | Part 1 batch finalize — нет confirm, missing KIM показывают «—» | AlertDialog с таблицей 20 KIM + sum preview перед finalize + `/part1-finalize` INSERT-on-missing pattern (пустые KIM → 0 баллов) |
| 3 | Photo → kim single-select мало (фото может содержать решения 2-3 задач) | `<Select>` → chip grid multi-select (Set<kim_number> per photo). Backend `assign-part2-photos` уже поддерживал multi (Phase 6) |
| 4 | Heatmap пустой после approval | `handleGetAssignment` batch-load'ит `part1_answers` + `part2_solutions` per attempt; `MockExamHeatmap` derive scores per kim; `KIM_MAX_SCORE` lookup |
| 5 | Result page «✓ без ответа» для blank-mode confirmed full | `student_answer === null` И `isCorrect` И `correct_answer` → показывать `{correct_answer} (по фото бланка)` |
| 6 | Нет конвертации первичный → тестовый | New `src/lib/mockExamScaleEge2025.ts` — hardcoded ФИПИ 2025 шкала (45 значений); KPI footer + FinalSummary показывают «≈ N тестовых» |

**Дополнительно (TASK-16 polish):**
- KIM 25/26 solution_text: убрал `(см. рисунки в исходном docx: image55.emf, image56.emf)` / `(см. рисунок в исходном docx: image70.emf)` — заменил на полезную инструкцию ученику «сделай схематичный рисунок».
- `mockExamScaleEge2025.ts` — обновил starter approximation на точные 45 значений с 4ege.ru (verified Vladimir).
- Cleaned `[РИСУНОК: imageN.emf]` markers из task_text source JSON (но они уже стрипались `PICTURE_MARKER_RE` в seed generator — clean-up для будущих регенов).

## Файлы изменены (12 files)

### Backend (3 files)
- `supabase/functions/mock-exam-grade/index.ts` — model swap + verbose logging + force_retry_ocr flag + raw response capture
- `supabase/functions/mock-exam-tutor-api/index.ts` — new `/retry-part1-ocr` endpoint, `/part1-finalize` INSERT-on-missing, `handleGetAssignment` batch hydration
- `supabase/migrations/20260516120000_resync_variant_1_kim_25_26_solution_text.sql` (NEW) — resync KIM 25/26 solution_text

### Frontend (8 files)
- `src/lib/mockExamScaleEge2025.ts` (NEW) — ФИПИ 2025 шкала (45 значений)
- `src/lib/mockExamApi.ts` — `retryMockExamPart1OCR` API function
- `src/types/mockExam.ts` — `MockExamAttemptListItem.part1_answers` + `part2_solutions` optional
- `src/pages/tutor/mock-exams/TutorMockExamReview.tsx` — retry button, AlertDialog finalize, multi-select chips
- `src/components/tutor/mock-exams/MockExamHeatmap.tsx` — derive scores from hydrated arrays, KIM_MAX_SCORE
- `src/pages/tutor/mock-exams/TutorMockExamDetail.tsx` — secondary score KPI footer, conditional hint hide
- `src/pages/student/StudentMockExamResult.tsx` — «(по фото бланка)» display, secondary в FinalSummary

### Source / docs (3 files)
- `docs/delivery/features/mock-exams-v1/source/variant1-tasks.json` — clean up KIM 25/26 solution_text + task_text image markers
- `supabase/seed/mock_exams_variant_1.sql` — regenerated from above (deterministic uuid5)
- `docs/delivery/features/mock-exams-v1-pilot-polish/tutor-improvements-spec.md` (NEW)

## Что попросить ChatGPT-5.5 проверить

**P0 — production-blocker checks:**

1. **Anti-leak invariant** — посмотри `handleGetAssignment` batch hydration в `mock-exam-tutor-api/index.ts`: я добавил SELECT на `mock_exam_attempt_part1_answers` (kim_number, earned_score) и `mock_exam_attempt_part2_solutions` (kim_number, tutor_score, status). Убедись что **НЕ** селектится `student_answer` (Часть 1, leak risk для form-mode), `ai_draft_json` (Часть 2, tutor-only artifact), `solution_text` или `tutor_comment` (pre-approval reveal риски). Сравни с TASK-13 `StudentMockExamResult` invariant (CLAUDE.md §15) — там state-aware SELECT.
2. **Tutor preservation race** — посмотри `handlePart1Finalize` в `mock-exam-tutor-api/index.ts`: я использую upsert с `ignoreDuplicates: true` для INSERT-on-missing. Это правильно? Не overwrite'ит ли существующие row'ы с tutor manual scores при concurrent grader run? Если race возможен — какой CAS pattern лучше?
3. **Migration safety** — `20260516120000_resync_variant_1_kim_25_26_solution_text.sql`: проверь idempotency, отсутствие `updated_at` (колонки нет), BEGIN/COMMIT. Pilot students могли уже approve'нуть с старым solution_text — это OK? `mock_exam_attempt_part2_solutions` не reference'ит `solution_text`, только `task_id` FK → миграция безопасна.
4. **OCR retry endpoint** — `POST /attempts/:id/retry-part1-ocr` в `mock-exam-tutor-api`: я делаю `UPDATE attempts SET ai_part1_ocr_json = NULL` затем fire-and-forget fetch на `mock-exam-grade` с `force_retry_ocr: true`. Race window: tutor нажимает retry → backend clear'ит OCR → если первый grader run всё ещё идёт (status='ai_checking') и он writes ai_part1_ocr_json после clear → state corrupted. Нужен CAS guard? Или ownership status check (status guard: only `awaiting_review` / `submitted`)? Status guard уже есть. Достаточно?

**P1 — UX correctness:**

5. **Multi-select chip toggle** — `BulkPhotosAssignmentGallery.toggleAssignment` в `TutorMockExamReview.tsx`: state — `Map<photoIdx, Set<kim>>`. Дебаунс 500ms перед save. Проверь:
   - Race: tutor быстро клацает 6 chip'ов за < 500ms → debounce срабатывает один раз с финальным state → OK.
   - "Перепроверить AI" `await saveMutation.mutateAsync(assignments)` (line 1038) flush'ит pending debounced save **перед** regrade — это правильно?
   - `initialAssignments` useMemo deps только `photoUrls.length` + `part2_solutions` — если backend re-syncs assignment после regrade, useEffect setAssignments(initialAssignments) + setDirty(false) — это правильный sync pattern?
6. **AlertDialog finalize** — `Part1BlankReviewPanel` в `TutorMockExamReview.tsx`: открывает dialog с таблицей 20 KIM. State `confirmFinalizeOpen`. Цикл: click → setConfirmFinalizeOpen(true) → AlertDialog → confirm → finalize API + close. Cancel = close dialog без API. Корректно? `onOpenChange={setConfirmFinalizeOpen}` правильно соединён с overlay/Esc?
7. **Heatmap per-kim color derivation** — `MockExamHeatmap.tsx` HeatmapRow:
   - Часть 1: `part1Map.has(kim) ? part1Map.get(kim) ?? null : null` — если row exists с `earned_score=null`, рендерим как `null` (cell-empty) — это правильно? Или должно быть `0` для empty?
   - Часть 2: `tutor_score !== null` → real score; иначе `status='awaiting_review'` → 'draft' kind. Что если `tutor_score=null && status='tutor_approved'`? Это нереальный state? (tutor_approved обязан иметь score)
8. **Secondary score conversion** — `mockExamScaleEge2025.ts` теперь содержит точные 45 значений с 4ege.ru (red zone 1-7 → 5-32, threshold 8 → 36, max 45 → 100). Я show это только при `totalMax === 45` (variant1 ЕГЭ физика). Нет hardcoded zone check'ов в UI — это OK?

**P2 — code quality / nice-to-have:**

9. **TypeScript** — все `any` cast'ы? Все `unknown` validated? Тип `MockExamAttemptListItem.part1_answers?` optional — backward-compat с old backend response. ОК?
10. **Performance** — `HeatmapRow` mem'оизирован, `part1Map` / `part2Map` `useMemo` deps на arrays from props. Если parent re-renders с тем же `attempt` reference → maps re-create? Должны быть stable references.
11. **Dead code** — после chip replacement в `BulkPhotosAssignmentGallery` я удалил `Select` imports из `TutorMockExamReview.tsx` (grep confirmed 0 other usages в файле). Убедись, что ничего не сломано.
12. **Docs** — `tutor-improvements-spec.md` AC-T16-1..6 + `~/.claude/plans/wobbly-crafting-starlight.md` plan — соответствует ли реализация спеке?

## Формат ответа

Если найдёшь bug → формат:
```
**SEVERITY:** P0 / P1 / P2
**FINDING:** короткое название
**LOCATION:** file:line
**ROOT CAUSE:** что не так
**IMPACT:** что сломается в проде
**FIX:** конкретный код / refactor
```

Если всё ОК — скажи «APPROVED» + 2-3 предложения о том, что выглядит хорошо.

Особенно интересны (если найдёшь):
- Race conditions при concurrent tutor actions (multiple tabs, fast clicks)
- Anti-leak holes в `handleGetAssignment` SELECT
- Missing CAS guards
- iOS Safari quirks с новыми AlertDialog / chip grid
- TypeScript type weakening через optional props

Спасибо!
