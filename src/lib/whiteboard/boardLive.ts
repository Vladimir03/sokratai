// Live-канал доски (Этап 4, B1: follow/bring/курсоры). Supabase Realtime
// broadcast + presence поверх ОБЩЕГО топика `board-live-<boardId>` — топик
// делится НАМЕРЕННО (broadcast-маршрутизация, как typing-канал чата, rule 100);
// уникальный суффикс нужен только postgres_changes-каналам.
//
// Что едет по каналу (всё эфемерное, гэп-филл не нужен):
// • viewport — видимое окно участника в мм (~2 Гц, только при слушателях);
// • cursor   — указка в мировых мм (адаптивно 5→2 Гц при росте участников);
// • bring    — «привести всех к моему виду» (one-shot, дедуп по seq);
// • follow   — «репетитор смотрит ваш лист» (пинг каждые 10 с, у получателя
//   бейдж гаснет сам через FOLLOW_STALE_MS без пинга — обрыв не «замораживает»).
//
// Гость сюда НЕ подключается (нет JWT): bring доезжает до него поллингом
// /signals + boards.live_bring, follow до гостя — v2 (план, ограничение Miro).

import { supabase } from '@/lib/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { BoardBounds } from '@/lib/whiteboard/model';

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

export interface BoardLiveHandlers {
  onViewport?: (event: ViewportEvent) => void;
  onCursor?: (event: CursorEvent) => void;
  onBring?: (event: BringEvent) => void;
  onFollow?: (event: FollowEvent) => void;
  /** Список ДРУГИХ участников канала (без себя), при каждом изменении presence. */
  onPeers?: (peers: LivePeer[]) => void;
}

export interface BoardLiveControls {
  sendViewport: (bounds: BoardBounds) => void;
  sendCursor: (x: number, y: number) => void;
  sendBring: (bounds: BoardBounds) => void;
  sendFollow: (targetKey: string, on: boolean) => void;
  peersCount: () => number;
  leave: () => void;
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

  const channel: RealtimeChannel = supabase.channel(`board-live-${boardId}`, {
    config: {
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
      if (meta) next.push({ key, name: meta.name ?? 'Участник', role: meta.role ?? 'student' });
    }
    peers = next;
    handlers.onPeers?.(next);
  };

  channel
    .on('presence', { event: 'sync' }, readPeers)
    .on('broadcast', { event: 'viewport' }, ({ payload }) => {
      if (disposed || !payload) return;
      handlers.onViewport?.(payload as ViewportEvent);
    })
    .on('broadcast', { event: 'cursor' }, ({ payload }) => {
      if (disposed || !payload) return;
      handlers.onCursor?.(payload as CursorEvent);
    })
    .on('broadcast', { event: 'bring' }, ({ payload }) => {
      if (disposed || !payload) return;
      handlers.onBring?.(payload as BringEvent);
    })
    .on('broadcast', { event: 'follow' }, ({ payload }) => {
      if (disposed || !payload) return;
      handlers.onFollow?.(payload as FollowEvent);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && !disposed) {
        subscribed = true;
        // re-track на КАЖДЫЙ SUBSCRIBED: после обрыва (RU DPI рвёт WS)
        // presence на сервере протухает — заявляем себя заново.
        void channel.track({ name: me.name, role: me.role });
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        subscribed = false;
      }
    });

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
    peersCount: () => peers.length,
    leave() {
      disposed = true;
      viewportThrottle.dispose();
      cursorThrottle.dispose();
      void channel.unsubscribe();
    },
  };
}
