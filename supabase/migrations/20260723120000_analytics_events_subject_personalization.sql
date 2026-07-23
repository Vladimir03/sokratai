-- ============================================================================
-- Предметная персонализация (Ф1/Ф2, 2026-07-23) — события гейт-диалога предметов
-- ============================================================================
-- Измеримость персонализации (spec: docs/delivery/features/subject-personalization):
--   subjects_gate_shown      — гейт-диалог «Какие предметы вы ведёте?» показан
--                              (meta: {surface}, source = surface)
--   subjects_gate_postponed  — репетитор нажал «Позже» (meta: {surface})
--   subjects_gate_saved      — предметы сохранены из гейта (meta: {surface, count};
--                              дедуп once-per-tutor — гаснет данными, честно 1 раз)
--   subject_default_overridden — репетитор сменил предвыбранный дефолт предмета
--                              (meta: {surface, from, to} — канонические id,
--                              PII-free категории; меряем качество дефолтов)
-- Writer — tutor-progress-api POST /track (whitelist имён + meta на edge).
-- Доля заполненных профилей — НЕ событие: считается из tutors.subjects в Пульсе
-- (независимый счётчик «Профиль: предметы», решение владельца 2026-07-23).
--
-- ВНИМАНИЕ: полный whitelist скопирован из ПОСЛЕДНЕЙ constraint-миграции
-- (20260716120000_tutor_referral_program.sql, 23 события) — устаревшая копия
-- молча убила бы существующих писателей (ошибки глотаются by design).
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
    'community_cta_clicked',
    -- клиентские краши (2026-07-15)
    'client_error',
    -- рефералка v1 (2026-07-16)
    'referral_attributed',
    'referral_code_copied',
    -- предметная персонализация (2026-07-23)
    'subjects_gate_shown',
    'subjects_gate_postponed',
    'subjects_gate_saved',
    'subject_default_overridden'
  ));
