import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Copy, Download, Eye, Loader2, Magnet, Paperclip, Send, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  BoardCanvas,
  type BoardSelection,
  type BoardTool,
  type FrameView,
  type GhostCell,
  type RemoteCursor,
} from '@/components/whiteboard/BoardCanvas';
import {
  connectBoardLive,
  stablePeerColor,
  FOLLOW_PING_MS,
  type BoardLiveControls,
  type LivePeer,
} from '@/lib/whiteboard/boardLive';
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
  listBoardGuests,
  saveBoardPage,
  updateBoard,
  type BoardGuestRow,
} from '@/lib/whiteboardApi';
import { getTutorStudents } from '@/lib/tutors';
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
  cameraWorldWindow,
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
  scaleElement,
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
import { ensureShareLink, revokeShareLink, sendBoardBring } from '@/lib/whiteboardApi';
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
  /** Лист гостя без аккаунта («Лист — каждому вошедшему»). */
  zoneGuestId: string | null;
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
    zoneGuestId: row.zone_guest_id ?? null,
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
  const imageUrlsRef = useRef(imageUrls);
  imageUrlsRef.current = imageUrls;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const failedImageRefsRef = useRef<Set<string>>(new Set());
  /** refs, чей signed URL уже резолвится — не запускать повторный резолв. */
  const inFlightImageRefsRef = useRef<Set<string>>(new Set());

  const framesRef = useRef<FrameState[]>([]);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  /** Щит reconcile (ревью P2): элементы активного выделения не отдаём remote. */
  const selectionRef = useRef<BoardSelection | null>(null);
  selectionRef.current = selection;
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
          const protectedIds =
            selectionRef.current && selectionRef.current.frameId === pageId
              ? new Set(selectionRef.current.ids)
              : undefined;
          const { merged, divergesFromRemote } = reconcileElements(frame.elements, remote, protectedIds);
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
      if (!rect || rect.width <= 0) return;
      // Округление + value-equality bail-out: дробные contentRect под Windows
      // display scaling и presence-флапы полосы участников иначе дёргают
      // ре-рендер всего SVG на каждый чих (вклад в React #185, 2026-07-28).
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      setViewport((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
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
      // rev — встроенным селектом: ОДИН DB-снимок elements+rev (ревью P0 —
      // раздельные чтения давали «старые elements + новый rev», и следующий
      // сейв законно затирал более свежую сцену).
      const { data: row } = await supabase
        .from('board_pages')
        .select(
          'id, page_index, elements, app_state, background, grid_mm, zone_tutor_student_id, zone_guest_id, board_page_revs(rev)',
        )
        .eq('id', pageId)
        .maybeSingle();
      if (!row) return;
      const embedded = (row as { board_page_revs?: { rev?: number } | { rev?: number }[] | null })
        .board_page_revs;
      const revRow = Array.isArray(embedded) ? embedded[0] : embedded;
      const freshRev = Number(revRow?.rev) || knownRev;
      const parsed = rowToFrameState(row as unknown as BoardPageRow, framesRef.current.length, freshRev);
      const existing = framesRef.current.find((f) => f.id === pageId);
      if (!existing) {
        // Ученик добавил лист в свой рулон.
        applyFrames([...framesRef.current, parsed]);
        return;
      }
      // Пока ждали сеть, параллельный refetch/сейв мог уйти вперёд —
      // устаревший снапшот не применяем (ревью P0: обратный порядок применений).
      if (existing.rev >= freshRev) return;
      // Merge, не replace: локальная незасейвленная грязь репетитора переживает
      // чужие правки (rule 100-паттерн; reconcile по version/versionNonce).
      // Щит: элементы активного выделения (move/resize) не отдаются remote-версии.
      const protectedIds = selectionRef.current && selectionRef.current.frameId === pageId
        ? new Set(selectionRef.current.ids)
        : undefined;
      const { merged } = reconcileElements(existing.elements, parsed.elements, protectedIds);
      patchFrameSilently(pageId, {
        elements: merged,
        rev: freshRev,
        zoneTutorStudentId: parsed.zoneTutorStudentId,
        zoneGuestId: parsed.zoneGuestId,
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

  // ─── Live-канал (Этап 4, B1): участники, курсоры, follow, bring ─────────────

  const [livePeers, setLivePeers] = useState<LivePeer[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor & { at: number }>>({});
  const [followKey, setFollowKey] = useState<string | null>(null);
  const [followName, setFollowName] = useState('');
  const liveRef = useRef<BoardLiveControls | null>(null);
  const followKeyRef = useRef<string | null>(null);
  const peerViewportsRef = useRef(new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>());
  const viewportStateRef = useRef(viewport);
  viewportStateRef.current = viewport;

  const stopFollow = useCallback((notifyPeer = true) => {
    const key = followKeyRef.current;
    if (!key) return;
    followKeyRef.current = null;
    setFollowKey(null);
    if (notifyPeer) liveRef.current?.sendFollow(key, false);
  }, []);

  const startFollow = useCallback((peer: LivePeer) => {
    followKeyRef.current = peer.key;
    setFollowKey(peer.key);
    setFollowName(peer.name);
    liveRef.current?.sendFollow(peer.key, true);
    const known = peerViewportsRef.current.get(peer.key);
    if (known) setCamera(cameraToFitBounds(known, viewportStateRef.current));
  }, []);

  useEffect(() => {
    if (!boardIdForSync) return;
    const controls = connectBoardLive(
      boardIdForSync,
      { key: 'tutor', name: 'Репетитор', role: 'tutor' },
      {
        onPeers: (peers) => {
          setLivePeers(peers);
          // Ученик закрыл вкладку — не «замораживаем» камеру на его последнем виде.
          if (followKeyRef.current && !peers.some((p) => p.key === followKeyRef.current)) {
            stopFollow(false);
          }
        },
        onViewport: (e) => {
          peerViewportsRef.current.set(e.key, e.bounds);
          if (followKeyRef.current === e.key) {
            // fit-contain: показываем ВСЁ окно ученика, его зум буквально не копируем.
            // Value-equality bail-out: события идут ~2 Гц, и неподвижный ученик
            // не должен ре-рендерить доску каждые 500 мс (гигиена React #185).
            const next = cameraToFitBounds(e.bounds, viewportStateRef.current);
            setCamera((prev) =>
              prev.cx === next.cx && prev.cy === next.cy && prev.zoom === next.zoom ? prev : next,
            );
          }
        },
        onCursor: (e) => {
          setRemoteCursors((prev) => ({
            ...prev,
            [e.key]: { key: e.key, name: e.name, color: stablePeerColor(e.key), x: e.x, y: e.y, at: Date.now() },
          }));
        },
        onStatus: setLiveStatus,
      },
    );
    liveRef.current = controls;
    return () => {
      liveRef.current = null;
      controls.leave();
    };
  }, [boardIdForSync, stopFollow]);

  // Курсор без событий 6 с — участник ушёл с холста; убираем, не копим навечно.
  useEffect(() => {
    const timer = setInterval(() => {
      setRemoteCursors((prev) => {
        const now = Date.now();
        const alive = Object.values(prev).filter((c) => now - c.at < 6000);
        return alive.length === Object.keys(prev).length
          ? prev
          : Object.fromEntries(alive.map((c) => [c.key, c]));
      });
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  // Свой viewport — слушателям (троттл 500 мс и «только при peers>0» внутри lib).
  useEffect(() => {
    liveRef.current?.sendViewport(cameraWorldWindow(camera, viewport));
  }, [camera, viewport]);

  // Пинг follow каждые 10 с: у ученика бейдж «репетитор смотрит» гаснет сам
  // по таймауту — обрыв WS не оставляет его гореть вечно.
  useEffect(() => {
    if (!followKey) return;
    const timer = setInterval(() => liveRef.current?.sendFollow(followKey, true), FOLLOW_PING_MS);
    return () => clearInterval(timer);
  }, [followKey]);

  /** Собственный жест камеры выходит из follow (план: авто-выход по own-pan). */
  const handleCameraChange = useCallback(
    (cam: CameraState) => {
      if (followKeyRef.current) stopFollow();
      setCamera(cam);
    },
    [stopFollow],
  );

  const [bringBusy, setBringBusy] = useState(false);
  const handleBringAll = useCallback(async () => {
    if (!board || bringBusy) return;
    setBringBusy(true);
    try {
      const bounds = cameraWorldWindow(cameraRef.current, viewportStateRef.current);
      // Ученикам — мгновенно broadcast'ом; гостям — персист (поллинг ≤2.5 с).
      liveRef.current?.sendBring(bounds);
      await sendBoardBring(board.id, bounds);
      toast.success('Участники переведены к вашему виду');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось позвать участников');
    } finally {
      setBringBusy(false);
    }
  }, [board, bringBusy]);

  const cursorList = useMemo(() => Object.values(remoteCursors), [remoteCursors]);
  const handleCursorMove = useCallback((x: number, y: number) => {
    liveRef.current?.sendCursor(x, y);
  }, []);

  // ─── Участники (Этап 5): ученики, ГОСТИ, статус live-канала ─────────────────
  //
  // «Не увидели друг друга» (Елена/Егор 30.07): ученики заходят гостями по
  // /b/-ссылке, а гости не входят в live-presence (нет JWT) — репетитор их не
  // видел ВООБЩЕ. Гости подтягиваются поллингом last_seen_at раз в 10 с.

  const [liveStatus, setLiveStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [guests, setGuests] = useState<BoardGuestRow[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);

  /** Имена гостей для подписей рамок и селекта «чей лист» (включая офлайн-владельцев). */
  const guestNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of guests) map[g.id] = g.display_name || 'Участник';
    return map;
  }, [guests]);
  /** Чипы панели — только кто СЕЙЧАС на доске. */
  const onlineGuests = useMemo(() => guests.filter((g) => g.online !== false), [guests]);

  useEffect(() => {
    let cancelled = false;
    void getTutorStudents()
      .then((list) => {
        if (cancelled) return;
        setStudents(list.map((s) => ({ id: s.id, name: s.display_name || 'Ученик' })));
      })
      .catch(() => undefined); // без списка просто нет пикера зон/владельца листа
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!boardIdForSync) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      try {
        const list = await listBoardGuests(boardIdForSync);
        if (cancelled) return;
        // Сигнатурное сравнение (ревью Этапа 5, P2): last_seen_at меняется
        // каждым поллом, а UI его не показывает — свежий массив каждые 10 с
        // ре-рендерил всю страницу вместе с немемоизированным BoardCanvas.
        // online В сигнатуре (ревью guest-sheets, P2): его смена и есть
        // событие «гость вошёл/вышел»; сортировка — канонический порядок.
        setGuests((prev) => {
          const sig = (arr: BoardGuestRow[]) =>
            arr
              .map((g) => `${g.id}|${g.display_name}|${g.tutor_student_id ?? ''}|${g.online === false ? 0 : 1}`)
              .sort()
              .join(';');
          return sig(prev) === sig(list) ? prev : list;
        });
      } catch {
        // следующий тик повторит
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [boardIdForSync]);

  // ─── «Чей лист» (Этап 5, модель Елены): зона НА СУЩЕСТВУЮЩЕМ листе ──────────

  const [ownerBusy, setOwnerBusy] = useState(false);
  /**
   * ownerKey: null — общий лист; `guest:<id>` — гость по ссылке; иначе —
   * tutor_students.id. Сервер зануляет вторую привязку сам (CHECK в БД).
   */
  const handleAssignSheetOwner = useCallback(
    async (ownerKey: string | null) => {
      const frame = activeFrame;
      if (!frame || ownerBusy) return;
      const newGuestId = ownerKey?.startsWith('guest:') ? ownerKey.slice(6) : null;
      const newStudentId = ownerKey && !newGuestId ? ownerKey : null;
      setOwnerBusy(true);
      try {
        const outcome = await saveBoardPage(
          frame.id,
          newGuestId
            ? { zone_guest_id: newGuestId }
            : newStudentId
              ? { zone_tutor_student_id: newStudentId }
              : { zone_tutor_student_id: null, zone_guest_id: null },
        );
        patchFrameSilently(frame.id, {
          zoneTutorStudentId: newStudentId,
          zoneGuestId: newGuestId,
          ...(typeof outcome.rev === 'number' && outcome.rev > 0 ? { rev: outcome.rev } : {}),
        });
        if (newStudentId) {
          const s = students.find((x) => x.id === newStudentId);
          if (s) setZoneNames((prev) => ({ ...prev, [newStudentId]: s.name }));
          toast.success(`Лист отдан: ${s?.name ?? 'ученик'} может писать на нём`);
        } else if (newGuestId) {
          toast.success(`Лист отдан: ${guestNames[newGuestId] ?? 'участник'} может писать на нём`);
        } else {
          toast.success('Лист снова общий');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось назначить лист');
      } finally {
        setOwnerBusy(false);
      }
    },
    [activeFrame, ownerBusy, students, guestNames, patchFrameSilently],
  );

  // ─── Пикер учеников для «Раздать зоны» на доске без занятия (Этап 5) ────────

  const [zonesPickerOpen, setZonesPickerOpen] = useState(false);
  const [zonesSelected, setZonesSelected] = useState<ReadonlySet<string>>(new Set());

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

  /** Масштаб выделения за угол (Этап 5, Елена/Вадим). */
  const handleScaleSelection = useCallback(
    (frameId: string, factor: number, originX: number, originY: number) => {
      if (!selection || selection.frameId !== frameId) return;
      const scaling = new Set(selection.ids);
      updateFrameElements(frameId, (elements) =>
        elements.map((el) => (scaling.has(el.id) ? scaleElement(el, factor, originX, originY) : el)),
      );
    },
    [selection, updateFrameElements],
  );

  /** Клик по цвету при активном выделении = перекраска выделенного (Этап 5, Вадим). */
  const handleColorChange = useCallback(
    (next: string) => {
      setColor(next);
      const sel = selectionRef.current;
      if (!sel || sel.ids.length === 0) return;
      const ids = new Set(sel.ids);
      updateFrameElements(sel.frameId, (elements) =>
        elements.map((el) =>
          ids.has(el.id) && el.type !== 'image' ? bumpVersion(el, { color: next }) : el,
        ),
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

  // `imageUrls` читается через ref, НЕ через deps: `frames` меняется на каждом
  // штрихе, и пока батч signed-URL резолвится, эффект с депом `imageUrls`
  // перезапускался и заново резолвил те же refs (шторм запросов, вклад в
  // React #185 2026-07-28). In-flight refs дополнительно исключаются.
  useEffect(() => {
    const refs = new Set<string>();
    for (const frame of frames) {
      for (const el of frame.elements) {
        if (el.type === 'image') refs.add(el.ref);
      }
    }
    const missing = Array.from(refs).filter(
      (ref) =>
        !imageUrlsRef.current[ref] &&
        !failedImageRefsRef.current.has(ref) &&
        !inFlightImageRefsRef.current.has(ref),
    );
    if (missing.length === 0) return;
    for (const ref of missing) inFlightImageRefsRef.current.add(ref);
    let cancelled = false;
    void (async () => {
      const resolved: ImageUrlMap = {};
      for (let i = 0; i < missing.length; i++) {
        const url = await resolveBoardImageUrl(missing[i]);
        if (url) resolved[missing[i]] = url;
        else failedImageRefsRef.current.add(missing[i]);
        inFlightImageRefsRef.current.delete(missing[i]);
      }
      if (!cancelled && Object.keys(resolved).length > 0) {
        setImageUrls((prev) => ({ ...prev, ...resolved }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [frames]);

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
  const zoneNamesRef = useRef(zoneNames);
  zoneNamesRef.current = zoneNames;
  /** id, которых запрос не вернул (удалённый ученик / RLS) — не переспрашивать. */
  const unresolvedZoneIdsRef = useRef<Set<string>>(new Set());
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

  // Имена учеников для подписей зон (репетиторский RLS на tutor_students).
  // ⚠️ React #185 (2026-07-28, прод): раньше `zoneNames` был в deps, а setState
  // всегда создавал новый объект → если хоть один id не резолвился, эффект
  // крутился бесконечно с Supabase-запросом на каждой итерации. Теперь:
  // zoneNames читается через ref, нерезолвящиеся id запоминаются и не
  // переспрашиваются, пустой результат не трогает state.
  useEffect(() => {
    const ids = Array.from(
      new Set(frames.map((f) => f.zoneTutorStudentId).filter((id): id is string => !!id)),
    ).filter((id) => !zoneNamesRef.current[id] && !unresolvedZoneIdsRef.current.has(id));
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('tutor_students')
        .select('id, display_name')
        .in('id', ids);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      const returned = new Set<string>();
      for (const row of data) {
        returned.add(row.id);
        next[row.id] = row.display_name ?? 'Ученик';
      }
      for (const id of ids) {
        if (!returned.has(id)) unresolvedZoneIdsRef.current.add(id);
      }
      if (Object.keys(next).length > 0) {
        setZoneNames((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [frames]);

  /** Плюсы сетки: один справа в полосе + внизу каждого рулона (ученики И гости). */
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
    const rollCols = new Map<number, { studentId: string | null; guestId: string | null }>();
    for (const f of frames) {
      if (f.cell.row >= 1) {
        rollCols.set(f.cell.col, { studentId: f.zoneTutorStudentId, guestId: f.zoneGuestId });
      }
    }
    rollCols.forEach((binding, col) => {
      const cell = nextCellInColumn(col, cellsInfo);
      out.push({
        key: `roll-${col}-${cell.row}`,
        cell,
        placement: cellToPlacement(cell),
        size: pageSizeMm('portrait'),
        label: binding.studentId
          ? zoneNames[binding.studentId] ?? 'Лист'
          : binding.guestId
            ? guestNames[binding.guestId] ?? 'Лист'
            : 'Лист',
        zoneTutorStudentId: binding.studentId,
        zoneGuestId: binding.guestId,
      });
    });
    return out;
  }, [frames, zoneNames, guestNames]);

  const createFrameAt = useCallback(
    async (
      cell: FrameCell,
      binding: { studentId?: string | null; guestId?: string | null },
    ) => {
      if (!board || pageBusy) return;
      setPageBusy(true);
      try {
        await autosave.flush();
        const created = await createBoardPage(board.id, {
          background: activeFrame?.background ?? 'grid',
          grid_mm: activeFrame?.gridMm ?? 5,
          app_state: { orientation: 'portrait', frame: cell },
          // Гость — привязка сразу в create (один вызов, rev=1).
          ...(binding.guestId ? { zone_guest_id: binding.guestId } : {}),
        });
        if (binding.studentId) {
          await saveBoardPage(created.id, { zone_tutor_student_id: binding.studentId });
        }
        const newFrame: FrameState = {
          // rev: создание бампит сигнал до 1, zone-patch ученика — до 2.
          ...rowToFrameState(created, framesRef.current.length, binding.studentId ? 2 : 1),
          cell,
          placement: cellToPlacement(cell),
          zoneTutorStudentId: binding.studentId ?? null,
          zoneGuestId: binding.guestId ?? null,
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
      void createFrameAt(ghost.cell, {
        studentId: ghost.zoneTutorStudentId ?? null,
        guestId: ghost.zoneGuestId ?? null,
      });
    },
    [createFrameAt],
  );

  const handleAddFrame = useCallback(async () => {
    const cellsInfo = framesRef.current.map((f) => ({ cell: f.cell, orientation: f.orientation }));
    await createFrameAt(nextCellInStrip(cellsInfo), {});
  }, [createFrameAt]);

  const runDistributeZones = useCallback(
    async (studentIds?: string[]) => {
      if (!board || pageBusy) return;
      setPageBusy(true);
      try {
        const pages = await distributeZones(board.id, studentIds);
        if (pages.length === 0) {
          toast.message('Зоны уже розданы этим ученикам.');
          return;
        }
        const startIndex = framesRef.current.length;
        const added = pages.map((row, i) => rowToFrameState(row, startIndex + i, 1));
        applyFrames([...framesRef.current, ...added]);
        fitFrames(framesRef.current, viewport);
        toast.success(`Создано зон: ${pages.length}. Ученики пишут каждый на своих листах.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось раздать зоны');
      } finally {
        setPageBusy(false);
      }
    },
    [board, pageBusy, applyFrames, fitFrames, viewport],
  );

  /** Кнопка «Раздать зоны»: доска занятия — авто по группе; иначе — пикер (Этап 5). */
  const handleDistributeZones = useCallback(async () => {
    if (!board) return;
    if (board.lesson_id) {
      await runDistributeZones();
      return;
    }
    setZonesSelected(new Set());
    setZonesPickerOpen(true);
  }, [board, runDistributeZones]);

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
      const ownerName = f.zoneTutorStudentId
        ? zoneNames[f.zoneTutorStudentId] ?? 'Ученик'
        : f.zoneGuestId
          ? guestNames[f.zoneGuestId] ?? 'Участник'
          : null;
      // Подписи человеческие («Лист 3 · Маша»), НЕ координаты [0:0] — челлендж Chattern.
      const title = ownerName
        ? `${ownerName} · ${f.cell.row}`
        : `Лист ${f.cell.row === 0 ? ++stripCounter : `${f.cell.col + 1}.${f.cell.row}`}`;
      return {
        id: f.id,
        placement: f.placement,
        size: pageSizeMm(f.orientation),
        background: f.background,
        gridMm: f.gridMm,
        elements: f.elements,
        title,
        isZone: !!f.zoneTutorStudentId || !!f.zoneGuestId,
      };
    });
  }, [frames, zoneNames, guestNames]);

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

        {/* «Раздать зоны» уехала ИЗ шапки в диалог «Пригласить» (дискавери
            31.07): главный путь — лист выдаётся ПРИШЕДШЕМУ сам; раскладка по
            CRM-списку — подготовка ДО урока, вторичный сценарий. */}

        {/* Всегда видима (ревью P1): гости НЕ входят в live-presence, а
            persisted-bring сделан именно для них — гейт по livePeers прятал
            кнопку на уроке «только гости». */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleBringAll()}
          disabled={bringBusy}
          title="Перевести всех участников к вашему виду"
          style={{ touchAction: 'manipulation' }}
        >
          {bringBusy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Magnet className="mr-1.5 h-4 w-4" />
          )}
          <span className="hidden sm:inline">Ко мне</span>
        </Button>

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
        onColorChange={handleColorChange}
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
        sheetOwner={
          activeFrame && (students.length > 0 || guests.length > 0)
            ? {
                value: activeFrame.zoneGuestId
                  ? `guest:${activeFrame.zoneGuestId}`
                  : activeFrame.zoneTutorStudentId,
                options: [
                  ...students,
                  // Гости по ссылке (не из CRM): офлайн-владельцы тоже в списке —
                  // лист можно переназначить и после их отключения.
                  ...guests
                    .filter((g) => !g.tutor_student_id)
                    .map((g) => ({
                      id: `guest:${g.id}`,
                      name: `${g.display_name || 'Участник'}${g.online === false ? ' (не в сети)' : ' — по ссылке'}`,
                    })),
                ],
                onChange: (id) => void handleAssignSheetOwner(id),
              }
            : undefined
        }
        camera={{
          zoomPercent: Math.round((camera.zoom / HUNDRED_PERCENT_ZOOM) * 100),
          // Кнопки камеры = свой жест → выход из follow (как own-pan).
          onZoomIn: () => {
            stopFollow();
            setCamera((c) => zoomCameraAt(c, 1.25, { x: c.cx, y: c.cy }));
          },
          onZoomOut: () => {
            stopFollow();
            setCamera((c) => zoomCameraAt(c, 0.8, { x: c.cx, y: c.cy }));
          },
          onFitFrame: () => {
            if (!activeFrame) return;
            stopFollow();
            fitSingleFrame(activeFrame, viewport);
          },
          onFitAll: () => {
            stopFollow();
            fitFrames(framesRef.current, viewport);
          },
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

      {/* Панель участников (Этап 5): видна ВСЕГДА — «Следовать» и состав доски
          дискаверабельны и на пустой доске. Ученики с аккаунтом — из presence
          (клик = follow); ГОСТИ — из поллинга last_seen_at (follow недоступен:
          у гостя нет live-канала, v1). */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1.5">
        <span className="shrink-0 text-xs text-slate-400">На доске:</span>
        {livePeers.map((peer) => (
          <button
            key={peer.key}
            type="button"
            onClick={() => (followKey === peer.key ? stopFollow() : startFollow(peer))}
            title={followKey === peer.key ? 'Перестать следовать' : `Следовать за: ${peer.name}`}
            style={{ touchAction: 'manipulation' }}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm transition-colors ${
              followKey === peer.key
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: stablePeerColor(peer.key) }}
            />
            {peer.name}
            {followKey === peer.key && <Eye className="h-3.5 w-3.5" />}
          </button>
        ))}
        {onlineGuests.map((g) => (
          <span
            key={g.id}
            title="Вошёл по ссылке-приглашению. «Следовать» доступно только ученикам с аккаунтом."
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-sm text-slate-600"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: stablePeerColor(`guest:${g.tutor_student_id ?? g.id}`) }}
            />
            {g.display_name}
          </span>
        ))}
        {livePeers.length === 0 && onlineGuests.length === 0 && (
          <>
            <span className="shrink-0 text-sm text-slate-500">пока никого</span>
            <button
              type="button"
              onClick={() => void handleInviteOpen()}
              style={{ touchAction: 'manipulation' }}
              className="shrink-0 text-sm font-medium text-accent hover:underline"
            >
              Пригласить учеников
            </button>
          </>
        )}
        {liveStatus === 'error' && (
          <span
            title="Живые обновления (курсоры, «Следовать») сейчас не работают — содержимое листов всё равно синхронизируется."
            className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-amber-600"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            без живых обновлений
          </span>
        )}
      </div>

      <div ref={viewportRef} className="relative min-h-0 flex-1" {...dragHandlers}>
        <BoardCanvas
          frames={frameViews}
          camera={camera}
          viewport={viewport}
          onCameraChange={handleCameraChange}
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
          onScaleSelection={handleScaleSelection}
          onRequestText={handleRequestText}
          ghostCells={ghostCells}
          onGhostClick={handleGhostClick}
          remoteCursors={cursorList}
          onCursorMove={handleCursorMove}
        />

        {followKey && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-slate-900/85 px-4 py-1.5 text-sm text-white shadow-md">
            Следуете за: {followName} · двиньте холст, чтобы выйти
          </div>
        )}

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
              Ученик откроет доску по ссылке без регистрации, назовётся — и сразу получит свой лист. Вы увидите его в панели «На доске».
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
                {/* Вторичный сценарий: разложить листы по ученикам ДО урока. */}
                <button
                  type="button"
                  onClick={() => {
                    setInviteOpen(false);
                    void handleDistributeZones();
                  }}
                  style={{ touchAction: 'manipulation' }}
                  className="mt-4 text-sm text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                >
                  Подготовить листы заранее — раздать зоны ученикам из списка
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Пикер учеников для «Раздать зоны» на доске без занятия (Этап 5,
          провал теста Елены: «не нашла, как выдать зону»). */}
      {zonesPickerOpen && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4"
          onClick={() => setZonesPickerOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-slate-900">Раздать зоны</h2>
            <p className="mt-1 text-sm text-slate-500">
              У каждого выбранного ученика появится свой столбец листов — он сможет писать только в нём, а вы видите всех сразу.
            </p>
            {students.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">
                Сначала добавьте учеников в разделе «Ученики».
              </p>
            ) : (
              <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto">
                {students.map((s) => {
                  const checked = zonesSelected.has(s.id);
                  return (
                    <li key={s.id}>
                      <label
                        style={{ touchAction: 'manipulation' }}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-base text-slate-800 transition-colors hover:border-accent/60"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setZonesSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(s.id)) next.delete(s.id);
                              else next.add(s.id);
                              return next;
                            });
                          }}
                          className="h-4 w-4 accent-[#1B6B4A]"
                        />
                        {s.name}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setZonesPickerOpen(false)} style={{ touchAction: 'manipulation' }}>
                Отмена
              </Button>
              <Button
                disabled={zonesSelected.size === 0 || pageBusy}
                onClick={() => {
                  setZonesPickerOpen(false);
                  void runDistributeZones(Array.from(zonesSelected));
                }}
                style={{ touchAction: 'manipulation' }}
              >
                {pageBusy ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Users className="mr-1.5 h-4 w-4" />
                )}
                Раздать зоны{zonesSelected.size > 0 ? ` (${zonesSelected.size})` : ''}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
