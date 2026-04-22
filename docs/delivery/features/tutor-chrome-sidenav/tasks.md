# Tasks — Tutor Chrome SideNav (Phase 2a)

**Status:** Draft
**Pipeline step:** 5 (TASKS)
**Owner:** Vladimir
**Date:** 2026-04-22
**Спека:** `./spec.md` (approved)
**Предшественник:** `tutor-dashboard-v2/` (Phase 1 shipped 2026-04-21, TASK-1..6 done)

---

## Обзор

4 задачи + 1 review. **TASK-3 атомарна** (partial миграция = broken tutor side). Порядок строго последовательный. P0 (TASK-1..3) деплоится одним PR. TASK-4 P1 — follow-up.

| # | Задача | Статус | Приоритет | Агент | Основные файлы | AC |
|---|---|---|---|---|---|---|
| TASK-1 | CSS layer (`tutor-chrome.css`) + import | ✅ done 2026-04-22 | P0 | Claude Code | `src/styles/tutor-chrome.css`, `src/index.css` | AC-2, AC-6, AC-10 |
| TASK-2 | Chrome components + hooks | ✅ done 2026-04-22 | P0 | Claude Code | `src/components/tutor/chrome/*`, `src/hooks/useFocusTrap.ts`, `src/hooks/useTutorChromeCounters.ts` | AC-1, AC-3..AC-9, AC-11, AC-12 |
| TASK-3 | Route-group migration + strip `TutorLayout` из всех страниц + перенос `TutorGuard` + **удалить** `TutorLayout.tsx` | ✅ done 2026-04-22 | P0 | Claude Code | `src/App.tsx`, все 13 tutor pages, **delete** `src/components/tutor/TutorLayout.tsx` | AC-1, AC-2, AC-6, AC-10, AC-13, AC-14 |
| REVIEW | Codex aggregate review TASK-1..3 → CONDITIONAL PASS; follow-up fixes (`inert` on closed drawer + Space activation) landed 2026-04-22 | ✅ done 2026-04-22 | — | Codex + Claude Code | `MobileDrawer.tsx`, `SideNav.tsx` | AC-11 |
| TASK-4 | P1 polish: mobile swipe gesture + body scroll lock iOS-compat + counter tooltip + link prefetch | ⏳ todo | P1 | Claude Code | `MobileDrawer.tsx`, `SideNav.tsx`, `src/styles/tutor-chrome.css` | AC-15 |

**Деплой:**
- **TASK-1..3 = один PR, atomic** (нельзя деплоить партиально — партиальный state = broken tutor UI).
- **TASK-4 = follow-up PR** через 1–2 дня после первого отклика на iOS / keyboard feedback.

---

## TASK-1 — CSS layer (`tutor-chrome.css`)

**Job:** R4-1 (визуальная согласованность).
**Agent:** Claude Code.
**Files:** `src/styles/tutor-chrome.css` (новый), `src/index.css` (добавить @import).
**Acceptance:** AC-2 (desktop rail), AC-6 (mobile top bar), AC-10 (active state styling).
**Depends on:** —

### Что сделать

1. Создать `src/styles/tutor-chrome.css`. Содержимое per spec §5 «CSS structure» — в одном файле:
   - `.t-app` (grid root + responsive `grid-template-columns`)
   - `.t-app__rail` (desktop rail, sticky top, `display: none` → `display: block` @1024+)
   - `.t-app__main` (overflow-y scroll, padding, mobile padding-top для top bar clearance)
   - `.t-nav*` (brand, group-label, item, count, footer, active modifier)
   - `.t-mobile-top` (mobile 56px bar, `display: none` → `display: flex` @<1024)
   - `.t-mobile-drawer*` (fixed overlay, transform-based slide)
   - `.t-mobile-backdrop*` (fade overlay)

2. Все правила читают **только** `var(--sokrat-*)` из уже импортированного `colors_and_type.css`. **Никаких** новых переменных / hex-значений / font families.

3. В `src/index.css` добавить:
   ```css
   @import './styles/tutor-chrome.css';
   ```
   **сразу после** `@import './styles/tutor-dashboard.css'` и **до** Tailwind layers.

4. Проверить sanity: после импорта запустить `npm run dev`, убедиться что консоль не выплёвывает CSS warnings и dashboard не ломается визуально (файл не должен перекрывать существующие `.t-*` классы из `tutor-dashboard.css` — namespace `t-app` / `t-nav` / `t-mobile-*` не пересекается с `t-section` / `t-stats` / `t-table`).

### Guardrails

- **Не** добавлять новых CSS-переменных.
- **Не** дублировать классы из `tutor-dashboard.css` (`t-section`, `t-stats`, `t-chip`, etc. остаются там).
- **Не** менять `src/styles/colors_and_type.css`.
- Все namespace строго `t-app` / `t-nav` / `t-mobile-*` — не перекрывают shadcn / Tailwind / существующие классы.
- Media queries: breakpoint `1024px` — hard boundary desktop vs mobile (спека §3).
- Transition durations — только `var(--sokrat-dur-base)` + `var(--sokrat-ease-smooth)` (rule 90, no new motion rules).

### Mandatory end block

```
npm run lint
npm run build
```

Отчёт:
- размер `tutor-chrome.css` в строках
- grep `rg "(#[0-9a-fA-F]{3,8})" src/styles/tutor-chrome.css` → должно вернуть 0 (или только `rgba()` из handoff — допустим только backdrop `rgba(15, 23, 42, 0.5)`)
- подтверждение что dev-server стартовал без CSS warnings
- подтверждение что tutor-dashboard визуально не деградировал (/tutor/home рендерится ОК)

---

## TASK-2 — Chrome components + hooks

**Job:** R3-1 (быстрая навигация), R4-1.
**Agent:** Claude Code.
**Files:**
- Новые: `src/components/tutor/chrome/AppFrame.tsx`, `SideNav.tsx`, `MobileTopBar.tsx`, `MobileDrawer.tsx`
- Новые hooks: `src/hooks/useFocusTrap.ts`, `src/hooks/useTutorChromeCounters.ts`

**Acceptance:** AC-1, AC-3, AC-4, AC-5, AC-7, AC-8, AC-9, AC-11, AC-12.
**Depends on:** TASK-1 (CSS классы).

### Что сделать

#### 1. `useFocusTrap(ref, enabled)` hook
- Простой custom hook (~20 строк). Возвращает void.
- При `enabled`: Tab / Shift+Tab циклит внутри `ref.current` между focusable элементами.
- Focusable selectors: `'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'`.
- Обнаруживает изменения размеров/наполнения через `MutationObserver` опционально (не обязательно — можно обновить при open).
- **Не** используем external libs (focus-trap, react-focus-lock) — минимальная реализация.

#### 2. `useTutorChromeCounters()` hook
- Возвращает `{ activeStudents: number | null, activeHomework: number | null }`.
- `activeStudents`: из existing `useTutorStudents()` → `.filter(s => s.status === 'active').length`.
- `activeHomework`: `useQuery` с key `['tutor', 'chrome', 'active-hw-count']`:
  - Fetch: `supabase.from('homework_tutor_assignments').select('id', { count: 'exact', head: true }).eq('tutor_id', me).eq('status', 'active')`.
  - `staleTime: 60_000`.
  - При loading → `null` (бейдж покажет `—`).
- Получение `me` — через existing паттерн `getCurrentTutor()` или `getSession()` (rule performance.md §2a).

#### 3. `<SideNav>` component
- Props: `{ isMobile?: boolean; onNavigate?: () => void }`. `isMobile=true` передаётся из `MobileDrawer` — активирует `onClick` handler для закрытия drawer при клике на link.
- Структура:
  ```tsx
  <nav className="t-nav" aria-label="Разделы">
    <div className="t-nav__brand">
      <img src={sokratLogo} alt="" width={28} height={28} />
      <span className="t-nav__brand-name">Сократ AI</span>
    </div>
    {groups.map(g => (
      <Fragment key={g.label}>
        <div className="t-nav__group-label" role="heading" aria-level={2}>{g.label}</div>
        {g.items.map(it => <NavItem key={it.href} item={it} />)}
      </Fragment>
    ))}
    <div className="t-nav__footer">
      <button className="t-nav__item" onClick={handleLogout}>
        <LogOut size={18} />
        <span>Выйти</span>
      </button>
    </div>
  </nav>
  ```
- Groups структура (константа в файле):
  ```ts
  const NAV_GROUPS = [
    { label: 'Работа', items: [
      { href: '/tutor/home',      icon: LayoutDashboard, label: 'Главная' },
      { href: '/tutor/schedule',  icon: CalendarDays,    label: 'Расписание' },
      { href: '/tutor/homework',  icon: BookOpen,        label: 'Домашние задания', counter: 'activeHomework' },
    ]},
    { label: 'Ученики', items: [
      { href: '/tutor/students',  icon: Users,           label: 'Все ученики',       counter: 'activeStudents' },
    ]},
    { label: 'Материалы', items: [
      { href: '/tutor/knowledge', icon: Library,         label: 'База знаний' },
      { href: '/tutor/assistant', icon: Bot,             label: 'Помощник' },
    ]},
    { label: 'Финансы', items: [
      { href: '/tutor/payments',  icon: CreditCard,      label: 'Оплаты' },
    ]},
  ];
  ```
- `NavItem` — memoized `<Link>` → `to={item.href}` + lucide icon + label + counter badge.
- Active state: `location.pathname.startsWith(item.href)` → class `t-nav__item--active` + `aria-current="page"`.
- **Важно AC-10:** matching должно корректно различать `/tutor/homework/123` → активирует `Домашние задания`, но `/tutor/homework/templates` тоже → активирует `Домашние задания` (prefix match works). `/tutor/home` — специальный case: prefix `/tutor/home` также matches `/tutor/homework` если naive startsWith! → использовать `location.pathname === item.href || location.pathname.startsWith(item.href + '/')`.
- Logout: `await supabase.auth.signOut()` + `toast.success('Вы вышли из системы')` + `navigate('/login')` (копи паттерна из существующего TutorLayout).
- Counter badge: при наличии `item.counter` ключа — вывести `<span className="t-nav__count">{counters[item.counter] ?? '—'}</span>`.
- При `isMobile=true`: на каждом link добавить `onClick={onNavigate}` — чтобы клик закрывал drawer.

#### 4. `<MobileTopBar>` component
- Props: `{ onOpenDrawer: () => void }`.
- Структура:
  ```tsx
  <div className="t-mobile-top">
    <button
      type="button"
      className="t-mobile-top__hamburger"
      onClick={onOpenDrawer}
      aria-label="Открыть меню"
      aria-expanded={false}
      aria-controls="tutor-sidenav-drawer"
    >
      <Menu size={20} />
    </button>
    <Link to="/tutor/home" className="t-mobile-top__brand">
      <img src={sokratLogo} alt="" width={24} height={24} />
      <span>Сократ AI</span>
    </Link>
    <button
      type="button"
      onClick={handleLogout}
      aria-label="Выйти"
      className="t-mobile-top__logout"
    >
      <LogOut size={18} />
    </button>
  </div>
  ```
- `aria-expanded` должен быть динамическим — берется из drawer state. Проще: передать `isOpen` как ещё один prop.
- Hit target 44px на hamburger и logout buttons — добавить в `tutor-chrome.css` если не хватает дефолтов (TASK-1 уже определяет `.t-mobile-top__hamburger` и `.t-mobile-top__logout`).

#### 5. `<MobileDrawer>` component
- Props: `{ open: boolean; onClose: () => void }`.
- Структура:
  ```tsx
  <>
    <div
      className={`t-mobile-backdrop ${open ? 't-mobile-backdrop--open' : ''}`}
      onClick={onClose}
      role="presentation"
    />
    <aside
      id="tutor-sidenav-drawer"
      className={`t-mobile-drawer ${open ? 't-mobile-drawer--open' : ''}`}
      aria-label="Мобильное меню"
      aria-hidden={!open}
      ref={drawerRef}
    >
      <SideNav isMobile onNavigate={onClose} />
    </aside>
  </>
  ```
- Keyboard: `useEffect` слушает `keydown` (Esc → `onClose`) когда `open=true`.
- Focus trap: `useFocusTrap(drawerRef, open)`.
- Restore focus: при переходе `open: true → false` — focus возвращается на last-focused-element (сохранённый через `useRef<HTMLElement>` при открытии). Если last-focused не существует — `document.body`.
- Body scroll lock (P0 minimal): `useEffect` при `open=true` добавляет `document.body.style.overflow = 'hidden'`, при closing — восстанавливает. **Важно:** это базовая версия; iOS-safe вариант через `position: fixed` — Parking Lot / TASK-4.

#### 6. `<AppFrame>` component (root wrapper)
- Структура:
  ```tsx
  export function AppFrame() {
    const [drawerOpen, setDrawerOpen] = useState(false);
    return (
      <TutorGuard>
        <div className="sokrat t-app" data-sokrat-mode="tutor">
          <aside className="t-app__rail">
            <SideNav />
          </aside>
          <MobileTopBar
            isDrawerOpen={drawerOpen}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
          <MobileDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
          />
          <main className="t-app__main">
            <Outlet />
          </main>
        </div>
      </TutorGuard>
    );
  }
  ```
- **`<TutorGuard>` переезжает сюда** — больше не нужен в каждой отдельной странице. Это упрощает код 13 страниц в TASK-3.
- `<Outlet />` из `react-router-dom` рендерит дочерние routes.

### Guardrails

- **Не** использовать framer-motion (rule performance §2). Все transitions — CSS.
- **Не** использовать external focus-trap libraries.
- **Не** менять `TutorGuard` — он просто переезжает как обёртка в AppFrame.
- **Не** добавлять `mode="tutor"` wrapper в каждую страницу (как в Phase 1 `TutorHome.tsx`) — wrapper теперь один на AppFrame (нужно убрать dublicate из `TutorHome.tsx` в TASK-3).
- **Не** дублировать warmup effect из текущего `TutorLayout` — прилёт в TASK-4 P1 (link prefetch на hover). Пока без warmup — быстро пережить первый переход без prefetch.
- `React.memo` на `NavItem` — rule performance §2.
- `parseISO` из date-fns если где-то нужны даты (rule 80).

### Mandatory end block

```
npm run lint
npm run build
npm run smoke-check
```

Отчёт:
- Список созданных файлов (6 новых)
- Size each file в строках
- grep `rg "framer-motion" src/components/tutor/chrome` → должно вернуть 0
- grep `rg "focus-trap|react-focus-lock" package.json` → должно вернуть 0
- AC-1: ручная проверка DOM на dev — `<div class="sokrat t-app" data-sokrat-mode="tutor">` присутствует
- AC-3: 4 группы в правильном порядке в SideNav
- AC-4: brand «Сократ AI» с PNG лого
- AC-5: Logout в footer SideNav (desktop)
- AC-7: hamburger tap → drawer slide-in (mobile)
- Self-check по SKILL.md §11 pre-flight checklist

---

## TASK-3 — Route-group migration + cleanup (ATOMIC)

**Job:** R4-1 (единая chrome-обёртка для всех tutor routes).
**Agent:** Claude Code.
**Files:**
- `src/App.tsx` — route-group
- Все 13 tutor pages — убрать `<TutorLayout>` wrapper из их JSX + убрать `<TutorGuard>` (он теперь в AppFrame)
- **Удалить:** `src/components/tutor/TutorLayout.tsx`

**Acceptance:** AC-1, AC-2, AC-6, AC-10, AC-13, AC-14.
**Depends on:** TASK-1, TASK-2.

**⚠ АТОМАРНАЯ задача** — partial migration ломает tutor-side полностью. Все 13 страниц + App.tsx должны измениться в одном коммите.

### Список 13 tutor pages для миграции

1. `src/pages/tutor/TutorHome.tsx`
2. `src/pages/tutor/TutorHomework.tsx`
3. `src/pages/tutor/TutorHomeworkCreate.tsx`
4. `src/pages/tutor/TutorHomeworkDetail.tsx`
5. `src/pages/tutor/TutorHomeworkTemplates.tsx`
6. `src/pages/tutor/TutorStudents.tsx`
7. `src/pages/tutor/TutorStudentProfile.tsx`
8. `src/pages/tutor/TutorSchedule.tsx`
9. `src/pages/tutor/TutorPayments.tsx`
10. `src/pages/tutor/TutorAssistant.tsx`
11. `src/pages/tutor/knowledge/KnowledgeBasePage.tsx`
12. `src/pages/tutor/knowledge/CatalogTopicPage.tsx`
13. `src/pages/tutor/knowledge/FolderPage.tsx`

### Что сделать

#### Шаг 1. Pre-flight grep
```bash
rg "TutorLayout" src/
rg "TutorGuard" src/pages/tutor/
rg "data-sokrat-mode=\"tutor\"" src/
```
Записать результаты — знать каждое место, которое нужно модифицировать.

#### Шаг 2. `src/App.tsx`
- Найти текущую регистрацию tutor routes. Заменить на route-group:
  ```tsx
  <Route path="/tutor" element={<AppFrame />}>
    <Route index element={<Navigate to="home" replace />} />
    <Route path="home" element={<TutorHome />} />
    <Route path="homework" element={<TutorHomework />} />
    <Route path="homework/create" element={<TutorHomeworkCreate />} />
    <Route path="homework/templates" element={<TutorHomeworkTemplates />} />
    <Route path="homework/:id" element={<TutorHomeworkDetail />} />
    <Route path="homework/:id/results" element={<RedirectHomeworkResultsToDetail />} />
    <Route path="students" element={<TutorStudents />} />
    <Route path="students/:id" element={<TutorStudentProfile />} />
    <Route path="schedule" element={<TutorSchedule />} />
    <Route path="payments" element={<TutorPayments />} />
    <Route path="assistant" element={<TutorAssistant />} />
    <Route path="knowledge/*" element={<KnowledgeBasePage />} />
    <Route path="dashboard" element={<Navigate to="/tutor/home" replace />} />
  </Route>
  ```
- **Порядок routes важен:** более специфичные (`homework/create`, `homework/templates`, `homework/:id/results`) **до** общих (`homework/:id`). React Router v6 matches в declared order.
- **Note про knowledge:** knowledge использует nested routes внутри — если там уже есть свой router, оставляем `knowledge/*` с wildcard match.

#### Шаг 3. Модификация каждой из 13 pages

**Универсальный pattern (до):**
```tsx
export default function TutorHome() {
  return (
    <TutorGuard>
      <TutorLayout>
        <div className="sokrat" data-sokrat-mode="tutor">  {/* только в TutorHome */}
          <TutorHomeContent />
        </div>
      </TutorLayout>
    </TutorGuard>
  );
}
```

**После:**
```tsx
export default function TutorHome() {
  return <TutorHomeContent />;
}
```

**Что убрать:**
1. `<TutorGuard>` wrapper — теперь в AppFrame
2. `<TutorLayout>` wrapper — удалён полностью
3. `<div className="sokrat" data-sokrat-mode="tutor">` wrapper (только в TutorHome) — теперь в AppFrame

**Что оставить:** весь внутренний контент (TutorHomeContent, data hooks, business logic).

**Осторожность с imports:** убрать `import { TutorLayout } from '...'` и `import TutorGuard from '...'` из всех 13 файлов.

#### Шаг 4. Удаление `src/components/tutor/TutorLayout.tsx`
- Pre-delete grep: `rg "TutorLayout" src/` → должен возвращать **0 совпадений** (после Шага 3).
- Если есть — починить, потом удалить.
- `rm src/components/tutor/TutorLayout.tsx`.

#### Шаг 5. Post-migration smoke (вручную)
- Открыть каждый из 13 routes → визуально проверить:
  - SideNav показан на desktop (≥ 1024px)
  - MobileTopBar + drawer на mobile (<1024px)
  - Активный nav-item подсвечен
  - Logout работает
  - Контент страницы не ломается (внутренний layout прежний)

### Guardrails

- **ATOMIC:** все 13 страниц + App.tsx + delete TutorLayout.tsx — один коммит. Не пушить partial state.
- **Не** менять `TutorGuard` — только место его вызова (переезжает в AppFrame).
- **Не** трогать high-risk файлы из CLAUDE.md (`Chat.tsx`, `AuthGuard.tsx`, `TutorSchedule.tsx` — подожди, TutorSchedule в list high-risk). Для TutorSchedule: убрать только `<TutorGuard><TutorLayout>` wrapper, внутренний контент НЕ трогать.
- **Не** забыть `src/components/tutor/knowledge/*` — они могут иметь nested TutorLayout usage.
- В App.tsx важен порядок routes внутри group (specific → generic).

### Mandatory end block

```
npm run lint
npm run build
npm run smoke-check
```

Ручная проверка:
1. `rg "TutorLayout" src/` → 0 совпадений ✓
2. `rg "TutorGuard" src/pages/tutor/` → 0 совпадений (guard в AppFrame) ✓
3. `rg "data-sokrat-mode" src/` → возвращает только `src/components/tutor/chrome/AppFrame.tsx` ✓
4. Все 13 tutor routes работают без regression (manual smoke)
5. Redirect `/tutor/dashboard` → `/tutor/home` ещё работает (проверить bookmark path)
6. Mobile <1024px: hamburger работает, drawer открывается, link-клик закрывает drawer ✓
7. Desktop ≥1024px: SideNav sticky, активный item зелёный ✓

Отчёт:
- Diff stats: `git diff --stat` — должно быть ~14 файлов изменено + 1 удалён
- Screenshot `/tutor/home`, `/tutor/homework`, `/tutor/students`, `/tutor/schedule` на 1280×800 и 375×812
- Self-check AC-1, AC-2, AC-6, AC-10, AC-13, AC-14
- docs-to-update: CLAUDE.md «Известные хрупкие области» — добавить пункт про AppFrame как canonical tutor wrapper (пример шаблона ниже, применить после merge)

### Пример записи в CLAUDE.md (для TASK-3 reporter, применить после merge)

```markdown
14. **Tutor Chrome (AppFrame + SideNav)** — единая обёртка для всех tutor routes (Phase 2a, 2026-04-22). `src/components/tutor/chrome/AppFrame.tsx` содержит `TutorGuard` + mode wrapper `data-sokrat-mode="tutor"`. Все tutor-страницы рендерятся через `<Outlet />` и **не должны** оборачивать свой контент в TutorGuard / data-sokrat-mode / `<TutorLayout>` (последний удалён в коммите `<sha>`). При добавлении новой tutor-страницы — просто `export default function TutorFoo() { return <TutorFooContent />; }` + регистрация в route-group в `App.tsx`.
```

---

## TASK-4 — P1 polish

**Job:** R3-1 (smooth mobile UX), R4 (iOS correctness).
**Agent:** Claude Code.
**Priority:** P1 (follow-up PR через 1–2 дня после P0).
**Files:** `src/components/tutor/chrome/MobileDrawer.tsx`, `SideNav.tsx`, `src/styles/tutor-chrome.css`.
**Acceptance:** AC-15 (body scroll lock на iOS).
**Depends on:** TASK-3 в проде.

### Что сделать

#### 1. iOS-safe body scroll lock (AC-15)
- Сейчас в TASK-2 было `document.body.style.overflow = 'hidden'` — базово работает на desktop и Android, но на iOS Safari разрешает scroll задним фоном (known issue).
- iOS-safe pattern:
  ```ts
  // при open=true:
  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  // при close:
  const savedScroll = parseInt(document.body.style.top || '0', 10) * -1;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  window.scrollTo(0, savedScroll);
  ```
- Обернуть в helper `useBodyScrollLock(enabled)` в `src/hooks/useBodyScrollLock.ts`.

#### 2. Mobile swipe gesture (close drawer)
- `MobileDrawer`: слушать touchstart / touchmove / touchend на `.t-mobile-drawer`.
- Если `touchmove deltaX < -40px` (свайп влево ≥ 40px) — закрыть drawer.
- Backdrop swipe — тоже close (`onTouchMove`).
- **Не** добавлять `framer-motion` / gesture libs — native events.
- Фичу лучше ставить под feature flag / graceful degradation (если события не поддерживаются — fallback на backdrop-click, всё ещё работает).

#### 3. Counter badge tooltip (desktop)
- При hover на nav item `Домашние задания` / `Все ученики` — показать native `title` tooltip:
  - `title="12 активных ДЗ из 34 всего"` (для `activeHomework` и `totalHomework`).
  - `title="14 активных учеников из 28"` (для `activeStudents` и `totalStudents`).
- `useTutorChromeCounters` hook дополняется `totalStudents` + `totalHomework` (не только `active*`).
- **P0 ограничение:** в P0 tooltip отсутствовал, badge показывал только `active`. В P1 добавляем контекст.

#### 4. Link prefetch on hover
- Перенести warmup effect из старого `TutorLayout.tsx` (`setTimeout 300ms` после mount) на **hover-based prefetch** в `SideNav`.
- На каждом `NavItem` — `onMouseEnter` → `import()` lazy chunk для target page.
- Использовать React Router v6 `<Link>` + `onMouseEnter` handler или custom `PreloadLink` wrapper.

### Guardrails

- **Не** менять TASK-2 chrome file signatures — только internals.
- **Не** добавлять external libs.
- Swipe gesture требует `touch-action: pan-y` на drawer (не `pan-x` — иначе вертикальный скролл drawer сломается). Проверить в `tutor-chrome.css`.
- iOS Safari: helper `useBodyScrollLock` нужно тестировать на физ-устройстве или DevTools iOS Safari simulation.

### Mandatory end block

```
npm run lint && npm run build && npm run smoke-check
```

Manual:
- iOS Safari (real device если возможно): открыть drawer → прокрутить фоновую страницу — должно быть заблокировано.
- Swipe влево на open drawer → закрывается.
- Hover на nav `Домашние задания` → tooltip с контекстом.
- Hover на nav link → Network панель показывает preloaded chunk.

Отчёт:
- Видео iOS Safari scroll lock test (опционально)
- Grep `framer-motion|@use-gesture|react-use-gesture` → 0 в новых файлах

---

## REVIEW — Independent Codex pass

**Agent:** Codex (clean session).
**Scope:** PR с TASK-1..3 (P0). Отдельный review для TASK-4 после follow-up.
**Критерии:** все AC из `spec.md` §7.

### Что проверить

По `spec.md`:
- [ ] AC-1: DOM wrapper `<div class="sokrat t-app" data-sokrat-mode="tutor">` присутствует на всех tutor routes.
- [ ] AC-2: desktop ≥1024px — rail 240px sticky.
- [ ] AC-3: 4 группы в правильном порядке, Помощник в «Материалы».
- [ ] AC-4: brand `sokratLogo` + «Сократ AI» (не monogram / не «Сократ · Тьютор»).
- [ ] AC-5: Logout в footer SideNav (desktop).
- [ ] AC-6: mobile <1024px — 56px top bar, rail скрыт.
- [ ] AC-7: hamburger → drawer slide + backdrop.
- [ ] AC-8: drawer закрывается backdrop / Esc / link click, focus возвращается на hamburger.
- [ ] AC-9: counter badges live data, tabular-nums, правильные цвета для active/non-active.
- [ ] AC-10: active nav item `aria-current="page"` + зелёный bg/fg/weight. Prefix matching для nested routes.
- [ ] AC-11: Keyboard Tab / Enter / Space работают.
- [ ] AC-12: Focus trap в mobile drawer.
- [ ] AC-13: `rg TutorLayout src/` → 0 совпадений.
- [ ] AC-14: все 13 tutor routes без регрессий (smoke pass).

По SKILL.md / rule 90:
- [ ] Mode wrapper в AppFrame (не дублируется на страницах).
- [ ] Нет hex вне `colors_and_type.css`. Исключение: `rgba(15, 23, 42, 0.5)` на backdrop — из handoff, допустимо.
- [ ] Нет emoji в UI chrome.
- [ ] Golos Text через унаследованный token.
- [ ] Tabular-nums на counter badges.

По performance.md / rule 80:
- [ ] Нет framer-motion.
- [ ] Нет external focus-trap / swipe libs.
- [ ] `React.memo` на NavItem.
- [ ] Query keys `['tutor', 'chrome', ...]`.
- [ ] Safari iOS body scroll lock (если TASK-4 в scope — проверить; если нет — AC-15 out of P0).

Special checks:
- [ ] `TutorGuard` переехал в AppFrame (не дублируется в страницах).
- [ ] Порядок routes в App.tsx: specific → generic.
- [ ] High-risk файлы (AuthGuard, Chat.tsx) не тронуты.
- [ ] Rollback plan: один revert коммит восстанавливает TutorLayout.tsx.

### Формат вывода

`PASS` / `CONDITIONAL PASS` / `FAIL`. При `CONDITIONAL PASS` / `FAIL` — список конкретных fix-requirements с указанием файла:строки.

---

## Copy-paste промпты для агентов

### Промпт TASK-1

```
Ты — senior product-minded full-stack engineer в проекте SokratAI (sokratai.ru). Russian-language AI-тутор для ЕГЭ/ОГЭ. B2B-сегмент: репетиторы физики. AI = draft + action.

РАБОТАЕМ НАД TASK-1 фичи Tutor Chrome SideNav (Phase 2a).

ОБЯЗАТЕЛЬНЫЕ ФАЙЛЫ К ПРОЧТЕНИЮ:
1. docs/delivery/features/tutor-chrome-sidenav/spec.md (целиком, approved)
2. docs/delivery/features/tutor-chrome-sidenav/tasks.md (секция TASK-1)
3. SKILL.md (§5 token hierarchy, §11 pre-flight)
4. src/styles/colors_and_type.css (single source of truth tokens)
5. src/styles/tutor-dashboard.css (существующий tutor-стиль слой — проверить namespace непересечения)
6. docs/design-system/handoff-dashboard/tutor-kit/tokens.css (handoff — референс для .t-app / .t-nav)
7. .claude/rules/90-design-system.md (anti-patterns, density)

ЗАДАЧА:
Создать `src/styles/tutor-chrome.css` — helper-слой для нового AppFrame + SideNav + mobile top bar + mobile drawer. Содержимое per spec §5 «CSS structure». Namespace `t-app` / `t-nav` / `t-mobile-*`. Все правила читают ТОЛЬКО var(--sokrat-*). Никаких новых переменных / hex / font families. Исключение: единственное допустимое hex-значение — `rgba(15, 23, 42, 0.5)` на backdrop (из handoff, соответствует slate-900 с прозрачностью).

В `src/index.css` добавить `@import './styles/tutor-chrome.css';` сразу после импорта tutor-dashboard.css и ДО Tailwind layers.

ACCEPTANCE (AC-2, AC-6, AC-10 из spec):
- `.t-app__rail` видим только @≥1024px, width 240px, sticky.
- `.t-mobile-top` видим только @<1024px, height 56px.
- `.t-nav__item--active` имеет bg/fg/font-weight per spec §6.

GUARDRAILS:
- Не дублировать classes из tutor-dashboard.css.
- Не менять colors_and_type.css.
- Transition только var(--sokrat-dur-base) + var(--sokrat-ease-smooth).
- Breakpoint 1024px — hard boundary.

MANDATORY END BLOCK:
1. `npm run lint`
2. `npm run build`
3. Отчёт: размер файла, rg hex-чеки, dev-smoke подтверждение, /tutor/home не деградировало.
4. Self-check по rule 90 anti-patterns.
```

### Промпт TASK-2

```
Ты — senior product-minded full-stack engineer в проекте SokratAI. B2B-сегмент: репетиторы физики. AI = draft + action.

РАБОТАЕМ НАД TASK-2 фичи Tutor Chrome SideNav (Phase 2a).

ОБЯЗАТЕЛЬНЫЕ ФАЙЛЫ К ПРОЧТЕНИЮ:
1. docs/delivery/features/tutor-chrome-sidenav/spec.md (целиком)
2. docs/delivery/features/tutor-chrome-sidenav/tasks.md (секция TASK-2)
3. docs/design-system/handoff-dashboard/tutor-kit/chrome.jsx (handoff reference)
4. src/components/tutor/TutorLayout.tsx (существующий — для reference на Logout pattern, warmup effect)
5. src/components/Navigation.tsx (для reference: как сейчас подключён sokratLogo)
6. src/hooks/useTutorStudents.ts (для counter)
7. src/lib/tutorHomeworkApi.ts (для fetch active-hw-count)
8. .claude/rules/performance.md (React.memo, query keys, getSession vs getUser)
9. .claude/rules/80-cross-browser.md (touch-action, iOS)

ЗАДАЧА:
Создать 6 файлов:
- `src/hooks/useFocusTrap.ts` — custom focus trap (~20 lines, no external libs)
- `src/hooks/useTutorChromeCounters.ts` — { activeStudents, activeHomework }, query key ['tutor','chrome','active-hw-count']
- `src/components/tutor/chrome/SideNav.tsx` — 4 групп / 7 items per spec §3 КР-5 + brand + footer Logout
- `src/components/tutor/chrome/MobileTopBar.tsx` — 56px bar с hamburger + brand + logout
- `src/components/tutor/chrome/MobileDrawer.tsx` — overlay + backdrop + focus trap + body scroll lock (basic) + Esc
- `src/components/tutor/chrome/AppFrame.tsx` — root wrapper с <TutorGuard> + <Outlet /> + drawer state

ВАЖНО:
- Brand = sokratLogo PNG + «Сократ AI» (не monogram «С»).
- Помощник в группе «Материалы» (per spec §3 КР-5).
- Active matching: `location.pathname === item.href || location.pathname.startsWith(item.href + '/')` (rule против false-positive /tutor/home vs /tutor/homework).
- <TutorGuard> переезжает в AppFrame (не в отдельных страницах — это TASK-3).
- Groups / items: Работа (Главная, Расписание, Домашние задания+counter), Ученики (Все ученики+counter), Материалы (База знаний, Помощник), Финансы (Оплаты).

ACCEPTANCE (AC-1, AC-3, AC-4, AC-5, AC-7, AC-8, AC-9, AC-11, AC-12):
- DOM: <div class="sokrat t-app" data-sokrat-mode="tutor">.
- SideNav: 4 группы в правильном порядке.
- Brand: PNG + «Сократ AI».
- Logout в footer (desktop) / top bar (mobile).
- Hamburger → slide-in drawer + backdrop, Esc / link / backdrop close.
- Counter badges live, tabular-nums, correct colors.
- Focus trap в drawer, Enter/Space on items.

GUARDRAILS:
- НЕ framer-motion.
- НЕ external focus-trap / react-focus-lock.
- React.memo на NavItem.
- Query keys ['tutor','chrome',...].
- getSession() для user.id, не getUser().

MANDATORY END BLOCK:
1. `npm run lint && npm run build && npm run smoke-check`
2. Отчёт: 6 файлов, размеры, grep-чеки (framer-motion=0, focus-trap=0), DOM inspect подтверждения AC-1/AC-3/AC-4/AC-5/AC-7.
3. Self-check по SKILL.md §11 pre-flight checklist.
```

### Промпт TASK-3

```
Ты — senior product-minded full-stack engineer в проекте SokratAI. B2B-сегмент: репетиторы физики.

РАБОТАЕМ НАД TASK-3 фичи Tutor Chrome SideNav (Phase 2a). ЭТО АТОМАРНАЯ задача — partial migration ломает tutor side. Все изменения — в одном коммите.

ОБЯЗАТЕЛЬНЫЕ ФАЙЛЫ К ПРОЧТЕНИЮ:
1. docs/delivery/features/tutor-chrome-sidenav/spec.md (§5 Technical Design, Route structure)
2. docs/delivery/features/tutor-chrome-sidenav/tasks.md (секция TASK-3 — список 13 pages + pattern)
3. CLAUDE.md (High-Risk Files — AuthGuard, Chat.tsx НЕ ТРОГАТЬ; TutorSchedule, TutorSchedule — в списке high-risk, но тут только wrapper change, внутренний контент не трогаем)
4. src/App.tsx (текущая регистрация tutor routes)
5. src/components/tutor/TutorLayout.tsx (файл для удаления)
6. Все 13 tutor pages — список в tasks.md TASK-3

ЗАДАЧА:
1. Pre-flight grep записать текущее состояние:
   - `rg "TutorLayout" src/`
   - `rg "TutorGuard" src/pages/tutor/`
   - `rg "data-sokrat-mode" src/`
2. Обновить `src/App.tsx` — tutor routes под `<Route path="/tutor" element={<AppFrame />}>` с nested routes (see tasks.md для точного списка). Порядок: specific → generic (homework/create до homework/:id). Сохранить redirect /tutor/dashboard → /tutor/home.
3. В каждой из 13 tutor pages:
   - Убрать `<TutorGuard>` wrapper (теперь в AppFrame).
   - Убрать `<TutorLayout>` wrapper.
   - Убрать `<div className="sokrat" data-sokrat-mode="tutor">` (только TutorHome его имел — теперь это в AppFrame).
   - Убрать соответствующие imports.
4. Удалить `src/components/tutor/TutorLayout.tsx` после pre-delete grep (rg TutorLayout src/ → 0).
5. Обновить CLAUDE.md — добавить пункт №14 «Tutor Chrome (AppFrame + SideNav)» в список «Известные хрупкие области» (шаблон в tasks.md).

13 страниц:
- src/pages/tutor/TutorHome.tsx
- src/pages/tutor/TutorHomework.tsx
- src/pages/tutor/TutorHomeworkCreate.tsx
- src/pages/tutor/TutorHomeworkDetail.tsx
- src/pages/tutor/TutorHomeworkTemplates.tsx
- src/pages/tutor/TutorStudents.tsx
- src/pages/tutor/TutorStudentProfile.tsx
- src/pages/tutor/TutorSchedule.tsx
- src/pages/tutor/TutorPayments.tsx
- src/pages/tutor/TutorAssistant.tsx
- src/pages/tutor/knowledge/KnowledgeBasePage.tsx
- src/pages/tutor/knowledge/CatalogTopicPage.tsx
- src/pages/tutor/knowledge/FolderPage.tsx

ACCEPTANCE (AC-1, AC-2, AC-6, AC-10, AC-13, AC-14):
- DOM mode wrapper на каждом tutor route.
- 13 pages без регрессий.
- `rg TutorLayout src/` → 0.
- `rg TutorGuard src/pages/tutor/` → 0.
- Redirect /tutor/dashboard → /tutor/home работает.
- Mobile drawer закрывается при клике на link (navigate + close).

GUARDRAILS:
- АТОМАРНОСТЬ: один коммит, не пушить partial state.
- TutorSchedule (high-risk) — трогаем ТОЛЬКО wrapper, внутренний контент не модифицировать.
- Chat.tsx НЕ ТРОГАТЬ (но он student-side, не tutor — не должно требоваться).
- AuthGuard НЕ трогать.
- React Router v6 route order: specific → generic.

MANDATORY END BLOCK:
1. `npm run lint && npm run build && npm run smoke-check`
2. Manual smoke (открыть каждый из 13 routes + toggle между desktop 1280/mobile 375 + проверить hamburger/drawer/logout).
3. Final greps: rg TutorLayout src/ = 0, rg TutorGuard src/pages/tutor/ = 0, rg "data-sokrat-mode" src/ = только AppFrame.
4. Отчёт: git diff --stat (~14 files changed + 1 deleted), screenshots tutor routes.
5. docs-to-update: CLAUDE.md получает новый пункт про AppFrame canonical wrapper.
6. Self-check всех AC-1/2/6/10/13/14.
```

### Промпт TASK-4 (P1)

```
Ты — senior product-minded full-stack engineer в проекте SokratAI.

РАБОТАЕМ НАД TASK-4 фичи Tutor Chrome SideNav (Phase 2a, P1 polish). TASK-1..3 уже в проде.

ОБЯЗАТЕЛЬНЫЕ ФАЙЛЫ К ПРОЧТЕНИЮ:
1. docs/delivery/features/tutor-chrome-sidenav/spec.md (§7 AC-15)
2. docs/delivery/features/tutor-chrome-sidenav/tasks.md (секция TASK-4)
3. .claude/rules/80-cross-browser.md (iOS Safari, position:fixed body-lock pattern)
4. src/components/tutor/chrome/MobileDrawer.tsx (TASK-2 результат)
5. src/components/tutor/chrome/SideNav.tsx (TASK-2 результат)

ЗАДАЧА:
1. Создать `src/hooks/useBodyScrollLock.ts` — iOS-safe scroll lock через position: fixed + top: -scrollY (см. tasks.md TASK-4 §1).
2. В MobileDrawer: заменить простой `body.style.overflow='hidden'` на `useBodyScrollLock(open)`.
3. Добавить swipe gesture в MobileDrawer — touchmove deltaX < -40 → onClose (native events, без gesture libs).
4. Counter badges tooltip: `useTutorChromeCounters` дополнить `totalStudents` / `totalHomework`, в SideNav NavItem добавить `title` attribute с контекстом («N активных из M всего»).
5. Link prefetch on hover: перенести warmup effect из memoryа `TutorLayout` в SideNav `onMouseEnter`. Custom PreloadLink или inline.

ACCEPTANCE (AC-15):
- Body scroll locked при open drawer на iOS Safari (протестировать на физическом устройстве если возможно или DevTools iOS simulation).

GUARDRAILS:
- НЕ менять signatures из TASK-2 chrome files.
- НЕ добавлять framer-motion / @use-gesture / react-use-gesture (performance.md §2).
- touch-action: pan-y на drawer (не pan-x) — иначе вертикальный скролл drawer ломается.
- Prefetch не должен блокировать initial paint.

MANDATORY END BLOCK:
1. `npm run lint && npm run build && npm run smoke-check`
2. iOS Safari manual smoke: scroll lock test, swipe-close test.
3. Grep-чеки: framer-motion = 0, gesture libs = 0.
4. Видео / gif iOS demo опционально.
```

### Промпт REVIEW (Codex, чистая сессия)

```
Ты — независимый code-reviewer проекта SokratAI. Контекст первого агента тебе недоступен.

ПОРЯДОК (строго):
1. Прочитай docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md
2. Прочитай docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md
3. Прочитай docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md
4. Прочитай docs/delivery/features/tutor-chrome-sidenav/spec.md (целиком, approved)
5. Прочитай SKILL.md, .claude/rules/90-design-system.md, .claude/rules/performance.md, .claude/rules/80-cross-browser.md
6. Посмотри git diff PR (branch: feature/tutor-chrome-sidenav)

РЕВЬЮ-ЧЕК-ЛИСТ (все 15 AC из spec §7, см. tasks.md REVIEW секция).

ОСОБЫЕ ПРОВЕРКИ (anti-drift):
- Hex вне colors_and_type.css — запрещены (исключение документировано: rgba(15,23,42,0.5) backdrop).
- Inter/Roboto — запрещены.
- framer-motion / react-focus-lock / focus-trap / @use-gesture — запрещены.
- bg-accent / bg-primary в chrome CTA — запрещены (на самом деле в chrome нет CTA, но проверить).
- Cards inside cards — запрещены.
- Все tutor-страницы имеют mode wrapper ТОЛЬКО через AppFrame (не дублируется).
- rg TutorLayout src/ → 0.
- rg TutorGuard src/pages/tutor/ → 0.
- React Router v6 route order: specific до generic.
- High-risk files (AuthGuard, Chat.tsx) не тронуты.

UX-проверки:
- Density win: визуально подтверждается больше контента в viewport на 13″.
- Brand identity: logo PNG + «Сократ AI», не monogram.
- Помощник в «Материалы».
- Counter badges tabular-nums.
- Focus trap работает.

ФОРМАТ ВЫВОДА:
PASS / CONDITIONAL PASS / FAIL. При CONDITIONAL PASS / FAIL — список fix-requirements с файл:строка.
```

---

## Checklist перед стартом TASK-1

- [x] Spec approved (`spec.md` статус = approved)
- [x] Все blocking Open Questions закрыты (3 answered)
- [x] P0 / P1 разделены
- [x] High-risk файлы (Chat.tsx, AuthGuard) не затронуты
- [x] Rollback plan: один revert коммит (восстанавливает TutorLayout.tsx из git history + убирает AppFrame route-group)
- [x] Phase 1 (`tutor-dashboard-v2`) shipped — Phase 2a building on top
- [ ] Создан feature-branch `feature/tutor-chrome-sidenav`
- [ ] TASK-1 запущен

---

## Rollback plan

Если после деплоя обнаружится серьёзный regression (навигация не работает, страница не рендерится, iOS Safari полностью сломан):

1. **Быстрый revert (5 минут):** PR revert commita с TASK-1..3 → возвращается `TutorLayout.tsx` + старые страницы wrap в `<TutorLayout>` + старый `App.tsx` route structure.
2. **Частичный rollback** (оставить SideNav, но починить X route): невозможен — это atomic change.
3. **CSS-only rollback** (выключить новый chrome, оставить все остальное): добавить `display: none` на `.t-app__rail` + `.t-mobile-top` через hotfix CSS — контент работает, только chrome отсутствует.

---

## Рекомендации по запуску сессий

Phase 2a — более рискованная чем Phase 1 (13 pages affected). Рекомендую:

| Сессия | Задачи | Почему |
|---|---|---|
| **Сессия 1** | TASK-1 + TASK-2 | Foundation (CSS + components). Обе независимы друг от друга, можно параллельно, но single-session экономит re-read. |
| **Сессия 2** | TASK-3 | **Отдельная сессия** — атомарная миграция 13 pages требует свежего контекста. Плюс pre-flight grep + manual smoke — это много ручной работы. |
| **Сессия 3 (Codex clean)** | REVIEW | Чистая сессия для independent review. |
| **Сессия 4 (через 1–2 дня)** | TASK-4 (P1) | Follow-up после первого iOS feedback. |

**Параллелить TASK-1 и TASK-2 не рекомендую** — TASK-2 использует классы из TASK-1 (если не совпадут namespace-ы, будет ломка).
