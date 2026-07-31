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
  /**
   * Отправка размеченной картинки СУЩЕСТВУЮЩИМ путём сообщений треда.
   * `caption` — необязательная подпись «что исправить».
   */
  onSend: (file: File, caption: string) => Promise<void>;
  /** «Нужно больше места» — продолжить разбор на доске. */
  onSendToBoard?: () => void;
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
  onSendToBoard,
}: PhotoAnnotateSheetProps) {
  const [caption, setCaption] = useState('');
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [tool, setTool] = useState<AnnotateTool>('pen');
  const [color, setColor] = useState<string>(DEFAULT_ANNOTATE_COLOR);
  const [sizeIndex, setSizeIndex] = useState(1);
  const [isSending, setIsSending] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);

  const historyRef = useRef(new SceneHistory());
  const startedAtRef = useRef<number>(0);
  const usedToolsRef = useRef<Set<string>>(new Set());
  /** Черновик прочитан — до этого писать в хранилище нельзя (см. эффект ниже). */
  const hydratedRef = useRef(false);

  const key = draftKey(photoRef);

  // ─── Черновик ──────────────────────────────────────────────────────────────
  //
  // ⚠️ Прямой ответ на страх Ульяны (U17): «столько времени переводить все
  // домашки, и если вдруг будет зависать — это прямо катастрофа». Случайно
  // закрытая вкладка не должна стоить репетитору разбора.

  useEffect(() => {
    if (!open) {
      hydratedRef.current = false;
      return;
    }
    startedAtRef.current = Date.now();
    usedToolsRef.current = new Set();
    trackPhotoEvent('photo_annotate_started', { surface });

    let restored: BoardElement[] = [];
    if (key) {
      try {
        const saved = window.sessionStorage.getItem(key);
        restored = saved ? parseElements(JSON.parse(saved)) : [];
      } catch {
        // Битый черновик — не повод не дать разметить заново.
        restored = [];
      }
    }
    setElements(restored);
    if (restored.length > 0) {
      toast.info('Восстановили незаконченную разметку');
    }
    hydratedRef.current = true;
  }, [key, open, surface]);

  /**
   * ⚠️ Пишем только ПОСЛЕ гидратации.
   *
   * Оба эффекта срабатывают в одном цикле, и этот видел бы ещё пустой
   * `elements` из прошлого рендера — то есть стирал бы только что прочитанный
   * черновик. Флаг разрывает эту гонку.
   */
  useEffect(() => {
    if (!open || !key || !hydratedRef.current) return;
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

  const clearDraft = useCallback(() => {
    historyRef.current.forget(HISTORY_KEY);
    if (key) {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        /* не критично */
      }
    }
    setElements([]);
  }, [key]);

  /**
   * Крестик = «закрыть, работу оставить».
   *
   * ⚠️ Раньше и крестик, и «Отмена» вели в discard, и черновик стирался молча —
   * то есть обещание «труд не потеряется» (страх Ульяны U17) не выполнялось
   * ни в одном сценарии, кроме падения вкладки. Закрытие обязано быть
   * безопасным действием.
   */
  const closeKeepingDraft = useCallback(() => {
    if (elements.length > 0 && key) {
      toast.info('Пометки сохранены — можно вернуться и дорисовать');
    }
    onClose();
  }, [elements.length, key, onClose]);

  /** «Отмена» = выбросить. С подтверждением, когда есть что терять. */
  const discard = useCallback(() => {
    if (elements.length > 0) {
      const confirmed = window.confirm('Удалить пометки? Их нельзя будет вернуть.');
      if (!confirmed) return;
    }
    trackPhotoEvent('photo_annotate_discarded', { surface });
    clearDraft();
    onClose();
  }, [clearDraft, elements.length, onClose, surface]);

  const handleSend = useCallback(async () => {
    if (isSending) return;
    if (elements.length === 0) {
      toast.error('Сначала отметьте, где ошибка.');
      return;
    }
    setIsSending(true);
    try {
      const file = await renderAnnotatedPhoto({ photoUrl, degrees, elements });
      await onSend(file, caption.trim());
      trackPhotoEvent('photo_annotate_sent', {
        surface,
        strokes: elements.length,
        tools: Array.from(usedToolsRef.current).sort().join(','),
        duration_ms: Date.now() - startedAtRef.current,
        has_caption: caption.trim().length > 0,
      });
      setCaption('');
      clearDraft();
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
  }, [caption, clearDraft, degrees, elements, isSending, onClose, onSend, photoUrl, surface]);

  return (
    // Esc и системное закрытие тоже СОХРАНЯЮТ черновик — выбросить работу
    // можно только явной «Отменой».
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => (!next ? closeKeepingDraft() : undefined)}
    >
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
              onClick={closeKeepingDraft}
              aria-label="Закрыть — пометки сохранятся"
              title="Закрыть. Пометки сохранятся, можно вернуться"
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

          <footer className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2">
            {/* Пометка отвечает на «где», подпись — на «что». Именно вторая
                половина работает на метрику «ученик исправил ошибку», поэтому
                поле стоит на пути отправки. Необязательное: обязательность
                убила бы быстрые обводки, ради которых фичу и делали. */}
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Что исправить? Например: проверь коэффициент перед H₂O"
              aria-label="Что исправить — короткая подпись ученику"
              disabled={isSending}
              // 16 px — иначе iOS зумит форму при фокусе (rule 80).
              className="h-11 min-w-0 flex-1 rounded-lg border border-white/20 bg-white/10 px-3 text-base text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none disabled:opacity-40"
            />
            {onSendToBoard ? (
              <button
                type="button"
                onClick={() => {
                  closeKeepingDraft();
                  onSendToBoard();
                }}
                disabled={isSending}
                style={{ touchAction: 'manipulation' }}
                className="h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                Нужно больше места
              </button>
            ) : null}
            <button
              type="button"
              onClick={discard}
              disabled={isSending}
              style={{ touchAction: 'manipulation' }}
              className="h-11 shrink-0 rounded-lg px-4 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
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
