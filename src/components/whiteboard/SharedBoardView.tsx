import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Eraser, Eye, Loader2, Maximize, MousePointer2, PenLine, Plus, Redo2, Type, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  BoardCanvas,
  type BoardSelection,
  type BoardTool,
  type FrameView,
  type RemoteCursor,
} from '@/components/whiteboard/BoardCanvas';
import {
  shouldApplyBring,
  stablePeerColor,
  FOLLOW_STALE_MS,
  type BoardLiveControls,
  type BoardLiveHandlers,
  type LivePeer,
} from '@/lib/whiteboard/boardLive';
import { parseFrameRow, type SharedFrame } from '@/lib/whiteboard/frameRows';
import type { SaveResult } from '@/lib/whiteboardStudentApi';
import {
  type BoardBounds,
  type BoardElement,
  type CameraState,
  BOARD_COLORS,
  DEFAULT_PEN_SIZE_MM,
  DEFAULT_TEXT_SIZE_MM,
  PEN_SIZES_MM,
  cameraToFitBounds,
  cameraWorldWindow,
  createText,
  frameWorldBounds,
  pageSizeMm,
  translateElement,
  worldToViewportPx,
  zoomCameraAt,
} from '@/lib/whiteboard/model';
import { reconcileElements } from '@/lib/whiteboard/reconcile';
import { AutosaveQueue, type AutosaveStatus } from '@/lib/whiteboard/autosaveQueue';
import { SceneHistory } from '@/lib/whiteboard/sceneHistory';

// Общий вью доски для УЧЕНИКА и ГОСТЯ (Этап 3). Транспорт — инъекция:
// ученик = PostgREST+edge+Realtime, гость = whiteboard-public+поллинг.
// Пишет участник ТОЛЬКО в свою зону (writable на FrameView + сервер enforce'ит).
//
// Синк: чужой rev-сигнал → refetch листа → reconcileElements (LWW по
// version/versionNonce) — merge, НИКОГДА не invalidate/replace при локальной
// грязи (rule 100-паттерн). 409 при сохранении → reconcile → немедленный
// повтор с новым base_rev; второй конфликт подряд — отдаём очереди (ретрай).

export interface SharedBoardTransport {
  load(): Promise<{
    boardTitle: string | null;
    myZoneStudentId: string | null;
    zoneNames: Record<string, string>;
    imageUrls: Record<string, string>;
    frames: SharedFrame[];
  }>;
  savePage(pageId: string, elements: BoardElement[], baseRev: number): Promise<SaveResult>;
  refetchPage(pageId: string): Promise<{ row: Record<string, unknown>; rev: number } | null>;
  /** Подписка на чужие изменения (realtime или поллинг). Возвращает cleanup. */
  start(handlers: {
    onRemote: (pageId: string, rev: number) => void;
    onResync: () => void;
    /** «Привести всех» из поллинга (гость; Этап 4). Дедуп по seq — у вызывающего. */
    onBring?: (bring: { seq: number; bounds: BoardBounds; at?: string | null }) => void;
  }): () => void;
  /**
   * Live-канал (Этап 4): курсоры/viewport/bring/follow по broadcast. Есть
   * только у ученика с аккаунтом — гостю без JWT недоступен (его bring идёт
   * через onBring поллинга, follow до гостя — v2).
   */
  connectLive?(me: LivePeer, handlers: BoardLiveHandlers): BoardLiveControls;
  /** Добавить лист в свой рулон (нет у зрителя). */
  addMyPage?(): Promise<SharedFrame>;
  /** Догруз signed URL для картинок, появившихся после загрузки. */
  refreshImageUrls?(): Promise<Record<string, string>>;
}

interface SharedBoardViewProps {
  transport: SharedBoardTransport;
  /** Шапка-слот (у ученика — «назад к занятию», у гостя — имя доски). */
  headerLeft?: React.ReactNode;
}

interface TextDraft {
  id: number;
  frameId: string;
  x: number;
  y: number;
  value: string;
}

let sharedTextDraftSeq = 0;

const SHARED_TOOLS: { id: BoardTool; label: string; icon: typeof PenLine }[] = [
  { id: 'pen', label: 'Перо', icon: PenLine },
  { id: 'eraser', label: 'Ластик', icon: Eraser },
  { id: 'text', label: 'Текст', icon: Type },
  { id: 'select', label: 'Выделение', icon: MousePointer2 },
];

export function SharedBoardView({ transport, headerLeft }: SharedBoardViewProps) {
  const [frames, setFrames] = useState<SharedFrame[]>([]);
  const [boardTitle, setBoardTitle] = useState<string | null>(null);
  const [myZoneId, setMyZoneId] = useState<string | null>(null);
  const [zoneNames, setZoneNames] = useState<Record<string, string>>({});
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>('saved');
  const [tool, setTool] = useState<BoardTool>('pen');
  const [color, setColor] = useState<string>(BOARD_COLORS[0]);
  const [size, setSize] = useState<number>(DEFAULT_PEN_SIZE_MM);
  const [selection, setSelection] = useState<BoardSelection | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [camera, setCamera] = useState<CameraState>({ cx: 90, cy: 130, zoom: 1.2 });
  const [historyTick, setHistoryTick] = useState(0);

  const framesRef = useRef<SharedFrame[]>([]);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const textDraftRef = useRef<TextDraft | null>(null);
  const historyRef = useRef(new SceneHistory());
  const imageRefreshAtRef = useRef(0);
  const transportRef = useRef(transport);
  transportRef.current = transport;

  const applyFrames = useCallback((next: SharedFrame[]) => {
    framesRef.current = next;
    setFrames(next);
  }, []);

  useEffect(() => {
    textDraftRef.current = textDraft;
  }, [textDraft]);

  // ─── Автосейв: 409 → reconcile → немедленный повтор ────────────────────────

  const autosaveRef = useRef<AutosaveQueue | null>(null);
  if (autosaveRef.current === null) {
    autosaveRef.current = new AutosaveQueue({
      savePage: async (pageId: string) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const frame = framesRef.current.find((f) => f.id === pageId);
          if (!frame) return;
          const result = await transportRef.current.savePage(pageId, frame.elements, frame.rev);
          if ('rev' in result) {
            applyFramePatch(pageId, { rev: result.rev || frame.rev + 1 });
            return;
          }
          // Конфликт: сервер прислал свежие elements — сливаем и пробуем ещё раз.
          const { merged, divergesFromRemote } = reconcileElements(
            frame.elements,
            sanitizeRemote(result.conflict.elements),
          );
          applyFramePatch(pageId, { elements: merged, rev: result.conflict.rev });
          if (!divergesFromRemote) return; // сервер уже содержит всё наше
        }
        // Два конфликта подряд — необычно; отдаём очереди (retry с backoff).
        throw new Error('REV_CONFLICT_RETRY');
      },
      onStatus: setSaveStatus,
    });
  }
  const autosave = autosaveRef.current;

  function sanitizeRemote(raw: unknown): BoardElement[] {
    return Array.isArray(raw) ? (raw as BoardElement[]) : [];
  }

  const applyFramePatch = useCallback(
    (frameId: string, patch: Partial<SharedFrame>) => {
      framesRef.current = framesRef.current.map((f) => (f.id === frameId ? { ...f, ...patch } : f));
      setFrames(framesRef.current);
    },
    [],
  );

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

  // ─── Вьюпорт и камера ───────────────────────────────────────────────────────

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

  const fitAll = useCallback((list: SharedFrame[], vp: { w: number; h: number }) => {
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
  }, []);

  const fitMyZone = useCallback(
    (list: SharedFrame[], zoneId: string | null, vp: { w: number; h: number }) => {
      const mine = zoneId ? list.filter((f) => f.zoneTutorStudentId === zoneId) : [];
      if (mine.length === 0) {
        fitAll(list, vp);
        return;
      }
      fitAll(mine, vp);
    },
    [fitAll],
  );

  // ─── Загрузка и подписка ────────────────────────────────────────────────────

  const handleRemoteRev = useCallback(
    async (pageId: string, rev: number) => {
      const frame = framesRef.current.find((f) => f.id === pageId);
      if (frame && frame.rev >= rev) return; // наше же сохранение
      const fresh = await transportRef.current.refetchPage(pageId);
      if (!fresh) return;
      const parsed = parseFrameRow(fresh.row as never, framesRef.current.length, fresh.rev);
      const existing = framesRef.current.find((f) => f.id === pageId);
      if (!existing) {
        applyFrames([...framesRef.current, parsed]);
      } else {
        // Merge, не replace: локальная незасейвленная грязь не должна пропасть.
        const { merged } = reconcileElements(existing.elements, parsed.elements);
        applyFramePatch(pageId, {
          elements: merged,
          rev: fresh.rev,
          background: parsed.background,
          gridMm: parsed.gridMm,
          orientation: parsed.orientation,
          cell: parsed.cell,
          placement: parsed.placement,
          zoneTutorStudentId: parsed.zoneTutorStudentId,
        });
      }
      // Новая картинка от репетитора → догруз signed URL (не чаще раза в 20 с).
      const unknownImage = parsed.elements.some(
        (el) => el.type === 'image' && !imageUrls[el.ref],
      );
      if (unknownImage && transportRef.current.refreshImageUrls) {
        const now = Date.now();
        if (now - imageRefreshAtRef.current > 20_000) {
          imageRefreshAtRef.current = now;
          void transportRef.current.refreshImageUrls().then((fresh) => {
            setImageUrls((prev) => ({ ...prev, ...fresh }));
          });
        }
      }
    },
    [applyFrames, applyFramePatch, imageUrls],
  );

  const resync = useCallback(async () => {
    try {
      const state = await transportRef.current.load();
      // Reconcile по каждому листу: локальная грязь переживает переподключение.
      const current = framesRef.current;
      const next = state.frames.map((remote) => {
        const local = current.find((f) => f.id === remote.id);
        if (!local) return remote;
        const { merged } = reconcileElements(local.elements, remote.elements);
        return { ...remote, elements: merged };
      });
      applyFrames(next);
      setZoneNames(state.zoneNames);
      setImageUrls((prev) => ({ ...prev, ...state.imageUrls }));
      setMyZoneId(state.myZoneStudentId);
    } catch {
      // best-effort: следующий сигнал/поллинг повторит
    }
  }, [applyFrames]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    transportRef.current
      .load()
      .then((state) => {
        if (cancelled) return;
        applyFrames(state.frames);
        setBoardTitle(state.boardTitle);
        setMyZoneId(state.myZoneStudentId);
        setZoneNames(state.zoneNames);
        setImageUrls(state.imageUrls);
        const vp = { w: window.innerWidth, h: Math.max(320, window.innerHeight - 140) };
        fitMyZone(state.frames, state.myZoneStudentId, vp);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Не удалось открыть доску');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyFrames, fitMyZone]);

  // ─── Live (Этап 4): bring/курсоры/«репетитор смотрит» ──────────────────────

  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor & { at: number }>>({});
  const [followedBy, setFollowedBy] = useState<string | null>(null);
  const followedAtRef = useRef(0);
  const liveRef = useRef<BoardLiveControls | null>(null);
  const lastBringSeqRef = useRef(0);
  const myLiveKeyRef = useRef<string | null>(null);
  const zoneNamesRef = useRef(zoneNames);
  zoneNamesRef.current = zoneNames;
  const viewportStateRef = useRef(viewport);
  viewportStateRef.current = viewport;

  /** «Привести всех»: broadcast (ученик) и поллинг (гость) сходятся сюда. */
  const applyBring = useCallback(
    (bring: { seq: number; bounds: BoardBounds; at?: string | null }) => {
      if (!shouldApplyBring(bring, lastBringSeqRef.current, Date.now())) return;
      lastBringSeqRef.current = bring.seq;
      setCamera(cameraToFitBounds(bring.bounds, viewportStateRef.current));
      toast.message('Репетитор показывает свой экран');
    },
    [],
  );

  useEffect(() => {
    if (loading || loadError) return;
    const stop = transportRef.current.start({
      onRemote: (pageId, rev) => void handleRemoteRev(pageId, rev),
      onResync: () => void resync(),
      onBring: applyBring,
    });
    return stop;
  }, [loading, loadError, handleRemoteRev, resync, applyBring]);

  useEffect(() => {
    if (loading || loadError) return;
    const connect = transportRef.current.connectLive;
    if (!connect) return; // гость: без JWT нет broadcast — bring идёт поллингом
    // НЕ crypto.randomUUID — Safari < 15.4 (rule 80).
    const key = myZoneId
      ? `student:${myZoneId}`
      : `viewer:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    myLiveKeyRef.current = key;
    const name = (myZoneId ? zoneNamesRef.current[myZoneId] : null) ?? 'Ученик';
    const handlers: BoardLiveHandlers = {
      onBring: applyBring,
      onCursor: (e) => {
        setRemoteCursors((prev) => ({
          ...prev,
          [e.key]: { key: e.key, name: e.name, color: stablePeerColor(e.key), x: e.x, y: e.y, at: Date.now() },
        }));
      },
      onFollow: (e) => {
        if (e.targetKey !== myLiveKeyRef.current) return;
        if (e.on) {
          followedAtRef.current = Date.now();
          setFollowedBy(e.byName || 'Репетитор');
        } else {
          setFollowedBy(null);
        }
      },
    };
    const controls = connect({ key, name, role: 'student' } satisfies LivePeer, handlers);
    liveRef.current = controls;
    return () => {
      liveRef.current = null;
      controls.leave();
    };
  }, [loading, loadError, myZoneId, applyBring]);

  // Курсор без событий 6 с — убираем; бейдж «смотрит» гаснет без пинга follow.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        const alive = Object.values(prev).filter((c) => now - c.at < 6000);
        return alive.length === Object.keys(prev).length
          ? prev
          : Object.fromEntries(alive.map((c) => [c.key, c]));
      });
      setFollowedBy((prev) => (prev && now - followedAtRef.current > FOLLOW_STALE_MS ? null : prev));
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  // Свой viewport — для follow репетитора (троттл и «только при peers» в lib).
  useEffect(() => {
    liveRef.current?.sendViewport(cameraWorldWindow(camera, viewport));
  }, [camera, viewport]);

  const cursorList = useMemo(() => Object.values(remoteCursors), [remoteCursors]);
  const handleCursorMove = useCallback((x: number, y: number) => {
    liveRef.current?.sendCursor(x, y);
  }, []);

  // ─── Правки своей зоны ──────────────────────────────────────────────────────

  const updateFrameElements = useCallback(
    (frameId: string, updater: (elements: BoardElement[]) => BoardElement[], recordHistory = true) => {
      const frame = framesRef.current.find((f) => f.id === frameId);
      if (!frame) return;
      if (frame.zoneTutorStudentId !== myZoneId || !myZoneId) return; // не моя зона
      const nextElements = updater(frame.elements);
      if (nextElements === frame.elements) return;
      if (recordHistory) {
        historyRef.current.push(frame.id, frame.elements);
        setHistoryTick((t) => t + 1);
      }
      applyFramePatch(frameId, { elements: nextElements });
      autosave.markDirty(frameId);
    },
    [myZoneId, autosave, applyFramePatch],
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

  const applyHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      // История — только по своим листам; берём последний интерактивный (selection)
      // или первый свой.
      const myFrames = framesRef.current.filter((f) => f.zoneTutorStudentId === myZoneId);
      const frameId = selection?.frameId ?? myFrames[0]?.id;
      const frame = framesRef.current.find((f) => f.id === frameId);
      if (!frame) return;
      const restored =
        direction === 'undo'
          ? historyRef.current.undo(frame.id, frame.elements)
          : historyRef.current.redo(frame.id, frame.elements);
      if (!restored) return;
      setHistoryTick((t) => t + 1);
      applyFramePatch(frame.id, { elements: restored });
      autosave.markDirty(frame.id);
    },
    [selection, myZoneId, autosave, applyFramePatch],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        applyHistory('undo');
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        applyHistory('redo');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyHistory]);

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
      sharedTextDraftSeq += 1;
      const draft = { id: sharedTextDraftSeq, frameId, x, y, value: '' };
      textDraftRef.current = draft;
      setTextDraft(draft);
    },
    [commitTextDraft],
  );

  // ─── «+ Лист в мой рулон» ───────────────────────────────────────────────────

  const [addingPage, setAddingPage] = useState(false);
  const handleAddMyPage = useCallback(async () => {
    if (!transportRef.current.addMyPage || addingPage) return;
    setAddingPage(true);
    try {
      const frame = await transportRef.current.addMyPage();
      applyFrames([...framesRef.current, frame]);
      setCamera(
        cameraToFitBounds(
          frameWorldBounds(frame.placement, pageSizeMm(frame.orientation)),
          viewport,
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось добавить лист');
    } finally {
      setAddingPage(false);
    }
  }, [addingPage, applyFrames, viewport]);

  // frameViews — useMemo (ревью P1): иначе каждый setCamera пересоздаёт
  // FrameView и роняет memo FrameLayer (см. Whiteboard.tsx).
  const frameViews: FrameView[] = useMemo(
    () =>
      frames.map((f, i) => {
        const isMine = !!myZoneId && f.zoneTutorStudentId === myZoneId;
        const zoneName = f.zoneTutorStudentId ? zoneNames[f.zoneTutorStudentId] : null;
        return {
          id: f.id,
          placement: f.placement,
          size: pageSizeMm(f.orientation),
          background: f.background,
          gridMm: f.gridMm,
          elements: f.elements,
          title: isMine
            ? `Мой лист${f.cell.row > 0 ? ` · ${f.cell.row}` : ''}`
            : zoneName
              ? `${zoneName}${f.cell.row > 0 ? ` · ${f.cell.row}` : ''}`
              : `Лист ${i + 1}`,
          isZone: !!f.zoneTutorStudentId,
          writable: isMine,
        };
      }),
    [frames, myZoneId, zoneNames],
  );

  // ─── Рендер ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-slate-700">{loadError}</p>
      </div>
    );
  }

  const textDraftFrame = textDraft ? frames.find((f) => f.id === textDraft.frameId) : null;
  const textDraftPx =
    textDraft && textDraftFrame
      ? worldToViewportPx(
          textDraftFrame.placement.x + textDraft.x,
          textDraftFrame.placement.y + textDraft.y,
          camera,
          viewport,
        )
      : null;

  const canWrite = !!myZoneId;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        {headerLeft}
        <span className="min-w-0 flex-1 truncate text-base font-medium text-slate-900">
          {boardTitle?.trim() || 'Доска'}
        </span>
        {saveStatus === 'error' ? (
          <button
            type="button"
            onClick={() => void autosave.flush()}
            aria-live="polite"
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50"
          >
            <AlertTriangle className="h-4 w-4" />
            <span className="hidden sm:inline">Не сохранено — повторить</span>
          </button>
        ) : (
          <span aria-live="polite" className="flex shrink-0 items-center gap-1.5 px-1 text-sm text-slate-500">
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
      </header>

      {/* Компактный тулбар участника: писать можно только в своей зоне. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2">
        {canWrite ? (
          <>
            <div className="flex items-center gap-1">
              {SHARED_TOOLS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={tool === id}
                  onClick={() => setTool(id)}
                  style={{ touchAction: 'manipulation' }}
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-lg border transition-colors',
                    tool === id
                      ? 'border-accent bg-accent text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {BOARD_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label="Цвет"
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  style={{ touchAction: 'manipulation' }}
                  className="flex h-11 w-8 items-center justify-center rounded-md"
                >
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: c }}
                    className={cn('block h-7 w-7 rounded-full border-2', color === c ? 'border-slate-900' : 'border-white')}
                  />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {PEN_SIZES_MM.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-label={`Толщина ${s} мм`}
                  aria-pressed={size === s}
                  onClick={() => setSize(s)}
                  style={{ touchAction: 'manipulation' }}
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-lg border',
                    size === s ? 'border-accent bg-accent text-white' : 'border-slate-200 bg-white text-slate-600',
                  )}
                >
                  <span className="rounded-full bg-current" style={{ width: `${s * 5}px`, height: `${s * 5}px` }} />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Отменить"
                onClick={() => applyHistory('undo')}
                style={{ touchAction: 'manipulation' }}
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Вернуть"
                onClick={() => applyHistory('redo')}
                style={{ touchAction: 'manipulation' }}
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              >
                <Redo2 className="h-4 w-4" />
              </button>
            </div>
            {transport.addMyPage && (
              <button
                type="button"
                onClick={() => void handleAddMyPage()}
                disabled={addingPage}
                style={{ touchAction: 'manipulation' }}
                className="flex h-11 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 text-sm text-slate-600 hover:border-accent hover:text-accent"
              >
                {addingPage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Лист
              </button>
            )}
          </>
        ) : (
          <span className="text-sm text-slate-500">
            Вы смотрите доску. Писать можно будет, когда репетитор выдаст вам зону.
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Мельче"
            onClick={() => setCamera((c) => zoomCameraAt(c, 0.8, { x: c.cx, y: c.cy }))}
            style={{ touchAction: 'manipulation' }}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Крупнее"
            onClick={() => setCamera((c) => zoomCameraAt(c, 1.25, { x: c.cx, y: c.cy }))}
            style={{ touchAction: 'manipulation' }}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => fitMyZone(framesRef.current, myZoneId, viewport)}
            style={{ touchAction: 'manipulation' }}
            className="flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50"
          >
            <Maximize className="h-4 w-4" />
            {myZoneId ? 'Мой лист' : 'Вся доска'}
          </button>
        </div>
      </div>

      <div ref={viewportRef} className="relative min-h-0 flex-1">
        <BoardCanvas
          frames={frameViews}
          camera={camera}
          viewport={viewport}
          onCameraChange={setCamera}
          tool={tool}
          color={color}
          size={size}
          selection={selection}
          readOnly={!canWrite}
          imageUrls={imageUrls}
          onSelectionChange={setSelection}
          onCommitElement={handleCommitElement}
          onEraseElements={handleEraseElements}
          onMoveSelection={handleMoveSelection}
          onTransformElement={() => undefined /* картинки участник не трансформирует (v1) */}
          onRequestText={handleRequestText}
          remoteCursors={cursorList}
          onCursorMove={handleCursorMove}
        />

        {followedBy && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-slate-900/85 px-4 py-1.5 text-sm text-white shadow-md">
            <Eye className="h-3.5 w-3.5" />
            {followedBy} смотрит ваш лист
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
      </div>
    </div>
  );
}
