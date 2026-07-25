# Mock Exams — инварианты (всегда в контексте)

Здесь ТОЛЬКО первично-нарушаемое. **Глубина — skill `mock-exams`** (AI-грейдер Части 2, OCR бланков, режимы проверки по предметам, репетиторские варианты и CRUD, пауза/мульти-сессия, ExamProfile registry, шкалы, курирование Ч2, сиды вариантов).

## Anti-leak — STATE-AWARE, НЕ копировать модель ДЗ

Reveal зависит от `attempt.status`. Это **не** «никогда не показывать ученику»:

| Статус | Что раскрывается |
|---|---|
| `in_progress` / `paused` | **ничего**; result-endpoint отказывает (409/410). `correct_answer` не должен попасть даже в память процесса |
| `submitted` / `ai_checking` / `awaiting_review` | Часть 1 (`correct_answer`, `kim_number`) + предварительный AI-балл и `feedback` Части 2 |
| `approved` | Часть 2 полностью (`solution_text`, `tutor_score`, `tutor_comment`) — **это и есть ценность продукта** |

`ai_draft_json` / `ai_part1_ocr_json` — **никогда** ученику, ни при каком статусе (tutor-only артефакты). Из `ai_draft_json` ученику уходят ТОЛЬКО `suggested_score` и `feedback`; `comment_for_tutor` / `flags` / `elements_check` — нет.

**Контраст с ДЗ:** там `solution_text`/`rubric_*` tutor-only **навсегда** (rule 40). Если ревьюер флагает «утечка solution_text на странице результата» — проверь гейт `status === 'approved'`: post-approval reveal сделан **намеренно**.

**Новый pre-submit статус** ОБЯЗАН попасть в early-reject result-эндпоинта и НЕ попасть в post-submit allowlist (дыра `paused` возникла ровно из этого пропуска).

`mock_exam_variant_tasks` SELECT — **tutor-only** (`is_tutor(auth.uid())`, миграция `20260607130000`). Ученик читал бы `correct_answer` и эталоны Части 2 прямым PostgREST посреди экзамена. Новое клиентское чтение этой таблицы — только tutor-only; студенческие пути идут через service_role edge.

## Варианты — ownership и единственный write-path

- **Единственный write-path вариантов — edge `mock-exam-tutor-api`** (клиентских write-политик/грантов на `mock_exam_variants` / `_variant_tasks` нет). Замена задач — атомарной RPC (`mock_exam_variant_replace_tasks`), не delete+insert из edge.
- **Variant-ownership ОБЯЗАН быть и в `WITH CHECK` назначений.** У authenticated есть ПРЯМЫЕ INSERT/UPDATE-политики на `mock_exam_assignments`, а **FK не применяет RLS целевой таблицы** → без гарда `mock_exam_variant_usable_by()` любой вставлял бы assignment с чужим личным `variant_id` мимо edge и вытягивал `correct_answer` через student-edge. **Любой новый write-path, принимающий `variant_id`, обязан проверять «каталожный ИЛИ мой».**
- `owner_id` (NULL = каталог) — **отдельная колонка от `created_by`**; `ON DELETE RESTRICT`, т.к. `SET NULL` «утёк» бы личный вариант в каталог.
- «Вариант в работе» → контент-правки **блокируются** (409 `VARIANT_IN_USE`); авторитет — гард внутри RPC, а не pre-check в edge.

## AI-грейдер — frozen contract, никогда не автопубликует

- **Frozen JSON shape** (зеркало `src/types/mockExam.ts::MockExamPart2Draft`) — расширять только аддитивно.
- Подтверждение репетитором **обязательно**; AI никогда не публикует ФИНАЛЬНЫЙ балл сам.
- **Машина состояний:** `in_progress → submitted → ai_checking → awaiting_review → approved`. Submit оставляет `submitted`; статус `ai_checking` ставит только CAS-claim грейдера — **никогда напрямую в submit-хендлере**.
- Stale-lock = **120с** во всех 3 callsite (грейдер CAS, `retry-part1-ocr`, `regrade-part2`).
- Bulk Часть 2 **никогда не перезаписывает** строки со `status IN (tutor_approved, tutor_modified)` — только `ai_draft_json`.
- Approve **никогда не блокируется**: отсутствующие баллы авто-занулятся с прозрачным `tutor_comment`.
- Fail-closed по subject: сбой чтения `subject`/`exam_type` варианта → 500, **НЕ** молчаливая деградация к физике (грейдила бы чужой предмет физ-рубрикой).

## `total_score` — STORED, не производное

Инвариант: при непустом значении `total_score = COALESCE(total_part1_score,0) + COALESCE(total_part2_score,0)`.

**Каждая запись пер-задачного балла ОБЯЗАНА вызвать атомарную RPC `mock_exam_resync_attempt_totals(_attempt_id)`** сразу после upsert (хелпер `resyncAttemptTotals`). Inline JS read-sum-update **не возрождать** — он был racy при конкурентных post-approval правках. `manually_entered` исключён (его total вводит репетитор).

## Часть 1 — зеркало чекера и предметные карты

- **Deno-mirror инвариант:** `src/lib/mockExamPart1Checker.ts` ↔ `supabase/functions/_shared/mock-exam-part1-checker.ts` логически идентичны. Симптом дрейфа: «превью говорит верно, финал даёт 0». Гард — `scripts/test-mockexam-checkmode-parity.mjs` (smoke §15).
- Источник истины набора режимов — реестр `MOCK_EXAM_CHECK_MODES`. Добавляя режим: реестр + Deno-зеркало + evaluator в оба диспатча + `CHECK_MODE_OPTIONS` + `VALID_PART1_CHECK_MODES` + OCR-промпты + CHECK-миграция. Пропуск места роняет `npm test`.
- **У каждого предмета СВОЯ карта КИМ→режим.** Никогда не переиспользовать физическую карту для другого предмета: номера пересекаются, критерии разные (обществознание: замена цифры = 0, физика = 1 балл).
- Частичный балл только там, где он есть у ФИПИ — не «протекать» в strict/unordered/task20/pair.
- **Кириллица + `\b` ЗАПРЕЩЕНЫ** в Deno-регэкспах рубрик: JS `\b` ASCII-only, `/\bЕГЭ/` не матчит. Только `hasWord` / `(?<![\p{L}\p{N}])…` с флагом `u` (lookbehind в Deno безопасен, в клиенте — нет, rule 80).

## Предметность

Новый предметный элемент студенческой/публичной поверхности пробника обязан гейтиться `getExamProfile(subject, exam)` либо `subject` + `normalizeExamType` — **не одним предметом**. Шкала/бенчмарки ЕГЭ-физики (`getEgePhysicsBenchmarks`) отдаёт значения только при `exam_type='ege_physics'` и max 45; иначе тестовый балл и пороги скрываются. Физика ОБЯЗАНА писаться легаси-значениями `ege_physics`/`oge_physics`, остальные предметы — generic `ege`/`oge`.
