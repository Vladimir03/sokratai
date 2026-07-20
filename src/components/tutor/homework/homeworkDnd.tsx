// Drag & drop раздела ДЗ (запрос владельца, 2026-07-20): тащим карточку ДЗ или
// папку на папку/крошку → перенос. Native HTML5 DnD, без библиотек.
//
// DESKTOP-энхансмент: на iOS/touch HTML5 DnD не работает (rule 80) — канонический
// путь остаётся kebab «Переместить в папку» / иконка «Переместить папку» (модалки).
//
// Готча protected-mode: во время dragover/dragenter dataTransfer.getData()
// недоступен → валидность цели (свой/чужой subtree) считаем по module-level
// `currentDrag`, payload из dataTransfer читаем только в drop.

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { collectDescendantIds } from '@/lib/homeworkFolderTree';
import type { HomeworkFolder } from '@/lib/tutorHomeworkFoldersApi';

export const HW_DND_MIME = 'application/x-sokrat-hw';

export interface HwDndPayload {
  type: 'assignment' | 'folder';
  id: string;
}

let currentDrag: HwDndPayload | null = null;

function parsePayload(dt: DataTransfer): HwDndPayload | null {
  const raw = dt.getData(HW_DND_MIME) || dt.getData('text/plain');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HwDndPayload>;
    if ((parsed.type === 'assignment' || parsed.type === 'folder') && typeof parsed.id === 'string') {
      return { type: parsed.type, id: parsed.id };
    }
  } catch {
    // не наш drag (текст/файл) — игнорируем
  }
  return null;
}

/**
 * Обёртка draggable-источника (карточка ДЗ или папки). Карточка ДЗ — `<Link>`:
 * наш setData перекрывает дефолтный URL-payload якоря; клик после drag браузер
 * не синтезирует, но держим didDrag-гард на onClickCapture (Safari belt).
 */
export function HwDraggable({
  payload,
  children,
  className,
}: {
  payload: HwDndPayload;
  children: ReactNode;
  className?: string;
}) {
  const didDragRef = useRef(false);

  return (
    <div
      draggable
      className={className}
      onDragStart={(e) => {
        didDragRef.current = true;
        currentDrag = payload;
        const json = JSON.stringify(payload);
        e.dataTransfer.setData(HW_DND_MIME, json);
        e.dataTransfer.setData('text/plain', json);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        currentDrag = null;
        // Сброс в микротаске — click (если браузер его всё же выдаст) идёт после dragend.
        setTimeout(() => {
          didDragRef.current = false;
        }, 0);
      }}
      onClickCapture={(e) => {
        if (didDragRef.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * Drop-зона «папка» (или крошка/корень: folderId=null). Ring-подсветка только
 * на ВАЛИДНОЙ цели: перенос папки в себя/своё поддерево запрещён (cycle-guard,
 * тот же collectDescendantIds, что и в MoveHomeworkFolderModal).
 */
export function HwFolderDropZone({
  folderId,
  folders,
  onDropAssignment,
  onDropFolder,
  children,
  className,
}: {
  /** Целевая папка; null = корень «Без папки» (крошка «Домашние задания»). */
  folderId: string | null;
  /** Полный плоский список папок — для cycle-гарда переноса папок. */
  folders: HomeworkFolder[];
  onDropAssignment: (assignmentId: string, targetFolderId: string | null) => void;
  onDropFolder: (folderId: string, targetFolderId: string | null) => void;
  children: ReactNode;
  className?: string;
}) {
  const [isOver, setIsOver] = useState(false);
  const depthRef = useRef(0); // dragenter/leave считаются на каждом вложенном узле

  const isValidTarget = useCallback((): boolean => {
    if (!currentDrag) return false;
    if (currentDrag.type === 'assignment') return true;
    // Папка: нельзя в себя/своё поддерево; в «корень» можно всегда.
    if (folderId === null) return currentDrag.id !== folderId;
    return !collectDescendantIds(folders, currentDrag.id).has(folderId);
  }, [folderId, folders]);

  const reset = () => {
    depthRef.current = 0;
    setIsOver(false);
  };

  return (
    <div
      className={cn(className, isOver && isValidTarget() && 'rounded-[22px] ring-2 ring-accent ring-offset-2')}
      onDragEnter={(e) => {
        if (!currentDrag) return;
        e.preventDefault();
        depthRef.current += 1;
        setIsOver(true);
      }}
      onDragLeave={() => {
        if (!currentDrag) return;
        depthRef.current = Math.max(0, depthRef.current - 1);
        if (depthRef.current === 0) setIsOver(false);
      }}
      onDragOver={(e) => {
        // preventDefault обязателен, иначе drop не сработает (тот же контракт,
        // что в useDragDropFiles). Разрешаем только наш drag.
        if (!currentDrag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = isValidTarget() ? 'move' : 'none';
      }}
      onDrop={(e) => {
        if (!currentDrag && !e.dataTransfer.types.includes(HW_DND_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        const payload = parsePayload(e.dataTransfer) ?? currentDrag;
        reset();
        if (!payload) return;
        if (payload.type === 'assignment') {
          onDropAssignment(payload.id, folderId);
          return;
        }
        if (payload.id === folderId) return; // папка на саму себя — тихий no-op
        // Папка → cycle-guard (тот же, что в модалке переноса; триггер БД — backstop).
        if (folderId !== null && collectDescendantIds(folders, payload.id).has(folderId)) {
          toast.error('Нельзя переместить папку внутрь её же подпапки');
          return;
        }
        onDropFolder(payload.id, folderId);
      }}
    >
      {children}
    </div>
  );
}
