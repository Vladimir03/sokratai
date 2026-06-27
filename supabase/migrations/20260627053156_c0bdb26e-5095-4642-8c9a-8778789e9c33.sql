ALTER TABLE public.tutors ALTER COLUMN feature_mock_exams_enabled SET DEFAULT true;
UPDATE public.tutors SET feature_mock_exams_enabled = true WHERE feature_mock_exams_enabled IS DISTINCT FROM true;