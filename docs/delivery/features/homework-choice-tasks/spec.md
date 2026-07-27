# Структурные тестовые задачи (options_json) — спека

**Статус:** утверждён формат (Vladimir, 2026-07-27), реализация не начата.
**Контекст:** `docs/discovery/research/custdev/2026-07-27-diana-shevtsova-migration-cjm.md` (P0 #5–6).

## Section 0: Job Context

**Сегмент:** С2 «руководитель школы» (Диана Шевцова: 2471 тест на Online Test Pad, ~400 учеников школы) + J2 Эмилии «массовое нарешивание тестов без AI-чата».

**Core Job:** «Когда я выдаю группе тест на отработку (10 вопросов с вариантами), я хочу, чтобы ученик выбрал варианты, система проверила сама и объяснила ему из МОЕГО комментария, — чтобы никто ничего не проверял вручную и дети "не за меня писали, а прочитали описание"».

**Wedge:** ключ доступа к переезду школы Дианы (lock-in на 2500 тестов — причина, по которой она не ушла на СОХО). Дедлайн первой партии: ссылки ученикам 1–2 августа.

**Решения владельца (2026-07-27):** структурный формат (не «варианты текстом»); пояснение к ответу — в `solution_text` (tutor-only навсегда), ученику его смысл доносит AI-фидбэк; никакого нового student-visible поля.

## 1. Схема

`options_json jsonb NULL` на `homework_tutor_tasks` + `kb_tasks` (+ CHECK `jsonb_typeof='object'`). Шаблоны — через `tasks_json`/kb-ссылки, миграция не нужна.

```ts
type TaskOptions =
  | { kind: 'single_choice'; options: { key: string; text: string }[] }   // key '1'..'9'
  | { kind: 'multi_choice';  options: { key: string; text: string }[] }
  | { kind: 'matching';
      left:  { key: string; text: string }[];   // 'А'..'Д' (≤5)
      right: { key: string; text: string }[] }  // '1'..'9' (≤9, неравной длины)
```

- **Правильный ответ НЕ в options_json** (колонка student-safe!). Он остаётся в `correct_answer` (tutor-only) в формате чекеров пробников: single `"3"`, multi `"1267"`, matching `"35142"` (по левому столбцу).
- Канон типов + `normalizeOptionsJson` (whitelist-проекция: только `kind/options/left/right/key/text`, капы ≤9 ключей multi/matching-right, text ≤500) — `src/lib/taskOptions.ts` + Deno-зеркало `_shared/task-options.ts` + parity-тест в smoke-check. Normalizer применяется на ВСЕХ write-site (edge и клиентском) — случайный `correct: true` из импорт-скрипта не доедет.
- `check_format`/`task_kind` НЕ расширяются: `options_json` — ортогональный presence-флаг при `short_answer`/`numeric` (существующий деterministic fast-path гейтится `!== 'detailed_solution'` — совместимо).

## 2. Anti-leak (rule 40, 3 слоя)

1. GRANT-миграция: `GRANT SELECT (options_json) ON homework_tutor_tasks TO authenticated` (явная, по образцу 20260630170000). `correct_answer` не трогаем.
2. Edge whitelists: `options_json` в student-селекты (`handleGetStudentProblem`, `handleGetStudentAssignment`, legacy-thread, result) + tutor-edit SELECT + AI-селекты; рендер вариантов текстом в контекст **всех 3 AI-путей + bootstrap** (`renderOptionsForPrompt`) — иначе AI обсуждает тест, не видя вариантов.
3. Compile-time: `StudentHomeworkTask.options_json?`.

## 3. Проверка: код ставит балл → AI объясняет

Ветка в `evaluateStudentAnswer` (guided_ai.ts), гейт: options_json парсится ∧ correct_answer непуст:

1. **Детерминированный балл** — импорт готовых эвалуаторов из `_shared/mock-exam-part1-checker.ts` (consume-only, файл не менять): `single_choice`→`checkStrict`, `multi_choice`→`gradeMultiChoice`, `matching`→`gradeOrdered`. Вердикт: earned==max → CORRECT; 0<earned<max → ON_TRACK (ai_score=earned); 0 → INCORRECT. Всегда `deterministic_score: true` (отключает confidence-даунгрейд).
2. **AI-объяснение** — режим `precomputedVerdict` в `buildCheckPrompt`: «балл уже вычислен кодом (X из Y), не переоценивай». На CORRECT — пересказ смысла `solution_text` (пояснение Дианы). На INCORRECT/ON_TRACK — сократический тон + **явный запрет называть правильные номера/пары** (пересдача не ограничена; leak-детектор слаб на цифрах).
3. **Сбой AI / нет квоты → балл НЕ теряется**: canned-фидбэк («Верно!» / «Пока неверно…») вместо CHECK_FAILED.

**Квота:** гейт `checkAiQuota` в `handleCheckAnswer`/`handleStudentSubmission` переносится ПОСЛЕ чтения задачи (прецедент — speaking-ветка, fix 2026-05-29): для структурных задач квота жжётся только когда реально идёт AI-объяснение; отказ квоты ⇒ canned-фидбэк, не 429. Для нестуктурных задач порядок byte-identical текущему (ручной QA обоих режимов homework + independent). `onUsage`/`source` — как у существующего check-пути.

## 4. Student UI — минимальная инвазия

`StructuredAnswerPanel` в `HomeworkProblem.tsx`: radio / чекбокс-чипы / matching «А → select 1..9» (без drag-drop; 16px, ≥44px targets, Safari 15 — rule 80/90). Выбор сериализуется в строку («1, 2, 6, 7» / «35142») и уходит **существующим каналом** `checkAnswer` — ни нового endpoint'а, ни нового message-типа. Парс options_json не удался → fallback на текстовый ввод (deploy-skew-safe). Independent-режим: сериализованный выбор в существующее поле сабмита.

## 5. Носители (rule 40 dual write-path — ВСЕ разом)

- Path A: `KBTask.options_json` → `kbTaskToDraftTask` → `DraftTask` → `Create/UpdateAssignmentTask` → 4 backend write-site + `templateTasksJson`. **Edit round-trip обязателен в том же релизе** — иначе правка ДЗ в конструкторе молча теряет варианты (P0-риск). `buildTaskSignature` + `computeTaskContentFingerprint` — включить options_json.
- Path B: `HWDraftTask` → `hwDraftStore.addTask` → прямой INSERT `HWDrawer.tsx`.
- `kb_snapshot.ts` (единый конвертер) — покрывает шаблоны/авто-зеркало/push-to-kb/save-to-kb одной правкой.
- Конструктор: read-only бейдж в `HWTaskCard` («Тест: 7 вариантов»), редактора вариантов в v1 нет. Коммит по конструктору → Manual QA checklist (rule 40).

## 6. Импорт Online Test Pad

По образцу `scripts/fipi-import` (браузер-парс под логином Дианы → JSON → **превью-гейт владельцу** → `kb_tasks` в её папки): `options_json` + `correct_answer` (каноничная форма) + пояснение → `solution` + `kim_number` + `check_format='short_answer'`. Приоритет партии (подтвердить с Дианой): 11 кл — №11/14/15 по 7 вариантов; 9 кл — все №7 (21 вариант) и №9. Пилот → показать Диане → масштаб. 130 полных вариантов — к январю.

## 7. Вне скоупа v1

ЕГЭ №9 (вставка букв) и №12 (вписывание) — обычный текстовый short_answer (работает, включая альтернативы « или »); ручной конструктор вариантов; строгие check_mode-профили (`multi_choice_strict` и пр. — через будущий `check_mode`-override); drag-drop matching; частичный балл как отдельный UX.

## 8. Этапы (~4.5–5.5 дн ядро + 1–2 дн импорт)

| # | Что | Объём |
|---|---|---|
| 0 | Миграции: options_json × 2 таблицы + CHECK + GRANT | 0.5 д |
| 1 | `taskOptions.ts` + Deno-зеркало + parity-тест + типы | 0.5 д |
| 2 | Edge: write-sites, student/AI-селекты, рендер в 3 промпта + bootstrap | 1 д |
| 3 | Грейдинг: ветка + precomputedVerdict + canned-fallback + перенос квота-гейта | 1–1.5 д |
| 4 | Клиент-носители (path A+B, edit round-trip, бейдж) | 0.5–1 д |
| 5 | StructuredAnswerPanel + интеграция | 1 д |
| 6 | Импорт OTP (парсер + превью-гейт + заливка) | 1–2 д |

## 9. Риски

1. Пропуск write-site → NULL в одном flow (grep всех 5 + kb_snapshot перед мержем).
2. Edit-clobber без этапа 4 — не разносить с этапом 2 по релизам.
3. AI противоречит коду → принудительная перезапись verdict/score результатом кода в sanitize.
4. Утечка ответа в объяснении на INCORRECT → промпт-запрет + canned-fallback.
5. Перенос квота-гейта — чувствительное место, нестуктурный путь оставить байт-в-байт.
6. >9 вариантов ломает посимвольные чекеры → кап в normalizer.
