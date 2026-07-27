// Единый fan-out инвалидаций после мутаций групп/меток (create / rename /
// archive / restore / изменение состава). Один хелпер на все поверхности,
// чтобы набор ключей не разъехался (зеркало подхода invalidateGroupRosterCaches).
import type { QueryClient } from '@tanstack/react-query';

export async function invalidateGroupEditorCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    [
      // Prefix-инвалидация накрывает и ['tutor','groups'] (активные + members),
      // и ['tutor','groups','all'] (архив в ManageGroupsSheet).
      ['tutor', 'groups'],
      ['tutor', 'group-memberships'],
      // Секции списка учеников группируются по основной группе.
      ['tutor', 'students'],
      // Групповые чаты синтезируются из активных is_primary групп.
      ['chat', 'conversations'],
    ].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey, refetchType: 'active' }),
    ),
  );
}
