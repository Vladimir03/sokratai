import { useQuery } from '@tanstack/react-query';
import {
  getStudentAssignment,
  getStudentTaskImagesSignedUrlsViaBackend,
  getStudentThreadByAssignment,
  listStudentAssignments,
} from '@/lib/studentHomeworkApi';

export function useStudentAssignments() {
  return useQuery({
    queryKey: ['student', 'homework', 'assignments'],
    queryFn: listStudentAssignments,
  });
}

export function useStudentAssignment(id: string) {
  return useQuery({
    queryKey: ['student', 'homework', 'assignment', id],
    queryFn: () => getStudentAssignment(id),
    enabled: Boolean(id),
  });
}

export function useStudentThread(assignmentId: string) {
  return useQuery({
    queryKey: ['student', 'homework', 'thread', assignmentId],
    queryFn: () => getStudentThreadByAssignment(assignmentId),
    enabled: Boolean(assignmentId),
    staleTime: 30_000,
  });
}

export function useStudentTaskImagesSignedUrls(
  assignmentId: string,
  taskId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['student', 'homework', 'guided-task-images', assignmentId, taskId],
    queryFn: () => getStudentTaskImagesSignedUrlsViaBackend(assignmentId, taskId),
    enabled: (options?.enabled ?? true) && Boolean(assignmentId) && Boolean(taskId),
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
  });
}
