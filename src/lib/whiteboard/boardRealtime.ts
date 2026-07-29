// Realtime-сигналы доски (Этап 3): подписка на сигнальную таблицу
// board_page_revs. Канон чата (rule 100, useChatRealtime):
// • уникальный суффикс топика на подписку (гонка unsubscribe/subscribe);
// • gap-fill на первом SUBSCRIBED после обрыва (RU DPI рвёт WS) — не догоняем
//   по одному событию, а даём вызывающему перечитать снапшот revs;
// • merge на стороне вызывающего, НИКАКИХ invalidate.
//
// Ink через Realtime НЕ идёт (лимит 500 msg/s на проект): события здесь —
// только «лист N дорос до rev R», ≤ ~1/сек на пишущего.

import { supabase } from '@/lib/supabaseClient';

export interface BoardRevEvent {
  page_id: string;
  board_id: string;
  rev: number;
  updated_by: string;
  updated_at: string;
}

let channelSeq = 0;

export function subscribeBoardRevs(
  boardId: string,
  handlers: {
    /** Живое событие (INSERT нового листа или UPDATE rev). */
    onRev: (event: BoardRevEvent) => void;
    /** Первый SUBSCRIBED после обрыва: перечитать снапшот revs целиком. */
    onReconnect: () => void;
  },
): () => void {
  let wasDisconnected = false;
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
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        wasDisconnected = true;
      }
      if (status === 'SUBSCRIBED' && wasDisconnected && !disposed) {
        wasDisconnected = false;
        handlers.onReconnect();
      }
    });

  return () => {
    disposed = true;
    void channel.unsubscribe();
  };
}
