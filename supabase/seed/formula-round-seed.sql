-- Formula round test seed
-- Dev-only fixture for Phase 1a manual QA.
-- Password for all created auth users: FormulaRound123!
--
-- Direct round links:
-- Тестировщик 1: /homework/7f4c2e10-0000-4000-8000-000000000101/round/7f4c2e10-0000-4000-8000-000000000201?student=7f4c2e10-0000-4000-8000-000000000301
-- Тестировщик 2: /homework/7f4c2e10-0000-4000-8000-000000000101/round/7f4c2e10-0000-4000-8000-000000000201?student=7f4c2e10-0000-4000-8000-000000000302
-- Тестировщик 3: /homework/7f4c2e10-0000-4000-8000-000000000101/round/7f4c2e10-0000-4000-8000-000000000201?student=7f4c2e10-0000-4000-8000-000000000303
-- Тестировщик 4: /homework/7f4c2e10-0000-4000-8000-000000000101/round/7f4c2e10-0000-4000-8000-000000000201?student=7f4c2e10-0000-4000-8000-000000000304
-- Тестировщик 5: /homework/7f4c2e10-0000-4000-8000-000000000101/round/7f4c2e10-0000-4000-8000-000000000201?student=7f4c2e10-0000-4000-8000-000000000305
--
-- Note: the `?student=` query param is a reproducible tester marker.
-- Access is still enforced by the authenticated student user.

BEGIN;

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '7f4c2e10-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'formula-round+tutor@sokratai.test',
    crypt('FormulaRound123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"test-tutor"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '7f4c2e10-0000-4000-8000-000000000301',
    'authenticated',
    'authenticated',
    'formula-round+student1@sokratai.test',
    crypt('FormulaRound123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"Тестировщик 1"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '7f4c2e10-0000-4000-8000-000000000302',
    'authenticated',
    'authenticated',
    'formula-round+student2@sokratai.test',
    crypt('FormulaRound123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"Тестировщик 2"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '7f4c2e10-0000-4000-8000-000000000303',
    'authenticated',
    'authenticated',
    'formula-round+student3@sokratai.test',
    crypt('FormulaRound123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"Тестировщик 3"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '7f4c2e10-0000-4000-8000-000000000304',
    'authenticated',
    'authenticated',
    'formula-round+student4@sokratai.test',
    crypt('FormulaRound123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"Тестировщик 4"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '7f4c2e10-0000-4000-8000-000000000305',
    'authenticated',
    'authenticated',
    'formula-round+student5@sokratai.test',
    crypt('FormulaRound123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"username":"Тестировщик 5"}'::jsonb,
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, username)
VALUES
  ('7f4c2e10-0000-4000-8000-000000000001', 'test-tutor'),
  ('7f4c2e10-0000-4000-8000-000000000301', 'Тестировщик 1'),
  ('7f4c2e10-0000-4000-8000-000000000302', 'Тестировщик 2'),
  ('7f4c2e10-0000-4000-8000-000000000303', 'Тестировщик 3'),
  ('7f4c2e10-0000-4000-8000-000000000304', 'Тестировщик 4'),
  ('7f4c2e10-0000-4000-8000-000000000305', 'Тестировщик 5')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.homework_tutor_assignments (
  id,
  tutor_id,
  title,
  subject,
  topic,
  status,
  workflow_mode
)
VALUES (
  '7f4c2e10-0000-4000-8000-000000000101',
  '7f4c2e10-0000-4000-8000-000000000001',
  'Formula Round Test - Кинематика',
  'physics',
  'Кинематика',
  'active',
  'classic'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.formula_rounds (
  id,
  assignment_id,
  section,
  formula_count,
  questions_per_round,
  lives
)
VALUES (
  '7f4c2e10-0000-4000-8000-000000000201',
  '7f4c2e10-0000-4000-8000-000000000101',
  'kinematics',
  12,
  10,
  3
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.homework_tutor_student_assignments (
  assignment_id,
  student_id,
  notified,
  delivery_status
)
VALUES
  (
    '7f4c2e10-0000-4000-8000-000000000101',
    '7f4c2e10-0000-4000-8000-000000000301',
    false,
    'pending'
  ),
  (
    '7f4c2e10-0000-4000-8000-000000000101',
    '7f4c2e10-0000-4000-8000-000000000302',
    false,
    'pending'
  ),
  (
    '7f4c2e10-0000-4000-8000-000000000101',
    '7f4c2e10-0000-4000-8000-000000000303',
    false,
    'pending'
  ),
  (
    '7f4c2e10-0000-4000-8000-000000000101',
    '7f4c2e10-0000-4000-8000-000000000304',
    false,
    'pending'
  ),
  (
    '7f4c2e10-0000-4000-8000-000000000101',
    '7f4c2e10-0000-4000-8000-000000000305',
    false,
    'pending'
  )
ON CONFLICT ON CONSTRAINT homework_tutor_student_assignments_assignment_student_unique DO NOTHING;

COMMIT;
