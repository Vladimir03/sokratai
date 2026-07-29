import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Download, Loader2, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BoardCanvas, type BoardTool } from '@/components/whiteboard/BoardCanvas';
import { BoardToolbar } from '@/components/whiteboard/BoardToolbar';
import { PagesPanel } from '@/components/whiteboard/PagesPanel';
import {
  type Board,
  type BoardPageRow,
  WhiteboardApiError,
  createBoardPage,
  deleteBoardPage,
  getBoard,
  getOrCreateLessonBoard,
  saveBoardPage,
  updateBoard,
} from '@/lib/whiteboardApi';
import {
  type BoardElement,
  type BoardBackground,
  type BoardGridMm,
  BOARD_COLORS,
  DEFAULT_PEN_SIZE_MM,
  DEFAULT_TEXT_SIZE_MM,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  createText,
  normalizeBackground,
  normalizeGridMm,
  parseElements,
  primeSeqCounter,
  translateElement,
} from '@/lib/whiteboard/model';
import { deleteMaterial, uploadLessonPdf } from '@/lib/lessonMaterialsApi';

// Страница доски (Фаза 1, пересборка по ревью 5.6). Доска однопользовательская:
// передача мела — Фаза 2.
//
// Инварианты (не ломать):
// • Данные грузятся вручную (useEffect + useState), а НЕ через useQuery: на
//   холсте лежит несохранённый рукописный ввод, фоновый refetch по фокусу его
//   затёр бы (класс инцидента tab-switch, smoke-check §8).
// • Автосохранение — SINGLE-FLIGHT: одновременно максимум один сетевой цикл,
//   очередь дренится до конца, при ошибке страницы возвращаются в очередь и
//   ретраятся. Иначе два параллельных сейва могли записать старую сцену поверх
//   новой (ревью 5.6, P0).
// • «Сохранено» показывается ТОЛЬКО при пустой очереди без ошибок. Ошибка —
//   явная и кликабельная.
// • PDF-модуль (jsPDF + svg2pdf, ~200 КБ gzip) грузится динамически по первому
//   экспорту — открытие доски не должно тянуть движок печати (ревью 5.6, P1).
// • Все правки сцены и истории происходят в обработчиках событий, ВНЕ
//   setState-updater'ов (updater обязан быть чистым, StrictMode зовёт его дважды).

const AUTOSAVE_DELAY_MS = 900;
const SAVE_RETRY_DELAY_MS = 5000;
const HISTORY_LIMIT = 60;

interface PageState {
  id: string;
  elements: BoardElement[];
  background: BoardBackground;
  gridMm: BoardGridMm;
}

interface HistoryEntry {
  past: BoardElement[][];
  future: BoardElement[][];
}

interface TextDraft {
  id: number;
  x: number;
  y: number;
  value: string;
}

type SaveStatus = 'saved' | 'saving' | 'error';

function rowToPageState(row: BoardPageRow): PageState {
  const elements = parseElements(row.elements);
  primeSeqCounter(elements);
  return {
    id: row.id,
    elements,
    background: normalizeBackground(row.background),
    gridMm: normalizeGridMm(row.grid_mm),
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

let textDraftSeq = 0;

export default function Whiteboard() {
  const params = useParams<{ boardId?: string; lessonId?: string }>();
  const navigate = useNavigate();

  const [board, setBoard] = useState<Board | null>(null);
  const [pages, setPages] = useState<PageState[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Раздельные фазы занятости: общий `busy` показывал спиннер экспорта на
  // кнопке прикрепления и наоборот (ревью 5.6).
  const [pageBusy, setPageBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [exitPhase, setExitPhase] = useState<null | 'saving' | 'attaching'>(null);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [saveTick, setSaveTick] = useState(0);

  const [tool, setTool] = useState<BoardTool>('pen');
  const [color, setColor] = useState<string>(BOARD_COLORS[0]);
  const [size, setSize] = useState<number>(DEFAULT_PEN_SIZE_MM);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);

  const historyRef = useRef<Map<string, HistoryEntry>>(new Map());
  const [historyTick, setHistoryTick] = useState(0);
  const dirtyRef = useRef<Set<string>>(new Set());
  const flushPromiseRef = useRef<Promise<boolean> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pagesRef = useRef<PageState[]>([]);
  const textDraftRef = useRef<TextDraft | null>(null);
  const savedTitleRef = useRef<string>('');
  /** Снимок, отправленный в последний экспорт, — чтобы не плодить одинаковые PDF. */
  const exportedSignatureRef = useRef<string | null>(null);

  // Синхронизация зеркал — ПОСЛЕ коммита, не в теле рендера (ревью 5.6, P2:
  // в concurrent-режиме рендер может не закоммититься, и автосейв прочитал бы
  // сцену, которой пользователь не видел).
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  useEffect(() => {
    textDraftRef.current = textDraft;
  }, [textDraft]);

  const activePage = pages[activeIndex] ?? null;

  // ─── Загрузка ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const load = params.lessonId
      ? getOrCreateLessonBoard(params.lessonId)
      : params.boardId
        ? getBoard(params.boardId)
        : Promise.reject(new WhiteboardApiError('Доска не указана', 'NO_BOARD'));

    load
      .then((data) => {
        if (cancelled) return;
        setBoard(data.board);
        savedTitleRef.current = data.board.title ?? '';
        const next = data.pages.map(rowToPageState);
        setPages(next.length > 0 ? next : []);
        setActiveIndex(0);
        // Адрес приводим к каноническому: перезагрузка по /lesson/:id иначе
        // каждый раз заново резолвила бы доску.
        if (params.lessonId) {
          navigate(`/tutor/board/${data.board.id}`, { replace: true });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Не удалось открыть доску');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [params.boardId, params.lessonId, navigate]);

  // ─── Автосохранение: single-flight ──────────────────────────────────────────

  /**
   * Дренит очередь грязных страниц до конца. Возвращает true, когда всё
   * сохранено. Повторный вызов во время работы возвращает ТОТ ЖЕ promise —
   * второго параллельного цикла не бывает, поэтому более старый снапшот не
   * может перезаписать более новый (ревью 5.6, P0).
   */
  const flushDirty = useCallback((): Promise<boolean> => {
    if (flushPromiseRef.current) return flushPromiseRef.current;
    if (dirtyRef.current.size === 0) return Promise.resolve(true);

    const run = (async () => {
      setSaveStatus('saving');
      try {
        while (dirtyRef.current.size > 0) {
          const ids = Array.from(dirtyRef.current);
          dirtyRef.current = new Set();
          for (let i = 0; i < ids.length; i++) {
            const page = pagesRef.current.find((p) => p.id === ids[i]);
            if (!page) continue;
            try {
              // Последовательно: параллельный залп на плохой сети (RU DPI,
              // rule 95) повышает шанс частичной потери.
              await saveBoardPage(page.id, {
                elements: page.elements,
                background: page.background,
                grid_mm: page.gridMm,
              });
            } catch (err) {
              // Несохранённое возвращается в очередь целиком — терять молча нельзя.
              for (let j = i; j < ids.length; j++) dirtyRef.current.add(ids[j]);
              throw err;
            }
          }
        }
        setSaveStatus('saved');
        return true;
      } catch {
        setSaveStatus('error');
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => setSaveTick((t) => t + 1), SAVE_RETRY_DELAY_MS);
        return false;
      } finally {
        flushPromiseRef.current = null;
      }
    })();

    flushPromiseRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (saveTick === 0) return;
    const timer = setTimeout(() => {
      void flushDirty();
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [saveTick, flushDirty]);

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      // Уход со страницы — последняя best-effort попытка (плюс beforeunload ниже).
      void flushDirty();
    },
    [flushDirty],
  );

  // Закрытие вкладки с несохранённым — браузерное предупреждение (ревью 5.6, P0).
  useEffect(() => {
    if (saveStatus === 'saved') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveStatus]);

  const noteDirty = useCallback((pageId: string) => {
    dirtyRef.current.add(pageId);
    setSaveStatus((prev) => (prev === 'error' ? 'error' : 'saving'));
    setSaveTick((t) => t + 1);
  }, []);

  // ─── Правки сцены (все — в обработчиках, вне updater'ов) ────────────────────

  const pushHistory = useCallback((pageId: string, snapshot: BoardElement[]) => {
    const entry = historyRef.current.get(pageId) ?? { past: [], future: [] };
    // Дедуп по ссылке: burst-операции (ластик за один жест) дают серию вызовов
    // с одним и тем же committed-снапшотом — в истории он нужен один раз.
    if (entry.past[entry.past.length - 1] === snapshot) return;
    entry.past.push(snapshot);
    if (entry.past.length > HISTORY_LIMIT) entry.past.shift();
    entry.future = [];
    historyRef.current.set(pageId, entry);
    setHistoryTick((t) => t + 1);
  }, []);

  const updateActiveElements = useCallback(
    (updater: (elements: BoardElement[]) => BoardElement[], recordHistory = true) => {
      const page = pagesRef.current[activeIndex];
      if (!page) return;
      if (recordHistory) pushHistory(page.id, page.elements);
      noteDirty(page.id);
      setPages((prev) => {
        const idx = prev.findIndex((p) => p.id === page.id);
        if (idx < 0) return prev;
        const current = prev[idx];
        const nextElements = updater(current.elements);
        if (nextElements === current.elements) return prev;
        const copy = prev.slice();
        copy[idx] = { ...current, elements: nextElements };
        return copy;
      });
    },
    [activeIndex, noteDirty, pushHistory],
  );

  const handleCommitElement = useCallback(
    (element: BoardElement) => {
      updateActiveElements((elements) => [...elements, element]);
    },
    [updateActiveElements],
  );

  const handleEraseElements = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const removal = new Set(ids);
      updateActiveElements((elements) => elements.filter((el) => !removal.has(el.id)));
    },
    [updateActiveElements],
  );

  /** Один вызов на жест (BoardCanvas коммитит на pointerup) → нормальная запись в историю. */
  const handleMoveSelection = useCallback(
    (dx: number, dy: number) => {
      if ((dx === 0 && dy === 0) || selectedIds.length === 0) return;
      const moving = new Set(selectedIds);
      updateActiveElements((elements) =>
        elements.map((el) => (moving.has(el.id) ? translateElement(el, dx, dy) : el)),
      );
    },
    [selectedIds, updateActiveElements],
  );

  const handleUndo = useCallback(() => {
    const page = pagesRef.current[activeIndex];
    if (!page) return;
    const entry = historyRef.current.get(page.id);
    if (!entry || entry.past.length === 0) return;
    const previous = entry.past.pop() as BoardElement[];
    entry.future.push(page.elements);
    setHistoryTick((t) => t + 1);
    noteDirty(page.id);
    setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, elements: previous } : p)));
  }, [activeIndex, noteDirty]);

  const handleRedo = useCallback(() => {
    const page = pagesRef.current[activeIndex];
    if (!page) return;
    const entry = historyRef.current.get(page.id);
    if (!entry || entry.future.length === 0) return;
    const next = entry.future.pop() as BoardElement[];
    entry.past.push(page.elements);
    setHistoryTick((t) => t + 1);
    noteDirty(page.id);
    setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, elements: next } : p)));
  }, [activeIndex, noteDirty]);

  const historyState = useMemo(() => {
    void historyTick;
    const entry = activePage ? historyRef.current.get(activePage.id) : undefined;
    return { canUndo: (entry?.past.length ?? 0) > 0, canRedo: (entry?.future.length ?? 0) > 0 };
  }, [activePage, historyTick]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      // Ctrl+Z в поле названия или в текстовом черновике должен править ТЕКСТ,
      // а не отменять действия на холсте (ревью 5.6, P1).
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  // ─── Разлиновка ─────────────────────────────────────────────────────────────

  const patchActivePage = useCallback(
    (patch: Partial<Pick<PageState, 'background' | 'gridMm'>>) => {
      const page = pagesRef.current[activeIndex];
      if (!page) return;
      noteDirty(page.id);
      setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, ...patch } : p)));
    },
    [activeIndex, noteDirty],
  );

  // ─── Страницы ───────────────────────────────────────────────────────────────

  const handleAddPage = useCallback(async () => {
    if (!board || pageBusy) return;
    setPageBusy(true);
    try {
      await flushDirty();
      const created = await createBoardPage(board.id, {
        background: activePage?.background ?? 'grid',
        grid_mm: activePage?.gridMm ?? 5,
      });
      setPages((prev) => [...prev, rowToPageState(created)]);
      setActiveIndex(pagesRef.current.length);
      setSelectedIds([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось добавить страницу');
    } finally {
      setPageBusy(false);
    }
  }, [board, pageBusy, flushDirty, activePage]);

  const handleDeletePage = useCallback(
    async (index: number) => {
      const page = pagesRef.current[index];
      if (!page || pageBusy) return;
      // Подтверждение обязательно: случайное касание стилусом маленькой кнопки
      // удаляло страницу с целым конспектом без возможности отмены (ревью 5.6, P0).
      const count = page.elements.length;
      const message =
        count > 0
          ? `Удалить страницу ${index + 1}? На ней ${count} объект(ов) — отменить удаление будет нельзя.`
          : `Удалить пустую страницу ${index + 1}?`;
      if (!window.confirm(message)) return;
      setPageBusy(true);
      try {
        await deleteBoardPage(page.id);
        historyRef.current.delete(page.id);
        dirtyRef.current.delete(page.id);
        setPages((prev) => prev.filter((_, i) => i !== index));
        setActiveIndex((prev) => Math.max(0, Math.min(prev, pagesRef.current.length - 2)));
        setSelectedIds([]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось удалить страницу');
      } finally {
        setPageBusy(false);
      }
    },
    [pageBusy],
  );

  const handleSelectPage = useCallback((index: number) => {
    setActiveIndex(index);
    setSelectedIds([]);
  }, []);

  // ─── Текст ──────────────────────────────────────────────────────────────────

  /**
   * Коммит через ref, вне setState-updater'ов. `expectedId` защищает от гонки
   * blur ↔ pointerdown: клик по холсту с активным черновиком СНАЧАЛА коммитит
   * старый и открывает новый (в pointerdown), а ПОТОМ приходит blur старого —
   * без проверки id он стирал бы уже новый черновик. Именно так «текст не
   * вставлялся» в ручном тесте владельца.
   */
  const commitTextDraft = useCallback(
    (expectedId?: number) => {
      const draft = textDraftRef.current;
      if (!draft) return;
      if (expectedId !== undefined && draft.id !== expectedId) return;
      if (draft.value.trim()) {
        handleCommitElement(
          createText(draft.x, draft.y, draft.value.trim(), color, DEFAULT_TEXT_SIZE_MM),
        );
      }
      textDraftRef.current = null;
      setTextDraft(null);
    },
    [color, handleCommitElement],
  );

  const handleRequestText = useCallback(
    (x: number, y: number) => {
      commitTextDraft();
      textDraftSeq += 1;
      const draft = { id: textDraftSeq, x, y, value: '' };
      textDraftRef.current = draft;
      setTextDraft(draft);
    },
    [commitTextDraft],
  );

  // ─── Экспорт и прикрепление ────────────────────────────────────────────────

  const computeSignature = useCallback(() => {
    // background/gridMm — часть подписи: их смена тоже меняет напечатанный лист
    // (ревью 5.6 — прежняя подпись это упускала).
    return JSON.stringify(
      pagesRef.current.map((p) => [
        p.background,
        p.gridMm,
        p.elements.map((el) => `${el.id}:${el.version}`),
      ]),
    );
  }, []);

  const buildPdfBlob = useCallback(async () => {
    const source = pagesRef.current;
    if (source.length === 0) throw new Error('В доске нет страниц');
    // Динамический импорт: jsPDF + svg2pdf не должны грузиться при открытии
    // доски — они нужны только на экспорте (ревью 5.6, P1: −200 КБ gzip из чанка).
    const { exportBoardToPdf } = await import('@/lib/whiteboard/exportPdf');
    return exportBoardToPdf(
      source.map((p) => ({ elements: p.elements, background: p.background, gridMm: p.gridMm })),
      { onPageStart: (done, total) => setExportProgress({ done, total }) },
    );
  }, []);

  const handleDownload = useCallback(async () => {
    if (exportProgress) return;
    setExportProgress({ done: 0, total: pagesRef.current.length });
    try {
      await flushDirty();
      const blob = await buildPdfBlob();
      const { boardPdfFileName } = await import('@/lib/whiteboard/exportPdf');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = boardPdfFileName(board?.title ?? null, new Date());
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось собрать PDF');
    } finally {
      setExportProgress(null);
    }
  }, [exportProgress, flushDirty, buildPdfBlob, board]);

  /**
   * Прикрепление PDF к занятию — СУЩЕСТВУЮЩИМ путём `uploadLessonPdf` →
   * tutor_lesson_materials(kind:'pdf'): ученик видит конспект без правок на
   * своей стороне. Прошлый автоэкспорт удаляется (иначе кап в 5 PDF).
   */
  const attachPdfToLesson = useCallback(async (): Promise<boolean> => {
    const currentBoard = board;
    if (!currentBoard?.lesson_id) return false;
    const signature = computeSignature();
    if (signature === exportedSignatureRef.current && currentBoard.export_material_id) {
      return true;
    }

    const blob = await buildPdfBlob();
    const { boardPdfFileName } = await import('@/lib/whiteboard/exportPdf');
    const fileName = boardPdfFileName(currentBoard.title, new Date());
    const file = new File([blob], fileName, { type: 'application/pdf' });
    const material = await uploadLessonPdf(file, currentBoard.lesson_id, fileName);

    const previousId = currentBoard.export_material_id;
    const updated = await updateBoard(currentBoard.id, { export_material_id: material.id });
    setBoard(updated);
    exportedSignatureRef.current = signature;
    if (previousId) {
      await deleteMaterial(previousId).catch(() => undefined);
    }
    return true;
  }, [board, computeSignature, buildPdfBlob]);

  const handleAttachClick = useCallback(async () => {
    if (attaching || exportProgress) return;
    setAttaching(true);
    setExportProgress({ done: 0, total: pagesRef.current.length });
    try {
      await flushDirty();
      await attachPdfToLesson();
      toast.success('Конспект прикреплён к занятию');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось прикрепить конспект');
    } finally {
      setAttaching(false);
      setExportProgress(null);
    }
  }, [attaching, exportProgress, flushDirty, attachPdfToLesson]);

  /**
   * Выход с доски (кнопка «Доски»): дождаться сохранения, а для доски занятия —
   * автоматически прикрепить конспект. Это и есть обещанное «закрыл урок —
   * PDF сам в материалах» для естественного пути выхода (ревью 5.6, P0).
   * Серверный finalizer «на закрытие вкладки» — Фаза 1.5.
   */
  const handleExit = useCallback(async () => {
    if (exitPhase) return;
    setExitPhase('saving');
    try {
      const saved = await flushDirty();
      if (!saved) {
        const leaveAnyway = window.confirm(
          'Не удалось сохранить последние изменения (нет связи с сервером). Выйти без них?',
        );
        if (!leaveAnyway) return;
        navigate('/tutor/board');
        return;
      }
      const hasContent = pagesRef.current.some((p) => p.elements.length > 0);
      if (board?.lesson_id && hasContent && computeSignature() !== exportedSignatureRef.current) {
        setExitPhase('attaching');
        try {
          await attachPdfToLesson();
          toast.success('Конспект прикреплён к занятию');
        } catch (err) {
          toast.error(
            `Конспект не прикрепился: ${err instanceof Error ? err.message : 'ошибка'}. ` +
              'Доска сохранена — можно прикрепить позже кнопкой на доске.',
          );
        }
      }
      navigate('/tutor/board');
    } finally {
      setExitPhase(null);
    }
  }, [exitPhase, flushDirty, board, computeSignature, attachPdfToLesson, navigate]);

  // ─── Название ───────────────────────────────────────────────────────────────

  /**
   * Сравнение — с ПОСЛЕДНИМ СОХРАНЁННЫМ названием (ref), а не с board.title:
   * onChange уже обновил board.title, поэтому сравнение с ним на blur всегда
   * давало «ничего не изменилось» и название молча не сохранялось (баг из
   * ручного теста владельца).
   */
  const commitTitle = useCallback(async () => {
    const currentBoard = board;
    if (!currentBoard) return;
    const title = (currentBoard.title ?? '').trim();
    if (title === savedTitleRef.current) return;
    try {
      const updated = await updateBoard(currentBoard.id, { title: title || null });
      savedTitleRef.current = updated.title ?? '';
      setBoard((prev) => (prev ? { ...prev, title: updated.title } : prev));
    } catch (err) {
      toast.error(
        `Название не сохранилось: ${err instanceof Error ? err.message : 'ошибка сети'}`,
      );
    }
  }, [board]);

  // ─── Рендер ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (loadError || !board) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-slate-700">{loadError ?? 'Доска не найдена'}</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/tutor/board')}>
          К списку досок
        </Button>
      </div>
    );
  }

  const pageSummaries = pages.map((p) => ({
    id: p.id,
    elements: p.elements,
    background: p.background,
    gridMm: p.gridMm,
  }));

  const exporting = exportProgress !== null;

  return (
    // fixed inset-0: редактор занимает ВЕСЬ экран поверх AppFrame — на планшете
    // и телефоне рамка кабинета съедала место холста (ревью 5.6, P1). Высоту
    // держит inset, а не vh-единицы (rule 80).
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleExit()}
          disabled={exitPhase !== null}
          style={{ touchAction: 'manipulation' }}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Доски
        </Button>

        <input
          value={board.title ?? ''}
          placeholder="Без названия"
          onChange={(e) => setBoard({ ...board, title: e.target.value })}
          onBlur={() => void commitTitle()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          // 16px (text-base) обязателен на инпутах — иначе Safari iOS зумит (rule 80).
          className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-base font-medium text-slate-900 hover:border-slate-200 focus:border-accent focus:outline-none"
        />

        {saveStatus === 'error' ? (
          <button
            type="button"
            onClick={() => void flushDirty()}
            aria-live="polite"
            style={{ touchAction: 'manipulation' }}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50"
          >
            <AlertTriangle className="h-4 w-4" />
            <span className="hidden sm:inline">Не сохранено — повторить</span>
          </button>
        ) : (
          <span
            aria-live="polite"
            className="flex shrink-0 items-center gap-1.5 px-1 text-sm text-slate-500"
          >
            {saveStatus === 'saving' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="hidden sm:inline">Сохраняем</span>
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5 text-accent" />
                <span className="hidden sm:inline">Сохранено</span>
              </>
            )}
          </span>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleDownload()}
          disabled={exporting || attaching}
          style={{ touchAction: 'manipulation' }}
        >
          {exporting && !attaching ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          {exporting && !attaching && exportProgress
            ? `${exportProgress.done}/${exportProgress.total}`
            : 'PDF'}
        </Button>

        {board.lesson_id && (
          <Button
            size="sm"
            onClick={() => void handleAttachClick()}
            disabled={attaching || exporting}
            style={{ touchAction: 'manipulation' }}
          >
            {attaching ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="mr-1.5 h-4 w-4" />
            )}
            <span className="hidden sm:inline">Прикрепить к занятию</span>
            <span className="sm:hidden">К занятию</span>
          </Button>
        )}
      </header>

      <BoardToolbar
        tool={tool}
        onToolChange={setTool}
        color={color}
        onColorChange={setColor}
        size={size}
        onSizeChange={setSize}
        background={activePage?.background ?? 'grid'}
        onBackgroundChange={(background) => patchActivePage({ background })}
        gridMm={activePage?.gridMm ?? 5}
        onGridMmChange={(gridMm: BoardGridMm) => patchActivePage({ gridMm })}
        canUndo={historyState.canUndo}
        canRedo={historyState.canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        disabled={pageBusy}
      />

      <div className="relative min-h-0 flex-1 overflow-auto p-3">
        <div
          className="relative mx-auto h-full max-h-full bg-white shadow-sm ring-1 ring-slate-200"
          style={{ aspectRatio: `${PAGE_WIDTH_MM} / ${PAGE_HEIGHT_MM}` }}
        >
          {activePage && (
            <BoardCanvas
              elements={activePage.elements}
              background={activePage.background}
              gridMm={activePage.gridMm}
              tool={tool}
              color={color}
              size={size}
              selectedIds={selectedIds}
              readOnly={pageBusy}
              onCommitElement={handleCommitElement}
              onEraseElements={handleEraseElements}
              onSelectionChange={setSelectedIds}
              onMoveSelection={handleMoveSelection}
              onRequestText={handleRequestText}
            />
          )}

          {textDraft && (
            <textarea
              key={textDraft.id}
              autoFocus
              value={textDraft.value}
              onChange={(e) => {
                const next = { ...textDraft, value: e.target.value };
                textDraftRef.current = next;
                setTextDraft(next);
              }}
              onBlur={() => commitTextDraft(textDraft.id)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  textDraftRef.current = null;
                  setTextDraft(null);
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  // Enter — готово (привычно для подписи); новая строка — Shift+Enter.
                  e.preventDefault();
                  commitTextDraft(textDraft.id);
                }
              }}
              placeholder="Текст. Enter — готово, Esc — отмена"
              style={{
                left: `${(textDraft.x / PAGE_WIDTH_MM) * 100}%`,
                top: `${(textDraft.y / PAGE_HEIGHT_MM) * 100}%`,
              }}
              className="absolute z-10 min-h-[44px] w-56 resize-none rounded-md border border-accent bg-white p-2 text-base shadow-sm focus:outline-none"
            />
          )}
        </div>
      </div>

      <PagesPanel
        pages={pageSummaries}
        activeIndex={activeIndex}
        disabled={pageBusy}
        onSelect={handleSelectPage}
        onAdd={() => void handleAddPage()}
        onDelete={(index) => void handleDeletePage(index)}
      />

      {exitPhase && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80">
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-md">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <span className="text-slate-700">
              {exitPhase === 'saving' ? 'Сохраняем доску…' : 'Прикрепляем конспект к занятию…'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
