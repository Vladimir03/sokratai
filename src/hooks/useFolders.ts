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
  KBFolderWithCounts,
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

async function fetchRootFolders(): Promise<KBFolderWithCounts[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Нет активной сессии');
  const userId = session.user.id;

  const [foldersRes, allChildrenRes, allTasksRes] = await Promise.all([
    supabase.from('kb_folders').select('*').eq('owner_id', userId).is('parent_id', null).order('sort_order'),
    supabase.from('kb_folders').select('parent_id').eq('owner_id', userId).not('parent_id', 'is', null),
    supabase.from('kb_tasks').select('folder_id').eq('owner_id', userId).not('folder_id', 'is', null),
  ]);
  if (foldersRes.error) throw foldersRes.error;
  if (allChildrenRes.error) throw allChildrenRes.error;
  if (allTasksRes.error) throw allTasksRes.error;

  const childCounts = new Map<string, number>();
  for (const r of allChildrenRes.data ?? []) {
    const pid = (r as { parent_id: string }).parent_id;
    childCounts.set(pid, (childCounts.get(pid) ?? 0) + 1);
  }
  const taskCounts = new Map<string, number>();
  for (const r of allTasksRes.data ?? []) {
    const fid = (r as { folder_id: string }).folder_id;
    taskCounts.set(fid, (taskCounts.get(fid) ?? 0) + 1);
  }

  return (foldersRes.data ?? []).map((f) => ({
    ...f,
    child_count: childCounts.get(f.id) ?? 0,
    task_count: taskCounts.get(f.id) ?? 0,
  })) as KBFolderWithCounts[];
}

export interface FolderBreadcrumb {
  id: string;
  name: string;
}

interface FolderDetail {
  folder: KBFolder;
  children: KBFolderWithCounts[];
  tasks: KBTask[];
  breadcrumbs: FolderBreadcrumb[];
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

  const folder = folderRes.data as KBFolder;
  const childFolders = (childrenRes.data ?? []) as KBFolder[];

  // Build breadcrumb path by walking parent_id chain
  const breadcrumbs: FolderBreadcrumb[] = [{ id: folder.id, name: folder.name }];
  let currentParentId = folder.parent_id;
  while (currentParentId) {
    const { data: parent, error: parentErr } = await supabase
      .from('kb_folders')
      .select('id, name, parent_id')
      .eq('id', currentParentId)
      .single();
    if (parentErr || !parent) break;
    breadcrumbs.unshift({ id: parent.id, name: parent.name });
    currentParentId = (parent as KBFolder).parent_id;
  }

  // Count grandchildren and tasks for each child folder
  const childIds = childFolders.map((c) => c.id);
  let grandchildCounts = new Map<string, number>();
  let childTaskCounts = new Map<string, number>();

  if (childIds.length > 0) {
    const [gcRes, ctRes] = await Promise.all([
      supabase.from('kb_folders').select('parent_id').in('parent_id', childIds),
      supabase.from('kb_tasks').select('folder_id').in('folder_id', childIds),
    ]);
    for (const r of gcRes.data ?? []) {
      const pid = (r as { parent_id: string }).parent_id;
      grandchildCounts.set(pid, (grandchildCounts.get(pid) ?? 0) + 1);
    }
    for (const r of ctRes.data ?? []) {
      const fid = (r as { folder_id: string }).folder_id;
      childTaskCounts.set(fid, (childTaskCounts.get(fid) ?? 0) + 1);
    }
  }

  const children: KBFolderWithCounts[] = childFolders.map((c) => ({
    ...c,
    child_count: grandchildCounts.get(c.id) ?? 0,
    task_count: childTaskCounts.get(c.id) ?? 0,
  }));

  return {
    folder,
    children,
    tasks: (tasksRes.data ?? []) as KBTask[],
    breadcrumbs,
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

async function fetchDescendantFolderIds(folderId: string): Promise<string[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Нет активной сессии');

  const { data, error } = await supabase
    .from('kb_folders')
    .select('id, parent_id')
    .eq('owner_id', session.user.id);
  if (error) throw error;

  const childrenMap = new Map<string, string[]>();
  for (const f of data ?? []) {
    const pid = f.parent_id as string | null;
    if (pid) {
      const list = childrenMap.get(pid) ?? [];
      list.push(f.id);
      childrenMap.set(pid, list);
    }
  }

  const result: string[] = [];
  const stack = [folderId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    result.push(current);
    for (const child of childrenMap.get(current) ?? []) {
      stack.push(child);
    }
  }
  return result;
}

export async function countFolderDescendants(folderId: string): Promise<{ subfolderCount: number; taskCount: number }> {
  const allIds = await fetchDescendantFolderIds(folderId);
  const subfolderCount = allIds.length - 1; // exclude the folder itself

  let taskCount = 0;
  for (let i = 0; i < allIds.length; i += 200) {
    const batch = allIds.slice(i, i + 200);
    const { count, error } = await supabase
      .from('kb_tasks')
      .select('*', { count: 'exact', head: true })
      .in('folder_id', batch);
    if (error) throw error;
    taskCount += count ?? 0;
  }

  return { subfolderCount, taskCount };
}

async function removeFolder(folderId: string): Promise<void> {
  // Collect ALL descendant folder IDs (including folderId itself).
  // We must delete tasks in every descendant folder before deleting the root,
  // because DB cascades child folder deletion but SET NULLs folder_id on tasks,
  // violating kb_tasks_space_check for personal tasks (topic_id is also NULL).
  const allFolderIds = await fetchDescendantFolderIds(folderId);

  for (let i = 0; i < allFolderIds.length; i += 200) {
    const batch = allFolderIds.slice(i, i + 200);
    const { error: tasksError } = await supabase
      .from('kb_tasks')
      .delete()
      .in('folder_id', batch);
    if (tasksError) throw tasksError;
  }

  const { error } = await supabase
    .from('kb_folders')
    .delete()
    .eq('id', folderId);
  if (error) throw error;
}

async function renameFolder(params: { folderId: string; name: string }): Promise<void> {
  const { error } = await supabase
    .from('kb_folders')
    .update({ name: params.name })
    .eq('id', params.folderId);
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
      primary_score: original.primary_score,
      text: original.text,
      answer: original.answer,
      solution: original.solution,
      answer_format: original.answer_format,
      source_label: 'my',
      attachment_url: original.attachment_url,
      solution_attachment_url: original.solution_attachment_url,
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

/** Root-level folders only (parent_id IS NULL), with child/task counts */
export function useRootFolders() {
  const queryKey = useMemo(() => ['tutor', 'kb', 'root-folders'] as const, []);

  const result = useKBQuery<KBFolderWithCounts[]>({
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
    breadcrumbs: result.data?.breadcrumbs ?? [],
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

/** Rename a folder */
export function useRenameFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: renameFolder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb'] });
    },
  });
}

/** Move a task to a different folder (update folder_id) */
export function useMoveTaskToFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { taskId: string; targetFolderId: string; sourceFolderId: string }) => {
      const { error } = await supabase
        .from('kb_tasks')
        .update({ folder_id: params.targetFolderId, updated_at: new Date().toISOString() })
        .eq('id', params.taskId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'folder', variables.sourceFolderId] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'folder', variables.targetFolderId] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'folder-tree'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'root-folders'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'search'] });
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
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'root-folders'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb', 'search'] });
    },
  });
}
