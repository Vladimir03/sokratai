/**
 * Панель разметки поверх фото (волна 2, план 1-ancient-quokka).
 *
 * ⚠️ Цветов ровно четыре и они БЕЗ палитры. Егор: «некогда на занятии выбирать
 * палитру» (B17). Красный стоит первым и выбран по умолчанию — разметка нужна,
 * чтобы показать ошибку, и это самый частый жест.
 *
 * Раскладка зависит от устройства (решение владельца «оба равнозначно»):
 * на десктопе панель вертикальная слева, на планшете — горизонтальная снизу,
 * чтобы не попадать под ладонь пишущей руки.
 */

import { memo } from 'react';
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Hand,
  Highlighter,
  PenLine,
  Redo2,
  Square,
  Type,
  Undo2,
} from 'lucide-react';

export type AnnotateTool =
  | 'pen'
  | 'marker'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'eraser'
  | 'pan';

/** Цвета из палитры доски (rule 90) — новых оттенков не заводим. */
export const ANNOTATE_COLORS = [
  { value: '#DC2626', label: 'Красный — ошибка' },
  { value: '#1B6B4A', label: 'Зелёный — верно' },
  { value: '#2563EB', label: 'Синий' },
  { value: '#D97706', label: 'Оранжевый' },
] as const;

export const DEFAULT_ANNOTATE_COLOR = ANNOTATE_COLORS[0].value;

const TOOLS: { id: AnnotateTool; label: string; icon: typeof PenLine }[] = [
  { id: 'pen', label: 'Перо', icon: PenLine },
  { id: 'marker', label: 'Маркер — подсветить', icon: Highlighter },
  { id: 'arrow', label: 'Стрелка', icon: ArrowUpRight },
  { id: 'rect', label: 'Рамка', icon: Square },
  { id: 'ellipse', label: 'Овал', icon: Circle },
  { id: 'text', label: 'Текст', icon: Type },
  { id: 'eraser', label: 'Ластик', icon: Eraser },
  { id: 'pan', label: 'Рука — двигать фото', icon: Hand },
];

const SIZE_LABELS = ['Тонко', 'Обычно', 'Толсто'] as const;

export interface AnnotateToolbarProps {
  tool: AnnotateTool;
  onToolChange: (tool: AnnotateTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  sizeIndex: number;
  onSizeChange: (index: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const BTN =
  'grid h-11 w-11 shrink-0 place-items-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-30';
const BTN_ACTIVE = 'bg-white/20 text-white';

export const AnnotateToolbar = memo(function AnnotateToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  sizeIndex,
  onSizeChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: AnnotateToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Инструменты разметки"
      className="flex items-center gap-1 overflow-x-auto px-2 py-1 md:flex-col md:overflow-x-visible md:overflow-y-auto md:px-1 md:py-2"
      style={{ touchAction: 'pan-x' }}
    >
      {TOOLS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={tool === id}
          onClick={() => onToolChange(id)}
          style={{ touchAction: 'manipulation' }}
          className={`${BTN} ${tool === id ? BTN_ACTIVE : ''}`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </button>
      ))}

      <span className="mx-1 h-7 w-px shrink-0 bg-white/15 md:mx-0 md:my-1 md:h-px md:w-7" />

      {ANNOTATE_COLORS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={color === value}
          onClick={() => onColorChange(value)}
          style={{ touchAction: 'manipulation' }}
          className={`${BTN} ${color === value ? 'ring-2 ring-white' : ''}`}
        >
          <span
            aria-hidden="true"
            className="block h-5 w-5 rounded-full border border-white/40"
            style={{ backgroundColor: value }}
          />
        </button>
      ))}

      <span className="mx-1 h-7 w-px shrink-0 bg-white/15 md:mx-0 md:my-1 md:h-px md:w-7" />

      {SIZE_LABELS.map((label, index) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={`Толщина: ${label.toLowerCase()}`}
          aria-pressed={sizeIndex === index}
          onClick={() => onSizeChange(index)}
          style={{ touchAction: 'manipulation' }}
          className={`${BTN} ${sizeIndex === index ? BTN_ACTIVE : ''}`}
        >
          <span
            aria-hidden="true"
            className="block rounded-full bg-current"
            style={{ width: 4 + index * 5, height: 4 + index * 5 }}
          />
        </button>
      ))}

      <span className="mx-1 h-7 w-px shrink-0 bg-white/15 md:mx-0 md:my-1 md:h-px md:w-7" />

      <button
        type="button"
        title="Отменить"
        aria-label="Отменить"
        onClick={onUndo}
        disabled={!canUndo}
        style={{ touchAction: 'manipulation' }}
        className={BTN}
      >
        <Undo2 className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        title="Повторить"
        aria-label="Повторить"
        onClick={onRedo}
        disabled={!canRedo}
        style={{ touchAction: 'manipulation' }}
        className={BTN}
      >
        <Redo2 className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
});

AnnotateToolbar.displayName = 'AnnotateToolbar';
