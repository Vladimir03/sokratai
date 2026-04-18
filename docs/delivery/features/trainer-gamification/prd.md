# PRD: Trainer Gamification (Duolingo-style)

**Автор:** Vladimir Kamchatkin × Claude
**Дата:** 2026-04-17
**Feature folder:** `docs/delivery/features/trainer-gamification/`
**Pipeline step:** 3 (PRD)

---

## 1. Job Context

- **Core Job:** P1 — Top-of-funnel / привлечение учеников и репетиторов в SokratAI (pre-пилотный маркетинговый канал).
- **Sub-jobs:**
  - Дать ученику ЕГЭ/ОГЭ по физике эмоциональную причину вернуться завтра.
  - Дать репетитору (Егор, Женя) «продающий» демо-артефакт: «посмотри, мои ученики тренируют формулы каждый день».
- **Segment:** B2C-funnel → школьники 9–11 класс (ОГЭ/ЕГЭ физика), мобильный Safari/Chrome; вторично — репетиторы, шарящие ссылку ученикам.
- **Wedge alignment:** Не меняет wedge (ДЗ за 5–10 мин), но **питает** wedge через узнаваемость бренда и pool активных учеников, которых репетиторы затем втягивают в пилот.
- **Pilot impact:** Не блокирует пилот, не заменяет его. Работает параллельно как funnel → при логине ученика в пилот мигрируем gamification-state в БД (Phase 2).

---

## 2. Problem

Текущий `/trainer` — анонимный, функциональный, без механики возврата. Ученик решил раунд → закрыл вкладку → забыл. Нулевое удержание между сессиями. Нет reason-to-return, нет эмоционального feedback loop, нет «моего прогресса».

**Signal:** Duolingo, Brilliant, Khan Academy — все конкуренты в edtech давно двинулись к геймификации streaks + XP + combo. Школьник 16 лет уже тренирован этой петлёй (TikTok, мобильные игры), её отсутствие воспринимается как «приложение устарело».

**Workaround сейчас:** никакого. Ученик либо возвращается по мотивации «надо к ЕГЭ», либо не возвращается.

---

## 3. Solution

Добавить **минимальный** слой геймификации поверх текущего `/trainer`, полностью на клиенте (localStorage), без backend-зависимостей в MVP.

**Четыре механики MVP:**
1. **Streak** — серия дней подряд, где ученик сыграл ≥1 раунд.
2. **XP** — total earned, накапливается; показан на landing; даёт «я расту».
3. **Combo** — правильные ответы подряд **внутри раунда**; visual bump + бонус к XP.
4. **Best score** — рекорд XP по каждому разделу (Кинематика / Динамика / …); CTA «Побить рекорд».

**Петля возврата:**
```
Landing → видит streak 🔥3 / XP 240 / Best(Кинематика) 85 XP
  → играет раунд → combo x5 → perfect round
  → +80 XP / 🎯 Цель дня 1/2 / Новый рекорд!
  → «Пройти ещё раз» (побить рекорд) ИЛИ «Повторить ошибки»
  → второй раунд → 🎯 Цель дня 2/2 ✨ → streak +1
  → закрыл → завтра видит «🔥 4 · не потеряй!» (visual, не push)
```

Визуально — кастомные SVG-иконки (Flame/Zap/Trophy), warm orange `#E8913A` для streak, `bg-accent` socrat green для XP, CSS-only анимации + lottie-like SVG на celebrate-моменты. Emoji ❌ в UI chrome (CLAUDE.md rule).

---

## 4. Scope

### IN (Phase 1 — MVP, 1 день)
- `gamificationStore` (Zustand + localStorage, namespace `sokrat-trainer-gamification-v1`)
- Landing widget с 3 карточками: Streak, Total XP, Best by Section
- In-round combo indicator (live counter + bump animation)
- XP calculation на экране результата:
  - базовый `10`
  - accuracy: `accuracy_ratio × 20` (0..20)
  - combo bonus: `best_combo × 2`, cap `20`
  - perfect round: `+30` если `accuracy === 1.0`
  - new best: `+20` если побили `best_score_by_section[section]`
- «Цель дня»: 2 раунда, прогресс bar `1/2` → `2/2 ✨`
- Два CTA на result screen: **«Пройти ещё раз»** (тот же набор формул, для побития рекорда) + **«Повторить ошибки»** (existing behaviour)
- «Новый рекорд!» визуальный акцент если обновили best
- Streak update: засчитываем день при `completedRounds >= 1`
- Streak break: если `lastPlayedDate < today - 1 day` → reset to 0 при следующей игре

### OUT (осознанный отказ)
- Hearts/lives (противоречит тону «рабочее место экзаменного репетитора»)
- Leaderboard / social (требует backend + auth, funnel-метрика не оправдывает)
- Achievements/badges (over-engineering для 1 дня)
- Push-напоминания «не теряй streak» (отдельная spec, PWA push infra уже есть — но это P2)
- Sound effects (в MVP выключены; школьник на уроке — primary context)
- Stars progression по разделам (Duolingo-style дерево) — заменено на простой Best Score
- Streak freeze (2 дня «заморозки» — как у Duolingo) — добавим если увидим churn на day-2

### LATER (Phase 2, после feedback)
- Миграция localStorage → `trainer_gamification_state` таблица при логине (`auth.user.id`-scoped)
- Haptics (`navigator.vibrate`) на Android/поддерживаемых iOS
- Sound toggle + звуки на combo/new_best
- Streak freeze механика (2 free freezes/week)
- Push-напоминания (через существующую VAPID-инфру, см. `.claude/rules/70-notifications.md`)
- Weekly XP summary (email или in-app)

---

## 5. User Stories

### Школьник 10 класса, готовится к ЕГЭ (primary)
- **US-1:** Как ученик, я хочу видеть свою streak на главной тренажёра, чтобы у меня была причина вернуться завтра.
- **US-2:** Как ученик, я хочу видеть combo во время раунда, чтобы каждый правильный ответ давал моментальную эмоцию.
- **US-3:** Как ученик, я хочу видеть «Новый рекорд!» когда побил свой best, чтобы прогресс был осязаем.
- **US-4:** Как ученик, я хочу чётко понимать «Цель дня 1/2», чтобы знать, когда можно остановиться без потери streak.
- **US-5:** Как ученик, я хочу иметь CTA «Побить рекорд» на тот же набор формул, чтобы взять реванш сразу.

### Репетитор (secondary, sharer)
- **US-6:** Как репетитор, я хочу показать ученику ссылку на `/trainer` и услышать «клёво, как Duolingo», чтобы использовать тренажёр в демо перед пилотом.

---

## 6. Success Criteria

### Leading (3–7 дней после выкатки)
- **L-1:** `daily_goal_completion_rate` ≥ 40% от уникальных игроков дня (2+ раунда).
- **L-2:** `avg_rounds_per_session` ≥ 1.8 (сейчас оценочно ~1.0–1.2).
- **L-3:** `new_best_rate` ≥ 25% раундов обновляют best по разделу в первую неделю.

### Lagging (2–4 недели)
- **L-4:** `streak_day_3_retention` — доля игроков, у которых streak достиг 3+ дней ≥ 15% от уникальных игроков дня 1. **Primary lagging metric.**
- **L-5:** Qualitative — ≥1 репетитор из пилотных (Егор / Женя) упоминает, что ученик пришёл через тренажёр.

Pilot metrics (doc 18) не трогаем — это funnel-фича, не pilot-фича.

---

## 7. Open Questions

| Вопрос | Кто решает | Блокирует старт? |
|---|---|---|
| Формат SVG-иконок — inline React-компоненты или `<img src>` из `public/`? | engineering (Claude Code на Spec) | нет |
| Какие именно моменты celebrate lottie-SVG: только new_best, или ещё perfect_round и daily_goal_complete? | product (я) | **да** — уточню в Spec |
| Streak reset — показываем ли модалку «твоя серия из N дней потеряна»? | product (я) | нет (Phase 2) |
| Analytics — куда шлём `streak_day_3_retention`? Нет PostHog/Amplitude в проекте сейчас. | engineering | **да** — см. ниже |
| Telemetry transport: `console.info(JSON.stringify(...))` как в `hint_rejected` или новая `trainer_events` таблица? | engineering | **да** |

**Решение по telemetry до Spec:** для Phase 1 — только `console.info('[trainer-telemetry] {...}')` + чтение из Supabase logs. Это паттерн из `hint_rejected` (`guided_ai.ts`). Новая таблица — если докажем value.

**Решение по celebrate SVG:** три момента — `new_best`, `perfect_round`, `daily_goal_complete (2/2)`. Один общий SVG-компонент `<Celebrate variant="new-best | perfect | goal" />`.

---

## 8. Risks

- **R-1 (medium):** localStorage стирается → streak пропадает → ученик расстраивается и уходит. Митигация: в Phase 2 миграция в БД при логине; явный disclaimer в footer тренажёра «streak хранится в браузере».
- **R-2 (low):** Ученик фармит «Повторить ошибки» ради combo → XP-инфляция. Митигация: retry-mode даёт `×0.5` XP и не обновляет best.
- **R-3 (medium):** Design drift — gamification конфликтует с «серьёзный помощник» тоном (см. `90-design-system.md` anti-patterns). Митигация: custom SVG вместо emoji, `bg-accent` socrat green как основной цвет, orange только для streak flame.
- **R-4 (low):** Performance — lottie-SVG на мобильном Safari лагает. Митигация: CSS-only animations + `React.memo` на celebrate-компоненте, лимит длительности 1200ms (как celebration в `TaskStepper`).
- **R-5 (medium):** Timezone cheating — ученик меняет время устройства → фейковые streaks. **Принято:** в MVP локальное время, cheating = их проблема; в Phase 2 при логине привязываемся к server time.
- **R-6 (medium):** Combo сквозной между раундами заблокирует exploration слабых разделов. **Решено:** combo только in-round.

---

## Parking Lot

- Streak freeze (2 free/week) — revisit если видим churn на day-2/day-3.
- Weekly XP leaderboard среди учеников одного репетитора — revisit в Phase 2 когда будет login + tutor_students link.
- Daily challenge («сегодня задача дня: динамика, 10 вопросов») — revisit после Phase 1 if `daily_goal_completion_rate` низкий.
- Tutor-facing gamification analytics («мои ученики: Алина streak 7, Петя streak 2») — отдельная фича, Phase 3.
- Share-картинка «Я набрал 450 XP в SokratAI!» в TG/ВК — revisit когда появится auth + профиль.
- Anti-farm: лимит `new_best` — раз в час по одному разделу, чтобы не накручивали.
