import { supabase } from '@/lib/supabaseClient';

/**
 * Имя корневой папки-зеркала «Из ДЗ».
 *
 * ОБЯЗАНО совпадать с `KB_MIRROR_FOLDER_NAME` в
 * `supabase/functions/homework-api/index.ts` (двойной источник, синхронизация
 * вручную — конвенция «mirror locally», как Deno SUBJECT_LABELS): бэкенд ищет
 * папку тем же case-insensitive ilike-матчем, поэтому клиентски созданная
 * папка не плодит близнеца при авто-зеркале на сохранении ДЗ.
 */
const HW_MIRROR_FOLDER_NAME = 'Из ДЗ';

/**
 * Find-or-create корневой папки «Из ДЗ» под текущим репетитором (прямой
 * PostgREST под RLS — прецедент `insertFolder` в `useFolders.ts`).
 *
 * Зачем: edge `kb-ai-extract` требует `folder_id` владельца (ownership-гейт).
 * AI-загрузка в конструкторе ДЗ не выбирает папку — задачи попадут в Базу
 * авто-зеркалом при сохранении ДЗ, а для extract-вызова лениво резолвим ту же
 * папку, куда зеркало их и положит.
 */
export async function resolveOrCreateHwMirrorFolderId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Нет активной сессии — войдите заново.');
  const ownerId = session.user.id;

  const { data: existingFolders, error: lookupErr } = await supabase
    .from('kb_folders')
    .select('id, name')
    .eq('owner_id', ownerId)
    .is('parent_id', null)
    .ilike('name', HW_MIRROR_FOLDER_NAME);
  if (lookupErr) {
    throw new Error('Не удалось подготовить папку «Из ДЗ» в Базе. Проверьте соединение и попробуйте ещё раз.');
  }
  const existing = (existingFolders ?? []).find(
    (f) =>
      typeof f.name === 'string' &&
      f.name.trim().toLowerCase() === HW_MIRROR_FOLDER_NAME.toLowerCase(),
  );
  if (existing) return existing.id as string;

  const { data: inserted, error: insertErr } = await supabase
    .from('kb_folders')
    .insert({ owner_id: ownerId, parent_id: null, name: HW_MIRROR_FOLDER_NAME })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    throw new Error('Не удалось создать папку «Из ДЗ» в Базе. Проверьте соединение и попробуйте ещё раз.');
  }
  return inserted.id as string;
}
