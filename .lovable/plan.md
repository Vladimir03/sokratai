

## Fix: "Развёрнутое решение" warning hidden when condition is collapsed

### Problem
The amber banner "📝 Задача с развёрнутым решением — покажи ход решения" is placed **inside** the collapsible condition block (line 1407). When the student navigates to task 2 and the condition is collapsed (default on mobile), the warning is invisible.

### Solution
Move the `detailed_solution` banner **outside** the collapsible `div`, so it's always visible in the header area regardless of expand/collapse state. Place it right after the collapsible block closes (after line ~1422), still inside the `border-b` container.

### File: `src/components/homework/GuidedHomeworkWorkspace.tsx`

1. **Remove** the amber banner from inside the collapsible block (lines 1407-1411)
2. **Add** it after the collapsible `</div>` closes (~line 1422), before the parent `</div>` of the `border-b` container — so it's always visible when `check_format === 'detailed_solution'`

```text
┌─────────────────────────────────────┐
│ Задача 2 из 3  1/1 баллов  Раскрыть │  ← header (always visible)
├─────────────────────────────────────┤
│ 📝 Развёрнутое решение — покажи ход │  ← NEW: always visible
├─────────────────────────────────────┤
│ (collapsible: task text + image)    │  ← expands on click
└─────────────────────────────────────┘
```

Single file change, ~6 lines moved.

