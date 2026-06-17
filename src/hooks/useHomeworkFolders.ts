// React Query хуки для папок ДЗ (homework_folders). Запрос Елены (2026-06-17).
// Зеркало `src/hooks/useFolders.ts` (KB), ключи под `['tutor','homework','folders']`.
//
// Перемещение задания в папку идёт через edge `updateTutorHomeworkAssignment`
// (там валидация владения папкой) — не прямой PostgREST на assignments.

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTutorRetry,
  toTutorErrorMessage,
  TUTOR_GC_TIME_MS,
  TUTOR_STALE_TIME_MS,
  tutorRetryDelay,
  withTutorTimeout,
} from '@/hooks/tutorQueryOptions';
import {
  listHomeworkFolders,
  createHomeworkFolder,
  renameHomeworkFolder,
  deleteHomeworkFolder,
  type HomeworkFolder,
} from '@/lib/tutorHomeworkFoldersApi';
import { updateTutorHomeworkAssignment } from '@/lib/tutorHomeworkApi';

const FOLDERS_KEY = ['tutor', 'homework', 'folders'] as const;
const ASSIGNMENTS_KEY = ['tutor', 'homework', 'assignments'] as const;

/** Список папок ДЗ репетитора (плоский). */
export function useHomeworkFolders() {
  const queryKey = useMemo(() => FOLDERS_KEY, []);

  const query = useQuery<HomeworkFolder[], unknown>({
    queryKey,
    queryFn: () => withTutorTimeout(queryKey, listHomeworkFolders()),
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    // false: папки низкочастотны, инвалидируются мутациями. Также защищает
    // TutorHomeworkCreate от focus-refetch гонок (rule 40 constructor invariant).
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  return {
    folders: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? toTutorErrorMessage('Не удалось загрузить папки', query.error) : null,
    refetch: () => { void query.refetch(); },
    isFetching: query.isFetching,
  };
}

/**
 * Инвалидация после любой мутации папок/перемещения: и список папок (имена),
 * и список ДЗ (счётчики/деление по папкам считаются клиентом из assignments).
 */
function invalidateFolders(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: FOLDERS_KEY });
  void queryClient.invalidateQueries({ queryKey: ASSIGNMENTS_KEY });
}

export function useCreateHomeworkFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createHomeworkFolder(name),
    onSuccess: (folder) => {
      // Seed кэша созданной папкой ДО refetch (code review P2): навигация на
      // /tutor/homework/folder/:id сразу находит папку, без флэша «папка не найдена».
      queryClient.setQueryData<HomeworkFolder[]>(FOLDERS_KEY, (old) =>
        old ? (old.some((f) => f.id === folder.id) ? old : [...old, folder]) : [folder],
      );
      invalidateFolders(queryClient);
    },
  });
}

export function useRenameHomeworkFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { folderId: string; name: string }) =>
      renameHomeworkFolder(params.folderId, params.name),
    onSuccess: () => invalidateFolders(queryClient),
  });
}

/** Удаление папки. Задания внутри становятся «Без папки» (FK SET NULL), НЕ удаляются. */
export function useDeleteHomeworkFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => deleteHomeworkFolder(folderId),
    onSuccess: () => invalidateFolders(queryClient),
  });
}

/** Переместить ДЗ в папку (folderId = null → «Без папки»). Через edge с валидацией владения. */
export function useMoveAssignmentToFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { assignmentId: string; folderId: string | null }) =>
      updateTutorHomeworkAssignment(params.assignmentId, { folder_id: params.folderId }),
    onSuccess: () => invalidateFolders(queryClient),
  });
}
