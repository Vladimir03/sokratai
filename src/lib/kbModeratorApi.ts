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
import type { ExamType, TopicKind } from '@/types/kb';

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
