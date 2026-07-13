-- ============================================================================
-- QR-онбординг лидов Егора — события воронки (P2, фича egor-qr-onboarding)
-- ============================================================================
-- Расширяем CHECK-whitelist analytics_events (паттерн 20260712150300):
--   • qr_lead_registered   — новый репетитор зарегистрировался из QR-канала
--     (есть ref/promo в signUp-метаданных). source=<ref>, meta={has_promo,has_ref}.
--   • promo_captured       — промокод действующей акции закреплён на аккаунте
--     (в окне claim). source=<ref>.
--   • community_cta_clicked — клик по community-CTA на /tutor/home (TG/VK).
--     meta={channel}. Дедуп once-per-tutor.
-- PII-free: только id + категории (ref/channel) + булевы флаги, без текста.
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
    'student_chat_ai_ran',
    -- QR-онбординг лидов Егора (2026-07-13)
    'qr_lead_registered',
    'promo_captured',
    'community_cta_clicked'
  ));
