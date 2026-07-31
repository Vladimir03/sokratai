// Realtime-сигналы доски (Этап 3): подписка на сигнальную таблицу
// board_page_revs. Канон чата (rule 100, useChatRealtime):
// • уникальный суффикс топика на подписку (гонка unsubscribe/subscribe);
// • gap-fill на первом SUBSCRIBED после обрыва (RU DPI рвёт WS) — не догоняем
//   по одному событию, а даём вызывающему перечитать снапшот revs;
// • merge на стороне вызывающего, НИКАКИХ invalidate.
//
// ПОТОК точек через Realtime НЕ идёт (лимит 500 msg/s на проект): события
// здесь — только «лист N дорос до rev R», ≤ ~1/сек на пишущего. Single-shot
// commit-элементы ≤30 КБ едут по live-каналу (boardLive.sendElement, Фаза 2) —
// БД остаётся источником истины, broadcast лишь срезает латентность.

import { supabase } from '@/lib/supabaseClient';
import { reportClientError } from '@/lib/clientErrorReport';

export interface BoardRevEvent {
  page_id: string;
  board_id: string;
  rev: number;
  updated_by: string;
  updated_at: string;
}

export type BoardRevsChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

let channelSeq = 0;

export function subscribeBoardRevs(
  boardId: string,
  handlers: {
    /** Живое событие (INSERT нового листа или UPDATE rev). */
    onRev: (event: BoardRevEvent) => void;
    /** КАЖДЫЙ SUBSCRIBED (включая первый): перечитать снапшот revs целиком.
     * Первый — тоже gap-fill: между load()-снапшотом и подпиской есть окно,
     * в котором чужой сейв прошёл бы незамеченным (ревью этапов 3–4, P1). */
    onReconnect: () => void;
    /** Статус канала — для поллинг-фолбэка (boardSync) и индикатора. Раньше
     * CHANNEL_ERROR/TIMED_OUT молча глотались — мёртвый WS у ученика на
     * мобильном операторе оставлял доску замороженной НАВСЕГДА (баг 31.07). */
    onStatus?: (status: BoardRevsChannelStatus) => void;
  },
): () => void {
  let disposed = false;

  channelSeq += 1;
  const channel = supabase
    .channel(`board-revs-${boardId}-${channelSeq}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'board_page_revs',
        filter: `board_id=eq.${boardId}`,
      },
      (payload) => {
        if (disposed) return;
        const row = payload.new as BoardRevEvent | null;
        if (!row?.page_id) return;
        handlers.onRev(row);
      },
    );

  // setAuth ДО subscribe (зеркало boardLive): join без JWT уходит под anon,
  // у которого REVOKE ALL на board_page_revs → тихий CHANNEL_ERROR. Гонка
  // реальна на холодном старте PWA: SupabaseClient зовёт realtime.setAuth
  // только на SIGNED_IN/TOKEN_REFRESHED, НЕ на INITIAL_SESSION.
  void (async () => {
    try {
      await supabase.realtime.setAuth();
    } catch {
      // подписка честно упадёт CHANNEL_ERROR — фолбэк-поллинг доставит контент
    }
    if (disposed) return;
    channel.subscribe((status) => {
      if (disposed) return; // CLOSED штатного cleanup — не флапать статусом
      if (status === 'SUBSCRIBED') {
        handlers.onStatus?.('SUBSCRIBED');
        handlers.onReconnect();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        handlers.onStatus?.(status);
        console.warn('board_revs_channel_status', { status });
        if (status !== 'CLOSED') {
          // Наблюдаемость (/admin «Ошибки»): масштаб мёртвых WS в парке.
          // Троттл 30 с/kind + сессионный дедуп — внутри reportClientError.
          reportClientError(`board_revs_channel_${status}`, 'net');
        }
      }
    });
  })();

  return () => {
    disposed = true;
    // removeChannel, не unsubscribe: иначе канал остаётся в socket.channels
    // и копится при каждом переоткрытии доски (участвует в auth-рассылке).
    void supabase.removeChannel(channel);
  };
}
