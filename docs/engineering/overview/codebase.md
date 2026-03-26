# SokratAI Codebase Overview

Last updated: 2026-03-10

## Project Summary

**SokratAI** is an AI-powered educational platform for Russian school students preparing for the Unified State Exam (EGE). The platform serves **two isolated user roles**:

- **Student** -- AI chat tutoring, practice problems, diagnostics, homework, progress tracking
- **Tutor** -- Student management, scheduling, payments, homework creation and AI-graded review

### Technology Stack

| Layer            | Technology                                           |
|------------------|------------------------------------------------------|
| Frontend         | Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui |
| Backend          | Supabase (Auth, PostgreSQL, RPC, Storage, Edge Functions) |
| State Management | TanStack React Query + custom hooks (no Redux/Zustand)  |
| Routing          | React Router v6, all pages lazy-loaded               |
| Package Manager  | **npm**                                              |
| Telegram         | Bot (Edge Function) + Mini App (frontend)            |
| Payments         | YooKassa (via Edge Functions)                        |

### Commands

```bash
npm run dev          # Start dev server (port 8080)
npm run build        # Production build
npm run lint         # ESLint
npm run smoke-check  # Node-based smoke checks (main quality gate)
npm run smoke-test   # Legacy bash-based smoke test
npm run test         # Alias for smoke-check
```

> Run `build` and `smoke-check` **sequentially**, never in parallel (concurrent writes to `dist/` cause `EBUSY` on Windows).
> If lint fails, still run `build` and `smoke-check` and report failures precisely.

---

## Directory Structure

```
src/
├── pages/                     # All pages (lazy-loaded via React.lazy)
│   ├── tutor/                 # Tutor-only pages (10 pages)
│   └── *.tsx                  # Student / public / auth pages (24 pages)
├── components/
│   ├── ui/                    # shadcn/ui base components (MUST stay lightweight)
│   ├── tutor/                 # Tutor-specific components
│   ├── homework/              # Guided homework components (GuidedHomeworkWorkspace, etc.)
│   ├── practice/              # Practice-specific components
│   ├── diagnostic/            # Diagnostic-specific components
│   ├── admin/                 # Admin-specific components
│   ├── sections/              # Landing page sections
│   ├── miniapp/               # Telegram Mini App components
│   ├── AuthGuard.tsx          # Student session guard
│   ├── TutorGuard.tsx         # Tutor role guard (module-level cache, TTL 10 min)
│   ├── Navigation.tsx         # Shared nav bar (shows different menus per role)
│   └── ...
├── hooks/                     # Custom React hooks (15 files)
├── types/                     # Canonical TypeScript types (5 files)
├── lib/                       # Business logic and API helpers (14 files)
├── utils/                     # Utility functions (chatCache, pyodide, haptics, etc.)
├── integrations/supabase/     # Auto-generated Supabase client and types
├── App.tsx                    # Route configuration (all lazy imports)
└── main.tsx                   # React entry point

supabase/
├── functions/                 # Edge Functions (21 functions)
├── migrations/                # PostgreSQL migrations
└── config.toml                # Supabase project config
```

---

## Routing

All pages are lazy-loaded via `React.lazy()` + `<Suspense>` in `App.tsx`.

### Student and Public Routes

| Path | Component | Auth | Description |
|------|-----------|------|-------------|
| `/` | `Index` | No | Landing page |
| `/login` | `Login` | No | Student login |
| `/signup` | `SignUp` | No | Student registration |
| `/forgot-password` | `ForgotPassword` | No | Password recovery |
| `/reset-password` | `ResetPassword` | No | Password reset |
| `/chat` | `Chat` | AuthGuard | AI chat (2000+ lines, complex) |
| `/practice` | `Practice` | AuthGuard | Practice problems |
| `/diagnostic` | `Diagnostic` | AuthGuard | Diagnostic test |
| `/homework` | `StudentHomework` | AuthGuard | Student homework list (tutor-assigned) |
| `/homework/:id` | `StudentHomeworkDetail` | AuthGuard | Assignment detail + guided chat |
| `/progress` | `Progress` | AuthGuard | Progress tracking |
| `/profile` | `Profile` | AuthGuard | User profile |
| `/miniapp` | `MiniApp` | No | Telegram Mini App entry |
| `/miniapp/solution/:id` | `MiniAppSolution` | No | Solution viewer |
| `/admin` | `Admin` | AdminGuard | Admin dashboard |
| `/retention-analysis` | `RetentionAnalysis` | AdminGuard | Retention analytics |
| `/invite/:inviteCode` | `InvitePage` | No | Student invite: email signup/login + Telegram fallback |
| `/book/:bookingLink` | `BookLesson` | No | Public lesson booking |
| `/register-tutor` | `RegisterTutor` | No | Tutor registration |
| `/offer` | `Offer` | No | Legal: public offer |
| `/privacy-policy` | `PrivacyPolicy` | No | Legal: privacy policy |
| `/requisites` | `Requisites` | No | Legal: requisites |
| `*` | `NotFound` | No | 404 page |

### Tutor Routes

All tutor pages are wrapped in `<TutorGuard>` (inside each page or layout). The guard uses a **module-level cache** (`tutorAuthCache`, TTL 10 min) so tab switching is instant.

| Path | Component | Description |
|------|-----------|-------------|
| `/tutor/login` | `TutorLogin` | Tutor login |
| `/tutor/dashboard` | `TutorDashboard` | Overview dashboard |
| `/tutor/students` | `TutorStudents` | Student list + debt indicators |
| `/tutor/students/:tutorStudentId` | `TutorStudentProfile` | Student detail + notes |
| `/tutor/schedule` | `TutorSchedule` | Calendar, slots, lessons, payment settings |
| `/tutor/payments` | `TutorPayments` | Payment history |
| `/tutor/homework` | `TutorHomework` | Homework assignments list |
| `/tutor/homework/templates` | `TutorHomeworkTemplates` | Homework templates library |
| `/tutor/homework/create` | `TutorHomeworkCreate` | Create assignment + tasks + assign students |
| `/tutor/homework/:id` | `TutorHomeworkDetail` | Assignment detail + task images |
| `/tutor/homework/:id/results` | `TutorHomeworkResults` | Per-student results, AI scores, deep link support via `?submission=` |

---

## Key Source Files

### `src/lib/` -- Business Logic

| File | Purpose |
|------|---------|
| `supabaseClient.ts` | Supabase client singleton |
| `tutors.ts` | Tutor business logic: CRUD students, payments, debt aggregation. Re-exports schedule helpers from `tutorSchedule.ts`. |
| `tutorSchedule.ts` | **Source of truth** for all lesson/slot/booking logic. All schedule-related functions live here. |
| `tutorHomeworkApi.ts` | Homework API client, `parseStorageRef()`, `toStorageRef()` helpers for `storage://` convention |
| `studentHomeworkApi.ts` | Student homework API client (assignments, submissions, guided chat) |
| `homeworkTelemetry.ts` | Homework analytics/telemetry helpers |
| `streamChat.ts` | Streaming chat helpers for AI responses |
| `tutorStudentCacheSync.ts` | React Query optimistic cache sync: `applyTutorStudentPatchToCache`, `removeTutorStudentFromCache`, `invalidateTutorStudentDependentQueries` |
| `tutorScheduleGroupActions.ts` | Group lesson actions (cancel, reschedule) |
| `tutorScheduleGroupCreate.ts` | Group lesson creation logic |
| `tutorScheduleGroupPayments.ts` | Group lesson payment logic |
| `paymentAmount.ts` | `calculateLessonPaymentAmount()` -- unified payment calculation used by frontend and edge functions |
| `formatters.ts` | Canonical date/currency/progress formatters (uses `parseISO` from date-fns) |
| `utils.ts` | General utilities (`cn()` for Tailwind class merging, etc.) |

**Important rule**: `tutors.ts` and `tutorSchedule.ts` use **only** `getSession()` (instant, local cache) to get `user.id`. Never use `getUser()` (network request) in these files.

### `src/hooks/` -- React Hooks

| File | Purpose |
|------|---------|
| `useTutor.ts` | **All** tutor data hooks: `useTutorStudents`, `useTutorStudent`, `useTutorPayments`, `useTutorLessons`, etc. |
| `tutorQueryOptions.ts` | Shared React Query config for tutor queries: timeout 10s, 5 retries, staleTime 60s, gcTime 600s, refetchOnWindowFocus |
| `useTutorHomework.ts` | Tutor homework hooks |
| `useTutorAccess.ts` | **Exception**: uses `getUser()` for Navigation role check only. Do not copy this pattern. |
| `useSubscription.ts` | Student subscription state |
| `usePractice.ts` | Student practice hooks |
| `useDiagnostic.ts` | Student diagnostic hooks |
| `useAdminAccess.ts` | Admin access check |
| `use-mobile.tsx` | Device detection: `useIsMobile()`, `useDeviceType()`, `isAndroid()` |
| `useStudentHomework.ts` | Student homework hooks (assignments, submissions, guided chat) |
| `useYandexMetrika.ts` | Yandex Metrika analytics integration |
| `useVoiceInput.ts` | Voice input for chat |
| `useNetworkStatus.ts` | Online/offline detection |
| `useScrollAnimation.tsx` | Scroll-triggered animations |

### `src/types/` -- TypeScript Types

| File | Domain |
|------|--------|
| `tutor.ts` | Tutor, TutorStudent, TutorLesson, TutorPayment, etc. |
| `homework.ts` | Student/Tutor homework types, guided chat types, subjects config |
| `practice.ts` | Practice problem types |
| `diagnostic.ts` | Diagnostic test types |
| `solution.ts` | Solution types + Telegram WebApp types |

### `src/components/tutor/` -- Tutor UI Components

| File | Purpose |
|------|---------|
| `TutorLayout.tsx` | Shared layout with sidebar navigation |
| `TutorDataStatus.tsx` | Soft error recovery status banner (replaces "eternal skeleton") |
| `StudentCard.tsx` | Student list card with debt badge |
| `AddStudentDialog.tsx` | Dialog for adding a student |
| `StudentsToolbar.tsx` | Search/filter toolbar |
| `StudentsStates.tsx` | Empty/loading/error states for student list |
| `GuidedThreadViewer.tsx` | Tutor view of student guided homework thread |

---

## React Query Key Convention (Tutor)

All tutor queries follow the pattern `['tutor', entity, ...params]`:

```
['tutor', 'students']                          -- student list
['tutor', 'student', tutorStudentId]           -- single student detail
['tutor', 'payments']                          -- payment list
['tutor', 'lessons']                           -- lesson list
['tutor', 'homework', 'assignments', filter]   -- homework assignments
```

**Do not break this convention.** The `tutorStudentCacheSync.ts` helpers depend on these exact key shapes to perform optimistic cache updates across list and detail views.

---

## Guards

### `AuthGuard.tsx` -- Student Guard
- Checks Supabase session + onboarding status
- Includes `Navigation` component
- Has `visibilitychange` handler for session recovery after idle
- **Never modify when working on tutor features**

### `TutorGuard.tsx` -- Tutor Guard
- Calls `is_tutor()` RPC with retry logic (up to 4 attempts)
- Module-level cache (`tutorAuthCache`) with 10-minute TTL makes tab switching instant
- Has `visibilitychange` handler for session recovery
- **Never modify when working on student features**
- **Never remove the module-level cache** -- without it, every tab switch triggers a 2-6 second RPC call

---

## Supabase Edge Functions

21 edge functions in `supabase/functions/`.

### CI Auto-Deployed (7)

| Function | Description |
|----------|-------------|
| `telegram-bot` | Telegram bot: homework flow, payment callbacks, practice/diagnostic |
| `chat` | AI chat backend |
| `setup-telegram-webhook` | Telegram webhook registration |
| `telegram-auth` | Telegram auth verification |
| `telegram-login-token` | Telegram login token generation |
| `telegram-broadcast` | Manual Telegram broadcasts |
| `telegram-scheduled-reminder` | Scheduled lesson reminders |

### Manual Deploy (14)

| Function | JWT | Description |
|----------|-----|-------------|
| `homework-api` | verify | Tutor homework CRUD (8 routes) |
| `homework-reminder` | -- | Scheduled homework reminders (uses `homework_tutor_*` tables) |
| `payment-reminder` | -- | Scheduled payment reminders |
| `assign-tutor-role` | -- | Assigns tutor role to user |
| `tutor-manual-add-student` | -- | Tutor adds student manually |
| `tutor-update-student` | -- | Tutor updates student data |
| `notify-booking` | -- | Booking notification |
| `yookassa-create-payment` | verify | Creates YooKassa payment |
| `yookassa-webhook` | no | YooKassa payment webhook |
| `admin-analytics` | -- | Admin analytics data |
| `check-solutions` | -- | Solution checking |
| `get-solution` | -- | Solution retrieval |
| `telegram-scheduled-broadcast` | -- | Scheduled broadcasts |
| `telegram-webapp-recent-solutions` | -- | Mini App recent solutions |

---

## Database Schema (Key Tables)

### Core / Student Tables

| Table | Description |
|-------|-------------|
| `profiles` | User profiles (username, telegram_user_id, etc.) |
| `user_stats` | XP, level, streak tracking |
| `chats` | Chat conversations (types: general, practice, diagnostic) |
| `chat_messages` | Individual messages with images |
| `problems_public` | Public problem catalog (view) |
| `user_solutions` | User problem solutions |
| `answer_attempts` | Problem answer history |
| `solutions` | Telegram Mini App solutions |
| `api_rate_limits` | Rate limiting |
| `telegram_sessions` | Telegram session data |

### Tutor Tables

| Table | Description |
|-------|-------------|
| `tutors` | Tutor profiles (telegram_id, booking_link, etc.) |
| `tutor_students` | Tutor-student relationships (hourly_rate_cents as integer) |
| `tutor_lessons` | Lessons (is_recurring, parent_lesson_id for series) |
| `tutor_weekly_slots` | Weekly availability slots |
| `tutor_availability_exceptions` | Availability exceptions |
| `tutor_calendar_settings` | Calendar settings incl. `payment_details_text` |
| `tutor_payments` | Lesson payments (`lesson_id` unique partial index) |

### Tutor Homework Tables

| Table | Description |
|-------|-------------|
| `homework_tutor_assignments` | Homework assignments (draft/active/archived) |
| `homework_tutor_tasks` | Tasks within assignments (with `task_image_url`) |
| `homework_tutor_submissions` | Student submissions (status: in_progress/submitted/ai_checked/tutor_reviewed) |
| `homework_tutor_submission_items` | Per-task items: student text/photos, AI score/feedback/error_type |
| `homework_tutor_student_assignments` | Assignment-to-student links |
| `homework_tutor_user_bot_state` | Telegram bot state machine (IDLE/HW_SELECTING/HW_SUBMITTING/HW_CONFIRMING/HW_REVIEW) |
| `homework_tutor_threads` | Guided homework chat threads (status: active/completed/abandoned) |
| `homework_tutor_thread_messages` | Messages in guided homework threads (role, message_kind, task_order) |
| `homework_tutor_task_states` | Per-task progress in guided mode (status, attempts, scores) |
| `homework_tutor_templates` | Homework assignment templates library |
| `homework_tutor_materials` | Materials attached to assignments (PDF, images, links) |
| `homework_tutor_reminder_log` | Homework reminder delivery log |

### Storage Buckets

| Bucket | Purpose |
|--------|---------|
| `homework-task-images` | Tutor-uploaded task images |
| `homework-images` | Student-submitted homework photos |
| `homework-submissions` | Student homework submission images (guided mode) |
| `homework-materials` | Tutor-uploaded materials (PDFs, images) |
| `chat-images` | Chat message images (fallback bucket) |

**Storage reference convention**: Always store as `storage://{bucket}/{objectPath}` via `toStorageRef()`. Never store raw Supabase paths. Use `parseStorageRef()` to read them back.

---

## Supabase API Rules

| Method | Behavior | When to Use |
|--------|----------|-------------|
| `getSession()` | Local cache, instant, no network | Hot paths, `src/lib/tutor*.ts` |
| `getUser()` | Network request to Auth server, slow | Fresh server verification only |

**Rule**: All `src/lib/tutor*.ts` files must use **only** `getSession()` for `user.id`.

---

## Build Configuration

### Vite (`vite.config.ts`)

- **Target**: `['es2020', 'safari15', 'chrome90']`
- **Dev server**: port 8080
- **Minifier**: esbuild
- **Chunk warning limit**: 600 KB
- **Path alias**: `@` maps to `src/`

### Manual Chunks

| Chunk | Contents |
|-------|----------|
| `react-vendor` | react, react-dom, react-router-dom |
| `ui-components` | Radix UI dialog, dropdown, slot, toast |
| `supabase` | @supabase/supabase-js |
| `math-rendering` | katex, react-katex, react-markdown |
| `animations` | framer-motion (separate chunk!) |
| `charts` | recharts |

Tutor pages land in their own chunks automatically via lazy loading.

---

## Critical Rules (Summary)

### 1. Student / Tutor Isolation
- Never import tutor modules in student components or vice versa
- Never modify `AuthGuard` when working on tutor features
- Never modify `TutorGuard` when working on student features

### 2. Performance
- No `framer-motion` in `src/components/ui/*` (use CSS transitions instead)
- No heavy dependencies in shared UI components
- All new pages must use `React.lazy()` + `Suspense`

### 3. Safari / iOS Compatibility
- No `new Date("2024-01-15 10:30:00")` -- use `parseISO` from date-fns or ISO format with `T`
- No `100vh` -- use `100dvh` or `-webkit-fill-available`
- Font-size >= 16px on `<input>`, `<textarea>`, `<select>` (prevents Safari iOS auto-zoom)
- No RegExp lookbehind `(?<=...)` for Safari < 16.4
- No `structuredClone()`, `Array.at()`, `Object.hasOwn()` for Safari < 15.4

### 4. Google Calendar
Google Calendar integration is **disabled**. Do not add Calendar UI or edge functions without a separate migration task.

### 5. Package Manager
Always use `npm`. All scripts: `npm run dev`, `npm run build`, `npm run smoke-check`, etc.

---

## Pre-Commit Checklist

```
[ ] npm run build completes without errors
[ ] npm run smoke-check passes
[ ] No new heavy dependencies in src/components/ui/
[ ] All new pages use React.lazy() in App.tsx
[ ] No cross-imports between student and tutor modules
[ ] No Safari-incompatible APIs (see rules above)
[ ] Input font-size >= 16px
[ ] Dates parsed via date-fns, not new Date(string)
```
