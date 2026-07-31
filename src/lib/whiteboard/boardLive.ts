// Live-канал доски (Этап 4, B1: follow/bring/курсоры). Supabase Realtime
// broadcast + presence поверх ОБЩЕГО топика `board-live-<boardId>` — топик
// делится НАМЕРЕННО (broadcast-маршрутизация, как typing-канал чата, rule 100);
// уникальный суффикс нужен только postgres_changes-каналам.
//
// Что едет по каналу:
// • viewport — видимое окно участника в мм (~2 Гц, только при слушателях);
// • cursor   — указка в мировых мм (адаптивно 5→2 Гц при росте участников);
// • bring    — «привести всех к моему виду» (one-shot, дедуп по seq);
// • follow   — «репетитор смотрит ваш лист» (пинг каждые 10 с, у получателя
//   бейдж гаснет сам через FOLLOW_STALE_MS без пинга — обрыв не «замораживает»);
// • element  — ЗАВЕРШЁННЫЙ элемент (штрих/текст) сразу после коммита (Фаза 2,
//   «мгновенный контур» 31.07). НЕ поток точек: 1 сообщение на pointerup,
//   ~1-2/с на пишущего — лимит 500 msg/s проекта не задет. Получатель мержит
//   через reconcileElements (LWW) БЕЗ смены rev; БД остаётся источником
//   истины и догоняет rev-сигналом (идемпотентно). Payload > ELEMENT_MAX_JSON
//   молча не шлётся — доедет DB-путём.
//
// Гость сюда НЕ подключается (нет JWT): bring доезжает до него поллингом
// /signals + boards.live_bring; контент — поллингом rev-diff (1.5 с).

import { supabase } from '@/lib/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { parseElements, type BoardBounds, type BoardElement } from '@/lib/whiteboard/model';

export interface LivePeer {
  key: string;
  name: string;
  role: 'tutor' | 'student';
}

export interface ViewportEvent {
  key: string;
  name: string;
  bounds: BoardBounds;
}

export interface CursorEvent {
  key: string;
  name: string;
  x: number;
  y: number;
}

export interface BringEvent {
  seq: number;
  bounds: BoardBounds;
  byName: string;
}

export interface FollowEvent {
  targetKey: string;
  on: boolean;
  byName: string;
}

export interface ElementEvent {
  pageId: string;
  element: BoardElement;
}

export type BoardLiveStatus = 'connecting' | 'connected' | 'error';

export interface BoardLiveHandlers {
  onViewport?: (event: ViewportEvent) => void;
  onCursor?: (event: CursorEvent) => void;
  onBring?: (event: BringEvent) => void;
  onFollow?: (event: FollowEvent) => void;
  /** Чужой завершённый элемент (Фаза 2): применить merge'ем, rev не трогать. */
  onElement?: (event: ElementEvent) => void;
  /** Список ДРУГИХ участников канала (без себя), при каждом изменении presence. */
  onPeers?: (peers: LivePeer[]) => void;
  /** Статус private-канала — для панели участников (диагностика: устойчивый
   * 'error' = Realtime Authorization недоступна, live тихо деградирует). */
  onStatus?: (status: BoardLiveStatus) => void;
}

export interface BoardLiveControls {
  sendViewport: (bounds: BoardBounds) => void;
  sendCursor: (x: number, y: number) => void;
  sendBring: (bounds: BoardBounds) => void;
  sendFollow: (targetKey: string, on: boolean) => void;
  /** Мгновенная доставка завершённого элемента слушателям (Фаза 2). */
  sendElement: (pageId: string, element: BoardElement) => void;
  peersCount: () => number;
  leave: () => void;
}

/** Кап payload'а element-события: крупнее — только DB-путём (rev-сигнал ≤1 с). */
export const ELEMENT_MAX_JSON = 30_000;
/** Приёмные капы (ревью синк-пасса, P0 №4): участник канала может прислать
 * произвольный payload — размер режем и на входе, не только на отправке. */
const ELEMENT_MAX_POINTS = 12_000; // чисел в points (~4000 точек)
const ELEMENT_MAX_TEXT = 4000;
/** Сколько живёт неподтверждённый broadcast-элемент в render-оверлее
 * получателя. БД-путь подтверждает за ~1 с; не подтверждён за TTL — фантом
 * (undo автора до сейва / инъекция) и исчезает, НЕ попав в сцену. */
export const ELEMENT_OVERLAY_TTL_MS = 10_000;

export interface LiveOverlayEntry {
  element: BoardElement;
  at: number;
}
/** pageId → неподтверждённые broadcast-элементы (render-only, НЕ сцена). */
export type LiveOverlayMap = Record<string, LiveOverlayEntry[]>;

/** Метла оверлея: выкидывает подтверждённые БД (id уже в elements листа),
 * просроченные по TTL и осиротевшие (лист удалён). Возвращает prev без
 * изменений, если чистить нечего — не дёргает setState каждые 3 с. */
export function pruneLiveOverlays(
  prev: LiveOverlayMap,
  frames: { id: string; elements: BoardElement[] }[],
  now: number,
): LiveOverlayMap {
  let changed = false;
  const next: LiveOverlayMap = {};
  for (const pageId of Object.keys(prev)) {
    const frame = frames.find((f) => f.id === pageId);
    const kept = prev[pageId].filter((o) => {
      if (now - o.at > ELEMENT_OVERLAY_TTL_MS) return false;
      if (!frame) return false;
      return !frame.elements.some((el) => el.id === o.element.id);
    });
    if (kept.length !== prev[pageId].length) changed = true;
    if (kept.length > 0) next[pageId] = kept;
  }
  return changed ? next : prev;
}

/** Элементы листа для РЕНДЕРА: сцена + неподтверждённый оверлей (без дублей).
 * Если оверлея нет — возвращает исходный массив (memo FrameLayer не рвётся). */
export function overlayElementsFor(
  overlays: LiveOverlayMap,
  pageId: string,
  elements: BoardElement[],
): BoardElement[] {
  const list = overlays[pageId];
  if (!list || list.length === 0) return elements;
  const known = new Set(elements.map((el) => el.id));
  const extra: BoardElement[] = [];
  for (const o of list) {
    if (!known.has(o.element.id)) extra.push(o.element);
  }
  return extra.length > 0 ? [...elements, ...extra] : elements;
}

/** Бейдж «репетитор смотрит» гаснет без пинга follow за это время. */
export const FOLLOW_STALE_MS = 25_000;
/** Пинг follow от следящего (держит бейдж живым при обрыве < STALE). */
export const FOLLOW_PING_MS = 10_000;
/** bring старше этого окна не применяется (гость мог открыть вкладку позже). */
export const BRING_FRESH_MS = 120_000;

const VIEWPORT_INTERVAL_MS = 500;
const CURSOR_FAST_MS = 200; // 5 Гц при малой группе
const CURSOR_SLOW_MS = 500; // 2 Гц при ≥4 слушателях (план: адаптивно 5→2)
const CURSOR_SLOW_PEERS = 4;

/** Палитра курсоров/чипов (НЕ цвета пера: участник ≠ инструмент). */
const PEER_COLORS = ['#1B6B4A', '#B45309', '#1D4ED8', '#BE185D', '#7C3AED', '#0F766E'];

/** Стабильный цвет участника: один и тот же key → один цвет у всех клиентов. */
export function stablePeerColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
}

/**
 * Применять ли bring: seq строго растёт (дедуп повторов из поллинга) и сигнал
 * свежий (гость, открывший вкладку через час, не должен получить рывок камеры).
 */
export function shouldApplyBring(
  bring: { seq: number; at?: string | null },
  lastAppliedSeq: number,
  nowMs: number,
): boolean {
  if (!Number.isFinite(bring.seq) || bring.seq <= lastAppliedSeq) return false;
  if (bring.at) {
    const atMs = Date.parse(bring.at);
    if (Number.isFinite(atMs) && nowMs - atMs > BRING_FRESH_MS) return false;
  }
  return true;
}

/** Границы валидны и конечны — битый payload не должен ронять камеру в NaN. */
export function sanitizeBounds(raw: unknown): BoardBounds | null {
  const b = raw as BoardBounds | null | undefined;
  if (
    !b ||
    !Number.isFinite(b.minX) || !Number.isFinite(b.minY) ||
    !Number.isFinite(b.maxX) || !Number.isFinite(b.maxY) ||
    b.maxX <= b.minX || b.maxY <= b.minY
  ) {
    return null;
  }
  return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
}

const MAX_NAME_LEN = 40;

function clampName(raw: unknown): string {
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, MAX_NAME_LEN) : 'Участник';
}

/** Троттл leading+trailing: последний payload не теряется. */
function makeThrottle<T>(intervalFn: () => number, send: (payload: T) => void) {
  let lastAt = 0;
  let pending: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (pending === null) return;
    lastAt = Date.now();
    const p = pending;
    pending = null;
    send(p);
  };
  return {
    push(payload: T) {
      const now = Date.now();
      const interval = intervalFn();
      if (now - lastAt >= interval && timer === null) {
        lastAt = now;
        send(payload);
        return;
      }
      pending = payload;
      if (timer === null) {
        timer = setTimeout(flush, Math.max(0, interval - (now - lastAt)));
      }
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

export function connectBoardLive(
  boardId: string,
  me: LivePeer,
  handlers: BoardLiveHandlers,
): BoardLiveControls {
  let disposed = false;
  let subscribed = false;
  let peers: LivePeer[] = [];
  let peersSignature = '';

  // private (ревью этапов 3–4, P0): подписка/отправка проверяются политиками
  // realtime.messages (миграция 20260730160000) — чужак с anon-ключом и
  // boardId больше не может слушать presence и слать bring/follow.
  const channel: RealtimeChannel = supabase.channel(`board-live-${boardId}`, {
    config: {
      private: true,
      broadcast: { self: false },
      presence: { key: me.key },
    },
  });

  const readPeers = () => {
    const state = channel.presenceState<{ name: string; role: LivePeer['role'] }>();
    const next: LivePeer[] = [];
    for (const key of Object.keys(state)) {
      if (key === me.key) continue;
      const meta = state[key][0];
      if (meta) {
        next.push({
          key,
          name: clampName(meta.name),
          role: meta.role === 'tutor' ? 'tutor' : 'student',
        });
      }
    }
    peers = next;
    // presence:sync фаерится и когда состав НЕ изменился (re-track после
    // обрыва WS под RU DPI) — без сигнатуры каждый sync дёргал setState у
    // трёх подписчиков и ре-рендерил доску (вклад в React #185 2026-07-28).
    const signature = next
      .map((p) => `${p.key}|${p.name}|${p.role}`)
      .sort()
      .join(';');
    if (signature === peersSignature) return;
    peersSignature = signature;
    handlers.onPeers?.(next);
  };

  channel
    .on('presence', { event: 'sync' }, readPeers)
    .on('broadcast', { event: 'viewport' }, ({ payload }) => {
      if (disposed || !payload) return;
      const e = payload as ViewportEvent;
      const b = sanitizeBounds(e.bounds);
      if (!b || typeof e.key !== 'string') return;
      handlers.onViewport?.({ key: e.key, name: clampName(e.name), bounds: b });
    })
    .on('broadcast', { event: 'cursor' }, ({ payload }) => {
      if (disposed || !payload) return;
      const e = payload as CursorEvent;
      if (typeof e.key !== 'string' || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
      handlers.onCursor?.({ key: e.key, name: clampName(e.name), x: e.x, y: e.y });
    })
    .on('broadcast', { event: 'bring' }, ({ payload }) => {
      if (disposed || !payload) return;
      const e = payload as BringEvent;
      const b = sanitizeBounds(e.bounds);
      if (!b || !Number.isFinite(e.seq)) return;
      handlers.onBring?.({ seq: e.seq, bounds: b, byName: clampName(e.byName) });
    })
    .on('broadcast', { event: 'follow' }, ({ payload }) => {
      if (disposed || !payload) return;
      const e = payload as FollowEvent;
      if (typeof e.targetKey !== 'string') return;
      handlers.onFollow?.({ targetKey: e.targetKey, on: !!e.on, byName: clampName(e.byName) });
    })
    .on('broadcast', { event: 'element' }, ({ payload }) => {
      if (disposed || !payload) return;
      const e = payload as { pageId?: unknown; element?: unknown };
      if (typeof e.pageId !== 'string' || !e.pageId) return;
      // parseElements — канонический санитайзер jsonb-входа (model.ts): битый
      // payload участника отбрасывается, а не роняет сцену получателя.
      // ⚠️ Получатель НЕ доверяет событию запись: элемент идёт только в
      // render-оверлей (SharedBoardView/Whiteboard) и никогда не сохраняется —
      // источником истины остаётся БД с серверным zone-enforcement.
      const parsed = parseElements([e.element]);
      if (parsed.length !== 1) return;
      const el = parsed[0];
      if (el.type === 'stroke' && el.points.length > ELEMENT_MAX_POINTS) return;
      if (el.type === 'text' && el.text.length > ELEMENT_MAX_TEXT) return;
      handlers.onElement?.({ pageId: e.pageId, element: el });
    });

  // Private-канал требует свежий JWT в realtime-сокете ДО subscribe —
  // setAuth и только затем подписка (иначе политика отвергнет join).
  void (async () => {
    try {
      await supabase.realtime.setAuth();
    } catch {
      // без токена подписка честно упадёт CHANNEL_ERROR — live деградирует,
      // контент продолжает ехать по board_page_revs / поллингу
    }
    if (disposed) return;
    handlers.onStatus?.('connecting');
    channel.subscribe((status) => {
      if (disposed) return;
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        handlers.onStatus?.('connected');
        // re-track на КАЖДЫЙ SUBSCRIBED: после обрыва (RU DPI рвёт WS)
        // presence на сервере протухает — заявляем себя заново.
        void channel.track({ name: me.name, role: me.role });
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        subscribed = false;
        handlers.onStatus?.('error');
        // Для отладки прода: устойчивая ошибка = private-канал не пускает
        // (Realtime Authorization / политика) — контент при этом едет по revs.
        console.warn('board_live_channel_status', { status });
      }
    });
  })();

  const sendEvent = (event: string, payload: Record<string, unknown>) => {
    if (disposed || !subscribed) return;
    void channel.send({ type: 'broadcast', event, payload });
  };

  const viewportThrottle = makeThrottle<BoardBounds>(
    () => VIEWPORT_INTERVAL_MS,
    (bounds) => sendEvent('viewport', { key: me.key, name: me.name, bounds }),
  );
  const cursorThrottle = makeThrottle<{ x: number; y: number }>(
    () => (peers.length >= CURSOR_SLOW_PEERS ? CURSOR_SLOW_MS : CURSOR_FAST_MS),
    ({ x, y }) => sendEvent('cursor', { key: me.key, name: me.name, x, y }),
  );

  return {
    sendViewport(bounds) {
      // «Только при слушателях» (план): пустой канал — не шлём вовсе.
      if (peers.length === 0) return;
      viewportThrottle.push(bounds);
    },
    sendCursor(x, y) {
      if (peers.length === 0) return;
      cursorThrottle.push({ x, y });
    },
    sendBring(bounds) {
      sendEvent('bring', { seq: Date.now(), bounds, byName: me.name });
    },
    sendFollow(targetKey, on) {
      sendEvent('follow', { targetKey, on, byName: me.name });
    },
    sendElement(pageId, element) {
      if (peers.length === 0) return; // пустой канал — DB-путь и так доставит
      try {
        // Кап размера: гигантский элемент (длинный штрих, вставка) не должен
        // душить канал — молча остаётся DB-пути (rev-сигнал доставит ≤1 с).
        if (JSON.stringify(element).length > ELEMENT_MAX_JSON) return;
      } catch {
        return;
      }
      sendEvent('element', { pageId, element });
    },
    peersCount: () => peers.length,
    leave() {
      disposed = true;
      viewportThrottle.dispose();
      cursorThrottle.dispose();
      // removeChannel, не unsubscribe: канал иначе копится в socket.channels
      // при каждом переоткрытии доски.
      void supabase.removeChannel(channel);
    },
  };
}
