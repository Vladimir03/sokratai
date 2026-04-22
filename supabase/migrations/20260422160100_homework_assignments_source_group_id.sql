-- Homework Reuse v1 — TASK-1 part 2/2: source_group_id on assignments.
--
-- Назначение: мета-поле "ДЗ создано через assign-to-group". Пишется на
-- backend (TASK-8: handleCreateAssignment / handleUpdateAssignment)
-- ТОЛЬКО если репетитор выбрал ровно одну группу в HWAssignSection и
-- итоговый список учеников не был модифицирован вручную. В остальных
-- случаях — NULL.
--
-- Поле — soft FK (ON DELETE SET NULL): удаление группы не должно
-- каскадно удалять ДЗ. Badge в HWSummaryCard (TASK-9) gracefully
-- деградирует до "без группы" через LEFT JOIN на tutor_groups.
--
-- НЕ используется как ACL — assignment-student linkage остаётся через
-- homework_tutor_student_assignments. source_group_id — только метаданные.
--
-- Spec: docs/delivery/features/homework-reuse-v1/spec.md §5 / AC-20, AC-21

alter table public.homework_tutor_assignments
  add column if not exists source_group_id uuid null
    references public.tutor_groups(id) on delete set null;

create index if not exists idx_homework_assignments_source_group
  on public.homework_tutor_assignments(source_group_id)
  where source_group_id is not null;

comment on column public.homework_tutor_assignments.source_group_id is
  'Soft FK к tutor_groups. Записывается на backend (handleCreateAssignment / handleUpdateAssignment) только если ДЗ создано через assign-to-group ровно одной группой без ручных правок списка учеников. NULL допустим. Используется для badge/filter на /tutor/homework, НЕ для ACL. ON DELETE SET NULL — удаление группы не каскадирует на ДЗ.';
