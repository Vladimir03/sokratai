-- ============================================================================
-- Предметная персонализация Фаза 3 (Ф3 + Ф7, 2026-07-23)
-- Spec: docs/delivery/features/subject-personalization/spec.md
-- ============================================================================

-- Ф3: экзамен-фокус репетитора — ПЕР-ПРЕДМЕТНАЯ JSONB-карта (ревью A2 спеки:
-- общий массив не говорил, какой фокус к какому предмету — «физика ЕГЭ+ОГЭ,
-- французский для школы»). Формат: {"physics":["ege","oge"],"french":["school"]},
-- значения ege|oge|school|olympiad. Запросов ПО фокусу нет → JSONB, отдельная
-- таблица tutor_subject_preferences не нужна в v1. Потребители — prefill-only
-- (resolveTutorDefaultExam): витрина Базы, каскад загрузчика, exam_type
-- конструктора ДЗ, редактор вариантов. Валидация значений — клиентом на записи
-- (useUpsertTutorProfile) и читателями на чтении; CHECK на JSONB-shape не
-- вводим (additive-минимум).
alter table public.tutors
  add column if not exists exam_focus_by_subject jsonb not null default '{}'::jsonb;

comment on column public.tutors.exam_focus_by_subject is
  'Экзамен-фокус ПО ПРЕДМЕТАМ: {"physics":["ege","oge"]}, значения '
  'ege|oge|school|olympiad (subject-personalization Ф3). Prefill-дефолты, '
  'не runtime-истина.';

-- Ф7: предметы УЧЕНИКА — массив (решение владельца 2026-07-23: мультипредметы
-- для самостоятельного AI-чата/практики). ИНВАРИАНТ (условие владельца):
-- в guided ДЗ и пробниках AI ВСЕГДА берёт предмет назначения/варианта
-- (server-side wins) — profiles.subjects НИКОГДА не попадает в grading-контекст,
-- только свободный чат/практика. difficult_subject (онбординг, один предмет)
-- ЖИВЁТ: OnboardingModal пишет оба (compat), читатели предпочитают массив.
alter table public.profiles
  add column if not exists subjects text[] null;

comment on column public.profiles.subjects is
  'Предметы ученика (канонические id SUBJECTS) — для свободного AI-чата и '
  'самостоятельной практики (subject-personalization Ф7). В grading-контекст '
  'ДЗ/пробников НЕ попадает (предмет там — из назначения). NULL = не заполнял; '
  'backfill из difficult_subject ниже.';

-- Backfill: единственный difficult_subject → массив (идемпотентно: только NULL).
update public.profiles
set subjects = array[difficult_subject]
where subjects is null
  and difficult_subject is not null
  and length(trim(difficult_subject)) > 0;
