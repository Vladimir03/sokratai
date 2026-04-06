# Task: Tutor Navigation Restructure

## Goal

Restructure tutor top navigation from 6 flat items to 5 primary + "More" dropdown.

## Current State

```
Дашборд | Расписание | Ученики | Домашки | База | Оплаты
```

File: `src/components/tutor/TutorLayout.tsx` lines 15-22

## Target State

### Desktop

```
Главная | Расписание | Ученики | Домашки | Помощник | Ещё ▾
                                                      ├─ База знаний
                                                      └─ Оплаты
```

### Mobile (bottom nav)

```
Главная  Расписание  Домашки  Помощник  Ещё
                                        ├─ Ученики
                                        ├─ База знаний
                                        └─ Оплаты
```

Mobile has max 5 slots. "Ученики" moves into "Ещё" on mobile only.

## Changes

### 1. TutorLayout.tsx — navItems

Replace navItems array:

```ts
// Primary nav items (always visible)
const primaryNavItems = [
  { href: '/tutor/dashboard', label: 'Главная', icon: LayoutDashboard },
  { href: '/tutor/schedule', label: 'Расписание', icon: CalendarDays },
  { href: '/tutor/students', label: 'Ученики', icon: Users },        // desktop only
  { href: '/tutor/homework', label: 'Домашки', icon: BookOpen },
  { href: '/tutor/assistant', label: 'Помощник', icon: Bot },         // NEW
];

// Overflow items (inside "Ещё ▾" dropdown)
const moreNavItems = [
  { href: '/tutor/knowledge', label: 'База знаний', icon: Library },
  { href: '/tutor/payments', label: 'Оплаты', icon: CreditCard },
];

// Mobile overflow (includes "Ученики" since only 4 primary slots on mobile)
const mobileMoreNavItems = [
  { href: '/tutor/students', label: 'Ученики', icon: Users },
  ...moreNavItems,
];
```

### 2. Desktop nav — add DropdownMenu for "Ещё"

After primary items, render:

```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Bot, ChevronDown } from 'lucide-react';

// Inside desktop nav, after primary items loop:
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant={isMoreActive ? 'secondary' : 'ghost'} size="sm" className="gap-1">
      Ещё
      <ChevronDown className="h-3 w-3" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    {moreNavItems.map(item => (
      <DropdownMenuItem key={item.href} asChild>
        <Link to={item.href} className="flex items-center gap-2">
          <item.icon className="h-4 w-4" />
          {item.label}
        </Link>
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

Active state for "Ещё" button:
```ts
const isMoreActive = moreNavItems.some(
  item => location.pathname === item.href || location.pathname.startsWith(item.href + '/')
);
```

### 3. Mobile bottom nav — 5 slots

Mobile renders 5 items: Главная, Расписание, Домашки, Помощник, Ещё.

"Ещё" on mobile opens a `Sheet` (bottom drawer) or `Popover` with: Ученики, База знаний, Оплаты.

Use Sheet (bottom) for mobile — better UX on touch devices:

```tsx
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { MoreHorizontal } from 'lucide-react';

// Mobile nav item for "Ещё":
<Sheet>
  <SheetTrigger asChild>
    <button className="flex flex-col items-center gap-1 px-3 py-2 text-xs text-muted-foreground">
      <MoreHorizontal className="h-5 w-5" />
      Ещё
    </button>
  </SheetTrigger>
  <SheetContent side="bottom" className="h-auto">
    <nav className="grid gap-2 py-4">
      {mobileMoreNavItems.map(item => (
        <Link key={item.href} to={item.href} className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-accent">
          <item.icon className="h-5 w-5" />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  </SheetContent>
</Sheet>
```

### 4. App.tsx — add route

Add route for assistant page (placeholder for now):

```tsx
const TutorAssistant = lazy(() => import("./pages/tutor/TutorAssistant"));

// Inside tutor routes:
<Route path="/tutor/assistant" element={
  <TutorGuard>
    <TutorLayout>
      <TutorAssistant />
    </TutorLayout>
  </TutorGuard>
} />
```

### 5. Create placeholder page

Create `src/pages/tutor/TutorAssistant.tsx`:

```tsx
export default function TutorAssistant() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI-помощник репетитора</h1>
        <p className="text-muted-foreground">
          Помогает быстро готовить задачи, домашки и объяснения
        </p>
      </div>
      <p className="text-muted-foreground">Раздел в разработке</p>
    </div>
  );
}
```

### 6. Warmup chunk

Add to warmup block in TutorLayout.tsx:

```ts
warmup('TutorAssistant', () => import('@/pages/tutor/TutorAssistant'));
```

### 7. Label changes

| Old | New | Notes |
|-----|-----|-------|
| Дашборд | Главная | Rename only, no route change |
| База | База знаний | Full name, moved to dropdown |
| — | Помощник | New page + route |
| — | Ещё ▾ | Dropdown trigger |

## Files to modify

1. `src/components/tutor/TutorLayout.tsx` — navItems, desktop dropdown, mobile sheet
2. `src/App.tsx` — add `/tutor/assistant` route
3. `src/pages/tutor/TutorAssistant.tsx` — create placeholder

## Files NOT to modify

- Student `Navigation.tsx` — separate module
- Any existing tutor page content
- Auth/guard logic

## Testing checklist

- [ ] Desktop: 5 primary items visible, "Ещё" dropdown works
- [ ] Desktop: active state highlights correctly for dropdown items
- [ ] Desktop: active state on "Ещё" button when on База or Оплаты page
- [ ] Mobile: 5 bottom nav items, "Ещё" sheet opens
- [ ] Mobile: "Ученики" accessible from "Ещё" sheet
- [ ] `/tutor/assistant` route loads placeholder page
- [ ] HW badge still shows on "Домашки"
- [ ] All existing routes still work
- [ ] Responsive transition (md breakpoint) works
- [ ] Sheet closes after navigating to a page on mobile
