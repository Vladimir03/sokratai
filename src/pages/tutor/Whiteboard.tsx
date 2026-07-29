import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Download, Loader2, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BoardCanvas, type BoardTool } from '@/components/whiteboard/BoardCanvas';
import { BoardToolbar, type BoardZoom } from '@/components/whiteboard/BoardToolbar';
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
  type BoardGridMm,
  type PageOrientation,
  type PageSizeMm,
  BOARD_COLORS,
  DEFAULT_PEN_SIZE_MM,
  DEFAULT_TEXT_SIZE_MM,
  createText,
  elementBoundsCached,
  normalizeBackground,
  normalizeGridMm,
  normalizeOrientation,
  pageSizeMm,
  parseElements,
  primeSeqCounter,
  translateElement,
} from '@/lib/whiteboard/model';
import { AutosaveQueue, type AutosaveStatus } from '@/lib/whiteboard/autosaveQueue';
import { SceneHistory } from '@/lib/whiteboard/sceneHistory';
import { deleteMaterial, uploadLessonPdf } from '@/lib/lessonMaterialsApi';
import type { BoardBackground } from '@/lib/whiteboard/model';

// Страница доски (Фаза 1; раунд 3 — архитектурный рефакторинг).
//
// Компонент — оркестратор: сетевое сохранение живёт в `AutosaveQueue`
// (single-flight, ретраи — lib/whiteboard/autosaveQueue.ts, покрыт тестами),
// undo/redo — в `SceneHistory` (lib/whiteboard/sceneHistory.ts). Здесь остаются
// только React-состояние сцены, обработчики и разметка.
//
// Инварианты (не ломать):
// • Данные грузятся вручную (useEffect + useState), а НЕ через useQuery: на
//   холсте лежит несохранённый рукописный ввод, фоновый refetch по фокусу его
//   затёр бы (класс инцидента tab-switch, smoke-check §8).
// • PDF-движок — только динамический import() по факту экспорта.
// • Правки сцены и истории — в обработчиках событий, вне setState-updater'ов.
// • Ориентация листа хранится в `board_pages.app_state.orientation` (jsonb) —
//   правка схемы для неё не нужна.

interface PageState {
  id: string;
  elements: BoardElement[];
  background: BoardBackground;
  gridMm: BoardGridMm;
  orientation: PageOrientation;
}

interface TextDraft {
  id: number;
  x: number;
  y: number;
  value: string;
}

function rowToPageState(row: BoardPageRow): PageState {
  const elements = parseElements(row.elements);
  primeSeqCounter(elements);
  const appState = (row.app_state ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    elements,
    background: normalizeBackground(row.background),
    gridMm: normalizeGridMm(row.grid_mm),
    orientation: normalizeOrientation(appState.orientation),
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

  const [pageBusy, setPageBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [exitPhase, setExitPhase] = useState<null | 'saving' | 'attaching'>(null);
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>('saved');

  const [tool, setTool] = useState<BoardTool>('pen');
  const [color, setColor] = useState<string>(BOARD_COLORS[0]);
  const [size, setSize] = useState<number>(DEFAULT_PEN_SIZE_MM);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [zoom, setZoom] = useState<BoardZoom>('fit');
  const [historyTick, setHistoryTick] = useState(0);

  // ⚠️ Зеркало страниц — СИНХРОННОЕ: applyPages обновляет ref в том же тике,
  // что и setState. Прежний вариант (sync в passive-эффекте) оставлял окно,
  // в котором ответ автосейва мог перечитать УСТАРЕВШУЮ сцену и честно
  // объявить «Сохранено» без последнего штриха (ревью р.4, P0). Рендер
  // по-прежнему читает state; ref — источник правды для сети и жестов.
  const pagesRef = useRef<PageState[]>([]);
  const textDraftRef = useRef<TextDraft | null>(null);
  const savedTitleRef = useRef<string>('');
  const exportedSignatureRef = useRef<string | null>(null);
  const historyRef = useRef(new SceneHistory());
  const attachPromiseRef = useRef<Promise<boolean> | null>(null);

  // Очередь автосейва создаётся один раз; savePage читает СВЕЖУЮ страницу через
  // pagesRef (зеркало синхронизируется после коммита, см. эффект ниже).
  const autosaveRef = useRef<AutosaveQueue | null>(null);
  if (autosaveRef.current === null) {
    autosaveRef.current = new AutosaveQueue({
      savePage: async (pageId: string) => {
        const page = pagesRef.current.find((p) => p.id === pageId);
        if (!page) return;
        await saveBoardPage(page.id, {
          elements: page.elements,
          background: page.background,
          grid_mm: page.gridMm,
          app_state: { orientation: page.orientation },
        });
      },
      onStatus: setSaveStatus,
    });
  }
  const autosave = autosaveRef.current;

  /** Единственная точка записи страниц: ref и state меняются вместе. */
  const applyPages = useCallback((next: PageState[]) => {
    pagesRef.current = next;
    setPages(next);
  }, []);

  useEffect(() => {
    textDraftRef.current = textDraft;
  }, [textDraft]);

  const activePage = pages[activeIndex] ?? null;
  const activeSize: PageSizeMm = useMemo(
    () => pageSizeMm(activePage?.orientation ?? 'portrait'),
    [activePage?.orientation],
  );

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
        applyPages(next.length > 0 ? next : []);
        setActiveIndex(0);
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
  }, [params.boardId, params.lessonId, navigate, applyPages]);

  // Уход со страницы — best-effort дожим очереди (+ beforeunload ниже).
  useEffect(
    () => () => {
      void autosave.flush();
      autosave.dispose();
    },
    [autosave],
  );

  useEffect(() => {
    if (saveStatus === 'saved') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveStatus]);

  // ─── Правки сцены ───────────────────────────────────────────────────────────

  const updateActiveElements = useCallback(
    (updater: (elements: BoardElement[]) => BoardElement[], recordHistory = true) => {
      const current = pagesRef.current;
      const page = current[activeIndex];
      if (!page) return;
      const nextElements = updater(page.elements);
      if (nextElements === page.elements) return;
      if (recordHistory) {
        historyRef.current.push(page.id, page.elements);
        setHistoryTick((t) => t + 1);
      }
      const copy = current.slice();
      copy[activeIndex] = { ...page, elements: nextElements };
      // Порядок важен: сначала синхронное зеркало (applyPages), потом markDirty —
      // очередь автосейва при любом раскладе читает уже новую сцену.
      applyPages(copy);
      autosave.markDirty(page.id);
    },
    [activeIndex, autosave, applyPages],
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

  const applyHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      const page = pagesRef.current[activeIndex];
      if (!page) return;
      const history = historyRef.current;
      const restored =
        direction === 'undo'
          ? history.undo(page.id, page.elements)
          : history.redo(page.id, page.elements);
      if (!restored) return;
      setHistoryTick((t) => t + 1);
      applyPages(pagesRef.current.map((p) => (p.id === page.id ? { ...p, elements: restored } : p)));
      autosave.markDirty(page.id);
    },
    [activeIndex, autosave, applyPages],
  );

  const handleUndo = useCallback(() => applyHistory('undo'), [applyHistory]);
  const handleRedo = useCallback(() => applyHistory('redo'), [applyHistory]);

  const historyState = useMemo(() => {
    void historyTick;
    if (!activePage) return { canUndo: false, canRedo: false };
    return {
      canUndo: historyRef.current.canUndo(activePage.id),
      canRedo: historyRef.current.canRedo(activePage.id),
    };
  }, [activePage, historyTick]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
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

  // ─── Свойства страницы (разлиновка, ориентация) ─────────────────────────────

  const patchActivePage = useCallback(
    (patch: Partial<Pick<PageState, 'background' | 'gridMm' | 'orientation'>>) => {
      const page = pagesRef.current[activeIndex];
      if (!page) return;
      applyPages(pagesRef.current.map((p) => (p.id === page.id ? { ...p, ...patch } : p)));
      autosave.markDirty(page.id);
    },
    [activeIndex, autosave, applyPages],
  );

  const handleOrientationChange = useCallback(
    (orientation: PageOrientation) => {
      const page = pagesRef.current[activeIndex];
      if (!page || page.orientation === orientation) return;
      // Контент за краем нового листа не удаляется, но в PDF не попадёт —
      // предупреждаем заранее, а не после жалобы на «обрезанный конспект».
      const next = pageSizeMm(orientation);
      const overflows = page.elements.some((el) => {
        const b = elementBoundsCached(el);
        return b.maxX > next.width || b.maxY > next.height;
      });
      if (
        overflows &&
        !window.confirm(
          'Часть содержимого окажется за краем листа в новой ориентации (в PDF она не попадёт, но не удалится). Продолжить?',
        )
      ) {
        return;
      }
      patchActivePage({ orientation });
    },
    [activeIndex, patchActivePage],
  );

  // ─── Страницы ───────────────────────────────────────────────────────────────

  const handleAddPage = useCallback(async () => {
    if (!board || pageBusy) return;
    setPageBusy(true);
    try {
      await autosave.flush();
      const created = await createBoardPage(board.id, {
        background: activePage?.background ?? 'grid',
        grid_mm: activePage?.gridMm ?? 5,
      });
      const newPage: PageState = {
        ...rowToPageState(created),
        // Новый лист наследует ориентацию текущего (ориентация живёт в
        // app_state и создаётся дефолтной — досылаем её первым же автосейвом).
        orientation: activePage?.orientation ?? 'portrait',
      };
      const nextPages = [...pagesRef.current, newPage];
      applyPages(nextPages);
      if (newPage.orientation !== 'portrait') autosave.markDirty(newPage.id);
      setActiveIndex(nextPages.length - 1);
      setSelectedIds([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось добавить страницу');
    } finally {
      setPageBusy(false);
    }
  }, [board, pageBusy, autosave, activePage, applyPages]);

  const handleDeletePage = useCallback(
    async (index: number) => {
      const page = pagesRef.current[index];
      if (!page || pageBusy) return;
      const count = page.elements.length;
      const message =
        count > 0
          ? `Удалить страницу ${index + 1}? На ней ${count} объект(ов) — отменить удаление будет нельзя.`
          : `Удалить пустую страницу ${index + 1}?`;
      if (!window.confirm(message)) return;
      setPageBusy(true);
      try {
        await deleteBoardPage(page.id);
        historyRef.current.forget(page.id);
        autosave.forget(page.id);
        const nextPages = pagesRef.current.filter((_, i) => i !== index);
        applyPages(nextPages);
        setActiveIndex((prev) => Math.max(0, Math.min(prev, nextPages.length - 1)));
        setSelectedIds([]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось удалить страницу');
      } finally {
        setPageBusy(false);
      }
    },
    [pageBusy, autosave, applyPages],
  );

  const handleSelectPage = useCallback((index: number) => {
    setActiveIndex(index);
    setSelectedIds([]);
  }, []);

  // ─── Текст ──────────────────────────────────────────────────────────────────

  /**
   * Коммит через ref, вне setState-updater'ов. `expectedId` защищает от гонки
   * blur ↔ pointerdown (см. также preventDefault в BoardCanvas.handlePointerDown —
   * он убирает кражу фокуса default-действием mousedown, из-за которой поле
   * закрывалось пустым сразу после открытия).
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
    return JSON.stringify(
      pagesRef.current.map((p) => [
        p.background,
        p.gridMm,
        p.orientation,
        p.elements.map((el) => `${el.id}:${el.version}`),
      ]),
    );
  }, []);

  const buildPdfBlob = useCallback(async () => {
    const source = pagesRef.current;
    if (source.length === 0) throw new Error('В доске нет страниц');
    const { exportBoardToPdf } = await import('@/lib/whiteboard/exportPdf');
    return exportBoardToPdf(
      source.map((p) => ({
        elements: p.elements,
        background: p.background,
        gridMm: p.gridMm,
        orientation: p.orientation,
      })),
      { onPageStart: (done, total) => setExportProgress({ done, total }) },
    );
  }, []);

  const handleDownload = useCallback(async () => {
    if (exportProgress) return;
    setExportProgress({ done: 0, total: pagesRef.current.length });
    try {
      await autosave.flush();
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
  }, [exportProgress, autosave, buildPdfBlob, board]);

  /**
   * SINGLE-FLIGHT (ревью р.4, P1): ручная кнопка и авто-прикрепление при выходе
   * могли пойти параллельно и загрузить два PDF. Повторный вызов получает тот
   * же promise; после завершения слот освобождается.
   */
  const attachPdfToLesson = useCallback((): Promise<boolean> => {
    if (attachPromiseRef.current) return attachPromiseRef.current;
    const run = (async (): Promise<boolean> => {
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
    })().finally(() => {
      attachPromiseRef.current = null;
    });
    attachPromiseRef.current = run;
    return run;
  }, [board, computeSignature, buildPdfBlob]);

  const handleAttachClick = useCallback(async () => {
    if (attaching || exportProgress) return;
    setAttaching(true);
    setExportProgress({ done: 0, total: pagesRef.current.length });
    try {
      await autosave.flush();
      await attachPdfToLesson();
      toast.success('Конспект прикреплён к занятию');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось прикрепить конспект');
    } finally {
      setAttaching(false);
      setExportProgress(null);
    }
  }, [attaching, exportProgress, autosave, attachPdfToLesson]);

  const handleExit = useCallback(async () => {
    if (exitPhase) return;
    setExitPhase('saving');
    try {
      const saved = await autosave.flush();
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
          // НЕ закрываем редактор молча (ревью р.4, P0): главный Job — PDF в
          // занятии, и уход при его провале должен быть осознанным выбором.
          const leaveWithoutPdf = window.confirm(
            `Конспект не прикрепился к занятию: ${err instanceof Error ? err.message : 'ошибка сети'}.\n\n` +
              'Доска сохранена. Выйти БЕЗ PDF в занятии? «Отмена» — остаться и повторить.',
          );
          if (!leaveWithoutPdf) return;
        }
      }
      navigate('/tutor/board');
    } finally {
      setExitPhase(null);
    }
  }, [exitPhase, autosave, board, computeSignature, attachPdfToLesson, navigate]);

  // ─── Back-гард ──────────────────────────────────────────────────────────────
  //
  // Браузерный Back / свайп назад — SPA-навигация: beforeunload НЕ срабатывает,
  // и unmount уносил несохранённое и обходил авто-прикрепление (ревью р.4, P0).
  // BrowserRouter без data-роутера не даёт useBlocker, поэтому классический
  // трап: сторожевая запись в history; popstate при «есть что терять» возвращает
  // запись и проводит уход через штатный handleExit. Когда терять нечего —
  // отпускаем назад без вмешательства.

  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);
  const boardStateRef = useRef<Board | null>(null);
  useEffect(() => {
    boardStateRef.current = board;
  }, [board]);

  useEffect(() => {
    // Сторожевая запись — один раз на маунт (в эффекте слушателя её пересоздание
    // плодило бы записи при каждой смене deps).
    window.history.pushState({ __boardGuard: true }, '');
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const b = boardStateRef.current;
      const attachPending =
        !!b?.lesson_id &&
        pagesRef.current.some((p) => p.elements.length > 0) &&
        computeSignature() !== exportedSignatureRef.current;
      const needsGuard = saveStatusRef.current !== 'saved' || attachPending;
      if (!needsGuard) {
        // Сторожевая запись уже поглощена этим popstate — уходим ещё на шаг,
        // на настоящую предыдущую страницу.
        window.history.back();
        return;
      }
      // Возвращаем сторожа и проводим уход по-человечески: flush → attach → навигация.
      window.history.pushState({ __boardGuard: true }, '');
      void handleExit();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [computeSignature, handleExit]);

  // ─── Название ───────────────────────────────────────────────────────────────

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

  // ─── Зум ────────────────────────────────────────────────────────────────────

  // Габариты вьюпорта — для режима «Вписать» (масштаб зависит от ориентации).
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewport({ w: rect.width, h: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading]);

  const sheetWidthPx = useMemo(() => {
    if (!viewport) return null;
    const ratio = activeSize.width / activeSize.height;
    if (zoom === 'fit') {
      // Вписать целиком: ограничение и по ширине, и по высоте.
      return Math.max(120, Math.min(viewport.w, viewport.h * ratio));
    }
    return Math.max(120, (viewport.w * zoom) / 100);
  }, [viewport, zoom, activeSize]);

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
    orientation: p.orientation,
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
          // attaching тоже блокирует: параллельные «Прикрепить» и «Доски»
          // загружали два PDF (ревью р.4, P1; плюс single-flight в attachPdfToLesson).
          disabled={exitPhase !== null || attaching}
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
            onClick={() => void autosave.flush()}
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
        orientation={activePage?.orientation ?? 'portrait'}
        onOrientationChange={handleOrientationChange}
        zoom={zoom}
        onZoomChange={setZoom}
        canUndo={historyState.canUndo}
        canRedo={historyState.canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        disabled={pageBusy}
      />

      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto p-3">
        <div
          className="relative mx-auto bg-white shadow-sm ring-1 ring-slate-200"
          style={{
            width: sheetWidthPx ? `${Math.round(sheetWidthPx)}px` : '100%',
            aspectRatio: `${activeSize.width} / ${activeSize.height}`,
          }}
        >
          {activePage && (
            <BoardCanvas
              elements={activePage.elements}
              background={activePage.background}
              gridMm={activePage.gridMm}
              pageSize={activeSize}
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
              onPan={(dx, dy) => {
                const el = viewportRef.current;
                if (el) {
                  el.scrollLeft += dx;
                  el.scrollTop += dy;
                }
              }}
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
                left: `${(textDraft.x / activeSize.width) * 100}%`,
                top: `${(textDraft.y / activeSize.height) * 100}%`,
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
