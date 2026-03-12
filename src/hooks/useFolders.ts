import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  KBFolder,
  KBFolderTreeNode,
  KBTask,
  CreateKBFolderInput,
} from '@/types/kb';

// =============================================
// Data fetchers
// =============================================

async function fetchAllFolders(): Promise<KBFolder[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Нет активной сессии');

  const { data, error } = await supabase
    .from('kb_folders')
    .select('*')
    .eq('owner_id', session.user.id)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as KBFolder[];
}

function buildTree(folders: KBFolder[]): KBFolderTreeNode[] {
  const map = new Map<string, KBFolderTreeNode>();
  const roots: KBFolderTreeNode[] = [];

  for (const f of folders) {
    map.set(f.id, { ...f, children: [] });
  }

  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

async function fetchRootFolders(): Promise<KBFolder[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Нет активной сессии');

  const { data, error } = await supabase
    .from('kb_folders')
    .select('*')
    .eq('owner_id', session.user.id)
    .is('parent_id', null)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as KBFolder[];
}

interface FolderDetail {
  folder: KBFolder;
  children: KBFolder[];
  tasks: KBTask[];
}

async function fetchFolder(folderId: string): Promise<FolderDetail> {
  const [folderRes, childrenRes, tasksRes] = await Promise.all([
    supabase.from('kb_folders').select('*').eq('id', folderId).single(),
    supabase.from('kb_folders').select('*').eq('parent_id', folderId).order('sort_order'),
    supabase.from('kb_tasks').select('*').eq('folder_id', folderId).order('created_at'),
  ]);

  if (folderRes.error) throw folderRes.error;
  if (childrenRes.error) throw childrenRes.error;
  if (tasksRes.error) throw tasksRes.error;

  return {
    folder: folderRes.data as KBFolder,
    children: (childrenRes.data ?? []) as KBFolder[],
    tasks: (tasksRes.data ?? []) as KBTask[],
  };
}

async function insertFolder(input: CreateKBFolderInput): Promise<KBFolder> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Нет активной сессии');

  const { data, error } = await supabase
    .from('kb_folders')
    .insert({
      name: input.name,
      parent_id: input.parent_id ?? null,
      owner_id: session.user.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data as KBFolder;
}

async function removeFolder(folderId: string): Promise<void> {
  // Delete personal tasks in this folder first to avoid CHECK constraint
  // violation: kb_tasks_space_check requires (topic_id OR folder_id) to be set,
  // but ON DELETE SET NULL would null out folder_id on orphaned personal tasks.
  const { error: tasksError } = await supabase
    .from('kb_tasks')
    .delete()
    .eq('folder_id', folderId)
    .is('topic_id', null);
  if (tasksError) throw tasksError;

  const { error } = await supabase
    .from('kb_folders')
    .delete()
    .eq('id', folderId);
  if (error) throw error;
}

async function copyTaskToFolder(params: { taskId: string; folderId: string }): Promise<KBTask> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Нет активной сессии');

  // Fetch original task
  const { data: original, error: fetchError } = await supabase
    .from('kb_tasks')
    .select('*')
    .eq('id', params.taskId)
    .single();
  if (fetchError) throw fetchError;
  if (!original) throw new Error('Задача не найдена');

  // Insert copy with user as owner, assigned to target folder
  const { data, error } = await supabase
    .from('kb_tasks')
    .insert({
      folder_id: params.folderId,
      owner_id: session.user.id,
      topic_id: null,
      subtopic_id: null,
      exam: original.exam,
      kim_number: original.kim_number,
      text: original.text,
      answer: original.answer,
      solution: original.solution,
      answer_format: original.answer_format,
      source_label: 'my',
      attachment_url: original.attachment_url,
    })
    .select()
    .single();
  if (error) throw error;
  return data as KBTask;
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

/** All user's folders as a recursive tree */
export function useFolderTree() {
  const queryKey = useMemo(() => ['tutor', 'kb', 'folder-tree'] as const, []);

  const query = useQuery<KBFolderTreeNode[], unknown>({
    queryKey,
    queryFn: async () => {
      const folders = await withTutorTimeout(queryKey, fetchAllFolders());
      return buildTree(folders);
    },
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  return {
    tree: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? toTutorErrorMessage('Не удалось загрузить папки', query.error) : null,
    refetch: () => { void query.refetch(); },
    isFetching: query.isFetching,
  };
}

/** Root-level folders only (parent_id IS NULL) */
export function useRootFolders() {
  const queryKey = useMemo(() => ['tutor', 'kb', 'root-folders'] as const, []);

  const result = useKBQuery<KBFolder[]>({
    queryKey,
    queryFn: fetchRootFolders,
    defaultValue: [],
    errorMessage: 'Не удалось загрузить папки',
  });

  return { folders: result.data, ...result };
}

/** Single folder with its children and tasks */
export function useFolder(folderId: string | undefined) {
  const queryKey = useMemo(
    () => ['tutor', 'kb', 'folder', folderId ?? 'none'] as const,
    [folderId],
  );

  const result = useKBQuery<FolderDetail | null>({
    queryKey,
    queryFn: () => fetchFolder(folderId!),
    defaultValue: null,
    errorMessage: 'Не удалось загрузить папку',
    enabled: Boolean(folderId),
  });

  return {
    folder: result.data?.folder ?? null,
    children: result.data?.children ?? [],
    tasks: result.data?.tasks ?? [],
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
  };
}

// =============================================
// Mutation hooks
// =============================================

/** Create a new folder */
export function useCreateFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: insertFolder,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'folder-tree'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'root-folders'] });
      if (variables.parent_id) {
        void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'folder', variables.parent_id] });
      }
    },
  });
}

/** Delete a folder (cascades children via DB) */
export function useDeleteFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeFolder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb'] });
    },
  });
}

/** Copy a catalog task into a personal folder */
export function useCopyTaskToFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: copyTaskToFolder,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'folder', variables.folderId] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'folder-tree'] });
    },
  });
}
