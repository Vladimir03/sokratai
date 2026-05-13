UPDATE public.homework_tutor_tasks
   SET task_kind = 'numeric'
 WHERE check_format = 'short_answer'
   AND task_kind <> 'numeric';

UPDATE public.homework_tutor_tasks
   SET task_kind = 'extended'
 WHERE check_format = 'detailed_solution'
   AND task_kind <> 'extended';