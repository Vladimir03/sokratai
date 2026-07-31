/**
 * Полноэкранная разметка фото ученика (волна 2, план 1-ancient-quokka).
 *
 * Джоб Ульяны U21: «показать ученику, ГДЕ он ошибся, прямо на его фото». Раньше
 * это делалось руками — вырезать фрагмент, развернуть, вынести на доску,
 * отправить. Здесь весь путь — обвёл и отправил, не покидая проверки ДЗ.
 *
 * ⚠️ Лист НЕ отправляет сам. Он собирает JPEG и отдаёт его наружу через
 * `onSend`, а отправкой занимается уже существующий путь сообщений треда
 * (`uploadTutorHomeworkTaskImage` + `postTutorThreadMessage`). Второй write-path
 * к `homework_tutor_thread_messages` заводить нельзя (rule 40).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { type BoardElement, parseElements } from '@/lib/whiteboard/model';
import { SceneHistory } from '@/lib/whiteboard/sceneHistory';
import { type PhotoDegrees } from '@/lib/photoOrientation';
import { type PhotoSurface, trackPhotoEvent } from '@/lib/photoViewerTelemetry';
import { AnnotateCanvas } from './AnnotateCanvas';
import {
  type AnnotateTool,
  AnnotateToolbar,
  DEFAULT_ANNOTATE_COLOR,
} from './AnnotateToolbar';
import { AnnotatedPhotoError, renderAnnotatedPhoto } from './renderAnnotatedPhoto';

/** Единственный «лист» в истории — разметка живёт для одного фото. */
const HISTORY_KEY = 'photo';
const DRAFT_PREFIX = 'sokrat:photo-annotate:';

export interface PhotoAnnotateSheetProps {
  open: boolean;
  photoUrl: string;
  /** Ключ черновика. Без него черновик просто не сохраняется. */
  photoRef?: string | null;
  degrees: PhotoDegrees;
  surface: PhotoSurface;
  onClose: () => void;
  /** Отправка размеченной картинки СУЩЕСТВУЮЩИМ путём сообщений треда. */
  onSend: (file: File) => Promise<void>;
}

function draftKey(photoRef: string | null | undefined): string | null {
  return photoRef ? `${DRAFT_PREFIX}${photoRef}` : null;
}

export function PhotoAnnotateSheet({
  open,
  photoUrl,
  photoRef,
  degrees,
  surface,
  onClose,
  onSend,
}: PhotoAnnotateSheetProps) {
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [tool, setTool] = useState<AnnotateTool>('pen');
  const [color, setColor] = useState<string>(DEFAULT_ANNOTATE_COLOR);
  const [sizeIndex, setSizeIndex] = useState(1);
  const [isSending, setIsSending] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);

  const historyRef = useRef(new SceneHistory());
  const startedAtRef = useRef<number>(0);
  const usedToolsRef = useRef<Set<string>>(new Set());

  const key = draftKey(photoRef);

  // ─── Черновик ──────────────────────────────────────────────────────────────
  //
  // ⚠️ Прямой ответ на страх Ульяны (U17): «столько времени переводить все
  // домашки, и если вдруг будет зависать — это прямо катастрофа». Случайно
  // закрытая вкладка не должна стоить репетитору разбора.

  useEffect(() => {
    if (!open) return;
    startedAtRef.current = Date.now();
    usedToolsRef.current = new Set();
    trackPhotoEvent('photo_annotate_started', { surface });

    if (!key) {
      setElements([]);
      return;
    }
    try {
      const saved = window.sessionStorage.getItem(key);
      setElements(saved ? parseElements(JSON.parse(saved)) : []);
    } catch {
      // Битый черновик — не повод не дать разметить заново.
      setElements([]);
    }
  }, [key, open, surface]);

  useEffect(() => {
    if (!open || !key) return;
    try {
      if (elements.length === 0) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, JSON.stringify(elements));
    } catch {
      // Переполнение хранилища не должно ронять разметку.
    }
  }, [elements, key, open]);

  // ─── История ───────────────────────────────────────────────────────────────

  const applyWithHistory = useCallback((next: (prev: BoardElement[]) => BoardElement[]) => {
    setElements((prev) => {
      historyRef.current.push(HISTORY_KEY, prev);
      return next(prev);
    });
    setHistoryTick((tick) => tick + 1);
  }, []);

  const handleCommit = useCallback(
    (element: BoardElement) => {
      usedToolsRef.current.add(element.type === 'shape' ? element.kind : element.type);
      applyWithHistory((prev) => [...prev, element]);
    },
    [applyWithHistory],
  );

  const handleErase = useCallback(
    (ids: string[]) => {
      const removed = new Set(ids);
      usedToolsRef.current.add('eraser');
      applyWithHistory((prev) => prev.filter((el) => !removed.has(el.id)));
    },
    [applyWithHistory],
  );

  const handleUndo = useCallback(() => {
    setElements((prev) => historyRef.current.undo(HISTORY_KEY, prev) ?? prev);
    setHistoryTick((tick) => tick + 1);
  }, []);

  const handleRedo = useCallback(() => {
    setElements((prev) => historyRef.current.redo(HISTORY_KEY, prev) ?? prev);
    setHistoryTick((tick) => tick + 1);
  }, []);

  const canUndo = useMemo(
    () => historyRef.current.canUndo(HISTORY_KEY),
    // historyTick — единственный способ узнать о смене состояния класса.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historyTick],
  );
  const canRedo = useMemo(
    () => historyRef.current.canRedo(HISTORY_KEY),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historyTick],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) handleRedo();
      else handleUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleRedo, handleUndo, open]);

  // ─── Выход и отправка ──────────────────────────────────────────────────────

  const discard = useCallback(() => {
    trackPhotoEvent('photo_annotate_discarded', { surface });
    historyRef.current.forget(HISTORY_KEY);
    if (key) {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        /* не критично */
      }
    }
    setElements([]);
    onClose();
  }, [key, onClose, surface]);

  const handleSend = useCallback(async () => {
    if (isSending) return;
    if (elements.length === 0) {
      toast.error('Сначала отметьте, где ошибка.');
      return;
    }
    setIsSending(true);
    try {
      const file = await renderAnnotatedPhoto({ photoUrl, degrees, elements });
      await onSend(file);
      trackPhotoEvent('photo_annotate_sent', {
        surface,
        strokes: elements.length,
        tools: Array.from(usedToolsRef.current).sort().join(','),
        duration_ms: Date.now() - startedAtRef.current,
      });
      historyRef.current.forget(HISTORY_KEY);
      if (key) {
        try {
          window.sessionStorage.removeItem(key);
        } catch {
          /* не критично */
        }
      }
      setElements([]);
      onClose();
    } catch (error) {
      const message =
        error instanceof AnnotatedPhotoError || error instanceof Error
          ? error.message
          : 'Не удалось отправить разметку.';
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  }, [degrees, elements, isSending, key, onClose, onSend, photoUrl, surface]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-slate-950/95" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[80] flex flex-col outline-none"
          style={{
            height: '100dvh',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
          // Рисование не должно закрывать лист по «клику мимо».
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">
            Показать ошибку на фото
          </DialogPrimitive.Title>

          <header className="flex shrink-0 items-center gap-2 px-2 py-1.5 sm:px-4">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">
              Отметьте, где ошибка
            </p>
            <button
              type="button"
              onClick={discard}
              aria-label="Закрыть разметку"
              style={{ touchAction: 'manipulation' }}
              className="grid h-11 w-11 place-items-center rounded-full text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
            {/* На планшете панель снизу — иначе она под ладонью пишущей руки. */}
            <div className="shrink-0 border-t border-white/10 md:border-r md:border-t-0">
              <AnnotateToolbar
                tool={tool}
                onToolChange={setTool}
                color={color}
                onColorChange={setColor}
                sizeIndex={sizeIndex}
                onSizeChange={setSizeIndex}
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={canUndo}
                canRedo={canRedo}
              />
            </div>

            <div className="min-h-0 flex-1">
              {open ? (
                <AnnotateCanvas
                  photoUrl={photoUrl}
                  degrees={degrees}
                  elements={elements}
                  tool={tool}
                  color={color}
                  sizeIndex={sizeIndex}
                  onCommit={handleCommit}
                  onErase={handleErase}
                />
              ) : null}
            </div>
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 px-4 py-2">
            <button
              type="button"
              onClick={discard}
              disabled={isSending}
              style={{ touchAction: 'manipulation' }}
              className="h-11 rounded-lg px-4 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={isSending}
              style={{ touchAction: 'manipulation' }}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {isSending ? 'Отправляем…' : 'Отправить ученику'}
            </button>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
