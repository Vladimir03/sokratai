import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listTutorHomeworkAssignments,
  createTutorHomeworkAssignment,
  assignTutorHomeworkStudents,
  notifyTutorHomeworkStudents,
  type HomeworkAssignmentsFilter,
  type CreateAssignmentPayload,
} from '@/lib/tutorHomeworkApi';

export function useTutorHomeworkList(filter: HomeworkAssignmentsFilter = 'all') {
  return useQuery({
    queryKey: ['tutor-homework', filter],
    queryFn: () => listTutorHomeworkAssignments(filter),
    staleTime: 30_000,
  });
}

export function useCreateHomework() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTutorHomeworkAssignment,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tutor-homework'] }),
  });
}

export function useAssignStudents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, studentIds }: { assignmentId: string; studentIds: string[] }) =>
      assignTutorHomeworkStudents(assignmentId, studentIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tutor-homework'] }),
  });
}

export function useNotifyStudents() {
  return useMutation({
    mutationFn: ({ assignmentId, messageTemplate }: { assignmentId: string; messageTemplate?: string }) =>
      notifyTutorHomeworkStudents(assignmentId, messageTemplate),
  });
}
