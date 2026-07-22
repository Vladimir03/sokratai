/**
 * KB moderator API — self-serve таксономия каталога + публикация папки.
 *
 * Тонкие обёртки над SECURITY DEFINER RPC (роль moderator проверяется на
 * сервере). RPC бросают RAISE с человекочитаемой рус. фразой (rule 97) —
 * пробрасываем `error.message` как есть, с дефолтом на случай служебной ошибки.
 *
 * Всё через `@/lib/supabaseClient` (хардкод api.sokratai.ru) — RU-safe.
 */
import { supabase } from '@/lib/supabaseClient';
import type { CatalogFilter, ExamType, TopicKind } from '@/types/kb';

function rpcError(error: { message?: string } | null, fallback: string): Error {
  const msg = error?.message?.trim();
  // Postgres RAISE EXCEPTION кладёт нашу рус. фразу прямо в message (rule 97).
  // Кириллица в тексте → это наша человекочитаемая фраза, показываем её.
  // Служебные ошибки (FK/constraint/permission) и внутренние англоязычные RAISE
  // (kb_publish_task/kb_resync_task) → пользователю показываем рус. fallback,
  // но сырой текст логируем для диагностики (review P2-4: иначе причина теряется).
  if (msg && /[А-Яа-яЁё]/.test(msg)) return new Error(msg);
  if (msg) console.warn('[kb-moderator] RPC error (shown as fallback):', msg);
  return new Error(fallback);
}

// ─── Topics ───────────────────────────────────────────────────────────────────

export interface CreateTopicInput {
  name: string;
  section: string;
  kind: TopicKind;
  exam?: ExamType | null;
  subject?: string;
  kimNumbers?: number[];
  sortOrder?: number;
}

export async function createCatalogTopic(input: CreateTopicInput): Promise<string> {
  const { data, error } = await supabase.rpc('kb_mod_create_topic', {
    p_name: input.name,
    p_section: input.section,
    p_kind: input.kind,
    p_exam: input.exam ?? null,
    p_subject: input.subject ?? 'physics',
    p_kim_numbers: input.kimNumbers ?? [],
    p_sort_order: input.sortOrder ?? 0,
  });
  if (error) throw rpcError(error, 'Не удалось создать тему');
  return data as string;
}

export interface UpdateTopicInput {
  id: string;
  name?: string;
  section?: string;
  exam?: ExamType | null;
  subject?: string;
  kimNumbers?: number[];
  sortOrder?: number;
}

export async function updateCatalogTopic(input: UpdateTopicInput): Promise<void> {
  const { error } = await supabase.rpc('kb_mod_update_topic', {
    p_id: input.id,
    p_name: input.name ?? undefined,
    p_section: input.section ?? undefined,
    p_exam: input.exam ?? null,
    p_subject: input.subject ?? undefined,
    p_kim_numbers: input.kimNumbers ?? undefined,
    p_sort_order: input.sortOrder ?? undefined,
  });
  if (error) throw rpcError(error, 'Не удалось сохранить тему');
}

export async function deleteCatalogTopic(id: string): Promise<void> {
  const { error } = await supabase.rpc('kb_mod_delete_topic', { p_id: id });
  if (error) throw rpcError(error, 'Не удалось удалить тему');
}

// ─── Subtopics ──────────────────────────────────────────────────────────────

export async function createCatalogSubtopic(
  topicId: string,
  name: string,
  sortOrder = 0,
): Promise<string> {
  const { data, error } = await supabase.rpc('kb_mod_create_subtopic', {
    p_topic_id: topicId,
    p_name: name,
    p_sort_order: sortOrder,
  });
  if (error) throw rpcError(error, 'Не удалось создать подтему');
  return data as string;
}

export async function updateCatalogSubtopic(
  id: string,
  name?: string,
  sortOrder?: number,
): Promise<void> {
  const { error } = await supabase.rpc('kb_mod_update_subtopic', {
    p_id: id,
    p_name: name ?? undefined,
    p_sort_order: sortOrder ?? undefined,
  });
  if (error) throw rpcError(error, 'Не удалось сохранить подтему');
}

export async function deleteCatalogSubtopic(id: string): Promise<void> {
  const { error } = await supabase.rpc('kb_mod_delete_subtopic', { p_id: id });
  if (error) throw rpcError(error, 'Не удалось удалить подтему');
}

// ─── Sources (управляемый справочник источников) ──────────────────────────────

export async function createCatalogSource(
  name: string,
  sortOrder = 0,
): Promise<string> {
  const { data, error } = await supabase.rpc('kb_mod_create_source', {
    p_name: name,
    p_sort_order: sortOrder,
  });
  if (error) throw rpcError(error, 'Не удалось создать источник');
  return data as string;
}

export async function updateCatalogSource(
  id: string,
  name?: string,
  sortOrder?: number,
): Promise<void> {
  const { error } = await supabase.rpc('kb_mod_update_source', {
    p_id: id,
    p_name: name ?? undefined,
    p_sort_order: sortOrder ?? undefined,
  });
  if (error) throw rpcError(error, 'Не удалось сохранить источник');
}

export async function deleteCatalogSource(id: string): Promise<void> {
  const { error } = await supabase.rpc('kb_mod_delete_source', { p_id: id });
  if (error) throw rpcError(error, 'Не удалось удалить источник');
}

// ─── Declutter каталога (ВОЛНА 6): «Перенести в Мою базу» + удаление тем/разделов ─
// Скоуп по предметам профиля (сервер). RPC ещё не в generated types.ts (Lovable
// регенерит на применении миграции) → `as never` на границе supabase.rpc
// (конвенция useSubscription, rule 99). После регена каст безвреден.

export interface DeleteToBaseResult {
  moved: number;
  topicsDeleted?: number;
}

/** Перенести каталожную задачу в личную папку «Моей базы» (копия из каталога удаляется). */
export async function moveTaskToMyBase(taskId: string, folderId: string): Promise<void> {
  const { error } = (await supabase.rpc(
    'kb_mod_move_task_to_my_base' as never,
    { p_task_id: taskId, p_folder_id: folderId } as never,
  )) as { error: { message?: string } | null };
  if (error) throw rpcError(error, 'Не удалось перенести задачу в Мою базу');
}

/** Удалить тему: её задачи переносятся в личную папку, тема удаляется (folderId null для пустой). */
export async function deleteTopicToMyBase(topicId: string, folderId: string | null): Promise<DeleteToBaseResult> {
  const { data, error } = (await supabase.rpc(
    'kb_mod_delete_topic_to_my_base' as never,
    { p_topic_id: topicId, p_folder_id: folderId } as never,
  )) as { data: { moved?: number } | null; error: { message?: string } | null };
  if (error) throw rpcError(error, 'Не удалось удалить тему');
  return { moved: (data?.moved ?? 0) };
}

/** Удалить раздел: все его темы (задачи → личная папка), темы удаляются. */
export async function deleteSectionToMyBase(
  subject: string,
  section: string,
  filter: CatalogFilter,
  folderId: string | null,
): Promise<DeleteToBaseResult> {
  const { data, error } = (await supabase.rpc(
    'kb_mod_delete_section_to_my_base' as never,
    { p_subject: subject, p_section: section, p_filter: filter, p_folder_id: folderId } as never,
  )) as { data: { moved?: number; topics_deleted?: number } | null; error: { message?: string } | null };
  if (error) throw rpcError(error, 'Не удалось удалить раздел');
  return { moved: (data?.moved ?? 0), topicsDeleted: (data?.topics_deleted ?? 0) };
}

// ─── Publish folder ─────────────────────────────────────────────────────────

export interface PublishFolderResult {
  published: number;
  skipped: number;
}

export async function publishFolderToCatalog(params: {
  folderId: string;
  topicId: string;
  subtopicId?: string | null;
}): Promise<PublishFolderResult> {
  const { data, error } = await supabase.rpc('kb_publish_folder_to_catalog', {
    p_folder_id: params.folderId,
    p_topic_id: params.topicId,
    p_subtopic_id: params.subtopicId ?? undefined,
  });
  if (error) throw rpcError(error, 'Не удалось опубликовать папку');
  const row = (data ?? [])[0];
  return {
    published: row?.published_count ?? 0,
    skipped: row?.skipped_count ?? 0,
  };
}
