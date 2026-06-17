// Папки для домашних заданий (homework_folders). Запрос Елены Ивановой (2026-06-17):
// «Упорядочивание Домашек по папкам». Зеркало fetcher-части `src/hooks/useFolders.ts`
// («Моя база» KB), но через прямой PostgREST на homework_folders (RLS tutor_id=auth.uid()).
//
// КРИТИЧНО — отличие от KB: удаление папки ДЗ НЕ удаляет задания (они живые, со сдачами
// учеников). `deleteHomeworkFolder` делает ТОЛЬКО `DELETE FROM homework_folders` — задания
// уходят в «Без папки» (`folder_id → NULL` через FK ON DELETE SET NULL). НЕ копировать
// `removeFolder` из useFolders.ts (тот удаляет задачи перед папкой).
//
// `folder_id` у задания (выбор при создании + перемещение) идёт через edge homework-api
// (там валидация владения папкой) — см. tutorHomeworkApi.ts.

import { supabase } from '@/lib/supabaseClient';

export interface HomeworkFolder {
  id: string;
  tutor_id: string;
  /** Зарезервировано под будущую вложенность; в v1 всегда null (плоские папки). */
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
}

export async function listHomeworkFolders(): Promise<HomeworkFolder[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Нет активной сессии');

  const { data, error } = await supabase
    .from('homework_folders')
    .select('*')
    .eq('tutor_id', session.user.id)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as HomeworkFolder[];
}

export async function createHomeworkFolder(name: string): Promise<HomeworkFolder> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Нет активной сессии');

  const trimmed = name.trim();
  if (!trimmed) throw new Error('Название папки не может быть пустым');

  const { data, error } = await supabase
    .from('homework_folders')
    .insert({ name: trimmed, tutor_id: session.user.id })
    .select()
    .single();
  if (error) throw error;
  return data as HomeworkFolder;
}

export async function renameHomeworkFolder(folderId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Название папки не может быть пустым');

  const { error } = await supabase
    .from('homework_folders')
    .update({ name: trimmed })
    .eq('id', folderId);
  if (error) throw error;
}

/**
 * Удаляет ТОЛЬКО строку папки. Задания внутри НЕ удаляются — FK
 * `homework_tutor_assignments.folder_id ON DELETE SET NULL` переводит их в
 * «Без папки». НЕ копировать KB-логику удаления задач.
 */
export async function deleteHomeworkFolder(folderId: string): Promise<void> {
  const { error } = await supabase
    .from('homework_folders')
    .delete()
    .eq('id', folderId);
  if (error) throw error;
}
