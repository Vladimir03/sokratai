import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SharedBoardView, type SharedBoardTransport } from '@/components/whiteboard/SharedBoardView';
import {
  addStudentRollPage,
  getStudentBoardState,
  invokeStudentMe,
  refetchStudentPage,
  saveStudentPage,
} from '@/lib/whiteboardStudentApi';
import { startBoardSync } from '@/lib/whiteboard/boardSync';
import { connectBoardLive } from '@/lib/whiteboard/boardLive';

// Доска глазами ученика с аккаунтом (Этап 3, B4): чтение PostgREST под RLS,
// запись через whiteboard-student-api (только своя зона), синк — boardSync:
// Realtime по сигнальной board_page_revs + поллинг-фолбэк (фикс 31.07:
// мёртвый WS на мобильном операторе замораживал доску навсегда).

export default function StudentBoard() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();

  const transport = useMemo<SharedBoardTransport | null>(() => {
    if (!boardId) return null;
    return {
      async load() {
        const state = await getStudentBoardState(boardId);
        return {
          boardTitle: state.boardTitle,
          myZoneStudentId: state.myZoneStudentId,
          zoneNames: state.zoneNames,
          imageUrls: state.imageUrls,
          frames: state.frames,
        };
      },
      savePage: saveStudentPage,
      refetchPage: refetchStudentPage,
      start(handlers) {
        return startBoardSync(boardId, {
          onRev: (event) => handlers.onRemote(event.page_id, event.rev),
          onRevsSnapshot: (revs) => handlers.onRevs?.(revs),
          onState: (state) => handlers.onSyncState?.(state),
        });
      },
      // Этап 4: live-канал (bring/курсоры/«репетитор смотрит») — у ученика
      // есть JWT, broadcast доступен; me собирает SharedBoardView после load.
      connectLive: (me, handlers) => connectBoardLive(boardId, me, handlers),
      addMyPage: () => addStudentRollPage(boardId),
      refreshImageUrls: async () => (await invokeStudentMe(boardId)).imageUrls,
    };
  }, [boardId]);

  if (!transport) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-slate-700">Доска не указана</p>
      </div>
    );
  }

  return (
    // key: смена :boardId обязана пересоздать вью (иначе старый снимок и
    // каналы пережили бы новый URL — ревью P2). Выход — гардовый onExit
    // (SharedBoardView сам ждёт flush; SPA-Back мимо beforeunload — ревью P0).
    <SharedBoardView key={boardId} transport={transport} onExit={() => navigate(-1)} />
  );
}
