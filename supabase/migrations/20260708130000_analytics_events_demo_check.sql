-- ============================================================================
-- Активация репетитора v2.1 — демо-события воронки (сдвиг aha влево)
-- ============================================================================
-- Расширяем CHECK-whitelist analytics_events (миграции 20260701115000 +
-- 20260702130000) двумя событиями демо-разбора «как Сократ проверяет»:
--   • tutor_demo_check_viewed — репетитор открыл готовый пример разбора (W1-A)
--   • tutor_demo_check_ran    — прогнал разбор своей задачи вживую (W1-B)
-- Плоский text, тот же паттерн DROP+ADD constraint. PII-free (id/счётчики).
-- ============================================================================

alter table public.analytics_events
  drop constraint if exists analytics_events_event_name_check;

alter table public.analytics_events
  add constraint analytics_events_event_name_check check (event_name in (
    -- репетитор (онбординг v2)
    'tutor_first_student_added',
    'invite_generated',
    'tutor_first_homework_created',
    'homework_sent_to_student',
    'student_received_and_opened',
    -- ученик (онбординг v2)
    'invite_claimed',
    'student_first_login',
    'student_registered',
    'student_first_homework_opened',
    'student_first_submission',
    -- воронка оплаты тарифа репетитора (round 3, 2026-07-02)
    'tutor_payment_created',
    'tutor_payment_succeeded',
    -- демо-разбор (v2.1 W1, 2026-07-08)
    'tutor_demo_check_viewed',
    'tutor_demo_check_ran'
  ));
