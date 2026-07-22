/**
 * Мутации модератора каталога — таксономия (темы/подтемы) + публикация папки.
 * Все инвалидируют префикс ['tutor','kb'] (темы, подтемы, счётчики, папки).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createCatalogSource,
  createCatalogSubtopic,
  createCatalogTopic,
  deleteCatalogSource,
  deleteCatalogSubtopic,
  deleteCatalogTopic,
  deleteSectionToMyBase,
  deleteTopicToMyBase,
  moveTaskToMyBase,
  publishFolderToCatalog,
  updateCatalogSource,
  updateCatalogSubtopic,
  updateCatalogTopic,
  type CreateTopicInput,
  type PublishFolderResult,
  type UpdateTopicInput,
} from '@/lib/kbModeratorApi';
import type { CatalogFilter } from '@/types/kb';

function useKBInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['tutor', 'kb'] });
}

export function useCreateTopic() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (input: CreateTopicInput) => createCatalogTopic(input),
    onSuccess: () => { void invalidate(); },
  });
}

export function useUpdateTopic() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (input: UpdateTopicInput) => updateCatalogTopic(input),
    onSuccess: () => { void invalidate(); },
  });
}

export function useDeleteTopic() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (id: string) => deleteCatalogTopic(id),
    onSuccess: () => { void invalidate(); },
  });
}

export function useCreateSubtopic() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (params: { topicId: string; name: string; sortOrder?: number }) =>
      createCatalogSubtopic(params.topicId, params.name, params.sortOrder),
    onSuccess: () => { void invalidate(); },
  });
}

export function useUpdateSubtopic() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (params: { id: string; name?: string; sortOrder?: number }) =>
      updateCatalogSubtopic(params.id, params.name, params.sortOrder),
    onSuccess: () => { void invalidate(); },
  });
}

export function useDeleteSubtopic() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (id: string) => deleteCatalogSubtopic(id),
    onSuccess: () => { void invalidate(); },
  });
}

export function useCreateSource() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (params: { name: string; sortOrder?: number }) =>
      createCatalogSource(params.name, params.sortOrder),
    onSuccess: () => { void invalidate(); },
  });
}

export function useUpdateSource() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (params: { id: string; name?: string; sortOrder?: number }) =>
      updateCatalogSource(params.id, params.name, params.sortOrder),
    onSuccess: () => { void invalidate(); },
  });
}

export function useDeleteSource() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (id: string) => deleteCatalogSource(id),
    onSuccess: () => { void invalidate(); },
  });
}

// ─── Declutter каталога (ВОЛНА 6) ─────────────────────────────────────────────

export function useMoveTaskToMyBase() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (params: { taskId: string; folderId: string }) =>
      moveTaskToMyBase(params.taskId, params.folderId),
    onSuccess: () => { void invalidate(); },
  });
}

export function useDeleteTopicToMyBase() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (params: { topicId: string; folderId: string | null }) =>
      deleteTopicToMyBase(params.topicId, params.folderId),
    onSuccess: () => { void invalidate(); },
  });
}

export function useDeleteSectionToMyBase() {
  const invalidate = useKBInvalidation();
  return useMutation({
    mutationFn: (params: { subject: string; section: string; filter: CatalogFilter; folderId: string | null }) =>
      deleteSectionToMyBase(params.subject, params.section, params.filter, params.folderId),
    onSuccess: () => { void invalidate(); },
  });
}

export function usePublishFolder() {
  const invalidate = useKBInvalidation();
  return useMutation<PublishFolderResult, Error, { folderId: string; topicId: string; subtopicId?: string | null }>({
    mutationFn: (params) => publishFolderToCatalog(params),
    onSuccess: () => { void invalidate(); },
  });
}
