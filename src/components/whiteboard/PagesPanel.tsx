import { memo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type BoardElement,
  type BoardBackground,
  type BoardGridMm,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
} from '@/lib/whiteboard/model';
import { DEFAULT_STROKE_OPTIONS, elementToSvg } from '@/lib/whiteboard/svg';

// Панель страниц (задача W1.5). Внизу слева, миниатюры + «+», модель Meleto —
// прямой запрос носителя: «сделайте со страницами, не как миро» (spec §0).

export interface BoardPageSummary {
  id: string;
  elements: BoardElement[];
  background: BoardBackground;
  gridMm: BoardGridMm;
}

interface PagesPanelProps {
  pages: BoardPageSummary[];
  activeIndex: number;
  disabled?: boolean;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
}

/**
 * Миниатюра страницы. Разлиновку намеренно НЕ рисуем: в масштабе ~1:10 клетка
 * превращается в серую заливку, из которой не понять, что на листе.
 */
const PageThumb = memo(
  function PageThumb({ page }: { page: BoardPageSummary }) {
    return (
      <svg
        viewBox={`0 0 ${PAGE_WIDTH_MM} ${PAGE_HEIGHT_MM}`}
        className="h-full w-full"
        aria-hidden="true"
      >
        {page.elements.map((element) =>
          elementToSvg(element, DEFAULT_STROKE_OPTIONS).map((node, i) => {
            const key = `${element.id}-${i}`;
            if (node.tag === 'text') {
              return (
                <text key={key} {...(node.attrs as Record<string, string | number>)}>
                  {node.text}
                </text>
              );
            }
            const Tag = node.tag as 'path' | 'rect' | 'ellipse' | 'line';
            return <Tag key={key} {...(node.attrs as Record<string, string | number>)} />;
          }),
        )}
      </svg>
    );
  },
  (prev, next) =>
    prev.page.id === next.page.id && prev.page.elements === next.page.elements,
);

export const PagesPanel = memo(function PagesPanel({
  pages,
  activeIndex,
  disabled = false,
  onSelect,
  onAdd,
  onDelete,
}: PagesPanelProps) {
  return (
    // touch-pan-x: без него iOS Safari отдаёт touchstart кнопкам-миниатюрам и
    // горизонтальный свайп ленты не работает (rule 80).
    <div className="flex touch-pan-x items-end gap-2 overflow-x-auto border-t border-slate-200 bg-white px-3 py-2">
      {pages.map((page, index) => (
        <div key={page.id} className="group relative shrink-0">
          <button
            type="button"
            onClick={() => onSelect(index)}
            disabled={disabled}
            style={{ touchAction: 'manipulation' }}
            aria-label={`Страница ${index + 1}`}
            aria-current={index === activeIndex ? 'true' : undefined}
            className={cn(
              'block h-24 w-[68px] overflow-hidden rounded-md border-2 bg-white transition-colors',
              index === activeIndex ? 'border-accent' : 'border-slate-200 hover:border-slate-300',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <PageThumb page={page} />
          </button>
          <span className="mt-1 block text-center text-xs text-slate-500">{index + 1}</span>
          {/* group-focus-within: до кнопки можно добраться клавиатурой, а не
              только hover'ом (ревью 5.6, P2). Само удаление за confirm-гейтом. */}
          {pages.length > 1 && (
            <button
              type="button"
              onClick={() => onDelete(index)}
              disabled={disabled}
              aria-label={`Удалить страницу ${index + 1}`}
              style={{ touchAction: 'manipulation' }}
              className="absolute -right-1.5 -top-1.5 hidden h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-red-600 group-hover:flex group-focus-within:flex focus:flex"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        aria-label="Добавить страницу"
        style={{ touchAction: 'manipulation' }}
        className={cn(
          'flex h-24 w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-slate-300 text-slate-500 transition-colors hover:border-accent hover:text-accent',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <Plus className="h-5 w-5" />
        <span className="text-xs">Лист</span>
      </button>
    </div>
  );
});
