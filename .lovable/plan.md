## Update TutorPayments Page

The current code doesn't match the requirements from commit `4294d08`. Here are the 5 changes needed:

### 1. Summary cards must reflect filtered data (not all payments)

**Current**: `stats` computed from `payments` (unfiltered, line 159).
**Fix**: Compute stats from `filteredPayments` instead.

### 2. Replace "Поиск по имени" with date range filter "Дата занятия (с/по)"

**Current**: Text input `searchQuery` for name search (lines 106, 314-319).
**Fix**: Remove `searchQuery` state. Add `dateFrom` and `dateTo` state variables (date inputs). Filter payments by `due_date` (or lesson date field) falling within the range.

### 3. Column "Срок" → "Дата занятия"

**Current**: Table header says "Срок" (line 332), cell shows `payment.due_date` (line 368).
**Fix**: Rename header to "Дата занятия". The cell value stays the same (`due_date`).

### 4. Add dialog: "Срок оплаты (опц.)" → "Дата занятия (опц.)"

**Current**: Label says "Срок оплаты (опц.)" (line 557).
**Fix**: Change label text to "Дата занятия (опц.)".

### 5. Remove "Просрочено" status entirely

**Current**: Third summary card shows "Просрочено" (lines 273-283). Status filter has "Просрочено" option (line 296). `getEffectiveStatus` returns `'overdue'` (lines 53-59). `getStatusBadge` renders red "Просрочено" badge (line 66). Stats track `overdueAmount`/`overdueCount`. Также замени "Просрочено" на вкладке "Дашборд" на "получено" с вкладки "Оплаты"

**Fix**:

- Remove the third "Просрочено" summary card entirely → 2 cards only (or repurpose as "Всего неоплачено" combining pending).
- Remove `overdue` from `getEffectiveStatus` — everything unpaid is just `pending`.
- Remove `overdue` from `StatusFilter` select options.
- Remove `overdue` from `getStatusBadge`.
- Remove `overdueAmount`/`overdueCount` from `PaymentStats`.
- Change grid from `md:grid-cols-3` to `md:grid-cols-2`.

### Files changed


| File                                | Change              |
| ----------------------------------- | ------------------- |
| `src/pages/tutor/TutorPayments.tsx` | All 5 changes above |


### Technical details

- `searchQuery` state + its Input removed; replaced with `dateFrom`/`dateTo` states (string, date input type)
- Filtering logic: if `dateFrom` set, `payment.due_date >= dateFrom`; if `dateTo` set, `payment.due_date <= dateTo`
- Stats computation changes source from `payments` → `filteredPayments`
- `StatusFilter` type becomes `'all' | 'pending' | 'paid'`
- `getEffectiveStatus` simplified: returns `'paid'` or `'pending'` only
- The reminder dialog text also updated: "Срок" → "Дата занятия" in the template (line 597)