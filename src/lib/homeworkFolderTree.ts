// Дерево папок ДЗ (вложенность, запрос Елены 2026-07-20) — чистые утилиты без React.
//
// Зеркало tree-части KB `src/hooks/useFolders.ts` (buildTree module-private +
// KBFolder-typed → локальное зеркало = конвенция «mirror locally»).
//
// ПЕРФ-РЕШЕНИЕ (осознанное отличие от KB): счётчики считаются КЛИЕНТОМ —
// `/tutor/homework` уже грузит ПОЛНЫЙ список assignments и дерайвит из него
// folderCounts, а папок у репетитора мало. KB-RPC `kb_folder_recursive_counts`
// существует из-за PostgREST 1000-row cap на kb_tasks, которые НЕ грузятся
// целиком — здесь этой проблемы нет, ноль новых запросов.

import type { HomeworkFolder } from '@/lib/tutorHomeworkFoldersApi';

/**
 * Belt против битых цепочек parent_id. DB-гард (hw_folder_parent_guard)
 * допускает 50 ШАГОВ walk-up → цепочка максимум из 51 узла — обходы ниже
 * считают лимит В УЗЛАХ (MAX_CHAIN_NODES), чтобы не обрезать легальный корень
 * (ревью ChatGPT-5.6 P2, 2026-07-20). Плюс visited-гарды: клиент не должен
 * зависать даже на повреждённых циклических данных.
 */
const MAX_DEPTH = 50;
const MAX_CHAIN_NODES = MAX_DEPTH + 1;

export interface HomeworkFolderTreeNode extends HomeworkFolder {
  children: HomeworkFolderTreeNode[];
}

/**
 * Плоский список → корневые узлы дерева. Папка с parent_id, которого нет в
 * списке (гонка кэша/удалённый родитель), поднимается в корень — не теряется.
 * Порядок сохраняется как в списке (sort_order, name — сортирует API).
 */
export function buildHomeworkFolderTree(folders: HomeworkFolder[]): HomeworkFolderTreeNode[] {
  const nodeById = new Map<string, HomeworkFolderTreeNode>();
  for (const f of folders) nodeById.set(f.id, { ...f, children: [] });
  const roots: HomeworkFolderTreeNode[] = [];
  for (const f of folders) {
    const node = nodeById.get(f.id)!;
    const parent = f.parent_id ? nodeById.get(f.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Все id поддерева, ВКЛЮЧАЯ rootId (итеративный стек — зеркало KB
 * fetchDescendantFolderIds). Используется гардом переноса (нельзя в себя/своё
 * поддерево), subtree-фильтром пикера и subtree-счётчиками удаления.
 */
export function collectDescendantIds(folders: HomeworkFolder[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parent_id) continue;
    const list = childrenByParent.get(f.parent_id) ?? [];
    list.push(f.id);
    childrenByParent.set(f.parent_id, list);
  }
  const result = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const childId of childrenByParent.get(cur) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}

/** Число ПРЯМЫХ подпапок на папку (для «N папок» на карточке — семантика KB, rule 50). */
export function countDirectChildren(folders: HomeworkFolder[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const f of folders) {
    if (f.parent_id) map.set(f.parent_id, (map.get(f.parent_id) ?? 0) + 1);
  }
  return map;
}

/**
 * РЕКУРСИВНОЕ число заданий на папку (папка + всё поддерево — семантика KB
 * «N задач РЕКУРСИВНО», rule 50). Bottom-up: прямые количества, затем каждая
 * папка добавляет свой subtotal родителю (обход от листьев через сортировку
 * по глубине).
 */
export function recursiveAssignmentCounts(
  folders: HomeworkFolder[],
  assignments: ReadonlyArray<{ folder_id?: string | null }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of folders) counts.set(f.id, 0);
  for (const a of assignments) {
    if (a.folder_id && counts.has(a.folder_id)) {
      counts.set(a.folder_id, (counts.get(a.folder_id) ?? 0) + 1);
    }
  }
  // Глубина каждой папки (visited-гард от циклов), листья схлопываются в
  // родителей от самых глубоких.
  const byId = new Map(folders.map((f) => [f.id, f]));
  const depthOf = (id: string): number => {
    const seen = new Set<string>([id]);
    let depth = 0;
    let cur = byId.get(id);
    while (cur?.parent_id && !seen.has(cur.parent_id) && depth < MAX_CHAIN_NODES) {
      seen.add(cur.parent_id);
      depth += 1;
      cur = byId.get(cur.parent_id);
    }
    return depth;
  };
  const ordered = [...folders].sort((a, b) => depthOf(b.id) - depthOf(a.id));
  for (const f of ordered) {
    if (f.parent_id && counts.has(f.parent_id)) {
      counts.set(f.parent_id, (counts.get(f.parent_id) ?? 0) + (counts.get(f.id) ?? 0));
    }
  }
  return counts;
}

/** Дерево → плоский список с глубиной (для `<option>` с `— `-отступами и модалок). */
export function flattenTreeWithDepth(
  tree: HomeworkFolderTreeNode[],
): Array<{ folder: HomeworkFolder; depth: number }> {
  const out: Array<{ folder: HomeworkFolder; depth: number }> = [];
  const walk = (nodes: HomeworkFolderTreeNode[], depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const node of nodes) {
      out.push({ folder: node, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}

/**
 * Хлебные крошки: [корневой предок, …, сама папка]. Client parent-chain walk —
 * до MAX_CHAIN_NODES узлов (легальная цепочка при DB-капе 50 шагов = 51 узел)
 * + visited-гард (битый цикл в данных не вешает клиент).
 */
export function buildFolderBreadcrumbs(
  folders: HomeworkFolder[],
  folderId: string,
): Array<{ id: string; name: string }> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: Array<{ id: string; name: string }> = [];
  const visited = new Set<string>();
  let cur = byId.get(folderId);
  while (cur && !visited.has(cur.id) && visited.size < MAX_CHAIN_NODES) {
    visited.add(cur.id);
    chain.unshift({ id: cur.id, name: cur.name });
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return chain;
}
