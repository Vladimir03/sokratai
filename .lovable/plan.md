

## Plan: Add Homework Conversations to Admin Panel

### Overview
Add a new "ДЗ" (Homework) tab to the admin CRM section showing guided homework chat threads between students and AI, with the ability to view full conversation transcripts per student per assignment.

### Step 1: Database — Add admin RLS policies for homework tables

Create a migration adding SELECT policies for admins on these tables:
- `homework_tutor_threads` — so admin can list all threads
- `homework_tutor_thread_messages` — so admin can read all messages (including `visible_to_student = false`)
- `homework_tutor_task_states` — so admin can see task progress
- `homework_tutor_assignments` — so admin can see assignment titles/subjects
- `homework_tutor_student_assignments` — so admin can join threads to students
- `homework_tutor_submissions` — so admin can see submission status

All policies use `has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid())` pattern matching existing admin policies.

### Step 2: Create `AdminHomeworkChats` component

New component `src/components/admin/AdminHomeworkChats.tsx`:

**List view:**
- Fetches all `homework_tutor_threads` joined with `homework_tutor_student_assignments` → `profiles` and `homework_tutor_assignments`
- Shows: student name, assignment title, subject, thread status, message count, last activity
- Search by student name
- Filter tabs: All / Active / Completed
- Sorted by last activity (using `updated_at`)

**Detail view (on click):**
- Shows all `homework_tutor_thread_messages` for the selected thread, ordered by `created_at`
- Displays task states progress bar
- Message bubbles similar to existing `AdminChatView` — user messages on right, assistant/system/tutor on left
- Shows `message_kind` as small badges (hint_request, check_result, etc.)
- Image support via signed URLs from `homework-images` bucket

### Step 3: Add "ДЗ" tab to Admin page

In `src/pages/Admin.tsx`, add a fourth tab next to "Аналитика", "CRM", "Платежи":
- Tab label: "ДЗ" with `BookOpen` icon
- Content: `<AdminHomeworkChats />`

### Technical details
- Reuses existing `supabaseClient` and admin auth pattern
- No new edge functions needed — direct Supabase queries with RLS
- Message rendering reuses `MathText` component for LaTeX support
- Profile lookup via join to `profiles` table (already has admin SELECT policy)

