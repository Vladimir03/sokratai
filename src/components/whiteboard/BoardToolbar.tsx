import { memo } from 'react';
import {
  Circle,
  Eraser,
  Minus,
  MousePointer2,
  PenLine,
  Redo2,
  Square,
  Type,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BoardTool } from './BoardCanvas';
import {
  type BoardBackground,
  type BoardGridMm,
  BACKGROUND_LABELS,
  BOARD_BACKGROUNDS,
  BOARD_COLORS,
  BOARD_GRID_STEPS,
  PEN_SIZES_MM,
} from '@/lib/whiteboard/model';

// Панель инструментов доски (задача W1.0.4 + разлиновка W1.6).
// Набор намеренно минимальный: штрих, ластик, текст, три простые фигуры,
// выделение. Ни стрелок, ни коннекторов, ни фреймов — Фаза 1 закрывает Job
// «конспект сам оказался в занятии», а не «нарисовать что угодно».

interface BoardToolbarProps {
  tool: BoardTool;
  onToolChange: (tool: BoardTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  size: number;
  onSizeChange: (size: number) => void;
  background: BoardBackground;
  onBackgroundChange: (background: BoardBackground) => void;
  gridMm: BoardGridMm;
  onGridMmChange: (gridMm: BoardGridMm) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  disabled?: boolean;
}

const TOOLS: { id: BoardTool; label: string; icon: typeof PenLine }[] = [
  { id: 'pen', label: 'Перо', icon: PenLine },
  { id: 'eraser', label: 'Ластик', icon: Eraser },
  { id: 'text', label: 'Текст', icon: Type },
  { id: 'line', label: 'Линия', icon: Minus },
  { id: 'rect', label: 'Прямоугольник', icon: Square },
  { id: 'ellipse', label: 'Эллипс', icon: Circle },
  { id: 'select', label: 'Выделение', icon: MousePointer2 },
];

const SIZE_LABELS = ['Тонко', 'Обычно', 'Толсто'];

// Имена словами, не hex: скринридер читал «Цвет #2563EB» (ревью 5.6, P2).
const COLOR_NAMES: Record<string, string> = {
  '#0F172A': 'Чёрный',
  '#1B6B4A': 'Зелёный',
  '#DC2626': 'Красный',
  '#2563EB': 'Синий',
  '#D97706': 'Оранжевый',
};

function ToolbarButton({
  active,
  label,
  disabled,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{ touchAction: 'manipulation' }}
      className={cn(
        // 44×44 — минимальная тач-цель для стилуса и пальца (ревью 5.6, iOS HIG).
        'flex h-11 w-11 items-center justify-center rounded-lg border transition-colors',
        active
          ? 'border-accent bg-accent text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  );
}

export const BoardToolbar = memo(function BoardToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  size,
  onSizeChange,
  background,
  onBackgroundChange,
  gridMm,
  onGridMmChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  disabled = false,
}: BoardToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-1">
        {TOOLS.map(({ id, label, icon: Icon }) => (
          <ToolbarButton
            key={id}
            label={label}
            active={tool === id}
            disabled={disabled}
            onClick={() => onToolChange(id)}
          >
            <Icon className="h-4 w-4" />
          </ToolbarButton>
        ))}
      </div>

      <div className="flex items-center gap-1">
        {BOARD_COLORS.map((c) => (
          // Кнопка 44×44 (тач-цель), видимый кружок меньше — внутри.
          <button
            key={c}
            type="button"
            title={COLOR_NAMES[c] ?? 'Цвет'}
            aria-label={`Цвет: ${COLOR_NAMES[c] ?? c}`}
            aria-pressed={color === c}
            disabled={disabled}
            onClick={() => onColorChange(c)}
            style={{ touchAction: 'manipulation' }}
            className={cn(
              'flex h-11 w-8 items-center justify-center rounded-md',
              disabled && 'cursor-not-allowed opacity-40',
            )}
          >
            <span
              aria-hidden="true"
              style={{ backgroundColor: c }}
              className={cn(
                'block h-7 w-7 rounded-full border-2',
                color === c ? 'border-slate-900' : 'border-white',
              )}
            />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        {PEN_SIZES_MM.map((s, i) => (
          <ToolbarButton
            key={s}
            label={SIZE_LABELS[i]}
            active={size === s}
            disabled={disabled}
            onClick={() => onSizeChange(s)}
          >
            <span
              className="rounded-full bg-current"
              style={{ width: `${4 + i * 3}px`, height: `${4 + i * 3}px` }}
            />
          </ToolbarButton>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-500" htmlFor="board-background">
          Лист
        </label>
        <select
          id="board-background"
          value={background}
          disabled={disabled}
          onChange={(e) => onBackgroundChange(e.target.value as BoardBackground)}
          // 16px обязателен: Safari iOS зумит страницу на инпуте с меньшим кеглем (rule 80).
          className="h-10 rounded-md border border-slate-200 bg-white px-2 text-base text-slate-700"
        >
          {BOARD_BACKGROUNDS.map((b) => (
            <option key={b} value={b}>
              {BACKGROUND_LABELS[b]}
            </option>
          ))}
        </select>
        <select
          aria-label="Шаг клетки"
          value={gridMm}
          disabled={disabled || background === 'blank'}
          onChange={(e) => onGridMmChange(Number(e.target.value) as BoardGridMm)}
          className="h-10 rounded-md border border-slate-200 bg-white px-2 text-base text-slate-700 disabled:opacity-40"
        >
          {BOARD_GRID_STEPS.map((step) => (
            <option key={step} value={step}>
              {step} мм
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1">
        <ToolbarButton label="Отменить" disabled={disabled || !canUndo} onClick={onUndo}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Вернуть" disabled={disabled || !canRedo} onClick={onRedo}>
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>
      </div>
    </div>
  );
});
