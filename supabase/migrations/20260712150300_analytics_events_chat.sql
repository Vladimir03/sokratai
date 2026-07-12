-- ============================================================================
-- Чат репетитор ↔ ученик — события воронки + cap @СократAI (M4)
-- ============================================================================
-- Расширяем CHECK-whitelist analytics_events (паттерн 20260708130000):
--   • chat_first_message_sent — в беседе появилось первое сообщение (воронка
--     привычки: сколько пар реально начали общаться в Сократе)
--   • tutor_chat_ai_ran / student_chat_ai_ran — вызов @СократAI; COUNT
--     tutor_chat_ai_ran за сутки = дневной cap репетитора (rule 99, зеркало
--     tutor_demo_check_ran)
-- PII-free: только id + счётчики, без текста сообщений.
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
    'tutor_demo_check_ran',
    -- чат репетитор↔ученик (2026-07-12)
    'chat_first_message_sent',
    'tutor_chat_ai_ran',
    'student_chat_ai_ran'
  ));
