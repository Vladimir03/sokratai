/**
 * Канонический просмотрщик фото кабинета (волна 1, план 1-ancient-quokka).
 *
 * До него в проекте было четыре независимых копии одной карусели и с полдюжины
 * мест, где «увеличить» означало открыть сырую вкладку браузера. Ни одна не
 * умела ни зум, ни панораму, ни поворот — отсюда джоб Ульяны U22 «его нельзя
 * развернуть, приходится копировать».
 *
 * ⚠️ Radix напрямую, а не `components/ui/dialog`: тот центрирует контент в
 * `max-w-lg max-h-[85vh]` и рисует свою кнопку закрытия. Просмотрщику нужен
 * настоящий полный экран с safe-area. Фокус-ловушка, Esc и блокировка скролла
 * приходят от того же примитива (waiver того же класса, что SubmitSheet,
 * rule 90).
 *
 * ⚠️ `100dvh`, а не `100vh` (rule 80): на iOS адресная строка Safari съедает
 * низ, и нижняя панель с действиями уезжала бы под неё.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  RotateCcw,
  RotateCw,
  X,
} from 'lucide-react';
import { type PhotoDegrees, storageRefFromUrl } from '@/lib/photoOrientation';
import { type PhotoSurface, trackPhotoEvent } from '@/lib/photoViewerTelemetry';
import { usePhotoOrientations } from '@/hooks/usePhotoOrientation';
import { SafeImage } from './SafeImage';
import { useViewerGestures } from './useViewerGestures';
import { type Size, baseImageSize } from './viewerCamera';

export interface PhotoViewerItem {
  /** Готовая ссылка для `<img>`: signed URL, blob или data. */
  url: string;
  /**
   * `storage://<bucket>/<path>` — ключ поворота. Без него поворот доступен
   * только в пределах открытого окна и никуда не сохраняется.
   */
  ref?: string | null;
  /** Подпись в шапке: «Решение ученика · Задача 3». Отвечает на «что я смотрю». */
  caption?: string;
  alt?: string;
}

export interface PhotoViewerProps {
  items: PhotoViewerItem[];
  openIndex: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  surface: PhotoSurface;
  /**
   * Показывать кнопки поворота. Ставится на репетиторских поверхностях;
   * настоящий гейт — в `photo_orientations_set` (fail-closed), это лишь UI.
   */
  canRotate?: boolean;
  /** Волна 2: «Показать ошибку» / «Разобрать на доске». */
  footerActions?: React.ReactNode;
  ariaTitle?: string;
  ariaDescription?: string;
}

const ICON_BUTTON =
  'grid h-11 w-11 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-30';

export const PhotoViewer = memo(function PhotoViewer({
  items,
  openIndex,
  onClose,
  onNavigate,
  surface,
  canRotate = false,
  footerActions,
  ariaTitle = 'Просмотр фото',
  ariaDescription = 'Фото можно повернуть, увеличить и рассмотреть целиком',
}: PhotoViewerProps) {
  const isOpen = openIndex !== null && openIndex >= 0 && openIndex < items.length;
  const current = isOpen ? items[openIndex] : null;

  // Явный ref, а иначе — восстановленный из подписанной ссылки. Так поворот
  // сохраняется и там, где бэкенд отдаёт только URL (пробники, материалы).
  const refs = useMemo(
    () => items.map((item) => item.ref ?? storageRefFromUrl(item.url)),
    [items],
  );
  const { orientations, rotate } = usePhotoOrientations(refs, { enabled: isOpen });

  const [naturalSizes, setNaturalSizes] = useState<Record<string, Size>>({});
  const [localDegrees, setLocalDegrees] = useState<Record<string, PhotoDegrees>>({});

  const currentKey = current?.url ?? '';
  const currentRef = openIndex !== null ? refs[openIndex] ?? null : null;
  const natural = naturalSizes[currentKey] ?? null;

  // Поворот с сохранением там, где есть ref; иначе — в пределах окна.
  const degrees: PhotoDegrees = currentRef
    ? orientations[currentRef] ?? 0
    : localDegrees[currentKey] ?? 0;

  const canGoPrev = isOpen && openIndex > 0;
  const canGoNext = isOpen && openIndex < items.length - 1;

  const goPrev = useCallback(() => {
    if (openIndex !== null && openIndex > 0) onNavigate(openIndex - 1);
  }, [onNavigate, openIndex]);

  const goNext = useCallback(() => {
    if (openIndex !== null && openIndex < items.length - 1) onNavigate(openIndex + 1);
  }, [items.length, onNavigate, openIndex]);

  const handleSwipe = useCallback(
    (direction: 'prev' | 'next') => {
      if (direction === 'next') goNext();
      else goPrev();
    },
    [goNext, goPrev],
  );

  const {
    containerRef,
    stageRef,
    isZoomed,
    containerSize,
    zoomBy,
    reset,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = useViewerGestures({
    natural,
    degrees,
    onSwipe: handleSwipe,
    swipeEnabled: items.length > 1,
  });

  // Стабильная ссылка: SafeImage дочитывает размеры в эффекте, зависящем от
  // этого колбэка, и инлайновая стрелка гоняла бы эффект на каждый рендер.
  const handleNaturalSize = useCallback(
    (size: Size) => {
      if (!currentKey) return;
      setNaturalSizes((prev) => {
        const existing = prev[currentKey];
        if (existing && existing.width === size.width && existing.height === size.height) {
          return prev;
        }
        return { ...prev, [currentKey]: size };
      });
    },
    [currentKey],
  );

  const handleRotate = useCallback(
    (delta: number) => {
      if (currentRef) {
        rotate(currentRef, delta);
      } else {
        setLocalDegrees((prev) => {
          const next = (((((prev[currentKey] ?? 0) + delta) % 360) + 360) % 360) as PhotoDegrees;
          return { ...prev, [currentKey]: next };
        });
      }
      trackPhotoEvent('photo_rotated', {
        surface,
        degrees: delta,
        persisted: Boolean(currentRef),
      });
    },
    [currentKey, currentRef, rotate, surface],
  );

  // ─── Телеметрия открытия: одно событие на открытие, не на каждое листание ──

  const openTrackedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      openTrackedRef.current = false;
      return;
    }
    if (openTrackedRef.current) return;
    openTrackedRef.current = true;
    trackPhotoEvent('photo_viewer_opened', { surface, count: items.length });
  }, [isOpen, items.length, surface]);

  // ─── Клавиатура ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Esc остаётся за Radix.
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          goPrev();
          break;
        case 'ArrowRight':
          event.preventDefault();
          goNext();
          break;
        case '+':
        case '=':
          event.preventDefault();
          zoomBy(1.4);
          break;
        case '-':
        case '_':
          event.preventDefault();
          zoomBy(1 / 1.4);
          break;
        case '0':
          event.preventDefault();
          reset();
          break;
        case 'r':
        case 'R':
        case 'к':
        case 'К':
          if (!canRotate) break;
          event.preventDefault();
          handleRotate(event.shiftKey ? -90 : 90);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canRotate, goNext, goPrev, handleRotate, isOpen, reset, zoomBy]);

  // Список схлопнулся под нами (например, фото удалили) — закрываемся.
  useEffect(() => {
    if (openIndex !== null && (items.length === 0 || openIndex >= items.length)) {
      onClose();
    }
  }, [items.length, onClose, openIndex]);

  // Соседние фото прогреваем, чтобы листание не упиралось в сеть.
  useEffect(() => {
    if (!isOpen) return;
    for (const offset of [-1, 1]) {
      const neighbour = items[openIndex + offset];
      if (!neighbour) continue;
      const img = new Image();
      img.src = neighbour.url;
    }
  }, [isOpen, items, openIndex]);

  const imageStyle = useMemo(() => {
    if (!natural || containerSize.width === 0) {
      // Резервный режим до того, как известны натуральные размеры. Проценты
      // тут ненадёжны (`max-height: 100%` у grid-элемента не всегда даёт
      // определённую базу и картинка вылезает за сцену), поэтому растягиваем
      // на всю сцену и полагаемся на object-contain.
      return {
        position: 'absolute' as const,
        inset: 0,
        width: '100%',
        height: '100%',
        transform: `rotate(${degrees}deg)`,
      };
    }
    const base = baseImageSize(natural, containerSize, degrees);
    return {
      width: `${base.width}px`,
      height: `${base.height}px`,
      // Поворот живёт на самой картинке: сцена сверху отвечает за зум и
      // панораму, и смешивать их в один transform значило бы пересчитывать
      // клампы в повёрнутой системе координат.
      transform: `rotate(${degrees}deg)`,
      transition: 'transform 150ms ease-out',
    };
  }, [containerSize, degrees, natural]);

  const caption = current?.caption ?? ariaTitle;

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-slate-950/95 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[70] flex flex-col outline-none"
          style={{
            height: '100dvh',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <DialogPrimitive.Title className="sr-only">{ariaTitle}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {ariaDescription}
          </DialogPrimitive.Description>

          {/* ─── Шапка ─────────────────────────────────────────────────── */}
          <header className="flex shrink-0 items-center gap-2 px-2 py-1.5 sm:px-4">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">{caption}</p>

            {canRotate ? (
              <>
                <button
                  type="button"
                  className={ICON_BUTTON}
                  onClick={() => handleRotate(-90)}
                  aria-label="Повернуть против часовой стрелки"
                  title="Повернуть влево (R с Shift)"
                  style={{ touchAction: 'manipulation' }}
                >
                  <RotateCcw className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={ICON_BUTTON}
                  onClick={() => handleRotate(90)}
                  aria-label="Повернуть по часовой стрелке"
                  title="Повернуть вправо (R)"
                  style={{ touchAction: 'manipulation' }}
                >
                  <RotateCw className="h-5 w-5" aria-hidden="true" />
                </button>
              </>
            ) : null}

            {isZoomed ? (
              <button
                type="button"
                className={ICON_BUTTON}
                onClick={reset}
                aria-label="Показать фото целиком"
                title="Вписать в экран (0)"
                style={{ touchAction: 'manipulation' }}
              >
                <Maximize2 className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : null}

            {current ? (
              <a
                href={current.url}
                download={current.alt ?? 'photo'}
                rel="noreferrer"
                className={ICON_BUTTON}
                aria-label="Скачать фото"
                title="Скачать"
                style={{ touchAction: 'manipulation' }}
              >
                <Download className="h-5 w-5" aria-hidden="true" />
              </a>
            ) : null}

            <DialogPrimitive.Close
              className={ICON_BUTTON}
              aria-label="Закрыть просмотр фото"
              style={{ touchAction: 'manipulation' }}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>

          {/* ─── Сцена ─────────────────────────────────────────────────── */}
          <div
            ref={containerRef}
            className="relative min-h-0 flex-1 overflow-hidden"
            // touch-action: none обязателен — иначе браузер сам съедает
            // панораму и пинч, и жесты до нас не доходят.
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div
              ref={stageRef}
              className="absolute inset-0 grid place-items-center"
              style={{ willChange: 'transform' }}
            >
              {current ? (
                <SafeImage
                  key={current.url}
                  src={current.url}
                  alt={current.alt ?? caption}
                  loading="eager"
                  draggable={false}
                  className="select-none object-contain"
                  style={imageStyle}
                  onNaturalSize={handleNaturalSize}
                  fallbackClassName="inline-flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
                />
              ) : null}
            </div>

            {items.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={!canGoPrev}
                  aria-label="Предыдущее фото"
                  style={{ touchAction: 'manipulation' }}
                  className={`absolute left-2 top-1/2 -translate-y-1/2 bg-slate-950/40 ${ICON_BUTTON}`}
                >
                  <ChevronLeft className="h-6 w-6" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canGoNext}
                  aria-label="Следующее фото"
                  style={{ touchAction: 'manipulation' }}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 bg-slate-950/40 ${ICON_BUTTON}`}
                >
                  <ChevronRight className="h-6 w-6" aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>

          {/* ─── Низ ───────────────────────────────────────────────────── */}
          <footer className="flex shrink-0 items-center justify-center gap-3 px-4 py-2">
            {items.length > 1 && openIndex !== null ? (
              <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white/80">
                {openIndex + 1} / {items.length}
              </span>
            ) : null}
            {footerActions}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
});

PhotoViewer.displayName = 'PhotoViewer';
