# Tasks: Mock Exams v1 — Pilot Polish (Phase 1 P0)

**Спека:** `docs/delivery/features/mock-exams-v1-pilot-polish/spec.md` v0.1
**Дата:** 2026-05-14
**Цель:** 8 P0 фиксов, готовых к деплою одним релизом для раскатки на 5 пилотных репетиторов по физике.

---

## Обзор задач

| # | Название | Job | Agent | Файлы | AC | Effort | Зависит от |
|---|---|---|---|---|---|---|---|
| 1 | Defensive dual-path lookup в `mock-exam-student-api` | R4, S2 | Claude Code | `supabase/functions/mock-exam-student-api/index.ts`, `src/pages/student/StudentMockExams.tsx` | AC-P1 | S | — (частично сделано) |
| 2 | Conditional polling в `useMockExamAssignment` ✅ Done | R4-2 | Claude Code | `src/hooks/useMockExamAssignment.ts` | AC-P2 | S | — |
| 3 | Numeric rounding tolerance в авточекере Часть 1 | S2-1, R4-2 | Claude Code | `src/lib/mockExamPart1Checker.ts`, `src/lib/__tests__/mockExamPart1Checker.test.ts` | AC-P3 | M | — |
| 4 | Подсказки без запятых на student-side | S2-1 | Claude Code | `src/pages/student/StudentMockExam.tsx` | AC-P4 | S | — |
| 5 | Скрыть `task.topic` на student-side card'ах | S2-1, R4-3 | Claude Code | `src/pages/student/StudentMockExam.tsx` | AC-P5 | XS | — |
| 6 | Re-sync variant 1: единицы + таблицы | R4-3, S2-1 | Claude Code | `docs/delivery/features/mock-exams-v1/source/variant1-tasks.json`, `supabase/seed/mock_exams_variant_1.sql`, `supabase/migrations/20260514120000_resync_mock_exam_variant_1_content.sql` | AC-P6, AC-P7 | M | — |
| 7 | PublicMockInvite UX без «ожидания Vladimir» ✅ Done | P1-2 (lead-gen) | Claude Code | `src/pages/PublicMockInvite.tsx` | AC-P8 | S | — |
| 8 | Smoke test полного flow | All | Vladimir manual | — | AC-P1..AC-P8 | S | TASK-1..TASK-7 |
| 9 | Codex review всего релиза | All | Codex | — | All | S | TASK-1..TASK-7 |

**Порядок исполнения:** TASK-1..TASK-7 параллельно (независимы). После каждого — `npm run lint && npm run build && npm run smoke-check`. После всех вместе — TASK-8 (smoke) → TASK-9 (Codex review) → merge → deploy.

---

## TASK-1: Defensive dual-path lookup в `mock-exam-student-api`

**Job:** R4-2 (репетитор видит результаты), S2-1 (ученик открывает пробник)
**Agent:** Claude Code
**Files:** `supabase/functions/mock-exam-student-api/index.ts`, `src/pages/student/StudentMockExams.tsx`
**AC:** AC-P1
**Status:** **Частично сделано** в сессии 2026-05-14. Нужна верификация deploy + smoke.

### Контекст

URL `/student/mock-exams/:id` принимает в `:id` либо `assignment_id` (primary contract), либо `attempt_id` (legacy stale frontend bundle). Edge function `mock-exam-student-api::handleGetStudentAssignment` сначала пробует `assignment_id`, затем `id` — оба пути проверяют `student_id = auth.uid()`. Аналогично в `handleGetResult`.

Frontend `StudentMockExams.tsx::handleClick` навигирует с `row.assignment_id` (fallback на `row.id` + `console.error` если отсутствует).

### Что нужно сделать

1. Проверить что defensive lookup уже в коде:
   - `supabase/functions/mock-exam-student-api/index.ts::handleGetStudentAssignment` — две попытки lookup, `attempt.assignment_id` используется для downstream queries
   - `supabase/functions/mock-exam-student-api/index.ts::handleGetResult` — то же
   - `src/pages/student/StudentMockExams.tsx::handleClick` — навигация через `row.assignment_id`
2. Убедиться что 404 message русифицирован: «Пробник не найден или не назначен этому ученику»
3. Проверить что `passed_id` echoed в `error.details` для диагностики
4. Verify deploy на Lovable Cloud (edge function) + `deploy-sokratai` для frontend
5. Smoke от ученика `kamchatkin.va@phystech.edu`: открыть `/student/mock-exams`, кликнуть Тренировочный 1 → должна открыться taking page

### Acceptance Criteria

- AC-P1: Кликнуть на пробник в списке `/student/mock-exams` → taking page открывается, видны 26 задач, статус НЕ «Assignment not found»

### Guardrails

- Не менять auth/RLS логику
- Не удалять existing primary path (`assignment_id` lookup) — fallback в дополнение
- Не leak'ать чужие attempts: ownership check `student_id = auth.uid()` обязателен в обоих путях

---

## TASK-2: Conditional polling в `useMockExamAssignment` ✅ Done 2026-05-14

**Job:** R4-2 (репетитор видит фактические submitted работы)
**Agent:** Claude Code
**Files (landed):**
- `src/hooks/useMockExamAssignment.ts` — extracted `POLLING_ATTEMPT_STATUSES: ReadonlySet<MockExamAttemptStatus>` ({submitted, ai_checking, awaiting_review}) + helper `hasPollingActiveAttempts(detail)`; conditional `refetchInterval` callback returns `30_000` ms когда non-terminal attempts present, иначе fallback на существующий `getTutorBackgroundRefetchInterval`; добавлен debug `useEffect` с ref-sentinel `wasPollingActiveRef` для one-shot `console.info('[mock-exam-detail-polling] active=true', { assignment_id, awaiting_count })` лога при OFF→ON transition. Сохранены: queryKey, staleTime, gcTime, retry, retryDelay, refetchOnWindowFocus, refetchOnReconnect.

**Validation:** lint clean · tsc clean · UI-preview verification skipped (observation требует real submitted attempt в БД + 30s wait + DevTools network panel — не воспроизводимо в чистом preview без seeded data).

**AC:** AC-P2 — ✅ verified through code path. Polling activates на data-driven predicate; terminal statuses (approved/manually_entered/in_progress) → polling OFF.

### Контекст

После того как ученик нажал «Сдать работу», репетитор на `/tutor/mock-exams/:id` должен увидеть submitted attempt без manual page refresh. Сейчас `useMockExamAssignment` имеет `refetchOnWindowFocus: true` + `refetchOnReconnect: true`, но в WebKit/iOS Safari focus event может не сработать при switch tab внутри одного браузера.

Решение: добавить **conditional** `refetchInterval` 30s — активен **только** когда есть хотя бы один attempt в non-terminal статусе (`submitted` / `ai_checking` / `awaiting_review`). Когда все attempts стали terminal (`approved` / `manually_entered` / `in_progress` + started_at=null), polling выключается.

### Что нужно сделать

1. В `useMockExamAssignment.ts` расширить `refetchInterval` функцию:
   - Возвращать 30_000 ms если `currentQuery.state.data.attempts.some(a => ['submitted', 'ai_checking', 'awaiting_review'].includes(a.status))`
   - Иначе возвращать существующее значение из `getTutorBackgroundRefetchInterval(hasData, hasError)`
2. Не трогать другие настройки query (staleTime, retry, etc.)
3. Telemetry (опционально): `console.info('[mock-exam-detail-polling]', { active: bool, attempts_count })` при изменении статуса polling

### Acceptance Criteria

- AC-P2: ученик submits, репетитор НЕ refresh'ит страницу → в течение 60s видит обновление KPI и heatmap

### Guardrails

- Не делать polling unconditional — нагрузка на edge function
- Терминальные статусы (`approved`, `manually_entered`) → polling OFF
- Если `data` ещё не загружена (initial state) — polling OFF, обычный fetch

---

## TASK-3: Numeric rounding tolerance в авточекере Часть 1 ✅ Done 2026-05-14

**Job:** S2-1 (ученик не теряет баллы за корректный точный ответ), R4-2 (репетитор доверяет авточекеру)
**Agent:** Claude Code
**Files (landed):**
- `src/lib/mockExamPart1Checker.ts` — `countDecimals` (private) + `numericRoundingMatch` (export) + integration в `checkPart1Answer` strict branch + optional `kimNumber` в `CheckPart1Input`
- `supabase/functions/mock-exam-student-api/index.ts` — Deno-mirror (`countDecimals` + `numericRoundingMatch` + intergration в `checkPart1` strict branch) + `handleSubmitAttempt` пробрасывает `task.kim_number` в checker
- `scripts/test-mockexam-checker.mjs` — 3 новых suite (14 тестов всего, +3 от baseline 11)

**Pragmatic deviation от текста спеки:** unit-tests добавлены в существующий `scripts/test-mockexam-checker.mjs` (node:test + esbuild) — canonical test infrastructure для модуля, явно ссылающаяся из шапки [mockExamPart1Checker.ts:7](../../../src/lib/mockExamPart1Checker.ts). Создание `src/lib/__tests__/*.test.ts` с vitest/jest синтаксисом было бы dead code (runner не установлен; `npm test` → `smoke-check`).

**Validation:** 14/14 tests pass · lint clean на изменённых файлах · build green · smoke-check green.

**AC:** AC-P3 — ✅ verified through unit tests

### Контекст

Авточекер сейчас делает строковое сравнение `student.trim() === correct.trim()`. Кейс из feedback Егора 2026-05-08: правильный ответ `0.2`, ученик ввёл `0.216` (более точный, в рамках same физического ответа) → авточекер возвращает 0 баллов. Это создаёт false negatives и подрывает доверие.

Правило: для `check_mode='strict'` когда оба парсятся как finite numbers — round student answer до scale of correct answer, сравнить. Если совпадает → PASS.

### Что нужно сделать

1. Добавить helper в `mockExamPart1Checker.ts`:

```typescript
/**
 * Numeric rounding tolerance:
 * - returns null если хотя бы один не парсится как finite number (caller fallback на строковое сравнение)
 * - returns true если round(student, scaleOfCorrect) === correct
 * - returns false если round не совпадает
 *
 * scale = количество знаков после запятой в correct. Для целых = 0.
 */
function numericRoundingMatch(student: string, correct: string): boolean | null {
  const s = parseFloat(student.trim().replace(',', '.'));
  const c = parseFloat(correct.trim().replace(',', '.'));
  if (!Number.isFinite(s) || !Number.isFinite(c)) return null;

  const dotIdx = correct.indexOf('.') >= 0 ? correct.indexOf('.') : correct.indexOf(',');
  const scale = dotIdx === -1 ? 0 : correct.length - dotIdx - 1;
  const factor = Math.pow(10, scale);
  const rounded = Math.round(s * factor) / factor;
  return Math.abs(rounded - c) < 1e-9;
}
```

2. Интегрировать в `check_mode='strict'` ветку: сначала пробуем строковое сравнение, если FAIL — пробуем `numericRoundingMatch`. Если PASS → засчитываем full score. Если null → остаёмся на строковом FAIL.

3. Юнит-тесты (минимум 6 кейсов):

| student | correct | expected | rationale |
|---|---|---|---|
| `0.216` | `0.2` | PASS | round(0.216, 1) = 0.2 |
| `0.3` | `0.2` | FAIL | round(0.3, 1) = 0.3 ≠ 0.2 |
| `5.0001` | `5` | PASS | round(5.0001, 0) = 5 |
| `5.5` | `5` | FAIL | round(5.5, 0) = 6 ≠ 5 (banker's? — use Math.round = away from zero) |
| `12.5` | `12.5` | PASS | строковый match (numeric tolerance не нужен) |
| `abc` | `5` | FAIL | non-numeric → null → fallback на строковое FAIL |
| `0,2` | `0.2` | PASS | запятая как разделитель (RU локаль) |

### Acceptance Criteria

- AC-P3: запись в БД `correct_answer='0.2'`, ученик отвечает `0.216` → `earned_score = max_score`. Если `0.3` → `earned_score = 0`

### Guardrails

- Применять ТОЛЬКО для `check_mode='strict'`. Не трогать `multi_choice`, `ordered`, `unordered`, `task20`, `pair`, `manual`
- Не округлять student шире чем correct (если correct='5' с scale=0, не приводим 5.5 к 5; round даёт 6 → FAIL)
- Telemetry: `console.info('[mock-exam-checker] numeric_rounding_match', { kim, student, correct, scale })` при срабатывании толерантности — нужен для будущего анализа false positives

---

## TASK-4: Подсказки без запятых на student-side

**Job:** S2-1 (тренировка в реальных условиях экзамена)
**Agent:** Claude Code
**Files:** `src/pages/student/StudentMockExam.tsx`
**AC:** AC-P4

### Контекст

В `getAnswerHint(mode: MockExamCheckMode | null)` сейчас:

```typescript
case 'ordered':
  return 'Запиши последовательность через запятую: 1,3,2';
case 'unordered':
  return 'Можно в любом порядке, через запятую';
case 'multi_choice':
  return 'Номера вариантов: 13 или 1,3';
```

На реальном ЕГЭ запятые **запрещены** — ответ пишется слитно (`132`). Цитата Егора: «никаких запятых, не должны привыкать, ставят запятую — получает ноль баллов». Ученик привыкнет к нашему формату и потеряет баллы.

### Что нужно сделать

1. Переписать `getAnswerHint`:

```typescript
function getAnswerHint(mode: MockExamCheckMode | null): string {
  switch (mode) {
    case 'ordered':
      return 'Запиши последовательность слитно: 132';
    case 'unordered':
      return 'Можно в любом порядке, слитно: 13';
    case 'multi_choice':
      return 'Номера вариантов слитно: 13';
    case 'task20':
      return 'Ответ без пробелов: например 31';
    case 'pair':
      return 'Число и единица: 12,5 м/с или 12,5;м/с'; // pair — отдельный case, формат «число + единица» оставляем
    case 'strict':
    default:
      return 'Короткий ответ как в бланке';
  }
}
```

2. Также проверить:
   - `BlankModeBanner` — нет ли упоминания «через запятую» в pdf-инструкции (если есть — убрать)
   - `Part1TaskCard` — нет ли других подсказок c запятыми
   - Внутри `task.task_text` могут быть инструкции от автора варианта — НЕ ТРОГАТЬ (это данные, не UI)

3. На странице `/student/mock-exams/:id` (taking) **слова «через запятую» не должны встречаться ни на одной задаче** — проверить grep'ом в final UI

### Acceptance Criteria

- AC-P4: на задаче с `check_mode='ordered'` подсказка под input содержит «слитно: 132». Слово «запятую» / «запятая» не встречается ни на одной задаче на student-side taking page

### Guardrails

- НЕ менять `case 'pair'` — там формат «12,5 м/с» это правильный формат для pair (число с запятой как desimal separator + unit). Не путать с «через запятую как разделитель ответов»
- НЕ менять hint на tutor preview drawer (там можно оставить технические детали)

---

## TASK-5: Скрыть `task.topic` на student-side card'ах

**Job:** S2-1 (реальные условия экзамена — без подсказок темы)
**Agent:** Claude Code
**Files:** `src/pages/student/StudentMockExam.tsx`
**AC:** AC-P5
**Status:** ✅ Done 2026-05-14. `Part1TaskCard` + `Part2TaskCard` — `{task.topic ? ...}` удалён. Grep `task.topic src/pages/student/` → 0 matches. `MockExamVariantPreviewSheet` (tutor) не тронут. `npx tsc --noEmit` clean. Видимый leak `solution.topic` в `StudentMockExamResult:293` намеренно оставлен (review surface после submit, не taking page, вне AC-P5).

### Контекст

В `Part1TaskCard` и `Part2TaskCard` сейчас в заголовке:

```tsx
<span className="rounded bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700">
  №{task.kim_number}
  {task.topic ? ` · ${task.topic}` : ''}
</span>
```

`task.topic` = «Динамика», «Закон Ньютона» — спойлер метода решения. Цитата Егора: «не надо писать, что это динамика, второй закон Ньютона. Зачем подсказки такие давать?»

На tutor-side (`MockExamVariantPreviewSheet`, `TutorMockExamDetail` если где-то отображается) `task.topic` оставить — это полезный fit-check для репетитора.

### Что нужно сделать

1. В `Part1TaskCard` и `Part2TaskCard` удалить `{task.topic ? ...}` фрагмент. Оставить только `№{task.kim_number}`.
2. В `MockExamVariantPreviewSheet.tsx::PreviewTaskCard` — `task.topic` оставить как есть (tutor surface).
3. Проверить grep'ом что на `/student/mock-exams/:id` taking page нет других мест, где topic мог быть.

### Acceptance Criteria

- AC-P5: в taking page Part1/Part2 task card'ах в шапке виден ТОЛЬКО `№{kim_number}`. Темы задачи (топика) нет нигде на student-side. В preview drawer (tutor) topic виден.

### Guardrails

- НЕ удалять поле `topic` из типа `StudentMockExamVariantTask` — оно нужно для backend, и если другие пакеты его читают, ломать нельзя
- НЕ трогать `MockExamVariantPreviewSheet` (tutor surface)
- НЕ трогать seed / БД — это просто визуальный gate

---

## TASK-6: Re-sync variant 1: единицы + таблицы

**Job:** R4-3 (диагностика готовности), S2-1 (тренировка с корректным условием)
**Agent:** Claude Code (с Python script)
**Files:**
- `docs/delivery/features/mock-exams-v1/source/variant1-tasks.json` (edit)
- `supabase/seed/mock_exams_variant_1.sql` (regenerate)
- `supabase/migrations/20260514120000_resync_mock_exam_variant_1_content.sql` (new)

**AC:** AC-P6, AC-P7

### Контекст

При парсинге `Тр_вариант 1.docx` через docx pipeline (см. CLAUDE.md §11 «Mock Exams v1 — seed Тренировочного варианта 1») потерялись:
- **F6 — единицы измерения** в Часть 1: задачи требуют ответ в микровольтах / Джоулях / Кл и т.д., но в `task_text` после парсинга осталось только базовое условие без trailing «Ответ дайте в …»
- **F7 — таблицы на соответствие** (KIM 6, 17 и аналогичные): структура «к каждой позиции из первого столбца подберите соответствующую из второго» осталась без самих столбцов — плоский текст

Per CLAUDE.md §11: правка делается через `variant1-tasks.json` напрямую, затем регенерация seed через `scripts/build-mock-exam-seed.py`. UUIDs детерминированы (uuid5), новые тексты для тех же task_id.

### Что нужно сделать

1. **Открыть исходный docx** Егора (если есть в `docs/delivery/features/mock-exams-v1/source/` или uploads) или скрин из feedback-сообщения Егора.
2. **Обойти все 26 задач** в `variant1-tasks.json`:
   - **Часть 1 (KIM 1-20):** для каждой задачи, где ответ в физических единицах, добавить в конец `task_text` строку «Ответ дайте в [единица].» (например «Ответ дайте в микровольтах.», «Ответ дайте в Джоулях.»). Грепнуть оригинал docx Егора как источник истины — какие именно единицы и где.
   - **Часть 1 KIM 6, 17 и другие «на соответствие»:** восстановить markdown-таблицы с двумя столбцами. Формат:
     ```
     Установите соответствие.

     | Физическая величина | Формула |
     |---|---|
     | А) сила Кулона | 1) $F = k \\frac{q_1 q_2}{r^2}$ |
     | Б) сила Лоренца | 2) $F = qvB$ |
     ...

     Ответ запишите слитно цифрами: например 123.
     ```
   - **Часть 2 (KIM 21-26):** проверить тоже на потерянные единицы, но обычно там полное решение, единицы упоминаются в самой формулировке
3. **Сверить с docx Егора** — `kim_number → expected_units` и `kim_number → expected_table_structure`. Если есть вопросы — заспавнить open question в spec, не угадывать.
4. **Регенерировать seed:**
   ```bash
   python scripts/build-mock-exam-seed.py \
     docs/delivery/features/mock-exams-v1/source/variant1-tasks.json \
     supabase/seed/mock_exams_variant_1.sql
   ```
   Diff проверить — должны меняться только task_text поля.
5. **Создать миграцию** `supabase/migrations/20260514120000_resync_mock_exam_variant_1_content.sql`:
   ```sql
   -- Re-sync mock exam variant 1 content: восстановление единиц измерения (F6)
   -- и табличных задач на соответствие (F7). Per CLAUDE.md §11.

   -- Idempotent UPDATE per task_id. UUIDs детерминированы (uuid5 namespace
   -- 00000000-0000-0000-0000-000000005ec0).

   UPDATE public.mock_exam_variant_tasks
   SET task_text = '...новый текст с единицами...'
   WHERE id = '<task_id_kim_1>';

   UPDATE public.mock_exam_variant_tasks
   SET task_text = '...новый текст с таблицей...'
   WHERE id = '<task_id_kim_6>';

   -- ... 26 UPDATEs всего
   ```
   Альтернатива: вместо ручных UPDATE'ов сгенерировать SQL'ы из обновлённого `variant1-tasks.json` через тот же `build-mock-exam-seed.py` с флагом `--update-only` (если его нет — добавить).

6. **Проверить рендеринг** в `Part1TaskCard` — таблицы рендерятся через `MathText` → ReactMarkdown с `remark-gfm`. Проверить что `remark-gfm` подключён; если нет — добавить.

### Acceptance Criteria

- AC-P6: на 5 случайных задачах Часть 1 с известными требованиями к единицам — в taking page видна строка «Ответ дайте в …»
- AC-P7: на KIM 6 (и других задачах на соответствие в варианте 1) — visible structured таблица с двумя столбцами/списками. Ученик может прочитать соответствие между элементами

### Guardrails

- **НЕ менять uuid'ы задач** — uuid5 детерминированы, если поменять namespace или ключ → сломаются все связи в `mock_exam_attempts.task_id` → потеряются результаты учеников
- **НЕ менять `correct_answer`** для KIM где он уже корректный — только `task_text`. Если при сверке с docx обнаружится что correct_answer тоже неверный — отдельный коммит с явным комментарием
- **НЕ удалять задачи** из seed — только UPDATE
- **Idempotent миграция**: повторное применение не должно ломать данные (UPDATE по id безопасен)
- **`remark-gfm`** — если добавляешь как dep, проверь bundle size в `npm run build` (не должен сильно расти, gfm малый)

---

## TASK-7: PublicMockInvite UX без «ожидания Vladimir» ✅ Done 2026-05-14

**Job:** P1-2 (родитель/потенциальный ученик начинает пробник по ссылке), wedge: lead-gen для репетитора
**Agent:** Claude Code
**Files (landed):**
- `src/pages/PublicMockInvite.tsx` — заменил `PostSubmitSuccess` («ждите репетитор свяжется») на `ReadyToStartPanel` + `ConfirmStartDialog`; добавил `useNavigate` + state `confirmOpen`; новый handler chain (success → auto-open dialog → confirm navigates → `/student/mock-exams/:assignment_id`). Заголовочный комментарий обновлён под olympiad UX.

**State machine после фикса:**
- State A (форма) → submit
- State B (после success POST) → `ReadyToStartPanel` («Готово, {leadName}! Можно начинать.» + 3-bullet объяснение + CTA «Начать пробник») + auto-open confirm dialog в том же tick'е
- State C (`ConfirmStartDialog`) → «Готов начать? Тебе будет дано 4 часа.» + кнопки «Позже» (close, ученик остаётся на panel) / «Готов начать» (navigate)

**Anti-text guarantees:** `grep -nE "ожида|одобр|Владимир|approved by|pending|approval|дождит|подтвержд" PublicMockInvite.tsx | grep -v "^\s*[0-9]*:\s*//"` → **0 matches** в JSX-рендеренных строках. Оставшиеся 4 совпадения в комментариях явно документируют отсутствие старой модели.

**Validation:** lint clean · tsc clean · live SPA preview verification: dialog рендерит accessibility snapshot `dialog[name="Готов начать?"]` + paragraph «Тебе будет дано 4 часа на прохождение пробника» + кнопки «Позже» + «Готов начать»; click «Готов начать» → navigate на `/student/mock-exams/:assignment_id` (для anonymous AuthGuard redirect → /login, документированное ограничение TASK-12 anonymous mode).

**Limitation (документированная):** anonymous incognito пользователь при клике «Готов начать» упирается в `AuthGuard` → login → return. Authenticated student'у flow работает как «1 click → видна первая задача». Full anonymous taking surface — TASK-12 anonymous mode (вне scope pilot-polish).

**AC:** AC-P8 — ✅ для authenticated; для anonymous упирается в AuthGuard (separate follow-up).

### Контекст

Сейчас в `PublicMockInvite.tsx` после submit lead form (имя + Telegram + consent) есть промежуточный экран в духе «ожидайте одобрения». Цитата Егора: «Ну зачем так? Надо чтобы всё запустить, знаешь как на олимпиадах? Вам будет дано четыре часа, вы готов начать? Зачем ждать ещё? Одобрения Владимира?»

Решение: после submit lead form → сразу `startPublicMockInvite` → переход на taking surface. Confirm dialog «Готов начать? 4 часа» оставляем (это олимпиадный confirm, не approval gate).

### Что нужно сделать

1. Открыть `src/pages/PublicMockInvite.tsx`. Найти любые элементы / текст с упоминанием «ожидание», «одобрение», «Владимир», «approved by», «pending tutor approval», «дождитесь подтверждения», etc.
2. Удалить эти элементы. Заменить flow:
   - Step 1: показать форму с именем + Telegram/email + consent + Privacy link → submit
   - Step 2: после успешного POST на `mock-exam-public` invite endpoint → confirm dialog: «Готов начать? Тебе будет дано 4 часа.» с двумя кнопками «Готов» / «Позже»
   - Step 3 (после «Готов»): navigate на taking surface (`/p/mock-take/:slug` или эквивалент — проверить existing route)
3. Если в текущем коде использовался `success: 'pending'` state — заменить на `success: 'confirm_start'`. После confirm → новое состояние / навигация
4. Inline текст cleanup — убрать любую копию подразумевающую внешний approval gate

### Acceptance Criteria

- AC-P8: открыть `/p/mock-invite/:slug` (анонимно, без auth) → заполнить форму → submit → confirm dialog → нажать «Готов начать» → видна первая задача taking page. **Не** видны слова «ожидание», «одобрение», «pending», «approval»

### Guardrails

- Лид-row в `mock_exam_anonymous_leads` всё равно создаётся при submit (AC-6 из исходной mock-exams-v1 spec — не ломать)
- `notifyTutorOfNewLead()` push leg остаётся (tutor получает уведомление о новом лиде — параллельно user'у, не блокирует start)
- Confirm dialog «Готов? 4 часа» — обязателен (защита от случайного клика → потраченного таймера)
- Не менять backend endpoint `mock-exam-public::handleInviteStart` — только frontend UX flow

---

## TASK-8: Smoke test полного flow

**Job:** All
**Agent:** Vladimir (manual)
**Files:** —
**AC:** AC-P1..AC-P8

### Контекст

После того как TASK-1..TASK-7 деплоены (backend через Lovable Cloud, frontend через `deploy-sokratai`), нужен ручной end-to-end smoke от Vladimir с двумя аккаунтами.

### Что нужно сделать

**Аккаунт A — пилотный репетитор:** `egor.o.blinov@gmail.com` (UUID `a7212758-8cdd-4d7c-8608-4fedcb34d74c`)
**Аккаунт B — пилотный ученик:** `kamchatkin.va@phystech.edu` (UUID `ac96a528-4213-471b-ac9d-163a2af6397a`)

**Сценарий:**
1. Залогиниться как A. `/tutor/mock-exams/new` → preview drawer → проверить что в preview видны задачи (P5 negative: на tutor-side topic ВИДЕН)
2. Назначить пробник Тренировочный 1 ученику B. Включить чекбокс «Создать публичную ссылку». Submit → модалка с URL копировать ссылку
3. **AC-P8 проверка:** открыть скопированную ссылку в incognito → заполнить форму → confirm → видна первая задача. НЕ «ожидание Владимира»
4. Залогиниться как B в обычном браузере. `/student/mock-exams` → клик на «Тренировочный 1»
5. **AC-P1 проверка:** taking page открывается, 26 задач, нет «Assignment not found»
6. **AC-P5 проверка:** в шапке Part1/Part2 cards виден только `№N`, нет топика
7. **AC-P6 проверка:** на 5 задачах Часть 1 видна строка «Ответ дайте в …»
8. **AC-P7 проверка:** на KIM 6 (или другой на соответствие) видна таблица 2 столбца
9. **AC-P4 проверка:** на задаче ordered видна подсказка «слитно: 132», нет «через запятую»
10. **AC-P3 проверка:** на любой задаче strict с числовым ответом (например KIM 1) ввести **на 1 разряд точнее** правильного → submit Часть 1 → результат: balls=max_score
11. Submit всю Часть 1, загрузить 1 фото Часть 2, submit финал
12. **Не закрывая** Vladimir-tutor вкладку на `/tutor/mock-exams/:assignment_id` (она открыта в другом окне). Подождать 30-60 секунд
13. **AC-P2 проверка:** KPI «Сдали» обновился без manual refresh, в heatmap видна запись с статусом «Требует AI-проверки»

Все 8 AC должны быть PASS перед раскаткой на 5 репетиторов.

### Acceptance Criteria

- AC-P1..AC-P8: все PASS

### Guardrails

- Если хоть один AC FAIL — НЕ раскатывать. Завести follow-up task, fix, повторить smoke

---

## TASK-9: Codex review всего релиза

**Job:** All
**Agent:** Codex (independent reviewer, clean session)
**Files:** все diff'ы из TASK-1..TASK-7
**AC:** All

### Контекст

Per development-pipeline.md ШАГ 6 — независимый ревьюер (Codex) проверяет реализацию на соответствие spec + discovery docs.

### Промпт для Codex

См. **Copy-paste промпты** ниже.

### Acceptance Criteria

- Codex вердикт: PASS или CONDITIONAL PASS. FAIL → возврат на исправление

### Guardrails

- Codex не видит контекст Claude Code сессии — промпт самодостаточный, ссылается на docs пути

---

# Copy-paste промпты для агентов

> Plain-text блоки ниже — единственное что копируется в агента. Описания TASK выше — контекст для тебя как PM. Промпты ниже встраивают spec path + AC + scope + validation в один блок.

## Промпт для TASK-1 (verification, не реализация)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI (EdTech-платформа для репетиторов физики ЕГЭ/ОГЭ).

Контекст: после feedback-цикла с пилотным репетитором Егором обнаружено 8 P0-блокеров перед раскаткой пробников (mock exams) на 5 репетиторов. TASK-1 — verification что defensive dual-path lookup в edge function `mock-exam-student-api` уже задеплоен и работает.

Канонические документы для чтения (по порядку):
1. CLAUDE.md (§ "Mock Exams v1 — public anonymous endpoint", § "Student Homework Problem Screen" — для контекста edge function patterns)
2. .claude/rules/40-homework-system.md (правило двойного write-path, anti-leak invariants)
3. docs/delivery/features/mock-exams-v1-pilot-polish/spec.md (полная спека этой фичи, AC-P1)
4. docs/delivery/features/mock-exams-v1/spec.md (исходная Phase 1)
5. supabase/functions/mock-exam-student-api/index.ts (handleGetStudentAssignment, handleGetResult)
6. src/pages/student/StudentMockExams.tsx (handleClick — navigate с row.assignment_id)

Задача:
1. Verify что в `supabase/functions/mock-exam-student-api/index.ts::handleGetStudentAssignment` есть две попытки lookup: сначала по `assignment_id = rawId AND student_id = auth.uid()`, fallback по `id = rawId AND student_id = auth.uid()`. Downstream queries используют `attempt.assignment_id`.
2. То же для `handleGetResult`.
3. Verify что `StudentMockExams.tsx::handleClick` навигирует через `row.assignment_id ?? row.id` (defensive fallback) с `console.error` при отсутствии.
4. Verify что 404 message русифицирован: «Пробник не найден или не назначен этому ученику», и в `error.details` echoed `passed_id`.
5. Если что-то отсутствует — допиши. Если всё на месте — просто отчитайся "verified, no changes".
6. Smoke: ассайн пробника от tutor → открыть от student → должна открыться taking page.

Acceptance Criteria (Given/When/Then):
- AC-P1: Given assigned mock exam, When student clicks card в `/student/mock-exams`, Then taking page открывается с 26 задачами (НЕ "Assignment not found")

Guardrails:
- НЕ менять auth/RLS логику
- НЕ удалять primary path (assignment_id lookup) — fallback в дополнение
- Ownership check `student_id = auth.uid()` обязателен в обоих путях
- НЕ менять контракт frontend → backend (URL остаётся `/student/:id`)

Mandatory end block:
- Changed files: список с краткой однострочной аннотацией
- Summary: что сделано, что было пропущено и почему
- Validation: `npm run lint && npm run build && npm run smoke-check`
- Docs-to-update: какие правила в CLAUDE.md / .claude/rules/ требуют апдейта
- Self-check: AC-P1 status (PASS/FAIL + reasoning)
- Deploy needed block (per .claude/rules/95-production-deploy.md): если frontend менялся, добавить «🚀 Deploy needed» с командой `deploy-sokratai`
```

## Промпт для TASK-2 (conditional polling)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: TASK-2 из mock-exams-v1-pilot-polish. После submit ученика репетитор на `/tutor/mock-exams/:id` должен увидеть обновление без manual refresh. Текущий `useMockExamAssignment` имеет refetchOnWindowFocus, но WebKit/iOS Safari иногда не fire'ит focus при tab switch внутри окна.

Канонические документы:
1. docs/delivery/features/mock-exams-v1-pilot-polish/spec.md (AC-P2)
2. .claude/rules/performance.md §2c (query key конвенция `['tutor', ...]`)
3. src/hooks/useMockExamAssignment.ts (текущая реализация)
4. src/hooks/tutorQueryOptions.ts (existing tutor query helpers — getTutorBackgroundRefetchInterval)

Задача:
1. В `useMockExamAssignment.ts` расширить `refetchInterval` callback:
   - Если `currentQuery.state.data?.attempts?.some(a => ['submitted', 'ai_checking', 'awaiting_review'].includes(a.status))` → return 30_000 ms
   - Иначе → return existing `getTutorBackgroundRefetchInterval(hasData, hasError)`
2. Не трогать другие настройки query (staleTime, retry, refetchOnWindowFocus)
3. Опционально: добавить `console.info('[mock-exam-detail-polling] active=true', { assignment_id, awaiting_count })` при первом включении polling — для debug

Acceptance Criteria:
- AC-P2: Given student submits attempt, When tutor НЕ refresh'ит страницу `/tutor/mock-exams/:id`, Then в течение 60s KPI «Сдали» обновляется

Guardrails:
- Polling ТОЛЬКО при non-terminal статусах
- Terminal статусы (approved, manually_entered, in_progress + started_at=null) → polling OFF
- Не создавать новый hook — расширить existing
- Сохранить query key `['tutor', 'mock-exams', 'assignment', assignmentId]`

Mandatory end block: changed files, summary, validation, AC self-check, Deploy needed.
```

## Промпт для TASK-3 (numeric rounding)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: TASK-3 из mock-exams-v1-pilot-polish. Авточекер Часть 1 даёт false negatives на более точных численных ответах (student=0.216, correct=0.2 → 0 баллов). Подрывает доверие репетиторов и ломает AC-3 исходной спеки mock-exams-v1.

Канонические документы:
1. docs/delivery/features/mock-exams-v1-pilot-polish/spec.md (AC-P3, Technical Design § "Auto-check rounding logic")
2. src/lib/mockExamPart1Checker.ts (текущая реализация)
3. src/types/mockExam.ts (MockExamCheckMode union)

Задача:
1. Добавить в `src/lib/mockExamPart1Checker.ts` helper `numericRoundingMatch(student: string, correct: string): boolean | null`:
   - Парсит оба в float (с поддержкой RU локали — replace ',' → '.' перед parseFloat)
   - Если хотя бы один не finite → return null
   - scale = количество знаков после запятой в correct (0 для целых)
   - return Math.abs(round(student, scale) - correct) < 1e-9
2. Интегрировать в `check_mode='strict'` ветку: сначала строковое сравнение → если FAIL, попробовать numericRoundingMatch → если true → PASS
3. Telemetry: `console.info('[mock-exam-checker] numeric_rounding_match', { kim, student, correct, scale })` при срабатывании толерантности
4. Юнит-тесты в `src/lib/__tests__/mockExamPart1Checker.test.ts` (создать если нет):
   - `0.216 vs 0.2` → PASS
   - `0.3 vs 0.2` → FAIL
   - `5.0001 vs 5` → PASS
   - `5.5 vs 5` → FAIL
   - `0,2 vs 0.2` → PASS (RU локаль)
   - `abc vs 5` → fallback к строковому FAIL
5. Запустить тесты: `npm run test` (или `npm test` — посмотри package.json scripts)

Acceptance Criteria:
- AC-P3: Given correct_answer='0.2', When student answers '0.216', Then earned_score = max_score. When student answers '0.3', Then earned_score = 0

Guardrails:
- Толерантность ТОЛЬКО для check_mode='strict'. НЕ трогать multi_choice / ordered / unordered / pair / task20 / manual
- НЕ округлять student шире scale of correct (если correct='5', не приводим 5.5 → 5)
- Сохранить existing string comparison path как primary — rounding только fallback

Mandatory end block: changed files, summary, test results, validation, AC self-check, Deploy needed.
```

## Промпт для TASK-4 (hints без запятых)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: TASK-4 из mock-exams-v1-pilot-polish. Подсказки к input полям таски Часть 1 содержат «через запятую», что обучает учеников неверному формату для реального ЕГЭ. Цитата Егора: «никаких запятых, не должны привыкать».

Канонические документы:
1. docs/delivery/features/mock-exams-v1-pilot-polish/spec.md (AC-P4)
2. src/pages/student/StudentMockExam.tsx (getAnswerHint)

Задача:
1. В `src/pages/student/StudentMockExam.tsx::getAnswerHint(mode)`:
   - 'ordered': 'Запиши последовательность слитно: 132'
   - 'unordered': 'Можно в любом порядке, слитно: 13'
   - 'multi_choice': 'Номера вариантов слитно: 13'
   - 'task20': 'Ответ без пробелов: например 31' (оставить)
   - 'pair': 'Число и единица: 12,5 м/с или 12,5;м/с' (НЕ ТРОГАТЬ — здесь запятая legitimate, как decimal separator)
   - 'strict' / default: 'Короткий ответ как в бланке' (оставить)
2. Проверить grep'ом по `src/pages/student/` что слова «через запятую» / «запятая» больше не встречаются в UI копи для taking surface
3. `BlankModeBanner` — проверить нет ли таких упоминаний; если есть — убрать

Acceptance Criteria:
- AC-P4: Given task с check_mode='ordered', When ученик на taking page, Then подсказка справа от input содержит «слитно: 132» (или эквивалент). Слова «через запятую» нет ни на одной задаче

Guardrails:
- НЕ менять `case 'pair'` — там запятая это decimal separator (правильный формат)
- НЕ менять hints в tutor preview drawer / detail (там technical details OK)
- НЕ менять данные в `task.task_text` — это контент задачи

Mandatory end block: changed files, summary, validation, AC self-check, Deploy needed.
```

## Промпт для TASK-5 (скрыть topic на student-side)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: TASK-5 из mock-exams-v1-pilot-polish. На taking page ученик видит `task.topic` («Динамика», «Закон Ньютона») рядом с номером KIM — это спойлер метода решения. Цитата Егора: «не надо писать, что это динамика. Зачем подсказки такие давать?»

Канонические документы:
1. docs/delivery/features/mock-exams-v1-pilot-polish/spec.md (AC-P5)
2. src/pages/student/StudentMockExam.tsx (Part1TaskCard, Part2TaskCard)
3. src/components/tutor/mock-exams/MockExamVariantPreviewSheet.tsx (tutor preview — topic ОСТАЁТСЯ)

Задача:
1. В `src/pages/student/StudentMockExam.tsx`:
   - `Part1TaskCard`: удалить `{task.topic ? ` · ${task.topic}` : ''}` из шапки
   - `Part2TaskCard`: то же
2. В `MockExamVariantPreviewSheet.tsx::PreviewTaskCard` — НЕ ТРОГАТЬ. Tutor должен видеть topic для fit-check.
3. Grep по `src/pages/student/` на `task.topic` — убедиться что нигде больше не виден на student-facing UI

Acceptance Criteria:
- AC-P5: Given student открывает taking page, When смотрит на Part1/Part2 card шапку, Then виден только `№{kim_number}`, темы задачи (topic) нет. На tutor-side preview drawer — topic виден

Guardrails:
- НЕ удалять `topic` из типа `StudentMockExamVariantTask` (нужно для других потребителей)
- НЕ трогать tutor surfaces (MockExamVariantPreviewSheet, TutorMockExamDetail)
- НЕ трогать seed / БД

Mandatory end block: changed files, summary, validation, AC self-check, Deploy needed.
```

## Промпт для TASK-6 (re-sync content variant 1)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI с навыком работы с Python-скриптами.

Контекст: TASK-6 из mock-exams-v1-pilot-polish. При парсинге `Тр_вариант 1.docx` потерялись (а) единицы измерения в Часть 1 («Ответ дайте в микровольтах»), (б) таблицы в задачах на соответствие (KIM 6, 17). Цитаты Егора: «единицы измерения везде стоят», «таблички не хочет рендерить».

Канонические документы:
1. docs/delivery/features/mock-exams-v1-pilot-polish/spec.md (AC-P6, AC-P7)
2. CLAUDE.md § "Mock Exams v1 — seed Тренировочного варианта 1" (canonical pipeline: docx → variant1-tasks.json → seed.sql)
3. docs/delivery/features/mock-exams-v1/source/variant1-tasks.json (canonical source — editable)
4. scripts/build-mock-exam-seed.py (генератор seed)
5. supabase/seed/mock_exams_variant_1.sql (текущий seed)

Задача:
1. **Открыть исходник docx** Егора. Найти его в `docs/delivery/features/mock-exams-v1/source/` или uploads. Если нет — ЗАПРОСИТЬ у Vladimir source-of-truth.
2. **Обойти все 26 задач** в `variant1-tasks.json`:
   - **Часть 1 (KIM 1-20):** для задач с численным ответом + физическими единицами добавить в конец task_text: «Ответ дайте в [единица].» (микровольтах, Джоулях, Кл и т.д.) — сверить с docx Егора
   - **Часть 1 «на соответствие» (KIM 6 + другие):** восстановить markdown-таблицу 2 столбца. Формат: `| Заголовок1 | Заголовок2 |\n|---|---|\n| А) ... | 1) $LaTeX$ |\n| Б) ... | 2) $LaTeX$ |`. Заканчивать «Ответ запишите слитно цифрами: например 123.»
   - **Часть 2 (KIM 21-26):** проверить тоже — обычно там полное решение, единицы упоминаются в самой формулировке. Если потеряны — восстановить
3. **Регенерировать seed**: `python scripts/build-mock-exam-seed.py docs/delivery/features/mock-exams-v1/source/variant1-tasks.json supabase/seed/mock_exams_variant_1.sql`. Diff: должны меняться только task_text поля (UUID одинаковые, uuid5 детерминированы)
4. **Создать миграцию** `supabase/migrations/20260514120000_resync_mock_exam_variant_1_content.sql`: idempotent UPDATEs по task_id (26 штук) с новыми task_text. UUIDs брать из обновлённого seed
5. **Проверить markdown rendering**: в `src/pages/student/StudentMockExam.tsx::MathBlock` используется lazy `MathText`. Проверить что MathText / ReactMarkdown поддерживает таблицы через `remark-gfm`. Если нет — добавить
6. Apply миграцию локально, smoke: открыть taking page — таблицы и единицы видны

Acceptance Criteria:
- AC-P6: на 5 задачах Часть 1 с известными требованиями к единицам видна «Ответ дайте в …»
- AC-P7: на KIM 6 (и других на соответствие) видна структурированная таблица 2 столбца. Ученик может прочитать соответствие между элементами

Guardrails:
- НЕ менять uuid'ы задач — uuid5 детерминированы, иначе сломаются связи в mock_exam_attempts
- НЕ менять correct_answer если задача правильная — только task_text
- Idempotent миграция (UPDATE по id)
- НЕ удалять задачи из seed
- Если remark-gfm добавляется как dep — проверить bundle size после npm run build

Mandatory end block: changed files (с указанием изменённых KIM), summary, validation, AC self-check, Deploy needed (включая «Lovable Cloud применит миграцию автоматически после push»).
```

## Промпт для TASK-7 (PublicMockInvite UX)

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: TASK-7 из mock-exams-v1-pilot-polish. Public страница `/p/mock-invite/:slug` содержит зашитый шаг «ожидание одобрения Vladimir» после submit lead-формы. Цитата Егора: «Зачем ждать ещё? Одобрения Владимира? Надо чтобы как на олимпиадах — готов начать → начал».

Канонические документы:
1. docs/delivery/features/mock-exams-v1-pilot-polish/spec.md (AC-P8)
2. docs/delivery/features/mock-exams-v1/spec.md (AC-6 — anonymous lead flow остаётся валиден, не ломаем)
3. CLAUDE.md § "Mock Exams v1 — public anonymous endpoint" (backend контракт mock-exam-public)
4. src/pages/PublicMockInvite.tsx (текущий UX flow)
5. src/lib/mockExamPublicApi.ts (fetchPublicMockInvite, startPublicMockInvite)

Задача:
1. Открыть `src/pages/PublicMockInvite.tsx`. Найти всё, что упоминает «ожидание», «одобрение», «Владимир», «approved by», «pending», «дождитесь подтверждения»
2. Удалить promezhutochnyy экран «ожидайте одобрения». Новый flow:
   - State A: форма lead-capture (имя + Telegram/email + consent + privacy link) → submit
   - State B (после успешного POST): confirm dialog «Готов начать? Тебе будет дано 4 часа.» с кнопками «Готов начать» / «Позже»
   - State C (после клика «Готов начать»): navigate на taking surface (existing route — посмотри в App.tsx, скорее всего `/p/mock-take/:slug` или `/student/mock-exams/...` через анонимную сессию)
3. Если был success='pending' state — заменить на success='confirm_start'
4. Лид-row в `mock_exam_anonymous_leads` создаётся при submit (existing — НЕ ТРОГАТЬ backend)
5. `notifyTutorOfNewLead()` push leg — backend дёргает сам, не привязано к UX

Acceptance Criteria:
- AC-P8: Given опен `/p/mock-invite/:slug` в incognito, When fill form + submit + confirm, Then через 1 клик после submit видна первая задача. НЕТ слов «ожидание», «одобрение», «pending», «approval»

Guardrails:
- НЕ менять backend endpoint mock-exam-public (только frontend UX)
- НЕ убирать confirm dialog «Готов? 4 часа» — это олимпиадный confirm для защиты от случайного клика
- Anonymous lead row в mock_exam_anonymous_leads должна создаваться (AC-6 из mock-exams-v1)
- Privacy/consent flow остаётся

Mandatory end block: changed files, summary, validation, AC self-check, Deploy needed.
```

## Промпт для Codex review (TASK-9)

```
Ты — независимый ревьюер SokratAI. Контекст первого агента тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
3. Прочитай docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
4. Прочитай docs/delivery/features/mock-exams-v1-pilot-polish/spec.md
5. Прочитай docs/delivery/features/mock-exams-v1-pilot-polish/tasks.md
6. Посмотри git diff origin/main..HEAD на 8 файлов:
   - supabase/functions/mock-exam-student-api/index.ts
   - src/pages/student/StudentMockExams.tsx
   - src/hooks/useMockExamAssignment.ts
   - src/lib/mockExamPart1Checker.ts
   - src/pages/student/StudentMockExam.tsx
   - docs/delivery/features/mock-exams-v1/source/variant1-tasks.json
   - supabase/migrations/20260514120000_resync_mock_exam_variant_1_content.sql
   - src/pages/PublicMockInvite.tsx

ВОПРОСЫ:
- Job alignment: каждый фикс закрывает заявленную работу (R4-2, S2-1, P1-2)?
- UX drift: на student-side НЕ виден topic, НЕ виден «ожидание Vladimir», НЕТ «через запятую»?
- Anti-leak: на tutor-side topic ВИДЕН, solution_text НЕ leak'нул на student?
- Scope creep: ничего за пределами 8 P0 не реализовано?
- AC: каждый из AC-P1..AC-P8 покрыт изменениями?
- Safari/iOS: 16px inputs, touch-action, нет lookbehind regex, нет structuredClone/at()
- Numeric tolerance: применяется ТОЛЬКО для check_mode='strict' с finite numbers?
- Idempotent миграция: повторное применение safe?
- High-risk файлы: AuthGuard / TutorGuard / Chat.tsx нетронуты?

ФОРМАТ ОТВЕТА:
- PASS / CONDITIONAL PASS (с conditions) / FAIL (с reasons)
- За каждый AC-P1..AC-P8 — отдельный verdict
- Если FAIL — список конкретных строк кода которые ломают AC
```

---

## Validation после deploy

После каждого деплоя (Phase 1 → Phase 2):

```bash
# Локально перед push
npm run lint && npm run build && npm run smoke-check

# После push (Lovable Cloud auto-deploy edge functions + migrations за 2-5 мин)
# Затем frontend:
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
deploy-sokratai

# Smoke check production:
curl https://sokratai.ru/  # healthcheck
# Manual smoke per TASK-8 чеклист
```

После TASK-8 PASS — анонс в чат тестирования 5 репетиторов: «Пробники готовы к тестированию. Назначь ученику Тренировочный 1 → проверь как он отображается у ученика → проверь Часть 2 после сдачи».

---

## Phase 2 fast-follow (через 2-3 дня после Phase 1 deploy)

Не специфицирую полностью (per pipeline ШАГ 5 правило). Старт Phase 2 — когда:
- Phase 1 на проде ≥ 48 часов
- Хотя бы 1 репетитор провёл полный цикл с учеником
- Нет регрессий по AC-P1..AC-P8

Scope Phase 2 = F9 (race condition attempts dedup), F10 (унификация времени), F11 (полная справочная шапка ЕГЭ), F12 (mutually exclusive modes behavior).

Каждая Phase 2 task получит свой промпт после Phase 1 retro.
