import { useQuery } from '@tanstack/react-query';
import {
  getStudentAssignment,
  getStudentSubmissions,
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

export function useStudentSubmissions(assignmentId: string) {
  return useQuery({
    queryKey: ['student', 'homework', 'submissions', assignmentId],
    queryFn: () => getStudentSubmissions(assignmentId),
    enabled: Boolean(assignmentId),
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
