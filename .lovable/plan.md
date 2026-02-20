

## Deploy: WOW Payment Hardening + E2E Test Plan

### 1. Apply Migration `20260220143000_wow_payment_hardening.sql`

The migration file already exists at `supabase/migrations/20260220143000_wow_payment_hardening.sql`. It adds:
- `lesson_id` column on `tutor_payments` with unique partial index (idempotent upsert)
- `payment_details_text` column on `tutor_calendar_settings`
- `complete_lesson_and_create_payment()` RPC -- idempotent lesson completion + payment creation
- `get_tutor_students_debt()` RPC -- aggregates pending/overdue/debt per student

I will apply this migration using the database migration tool (SQL from the file).

### 2. Deploy Edge Functions

Deploy two functions:
- **payment-reminder** -- sends Telegram reminders for completed unpaid lessons
- **telegram-bot** -- handles payment callbacks including "Double WOW" parent reminder flow

### 3. E2E Test Scenario (Manual)

After deployment, the following scenario should be verified:

```text
Step 1: REMINDER
  - A completed lesson with payment_status='unpaid' and payment_reminder_sent=false
    triggers a Telegram message to the tutor with 3 buttons:
    [Проведено, жду оплату] [Уже оплачено] [Урок отменен]

Step 2: PENDING / PAID
  - Click "Проведено, жду оплату" (pending):
    -> tutor_lessons.payment_status = 'pending', status = 'completed'
    -> tutor_payments row created with status='pending'
    -> Original message edited to show confirmation
  - Or click "Уже оплачено" (paid):
    -> tutor_lessons.payment_status = 'paid', paid_at set
    -> tutor_payments row created with status='paid'

Step 3: DOUBLE WOW (yes/no)
  - After pending or paid, bot asks "Double WOW -- send payment reminder to parent?"
  - "Yes": sends parent_contact a message with payment details text from tutor settings
  - "No": confirms "OK, not sending"

Step 4: DEBT IN UI
  - TutorStudents page: StudentCard shows debt_amount badge
  - TutorStudentProfile page: shows studentDebt value
  - Both pull data from get_tutor_students_debt() RPC
```

Verification queries to run after test:
```sql
-- Check payment was created for the lesson
SELECT id, lesson_id, amount, status, paid_at
FROM tutor_payments WHERE lesson_id = '<test_lesson_id>';

-- Check debt aggregation
SELECT * FROM get_tutor_students_debt();

-- Check lesson status updated
SELECT id, status, payment_status, payment_amount, paid_at, payment_reminder_sent
FROM tutor_lessons WHERE id = '<test_lesson_id>';
```

### Technical Details

- The `get_lessons_needing_payment_reminder()` DB function already returns `hourly_rate_cents` (updated in a prior migration) -- no changes needed
- The `complete_lesson_and_create_payment()` RPC uses `ON CONFLICT (lesson_id)` for idempotency, so double-clicking buttons won't create duplicate payments
- The `get_tutor_students_debt()` RPC is already consumed by `src/lib/tutors.ts` and displayed in `StudentCard` and `TutorStudentProfile`
- No code changes needed -- only migration application and function deployment

