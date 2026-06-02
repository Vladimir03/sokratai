# Tasks — Прогресс по ученикам + галочка «проверено»
### Шаг 5 пайплайна · нарезка спеки на задачи + промпты для агентов · 2026-06-02

> **Спека:** [`spec.md`](./spec.md) (источник истины). **Дизайн:** [`design-handoff/`](./design-handoff/) + README. **Шкалы:** [`04-score-scales.md`](./04-score-scales.md).
> **Job Graph:** репетитор R1-5 / R3-1..3 / R4-4 · родитель P1-2 / P3-1/2 · школьник S2-4 (отложен).
> **Агенты:** Claude Code (автор) → Codex (ревью, чистая сессия, doc 19/20) → деплой VPS (rule 95).
> **Порядок:** v1.0 = TASK-1..8 (R1-5 галочка + успеваемость/страница). v1.1 = TASK-9..10 (отчёт + ручные активности). Внутри задачи: миграция → RPC → edge → frontend → QA.
> **Зависимость:** TASK-4 (UI подтверждения) переиспользуется в TASK-7 (drill-down страницы ученика) → R1 раньше R2.

---

## v1.0

> **Статус R2 (TASK-5..7) — ✅ реализовано (2026-06-02, Claude Code).** Цель = reuse `tutor_students` (TASK-5, без миграции) · edge `tutor-progress-api` +3 эндпоинта (overview/progress/target, service_role + Deno-агрегация, FK-конверсия, column-whitelist, два сигнала) · shared `score-scales` (frontend+Deno, smoke-guard #10) · frontend: подвкладка «Успеваемость» (`StudentsProgressOverview`), страница `/tutor/students/:id/progress` (`StudentProgressPage`, goal card + sparkline + редакт. цель + work cards + drill-down → существующий `/tutor/homework/:id?student=`), home-блок «Ученики отстают». `computeFinalScore` вынесен в `_shared/score-compute.ts` (не дублирован). build + smoke + drift + lint green. **Open: Manual QA + Codex review (Промпт C); R3 (отчёт, TASK-9..10) — v1.1.**
>
> **Статус R1 (TASK-1..4) — ✅ реализовано (2026-06-02, Claude Code).** Миграции `20260602090000` (колонки+GRANT+strip) / `20260602090100` (3 RPC) · edge `tutor-progress-api` (config.toml + deploy workflow + drift-check clean) · frontend (EditScoreDialog review-чекбокс, GuidedThreadViewer per-task «Подтвердить», StudentDrillDown bulk, TaskMiniCard/SubmitCtaBar/TaskStepper бейджи). `npm run build` + `smoke-check` green. Manual QA + Codex review (Промпт C) — pending. Спека секции в `.claude/rules/40-homework-system.md → «Tutor review (галочка проверено)»`. План: `~/.claude/plans/senior-scalable-scott.md`.

### TASK-1: Миграция — `tutor_reviewed_*` + GRANT-whitelist + strip
**Job:** R1-5 · **Agent:** Claude Code · **AC:** spec §5(1,3), §8 R1
**Files:** `supabase/migrations/*_add_tutor_reviewed_to_task_states.sql`, `supabase/functions/_shared/*` (strip)
- `homework_tutor_task_states`: `tutor_reviewed_at TIMESTAMPTZ NULL` (GRANT SELECT authenticated — видна ученику), `tutor_reviewed_by UUID NULL` (НЕ грантить authenticated — service_role only).
- Расширить column-GRANT whitelist (паттерн миграции `20260516120100`) + добавить `tutor_reviewed_by` в `stripStudentSensitiveTaskStateFields`.
- **AC:** ученик видит `tutor_reviewed_at`, НЕ видит `tutor_reviewed_by`; smoke-check green.

### TASK-2: RPC подтверждения (атомарные, mirror force-complete)
**Job:** R1-5 · **Agent:** Claude Code · **AC:** spec §8 R1 (race-guard, bulk не меняет баллы, reopen)
**Files:** `supabase/migrations/*_hw_tutor_review_rpc.sql`
- `hw_tutor_review_task`, `hw_tutor_review_all_ai` (баллы НЕ трогает), `hw_tutor_reopen_review`. SECURITY DEFINER, `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE service_role`, race-guard → 409 `ALREADY_REVIEWED`.
- **AC:** повторное подтверждение → 409; bulk ставит `reviewed_at` всем `ai_score IS NOT NULL` без смены балла; reopen чистит флаг.

### TASK-3: Edge — endpoints подтверждения
**Job:** R1-5 · **Agent:** Claude Code · **AC:** spec §3.1, rule 97
**Files:** `supabase/functions/tutor-progress-api/index.ts`, `supabase/config.toml`, `.github/workflows/deploy-supabase-functions.yml`
- `POST /assignments/:id/students/:sid/{review-task,review-all-ai,reopen-review}` → RPC + ownership (`assignment.tutor_id=auth.uid()`). Ошибки `{error,code}` по-русски.
- Регистрация в `config.toml` (verify_jwt=true) + deploy workflow + `node scripts/supabase-drift-check.mjs` = clean (rule 96 #11).
- **AC:** не-владелец → 404/403; невалидный body → 4xx с русской фразой; `extractEdgeFunctionError` на клиенте.

### TASK-4: Frontend — подтверждение в работе (галочка-паритет)
**Job:** R1-5, R4-4 · **Agent:** Claude Code · **AC:** spec §4.3, §8 R1 · **Ref:** `design-handoff/hw3/`, «Проверка работы - *.html»
**Files:** `src/components/tutor/results/EditScoreDialog.tsx`, `StudentDrillDown.tsx`, `HeatmapGrid.tsx`/`TaskMiniCard.tsx` (reuse), `src/lib/tutorHomeworkApi.ts`
- Расширить `EditScoreDialog`: чекбокс «Подтвердить задачу» (default ON при `status='active'`) + CTA «Сохранить и подтвердить»/«Сохранить балл». Инпут ≥16px.
- Per-task «Подтвердить» + bulk «Подтвердить всё, что AI проверил (N)» (AlertDialog «баллы не трогаются») + reopen «Открыть обратно».
- Anti-leak плашка (ученик видит только итог + «проверено»). Кейс без AI-вердикта → «Поставить балл и подтвердить». Mobile: bottom-sheet.
- **AC:** клик «Подтвердить» → `reviewed_at`, балл залочен, исчезает из «требует проверки»; bulk не меняет баллы; reopen возвращает; рубрика/решение/подсказки не утекают.

### TASK-5: Цель ученика — ✅ ПЕРЕИСПОЛЬЗОВАН `tutor_students` (миграция НЕ нужна)
**Job:** R4-4, P1-2 · **Agent:** Claude Code · **AC:** spec §2.2 (revised) · **Статус:** ✅ 2026-06-02
**Решение (Vladimir):** НЕ создаём `tutor_student_targets`. `tutor_students` уже имеет `target_score`+`exam_type`+`subject`. `PATCH /students/:id/target` (в `tutor-progress-api`) пишет туда (ownership через `tutors.id`). `current_level` вычисляется из последнего подтверждённого пробника (Q2), не из `current_score`. Multi-subject / school-target / отдельная таблица — отложено до P2. Шкалы — shared `src/lib/scoreScales.ts` ↔ `supabase/functions/_shared/score-scales.ts` (smoke-guard секция 10).
- **AC:** tutor пишет цель только своим ученикам (ownership в edge); ege 0–100 / oge 2–5; school → 400 (каркас).

### TASK-6: Edge — агрегат ученика + обзор + цель
**Job:** R3-1, R4-4 · **Agent:** Claude Code · **AC:** spec §3.2, §3.3, §5(2)
**Files:** `supabase/functions/tutor-progress-api/index.ts`
- `GET /students/:id/progress` — агрегат ДЗ+пробники через `computeFinalScore` (НЕ дублировать); `reviewed=(tutor_reviewed_at≠null)` для ДЗ, `=(status='approved')` для пробников. Column-whitelist: без `solution_*`/`rubric_*`/`ai_score_comment`/hints.
- `GET /students/progress-overview` — нормализ. `pct_to_goal` по треку; **два сигнала attention раздельно** (`review_backlog`/`overdue` vs `behind_goal`/`declining`); группы; пагинация на 100+.
- `PATCH /students/:id/target`. `current_level` = последний подтверждённый пробник (spec §11 Q2); нет → null.
- **AC:** ответ не содержит solution/rubric/ai_comment; overview отдаёт два типа сигналов; агрегат использует `computeFinalScore`.

### TASK-7: Frontend — Успеваемость + страница ученика + точки входа
**Job:** R3-1, R4-4, P1-2 · **Agent:** Claude Code · **AC:** spec §4.0, §4.1, §4.2, §8 R2 · **Ref:** `design-handoff/usp/`, `hero2/`
**Files:** `src/pages/tutor/students/*` (новые `StudentsProgressOverview`, `StudentProgressPage`), `src/components/tutor/*`, `src/pages/tutor/TutorHome*` (точки входа)
- Подвкладка «Успеваемость» в `/tutor/students`: два бара различимы, два сигнала, фильтр «есть непроверенное», group-by (`StudentsActivityBlock` паттерн), виртуализация. Трек-чип нейтральный.
- Страница `/tutor/students/:id` «Прогресс»: карточка «Прогресс к цели» (родная шкала + спарклайн + засечки порогов ФИПИ + редакт. цель) → метрики → bulk CTA → карточки работ (родной rollup `score_kind`, мини-карта, цвет=%) → drill-down = реальный `HeatmapGrid` + подтверждение из TASK-4.
- Точки входа (spec §4.0): блоки на Главной («Требует проверки»→проверка; «Отстают»→ученик) + per-student deep-link.
- `score_kind`/`EGE_PHYS` из `04-score-scales`. Новые `useQuery` → `refetchOnWindowFocus:false, staleTime:10*60*1000`. Mobile per `design-handoff`.
- **AC:** spec §8 R2 (один экран на ученика без захода в каждую работу; в обзоре только scale-agnostic колонки; отстающий-но-дисциплинированный помечен «отстаёт»; 100+ без лагов).

### TASK-8: QA-гейт v1.0 (Codex review)
**Job:** все v1.0 · **Agent:** Codex (чистая сессия) → fix Claude Code · **AC:** spec §10 + §8 R1/R2
- Прогнать §10 чеклист: dual write-path grep, strip, column-GRANT, anti-leak SELECT, Safari (border-separate/16px/touch-action/100dvh/без lookbehind), `refetchOnWindowFocus:false`, шкала честная (нет фейкового /5), RPC REVOKE/GRANT+409, edge-ошибки rule 97.
- `npm run lint && npm run build && npm run smoke-check`.
- **AC:** PASS/CONDITIONAL/FAIL по AC R1+R2; deploy только после PASS.

---

## v1.1 (старт после feedback v1.0 от Елены)

### TASK-9: Отчёт родителю `/p/:slug`
**Job:** R3-1, R3-2, R3-3, P1-2, P3-1, P3-2 · **Agent:** Claude Code → Codex · **Ref:** `design-handoff/report/`
- `student_report_share_links` + `public-student-report` (column-whitelist, expiry≠404, PII-free telemetry, escapeHtml) + builder + публичная страница под скриншот (spec §2.4/§3.4/§4.4, Q4).
- **AC:** spec §8 R3 (без логина; только подтверждённое со статусом; expired≠404; WebView-деградация PDF; anti-leak).

### TASK-10: Ручные активности + заметки Вадима
**Job:** R4-4 · **Agent:** Claude Code → Codex
- `tutor_manual_activities` + школьный трек ручного ввода + блок «Комментарий репетитора» в отчёте (spec §2.3).

---

## Copy-paste промпты для агентов

> Plain-text, вставлять как есть. Каждый — по структуре doc 20 (Role / Context / Canonical docs / Task / AC / Guardrails / Mandatory end block).

### Промпт A — R1 «Галочка проверено» (TASK-1..4, Claude Code)

```
Твоя роль: senior product-minded full-stack engineer проекта SokratAI.

Контекст: B2B-сегмент — репетиторы физики ЕГЭ/ОГЭ. Wedge — рабочее место экзаменного
репетитора. Принцип: AI = черновик + действие репетитора (AI ставит предварительный
балл, репетитор ПОДТВЕРЖДАЕТ перед показом ученику/родителю). Делаем v1.0 фичи
«Прогресс по ученикам», блок R1-5 «галочка проверено» — паритет с approve-экраном
пробника (mock_exam).

Прочитай ПЕРЕД работой:
- docs/delivery/features/student-progress/spec.md (ИСТОЧНИК ИСТИНЫ: §2.1, §3.1, §4.3,
  §5 anti-leak, §8 R1 acceptance, §10 QA, §11 resolved).
- docs/delivery/features/student-progress/design-handoff/README.md + hw3/ +
  «Проверка работы - *.html» (визуал/поведение).
- CLAUDE.md + .claude/rules/40-homework-system.md (dual write-path, column-GRANT,
  strip), 80-cross-browser.md (Safari), 90-design-system.md, 97-edge-function-error-contract.md.
- Грепни существующее для переиспользования: EditScoreDialog.tsx, StudentDrillDown.tsx,
  HeatmapGrid.tsx, TaskMiniCard.tsx, hw_tutor_force_complete_task RPC,
  stripStudentSensitiveTaskStateFields.

Задача (порядок строгий):
1. Миграция: tutor_reviewed_at (GRANT authenticated) + tutor_reviewed_by (service_role
   only) на homework_tutor_task_states; расширить column-GRANT whitelist; добавить
   tutor_reviewed_by в strip-функцию.
2. RPC hw_tutor_review_task / hw_tutor_review_all_ai (баллы НЕ трогает) /
   hw_tutor_reopen_review — SECURITY DEFINER, REVOKE PUBLIC + GRANT service_role,
   race-guard 409 ALREADY_REVIEWED (mirror hw_tutor_force_complete_task).
3. Edge tutor-progress-api: review-task / review-all-ai / reopen-review (ownership
   assignment.tutor_id=auth.uid(); ошибки {error,code} по-русски). Зарегистрируй в
   supabase/config.toml + deploy workflow; supabase-drift-check.mjs должен быть clean.
4. Frontend: расширь EditScoreDialog (чекбокс «Подтвердить задачу» + «Сохранить и
   подтвердить»); per-task «Подтвердить» + bulk «Подтвердить всё, что AI проверил (N)»
   с AlertDialog; reopen; anti-leak плашка; кейс без AI → «Поставить балл и
   подтвердить»; mobile bottom-sheet ≥16px. Переиспользуй HeatmapGrid/StudentDrillDown.

Acceptance (проверь сам перед сдачей):
- Given задача сдана, When «Подтвердить», Then tutor_reviewed_at=now(), балл залочен,
  ученик видит «Проверено», рубрика/решение/подсказки НЕ раскрыты.
- Given AI CORRECT на N, When bulk, Then N reviewed, баллы не изменены.
- Given уже reviewed, When второй параллельный confirm, Then 409.
- Given reviewed, When reopen, Then флаг снят.

Guardrails: НЕ дублируй computeFinalScore. НЕ перерисовывай HeatmapGrid — переиспользуй.
НЕ грантить tutor_reviewed_by на authenticated. Safari: инпуты ≥16px, без lookbehind,
border-separate для таблиц. Зелёный = только success (rule 90). plan mode для multi-file.

В конце: список изменённых файлов; summary; результаты npm run lint/build/smoke-check;
какие доки обновить; self-check против .claude/rules 40/80/90/97.
```

### Промпт B — R2 «Успеваемость + страница ученика» (TASK-5..7, Claude Code)

```
Твоя роль: senior product-minded full-stack engineer проекта SokratAI.

Контекст: тот же. Делаем v1.0, блок R3-1/R4-4/P1-2 — обзор «Успеваемость»
(кросс-ученический) + страница ученика /tutor/students/:id (агрегат по всем работам).
Закрывает боль Елены «обойти 15 домашек, не помню что проверила». Только физика-ЕГЭ
в v1; ОГЭ/школа — UI-каркас.

Прочитай ПЕРЕД работой:
- spec.md (§2.2, §3.2, §3.3, §4.0–4.2, §5, §6 Safari, §8 R2, §11 resolved Q1/Q2/Q3).
- design-handoff/README.md + usp/ + hero2/ + «Успеваемость - *.html» + «Прогресс ученика
  - hero v2*.html».
- 04-score-scales.md (EGE_PHYS.map, score_kind, пороги).
- .claude/rules 40/80/90 + performance.md (React Query key ['tutor', entity, ...],
  refetchOnWindowFocus:false для write-form).
- Грепни: computeFinalScore, HeatmapGrid/heatmapStyles, StudentsActivityBlock (group-by),
  TutorStudents.tsx, tutor_group_memberships.

Задача (порядок):
1. Миграция tutor_student_targets + RLS (tutor через tutor_students).
2. Edge tutor-progress-api: GET /students/:id/progress (агрегат ДЗ+пробники через
   computeFinalScore; column-whitelist БЕЗ solution_*/rubric_*/ai_score_comment/hints);
   GET /students/progress-overview (нормализ. pct_to_goal по треку; ДВА сигнала attention
   раздельно — review_backlog/overdue vs behind_goal/declining; группы; пагинация 100+);
   PATCH /students/:id/target. current_level = последний подтверждённый пробник, нет → null.
3. Frontend: подвкладка «Успеваемость» (два бара различимы, два сигнала, фильтр
   «есть непроверенное», group-by, виртуализация, трек-чип нейтральный); страница ученика
   «Прогресс» (карточка цели в родной шкале + спарклайн + засечки порогов + редакт. цель →
   метрики → bulk CTA → карточки работ с родным rollup по score_kind + мини-карта цвет=% →
   drill-down реальный HeatmapGrid + подтверждение из Промпта A); точки входа на Главной
   (блоки «Требует проверки» → проверка, «Отстают» → ученик) + per-student deep-link. Mobile.

Acceptance:
- Given у ученика N работ, When открываю страницу, Then вижу rollup каждой в родной
  единице (ДЗ «9/12 б», пробник «21/45 · ≈59 ЕГЭ»), цвет ячеек=%, сводку — без захода
  в каждую работу.
- Given смешанные треки, When открываю обзор, Then колонки только scale-agnostic
  (% к цели / % проверено / внимание), сырого балла нет.
- Given ученик далеко от цели но всё проверено, Then помечен «отстаёт» (не только
  «на проверке»).
- Given 100+ учеников, Then без лагов.

Guardrails: НЕ усредняй разные шкалы в «средний /5» (spec §11 Q2). НЕ дублируй
computeFinalScore/heatmapStyles. Никакого SELECT * на homework_tutor_tasks/assignments.
refetchOnWindowFocus:false на новых useQuery. Safari border-separate + 16px. plan mode.

В конце: изменённые файлы; summary; lint/build/smoke-check; доки к обновлению;
self-check против rules 40/80/90 + performance.md.
```

### Промпт C — Codex review v1.0 (TASK-8)

```
Ты — независимый ревьюер SokratAI. Контекст агента-автора тебе недоступен.

ПОРЯДОК (строго):
1. docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. docs 16 (ux-principles), 17 (ui-patterns)
3. docs/delivery/features/student-progress/spec.md (особенно §5 anti-leak, §6 Safari,
   §8 acceptance, §10 QA-чеклист)
4. .claude/rules 40/80/90/97
5. git diff

ПРОВЕРЬ:
- Job alignment: закрывает R1-5 / R3-1 / R4-4 / P1-2? Не уехал в scope (НЕ billing,
  НЕ ученик-зеркало, НЕ отчёт — это v1.1)?
- Anti-leak: ученику/родителю НЕ утекают solution_*/rubric_*/ai_score_comment/hints/
  tutor_reviewed_by? Column-whitelist на всех SELECT?
- dual write-path (rule 40): tutor_reviewed_* пишется консистентно; column-GRANT
  whitelist расширен; strip обновлён?
- Safari (rule 80): border-separate, инпуты ≥16px, touch-action, 100dvh, без lookbehind?
- Шкала: нет фейкового «среднего /5»; rollup в родной единице; цвет=% от max?
- RPC: REVOKE PUBLIC + GRANT service_role + race-guard 409?
- AC R1+R2 из spec §8 выполнены (по diff)?

ФОРМАТ: PASS / CONDITIONAL PASS (с списком фиксов) / FAIL (с причинами).
```

---

## 🚀 Deploy needed (после реализации фронта)
Frontend (`src/**`) → после merge: `ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182` → `deploy-sokratai` (rule 95). Backend (миграции + edge) — Lovable Cloud авто после push.
