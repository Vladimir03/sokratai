import { useCallback, useEffect, useMemo, useState } from 'react';
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
// Realtime гостю недоступен (нет JWT) → поллинг /signals c backoff при
// неактивности вкладки. Синк — rev-diff (фикс P0 31.07): /signals отдаёт
// ПОЛНЫЙ список ревизий, решение «что изменилось» принимает SharedBoardView
// сверкой с локальными кадрами. Watermark по часам удалён: skew часов
// edge↔БД↔телефона делал гостя слепым навсегда («репетитор пишет — у
// ученика ничего 20-30 с+», живой тест владельца).

const POLL_ACTIVE_MS = 1500;
const POLL_HIDDEN_MS = 10000;

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

  const transport = useMemo<SharedBoardTransport | null>(() => {
    if (!slug || !guestToken) return null;
    // Токен протух/отозван (в т.ч. пере-входом той же личности с другого
    // устройства): ЛЮБОЙ путь с 401 уводит на join-экран — раньше это делал
    // только load, а поллинг молча глотал, и вкладка «умирала» (ревью
    // guest-sheets, P1 №2).
    const onUnauthorized = (err: unknown): boolean => {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401) {
        clearGuestToken(slug);
        setMeta(null);
        setGuestToken(null);
        return true;
      }
      return false;
    };
    return {
      // У гостя нет точечного чтения листа: rev-diff при изменениях делает
      // один resync на батч (SharedBoardView.handleRevsSnapshot).
      supportsPageRefetch: false,
      async load() {
        try {
          const state = await getGuestState(slug, guestToken);
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
          onUnauthorized(err);
          throw err;
        }
      },
      async savePage(pageId, elements, baseRev) {
        try {
          return await saveGuestPage(slug, guestToken, pageId, elements, baseRev);
        } catch (err) {
          onUnauthorized(err); // размонтирование доски погасит очередь
          throw err;
        }
      },
      // «+ Лист» в свой рулон — теперь и у гостя (кейс «у ученика кончился лист»).
      addMyPage: () => addGuestRollPage(slug, guestToken),
      async refetchPage() {
        // У гостя нет точечного чтения листа — вернём null, а onResync (ниже)
        // перечитает state целиком: поллинг и так batch'ует изменения.
        return null;
      },
      start(handlers) {
        let stopped = false;
        let ticking = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let failures = 0;

        const tick = async () => {
          if (stopped || ticking) return;
          ticking = true;
          try {
            const res = await getGuestSignals(slug, guestToken);
            if (stopped) return;
            failures = 0;
            handlers.onSyncState?.('polling');
            // «Привести всех» (Этап 4): у гостя нет Realtime — bring доезжает
            // отсюда. Дедуп по seq и свежесть — в applyBring выше.
            if (res.bring) handlers.onBring?.(res.bring);
            // Rev-diff: полный список ревизий → SharedBoardView сверяет с
            // кадрами и сам решает, нужен ли resync. Сбой resync не страшен —
            // rev-разница никуда не денется, следующий тик повторит
            // (самовосстановление вместо хрупкого watermark, фикс P0 31.07).
            handlers.onRevs?.(res.revs.map((r) => ({ page_id: r.page_id, rev: r.rev })));
          } catch (err) {
            // 401 = токен ревокнут (пере-вход с другого устройства) → на
            // join-экран; прочее — сетевой сбой, следующий тик попробует снова.
            if (onUnauthorized(err)) return;
            failures += 1;
            if (failures >= 2) handlers.onSyncState?.('offline');
          } finally {
            ticking = false;
            if (!stopped) {
              const delay = document.visibilityState === 'hidden' ? POLL_HIDDEN_MS : POLL_ACTIVE_MS;
              if (timer) clearTimeout(timer);
              timer = setTimeout(() => void tick(), delay);
            }
          }
        };

        // Возврат из фона / восстановление сети → немедленный тик: тик,
        // запланированный в hidden (10 с), иначе доигрывал бы свой таймер и
        // телефон смотрел на устаревшую сцену до 10 с после разворота PWA.
        const wake = () => {
          if (stopped || document.visibilityState === 'hidden') return;
          if (timer) clearTimeout(timer);
          timer = null;
          void tick();
        };
        document.addEventListener('visibilitychange', wake);
        window.addEventListener('online', wake);

        timer = setTimeout(() => void tick(), POLL_ACTIVE_MS);
        return () => {
          stopped = true;
          if (timer) clearTimeout(timer);
          document.removeEventListener('visibilitychange', wake);
          window.removeEventListener('online', wake);
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
