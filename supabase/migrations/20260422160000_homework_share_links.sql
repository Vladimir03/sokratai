-- Homework Reuse v1 — TASK-1 part 1/2: public share links table.
--
-- Назначение: публичные read-only ссылки вида /p/:slug на домашку.
-- Несколько ссылок на одно ДЗ допустимы (родителю без ответов, коллеге
-- с ответами, пропустившему ученику с истечением 30 дней — разные записи).
-- slug — short base36 8 chars, unique (PRIMARY KEY), generation
-- happens в edge function POST /assignments/:id/share-links (TASK-7).
--
-- Публичное чтение через edge function `public-homework-share` (TASK-4)
-- под service_role без JWT-check. RLS policy ниже нужна ТОЛЬКО для
-- защиты authenticated PostgREST-доступа — репетитор не должен видеть
-- чужие share_links через select.
--
-- Spec: docs/delivery/features/homework-reuse-v1/spec.md §5 / AC-6..AC-9

create table if not exists public.homework_share_links (
  slug           text primary key,
  assignment_id  uuid not null references public.homework_tutor_assignments(id) on delete cascade,
  show_answers   boolean not null default false,
  show_solutions boolean not null default false,
  expires_at     timestamptz null,
  created_by     uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now()
);

create index if not exists idx_homework_share_links_assignment
  on public.homework_share_links(assignment_id);

create index if not exists idx_homework_share_links_created_by
  on public.homework_share_links(created_by);

alter table public.homework_share_links enable row level security;

drop policy if exists "Tutors manage own share links"
  on public.homework_share_links;

create policy "Tutors manage own share links"
  on public.homework_share_links
  for all
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

grant select, insert, update, delete on public.homework_share_links to authenticated;

comment on table public.homework_share_links is
  'Публичные read-only ссылки /p/:slug на homework_tutor_assignments. Несколько ссылок на одно ДЗ допустимы (разные флаги show_answers / show_solutions / expires_at). Публичное чтение — через edge function под service_role, RLS защищает только PostgREST authenticated access.';

comment on column public.homework_share_links.slug is
  'base36 8 chars, генерируется в edge function (crypto.randomUUID slice). PRIMARY KEY — collision retry на backend.';

comment on column public.homework_share_links.show_answers is
  'Если true — public endpoint возвращает correct_answer по задачам. Default false (safe default per AC-9).';

comment on column public.homework_share_links.show_solutions is
  'Если true — public endpoint возвращает solution_text и solution_image_urls. Default false. rubric_* НИКОГДА не отдаётся через public endpoint независимо от флага.';

comment on column public.homework_share_links.expires_at is
  'NULL = ссылка не истекает. Если < now() — edge function возвращает { expired: true } без содержимого.';
