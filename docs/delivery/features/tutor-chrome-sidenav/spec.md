# Feature Spec: Tutor Chrome — SideNav v1 (Phase 2a)

**Версия:** v0.1
**Дата:** 2026-04-22
**Автор:** Vladimir Kamchatkin
**Статус:** approved

**Источник дизайна:** Claude Design handoff · `docs/design-system/handoff-dashboard/tutor-kit/chrome.jsx` + `tokens.css` (AppFrame + SideNav). TopBar из handoff сознательно не реализуется.
**Tech stack:** Vite + React + TypeScript + Tailwind + shadcn/ui
**Phase:** 2a (chrome only; backend `tutor_viewed_at` и «Пробник» entity — 2b/2c, отдельно)
**Предшественник:** [`tutor-dashboard-v2/spec.md`](../tutor-dashboard-v2/spec.md) (Phase 1, approved + shipped TASK-1..6)

---

## 0. Job Context

### Какую работу закрывает фича

| Участник | Core Job | Sub-job | Ссылка |
|---|---|---|---|
| Репетитор (B2B) | **R3** — Рутина ведения (расписание, оплаты, чаты) | R3-1 (быстрый переход между разделами) | [job-graph](../../../discovery/research/SokratAI_AJTBD_job-graphs/) |
| Репетитор (B2B) | **R4** — Сохранение контроля и качества | R4-1 (визуальная согласованность с design handoff) | — |

### Wedge-связка

- **B2B-сегмент:** B2B-1 (репетиторы физики ЕГЭ/ОГЭ)
- **B2C-сегмент:** — (tutor-only chrome)
- **Wedge alignment:** не расширяет wedge, но **не ослабляет**. Фаза про визуальный долг — handoff-дизайн использует left-rail паттерн, а текущий top-bar создаёт ментальный разрыв между «дизайн показали Егору» и «то, что он видит каждый день». После Phase 2a design и runtime полностью сходятся для desktop-first пользователя.

### Pilot impact

Прямого feature-value для R4-2 / R4-1 не добавляет — Dashboard уже даёт триаж. **Но:** освобождает 56 px вертикального пространства (убираем TopBar) → больше задач видны без скролла на Dashboard и на Results v2. Это **≥ +1 ученик в viewport таблицы «Активность учеников»** на типичном 13″ MacBook → напрямую улучшает R4-1 density. Второй эффект — **Phase 2b/2c unblock**: collapsible SideNav, notifications bell, group indicators — всё стоит на том, что chrome уже переработан.

---

## 1. Summary

Меняем tutor chrome с top-bar navigation на left-rail SideNav per design handoff. Все 13 tutor-страниц обёртываются в новый `<AppFrame>` вместо текущего `<TutorLayout>`. `TutorLayout.tsx` удаляется.

**Что сохраняем из текущей реальности** (per ответ заказчика):
- Логотип `sokrat-logo.png` + текст «Сократ AI» (не monogram «С» + «Сократ · Тьютор» из handoff).
- Logout как контрол (просто переезжает в SideNav footer на desktop / в mobile top bar на мобиле).
- Все существующие tutor routes и URL — без изменений.

**Что меняем:**
- Desktop (≥ 1024px): `240px static SideNav | 1fr main`. Верхнего бара нет.
- Mobile (< 1024px): `56px minimal top bar (logo + hamburger + logout) | 1fr main`. Hamburger → overlay SideNav drawer (свайп слева).
- 4 nav-группы per handoff: `Работа` / `Ученики` / `Материалы` / `Финансы`.
- `Помощник` переезжает в группу `Материалы` (per ответ Q1).
- Counter badges (ДЗ / Ученики) — live data из существующих hooks.

**Что НЕ делаем в этой фазе** (закрыто решением 2026-04-22, см. spec tutor-dashboard-v2 § Parking Lot):
- TopBar (с breadcrumbs / global search / command palette / avatar).
- Collapsed mode SideNav (64px) — Parking Lot.
- Нав для `Группы` / `Мои задачи` / `Тарифы` — feature-сущностей нет в репо, добавим когда landed.

---

## 2. Problem

### Текущее поведение

- `TutorLayout.tsx` (236 строк) рендерит sticky top-bar `h-14` с 5 primary nav items + dropdown `Ещё` (2 items) на desktop. На mobile — 4 bottom-nav items + bottom-sheet `Ещё` (3 items). Разные структуры на двух breakpoints.
- Dashboard Phase 1 спроектирован под left-rail handoff, но рендерится под top-bar → 30% вертикального экрана съедается nav chrome + home-header на 13″ экране.
- Handoff-дизайн показывал Егору SideNav как source-of-truth — продукт расходится с дизайном, который он видел при onboarding.

### Боль

- **R4-1 teardown:** репетитор на 13″ MacBook видит 4 строки таблицы «Активность учеников» до скролла. С SideNav + без TopBar — 5–6 строк. Для 14 учеников разница критичная (fold triage vs «надо скроллить»).
- **Visual drift:** dashboard handoff построен на `AppFrame` grid, runtime — поверх legacy top-bar. Design/code coherence сломана. При любой новой tutor-странице агент должен выбирать «как в handoff или как в TutorLayout» → drift.
- **Mobile/desktop разное мышление:** сейчас top-bar desktop ≠ bottom-nav mobile. После SideNav + mobile drawer — единая ментальная модель «все разделы живут слева».

### Текущие «нанятые» решения

- В handoff-препродакшн-сессиях (chat1.md) Егор оценивал mockup с SideNav — runtime ему никто не показывал под top-bar.
- Текущие tutor-юзеры мониторят разделы через F5 + закладки браузера (не через nav).

---

## 3. Solution

### Описание

Создаём `<AppFrame>` + `<SideNav>` + `<MobileTopBar>` + `<MobileDrawer>` по handoff-паттерну, с нашими брендом/логотипом. Все 13 tutor routes оборачиваем в `AppFrame` в `App.tsx`. `TutorLayout.tsx` удаляется. Внутренности страниц (`TutorHome`, `TutorHomework`, etc.) остаются без изменений — они просто получают новую обёртку.

### Ключевые решения

**КР-1. AppFrame = единственная обёртка для всех tutor routes.**
В `App.tsx` создаём новый route-group: все `/tutor/*` маунтятся внутри `<AppFrame>`. Каждая страница (`TutorHome`, `TutorStudents`, etc.) **удаляет** у себя `<TutorLayout>` wrapper из своего JSX — теперь это делает router. Это позволяет `data-sokrat-mode="tutor"` жить на AppFrame root (один раз), а не на каждой странице.

**КР-2. Нет TopBar на desktop.**
Handoff-проект показывал `56px top row` с breadcrumbs/search/palette. Заказчиком решение: **не делаем**. AppFrame упрощается до `grid: 240px 1fr` (одна строка, две колонки). Экономит 56px вертикали на каждом tutor-экране.

**КР-3. Mobile = 56px minimal top bar + drawer.**
На <1024px static SideNav не помещается. Рендерим:
- Top bar 56px: hamburger (левый) + `[sokrat-logo + «Сократ AI»]` (центр-лево) + logout (правый).
- Hamburger toggles overlay drawer (`position: fixed; top: 0; left: 0; width: 280px; height: 100vh`) со свайпом слева и backdrop.
- Drawer содержит ТОТ ЖЕ SideNav content, что и desktop — никакой mobile-only структуры.

**КР-4. Brand keeps current identity.**
В SideNav header: `<img src={sokratLogo} />` + `<span>Сократ AI</span>` — точно как в текущем `Navigation.tsx` / `TutorLayout.tsx`. **НЕ** «С» monogram + «Сократ · Тьютор» из handoff prototype. Заказчик явно требует сохранить.

**КР-5. Nav structure — 4 группы, 7 items.**

| Группа | Items | Route |
|---|---|---|
| Работа | Главная | `/tutor/home` |
| Работа | Расписание | `/tutor/schedule` |
| Работа | Домашние задания (+counter active) | `/tutor/homework` |
| Ученики | Все ученики (+counter active) | `/tutor/students` |
| Материалы | База знаний | `/tutor/knowledge` |
| Материалы | Помощник | `/tutor/assistant` |
| Финансы | Оплаты | `/tutor/payments` |

Группы `Группы` / `Мои задачи` / `Тарифы` из handoff SideNav — **не рендерим**, fallback routes нет. Добавим когда feature-surfaces landed (отдельные specs).

**КР-6. Logout — SideNav footer (desktop) / mobile top bar right (mobile).**
Текущая `TutorLayout` кладёт Logout вправо в top-bar. После миграции: в desktop footer SideNav (под последней группой), в mobile — в правой части top bar (на месте текущего).

**КР-7. CSS layer — новый `src/styles/tutor-chrome.css`.**
Отдельный файл от `tutor-dashboard.css` (который остаётся only-для-Dashboard-контента). `tutor-chrome.css` содержит: `.t-app`, `.t-app__rail`, `.t-app__main`, `.t-nav*`, `.t-mobile-top`, `.t-mobile-drawer*`, `.t-mobile-backdrop`. Импорт в `index.css` сразу после `tutor-dashboard.css`.

**КР-8. Ни одного `framer-motion`, ни одного внешнего drawer-пакета.**
Mobile drawer — CSS `transform: translateX(-100%)` + `transition` (см. `.claude/rules/performance.md` §2 — framer-motion запрещён). Backdrop — inline `div` с `onClick`. Focus trap — маленький custom hook `useFocusTrap(ref)` в `src/hooks/useFocusTrap.ts` (20 строк).

### Scope

**In scope (P0):**
1. `src/styles/tutor-chrome.css` — CSS-слой AppFrame + SideNav + mobile drawer + top bar.
2. `src/components/tutor/chrome/AppFrame.tsx` — top-level wrapper с grid и mode attribute.
3. `src/components/tutor/chrome/SideNav.tsx` — desktop rail + drawer content (shared).
4. `src/components/tutor/chrome/MobileTopBar.tsx` — 56px мобильная шапка.
5. `src/components/tutor/chrome/MobileDrawer.tsx` — overlay + backdrop + focus trap.
6. `src/hooks/useFocusTrap.ts` — keyboard trap helper.
7. `src/App.tsx` — route-group wrap всех `/tutor/*` в AppFrame.
8. Все 13 tutor pages (`TutorHome`, `TutorHomework`, `TutorHomeworkCreate`, `TutorHomeworkDetail`, `TutorHomeworkTemplates`, `TutorStudents`, `TutorStudentProfile`, `TutorSchedule`, `TutorPayments`, `TutorAssistant`, `KnowledgeBasePage`, `CatalogTopicPage`, `FolderPage`) — **удалить** `<TutorLayout>` wrapper из их JSX.
9. `src/components/tutor/TutorLayout.tsx` — **удалить файл**.
10. Counter badges — live data. Для `Домашние задания`: count `useTutorHomeworkList({ status: 'active' })` или аналог (подключить к существующему hook). Для `Все ученики`: `useTutorStudents().filter(s=>s.status==='active').length`.
11. Active nav item styling (`bg --sokrat-green-100 / fg --sokrat-green-800 / weight 600`).
12. Keyboard navigation: Tab по nav items, Enter/Space to activate, Esc закрывает mobile drawer.

**In scope (P1 — fast follow-up):**
- Mobile swipe gesture (touch-start + track + release) на закрытие drawer. P0 закрывается тапом по backdrop / linku / hamburger / Esc.
- Body scroll lock при открытом mobile drawer (P0: `overflow: hidden` на `<body>` toggle).
- Counter badge tooltip при hover на desktop («12 активных ДЗ из 34 всего»).
- Prefetch tutor-чанков при hover на nav link (текущий warmup в TutorLayout — переезжает в SideNav).

**Out of scope (Parking Lot):**
- TopBar с breadcrumbs / global search / command palette.
- Collapsed mode SideNav (64px).
- `Группы` / `Мои задачи` / `Тарифы` nav items.
- Avatar + profile dropdown.
- Notifications bell + unread badges.
- SideNav customization (drag-to-reorder групп, hide разделов).
- Themes (dark mode) — tutor-specific.

---

## 4. User Stories

### Репетитор

**US-R1.** Когда я работаю на 13″ MacBook, я хочу чтобы nav не съедал верх экрана, чтобы больше задач помещалось в viewport таблицы активности.

**US-R2.** Когда я переключаюсь между разделами, я хочу видеть все 7 разделов одновременно в левой колонке, а не искать их в `Ещё ▾` dropdown.

**US-R3.** Когда я на мобиле тапну на hamburger, я хочу быстрый доступ ко всем разделам без переключения на desktop.

**US-R4.** Когда я в группе занятий в классе, я хочу мгновенно увидеть сколько ДЗ и учеников активных — не открывая списки.

---

## 5. Technical Design

### Затрагиваемые файлы

**Новые:**
- `src/styles/tutor-chrome.css`
- `src/components/tutor/chrome/AppFrame.tsx`
- `src/components/tutor/chrome/SideNav.tsx`
- `src/components/tutor/chrome/MobileTopBar.tsx`
- `src/components/tutor/chrome/MobileDrawer.tsx`
- `src/hooks/useFocusTrap.ts`
- `src/hooks/useTutorChromeCounters.ts` — composable live counters для nav badges

**Изменяем:**
- `src/App.tsx` — route-group (см. ниже)
- `src/index.css` — добавить `@import './styles/tutor-chrome.css'` после `tutor-dashboard.css`
- Все 13 tutor pages — **убрать** `<TutorLayout>` wrapper из JSX
- `src/pages/tutor/TutorHome.tsx` — убрать `data-sokrat-mode="tutor"` wrapper (переезжает в AppFrame)

**Удаляем:**
- `src/components/tutor/TutorLayout.tsx` — после миграции всех страниц, pre-flight `grep`

**Не трогаем:**
- `src/styles/colors_and_type.css` — токены
- `src/styles/tutor-dashboard.css` — остаётся для Dashboard-блоков, расширять не нужно
- `tailwind.config.ts`
- Все hooks data-layer
- High-risk файлы: `AuthGuard`, `TutorGuard`, `Chat.tsx`

### Route structure

В `App.tsx` сейчас каждый tutor-route — отдельный `<Route>` с собственной lazy-ленивой страницей, которая внутри wrap в `<TutorLayout>`. После Phase 2a:

```tsx
<Route path="/tutor" element={<AppFrame />}>
  <Route index element={<Navigate to="home" replace />} />
  <Route path="home" element={<TutorHome />} />
  <Route path="homework" element={<TutorHomework />} />
  <Route path="homework/create" element={<TutorHomeworkCreate />} />
  <Route path="homework/:id" element={<TutorHomeworkDetail />} />
  <Route path="homework/:id/results" element={<RedirectHomeworkResultsToDetail />} />
  <Route path="homework/templates" element={<TutorHomeworkTemplates />} />
  <Route path="students" element={<TutorStudents />} />
  <Route path="students/:id" element={<TutorStudentProfile />} />
  <Route path="schedule" element={<TutorSchedule />} />
  <Route path="payments" element={<TutorPayments />} />
  <Route path="assistant" element={<TutorAssistant />} />
  <Route path="knowledge/*" element={<KnowledgeBasePage />} />
  <Route path="dashboard" element={<Navigate to="/tutor/home" replace />} />
</Route>
```

`<AppFrame>` рендерит `<Outlet />` в main-area → дочерние маршруты получают обёртку автоматически.

**Важно:** каждая tutor-страница сейчас оборачивает свой контент в `<TutorGuard><TutorLayout>...`. После миграции — **остаётся только `<TutorGuard>`** вокруг контента (guard переносится внутрь child-страницы, чтобы AppFrame был agnostic относительно auth). Либо `<AppFrame>` сам содержит `<TutorGuard>` — cleaner. Решение: **Guard внутри AppFrame, чтобы не дублировать 13 раз.**

### CSS structure (`tutor-chrome.css`)

```css
/* AppFrame — grid root */
.t-app {
  display: grid;
  min-height: 100vh;
  background: var(--sokrat-surface);
  color: var(--sokrat-fg1);
}
@media (min-width: 1024px) {
  .t-app { grid-template-columns: 240px 1fr; }
}

/* Desktop rail */
.t-app__rail {
  display: none;
  background: var(--sokrat-card);
  border-right: 1px solid var(--sokrat-border-light);
  overflow-y: auto;
  height: 100vh;
  position: sticky;
  top: 0;
}
@media (min-width: 1024px) { .t-app__rail { display: block; } }

/* Main area */
.t-app__main {
  overflow-y: auto;
  padding: 20px 24px 80px;
}
@media (max-width: 1023px) {
  .t-app__main { padding-top: 72px; /* clear mobile top bar */ }
}

/* SideNav inner */
.t-nav { padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; height: 100%; }
.t-nav__brand { display: flex; align-items: center; gap: 10px; padding: 8px 10px 16px; }
.t-nav__brand img { width: 28px; height: 28px; }
.t-nav__brand-name { font-weight: 600; font-size: 15px; color: var(--sokrat-fg1); }
.t-nav__group-label { font-size: 11px; font-weight: 600; color: var(--sokrat-fg3); text-transform: uppercase; letter-spacing: 0.06em; padding: 12px 10px 4px; }
.t-nav__item {
  display: flex; align-items: center; gap: 10px;
  min-height: var(--sokrat-hit-sm); padding: 0 10px;
  border-radius: var(--sokrat-radius-sm);
  color: var(--sokrat-fg2); font-size: 14px; font-weight: 500;
  text-decoration: none; cursor: pointer;
}
.t-nav__item:hover { background: var(--sokrat-surface); color: var(--sokrat-fg1); }
.t-nav__item--active { background: var(--sokrat-green-100); color: var(--sokrat-green-800); font-weight: 600; }
.t-nav__item svg { width: 18px; height: 18px; flex: none; }
.t-nav__count {
  margin-left: auto;
  font-size: 12px; font-weight: 500;
  color: var(--sokrat-fg3);
  font-variant-numeric: tabular-nums;
}
.t-nav__item--active .t-nav__count { color: var(--sokrat-green-800); }
.t-nav__footer { margin-top: auto; padding: 12px 0 4px; border-top: 1px solid var(--sokrat-border-light); }

/* Mobile top bar */
.t-mobile-top {
  display: none;
  position: fixed; top: 0; left: 0; right: 0; z-index: 40;
  height: 56px; padding: 0 12px;
  background: var(--sokrat-card);
  border-bottom: 1px solid var(--sokrat-border-light);
  align-items: center; gap: 12px;
}
@media (max-width: 1023px) { .t-mobile-top { display: flex; } }

/* Mobile drawer */
.t-mobile-drawer {
  position: fixed; top: 0; left: 0; bottom: 0; z-index: 50;
  width: 280px; background: var(--sokrat-card);
  transform: translateX(-100%);
  transition: transform var(--sokrat-dur-base) var(--sokrat-ease-smooth);
  display: flex; flex-direction: column;
}
.t-mobile-drawer--open { transform: translateX(0); }
.t-mobile-backdrop {
  position: fixed; inset: 0; z-index: 45;
  background: rgba(15, 23, 42, 0.5);
  opacity: 0; pointer-events: none;
  transition: opacity var(--sokrat-dur-base) var(--sokrat-ease-smooth);
}
.t-mobile-backdrop--open { opacity: 1; pointer-events: auto; }
```

**Правила:**
- Все селекторы префиксированы `t-app` / `t-nav` / `t-mobile-*` — namespace не пересекается с shadcn / Tailwind.
- Все value — `var(--sokrat-*)` (никакого hex).
- `@media (min-width: 1024px)` для desktop активирует rail (mobile — скрыт по дефолту).

### Data — counter badges

`src/hooks/useTutorChromeCounters.ts`:

```ts
export function useTutorChromeCounters() {
  const { students } = useTutorStudents();
  const { data: hwList } = useQuery({
    queryKey: ['tutor', 'chrome', 'active-hw-count'],
    queryFn: () => fetchTutorHomeworkCount({ status: 'active' }),
    staleTime: 60_000,
  });
  return {
    activeStudents: students.filter(s => s.status === 'active').length,
    activeHomework: hwList ?? 0,
  };
}
```

- **Не блокируем** рендер SideNav — badge показывает `—` пока loading.
- Реализация `fetchTutorHomeworkCount` — `supabase.from('homework_tutor_assignments').select('id', { count: 'exact', head: true }).eq('tutor_id', me).eq('status', 'active')`. Может переиспользовать существующий endpoint если есть.

### Миграции

**Phase 2a — нет миграций.** Counter использует существующие таблицы.

---

## 6. UX / UI

### UX-принципы (из doc 16)

- **P1 — Job-first above the fold.** TopBar исчезает → главный контент начинается сразу сверху → R4-1 density выше.
- **P5 — Tutor-first.** Density tutor (compact, 14px body) остаётся. SideNav 36px hit-target (rule 90 § Density reference).
- **P4 — Consistent mental model.** Единая модель nav на desktop и mobile (разница только в presentation).

### UI-паттерны (из doc 17)

- **One primary action per screen.** В chrome НЕТ primary CTA — primary живёт в PageHeader каждой страницы.
- **No cards inside cards.** SideNav — не card (rail), nav items — не карточки (row-level).
- **Hit targets.** Desktop nav item = 36px (tutor hit-sm). Mobile top bar interactive = 44px (mobile hit-lg).
- **Focus rings не убираем** — `var(--sokrat-focus-ring)` на каждом nav item.

### Визуальные constant-ы

| Элемент | Token / Value |
|---|---|
| Rail width (desktop) | 240px |
| Drawer width (mobile) | 280px |
| Mobile top bar height | 56px |
| Nav item min-height | 36px |
| Group label | 11px / 600 / uppercase / 0.06em letter-spacing / `--sokrat-fg3` |
| Active item bg | `--sokrat-green-100` |
| Active item fg | `--sokrat-green-800` |
| Counter badge | 12px / 500 / tabular-nums / `--sokrat-fg3` (non-active), `--sokrat-green-800` (active) |
| Brand mark | 28×28 PNG `sokratLogo` + «Сократ AI» 15/600 |
| Divider (footer) | `--sokrat-border-light` hairline |
| Drawer transition | 220ms smooth ease |
| Backdrop | rgba(15, 23, 42, 0.5), opacity 0 → 1 |

### Accessibility

- **Keyboard:** Tab по nav items → Enter/Space. Esc в drawer → закрыть. Focus trap в открытом drawer.
- **ARIA:**
  - `<nav aria-label="Разделы">` на SideNav
  - `<nav aria-label="Мобильное меню">` на drawer
  - Hamburger button: `aria-label="Открыть меню"` / `aria-label="Закрыть меню"` (toggle) + `aria-expanded={isOpen}` + `aria-controls="tutor-sidenav-drawer"`
  - Backdrop: `role="presentation"` (чисто для clicks)
  - Active link: `aria-current="page"`
- **Focus management:** при открытии drawer → focus на первый nav item. При закрытии → focus возвращается на hamburger (save `lastFocused` в useRef).
- **Screen reader:** group labels (`Работа`, `Ученики`, ...) имеют `role="heading" aria-level="2"`.

---

## 7. Acceptance Criteria (testable, P0 минимум)

**AC-1.** DOM: все `/tutor/*` routes рендерят содержимое внутри `<div class="sokrat t-app" data-sokrat-mode="tutor">`. Проверяется DevTools inspect на любой tutor-странице.

**AC-2.** Desktop ≥ 1024px: `.t-app__rail` видим, width = 240px, sticky. `.t-app__main` padding-top = 20px (не 72px как mobile).

**AC-3.** Desktop: SideNav содержит 4 группы в порядке `Работа / Ученики / Материалы / Финансы` с правильными items (см. КР-5). `Помощник` находится в группе `Материалы`, **не** в `Работа`.

**AC-4.** Desktop: brand block в SideNav header = `<img src={sokratLogo} />` + текст «Сократ AI» 15/600. **НЕ** «С» monogram, **НЕ** «Сократ · Тьютор».

**AC-5.** Desktop: Logout button в footer SideNav (не в top-right как сейчас). Kbd-accessible (Tab достигается).

**AC-6.** Mobile < 1024px: `.t-app__rail` скрыт. `.t-mobile-top` видим, 56px. Содержит hamburger (слева) + brand (центр-лево) + logout (справа). Main content `padding-top: 72px`.

**AC-7.** Mobile: тап на hamburger → drawer slide-in `transform: translateX(0)` + backdrop fade-in. Drawer содержит тот же SideNav content. Тап на backdrop → close.

**AC-8.** Mobile: drawer закрывается по: (a) click на nav link, (b) click на backdrop, (c) Esc key. В каждом случае focus возвращается на hamburger.

**AC-9.** Counter badges: `Домашние задания` и `Все ученики` показывают live number. При loading — `—`. Число `tabular-nums`. В active-item цвет `--sokrat-green-800`, non-active — `--sokrat-fg3`.

**AC-10.** Active nav item: `aria-current="page"` + `bg: --sokrat-green-100` + `fg: --sokrat-green-800` + `font-weight: 600`. Matching по `location.pathname.startsWith(href)` — например `/tutor/homework/123` подсвечивает `Домашние задания`.

**AC-11.** Keyboard: Tab проходит через все nav items по порядку (desktop — без перескакиваний, mobile — только когда drawer открыт). Enter/Space activate link.

**AC-12.** Focus trap в mobile drawer: Tab не выходит за пределы drawer, Shift+Tab с первого элемента → возврат на последний.

**AC-13.** `grep -rn "TutorLayout" src/` после миграции возвращает **0 совпадений** (файл удалён + все импорты убраны).

**AC-14.** Все 13 tutor-страниц рендерятся без визуальных регрессий (по сравнению с main-branch до миграции) — smoke проходится pass через все routes.

**AC-15.** Body scroll lock: при открытом mobile drawer `<body>` получает class `overflow-hidden`. При закрытии — class убирается. Проверяется e2e (scroll на странице под backdrop — не работает).

---

## 8. Validation

### Метрики успеха

**Leading (3–7 дней):**
- **Visual coherence check:** на staging screen-сравнение любой tutor-страницы с handoff-мокапом — идентично (без учёта brand-mark, где наши логотип+название).
- **Nav usage:** ≥ 95% переходов между разделами идут через SideNav (замер через router analytics), а не через F5 / bookmarks — т.е. nav visible + discoverable.
- **Regression rate:** 0 user-reported UI багов по 13 существующим tutor-страницам в первые 3 дня после деплоя.

**Lagging (2–4 недели):**
- **Density win:** на 13″ MacBook viewport Dashboard таблица «Активность учеников» показывает ≥ 5 строк без скролла (vs 4 до миграции). Замер вручную после пилотного feedback.
- **Density win подтверждён Егором:** в weekly check-in — «да, вижу больше учеников сразу» ≥ 4/5.

### Связь с pilot KPI (doc 18)

- **KPI «Егор renewal week 4»:** визуальная coherence с handoff = меньше когнитивного диссонанса при демонстрации новых фич.
- **KPI «≥ 3 ДЗ / неделя / ученик»:** не directly, но через R4-1 density улучшение.

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

Manual e2e:
1. Открыть все 13 tutor-routes — визуально проверить SideNav + active state.
2. Переключить viewport 1280 → 1024 → 768 → 375 — убедиться в правильном breakpoint handoff.
3. Mobile drawer: hamburger → open → click link → navigate + close → click hamburger again → backdrop click close → Esc close.
4. Keyboard: Tab через nav, Enter на links, Esc в drawer.
5. Safari iOS: swipe-scroll не ломает drawer swipe gesture (если P1 swipe gesture реализован — в P0 просто тап по hamburger).

---

## 9. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| 13 страниц нужно обновить одновременно — регрессии в flows, которых не трогали с января | Средняя | Pre-migration screenshot каждой страницы на staging + post-migration diff. Rollback-план — один revert коммит восстанавливает `TutorLayout.tsx` |
| Active state matching даёт false-positive на `/tutor/homework/123` vs `/tutor/homework/templates` | Средняя | Explicit matching через `matchPath` с `end: false` и сортировка items от longest-prefix к shortest |
| Mobile drawer ломает scroll lock на iOS Safari (known issue с `overflow: hidden` на body) | Средняя | Использовать `position: fixed; top: -{scrollY}px` technique (rule 80 §iOS) |
| `data-sokrat-mode="tutor"` на AppFrame root ломает некоторые tutor-страницы, которые уже имеют свой wrapper | Низкая | Grep на `data-sokrat-mode` перед миграцией → убрать дубликаты (TutorHome.tsx из Phase 1) |
| SideNav не помещается vertically на 13″ 900px высота (при всех 7 items + footer) | Низкая | Overflow-y: auto на `.t-app__rail`. Rail = 100vh sticky |
| `useTutorChromeCounters` делает extra query — +1 request per tutor-session | Низкая | staleTime: 60s; если станет проблемой — переиспользовать existing hook из dashboard |

### Открытые вопросы (non-blocking)

| Вопрос | Кто решает | Блокирует? |
|---|---|---|
| Помощник иконка в SideNav — Lucide `Bot` (как сейчас) или `Sparkles`? | product (Vladimir) | нет — default `Bot` |
| Counter показывает только `active` статус ДЗ, или сумму `active + review`? | product (Vladimir) | нет — default `active` |
| При переходе с `/tutor/dashboard` (Phase 1 redirect) через SideNav на `/tutor/home` — activate state на `Главная`. Handle edge case? | engineering | нет — `startsWith('/tutor/home')` автоматически подходит |
| Нужен ли collapse mode toggle для 1280–1366px ширин уже сейчас? | product | нет — Parking Lot |

---

## 10. Implementation Tasks (краткий план, детализация в `tasks.md`)

- [ ] **TASK-1** · CSS layer `tutor-chrome.css` + import в `index.css`
- [ ] **TASK-2** · `AppFrame` + `SideNav` + `MobileTopBar` + `MobileDrawer` + `useFocusTrap` + `useTutorChromeCounters`
- [ ] **TASK-3** · Route-group миграция в `App.tsx`; все 13 tutor-страниц — убрать `<TutorLayout>` из JSX; перенести `TutorGuard` внутрь `AppFrame`
- [ ] **TASK-4** · Удалить `TutorLayout.tsx` + grep-проверка на 0 импортов
- [ ] **TASK-5** · P1 polish: mobile swipe gesture, body scroll lock (iOS-compat), counter tooltip, link prefetch
- [ ] **TASK-6** · Codex review по всем AC + 13-pages smoke

---

## 11. Parking Lot

- **TopBar с breadcrumbs / global search / command palette (⌘K).** Закрыто решением 2026-04-22; revisit только при конкретном pilot-сигнале («нужен быстрый поиск по 100+ ученикам»).
- **Collapsed mode SideNav (64px icon-only).** Toggle + localStorage persist. Маленький UX лифт, но требует icon-variant на каждом nav item и handling в mobile пока неактуально.
- **Группы / Мои задачи / Тарифы nav items.** Добавить когда соответствующие feature-surfaces landed (отдельные specs).
- **Avatar + profile dropdown** в SideNav footer или top bar.
- **Notifications bell + unread badge** в mobile top bar.
- **Theme toggle** (light / dark / system) в SideNav footer — только после global dark-mode spec.
- **SideNav customization** (reorder групп, hide items) — personalisation для power-users.
- **Nav prefetch on hover** (текущий warmup в TutorLayout сейчас auto-fires через setTimeout 300ms) — в P0 перенесём как есть, в P1 заменим на onMouseEnter.

---

## Checklist перед approve

- [x] Job Context заполнен (R3, R4)
- [x] Привязка к Core Job + sub-jobs
- [x] Scope чётко определён (P0 / P1 / Out-of-scope / Parking Lot)
- [x] UX-принципы из doc 16 учтены
- [x] UI-паттерны из doc 17 учтены
- [x] Pilot impact описан (density + design coherence)
- [x] Метрики успеха leading + lagging
- [x] AC testable, ≥ 3 (всего 15)
- [x] P0 ≤ 5 по requirements (всего 12 P0 — chrome = atomic, не разбивается дальше без создания бесполезных intermediate shippable states)
- [x] High-risk файлы (AuthGuard, Chat.tsx) не затрагиваются. TutorGuard — **перемещается** внутрь AppFrame (не модифицируется, просто обёртка меняется) → не блокирует
- [x] Student/Tutor изоляция не нарушена (feature только tutor-side)
- [x] Design system rules (SKILL.md, rule 90) соблюдены: mode wrapper, token hierarchy, no hex, Golos Text, one primary per screen (в chrome primary нет)
- [x] Accessibility: focus trap, keyboard, aria, screen reader — spec'ирован
- [x] Rollback-план: один revert коммит восстанавливает `TutorLayout.tsx` + убирает AppFrame → все страницы продолжают работать
- [ ] Approve от Vladimir перед переходом к `tasks.md`
