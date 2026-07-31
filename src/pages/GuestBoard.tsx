import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SharedBoardView, type SharedBoardTransport } from '@/components/whiteboard/SharedBoardView';
import {
  addGuestRollPage,
  clearGuestToken,
  getGuestMeta,
  getGuestSignals,
  getGuestState,
  getStoredGuestToken,
  joinGuestBoard,
  saveGuestPage,
  type GuestBoardMeta,
} from '@/lib/whiteboardPublicApi';

// Гостевой вход на доску по ссылке /b/:slug БЕЗ регистрации (Этап 3, B4;
// решение владельца 29.07 вечер). Паттерн whiteboard.chat: выбор «я — Маша»
// из списка группы (получает свою зону) или свободное имя (зритель).
// Realtime гостю недоступен (нет JWT) → поллинг /signals 2.5 с c backoff
// при неактивности вкладки.

const POLL_ACTIVE_MS = 2500;
const POLL_HIDDEN_MS = 15000;

export default function GuestBoard() {
  const { slug } = useParams<{ slug: string }>();
  const [meta, setMeta] = useState<GuestBoardMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [guestToken, setGuestToken] = useState<string | null>(slug ? getStoredGuestToken(slug) : null);
  const [joining, setJoining] = useState(false);
  const [freeName, setFreeName] = useState('');

  // Мета + кандидаты — до входа.
  useEffect(() => {
    if (!slug || guestToken) return;
    let cancelled = false;
    getGuestMeta(slug)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((err: unknown) => {
        if (!cancelled) setMetaError(err instanceof Error ? err.message : 'Ссылка не действует.');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, guestToken]);

  const join = useCallback(
    async (input: { tutor_student_id?: string; display_name?: string }) => {
      if (!slug || joining) return;
      setJoining(true);
      try {
        const res = await joinGuestBoard(slug, input);
        setGuestToken(res.guestToken);
      } catch (err) {
        setMetaError(err instanceof Error ? err.message : 'Не удалось войти на доску.');
      } finally {
        setJoining(false);
      }
    },
    [slug, joining],
  );

  // ─── Транспорт с поллингом ──────────────────────────────────────────────────

  const sinceRef = useRef<string | null>(null);

  const transport = useMemo<SharedBoardTransport | null>(() => {
    if (!slug || !guestToken) return null;
    return {
      async load() {
        try {
          const state = await getGuestState(slug, guestToken);
          sinceRef.current = state.since;
          return {
            boardTitle: state.boardTitle,
            myZoneStudentId: state.myZoneStudentId,
            myGuestId: state.myGuestId,
            zoneNames: Object.fromEntries(
              (meta?.members ?? []).map((m) => [m.tutor_student_id, m.name]),
            ),
            imageUrls: state.imageUrls,
            frames: state.frames,
          };
        } catch (err) {
          // Токен протух/отозван → назад на join-экран.
          if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401) {
            clearGuestToken(slug);
            setGuestToken(null);
          }
          throw err;
        }
      },
      savePage: (pageId, elements, baseRev) => saveGuestPage(slug, guestToken, pageId, elements, baseRev),
      // «+ Лист» в свой рулон — теперь и у гостя (кейс «у ученика кончился лист»).
      addMyPage: () => addGuestRollPage(slug, guestToken),
      async refetchPage() {
        // У гостя нет точечного чтения листа — вернём null, а onResync (ниже)
        // перечитает state целиком: поллинг и так batch'ует изменения.
        return null;
      },
      start(handlers) {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const tick = async () => {
          if (stopped) return;
          try {
            const res = await getGuestSignals(slug, guestToken, sinceRef.current);
            if (stopped) return;
            // «Привести всех» (Этап 4): у гостя нет Realtime — bring доезжает
            // отсюда (≤2.5 с). Дедуп по seq и свежесть — в applyBring выше.
            if (res.bring) handlers.onBring?.(res.bring);
            if (res.revs.length > 0) {
              const nextSince = res.revs.reduce(
                (max, r) => (r.updated_at > max ? r.updated_at : max),
                sinceRef.current ?? '',
              );
              // refetchPage у гостя нет → любой чужой сигнал = resync state.
              // Watermark — ТОЛЬКО после успешного resync (ревью P1): иначе
              // упавший (429/сеть) resync «съедал» сигнал, и без следующей
              // правки гость навсегда оставался на старой сцене.
              const ok = await handlers.onResync();
              if (!stopped && ok !== false) sinceRef.current = nextSince;
            } else {
              sinceRef.current = res.now;
            }
          } catch {
            // сетевой сбой — следующий тик попробует снова
          }
          const delay = document.visibilityState === 'hidden' ? POLL_HIDDEN_MS : POLL_ACTIVE_MS;
          timer = setTimeout(() => void tick(), delay);
        };

        timer = setTimeout(() => void tick(), POLL_ACTIVE_MS);
        return () => {
          stopped = true;
          if (timer) clearTimeout(timer);
        };
      },
    };
  }, [slug, guestToken, meta]);

  if (!slug) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-700">Ссылка не действует.</p>
      </div>
    );
  }

  // ─── Join-экран ─────────────────────────────────────────────────────────────

  if (!guestToken) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
          <h1 className="text-xl font-semibold text-slate-900">
            {meta?.boardTitle?.trim() || 'Доска репетитора'}
          </h1>
          {metaError ? (
            <p className="mt-3 text-slate-600">{metaError}</p>
          ) : !meta ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              {meta.members.length > 0 && (
                <>
                  <p className="mt-2 text-sm text-slate-500">Кто вы? Выберите себя из списка:</p>
                  <ul className="mt-3 space-y-2">
                    {meta.members.map((m) => (
                      <li key={m.tutor_student_id}>
                        <button
                          type="button"
                          disabled={joining}
                          onClick={() => void join({ tutor_student_id: m.tutor_student_id })}
                          style={{ touchAction: 'manipulation' }}
                          className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-base text-slate-900 transition-colors hover:border-accent hover:bg-accent/5"
                        >
                          <User className="h-4 w-4 shrink-0 text-slate-400" />
                          {m.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-sm text-slate-500">Нет в списке? Войдите зрителем:</p>
                </>
              )}
              <div className="mt-2 flex gap-2">
                <input
                  value={freeName}
                  onChange={(e) => setFreeName(e.target.value)}
                  placeholder="Ваше имя"
                  maxLength={60}
                  // 16px — iOS Safari не должен зумить (rule 80)
                  className="h-11 min-w-0 flex-1 rounded-md border border-slate-200 px-3 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                <Button
                  disabled={joining || !freeName.trim()}
                  onClick={() => void join({ display_name: freeName.trim() })}
                  style={{ touchAction: 'manipulation' }}
                >
                  {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Войти'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // key: смена slug/токена пересоздаёт вью (старый снимок и поллинг не
  // переживают новый URL — ревью P2).
  // «Сменить имя» — через onChangeIdentity: SharedBoardView сам ЖДЁТ flush
  // (ревью Этапа 5, P1: мгновенный сброс токена терял pending-сейв гостя
  // с зоной). Перевход показывает СВЕЖИЙ список «я — Маша» — зоны могли
  // раздать уже после его входа (провал теста Елены).
  return transport ? (
    <SharedBoardView
      key={`${slug}:${guestToken}`}
      transport={transport}
      onChangeIdentity={() => {
        clearGuestToken(slug);
        setMeta(null);
        setGuestToken(null);
      }}
    />
  ) : null;
}
