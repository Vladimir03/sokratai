import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SharedBoardView, type SharedBoardTransport } from '@/components/whiteboard/SharedBoardView';
import {
  addStudentRollPage,
  getStudentBoardState,
  invokeStudentMe,
  refetchStudentPage,
  saveStudentPage,
} from '@/lib/whiteboardStudentApi';
import { subscribeBoardRevs } from '@/lib/whiteboard/boardRealtime';
import { connectBoardLive } from '@/lib/whiteboard/boardLive';

// Доска глазами ученика с аккаунтом (Этап 3, B4): чтение PostgREST под RLS,
// запись через whiteboard-student-api (только своя зона), синк — Realtime по
// сигнальной board_page_revs (канон rule 100: merge, gap-fill на reconnect).

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
        return subscribeBoardRevs(boardId, {
          onRev: (event) => handlers.onRemote(event.page_id, event.rev),
          onReconnect: handlers.onResync,
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
    <SharedBoardView
      transport={transport}
      headerLeft={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          style={{ touchAction: 'manipulation' }}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Назад
        </Button>
      }
    />
  );
}
