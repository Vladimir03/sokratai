# Feature Spec: Mock Exam Grading v2 — надёжность привязки фото к задачам (Часть 2)

**Версия:** v0.1
**Дата:** 2026-06-07
**Автор:** Vladimir (+ Claude как аналитик)
**Статус:** draft

> Источник: data-driven диагностика проверки пробников ЕГЭ-физики (см. §2 + Appendix A).
> Замер выполнен read-only запросами над `mock_exam_*` (см. `scripts/mock-exam-grading-report.sql`).
> Канон инвариантов грейдинга — `.claude/rules/45-mock-exams.md` (далее «rule 45»).

---

## 0. Job Context (обязательная секция)

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Репетитор (B2B) | **R1 — Автоматическая проверка ДЗ** (та же работа, применённая к пробнику) | **R1-1** собрать/привязать сданные работы · **R1-2** распознать рукописное решение (критерий ≥95%) · **R1-4** сформировать черновик фидбека | `SokratAI_AJTBD_job-graphs/SokratAI_AJTBD_elite-physics-finish-sprint-job-graph.md#R1` |

> Фича не вводит новую работу — она **восстанавливает уже обещанную**: «AI проверяет работу за тебя». Баг сидит ровно в связке **R1-1 → R1-2** (фото не доезжает до распознавания → AI пасует), из-за чего ломается и **R1-4** (черновик не формируется). Сама классификация ошибок (**R1-3**) уже работает — грейдинг 98% (см. §2). Проверка пробника = тот же job R1, но применённый к пробнику, а не к ДЗ.

### Wedge-связка

- **B2B-сегмент:** B2B-1 (Премиальные репетиторы мини-групп) — пилот Вадим, Елена, Егор.
- **B2C-сегмент:** B2C-1 (Финишная прямая ЕГЭ по физике).
- **Score матрицы:** (подтвердить из `SokratAI_AJTBD_b2b2c-cross-segmentation-matrix.md`).
- **Точки совпадения (из Графа):** надёжный AI-черновик (R1-3) питает **S2-2** (школьник — быстрый фидбек) и **P2-1/P2-2** (родитель — факт и тип ошибок). Фикс усиливает всю B2B2C-цепочку, а не только репетитора.

### Pilot impact

Сейчас AI ставит балл лишь на ~49% задач Часть 2; на остальных репетитор грейдит **вручную и без AI-черновика**, а в части случаев ещё и **сам вручную переназначает фото**. Фича возвращает AI-черновик на восстановимые задачи и убирает ручную доводку → прямая экономия времени репетитора на ключевом сценарии пилота. **Без смены AI-модели и без нового грейдинг-конвейера.**

---

## 1. Summary

Две **аддитивные backend-правки** (rule 45-совместимые), устраняющие узкое место проверки Часть 2 — **ненадёжную привязку фото→задача (Pass-1)**, а НЕ качество грейдинга (оно уже ~98%, см. §2):

- **P0 — авто-перепроверка после ручного переназначения фото** репетитором (убирает ведро `awaiting_regrade`).
- **P1 — закалка fallback'а Pass-1 bulk-assignment** (убирает «один сбой → `photo_missing` на всю Часть 2»).

Изменяется только control-flow существующих edge-функций. **Схема БД, `ai_draft_json` (frozen shape), модель, обязательность approval — не трогаются.**

---

## 2. Problem

### Текущее поведение

Часть 2 проверяется в 2 прохода (rule 45): Pass-1 (один Gemini-вызов) раскладывает bulk-фото по КИМ; Pass-2 грейдит каждую КИМ. Если фото не доехало до задачи → `suggested_score=null` + флаг `photo_missing` → **AI «пасует»**, репетитор делает всё руками.

### Боль (измерено 2026-06-07, n=107 проверенных задач Часть 2)

- **Грейдинг — НЕ проблема:** на 52 задачах, где AI поставил балл, расхождение с тутором **2%, MAE 0.02** (по всем КИМ 21–26).
- **Пасы — проблема:** **55 из 107 (51%)** задач AI не оценил. Разбор причин:

| Флаг паса | n | Смысл (по коду) |
|---|---|---|
| `photo_missing` | 29 | Pass-1 оставил КИМ без фото (но в **85% пасов фото в пакете БЫЛИ** → не доехали) |
| `awaiting_regrade` | 20 | Репетитор **вручную переназначил** фото → AI-балл обнулён → перепроверка не запустилась |
| `kim21_qualitative` | 7 | качественная №21 |
| `photo_off_topic` | 5 | фото не от той задачи |
| `ai_invalid_response` / `ambiguous_grading` | 1 / 1 | хвост |

- Из 55 пасов: **14 — `tutor_gave_points>0`** (ответ был и читаем → AI зря спасовал, точно восстановимо); **41 — tutor 0** (в основном ученики не делали Часть 2 — это норма, не дефект AI).

### Корневая причина (подтверждена кодом)

Оба больших ведра → **ненадёжность Pass-1 photo→KIM**:
- `mock-exam-grade/index.ts` (~1560-1564): при любом сбое Pass-1 — fallback «все фото → `unassigned` → каждая КИМ `photo_missing`». Один сорванный вызов (RU-DPI рвёт TLS — см. rule 95) обнуляет AI-помощь на всю Часть 2.
- `mock-exam-tutor-api/index.ts` (~2645-2689): ручное переназначение фото инвалидирует AI-черновик (`suggested_score=null`, `confidence='low'`, `flags+=['awaiting_regrade']`) и **ждёт ручного клика «Перепроверить AI»**, которого часто не происходит.

### Текущие «нанятые» решения

Репетитор обходит баг руками: переназначает фото через select-dropdown и/или ставит балл вручную. Эту ручную работу и убираем.

---

## 3. Solution

> **Реализовано как Variant A** после review-раунда 1 (ChatGPT-5.5 → FAIL → переделка, см. Appendix B). Исходный backend fire-and-forget на каждый save дал две гонки (P0 #1 — потеря привязки через `setDirty`; P0 #2 — параллельные грейдеры без claim). Заменён на единый фронтовый pipeline + CAS-claim в грейдере.

### P0 — единый debounced pipeline save→regrade (фронт) + CAS-claim (грейдер)

Backend авто-fire из `/assign-part2-photos` **убран**. Вместо него:
- **Фронт (`TutorMockExamReview`)**: после idle (800 мс) один путь `latest assignments → saveMutation.mutateAsync → regradeMockExamPart2 → invalidate → setDirty(false)`. `isPending`-gate сериализует прогоны в одной вкладке (правка во время regrade ждёт его конца, затем эффект сам перезапускается для последней версии). Отдельного авто-save больше нет.
- **`dirty` снимается только** после успешного regrade И только если локальная версия (`editVersionRef`) не менялась с момента старта pipeline — иначе pipeline перезапускается для новой версии.
- **`handleGrade` (грейдер)**: атомарный CAS-claim `awaiting_review → ai_checking` для regrade (зеркало `submitted`-claim). Без него два конкурентных regrade (multi-tab / ручной+авто) пишут `ai_draft_json` last-writer-wins. Финальный переход `ai_checking → awaiting_review` round-trip'ит обратно.
- **busy-контракт**: grader вернул 202 (другой runner уже считает) → `regrade-part2` отдаёт `{ regraded:false, busy:true }`; фронт НЕ снимает dirty, тост «AI уже проверяет — привязка сохранена, пересчёт применится после».

Ручная кнопка «Перепроверить AI» — тот же `regradeMutation` (унифицировано).

### P1 — закалка fallback Pass-1

При сбое Pass-1 bulk-assignment **полагаемся на внутренний ретрай `callLovableJson`** (35с + 1 retry); внешний ретрай **убран** (иначе суммарный Pass-1 мог превысить 120с stale-lock → reclaim другим runner'ом, review P1 #1). На сбой — fallback меняется с **«никому» на over-include**: раздать все bulk-фото каждой **не-tutor-locked** КИМ, Pass-2 отсеет нерелевантные через `photo_off_topic`. Лучше переоценить (репетитор подтвердит), чем обнулить всю Часть 2.

### Ключевые решения

- **Никакой смены модели / нового конвейера.** Грейдинг уже точный; рычаг — маршрутизация фото + надёжность перепроверки.
- **Один pipeline** для ручной и авто-перепроверки; не дублируем грейдинг-логику (reuse `regrade-part2`).
- **Single-grader discipline через CAS-claim** на `awaiting_review`, а не fire-and-forget «грейдер сам разрулит».
- **over-include fallback** — только на сбой Pass-1 и только к не-tutor-locked КИМ (rule 45).

### Scope

**In scope:**
- P0: фронтовый pipeline save→regrade + version-guard + busy-UX (`TutorMockExamReview`); CAS-claim `awaiting_review→ai_checking` + busy-202 (`mock-exam-grade` + `mock-exam-tutor-api`).
- P1: over-include fallback без внешнего ретрая в Pass-1 (`mock-exam-grade`).
- Телеметрия событий (PII-free).

**Out of scope:**
- ❌ Смена AI-модели (DeepSeek/Qwen/Pro) — грейдинг и так 98%, модель узкое место не двигает.
- ❌ Покритериальный / адверсариальный грейдинг-конвейер.
- ❌ P2 UX (вынести непривязанные фото наверх + привязка в 1 клик) — отдельная фронт-задача (нужен `deploy-sokratai`).
- ❌ Авто-публикация (approval остаётся обязательным).
- ❌ Часть 1.

---

## 4. User Stories

### Репетитор
> Когда AI не смог сам разложить фото по задачам и я переназначил их вручную, я хочу, чтобы AI **сам** пересчитал баллы, чтобы мне не приходилось отдельно жать «Перепроверить AI» или ставить балл руками.

> Когда один AI-вызов раскладки фото сорвался, я хочу, чтобы AI всё равно попробовал оценить решения, а не помечал всю Часть 2 как «фото нет».

---

## 5. Technical Design

### Затрагиваемые файлы
- `supabase/functions/mock-exam-tutor-api/index.ts` — handler `/assign-part2-photos`: после reassignment с `awaiting_regrade` → fire-and-forget вызов внутренней логики `regrade-part2`.
- `supabase/functions/mock-exam-grade/index.ts` (~1500-1564) — Pass-1: ретрай + over-include fallback вместо punt-all.
- (опц.) `supabase/functions/_shared/mock-exam-prompts.ts` — если over-include требует хелпера сборки assignment «всем».

### Data Model
**Без изменений.** Ни таблиц, ни колонок, ни RPC, ни миграций. `ai_draft_json` — **frozen shape**, ставятся только существующие поля (`suggested_score`, `confidence`, `flags`, `assigned_photo_indices`).

### API
**Без новых endpoint'ов.** P0 переиспользует существующий `regrade-part2`. `config.toml` / deploy-workflow **не меняются** (rule 96 #11 — новых функций нет).

### Миграции
Нет.

---

## 6. UX / UI

- P0/P1 — backend, видимого UI у самой авто-перепроверки нет. **Решено (Q2):** после reassignment показывать **toast «AI пересчитывает баллы…»**, чтобы репетитор понял, что не надо жать «Перепроверить AI» вручную — это **фронтовая** правка → потребует `deploy-sokratai` (backend-часть Lovable деплоит сама).
- UX-принципы (doc 16): «каждый AI-выход заканчивается действием» — авто-regrade возвращает actionable черновик вместо тупика «оцените вручную».
- P2 (faster manual assign UX — вынести непривязанные фото наверх + привязка в 1 клик) — отдельная спека.

---

## 7. Validation

### Как проверяем успех? (до/после через `scripts/mock-exam-grading-report.sql`)
- **Доля пасов `awaiting_regrade`** (Query E/F): порог — **→ ~0** на новых попытках после reassignment (P0).
- **`photo_missing` при `attempt_had_photos=true`** (Query D/F): порог — **заметное снижение** (P1).
- **Точность грейдинга без регресса** (Query A/B): `correction_pct` и `mae` на оценённых строках — **не хуже** baseline (2% / 0.02).
- **Восстановимость** (Query F): рост доли пасов, превращённых в AI-черновик.

### Связь с pilot KPI (doc 18)
↓ время репетитора на проверку пробника; ↑ доля задач Часть 2 с AI-черновиком.

### Smoke check
```bash
npm run lint && npm run build && npm run smoke-check
```
(P0/P1 — edge-функции; основной риск-гейт — ручной прогон проверки пробника + повторный `mock-exam-grading-report.sql`.)

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| over-include fallback → Pass-2 видит чужие фото → ложный балл | Средняя | применять ТОЛЬКО к катастрофическому сбою Pass-1; полагаться на существующий `photo_off_topic`; approval обязателен |
| over-include ↑ стоимость Pass-2 (каждая КИМ × N фото) | Низкая | только в fallback-ветке (не на happy path); пробники низкочастотны |
| авто-regrade ловит tutor-locked строки | Низкая | regrade уже сохраняет `tutor_approved/tutor_modified` + `assigned_photo_indices` (rule 45) |
| двойной авто-regrade при частых reassign | Низкая | существующий CAS + stale-lock 120s → 409, второй игнорируется |
| авто-regrade «удивит» репетитора в момент ручной простановки | Низкая | трогает только non-tutor-locked строки; опц. toast |

### Решения (2026-06-07)
1. **Job ID — решено:** R1 (Автоматическая проверка ДЗ); sub-jobs R1-1 / R1-2 / R1-4.
2. **over-include — решено:** раздавать только **не-оценённым / не tutor-locked КИМ** (уже оценённые не трогаем — rule 45).
3. **toast — решено (Q2):** показывать «AI пересчитывает баллы…» (фронтовая правка → `deploy-sokratai`).
4. **Бэкфилл — рекомендация:** **forward-only** + точечный спот-чек 2–3 исторических `awaiting_regrade` для QA пути `regrade-part2`. Полный ретро-бэкфилл — только если forward-выборка пилота окажется слишком мала для замера (обоснование — в сопроводительном сообщении).

---

## 9. Implementation Tasks

> ⚠️ **P0 пока НЕ реализуем** (по решению владельца — сначала approve спека). Перенести в `mock-exam-grading-v2-tasks.md` после approve.

- [ ] **TASK-1 (P0):** авто-`regrade-part2` после reassignment в `/assign-part2-photos` (fire-and-forget, толерантно к 409).
- [ ] **TASK-2 (P1):** ретрай Pass-1 (×1) + over-include fallback вместо punt-all в `mock-exam-grade`.
- [ ] **TASK-3:** телеметрия `mock_exam_part2_auto_regrade_triggered` + `mock_exam_part1_assign_fallback{mode}` (PII-free).
- [ ] **TASK-3b (фронт):** toast «AI пересчитывает баллы…» после reassignment (→ `deploy-sokratai`).
- [ ] **TASK-4:** прогнать `scripts/mock-exam-grading-report.sql` до/после, приложить дельту.
- [ ] **TASK-5 (опц.):** ретро-бэкфилл `regrade-part2` по историческим `awaiting_regrade`.

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0)
- [x] Привязка к Core Job из Графа работ (R1 — Автоматическая проверка ДЗ)
- [x] Scope чётко определён (in/out)
- [x] UX-принципы из doc 16 учтены (action-ended AI output)
- [x] Pilot impact описан
- [x] Метрики успеха определены (через `mock-exam-grading-report.sql`)
- [x] High-risk файлы не затрагиваются без необходимости (edge-функции грейдинга — по делу)
- [x] Student/Tutor изоляция не нарушена
- [x] rule 45 инварианты сохранены (frozen `ai_draft_json`, approval, CAS/stale-lock, tutor-status preservation, `total_score` RPC не тронут)

---

## Appendix A — Baseline-замер (2026-06-07)

Снимок «до» (n=107 проверенных задач Часть 2, пилот физика-ЕГЭ):

- Оценённых AI: 52 → `correction_pct`=2%, `mae`=0.02, `bias`=−0.02 (по КИМ: 21–24,26 = 0 правок; 25 = 1/11).
- Калибровка: все 52 оценённых = `confidence:'high'` (спектра нет → триаж по confidence пока невозможен).
- Пасов: 55/107 (51%) — `photo_missing`=29, `awaiting_regrade`=20, `kim21_qualitative`=7, `photo_off_topic`=5, прочее=2.
- Диагноз пасов: `attempt_had_photos`=47/55, `tutor_gave_points`=14, `tutor_gave_zero`=41.

Запросы для повторного замера: `scripts/mock-exam-grading-report.sql`.

---

## Appendix B — Review round 1 (ChatGPT-5.5) → Variant A rework (2026-06-07)

Первая реализация P0 = backend fire-and-forget авто-regrade из `/assign-part2-photos` + поле `auto_regrade_triggered` + toast/`setDirty(false)` на фронте. **Вердикт: FAIL** — две гонки + одна латентность:

| # | Sev | Находка | Фикс в Variant A |
|---|---|---|---|
| P0 #1 | блокер | `setDirty(false)` в debounced-save success отменял более новую отложенную привязку (B), регрейдил по A; кнопка disable'илась (`!dirty`) → правка тутора терялась | Единый pipeline; `setDirty(false)` только при `editVersionRef === startVersion`. Авто-save как отдельный триггер убран. |
| P0 #2 | блокер | `handleGrade` не клеймил `awaiting_review` (комментарий «не требует claim») → два конкурентных regrade писали `ai_draft_json` last-writer-wins, старший runner восстанавливал stale привязку. Авто-fire на каждый save делал дыру эксплуатируемой (pre-existing и в ручном `handleRegradePart2`) | CAS-claim `awaiting_review→ai_checking` в `handleGrade` (202 на проигрыш). Фиксит и ручной путь. busy-контракт через `regrade-part2`. |
| P1 #1 | важно | внешний Pass-1 ретрай ×2 поверх `callLovableJson` (35с+1) → до ~140с > 120с stale-lock → reclaim другим runner'ом | Внешний ретрай убран; полагаемся на внутренний ретрай + over-include fallback. |
| P3 #1 | nit | имя телеметрии расходилось со спекой | Спека приведена под код-имя `mock_exam_grade_bulk_assign_over_include_fallback` (точнее: Часть 2). |

**Решение по дизайну (Vladimir):** «single debounced save+regrade pipeline» — не переносить fire с backend на frontend, а убрать отдельный авто-save и после idle гонять один путь. Variant B (заплатки на fire-and-forget) отклонён: оставлял UX-кейс «B сохранён, но не переоценён».

**Статус:** P0 + P1 реализованы (Variant A), lint/build/smoke-check ✓. Готово к review-раунду 2.
