// Меню по клику на пустую ячейку расписания (Волна 1, запрос со скриншота:
// «чтобы можно было добавить не только занятие»): Занятие / Личное дело.
// Лёгкий floating-portal без Radix (нужна позиция ровно у точки клика),
// Esc + клик мимо закрывают. Работает и на нерабочих днях (раньше клик
// молча игнорировался — личное дело в выходной, это валидный сценарий).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, CalendarPlus } from 'lucide-react';

export interface QuickAddMenuState {
  /** Координаты клика (viewport, clientX/clientY). */
  x: number;
  y: number;
  /** Заголовок «Вт, 14:30». */
  label: string;
}

interface QuickAddMenuProps {
  state: QuickAddMenuState | null;
  onClose: () => void;
  onAddLesson: () => void;
  onAddEvent: () => void;
}

export function QuickAddMenu({ state, onClose, onAddLesson, onAddEvent }: QuickAddMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Кламп к viewport — меню не должно вылезать за край (позиционируем после рендера).
  useLayoutEffect(() => {
    if (!state) {
      setPos(null);
      return;
    }
    const el = menuRef.current;
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 96;
    const pad = 8;
    const left = Math.max(pad, Math.min(state.x, window.innerWidth - w - pad));
    const top = Math.max(pad, Math.min(state.y, window.innerHeight - h - pad));
    setPos({ left, top });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    // capture: клик по сетке под меню не должен успеть открыть форму занятия.
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('touchstart', onPointerDown, true);
    };
  }, [state, onClose]);

  if (!state) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Добавить на ${state.label}`}
      className="fixed z-[200] w-[200px] rounded-lg border border-socrat-border bg-white shadow-lg animate-in fade-in-0 zoom-in-95"
      style={{
        left: pos?.left ?? state.x,
        top: pos?.top ?? state.y,
        visibility: pos ? 'visible' : 'hidden',
        touchAction: 'manipulation',
      }}
    >
      <div className="border-b border-socrat-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
        {state.label}
      </div>
      <button
        type="button"
        role="menuitem"
        className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"
        style={{ touchAction: 'manipulation' }}
        onClick={() => { onClose(); onAddLesson(); }}
      >
        <CalendarPlus className="h-4 w-4 text-accent" aria-hidden="true" />
        Занятие
      </button>
      <button
        type="button"
        role="menuitem"
        className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"
        style={{ touchAction: 'manipulation' }}
        onClick={() => { onClose(); onAddEvent(); }}
      >
        <Ban className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Личное дело
      </button>
    </div>,
    document.body,
  );
}
