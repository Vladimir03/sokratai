-- ============================================================================
-- Предметная персонализация (Ф1/Ф2, 2026-07-23) — события гейт-диалога предметов
-- ============================================================================
alter table public.analytics_events
  drop constraint if exists analytics_events_event_name_check;

alter table public.analytics_events
  add constraint analytics_events_event_name_check check (event_name in (
    'tutor_first_student_added',
    'invite_generated',
    'tutor_first_homework_created',
    'homework_sent_to_student',
    'student_received_and_opened',
    'invite_claimed',
    'student_first_login',
    'student_registered',
    'student_first_homework_opened',
    'student_first_submission',
    'tutor_payment_created',
    'tutor_payment_succeeded',
    'tutor_demo_check_viewed',
    'tutor_demo_check_ran',
    'chat_first_message_sent',
    'tutor_chat_ai_ran',
    'student_chat_ai_ran',
    'qr_lead_registered',
    'promo_captured',
    'community_cta_clicked',
    'client_error',
    'referral_attributed',
    'referral_code_copied',
    'subjects_gate_shown',
    'subjects_gate_postponed',
    'subjects_gate_saved',
    'subject_default_overridden'
  ));

-- ============================================================================
-- Предметный снапшот AI-диалога ученика (Ф5, 2026-07-23)
-- ============================================================================
alter table public.chats add column if not exists subject text null;

comment on column public.chats.subject is
  'Канонический id предмета (src/types/homework.ts::SUBJECTS) — снапшот при '
  'создании диалога (subject-personalization Ф5). NULL = чат без предметного '
  'контекста. Сервер (chat/index.ts) валидирует значение на чтении.';

-- ============================================================================
-- Предметная персонализация Фаза 3 (Ф3 + Ф7, 2026-07-23)
-- ============================================================================
alter table public.tutors
  add column if not exists exam_focus_by_subject jsonb not null default '{}'::jsonb;

comment on column public.tutors.exam_focus_by_subject is
  'Экзамен-фокус ПО ПРЕДМЕТАМ: {"physics":["ege","oge"]}, значения '
  'ege|oge|school|olympiad (subject-personalization Ф3). Prefill-дефолты, '
  'не runtime-истина.';

alter table public.profiles
  add column if not exists subjects text[] null;

comment on column public.profiles.subjects is
  'Предметы ученика (канонические id SUBJECTS) — для свободного AI-чата и '
  'самостоятельной практики (subject-personalization Ф7). В grading-контекст '
  'ДЗ/пробников НЕ попадает (предмет там — из назначения). NULL = не заполнял; '
  'backfill из difficult_subject ниже.';

update public.profiles
set subjects = array[difficult_subject]
where subjects is null
  and difficult_subject is not null
  and length(trim(difficult_subject)) > 0;

-- ============================================================================
-- Нормализация legacy-id в profiles.subjects (2026-07-23)
-- ============================================================================
with mapped as (
  select
    p.id,
    (
      select array_agg(m.new_id order by m.first_ord)
      from (
        select x.new_id, min(x.ord) as first_ord
        from (
          select
            case u.s
              when 'math' then 'maths'
              when 'algebra' then 'maths'
              when 'geometry' then 'maths'
              when 'rus' then 'russian'
              when 'cs' then 'informatics'
              else u.s
            end as new_id,
            u.ord
          from unnest(p.subjects) with ordinality as u(s, ord)
        ) x
        group by x.new_id
      ) m
    ) as new_subjects
  from public.profiles p
  where p.subjects && array['math', 'algebra', 'geometry', 'rus', 'cs']
)
update public.profiles p
set subjects = mapped.new_subjects
from mapped
where p.id = mapped.id;