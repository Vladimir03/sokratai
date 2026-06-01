// Группировка и счётчики задач каталога Сократа.
// Чистые помощники (без React) — переиспользуются каталогом (`CatalogTopicPage`)
// и пикером конструктора ДЗ (`KBPickerSheet`).
import type { KBTask } from '@/types/kb';

/** Sentinel для фильтра «Без подтемы» (отличается от `null` = «Все подтемы»). */
export const NO_SUBTOPIC_FILTER = '__no_subtopic__';

export interface KimGroup {
  /** Номер КИМ группы, либо `null` для задач без номера. */
  kim: number | null;
  tasks: KBTask[];
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
