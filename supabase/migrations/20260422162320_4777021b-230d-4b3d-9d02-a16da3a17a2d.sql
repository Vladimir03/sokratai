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

alter table public.homework_tutor_assignments
  add column if not exists source_group_id uuid null
    references public.tutor_groups(id) on delete set null;

create index if not exists idx_homework_assignments_source_group
  on public.homework_tutor_assignments(source_group_id)
  where source_group_id is not null;

comment on column public.homework_tutor_assignments.source_group_id is
  'Soft FK к tutor_groups. Записывается на backend (handleCreateAssignment / handleUpdateAssignment) только если ДЗ создано через assign-to-group ровно одной группой без ручных правок списка учеников. NULL допустим. Используется для badge/filter на /tutor/homework, НЕ для ACL. ON DELETE SET NULL — удаление группы не каскадирует на ДЗ.';