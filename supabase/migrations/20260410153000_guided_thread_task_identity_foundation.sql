alter table public.homework_tutor_threads
  add column if not exists current_task_id uuid null references public.homework_tutor_tasks(id) on delete set null;

alter table public.homework_tutor_thread_messages
  add column if not exists task_id uuid null references public.homework_tutor_tasks(id) on delete set null;

create index if not exists idx_homework_tutor_threads_current_task_id
  on public.homework_tutor_threads (current_task_id);

create index if not exists idx_homework_tutor_thread_messages_thread_task
  on public.homework_tutor_thread_messages (thread_id, task_id, created_at);

update public.homework_tutor_threads as ht
set current_task_id = task_match.id
from public.homework_tutor_student_assignments as htsa
join public.homework_tutor_tasks as task_match
  on task_match.assignment_id = htsa.assignment_id
 and task_match.order_num = ht.current_task_order
where htsa.id = ht.student_assignment_id
  and (ht.current_task_id is null or ht.current_task_id <> task_match.id);

update public.homework_tutor_thread_messages as htm
set task_id = task_match.id
from public.homework_tutor_threads as ht
join public.homework_tutor_student_assignments as htsa
  on htsa.id = ht.student_assignment_id
join public.homework_tutor_tasks as task_match
  on task_match.assignment_id = htsa.assignment_id
 and task_match.order_num = htm.task_order
where htm.thread_id = ht.id
  and htm.task_order is not null
  and htm.task_id is null;
