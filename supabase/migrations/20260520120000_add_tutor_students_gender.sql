-- Phase 8 (2026-05-20) — Tutor-curated student gender для AI grammar.
--
-- Context:
--   Репетитор по французскому пожаловался что после Phase 1-2-7 рефакторинга
--   обращения к ученикам в AI prompt снова теряют **гендер-aware** склонения
--   («ты подставила» vs «ты подставил»). Причина — AI guesses gender по имени,
--   что fails для:
--     - иностранных имён (Anastasiia, Marie)
--     - latin spelling русских имён в profiles.full_name
--     - гендер-нейтральных имён (Саша, Женя)
--
-- Решение (UX choice Vladimir 2026-05-20):
--   Tutor-set field «Пол ученика» в TutorStudentProfile UI (рядом с display_name).
--   Сохраняем рядом с display_name — оба поля curated репетитором при добавлении
--   ученика, оба используются для AI prompt context.
--
--   Fallback chain (mirror display_name pattern):
--     tutor_students.gender (tutor-curated, primary) →
--     profiles.gender (student selected on signup, secondary) →
--     null (AI guesses from name — current behavior fallback)
--
-- Enum semantics:
--   - 'male' / 'female' — explicit. AI инжектируется явная инструкция про
--     conjugation («ты подставил» / «ты подставила»).
--   - NULL — «не указано» (default). AI использует gender-neutral формы
--     («ты справился/справилась», «ты молодец») или guess by name.
--
-- Backward compat: existing rows получают NULL — поведение idential pre-Phase-8
-- (AI guesses from name).

BEGIN;

ALTER TABLE public.tutor_students
  ADD COLUMN IF NOT EXISTS gender TEXT NULL
    CHECK (gender IS NULL OR gender IN ('male', 'female'));

COMMENT ON COLUMN public.tutor_students.gender IS
  'Tutor-curated student gender для AI grammar conjugation. Values: male / female / null. '
  'Используется в guided_ai.ts::buildStudentNameGuidance и chat/index.ts для явной '
  'gender-aware conjugation вместо AI guess by name. NULL → AI использует neutral формы '
  'или guesses from name. Fallback chain: tutor_students.gender → profiles.gender → null.';

COMMIT;
