import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteKBTaskImage, parseAttachmentUrls } from '@/lib/kbApi';
import { supabase } from '@/lib/supabaseClient';
import {
  createTutorRetry,
  getTutorBackgroundRefetchInterval,
  toTutorErrorMessage,
  TUTOR_GC_TIME_MS,
  TUTOR_STALE_TIME_MS,
  tutorRetryDelay,
  withTutorTimeout,
} from '@/hooks/tutorQueryOptions';
import type {
  KBTopicWithCounts,
  KBTask,
  KBMaterial,
  KBSubtopic,
  CreateKBTaskInput,
  UpdateKBTaskInput,
  ExamType,
} from '@/types/kb';

// =============================================
// Data fetchers
// =============================================

async function fetchTopics(
  examFilter?: ExamType,
  searchQuery?: string,
): Promise<KBTopicWithCounts[]> {
  let query = supabase
    .from('kb_topics_with_counts')
    .select('*')
    .order('sort_order');

  if (examFilter) {
    query = query.eq('exam', examFilter);
  }

  if (searchQuery && searchQuery.trim().length > 0) {
    query = query.ilike('name', `%${searchQuery.trim()}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as KBTopicWithCounts[];
}

async function fetchTopic(topicId: string): Promise<KBTopicWithCounts | null> {
  const { data, error } = await supabase
    .from('kb_topics_with_counts')
    .select('*')
    .eq('id', topicId)
    .single();
  if (error) throw error;
  return (data as KBTopicWithCounts) ?? null;
}

async function fetchSubtopics(topicId: string): Promise<KBSubtopic[]> {
  const { data, error } = await supabase
    .from('kb_subtopics')
    .select('*')
    .eq('topic_id', topicId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as KBSubtopic[];
}

async function fetchCatalogTasks(topicId: string): Promise<KBTask[]> {
  // Reads only canonical public tasks (owner_id=NULL, moderation_status='active')
  // via fetch_catalog_tasks_v2 RPC (simplified in moderation_v2 migration)
  const { data, error } = await supabase
    .rpc('fetch_catalog_tasks_v2', { p_topic_id: topicId });
  if (error) throw error;
  return (data ?? []) as KBTask[];
}

async function fetchCatalogMaterials(topicId: string): Promise<KBMaterial[]> {
  const { data, error } = await supabase
    .from('kb_materials')
    .select('*')
    .eq('topic_id', topicId)
    .is('owner_id', null)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as KBMaterial[];
}

async function insertTask(input: CreateKBTaskInput): Promise<KBTask> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Нет активной сессии');

  const { data, error } = await supabase
    .from('kb_tasks')
    .insert({
      ...input,
      owner_id: session.user.id,
      source_label: input.source_label || 'my',
    })
    .select()
    .single();
  if (error) throw error;
  return data as KBTask;
}

async function updateTask(
  taskId: string,
  input: UpdateKBTaskInput,
): Promise<KBTask> {
  const { data, error } = await supabase
    .from('kb_tasks')
    .update(input)
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;
  return data as KBTask;
}

async function removeTask(taskId: string): Promise<void> {
  // Fetch task first to get attachment refs for storage cleanup
  const { data: task } = await supabase
    .from('kb_tasks')
    .select('attachment_url, solution_attachment_url')
    .eq('id', taskId)
    .single();

  const { error } = await supabase
    .from('kb_tasks')
    .delete()
    .eq('id', taskId);
  if (error) throw error;

  // Clean up storage blobs after successful DB delete (best-effort)
  if (task) {
    const refs = [
      ...parseAttachmentUrls(task.attachment_url),
      ...parseAttachmentUrls(task.solution_attachment_url),
    ];
    for (const ref of refs) void deleteKBTaskImage(ref);
  }
}

// =============================================
// Query hooks
// =============================================

type KBQueryKey = readonly unknown[];

function useKBQuery<TData>({
  queryKey,
  queryFn,
  defaultValue,
  errorMessage,
  enabled = true,
}: {
  queryKey: KBQueryKey;
  queryFn: () => Promise<TData>;
  defaultValue: TData;
  errorMessage: string;
  enabled?: boolean;
}) {
  const query = useQuery<TData, unknown>({
    queryKey,
    queryFn: () => withTutorTimeout(queryKey, queryFn()),
    enabled,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (currentQuery) => {
      const data = currentQuery.state.data as TData | undefined;
      const hasQueryData = data !== undefined && data !== null;
      return getTutorBackgroundRefetchInterval(hasQueryData, Boolean(currentQuery.state.error));
    },
  });

  return {
    data: query.data ?? defaultValue,
    loading: query.isLoading,
    error: query.error ? toTutorErrorMessage(errorMessage, query.error) : null,
    refetch: () => { void query.refetch(); },
    isFetching: query.isFetching,
  };
}

/** All topics with counts, optionally filtered by exam and search */
export function useTopics(examFilter?: ExamType, searchQuery?: string) {
  const queryKey = useMemo(
    () => ['tutor', 'kb', 'topics', examFilter ?? 'all', searchQuery ?? ''] as const,
    [examFilter, searchQuery],
  );

  const result = useKBQuery<KBTopicWithCounts[]>({
    queryKey,
    queryFn: () => fetchTopics(examFilter, searchQuery),
    defaultValue: [],
    errorMessage: 'Не удалось загрузить темы',
  });

  return { topics: result.data, ...result };
}

/** Single topic with counts */
export function useTopic(topicId: string | undefined) {
  const queryKey = useMemo(
    () => ['tutor', 'kb', 'topic', topicId ?? 'none'] as const,
    [topicId],
  );

  const result = useKBQuery<KBTopicWithCounts | null>({
    queryKey,
    queryFn: () => fetchTopic(topicId!),
    defaultValue: null,
    errorMessage: 'Не удалось загрузить тему',
    enabled: Boolean(topicId),
  });

  return { topic: result.data, ...result };
}

/** Subtopics for a given topic */
export function useSubtopics(topicId: string | undefined) {
  const queryKey = useMemo(
    () => ['tutor', 'kb', 'subtopics', topicId ?? 'none'] as const,
    [topicId],
  );

  const result = useKBQuery<KBSubtopic[]>({
    queryKey,
    queryFn: () => fetchSubtopics(topicId!),
    defaultValue: [],
    errorMessage: 'Не удалось загрузить подтемы',
    enabled: Boolean(topicId),
  });

  return { subtopics: result.data, ...result };
}

/** Catalog tasks (owner_id IS NULL) for a topic */
export function useCatalogTasks(topicId: string | undefined) {
  const queryKey = useMemo(
    () => ['tutor', 'kb', 'catalog-tasks', topicId ?? 'none'] as const,
    [topicId],
  );

  const result = useKBQuery<KBTask[]>({
    queryKey,
    queryFn: () => fetchCatalogTasks(topicId!),
    defaultValue: [],
    errorMessage: 'Не удалось загрузить задачи',
    enabled: Boolean(topicId),
  });

  return { tasks: result.data, ...result };
}

/** Materials for a topic */
export function useMaterials(topicId: string | undefined) {
  const queryKey = useMemo(
    () => ['tutor', 'kb', 'materials', topicId ?? 'none'] as const,
    [topicId],
  );

  const result = useKBQuery<KBMaterial[]>({
    queryKey,
    queryFn: () => fetchCatalogMaterials(topicId!),
    defaultValue: [],
    errorMessage: 'Не удалось загрузить материалы',
    enabled: Boolean(topicId),
  });

  return { materials: result.data, ...result };
}

// =============================================
// Mutation hooks
// =============================================

/** Create a personal task in a folder */
export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: insertTask,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'catalog-tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'root-folders'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'search'] });
      if (variables.folder_id) {
        void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'folder', variables.folder_id] });
      }
    },
  });
}

/** Update a personal task */
export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: UpdateKBTaskInput }) =>
      updateTask(taskId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb'] });
    },
  });
}

/** Delete a personal task */
export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeTask,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb'] });
    },
  });
}
