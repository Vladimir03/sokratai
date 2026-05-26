# Feature Spec: Mock Exams v1 — Pilot Polish (Phase 1 P0)

**Версия:** v0.1
**Дата:** 2026-05-14
**Автор:** Vladimir Kamchatkin
**Статус:** draft

> Сборка корректирующих доработок по итогам Егор-feedback (созвон 2026-05-08) для раскатки пробников на 5 пилотных репетиторов по физике до выходных.
>
> **Не путать** с `mock-exams-v1/spec.md` (исходная Phase 1 фичи, AC-1..AC-8). Этот документ — корректирующий patch-релиз поверх. Все новые AC именуются `AC-P{N}` (Polish) чтобы не пересекаться.
>
> Все ссылки на «исходную спеку» = `docs/delivery/features/mock-exams-v1/spec.md`.
> Все ссылки на «исходные tasks» = `docs/delivery/features/mock-exams-v1/tasks.md`.

---

## 0. Job Context

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка |
|---|---|---|---|
| Репетитор (B2B) | R4: Сохранение контроля и качества при масштабировании | R4-2 (проверка результатов учеников), R4-3 (диагностика готовности к ЕГЭ) | job-graph.md#R4 |
| Школьник (B2C) | S2: Сдать ЕГЭ на максимальный балл | S2-1 (тренировка в реальных условиях экзамена) | job-graph.md#S2 |
| Родитель (B2C) | P1: Понимать прогресс ребёнка | P1-2 (видеть результат пробника) | job-graph.md#P1 |

### Wedge-связка

- **B2B-сегмент:** B2B-1 (репетитор физики ЕГЭ/ОГЭ, hourly rate 3-4k₽)
- **B2C-сегмент:** B2C-1 (выпускник 16-18 лет в подготовке к ЕГЭ)
- **Pilot impact:** прямой — без этих фиксов 5 репетиторов не смогут провести даже один полный цикл пробника со своим учеником. Все 8 P0-блокеров обнаружены при попытке Егора сделать smoke-test флоу.

---

## 1. Summary

Pilot polish — это набор из 8 корректирующих фиксов поверх mock-exams-v1, без которых 5 пилотных репетиторов по физике не смогут продуктивно тестировать пробники со своими учениками. Все фиксы вышли из одного feedback-цикла с Егором 2026-05-08; пять разных репетиторов по физике ждут раскатки.

Phase 1 (P0) расписана здесь и деплоится одним релизом. Phase 2 (P1) — 4 fast-follow задачи через 2-3 дня после Phase 1, описаны секцией ниже без детализации.

---

## 2. Problem

### Текущее поведение

После выкатки mock-exams-v1 (TASK-1..TASK-15 в исходной спеке) и Tier 1+2 polish (FIX-1..FIX-5) Егор провёл smoke-test флоу и обнаружил 8 блокеров:

1. **F1.** Ученик кликает на пробник в `/student/mock-exams` → видит «Assignment not found» (404 от `mock-exam-student-api/student/:id`).
2. **F2.** Ученик сдал работу → репетитор открывает `/tutor/mock-exams/:id` → KPI показывает «0 из 1, в процессе», не подтягивая фактически submitted attempt.
3. **F3.** Ученик пишет более точный ответ `0.216` чем в БД `correct_answer='0.2'` → авточекер возвращает `earned_score=0`.
4. **F4.** В `mockExamPart1Checker.ts` подсказки к ответу содержат «через запятую: 1,3,2» для check_mode'ов `ordered`/`unordered`/`multi_choice`, но на реальном ЕГЭ запятые запрещены.
5. **F5.** В заголовке `Part1TaskCard` и `Part2TaskCard` рядом с номером KIM рендерится `task.topic` (например «Динамика», «Закон Ньютона»), что является спойлером метода решения.
6. **F6.** При парсинге `Тр_вариант 1.docx` через docx pipeline единицы измерения, обычно вынесенные в конец условия задачи Часть 1 («Ответ дайте в микровольтах»), не были скопированы в `mock_exam_variant_tasks.task_text`.
7. **F7.** В задачах на соответствие (KIM 6, 17 в варианте 1, и аналогичные) исходные таблицы в docx превратились в плоский текст без структуры — ученик видит только «Установите соответствие. К каждой позиции из первого столбца...» без самих столбцов.
8. **F8.** В `PublicMockInvite.tsx` (route `/p/mock-invite/:slug`) есть копи, которая упоминает «одобрение Владимира» как промежуточный шаг между заполнением формы и началом пробника — лишний шаг, ломает first-impression потенциального лида.

### Боль

**F1, F2** — критические: цикл «назначить → пройти → проверить» физически не работает. Без них фича не доставляется до пользователя вообще.

**F3, F4, F5** — подрыв доверия к продукту: репетитор и ученик видят что AI/авточекер делает явные ошибки (ложные нули за корректный ответ, спойлер темы перед решением, обучение неверному формату ответа). Репетитор после первого такого случая выключает фичу.

**F6, F7** — невозможность решить задачу: задачи невозможно решить без понимания условия (единиц измерения / табличных данных). Создаёт массовые ложные «неправильные» ответы.

**F8** — конверсия лидов: public страница это первое впечатление родителя/потенциального ученика. Зашитый «ожидание одобрения» снижает funnel start.

### Текущие нанятые решения

Репетиторы сейчас:
- Проводят пробники в Google Docs / распечатанных PDF (вручную составляют) — обнаружение F6 и F7 даёт им повод вернуться к этому workaround.
- Проверяют Часть 1 вручную по эталону — F3 (округление) и F4 (запятые) демонстрируют что наша автоматика хуже их Excel-таблицы.

---

## 3. Solution

### Описание

8 P0-фиксов, разбитые на 4 логические группы по слою воздействия:

**Группа A: Routing & data sync** — `F1`, `F2`
**Группа B: Part 1 auto-check correctness** — `F3`, `F4`
**Группа C: Anti-spoiler & content visibility** — `F5`, `F6`, `F7`
**Группа D: Public lead-link UX** — `F8`

Каждая группа адресует один продуктовый инвариант:
- A → «работает базовый цикл студент-репетитор»
- B → «авточекер строже учителя, никаких ложных нулей»
- C → «ученик видит ровно то, что увидел бы на реальном ЕГЭ, и ничего сверх»
- D → «public flow без зашитой бюрократии»

### Ключевые решения

1. **F1 — defensive dual-path lookup в edge function (уже в работе).** Edge function `mock-exam-student-api` принимает `:id` параметр и пробует резолвить и как `assignment_id`, и как `attempt_id`. Не ломает existing contract, защищает от stale browser bundle / bookmarked URL.
2. **F2 — оптимистичный refresh tutor detail после student submit.** Backend (`handleSubmit` в `mock-exam-student-api`) уже корректно обновляет `mock_exam_attempts.status`. Проблема в frontend: `useMockExamAssignment` имеет `refetchOnWindowFocus: true`, но при reopen tab в WebKit/iOS Safari focus event может не сработать. Решение — добавить `refetchInterval` 30s **только** когда страница активна И есть attempts со статусом `submitted`/`ai_checking`/`awaiting_review`.
3. **F3 — численная толерантность в `mockExamPart1Checker.ts`.** Добавить новый helper `numericRoundingMatch(studentAnswer, correctAnswer)` для check_mode=`strict` когда оба значения парсятся как числа: если round(student, scale_of_correct) === correct, то PASS. Не трогать строковые check_mode'ы (multi_choice, ordered, etc.).
4. **F4 — переписать подсказки в `getAnswerHint`** из `StudentMockExam.tsx`. Убрать «через запятую» отовсюду; вместо этого «слитно: 132». Сохранить семантику ordered/unordered/multi_choice, только формат изменить.
5. **F5 — скрыть `task.topic` от ученика на public surface.** Tutor (TutorMockExamDetail) и preview drawer оставить как есть — там topic полезен. В `Part1TaskCard` и `Part2TaskCard` (student-side) удалить span с topic.
6. **F6, F7 — re-parse `Тр_вариант 1.docx` с фиксом единиц + табличных задач.** Edit `docs/delivery/features/mock-exams-v1/source/variant1-tasks.json` напрямую (это canonical source per rule №11), затем перегенерировать seed через `scripts/build-mock-exam-seed.py` и применить новую миграцию `20260514120000_resync_mock_exam_variant_1_content.sql` (DELETE + INSERT) или idempotent UPDATE из обновлённого seed.
7. **F8 — убрать «ожидание Vladimir» текст из `PublicMockInvite.tsx`.** Поменять на конкретный CTA «Готов начать» в стиле олимпиадного интерфейса. Сразу после `submit lead form` → `startPublicMockInvite` → переход на taking surface, без промежуточного экрана ожидания.

### Scope

**In scope (Phase 1, P0):**
- 8 фиксов F1-F8 как описаны выше
- 1 новая миграция (re-sync content variant 1)
- Update `variant1-tasks.json` (canonical source)
- Удалить unused `task.topic` строку из 2 student-side card'ов
- Update `mockExamPart1Checker.ts` (rounding helper + tests)
- Update `getAnswerHint` в `StudentMockExam.tsx`
- Update `PublicMockInvite.tsx` (UX flow)
- Update `useMockExamAssignment` (conditional refetchInterval)

**Out of scope (Phase 1):**
- Phase 2 fixes (F9-F12)
- Single-batch upload для Часть 2 (Егор откладывал сам)
- Перевод первичного → вторичный балл
- Tutor override балла Части 1
- Режим «в тетради»

**Later (Phase 2, fast-follow через 2-3 дня):**
- F9 — Дубли attempts при reassign (race condition в `handleCreateAssignment`)
- F10 — Унифицировать отображение времени (3 ч 55 мин vs 4 часа)
- F11 — Полная справочная шапка ЕГЭ в `ReferencesPanel`
- F12 — Mutually exclusive modes (text + behavior — сейчас в P0 фиксим только misleading copy в blank banner; полное разделение flow blank vs form — P1)

---

## 4. User Stories

### Репетитор

> Когда я назначил пробник своему ученику и ученик его прошёл, я хочу видеть его работу в кабинете без ручного refresh страницы, чтобы я мог сразу проверить Часть 2 и закрыть цикл — иначе я не могу выполнить свою core job R4-2.

> Когда я смотрю превью варианта, я хочу видеть `topic` (тему задачи) для tutor-side fit-check, но я хочу чтобы мой ученик НЕ видел `topic` — иначе пробник не симулирует реальный ЕГЭ.

### Школьник

> Когда я открываю пробник, я хочу чтобы он сразу открылся (не «Assignment not found»), чтобы я начал решать.

> Когда я пишу ответ `0.216` к задаче где «правильный» по учителю `0.2`, я хочу чтобы система засчитала его правильным, потому что мой ответ точнее и эквивалентен.

> Когда мне говорят какой формат ответа использовать, я хочу чтобы инструкции совпадали с инструкциями реального ЕГЭ (никаких запятых в задачах на соответствие), иначе я привыкну к неверному формату.

> Когда задача требует ответ в микровольтах, я хочу видеть «дайте ответ в микровольтах» в условии, иначе я не знаю в каких единицах отвечать.

> Когда задача — на соответствие, я хочу видеть таблицу с обоими столбцами, иначе я физически не могу решить.

### Родитель / потенциальный ученик (lead)

> Когда я открываю public пробник по ссылке от репетитора, я хочу что после заполнения формы началось прохождение, без зашитого «ожидания одобрения», иначе у меня нет причин верить что это всерьёз.

---

## 5. Technical Design

### Затрагиваемые файлы

**Frontend:**
- `src/pages/student/StudentMockExam.tsx` — переписать `getAnswerHint` (F4); убрать `topic` из `Part1TaskCard` + `Part2TaskCard` headers (F5)
- `src/pages/PublicMockInvite.tsx` — UX flow без «ожидания Владимира» (F8)
- `src/lib/mockExamPart1Checker.ts` — `numericRoundingMatch` helper для strict mode с numeric values (F3)
- `src/hooks/useMockExamAssignment.ts` — conditional `refetchInterval` 30s если есть attempts in `submitted`/`ai_checking`/`awaiting_review` (F2)

**Backend (edge functions):**
- `supabase/functions/mock-exam-student-api/index.ts` — defensive dual-path lookup (F1) — **уже частично сделано в текущей сессии**

**Data layer:**
- `docs/delivery/features/mock-exams-v1/source/variant1-tasks.json` — добавить единицы измерения в task_text для Часть 1 (F6); восстановить markdown-таблицы для задач на соответствие (F7)
- `supabase/seed/mock_exams_variant_1.sql` — регенерация из обновлённого variant1-tasks.json
- `supabase/migrations/20260514120000_resync_mock_exam_variant_1_content.sql` — idempotent `UPDATE mock_exam_variant_tasks SET task_text=... WHERE id=...` для всех 26 задач (тот же uuid5 namespace, новые тексты)

### Data Model

Без изменений schema. Только data update в существующих таблицах.

### API

Без новых endpoint'ов. F1 — bugfix existing handler. F2 — frontend refetch behavior.

### Миграции

`supabase/migrations/20260514120000_resync_mock_exam_variant_1_content.sql`:
- UPDATE `mock_exam_variant_tasks.task_text` для всех 26 задач variant_id=`36cebc45-e2e8-5603-a753-01c818bba131`
- UPDATE `correct_answer` если автор-парсер ошибся в задачах с запятыми
- Idempotent: использует `ON CONFLICT (id) DO UPDATE` НЕТ — UPDATE не нуждается в conflict resolution; вместо этого условие `WHERE id IN (...)`

### Auto-check rounding logic (F3)

В `mockExamPart1Checker.ts`:

```typescript
/**
 * Если оба значения парсятся как числа И correct имеет конечное количество
 * значащих знаков → student PASS если round(student, scale_of_correct) === correct.
 *
 * Примеры:
 *   correct='0.2', student='0.216' → round(0.216, 1) = 0.2 ✓ PASS
 *   correct='12.5', student='12.456' → round(12.456, 1) = 12.5 ✓ PASS
 *   correct='5', student='5.0001' → round(5.0001, 0) = 5 ✓ PASS
 *   correct='5', student='5.5' → round(5.5, 0) = 6 ✗ FAIL
 *   correct='0.2', student='0.3' → round(0.3, 1) = 0.3 ✗ FAIL
 *
 * Применяется ТОЛЬКО для check_mode='strict' и только когда оба парсятся
 * как finite numbers. Строковые check_mode'ы (multi_choice, ordered, pair)
 * не трогаются.
 */
function numericRoundingMatch(student: string, correct: string): boolean | null;
// returns: true (match), false (mismatch), null (не numeric — caller fallback на строковое сравнение)
```

---

## 6. UX / UI

### Wireframe / Mockup

Без изменений visual design. Только text changes + удаление визуальных элементов:
- `task.topic` chip убран из card headers (student-side)
- `getAnswerHint` text меняется (текстовая подсказка справа от input)
- `PublicMockInvite` post-submit screen меняется (CTA «Готов начать» вместо ожидания)
- В `BlankModeBanner` убрать строку «и параллельно вводи ответы Части 1 в форму» (часть F12 P1, но в P0 включаем 5-минутный copy fix)

### UX-принципы (из doc 16)

- **«Нет лишних слоёв между намерением и результатом»** — F8 (убрать ожидание), F1 (открыть пробник = открыть пробник, без 404)
- **«AI как drafter, не editor»** — F3 (авточекер строже учителя), F5 (не подсказывать тему)
- **«Реальные условия экзамена»** — F4 (формат ответа = ЕГЭ), F5 (никакого topic), F6 (единицы измерения), F7 (таблицы)

### UI-паттерны (из doc 17)

- Lucide icons only, без emoji
- shadcn Card / Badge / Input
- `text-base` 16px на all student-facing inputs (iOS Safari auto-zoom)
- Mobile-responsive

---

## 7. Validation

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

### Acceptance Criteria (testable, P0)

- **AC-P1 (F1):** Tutor назначает пробник ученику `kamchatkin.va@phystech.edu`. Ученик логинится, открывает `/student/mock-exams`, кликает на карточку → taking page открывается, видны 26 задач. **Не** «Assignment not found».
- **AC-P2 (F2):** Ученик нажимает «Сдать работу» → reptizor на той же странице `/tutor/mock-exams/:id` (без manual refresh) в течение 60 секунд видит KPI «Сдали: 1 из 1» и attempt в heatmap со статусом «Требует AI-проверки».
- **AC-P3 (F3):** Вставляем в БД задачу с `correct_answer='0.2'`. Ученик отвечает `0.216` → submit → `mock_exam_attempt_part1_answers.earned_score = max_score`. Если ученик отвечает `0.3` → `earned_score = 0`.
- **AC-P4 (F4):** На task с `check_mode='ordered'` подсказка справа от input содержит «слитно: 132» (или эквивалент). Слова «через запятую» нет ни на одной задаче во всём пробнике.
- **AC-P5 (F5):** В `Part1TaskCard` и `Part2TaskCard` headers (student-side `/student/mock-exams/:id`) не виден текст с темой задачи (`task.topic`). На tutor-side (превью drawer и detail page) — `task.topic` виден.
- **AC-P6 (F6):** ✅ Landed 2026-05-14 (TASK-6). В 9 задачах Часть 1 (KIM 1, 2, 3, 4, 7, 8, 11, 12, 13) с численным ответом в физических единицах в конце `task_text` явно указано «Ответ дайте в [метрах/ньютонах/литрах/джоулях/амперах/миллиджоулях/микросекундах/ньютонах на метр].» — источник истины: оригинальный docx Егора, где «Ответ: ___ X» строка стояла отдельным параграфом и не была подхвачена парсером. Перевыполнено vs «5 задач» в требовании.
- **AC-P7 (F7):** ✅ Landed 2026-05-14 (TASK-6). В KIM 6, 10, 15, 17 (все 4 задачи на соответствие в варианте 1) `task_text` содержит markdown-таблицу 2 столбца с заголовками «Физические величины | Их изменения», А/Б слева и 1/2/3 справа. Финальная инструкция совместима с TASK-4 invariant «слитно, не запятой». `MathBlock` в `StudentMockExam.tsx` детектит GFM-table regex и lazy-loadит `MarkdownTaskText` через `react-markdown + remark-gfm + remark-math + rehype-katex` (новый chunk 1.53 KB / 0.69 KB gz; deps уже общие с `miniapp/RichContent.tsx`).
- **AC-P8a (F8 — authenticated lead):** ✅ Landed 2026-05-14 (TASK-7). Authenticated ученик открывает `/p/mock-invite/:slug`, заполняет имя+Telegram+consent, submit → confirm dialog «Готов начать? 4 часа» → клик «Готов начать» → navigate на `/student/mock-exams/:assignment_id` → первая задача видна. Нет промежуточного экрана «ожидайте одобрения Vladimir». **«1 клик после submit + confirm»** — confirm dialog как explicit start gate (олимпиадный UX, не approval gate), не дополнительная задержка.
- **AC-P8b (F8 — anonymous lead):** ❌ **Deferred to TASK-12 (anonymous mode), вне scope pilot-polish.** Anonymous incognito пользователь после submit+confirm упирается в `AuthGuard` на `/student/mock-exams/:id` → редирект на login → returns flow прерывается. Документировано как known limitation в TASK-7 done-блоке (commit 84a4621). Pre-polish review (Codex, 2026-05-14) подтвердил FAIL для anonymous path; решение product team: оставить deferred до отдельной спеки TASK-12. Wedge P1-2 (lead-gen для репетитора) пилот закрывает через authenticated path — репетитор отправляет invite уже зарегистрированному ученику; full anonymous funnel — Phase 2.

- **AC-P9 (Часть 1 partial credit ФИПИ 2026):** ✅ Landed 2026-05-25. Авточекер Часть 1 для multi_choice (KIM 5/9/14/18) и ordered (KIM 6/10/15/17) задач **поддерживает 1 балл из 2** по официальным критериям ФИПИ 2026:
  - **multi_choice (KIM 5/9/14/18):** «1 лишняя цифра / 1 недостающая / 1 неверная» → 1 балл. 2+ ошибки → 0. Set-based error counting через новый helper `gradeMultiChoice(correct, student, maxScore)`. Реализация: `src/lib/mockExamPart1Checker.ts` + Deno mirror `supabase/functions/_shared/mock-exam-part1-checker.ts`.
  - **ordered (KIM 6/10/15/17):** «на одной позиции неверный символ» → 1 балл. 2+ позиции неверны → 0. Length mismatch (ученик ввёл 3 цифры вместо 2) → 0 баллов (ФИПИ explicit «больше требуемого — 0»). Hamming distance через `gradeOrdered(correct, student, maxScore)`.
  - **Автоматически работает для всех новых submitted attempts** после deploy (form mode `handleSubmitAttempt` + blank mode `runPart1OCR` оба используют обновлённый Deno mirror).
  - **Существующие pilot attempts (Егор)** — НЕ пересчитываются автоматически (tutor-controlled UX choice 2026-05-25). Tutor использует новую кнопку **«По критериям ФИПИ»** в `Part1BlankReviewPanel` header → AlertDialog confirm → backend endpoint `POST /attempts/:id/recheck-part1` → пересчитывает `score_source IN ('ocr', 'student_form', 'finalize_default')` rows, preserves `score_source='tutor'` ручные правки.
  - **Student UX:** на `StudentMockExamResult` Part1 table для partial state — amber `Check` icon (Lucide) + `Tooltip` («N балл из max — одна ошибка по критериям ФИПИ 2026»). Дробь `1/2` в Балл column рендерится amber-700 font-semibold. Existing emerald ✓ (full) и rose ✗ (zero) не тронуты.
  - **Тесты (18 новых AC-P9 cases в `scripts/test-mockexam-checker.mjs`):** full / partial substitution / partial extra / partial missing / 2+ errors / edge cases / Егор pilot screenshot reproductions / guardrails (gradeOrdered ≠ gradeMultiChoice для "21") / dispatch / backward compat (старые `checkMultiChoice` / `checkOrdered` boolean helpers сохранены).
  - **Остальные режимы** (strict, unordered, task20, pair, manual) — **остаются binary** (0 или maxScore). ФИПИ 2026 partial credit определён ТОЛЬКО для multi_choice + ordered.
  - **Спека деталей:** CLAUDE.md §15a → секция «Часть 1 partial credit ФИПИ 2026».

- **AC-P10 (Pause & multi-session timer):** ✅ Phase 1 MVP landed 2026-05-25. JTBD-trigger (Володя 2026-05-25 от учеников): «не могу найти 4 часа подряд для пробника». Pilot adoption blocker — ученики 16-18 имеют фрагментированный график и не садятся на 4ч сразу. Решение: 2 режима + pause/resume + per-session timing.
  - **Два режима** в `mock_exam_attempts.exam_mode`:
    - **`'simulation'`** — wall-clock timer 4ч без pause (реальный ЕГЭ). Закрыл tab → таймер идёт.
    - **`'training'` (default)** — active time only + pause/resume. Multi-session: ученик может прервать, вернуться через неделю, продолжить с остатка.
  - **Schema** (migration `20260525130000_attempt_pause_and_sessions.sql`):
    - `mock_exam_attempts.exam_mode TEXT CHECK IN ('simulation','training')` DEFAULT 'training'
    - `mock_exam_attempts.sessions JSONB` array of `{started_at, ended_at|null}`
    - `mock_exam_attempts.total_active_ms BIGINT` cached sum
    - `mock_exam_attempts.status` enum extended: + `'paused'`
    - `mock_exam_assignments.default_exam_mode TEXT` DEFAULT 'training' (tutor recommendation)
  - **Endpoints** (`mock-exam-student-api`):
    - `POST /attempts/:id/pause` — close latest session, status → 'paused'. Mode guard: только training. Idempotent.
    - `POST /attempts/:id/resume` — append new active session, status → 'in_progress'. Idempotent.
    - `POST /attempts/:id/start` — расширен `{exam_mode?}` body, init first session, applies override only при первом start.
    - `POST /attempts/:id/submit` — расширен на close last open session + write final `total_active_ms`. Accepts prev status `in_progress|paused`.
  - **Student UX** (Phase 1):
    - `StudentMockExam` шапка: amber Pause button (только training mode) + confirm dialog с explanation. После confirm → redirect на /student/mock-exams.
    - `StudentMockExams` list card: «⏸ На паузе» badge + «осталось 2ч 34 мин» (compute из `total_active_ms` + `duration_minutes`). Click card → resume API → navigate на taking page.
    - paused attempts всегда redirect'ятся на list (никогда не render'ятся в taking surface без resume).
  - **Tutor UX** (Phase 1 minimal):
    - `MockExamHeatmap` status badge для paused student: «⏸ На паузе» (amber).
    - Phase 2 (deferred): start modal с tutor recommendation, TutorMockExamCreate toggle, Tutor review per-session details.
  - **Hard invariants:**
    - `exam_mode` immutable после первого start. Backend rejects override если sessions != [] OR started_at != null.
    - Pause only в `training` mode. Simulation rejects → 400 PAUSE_NOT_ALLOWED.
    - CAS guards: pause требует status='in_progress'; resume требует 'paused'. Multi-tab safety.
    - Submit accepts both 'in_progress' и 'paused' prev status (ученик может сдать paused без явного resume).
    - Backward compat: existing pilot attempts получают exam_mode='training' default (миграция). Pause functionality становится доступна post-deploy.
  - **Phase 2 follow-ups** (next session): tutor create toggle (`default_exam_mode`), student start modal (mode picker с override), tutor review per-session breakdown («Solo time: 2:30 в 3 сессии: 50+30+70»), KPI «На паузе» card в TutorMockExamDetail.
  - **Hotfix** (commit `5b9fc52`, 2026-05-25 после ChatGPT-5.5 code review):
    - **P0 #1 — Legacy attempts cannot pause:** miграция `20260525140000_attempt_sessions_backfill.sql` инициализирует sessions для existing in_progress attempts (sessions=[] + started_at IS NOT NULL → init open session). Plus defensive synthesis в handlePauseAttempt belt-and-suspenders.
    - **P0 #2 — Timer wall-clock instead of active time:** `handleGetStudentAssignment` теперь возвращает exam_mode/sessions/total_active_ms; new `getActiveElapsedSeconds` helper в `StudentMockExam.tsx` (simulation=wall-clock, training=sum sessions + open offset); auto-submit через fire-once `onTimeExpired` callback.
    - **P2 #1 — Resume failure silent navigate:** `StudentMockExams` resume disabled card during pending + inline rose error + multi-click protected.
  - **Deferred (P1):**
    - **P1 #1 (CAS guards verification):** downgraded P2, pilot scale acceptable.
    - **P1 #2 (recheck no-ops на pilot data из-за score_source='tutor' backfill в `20260516130000`):** требует Володя UX decision — `include_tutor_edits: boolean` checkbox в existing AlertDialog (recommended) vs auto-detection vs two-buttons. Без fix кнопка «По критериям ФИПИ» бесполезна для существующих pilot attempts Егора.
  - **Спека деталей:** CLAUDE.md §15a → секция «Pause & multi-session timer» + «Hotfix».

### Связь с pilot KPI

Из `docs/discovery/product/tutor-ai-agents/18-pilot-execution-playbook-sokrat.md`:
- **Неделя 1 KPI «вернулись ли»**: F1+F2 напрямую — без них репетитор не вернётся после неудачного теста
- **Неделя 1 KPI «первый самостоятельный цикл»**: F1-F8 в сумме — это и есть definition of «цикл»
- **Неделя 2 KPI «точка входа»**: F8 (lead-link) — единственный механизм organic acquisition

### Метрики

**Leading (3-7 дней после деплоя):**
- ≥4 из 5 пилотных репетиторов назначают пробник хотя бы 1 ученику
- ≥80% назначенных пробников открываются учеником (нет 404)
- 0 ложных нулей в Часть 1 из-за округления (по telemetry `mock_exam_part1_grade_event`)

**Lagging (2-4 недели):**
- ≥3 из 5 репетиторов выдают ≥2 пробника в неделю на 2-й неделе пилота
- ≥1 lead через public link конвертируется в платящего ученика хотя бы у 1 репетитора

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| F6/F7 re-parse может сломать корректность других задач варианта 1 | Средняя | Не trigger full regen pipeline, точечно править variant1-tasks.json + 1 SQL UPDATE на конкретные task_id; запускать `scripts/build-mock-exam-seed.py` локально + diff проверка |
| F3 rounding tolerance может ложно засчитать неверный ответ (false positive) | Низкая | Применяем ТОЛЬКО для check_mode='strict' где correct это finite number; round по scale_of_correct (не более), не округлять студента шире чем учителя |
| F2 polling каждые 30s → нагрузка | Низкая | Применять conditional — polling активен пока есть attempts в `in_progress`/`submitted`/`ai_checking`/`awaiting_review`; останавливать polling когда status terminal (`approved`/`manually_entered`). **Review fix 2026-05-14:** `in_progress` добавлен в polling statuses — без него tutor открывший страницу пока ученик ещё пишет работу не увидел бы submit'а до window-focus (Codex review FAIL на AC-P2). |
| F8 «Готов начать» без подтверждения — ученик начнёт случайно и истратит 4ч таймер | Низкая | Сохранить confirm dialog «Тебе будет дано 4 часа. Готов начать?» — это **не** «ожидание Владимира», это олимпиадный confirm. Различие: один self-serve клик ученика vs внешний approval gate |

### Открытые вопросы

| Вопрос | Кто решает | Блокирует старт? |
|---|---|---|
| Нужен ли feature flag для F3 rounding tolerance (могут быть кейсы где tutor хочет строгое сравнение)? | product (Vladimir) | нет — default ON, в P2 можем добавить per-task `strict_match` toggle |
| F7 markdown tables — рендерим через MathText (KaTeX не делает таблицы) или через ReactMarkdown? | engineering | нет — текущий MathText уже использует ReactMarkdown с remarkMath, таблицы работают через `remark-gfm` если включить |
| F6 единицы — добавлять как trailing sentence «Ответ дайте в …» или как metadata-field на task? | product | нет — sentence в task_text (минимум миграция, максимум читаемость для AI) |
| F8 anonymous lead — full anonymous taking surface (TASK-12) или authenticated-only пилот? | product (Vladimir) | resolved 2026-05-14: pilot-polish закрывает только AC-P8a (authenticated). AC-P8b deferred к TASK-12 anonymous mode — отдельная спека после первых результатов пилота. Wedge P1-2 закрывается через invite уже зарегистрированному ученику. |

### Pre-merge code review (Codex, 2026-05-14)

| AC | Verdict | Действие |
|---|---|---|
| AC-P1 (assignment lookup) | PASS | — |
| AC-P2 (polling) | FAIL → fixed | `in_progress` добавлен в `POLLING_ATTEMPT_STATUSES` ([useMockExamAssignment.ts:35](../../../../src/hooks/useMockExamAssignment.ts:35)) |
| AC-P3 (rounding) | PASS | — |
| AC-P4 (hints без запятых) | PASS | — |
| AC-P5 (topic скрыт на taking page) | PASS | taking page only; result page `solution.topic` намеренно whitelist'нут (см. CLAUDE.md §15 state-aware reveal) |
| AC-P6 (единицы) | PASS | 9 KIMs |
| AC-P7 (matching tables) | PASS | KIM 6/10/15/17 |
| AC-P8a (authenticated lead) | PASS | landed TASK-7 |
| AC-P8b (anonymous lead) | DEFERRED | TASK-12 anonymous mode, отдельная спека |
| AC-P9 (Часть 1 partial credit ФИПИ 2026) | PASS | landed 2026-05-25 (FIPI-1..FIPI-8). 32 unit tests pass (18 новых AC-P9). См. CLAUDE.md §15a. |
| AC-P10 (Pause & multi-session timer, Phase 1 MVP) | PARTIAL → REQUEST CHANGES → APPROVED (hotfix `5b9fc52`) | Phase 1 landed 2026-05-25 commit `2e8ad41` + hotfix `5b9fc52` после ChatGPT-5.5 code review (2 P0 + 1 P2 fixed; 2 P1 deferred). Phase 2 (start modal + tutor create toggle + per-session details) отложен. См. CLAUDE.md §15a секции «Pause & multi-session timer» + «Hotfix». |

**Не-AC обнаружения** (false positives, документация добавлена):
- «solution_text leak на result page» — это **намеренный state-aware reveal**, не нарушение. Result page показывает Часть 2 разбор только после `attempt.status === 'approved'` (CLAUDE.md §15). Mock-exams anti-leak ≠ homework tutor-only invariant — это разные semantic'и (см. CLAUDE.md §10 cross-reference, добавлено 2026-05-14).

---

## 9. Implementation Tasks

> Переносятся в `mock-exams-v1-pilot-polish/tasks.md` после approve спека.

**Phase 1 (P0) — деплой одним релизом:**

- [ ] TASK-1 (F1): Defensive dual-path lookup в `mock-exam-student-api` (**частично сделано** в текущей сессии — нужно verify deploy + smoke)
- [ ] TASK-2 (F2): Conditional refetchInterval в `useMockExamAssignment` — 30s polling когда есть non-terminal attempts
- [ ] TASK-3 (F3): `numericRoundingMatch` helper + интеграция в `mockExamPart1Checker.ts` для strict mode, юнит-тесты на 6 кейсов (PASS/FAIL combinations)
- [ ] TASK-4 (F4): Переписать `getAnswerHint` — слитный формат вместо «через запятую» для ordered/unordered/multi_choice. Доп. проверить `BlankModeBanner` на упоминания запятых
- [ ] TASK-5 (F5): Удалить `task.topic` chip из `Part1TaskCard` и `Part2TaskCard` (student-side). Tutor-side не трогать
- [x] TASK-6 (F6+F7) ✅ Done 2026-05-14: `variant1-tasks.json` обновлён (9 unit-suffix + 4 markdown-table для KIM 1-4, 6-8, 10-13, 15, 17); seed регенерирован детерминированно (UUIDs unchanged); миграция `20260514120000_resync_mock_exam_variant_1_content.sql` — 13 idempotent UPDATE'ов by `id` без `updated_at` (колонки нет). `MathBlock` в `StudentMockExam.tsx` детектит GFM-table → lazy-loadит `MarkdownTaskText` через react-markdown + remark-gfm. Новый chunk 1.53 KB / 0.69 KB gz. Pipeline parity: `build-mock-exam-seed.py` теперь hardcode'ит `EGOR_UUID` (фикс drift между script и manual-edit seed).
- [ ] TASK-7 (F8): `PublicMockInvite.tsx` UX flow — убрать промежуточный экран «ожидания», заменить на confirm dialog «Готов начать? 4 часа» → сразу startPublicMockInvite + navigate на taking page
- [ ] TASK-8: Smoke test полного flow одним пилотным репетитором (`egor.o.blinov@gmail.com`) и одним учеником (`kamchatkin.va@phystech.edu`) — проверить AC-P1..AC-P8

**Phase 2 (P1, fast-follow через 2-3 дня) — отдельный релиз:**

- TASK-9 (F9): Race condition в `handleCreateAssignment` — UNIQUE constraint `(assignment_id, student_id)` на `mock_exam_attempts` + ON CONFLICT DO NOTHING
- TASK-10 (F10): Унифицировать форматирование времени — все «4 часа» / «3:55» / «235 минут» через одну функцию `formatExamDuration(minutes)`
- TASK-11 (F11): Расширить `ReferencesPanel` — полная справочная шапка ЕГЭ (константы + таблица плотностей + удельные теплоёмкости + молярные массы). Контент брать из официального бланка
- TASK-12 (F12 behavior): Разделить blank vs form flow физически — в blank режиме `getStudentMockExam` НЕ возвращает Part 1 input form; в form режиме скрыть upload bank photo

---

## Parking Lot

Идеи, всплывшие при написании спеки, не входящие в Phase 1/Phase 2:

- **Per-task feature flag `strict_match`** — для случаев когда репетитор хочет жёстко сравнивать числовой ответ (например, экзаменационная задача требует именно `0.2`, не `0.216`). Revisit: после первой обратной связи на F3, если будет жалоба от какого-либо репетитора
- **AI explainability на Часть 1** — после авточекера показать ученику разбор каждой ошибки (объяснение почему 0.216 != 0.2 если бы flag был жёсткий, или почему ordered ответ должен быть в правильной последовательности). Revisit: Phase 3, когда стабилизируем core flow
- **Telemetry для F3 rounding cases** — события `mock_exam_part1_rounded_match` с `student_answer`, `correct_answer`, `scale_difference` — чтобы видеть как часто срабатывает толерантность и не ложно ли она помогает. Revisit: добавить в TASK-3 если low effort
- **Параметризация duration_minutes** — сейчас 235 минут хардкод (ЕГЭ физика). Когда выкатим ОГЭ (180 минут) или предметы где время другое — переход на `mock_exam_variants.duration_minutes` (уже есть колонка, просто использовать). Revisit: при добавлении 2-го предмета

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0)
- [x] Привязка к Core Jobs из Графа работ (R4, S2, P1)
- [x] Scope чётко определён (in/out/later)
- [x] UX-принципы из doc 16 учтены
- [x] UI-паттерны из doc 17 учтены
- [x] Pilot impact описан (5 репетиторов ждут)
- [x] Метрики успеха определены (leading + lagging)
- [x] High-risk файлы НЕ затрагиваются (AuthGuard, TutorGuard, Chat.tsx — нетронуты)
- [x] Student/Tutor изоляция не нарушена (F5 строго student-side только)
- [x] Все 8 P0 имеют testable AC
- [x] Parking Lot заполнен
