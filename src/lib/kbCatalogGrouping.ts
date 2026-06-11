// Группировка и счётчики задач каталога Сократа.
// Чистые помощники (без React) — переиспользуются каталогом (`CatalogTopicPage`)
// и пикером конструктора ДЗ (`KBPickerSheet`).
import type { KBSubtopic, KBTask } from '@/types/kb';

/** Sentinel для фильтра «Без подтемы» (отличается от `null` = «Все подтемы»). */
export const NO_SUBTOPIC_FILTER = '__no_subtopic__';

export interface KimGroup {
  /** Номер КИМ группы, либо `null` для задач без номера. */
  kim: number | null;
  tasks: KBTask[];
  /**
   * Опциональные display-переопределения для не-КИМ группировок (олимпиады
   * группируются по подтемам). Если заданы — `CatalogTaskGroups` берёт их
   * вместо дефолтных «КИМ № N». KIM-группы их не задают → поведение прежнее.
   */
  key?: string;
  label?: string;
}

export interface SubtopicCounts {
  bySubtopic: Map<string, number>;
  noSubtopic: number;
}

const SORT_LAST = Number.MAX_SAFE_INTEGER;

/**
 * Группирует задачи по `kim_number` ПО ВОЗРАСТАНИЮ для секций
 * «КИМ № N · M задач» (best-practice Школково / Решу ЕГЭ).
 *
 * Порядок внутри группы: по `sort_order` подтемы (`subtopicOrder`), затем
 * по `created_at` (стабильно). Задачи без номера КИМ собираются в группу
 * `{ kim: null }` в самом конце (только если такие есть).
 */
export function groupTasksByKim(
  tasks: KBTask[],
  subtopicOrder?: Map<string, number>,
): KimGroup[] {
  const order = subtopicOrder ?? new Map<string, number>();

  const subOrderOf = (t: KBTask): number => {
    if (!t.subtopic_id) return SORT_LAST;
    const v = order.get(t.subtopic_id);
    return v == null ? SORT_LAST : v;
  };

  const sorted = [...tasks].sort((a, b) => {
    const ka = a.kim_number ?? SORT_LAST;
    const kb = b.kim_number ?? SORT_LAST;
    if (ka !== kb) return ka - kb;
    const sa = subOrderOf(a);
    const sb = subOrderOf(b);
    if (sa !== sb) return sa - sb;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const groups: KimGroup[] = [];
  let current: KimGroup | null = null;
  for (const task of sorted) {
    const kim = task.kim_number ?? null;
    if (!current || current.kim !== kim) {
      current = { kim, tasks: [] };
      groups.push(current);
    }
    current.tasks.push(task);
  }
  return groups;
}

/**
 * Группирует задачи по ПОДТЕМЕ — для олимпиадных тем (без № КИМ).
 * Порядок групп: по `sort_order` подтемы; задачи без подтемы — в конце.
 * Если у темы нет подтем вовсе → одна группа «Все задачи».
 * Возвращает `KimGroup[]` (с заданными `key`/`label`) для переиспользования
 * `CatalogTaskGroups` без изменения его сигнатуры.
 */
export function groupTasksBySubtopic(
  tasks: KBTask[],
  subtopics: KBSubtopic[],
): KimGroup[] {
  if (tasks.length === 0) return [];

  const order = new Map(subtopics.map((s) => [s.id, s.sort_order]));
  const nameById = new Map(subtopics.map((s) => [s.id, s.name]));

  const bySubtopic = new Map<string, KBTask[]>();
  const noSubtopic: KBTask[] = [];
  for (const t of tasks) {
    if (t.subtopic_id && nameById.has(t.subtopic_id)) {
      const list = bySubtopic.get(t.subtopic_id) ?? [];
      list.push(t);
      bySubtopic.set(t.subtopic_id, list);
    } else {
      noSubtopic.push(t);
    }
  }

  // Нет подтем → единая группа «Все задачи» (без шумного заголовка-разбивки).
  if (bySubtopic.size === 0) {
    return [{ kim: null, key: 'all', label: 'Все задачи', tasks }];
  }

  const groups: KimGroup[] = Array.from(bySubtopic.entries())
    .sort((a, b) => (order.get(a[0]) ?? SORT_LAST) - (order.get(b[0]) ?? SORT_LAST))
    .map(([id, list]) => ({
      kim: null,
      key: id,
      label: nameById.get(id) ?? 'Подтема',
      tasks: list,
    }));

  if (noSubtopic.length > 0) {
    groups.push({ kim: null, key: NO_SUBTOPIC_FILTER, label: 'Без подтемы', tasks: noSubtopic });
  }

  return groups;
}

/** Client-side счётчики задач по подтемам (для чипов-фильтров). */
export function countTasksBySubtopic(tasks: KBTask[]): SubtopicCounts {
  const bySubtopic = new Map<string, number>();
  let noSubtopic = 0;
  for (const t of tasks) {
    if (t.subtopic_id) {
      bySubtopic.set(t.subtopic_id, (bySubtopic.get(t.subtopic_id) ?? 0) + 1);
    } else {
      noSubtopic += 1;
    }
  }
  return { bySubtopic, noSubtopic };
}
