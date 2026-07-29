import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Copy, Download, Loader2, Paperclip, Send, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  BoardCanvas,
  type BoardSelection,
  type BoardTool,
  type FrameView,
  type GhostCell,
} from '@/components/whiteboard/BoardCanvas';
import { BoardToolbar } from '@/components/whiteboard/BoardToolbar';
import { PagesPanel } from '@/components/whiteboard/PagesPanel';
import { supabase } from '@/lib/supabaseClient';
import {
  type Board,
  type BoardPageRow,
  WhiteboardApiError,
  createBoardPage,
  deleteBoardPage,
  distributeZones,
  getBoard,
  getOrCreateLessonBoard,
  saveBoardPage,
  updateBoard,
} from '@/lib/whiteboardApi';
import {
  type BoardElement,
  type BoardGridMm,
  type CameraState,
  type FramePlacement,
  type ImageElement,
  type PageOrientation,
  type FrameCell,
  BOARD_COLORS,
  DEFAULT_PEN_SIZE_MM,
  DEFAULT_TEXT_SIZE_MM,
  PAGE_WIDTH_MM,
  bumpVersion,
  cameraToFitBounds,
  cellOccupied,
  cellSpan,
  cellToPlacement,
  compareCellsForExport,
  createImage,
  createText,
  elementBoundsCached,
  frameWorldBounds,
  nextCellInColumn,
  nextCellInStrip,
  normalizeBackground,
  normalizeFrameCell,
  normalizeGridMm,
  normalizeOrientation,
  pageSizeMm,
  parseElements,
  primeSeqCounter,
  roundMm,
  translateElement,
  worldToViewportPx,
  zoomCameraAt,
} from '@/lib/whiteboard/model';
import type { ImageUrlMap } from '@/lib/whiteboard/svg';
import {
  copyElements,
  hasInternalClipboard,
  pasteElements,
  shouldUseInternalClipboard,
} from '@/lib/whiteboard/boardClipboard';
import {
  MAX_IMAGES_PER_PAGE,
  resolveBoardImageUrl,
  resolveImagesAsDataUrls,
  uploadBoardImage,
} from '@/lib/whiteboard/boardImages';
import { AutosaveQueue, type AutosaveStatus } from '@/lib/whiteboard/autosaveQueue';
import { SceneHistory } from '@/lib/whiteboard/sceneHistory';
import { reconcileElements } from '@/lib/whiteboard/reconcile';
import { subscribeBoardRevs } from '@/lib/whiteboard/boardRealtime';
import { ensureShareLink, revokeShareLink } from '@/lib/whiteboardApi';
import { ensureChatConversation, sendChatMessageApi } from '@/lib/tutorStudentChatApi';
import { usePasteImages } from '@/hooks/usePasteImages';
import { useDragDropFiles } from '@/hooks/useDragDropFiles';
import { deleteMaterial, uploadLessonPdf } from '@/lib/lessonMaterialsApi';
import type { BoardBackground } from '@/lib/whiteboard/model';

// Страница доски — Фаза P0: бесконечный холст с рамками-страницами (B0, Р1
// отменён решением владельца 29.07) + внутренний clipboard (B3).
//
// Компонент — оркестратор: сеть в AutosaveQueue, undo в SceneHistory, геометрия
// в model.ts. Рамка = строка board_pages; позиция рамки — app_state.frame,
// элементы в ЛОКАЛЬНЫХ координатах рамки (exportPdf Фазы 1 не менялся).
//
// Инварианты (не ломать):
// • Данные вручную (useEffect+useState), НЕ useQuery — фоновый refetch затёр бы
//   несохранённый ввод (smoke-check §8).
// • PDF-движок — только динамический import().
// • Правки сцены/истории — в обработчиках, вне setState-updater'ов.
// • «Сохранено» — только при пустой очереди (single-flight, ревью р.4).

const HUNDRED_PERCENT_ZOOM = 96 / 25.4; // px на мм при 100% (96 dpi)
/** Зеркало серверного MAX_PAGES_PER_BOARD (whiteboard-api) — preflight импорта. */
const MAX_BOARD_PAGES = 50;

interface FrameState {
  id: string;
  elements: BoardElement[];
  background: BoardBackground;
  gridMm: BoardGridMm;
  orientation: PageOrientation;
  /** Ячейка сетки Chattern; placement выводится. */
  cell: FrameCell;
  placement: FramePlacement;
  /** Зона ученика (рулон); null — лист репетитора. */
  zoneTutorStudentId: string | null;
  /** Текущий rev листа (base_rev для сохранений; Этап 3). 0 — неизвестен. */
  rev: number;
}

interface TextDraft {
  id: number;
  frameId: string;
  x: number;
  y: number;
  value: string;
}

function rowToFrameState(row: BoardPageRow, index: number, rev = 0): FrameState {
  const elements = parseElements(row.elements);
  primeSeqCounter(elements);
  const appState = (row.app_state ?? {}) as Record<string, unknown>;
  const cell = normalizeFrameCell(appState.frame, index);
  return {
    id: row.id,
    elements,
    background: normalizeBackground(row.background),
    gridMm: normalizeGridMm(row.grid_mm),
    orientation: normalizeOrientation(appState.orientation),
    cell,
    placement: cellToPlacement(cell),
    zoneTutorStudentId: row.zone_tutor_student_id ?? null,
    rev,
  };
}

/**
 * Детерминированный ремонт коллизий ячеек (ревью P1): legacy-{x,y} округление
 * и гонки параллельных созданий могут дать два листа в одной ячейке — тогда
 * они физически перекрываются и порядок экспорта неоднозначен. Идём в порядке
 * page_index (стабилен) и сдвигаем конфликтующий лист вправо по его ряду.
 * Ремонт in-memory: сетка выводится из cell при каждой загрузке одинаково,
 * а app_state допишется при первой правке листа.
 */
function deconflictCells(frames: FrameState[]): FrameState[] {
  const placed: { cell: FrameCell; orientation: PageOrientation }[] = [];
  return frames.map((f) => {
    let cell = f.cell;
    const span = cellSpan(f.orientation);
    while (cellOccupied(cell, placed, span)) {
      cell = { col: cell.col + 1, row: cell.row };
    }
    placed.push({ cell, orientation: f.orientation });
    return cell === f.cell ? f : { ...f, cell, placement: cellToPlacement(cell) };
  });
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
  const [frames, setFrames] = useState<FrameState[]>([]);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
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
  const [selection, setSelection] = useState<BoardSelection | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [camera, setCamera] = useState<CameraState>({ cx: 90, cy: 130, zoom: 1.5 });
  const [historyTick, setHistoryTick] = useState(0);
  const [imageUrls, setImageUrls] = useState<ImageUrlMap>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const failedImageRefsRef = useRef<Set<string>>(new Set());

  const framesRef = useRef<FrameState[]>([]);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const textDraftRef = useRef<TextDraft | null>(null);
  const savedTitleRef = useRef<string>('');
  const exportedSignatureRef = useRef<string | null>(null);
  const historyRef = useRef(new SceneHistory());
  const attachPromiseRef = useRef<Promise<boolean> | null>(null);

  /** Единственная точка записи рамок: ref и state — синхронно (P0 ревью р.4). */
  const applyFrames = useCallback((next: FrameState[]) => {
    framesRef.current = next;
    setFrames(next);
  }, []);

  useEffect(() => {
    textDraftRef.current = textDraft;
  }, [textDraft]);

  /** Точечный патч кадра БЕЗ пометки dirty (rev/merge от сервера). */
  const patchFrameSilently = useCallback((frameId: string, patch: Partial<FrameState>) => {
    framesRef.current = framesRef.current.map((f) => (f.id === frameId ? { ...f, ...patch } : f));
    setFrames(framesRef.current);
  }, []);

  const autosaveRef = useRef<AutosaveQueue | null>(null);
  if (autosaveRef.current === null) {
    autosaveRef.current = new AutosaveQueue({
      savePage: async (pageId: string) => {
        // 409-конфликт (Этап 3): репетитор мог столкнуться с учеником в его
        // зоне → reconcile по version/versionNonce и немедленный повтор.
        for (let attempt = 0; attempt < 2; attempt++) {
          const frame = framesRef.current.find((f) => f.id === pageId);
          if (!frame) return;
          const outcome = await saveBoardPage(frame.id, {
            elements: frame.elements,
            background: frame.background,
            grid_mm: frame.gridMm,
            app_state: { orientation: frame.orientation, frame: frame.cell },
            base_rev: frame.rev,
          });
          if (!outcome.conflict) {
            if (typeof outcome.rev === 'number' && outcome.rev > 0) {
              patchFrameSilently(pageId, { rev: outcome.rev });
            }
            return;
          }
          const remote = Array.isArray(outcome.conflict.elements)
            ? (outcome.conflict.elements as BoardElement[])
            : [];
          const { merged, divergesFromRemote } = reconcileElements(frame.elements, remote);
          patchFrameSilently(pageId, { elements: merged, rev: outcome.conflict.rev });
          if (!divergesFromRemote) return;
        }
        throw new Error('REV_CONFLICT_RETRY');
      },
      onStatus: setSaveStatus,
    });
  }
  const autosave = autosaveRef.current;

  const activeFrame = useMemo(
    () => frames.find((f) => f.id === activeFrameId) ?? frames[0] ?? null,
    [frames, activeFrameId],
  );

  // ─── Вьюпорт ────────────────────────────────────────────────────────────────

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) setViewport({ w: rect.width, h: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading]);

  const fitFrames = useCallback(
    (list: FrameState[], vp: { w: number; h: number }) => {
      if (list.length === 0) return;
      let bounds = frameWorldBounds(list[0].placement, pageSizeMm(list[0].orientation));
      for (let i = 1; i < list.length; i++) {
        const b = frameWorldBounds(list[i].placement, pageSizeMm(list[i].orientation));
        bounds = {
          minX: Math.min(bounds.minX, b.minX),
          minY: Math.min(bounds.minY, b.minY),
          maxX: Math.max(bounds.maxX, b.maxX),
          maxY: Math.max(bounds.maxY, b.maxY),
        };
      }
      setCamera(cameraToFitBounds(bounds, vp));
    },
    [],
  );

  const fitSingleFrame = useCallback((frame: FrameState, vp: { w: number; h: number }) => {
    setCamera(cameraToFitBounds(frameWorldBounds(frame.placement, pageSizeMm(frame.orientation)), vp));
  }, []);

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
        const next = deconflictCells(data.pages.map((row, i) => rowToFrameState(row, i)));
        applyFrames(next);
        setActiveFrameId(next[0]?.id ?? null);
        // Revs — base_rev для сохранений (Этап 3). Догружаем после кадров:
        // сейв с rev=0 в худшем случае получит один 409 и выровняется сам.
        void supabase
          .from('board_page_revs')
          .select('page_id, rev')
          .eq('board_id', data.board.id)
          .then(({ data: revs }) => {
            if (cancelled || !revs) return;
            framesRef.current = framesRef.current.map((f) => {
              const row = revs.find((r) => r.page_id === f.id);
              return row ? { ...f, rev: Number(row.rev) || 0 } : f;
            });
            setFrames(framesRef.current);
          });
        if (next.length > 0) {
          // Открытие: один лист — вписать его; несколько — показать всю доску
          // (репетитор группы сразу видит все зоны, кейс Елены).
          const vp = { w: window.innerWidth, h: Math.max(320, window.innerHeight - 180) };
          if (next.length === 1) fitSingleFrame(next[0], vp);
          else fitFrames(next, vp);
        }
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
  }, [params.boardId, params.lessonId, navigate, applyFrames, fitFrames, fitSingleFrame]);

  useEffect(
    () => () => {
      void autosave.flush();
      autosave.dispose();
    },
    [autosave],
  );

  // ─── Живой синк (Этап 3): ученики пишут в зоны — репетитор видит ~1–2 с ─────

  const boardIdForSync = board?.id ?? null;

  useEffect(() => {
    if (!boardIdForSync) return;

    const refetchAndMerge = async (pageId: string, knownRev: number) => {
      const current = framesRef.current.find((f) => f.id === pageId);
      if (current && current.rev >= knownRev && knownRev > 0) return; // наш же сейв
      const [{ data: row }, { data: revRow }] = await Promise.all([
        supabase
          .from('board_pages')
          .select('id, page_index, elements, app_state, background, grid_mm, zone_tutor_student_id')
          .eq('id', pageId)
          .maybeSingle(),
        supabase.from('board_page_revs').select('rev').eq('page_id', pageId).maybeSingle(),
      ]);
      if (!row) return;
      const freshRev = Number(revRow?.rev) || knownRev;
      const parsed = rowToFrameState(row as BoardPageRow, framesRef.current.length, freshRev);
      const existing = framesRef.current.find((f) => f.id === pageId);
      if (!existing) {
        // Ученик добавил лист в свой рулон.
        applyFrames([...framesRef.current, parsed]);
        return;
      }
      // Merge, не replace: локальная незасейвленная грязь репетитора переживает
      // чужие правки (rule 100-паттерн; reconcile по version/versionNonce).
      const { merged } = reconcileElements(existing.elements, parsed.elements);
      patchFrameSilently(pageId, {
        elements: merged,
        rev: freshRev,
        zoneTutorStudentId: parsed.zoneTutorStudentId,
        background: parsed.background,
        gridMm: parsed.gridMm,
        orientation: parsed.orientation,
        cell: parsed.cell,
        placement: parsed.placement,
      });
    };

    const resync = async () => {
      const { data: revs } = await supabase
        .from('board_page_revs')
        .select('page_id, rev')
        .eq('board_id', boardIdForSync);
      for (const r of revs ?? []) {
        void refetchAndMerge(r.page_id as string, Number(r.rev) || 0);
      }
    };

    return subscribeBoardRevs(boardIdForSync, {
      onRev: (event) => void refetchAndMerge(event.page_id, event.rev),
      onReconnect: () => void resync(),
    });
  }, [boardIdForSync, applyFrames, patchFrameSilently]);

  useEffect(() => {
    if (saveStatus === 'saved') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveStatus]);

  // ─── Правки сцены (адресуются рамке) ───────────────────────────────────────

  const updateFrameElements = useCallback(
    (frameId: string, updater: (elements: BoardElement[]) => BoardElement[], recordHistory = true) => {
      const current = framesRef.current;
      const idx = current.findIndex((f) => f.id === frameId);
      if (idx < 0) return;
      const frame = current[idx];
      const nextElements = updater(frame.elements);
      if (nextElements === frame.elements) return;
      if (recordHistory) {
        historyRef.current.push(frame.id, frame.elements);
        setHistoryTick((t) => t + 1);
      }
      const copy = current.slice();
      copy[idx] = { ...frame, elements: nextElements };
      applyFrames(copy);
      autosave.markDirty(frame.id);
      setActiveFrameId(frame.id);
    },
    [autosave, applyFrames],
  );

  const handleCommitElement = useCallback(
    (frameId: string, element: BoardElement) => {
      updateFrameElements(frameId, (elements) => [...elements, element]);
    },
    [updateFrameElements],
  );

  const handleEraseElements = useCallback(
    (frameId: string, ids: string[]) => {
      if (ids.length === 0) return;
      const removal = new Set(ids);
      updateFrameElements(frameId, (elements) => elements.filter((el) => !removal.has(el.id)));
    },
    [updateFrameElements],
  );

  const handleMoveSelection = useCallback(
    (frameId: string, dx: number, dy: number) => {
      if ((dx === 0 && dy === 0) || !selection || selection.frameId !== frameId) return;
      const moving = new Set(selection.ids);
      updateFrameElements(frameId, (elements) =>
        elements.map((el) => (moving.has(el.id) ? translateElement(el, dx, dy) : el)),
      );
    },
    [selection, updateFrameElements],
  );

  const handleTransformElement = useCallback(
    (frameId: string, id: string, patch: Partial<ImageElement>) => {
      updateFrameElements(frameId, (elements) =>
        elements.map((el) => (el.id === id ? bumpVersion(el as ImageElement, patch) : el)),
      );
    },
    [updateFrameElements],
  );

  const applyHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      const frameId = activeFrameId ?? framesRef.current[0]?.id;
      if (!frameId) return;
      const frame = framesRef.current.find((f) => f.id === frameId);
      if (!frame) return;
      const history = historyRef.current;
      const restored =
        direction === 'undo'
          ? history.undo(frame.id, frame.elements)
          : history.redo(frame.id, frame.elements);
      if (!restored) return;
      setHistoryTick((t) => t + 1);
      applyFrames(
        framesRef.current.map((f) => (f.id === frame.id ? { ...f, elements: restored } : f)),
      );
      autosave.markDirty(frame.id);
    },
    [activeFrameId, autosave, applyFrames],
  );

  const handleUndo = useCallback(() => applyHistory('undo'), [applyHistory]);
  const handleRedo = useCallback(() => applyHistory('redo'), [applyHistory]);

  const historyState = useMemo(() => {
    void historyTick;
    const id = activeFrame?.id;
    if (!id) return { canUndo: false, canRedo: false };
    return {
      canUndo: historyRef.current.canUndo(id),
      canRedo: historyRef.current.canRedo(id),
    };
  }, [activeFrame, historyTick]);

  // ─── Клавиатура: undo/redo + внутренний clipboard (B3) ─────────────────────

  const handleCopySelection = useCallback((): boolean => {
    const sel = selection;
    if (!sel || sel.ids.length === 0) return false;
    const frame = framesRef.current.find((f) => f.id === sel.frameId);
    if (!frame) return false;
    const picked = new Set(sel.ids);
    const count = copyElements(frame.elements.filter((el) => picked.has(el.id)));
    if (count > 0) toast.message(`Скопировано объектов: ${count}`);
    return count > 0;
  }, [selection]);

  const pasteInternal = useCallback(() => {
    const current = framesRef.current;
    if (current.length === 0) return;
    // Цель вставки: рамка под центром вьюпорта, иначе активная.
    const cam = cameraRef.current;
    const target =
      current.find((f) => {
        const b = frameWorldBounds(f.placement, pageSizeMm(f.orientation));
        return cam.cx >= b.minX && cam.cx <= b.maxX && cam.cy >= b.minY && cam.cy <= b.maxY;
      }) ?? current.find((f) => f.id === activeFrameId) ?? current[0];
    const size = pageSizeMm(target.orientation);
    const local = {
      x: Math.min(Math.max(cam.cx - target.placement.x, 10), size.width - 10),
      y: Math.min(Math.max(cam.cy - target.placement.y, 10), size.height - 10),
    };
    const clones = pasteElements(local);
    if (clones.length === 0) return;
    updateFrameElements(target.id, (elements) => [...elements, ...clones]);
    setSelection({ frameId: target.id, ids: clones.map((c) => c.id) });
    setTool('select');
  }, [activeFrameId, updateFrameElements]);

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
      } else if (key === 'c') {
        // B3: Ctrl+C копирует выделение доски (раньше не перехватывался вовсе).
        if (handleCopySelection()) event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, handleCopySelection]);

  // ─── Свойства рамки ─────────────────────────────────────────────────────────

  const patchFrame = useCallback(
    (frameId: string, patch: Partial<Pick<FrameState, 'background' | 'gridMm' | 'orientation' | 'placement'>>) => {
      const frame = framesRef.current.find((f) => f.id === frameId);
      if (!frame) return;
      applyFrames(framesRef.current.map((f) => (f.id === frameId ? { ...f, ...patch } : f)));
      autosave.markDirty(frameId);
    },
    [autosave, applyFrames],
  );

  const handleOrientationChange = useCallback(
    (orientation: PageOrientation) => {
      const frame = activeFrame;
      if (!frame || frame.orientation === orientation) return;
      // Ландшафт занимает ДВЕ колонки (ревью P1): если соседняя ячейка занята,
      // лист перекрыл бы чужой рулон — блокируем с объяснением.
      if (orientation === 'landscape') {
        const others = framesRef.current
          .filter((f) => f.id !== frame.id)
          .map((f) => ({ cell: f.cell, orientation: f.orientation }));
        if (cellOccupied({ col: frame.cell.col + 1, row: frame.cell.row }, others)) {
          toast.error('Справа уже есть лист — альбомная ориентация не помещается.');
          return;
        }
      }
      const next = pageSizeMm(orientation);
      const overflows = frame.elements.some((el) => {
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
      patchFrame(frame.id, { orientation });
    },
    [activeFrame, patchFrame],
  );

  // ─── Рамки: добавить / удалить / перейти ───────────────────────────────────

  // handleAddFrame объявлен ниже, после createFrameAt (блок зон/сетки).

  const handleDeleteFrame = useCallback(
    async (index: number) => {
      const frame = framesRef.current[index];
      if (!frame || pageBusy) return;
      const count = frame.elements.length;
      const message =
        count > 0
          ? `Удалить лист ${index + 1}? На нём ${count} объект(ов) — отменить удаление будет нельзя.`
          : `Удалить пустой лист ${index + 1}?`;
      if (!window.confirm(message)) return;
      setPageBusy(true);
      try {
        await deleteBoardPage(frame.id);
        historyRef.current.forget(frame.id);
        autosave.forget(frame.id);
        const next = framesRef.current.filter((_, i) => i !== index);
        applyFrames(next);
        setActiveFrameId((prev) => (prev === frame.id ? next[0]?.id ?? null : prev));
        setSelection(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось удалить лист');
      } finally {
        setPageBusy(false);
      }
    },
    [pageBusy, autosave, applyFrames],
  );

  const handleSelectFrame = useCallback(
    (index: number) => {
      const frame = framesRef.current[index];
      if (!frame) return;
      setActiveFrameId(frame.id);
      setSelection(null);
      fitSingleFrame(frame, viewport);
    },
    [fitSingleFrame, viewport],
  );

  // ─── Картинки ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const refs = new Set<string>();
    for (const frame of frames) {
      for (const el of frame.elements) {
        if (el.type === 'image') refs.add(el.ref);
      }
    }
    const missing = Array.from(refs).filter(
      (ref) => !imageUrls[ref] && !failedImageRefsRef.current.has(ref),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const resolved: ImageUrlMap = {};
      for (let i = 0; i < missing.length; i++) {
        const url = await resolveBoardImageUrl(missing[i]);
        if (url) resolved[missing[i]] = url;
        else failedImageRefsRef.current.add(missing[i]);
      }
      if (!cancelled && Object.keys(resolved).length > 0) {
        setImageUrls((prev) => ({ ...prev, ...resolved }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [frames, imageUrls]);

  const insertImageFiles = useCallback(
    async (files: File[]) => {
      const currentBoard = board;
      const current = framesRef.current;
      if (!currentBoard || current.length === 0 || files.length === 0) return;

      // Целевая рамка — под центром вьюпорта (жалоба Егора «вставляется где
      // хочет»: раньше вставка шла в центр листа, который при зуме был вне экрана).
      const cam = cameraRef.current;
      const target =
        current.find((f) => {
          const b = frameWorldBounds(f.placement, pageSizeMm(f.orientation));
          return cam.cx >= b.minX && cam.cx <= b.maxX && cam.cy >= b.minY && cam.cy <= b.maxY;
        }) ?? current.find((f) => f.id === activeFrameId) ?? current[0];

      const existing = target.elements.filter((el) => el.type === 'image').length;
      const room = MAX_IMAGES_PER_PAGE - existing;
      if (room <= 0) {
        toast.error(
          `На листе уже ${MAX_IMAGES_PER_PAGE} картинок (лимит, чтобы PDF не разрастался). Добавьте новый лист.`,
        );
        return;
      }
      const batch = files.slice(0, room);
      if (batch.length < files.length) {
        toast.message(`Добавлены первые ${batch.length} — лимит ${MAX_IMAGES_PER_PAGE} картинок на лист.`);
      }

      for (let i = 0; i < batch.length; i++) {
        try {
          const uploaded = await uploadBoardImage(batch[i], currentBoard.id);
          const size = pageSizeMm(target.orientation);
          const pxToMm = 25.4 / 96;
          let w = uploaded.naturalWidth * pxToMm;
          let h = uploaded.naturalHeight * pxToMm;
          const scale = Math.min(1, (size.width * 0.6) / w, (size.height * 0.6) / h);
          w = roundMm(w * scale);
          h = roundMm(h * scale);
          const cascade = ((existing + i) % 4) * 5;
          const centerLocal = {
            x: Math.min(Math.max(cam.cx - target.placement.x, w / 2), size.width - w / 2),
            y: Math.min(Math.max(cam.cy - target.placement.y, h / 2), size.height - h / 2),
          };
          const x = roundMm(Math.max(0, centerLocal.x - w / 2 + cascade));
          const y = roundMm(Math.max(0, centerLocal.y - h / 2 + cascade));
          handleCommitElement(target.id, createImage(x, y, w, h, uploaded.ref));
          void resolveBoardImageUrl(uploaded.ref).then((url) => {
            if (url) setImageUrls((prev) => ({ ...prev, [uploaded.ref]: url }));
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Не удалось добавить изображение');
        }
      }
    },
    [board, activeFrameId, handleCommitElement],
  );

  // ─── Зоны-рулоны и сетка (Этап 2) ──────────────────────────────────────────

  const [zoneNames, setZoneNames] = useState<Record<string, string>>({});
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

  // Имена учеников для подписей зон (репетиторский RLS на tutor_students).
  useEffect(() => {
    const ids = Array.from(
      new Set(frames.map((f) => f.zoneTutorStudentId).filter((id): id is string => !!id)),
    ).filter((id) => !zoneNames[id]);
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('tutor_students')
        .select('id, display_name')
        .in('id', ids);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const row of data) next[row.id] = row.display_name ?? 'Ученик';
      setZoneNames((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [frames, zoneNames]);

  /** Плюсы сетки: один справа в полосе + внизу каждого рулона. */
  const ghostCells = useMemo<GhostCell[]>(() => {
    const cellsInfo = frames.map((f) => ({ cell: f.cell, orientation: f.orientation }));
    const out: GhostCell[] = [];
    const stripCell = nextCellInStrip(cellsInfo);
    out.push({
      key: `strip-${stripCell.col}`,
      cell: stripCell,
      placement: cellToPlacement(stripCell),
      size: pageSizeMm('portrait'),
      label: 'Лист',
    });
    const rollCols = new Map<number, string | null>();
    for (const f of frames) {
      if (f.cell.row >= 1) rollCols.set(f.cell.col, f.zoneTutorStudentId);
    }
    rollCols.forEach((zoneId, col) => {
      const cell = nextCellInColumn(col, cellsInfo);
      out.push({
        key: `roll-${col}-${cell.row}`,
        cell,
        placement: cellToPlacement(cell),
        size: pageSizeMm('portrait'),
        label: zoneId ? zoneNames[zoneId] ?? 'Лист' : 'Лист',
        zoneTutorStudentId: zoneId,
      });
    });
    return out;
  }, [frames, zoneNames]);

  const createFrameAt = useCallback(
    async (cell: FrameCell, zoneTutorStudentId: string | null) => {
      if (!board || pageBusy) return;
      setPageBusy(true);
      try {
        await autosave.flush();
        const created = await createBoardPage(board.id, {
          background: activeFrame?.background ?? 'grid',
          grid_mm: activeFrame?.gridMm ?? 5,
          app_state: { orientation: 'portrait', frame: cell },
        });
        if (zoneTutorStudentId) {
          await saveBoardPage(created.id, { zone_tutor_student_id: zoneTutorStudentId });
        }
        const newFrame: FrameState = {
          // rev: создание бампит сигнал до 1, zone-patch — до 2 (протокол edge).
          ...rowToFrameState(created, framesRef.current.length, zoneTutorStudentId ? 2 : 1),
          cell,
          placement: cellToPlacement(cell),
          zoneTutorStudentId,
        };
        applyFrames([...framesRef.current, newFrame]);
        setActiveFrameId(newFrame.id);
        setSelection(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось добавить лист');
      } finally {
        setPageBusy(false);
      }
    },
    [board, pageBusy, autosave, activeFrame, applyFrames],
  );

  const handleGhostClick = useCallback(
    (ghost: GhostCell) => {
      void createFrameAt(ghost.cell, ghost.zoneTutorStudentId ?? null);
    },
    [createFrameAt],
  );

  const handleAddFrame = useCallback(async () => {
    const cellsInfo = framesRef.current.map((f) => ({ cell: f.cell, orientation: f.orientation }));
    await createFrameAt(nextCellInStrip(cellsInfo), null);
  }, [createFrameAt]);

  const handleDistributeZones = useCallback(async () => {
    if (!board || pageBusy) return;
    setPageBusy(true);
    try {
      const pages = await distributeZones(board.id);
      if (pages.length === 0) {
        toast.message('Зоны уже розданы всем ученикам занятия.');
        return;
      }
      const startIndex = framesRef.current.length;
      const added = pages.map((row, i) => rowToFrameState(row, startIndex + i, 1));
      applyFrames([...framesRef.current, ...added]);
      fitFrames(framesRef.current, viewport);
      toast.success(`Создано зон: ${pages.length}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось раздать зоны');
    } finally {
      setPageBusy(false);
    }
  }, [board, pageBusy, applyFrames, fitFrames, viewport]);

  // ─── «Пригласить на доску» (Этап 3, B4) ─────────────────────────────────────

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteSending, setInviteSending] = useState(false);

  const handleInviteOpen = useCallback(async () => {
    if (!board || inviteBusy) return;
    setInviteBusy(true);
    setInviteOpen(true);
    try {
      const slug = await ensureShareLink(board.id);
      setInviteLink(`${window.location.origin}/b/${slug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось создать ссылку');
      setInviteOpen(false);
    } finally {
      setInviteBusy(false);
    }
  }, [board, inviteBusy]);

  const handleInviteCopy = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success('Ссылка скопирована');
    } catch {
      toast.message(inviteLink); // Safari без прав на clipboard — покажем текстом
    }
  }, [inviteLink]);

  /**
   * Отправка ссылки ученикам зон в личные чаты (существующий write-path чата —
   * rule 100; пуш поедет штатным каскадом push→telegram→email). Известное
   * ограничение v1: 5-мин троттлинг уведомлений чата НЕ обходится — если
   * переписка шла только что, пуш молча схлопнется (ученик и так в чате).
   */
  const handleInviteSendToChats = useCallback(async () => {
    if (!inviteLink || inviteSending) return;
    const zoneIds = Array.from(
      new Set(
        framesRef.current
          .map((f) => f.zoneTutorStudentId)
          .filter((v): v is string => !!v),
      ),
    );
    if (zoneIds.length === 0) {
      toast.message('Сначала раздайте зоны — отправлю ссылку каждому ученику занятия.');
      return;
    }
    setInviteSending(true);
    let sent = 0;
    try {
      for (const tutorStudentId of zoneIds) {
        try {
          const { conversation_id } = await ensureChatConversation(tutorStudentId);
          await sendChatMessageApi(conversation_id, {
            content: `Присоединяйся к доске занятия: ${inviteLink}`,
            // НЕ crypto.randomUUID (rule 80, Safari < 15.4).
            client_msg_id: `board-invite-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          });
          sent += 1;
        } catch {
          // одного не нашли/чат недоступен — шлём остальным
        }
      }
      if (sent > 0) toast.success(`Отправлено в чаты: ${sent}`);
      else toast.error('Не удалось отправить ни одному ученику — скопируйте ссылку вручную.');
    } finally {
      setInviteSending(false);
    }
  }, [inviteLink, inviteSending]);

  const handleInviteRevoke = useCallback(async () => {
    if (!board || inviteBusy) return;
    if (!window.confirm('Закрыть доступ по ссылке? Все гости отключатся, ссылка перестанет работать.')) {
      return;
    }
    setInviteBusy(true);
    try {
      await revokeShareLink(board.id);
      setInviteLink(null);
      setInviteOpen(false);
      toast.success('Доступ по ссылке закрыт');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось отозвать ссылку');
    } finally {
      setInviteBusy(false);
    }
  }, [board, inviteBusy]);

  /** Импорт PDF: страница → лист-подложка в общей полосе (воркфлоу Елены). */
  const importPdf = useCallback(
    async (file: File) => {
      const currentBoard = board;
      if (!currentBoard || importProgress) return;
      setImportProgress({ done: 0, total: 0 });
      try {
        // pdf.worker — 533 КБ, поэтому только динамический import (rule performance).
        const { renderPdfPagesToFiles } = await import('@/lib/pdfToImages');
        const rendered = await renderPdfPagesToFiles(file, {
          maxPages: 30,
          onProgress: (done, total) => setImportProgress({ done, total }),
        });
        if (rendered.files.length === 0) throw new Error('В PDF не нашлось страниц');
        // Preflight лимита (ревью P1): падать ДО частичного импорта, не посреди.
        if (framesRef.current.length + rendered.files.length > MAX_BOARD_PAGES) {
          throw new Error(
            `В доске максимум ${MAX_BOARD_PAGES} листов: сейчас ${framesRef.current.length}, в PDF ${rendered.files.length}. Разбейте PDF или начните новую доску.`,
          );
        }

        for (let i = 0; i < rendered.files.length; i++) {
          setImportProgress({ done: i + 1, total: rendered.files.length });
          const cellsInfo = framesRef.current.map((f) => ({ cell: f.cell, orientation: f.orientation }));
          const cell = nextCellInStrip(cellsInfo);
          // Порядок «upload → create С elements» (ревью P1): обрыв сети больше
          // не оставляет осиротевший пустой лист — худший случай теперь
          // безвредный orphan-файл в storage.
          const uploaded = await uploadBoardImage(rendered.files[i], currentBoard.id);
          const size = pageSizeMm('portrait');
          // Подложка на всю ширину листа, высота по аспекту (кап — высота листа).
          const aspect = uploaded.naturalHeight / Math.max(1, uploaded.naturalWidth);
          const w = PAGE_WIDTH_MM;
          const h = Math.min(size.height, roundMm(w * aspect));
          const image = createImage(0, 0, w, h, uploaded.ref);
          const created = await createBoardPage(currentBoard.id, {
            background: 'blank',
            grid_mm: 5,
            app_state: { orientation: 'portrait', frame: cell },
            elements: [image],
          });
          const newFrame: FrameState = {
            ...rowToFrameState(created, framesRef.current.length, 1),
            cell,
            placement: cellToPlacement(cell),
          };
          applyFrames([...framesRef.current, newFrame]);
          void resolveBoardImageUrl(uploaded.ref).then((url) => {
            if (url) setImageUrls((prev) => ({ ...prev, [uploaded.ref]: url }));
          });
        }
        fitFrames(framesRef.current, viewport);
        toast.success(`Импортировано страниц: ${rendered.files.length}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось импортировать PDF');
      } finally {
        setImportProgress(null);
      }
    },
    [board, importProgress, applyFrames, fitFrames, viewport],
  );

  // Ctrl+V: сначала ВНУТРЕННИЙ буфер (B3), затем картинки из ОС.
  const pasteImageHandler = usePasteImages({
    compress: false,
    onImagePasted: (file) => void insertImageFiles([file]),
    successToast: null,
    telemetryTag: 'board',
  });
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (shouldUseInternalClipboard(e)) {
        e.preventDefault();
        pasteInternal();
        return;
      }
      pasteImageHandler(e as unknown as React.ClipboardEvent);
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [pasteImageHandler, pasteInternal]);

  const { dragHandlers, isDragging } = useDragDropFiles({
    compress: false,
    acceptedTypes: ['image/'],
    onFilesDropped: (files) => void insertImageFiles(files),
    successToast: null,
    telemetryTag: 'board',
  });

  // ─── Текст ──────────────────────────────────────────────────────────────────

  const commitTextDraft = useCallback(
    (expectedId?: number) => {
      const draft = textDraftRef.current;
      if (!draft) return;
      if (expectedId !== undefined && draft.id !== expectedId) return;
      if (draft.value.trim()) {
        handleCommitElement(
          draft.frameId,
          createText(draft.x, draft.y, draft.value.trim(), color, DEFAULT_TEXT_SIZE_MM),
        );
      }
      textDraftRef.current = null;
      setTextDraft(null);
    },
    [color, handleCommitElement],
  );

  const handleRequestText = useCallback(
    (frameId: string, x: number, y: number) => {
      commitTextDraft();
      textDraftSeq += 1;
      const draft = { id: textDraftSeq, frameId, x, y, value: '' };
      textDraftRef.current = draft;
      setTextDraft(draft);
      setActiveFrameId(frameId);
    },
    [commitTextDraft],
  );

  // ─── Экспорт и прикрепление (обходит рамки листами — критерий Фазы 1) ──────

  const computeSignature = useCallback(() => {
    return JSON.stringify(
      framesRef.current.map((f) => [
        f.background,
        f.gridMm,
        f.orientation,
        f.cell,
        f.elements.map((el) => `${el.id}:${el.version}`),
      ]),
    );
  }, []);

  const buildPdfBlob = useCallback(async () => {
    // Порядок — из структуры сетки (полоса → рулоны по столбцам); пустые листы
    // пропускаются (Chattern-паттерн: «сохраняются только страницы, где что-то
    // изображено» — применён к ЭКСПОРТУ, хранение не трогаем).
    // ⚠️ Решение владельца 30.07: лист с PDF-подложкой БЕЗ пометок — заполненный
    // (подложка = элемент-картинка ⇒ length > 0 уже включает его). НЕ «умнеть»
    // фильтром вида «есть ли что-то кроме подложки» — вариант из задачника,
    // отданный без решённых страниц, обязан попасть в экспорт целиком.
    const source = framesRef.current
      .slice()
      .sort((a, b) => compareCellsForExport(a.cell, b.cell))
      .filter((f) => f.elements.length > 0);
    if (source.length === 0) throw new Error('На доске нет заполненных листов');
    const refs: string[] = [];
    for (const frame of source) {
      for (const el of frame.elements) {
        if (el.type === 'image') refs.push(el.ref);
      }
    }
    const pdfImageUrls = refs.length > 0 ? await resolveImagesAsDataUrls(refs) : undefined;
    const { exportBoardToPdf } = await import('@/lib/whiteboard/exportPdf');
    return exportBoardToPdf(
      source.map((f) => ({
        elements: f.elements,
        background: f.background,
        gridMm: f.gridMm,
        orientation: f.orientation,
      })),
      {
        onPageStart: (done, total) => setExportProgress({ done, total }),
        imageUrls: pdfImageUrls,
      },
    );
  }, []);

  const handleDownload = useCallback(async () => {
    if (exportProgress) return;
    setExportProgress({ done: 0, total: framesRef.current.length });
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
    setExportProgress({ done: 0, total: framesRef.current.length });
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
      const hasContent = framesRef.current.some((f) => f.elements.length > 0);
      if (board?.lesson_id && hasContent && computeSignature() !== exportedSignatureRef.current) {
        setExitPhase('attaching');
        try {
          await attachPdfToLesson();
          toast.success('Конспект прикреплён к занятию');
        } catch (err) {
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

  // ─── Back-гард (P0 ревью р.4) ───────────────────────────────────────────────

  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);
  const boardStateRef = useRef<Board | null>(null);
  useEffect(() => {
    boardStateRef.current = board;
  }, [board]);

  useEffect(() => {
    window.history.pushState({ __boardGuard: true }, '');
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const b = boardStateRef.current;
      const attachPending =
        !!b?.lesson_id &&
        framesRef.current.some((f) => f.elements.length > 0) &&
        computeSignature() !== exportedSignatureRef.current;
      const needsGuard = saveStatusRef.current !== 'saved' || attachPending;
      if (!needsGuard) {
        window.history.back();
        return;
      }
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

  // frameViews — useMemo ОБЯЗАТЕЛЕН (ревью P1): без него каждый setCamera
  // пересоздавал все FrameView, comparator FrameLayer падал на первом же
  // `prev.frame === next.frame` и малый пан ререндерил все видимые листы,
  // обесценивая квантованный cull. Зависит от frames/zoneNames — НЕ от камеры.
  const frameViews: FrameView[] = useMemo(() => {
    let stripCounter = 0;
    return frames.map((f) => {
      const zoneName = f.zoneTutorStudentId ? zoneNames[f.zoneTutorStudentId] ?? 'Ученик' : null;
      // Подписи человеческие («Лист 3 · Маша»), НЕ координаты [0:0] — челлендж Chattern.
      const title = zoneName
        ? `${zoneName} · ${f.cell.row}`
        : `Лист ${f.cell.row === 0 ? ++stripCounter : `${f.cell.col + 1}.${f.cell.row}`}`;
      return {
        id: f.id,
        placement: f.placement,
        size: pageSizeMm(f.orientation),
        background: f.background,
        gridMm: f.gridMm,
        elements: f.elements,
        title,
        isZone: !!f.zoneTutorStudentId,
      };
    });
  }, [frames, zoneNames]);

  const frameSummaries = useMemo(
    () =>
      frames.map((f) => ({
        id: f.id,
        elements: f.elements,
        background: f.background,
        gridMm: f.gridMm,
        orientation: f.orientation,
      })),
    [frames],
  );

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

  const exporting = exportProgress !== null;
  const activeIndex = Math.max(0, frames.findIndex((f) => f.id === (activeFrame?.id ?? '')));

  const textDraftFrame = textDraft ? frames.find((f) => f.id === textDraft.frameId) : null;
  const textDraftPx = textDraft && textDraftFrame
    ? worldToViewportPx(
        textDraftFrame.placement.x + textDraft.x,
        textDraftFrame.placement.y + textDraft.y,
        camera,
        viewport,
      )
    : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleExit()}
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
            variant="outline"
            size="sm"
            onClick={() => void handleDistributeZones()}
            disabled={pageBusy || exitPhase !== null}
            style={{ touchAction: 'manipulation' }}
          >
            <Users className="mr-1.5 h-4 w-4" />
            <span className="hidden sm:inline">Раздать зоны</span>
            <span className="sm:hidden">Зоны</span>
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleInviteOpen()}
          disabled={inviteBusy}
          style={{ touchAction: 'manipulation' }}
        >
          <UserPlus className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">Пригласить</span>
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
        background={activeFrame?.background ?? 'grid'}
        onBackgroundChange={(background) => activeFrame && patchFrame(activeFrame.id, { background })}
        gridMm={activeFrame?.gridMm ?? 5}
        onGridMmChange={(gridMm: BoardGridMm) => activeFrame && patchFrame(activeFrame.id, { gridMm })}
        orientation={activeFrame?.orientation ?? 'portrait'}
        onOrientationChange={handleOrientationChange}
        onPickImage={() => fileInputRef.current?.click()}
        onImportPdf={() => pdfInputRef.current?.click()}
        camera={{
          zoomPercent: Math.round((camera.zoom / HUNDRED_PERCENT_ZOOM) * 100),
          onZoomIn: () =>
            setCamera((c) => zoomCameraAt(c, 1.25, { x: c.cx, y: c.cy })),
          onZoomOut: () =>
            setCamera((c) => zoomCameraAt(c, 0.8, { x: c.cx, y: c.cy })),
          onFitFrame: () => activeFrame && fitSingleFrame(activeFrame, viewport),
          onFitAll: () => fitFrames(framesRef.current, viewport),
        }}
        canUndo={historyState.canUndo}
        canRedo={historyState.canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        disabled={pageBusy}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) void insertImageFiles(files);
        }}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importPdf(file);
        }}
      />

      <div ref={viewportRef} className="relative min-h-0 flex-1" {...dragHandlers}>
        <BoardCanvas
          frames={frameViews}
          camera={camera}
          viewport={viewport}
          onCameraChange={setCamera}
          tool={tool}
          color={color}
          size={size}
          selection={selection}
          readOnly={pageBusy}
          imageUrls={imageUrls}
          onSelectionChange={setSelection}
          onCommitElement={handleCommitElement}
          onEraseElements={handleEraseElements}
          onMoveSelection={handleMoveSelection}
          onTransformElement={handleTransformElement}
          onRequestText={handleRequestText}
          ghostCells={ghostCells}
          onGhostClick={handleGhostClick}
        />

        {textDraft && textDraftPx && (
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
                e.preventDefault();
                commitTextDraft(textDraft.id);
              }
            }}
            placeholder="Текст. Enter — готово, Esc — отмена"
            style={{ left: `${textDraftPx.x}px`, top: `${textDraftPx.y}px` }}
            className="absolute z-10 min-h-[44px] w-56 resize-none rounded-md border border-accent bg-white p-2 text-base shadow-sm focus:outline-none"
          />
        )}

        {isDragging && (
          <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/5">
            <span className="rounded-md bg-white px-3 py-1.5 text-sm text-accent shadow-sm">
              Отпустите, чтобы добавить на лист
            </span>
          </div>
        )}
      </div>

      <PagesPanel
        pages={frameSummaries}
        activeIndex={activeIndex}
        disabled={pageBusy}
        onSelect={handleSelectFrame}
        onAdd={() => void handleAddFrame()}
        onDelete={(index) => void handleDeleteFrame(index)}
      />

      {importProgress && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80">
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-md">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <span className="text-slate-700">
              Импортируем PDF… {importProgress.total > 0 ? `${importProgress.done}/${importProgress.total}` : ''}
            </span>
          </div>
        </div>
      )}

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

      {/* Приглашение на доску (B4): ссылка-bearer. Отзыв = все гости отваливаются
          на следующем запросе (см. tasks.md — «зачем отзыв»). */}
      {inviteOpen && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4"
          onClick={() => setInviteOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-slate-900">Пригласить на доску</h2>
            <p className="mt-1 text-sm text-slate-500">
              Ученик откроет доску по ссылке — без регистрации. Писать сможет только в своей зоне.
            </p>
            {inviteBusy || !inviteLink ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <>
                <div className="mt-4 flex items-center gap-2">
                  <input
                    readOnly
                    value={inviteLink}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-11 min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 text-base text-slate-700"
                  />
                  <Button variant="outline" onClick={() => void handleInviteCopy()} style={{ touchAction: 'manipulation' }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => void handleInviteSendToChats()}
                    disabled={inviteSending}
                    style={{ touchAction: 'manipulation' }}
                  >
                    {inviteSending ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-1.5 h-4 w-4" />
                    )}
                    Отправить ученикам в чат
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => void handleInviteRevoke()}
                    style={{ touchAction: 'manipulation' }}
                  >
                    Закрыть доступ
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
