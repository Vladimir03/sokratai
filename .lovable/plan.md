## Add Student/Tutor breakdown to Admin analytics

### What changes

**1. Summary cards** — first two cards ("Всего пользователей", "Новых за период") get sub-labels showing student/tutor split (e.g. "265" with "250 уч. / 15 реп." underneath).

**2. Charts** — "Регистрации" and "DAU → WAU" get multi-line breakdown:

- Rename DAU to WAU (Weekly Active Users) — count unique users with activity in weeks (2026-03-23 etc in monday weeks)
- Both charts show 3 lines: Total, Students, Tutors

### Backend changes

**File: `supabase/functions/admin-analytics/index.ts**`

1. Query `user_roles WHERE role = 'tutor'` to get set of tutor user IDs
2. Add to `summary`:
  - `totalTutors` / `totalStudents` (total users minus tutors)
  - `newTutors` / `newStudents` (new registrations split)
3. Add to chart data:
  - `registrations` → each day gets `{ date, value, students, tutors }`
  - Replace `dau` with `wau` → each day: count unique users with activity in weeks (2026-03-23 etc in monday weeks), split by student/tutor
4. WAU calculation: 

### Frontend changes

**File: `src/components/admin/AdminSummaryCards.tsx**`

- Add optional `sub` field to card config (e.g. "250 уч. / 15 реп.")
- Render sub-label below the main value in smaller muted text
- Props: `SummaryData` gets `totalTutors`, `totalStudents`, `newTutors`, `newStudents`

**File: `src/components/admin/AdminLineChart.tsx**`

- Support optional `students` and `tutors` data keys alongside `value`
- When present, render 3 lines (total=main color, students=blue, tutors=orange) with legend
- Props: add optional `multiLine?: boolean` flag

**File: `src/pages/Admin.tsx**`

- Update `AnalyticsData` interface: summary gets tutor/student counts, `dau` → `wau`, chart data points get `students?`/`tutors?` fields
- Rename DAU chart title to "WAU (активные за неделю)"
- Pass `multiLine` prop to registrations and WAU charts

### Files modified

- `supabase/functions/admin-analytics/index.ts` — tutor set query, summary split, WAU calc, chart split
- `src/components/admin/AdminSummaryCards.tsx` — sub-label rendering
- `src/components/admin/AdminLineChart.tsx` — multi-line support
- `src/pages/Admin.tsx` — updated types and chart config