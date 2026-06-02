# Хэндофф в Claude Code — kickoff + тикеты v1.0
### Фича «Прогресс по ученикам + галочка „проверено“» · 2026-06-02

## Что передаём Claude Code (два источника + правила)

| Артефакт | Роль | Где |
|---|---|---|
| **`spec.md`** | **источник истины**: модель данных, миграции, RPC, edge-контракты, anti-leak/Safari инварианты, acceptance-критерии, фазинг | `docs/delivery/features/student-progress/spec.md` |
| **`design-handoff/`** (бандл Claude Design) | визуал/layout/поведение + рабочий прототип потока + таблица переиспользования | `docs/delivery/features/student-progress/design-handoff/` (README + 9 HTML + `flow/`,`hero2/`,`usp/`,`hw3/`,`report/`) |
| `01..04-*.md` | контекст: кастдев, AJTBD-PRD, дизайн-бриф, шкалы баллов | та же папка |
| `.claude/rules/*` | инварианты репо (40 dual write-path, 80 Safari, 90 дизайн-система, 97 ошибки edge, 95 deploy) | репо |

**Контракт ролей (жёстко):** `spec.md` = ЧТО строим и инварианты; бандл = КАК выглядит; `.claude/rules` = КАК принято в репо. Бандл — **референс, не код для копирования**. Переиспользовать существующие компоненты, **не перерисовывать**.

---

## Kickoff-промпт (вставить в Claude Code)

```
Реализуем фичу «Прогресс по ученикам + галочка „проверено“», v1.0 (физика-ЕГЭ).

Источники (прочитай ВСЕ перед планом):
• docs/delivery/features/student-progress/spec.md — ИСТОЧНИК ИСТИНЫ: модель
  данных, миграции, RPC, edge-контракты, anti-leak/Safari инварианты,
  acceptance-критерии (Given/When/Then), §10 QA-чеклист, §11 resolved decisions.
• docs/delivery/features/student-progress/design-handoff/README.md + HTML/JSX —
  визуал, layout, поведение, состояния, таблица переиспользования компонентов.
• docs/delivery/features/student-progress/04-score-scales.md — таблица ФИПИ
  ЕГЭ-физика (EGE_PHYS.map), score_kind, пороги.
• .claude/rules/* — инварианты репо.

Правила:
1. spec.md > бандл при любом расхождении по данным/логике. Бандл = только визуал.
2. ПЕРЕИСПОЛЬЗУЙ существующее, не строй заново: HeatmapGrid + heatmapStyles +
   StudentDrillDown + TaskMiniCard (Results v2), EditScoreDialog, approve-паттерн
   пробника (mock_exam), public-homework-share → /p/:slug, group-by из
   StudentsActivityBlock, computeFinalScore. Грепни их перед написанием нового.
3. Соблюдай .claude/rules: 40 (dual write-path на homework_tutor_task_states +
   column-GRANT whitelist + strip-функции), 80 (Safari: border-separate таблицы,
   инпуты ≥16px, touch-action, 100dvh, без lookbehind), 90 (дизайн-система,
   зелёный только success), 97 (edge-ошибки {error,code} по-русски).
4. Старт = v1.0 (R1 галочка + R2 успеваемость/страница ученика). R3 отчёт и R4
   ручные активности — отдельный заход (v1.1), сейчас НЕ делать.
5. Порядок внутри каждого тикета: миграция → RPC → edge → frontend → QA-гейт.
6. Используй plan mode для multi-file; делегируй «грепни все write-sites» сабагенту
   (Explore). Перед merge каждого тикета — прогон §10 QA-чеклиста из spec.md.

Начни с плана по тикетам ниже (T1.1 → T2.4), затем жди подтверждения перед кодом.
```

---

## Тикеты v1.0 (порядок реализации)

> **Зависимость R1 → R2:** UI подтверждения из R1 переиспользуется в drill-down страницы ученика (R2). Делать R1 первым.

### R1 — Галочка «проверено» (паритет с approve пробника)

**T1.1 · Миграция: `tutor_reviewed_*` + GRANT + strip**
- `homework_tutor_task_states`: `tutor_reviewed_at TIMESTAMPTZ NULL` (GRANT SELECT authenticated — видна ученику), `tutor_reviewed_by UUID NULL` (НЕ грантить authenticated — service_role only).
- Расширить column-GRANT whitelist (паттерн миграции `20260516120100`) + добавить `tutor_reviewed_by` в `stripStudentSensitiveTaskStateFields`.
- AC: ученик видит `tutor_reviewed_at`, НЕ видит `tutor_reviewed_by`.

**T1.2 · RPC подтверждения (атомарные, mirror force-complete)**
- `hw_tutor_review_task`, `hw_tutor_review_all_ai` (баллы НЕ трогает), `hw_tutor_reopen_review`. SECURITY DEFINER, `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE service_role`, race-guard → 409 `ALREADY_REVIEWED`.
- AC: spec §8 R1 (повторное подтверждение → 409, bulk не меняет баллы, reopen чистит флаг).

**T1.3 · Edge-эндпоинты** (`tutor-progress-api`, verify_jwt=true)
- `POST /assignments/:id/students/:sid/{review-task,review-all-ai,reopen-review}` — обёртки над RPC + ownership (`assignment.tutor_id=auth.uid()`). Ошибки {error,code} по-русски (rule 97).
- Регистрация: `supabase/config.toml` + deploy workflow + `scripts/supabase-drift-check.mjs` (rule 96 #11).

**T1.4 · Frontend: подтверждение в работе**
- Расширить `EditScoreDialog`: чекбокс «Подтвердить задачу» + CTA «Сохранить и подтвердить»/«Сохранить балл» (mirror force-complete). Инпут ≥16px.
- Per-task «Подтвердить» + bulk «Подтвердить всё, что AI проверил (N)» (AlertDialog «баллы не трогаются») + reopen. Переиспользовать `StudentDrillDown`/`HeatmapGrid`/`TaskMiniCard`.
- Anti-leak плашка (spec §4.3). Кейс без AI-вердикта → «Поставить балл и подтвердить». Mobile: bottom-sheet.
- Референс визуала: `design-handoff/hw3/` + «Проверка работы - *.html».

**T1.5 · QA-гейт R1** — §10 чеклист: dual write-path grep, strip, GRANT, Safari, телеметрия (`task_reviewed`). Прогнать AC R1.

### R2 — Успеваемость + страница ученика

**T2.1 · Миграция: `tutor_student_targets`** (track/subject/target_score/scale_year) + RLS (tutor через `tutor_students`). spec §2.2.

**T2.2 · Edge: агрегат + обзор + цель**
- `GET /students/:id/progress` (агрегат ДЗ+пробники через `computeFinalScore` — НЕ дублировать; column-whitelist: без `solution_*`/`rubric_*`/`ai_score_comment`/hints).
- `GET /students/progress-overview` (нормализ. `pct_to_goal` по треку; **два сигнала** attention раздельно — `review_backlog`/`overdue` vs `behind_goal`/`declining`; группы; пагинация на 100+).
- `PATCH /students/:id/target` (цель). `current_level` = последний подтверждённый пробник (spec §11 Q2; нет → null → «нужен пробник»).

**T2.3 · Frontend: обзор + страница ученика**
- Подвкладка «Успеваемость» в `/tutor/students` (`StudentsProgressOverview`): два бара различимы (% к цели акцентный, % проверено тише), два сигнала, фильтр «есть непроверенное», group-by (`StudentsActivityBlock` паттерн), виртуализация. Трек-чип нейтральный.
- Страница `/tutor/students/:id` («Прогресс»): карточка «Прогресс к цели» (родная шкала + спарклайн + засечки порогов ФИПИ + редакт. цель) → метрики → bulk CTA → карточки работ (родной rollup через `score_kind`, мини-карта, цвет=%) → drill-down = реальный `HeatmapGrid` + R1-подтверждение.
- **Точки входа (spec §4.0):** блоки на Главной («Требует проверки» → проверка; «Отстают» → ученик) + per-student deep-link.
- `score_kind`/`EGE_PHYS` из `04-score-scales`. Mobile per `design-handoff`. Новые `useQuery` → `refetchOnWindowFocus:false`.
- Референс: `design-handoff/usp/` + `hero2/` + соответствующие HTML.

**T2.4 · QA-гейт R2** — column whitelist (без leak), `refetchOnWindowFocus:false`, Safari border-separate таблицы, шкала честная (нет фейкового среднего /5), AC R2. Телеметрия `student_progress_opened`/`progress_overview_opened`.

---

## v1.1 (отдельный заход, после пилота v1.0)
- **R3 Отчёт родителю** `/p/:slug`: `student_report_share_links` + `public-student-report` (column-whitelist, expiry≠404, PII-free telemetry, escapeHtml) + builder + публичная страница под скриншот (spec §2.4/§3.4/§4.4, Q4). Референс: `design-handoff/report/`.
- **R4 Ручные активности + заметки Вадима**: `tutor_manual_activities` + школьный трек ручного ввода (spec §2.3).

---

## 🚀 Deploy needed (после реализации фронта)
Фича затронет `src/**` → после merge нужен ручной деплой на VPS (rule 95):
```
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
deploy-sokratai
```
Backend (миграции + edge) Lovable Cloud применит автоматически после push; `sokratai.ru` (frontend) — только через `deploy-sokratai`.
