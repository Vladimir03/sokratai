// Транспорт контент-синка доски для АВТОРИЗОВАННЫХ (тьютор и ученик):
// WebSocket (postgres_changes на board_page_revs) + поллинг-фолбэк через
// PostgREST. Родился из бага 31.07: у ученика на Android PWA (мобильный
// оператор) WS молча не поднимался, а запасного канала не было ВООБЩЕ —
// доска замирала навсегда, пока запись (обычный HTTPS POST) работала.
//
// Машина состояний:
// • live    — WS SUBSCRIBED; поллинг остаётся редкой страховкой (1/мин) от
//   тихих гэпов rejoin'а postgres_changes;
// • polling — WS не живой; контент едет поллингом revs (сверка номеров
//   версий с локальными кадрами — часов в контуре нет, см. rev-diff в
//   whiteboard-public /signals);
// • offline — и поллинг падает (≥2 сбоя подряд).
//
// RLS уже разрешает поллинг: board_page_revs_participant_select + колоночный
// GRANT (page_id, rev, ...) — миграций не нужно (20260730120000).
//
// Таймеры — ТОЛЬКО цепочка setTimeout (не setInterval): PWA-фриз убивает
// interval-очередь, а chained-timeout после разморозки продолжает с одного
// тика. visibilitychange/online → немедленный тик + освежение JWT в сокете.

import { supabase } from '@/lib/supabaseClient';
import { subscribeBoardRevs, type BoardRevEvent } from '@/lib/whiteboard/boardRealtime';

export type BoardSyncState = 'live' | 'polling' | 'offline';

export interface BoardSyncHandlers {
  /** Живое WS-событие (как прежний onRev). */
  onRev: (event: BoardRevEvent) => void;
  /** Снапшот revs доски (gap-fill на SUBSCRIBED и каждый тик поллинга).
   * Вызывающий сверяет с локальными rev кадров и точечно дочитывает
   * изменившиеся — оба пути идемпотентны (rev-гарды). */
  onRevsSnapshot: (revs: { page_id: string; rev: number }[]) => void;
  /** Смена состояния транспорта — для нейтрального индикатора (rule 95). */
  onState?: (state: BoardSyncState) => void;
}

const POLL_ACTIVE_MS = 2000;
const POLL_HIDDEN_MS = 10_000;
const SAFETY_POLL_LIVE_MS = 60_000;
/** «polling» не показываем первые секунды после старта: WS ещё поднимается,
 * ранний бейдж «резервный режим» — ложная тревога на каждом открытии доски. */
const STATE_GRACE_MS = 8000;
/** Семпл лага сигнала (DB updated_at → клиент) — тренд в консоли прода. */
const REV_LAG_SAMPLE = 0.1;

export function startBoardSync(boardId: string, handlers: BoardSyncHandlers): () => void {
  let disposed = false;
  let wsLive = false;
  let pollFailures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ticking = false;
  let emitted: BoardSyncState = 'live'; // оптимистично: не флапаем бейджем на старте
  const startedAt = Date.now();

  const computeState = (): BoardSyncState =>
    wsLive ? 'live' : pollFailures >= 2 ? 'offline' : 'polling';

  const emitState = () => {
    const next = computeState();
    if (next === emitted) return;
    // Грейс только для «polling» на старте; offline и live эмитим всегда.
    if (next === 'polling' && Date.now() - startedAt < STATE_GRACE_MS) return;
    emitted = next;
    handlers.onState?.(next);
  };

  const schedule = (delayMs: number) => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void tick(), delayMs);
  };

  const nextDelay = () => {
    if (wsLive) return SAFETY_POLL_LIVE_MS;
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
      ? POLL_HIDDEN_MS
      : POLL_ACTIVE_MS;
  };

  const tick = async () => {
    if (disposed || ticking) return;
    ticking = true;
    try {
      const { data, error } = await supabase
        .from('board_page_revs')
        .select('page_id, rev')
        .eq('board_id', boardId);
      if (disposed) return;
      if (error || !data) {
        pollFailures += 1;
      } else {
        pollFailures = 0;
        handlers.onRevsSnapshot(
          data.map((r) => ({ page_id: r.page_id as string, rev: Number(r.rev) || 0 })),
        );
      }
      emitState();
    } catch {
      if (!disposed) {
        pollFailures += 1;
        emitState();
      }
    } finally {
      ticking = false;
      schedule(nextDelay());
    }
  };

  const tickNow = () => {
    if (disposed || ticking) return;
    if (timer) clearTimeout(timer);
    timer = null;
    void tick();
  };

  const stopWs = subscribeBoardRevs(boardId, {
    onRev: (event) => {
      if (disposed) return;
      // Семпл лага доставки сигнала: Δ между Postgres updated_at и приёмом.
      // Clock skew клиента даёт погрешность — это тренд, не точная метрика.
      if (Math.random() < REV_LAG_SAMPLE) {
        const ms = Date.now() - Date.parse(event.updated_at);
        if (Number.isFinite(ms)) console.info(JSON.stringify({ evt: 'board_rev_lag_ms', ms }));
      }
      handlers.onRev(event);
    },
    // Gap-fill каждого SUBSCRIBED — немедленный тик поллера (тот же снапшот).
    onReconnect: tickNow,
    onStatus: (status) => {
      if (disposed) return;
      const wasLive = wsLive;
      wsLive = status === 'SUBSCRIBED';
      emitState();
      // WS умер — фолбэк просыпается сразу, не дожидаясь SAFETY-интервала.
      // При уже-мёртвом WS ничего не трогаем: rejoin-луп supabase-js флапает
      // TIMED_OUT чаще интервала поллинга, и перезавод таймера на каждый флап
      // не дал бы тику выстрелить вовсе (цепочка тиков и так жива).
      if (wasLive && !wsLive) tickNow();
    },
  });

  const onWake = () => {
    if (disposed) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    // PWA вернулась из фона: WS мог тихо умереть во фризе — догоняем контент
    // немедленно и освежаем JWT в сокете (авто-rejoin supabase-js доделает).
    void (async () => {
      try {
        await supabase.realtime.setAuth();
      } catch {
        // без токена rejoin честно упадёт — поллинг уже доставляет
      }
    })();
    tickNow();
  };
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('online', onWake);

  // Фолбэк активен с ПЕРВОЙ секунды (стартовое состояние — polling): даже
  // если WS не поднимется никогда, контент едет с первого тика.
  schedule(POLL_ACTIVE_MS);

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('online', onWake);
    stopWs();
  };
}
