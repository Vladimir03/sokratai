import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarDays, Loader2, Plus, PresentationIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { type Board, createBoard, deleteBoard, listBoards } from '@/lib/whiteboardApi';

// Список досок — вход из левого меню (задача W1.11).
// Доска живёт и сама по себе, не только внутри занятия: репетитор готовит её
// заранее, как «СОЛО» у Chattern (spec §8, открытый вопрос 4 — решён в пользу
// standalone, потому что вход в меню требует чего-то осмысленного без занятия).

export default function TutorBoards() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listBoards()
      .then(setBoards)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Не удалось загрузить доски'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const handleCreate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await createBoard({});
      navigate(`/tutor/board/${created.board.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось создать доску');
    } finally {
      setBusy(false);
    }
  }, [busy, navigate]);

  const handleDelete = useCallback(
    async (board: Board) => {
      if (busy) return;
      if (!window.confirm('Удалить доску вместе со всеми страницами?')) return;
      setBusy(true);
      try {
        await deleteBoard(board.id);
        setBoards((prev) => prev.filter((b) => b.id !== board.id));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось удалить доску');
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Доски</h1>
          <p className="mt-1 text-sm text-slate-500">
            Конспект урока, который сам прикрепляется к занятию
          </p>
        </div>
        <Button onClick={handleCreate} disabled={busy} style={{ touchAction: 'manipulation' }}>
          <Plus className="mr-1.5 h-4 w-4" />
          Новая доска
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
          <p className="text-slate-700">{error}</p>
          <Button variant="outline" className="mt-4" onClick={load}>
            Повторить
          </Button>
        </div>
      )}

      {!loading && !error && boards.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <PresentationIcon className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-3 font-medium text-slate-900">Пока нет ни одной доски</p>
          <p className="mt-1 text-sm text-slate-500">
            Создайте доску здесь или откройте её прямо из карточки занятия —
            тогда конспект прикрепится к уроку сам.
          </p>
          <Button className="mt-4" onClick={handleCreate} disabled={busy}>
            <Plus className="mr-1.5 h-4 w-4" />
            Новая доска
          </Button>
        </div>
      )}

      {!loading && !error && boards.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {boards.map((board) => (
            <li
              key={board.id}
              className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
            >
              <button
                type="button"
                onClick={() => navigate(`/tutor/board/${board.id}`)}
                style={{ touchAction: 'manipulation' }}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate font-medium text-slate-900">
                  {board.title?.trim() || 'Без названия'}
                </span>
                <span className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                  {/* parseISO, а не new Date(string) — Safari строг к формату (rule 80). */}
                  {format(parseISO(board.updated_at), 'd MMMM, HH:mm', { locale: ru })}
                  {board.lesson_id && (
                    <span className="inline-flex items-center gap-1 text-accent">
                      <CalendarDays className="h-3.5 w-3.5" />
                      занятие
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleDelete(board)}
                disabled={busy}
                aria-label="Удалить доску"
                style={{ touchAction: 'manipulation' }}
                className="shrink-0 rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
