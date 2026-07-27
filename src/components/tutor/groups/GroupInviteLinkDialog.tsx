// «Ссылка в группу» — персональная ссылка саморегистрации на учебную группу
// (самая настойчивая просьба Дианы 2026-07-27, повторена 4 раза за звонок).
// Ученик по ссылке проходит обычный invite-флоу и сразу попадает в группу.
// Ссылка = канонический sokratai.ru/invite/{invite_code}?g={join_code}
// (share-паттерн getTutorInviteWebLink; OG отдаёт nginx). Отзыв = regenerate.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { Check, Copy, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { ensureGroupJoinCode } from '@/lib/tutors';
import { useTutor } from '@/hooks/useTutor';
import { getTutorInviteWebLink } from '@/utils/telegramLinks';
import { cn } from '@/lib/utils';

interface GroupInviteLinkDialogProps {
  group: { id: string; name: string; short_name?: string | null };
  onClose: () => void;
}

export function GroupInviteLinkDialog({ group, onClose }: GroupInviteLinkDialogProps) {
  const { tutor } = useTutor();
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(tutor?.invite_code ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // join-код группы + invite-код репетитора (fallback через RPC, если профиль
  // ещё не доехал — паттерн AddStudentDialog.fetchTutorInviteCode).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [code, invite] = await Promise.all([
          ensureGroupJoinCode(group.id),
          (async () => {
            if (tutor?.invite_code) return tutor.invite_code;
            const { data, error } = await supabase.rpc('tutor_get_invite_code');
            if (error || typeof data !== 'string' || !data) {
              throw new Error('Не удалось получить код приглашения');
            }
            return data;
          })(),
        ]);
        if (cancelled) return;
        setJoinCode(code);
        setInviteCode(invite);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Не удалось получить ссылку');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // tutor?.invite_code намеренно не в deps: one-shot на открытие диалога.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  const link =
    joinCode && inviteCode
      ? `${getTutorInviteWebLink(inviteCode)}?g=${encodeURIComponent(joinCode)}`
      : null;

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Ссылка скопирована — отправьте её ученикам группы');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  };

  const handleRegenerate = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRegenerating(true);
    try {
      const fresh = await ensureGroupJoinCode(group.id, true);
      setJoinCode(fresh);
      toast.success('Старая ссылка отозвана, создана новая');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось пересоздать ссылку');
    } finally {
      busyRef.current = false;
      setRegenerating(false);
    }
  };

  const groupLabel = group.short_name?.trim() || group.name;

  return (
    <>
      <div className="fixed inset-0 z-[300] bg-black/40 animate-in fade-in-0" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-invite-title"
        className="fixed left-1/2 top-1/2 z-[301] flex w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center justify-between border-b border-socrat-border px-5 py-4">
          <h3 id="group-invite-title" className="min-w-0 truncate text-base font-semibold">
            Ссылка в группу «{groupLabel}»
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-50"
            style={{ touchAction: "manipulation" }}
            aria-label="Закрыть"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-slate-600">
            Ученик регистрируется (или входит) по этой ссылке и сразу попадает в группу —
            заводить вручную не нужно.
          </p>

          {loadError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{loadError}</p>
          ) : !link ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Готовим ссылку…</p>
          ) : (
            <>
              <div className="flex justify-center rounded-lg border border-socrat-border bg-white p-3">
                <QRCode value={link} size={144} aria-label="QR-код ссылки группы" />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Ссылка приглашения в группу"
                  className="min-w-0 flex-1 rounded-lg border border-socrat-border bg-slate-50 px-3 py-2 text-[16px] text-slate-700 focus:outline-none"
                  style={{ touchAction: 'manipulation' }}
                />
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  aria-label="Скопировать ссылку"
                  className="shrink-0 rounded-lg bg-accent px-3 py-2.5 text-white transition-colors hover:bg-accent/90"
                  style={{ touchAction: 'manipulation' }}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-socrat-border px-5 py-3.5">
          <button
            type="button"
            onClick={() => void handleRegenerate()}
            disabled={regenerating || !joinCode}
            className={cn(
              'inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-slate-700',
              (regenerating || !joinCode) && 'opacity-50',
            )}
            style={{ touchAction: 'manipulation' }}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', regenerating && 'animate-spin')} />
            Отозвать и создать новую
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-socrat-primary px-4 py-2 text-[13px] font-semibold text-white"
          >
            Готово
          </button>
        </div>
      </div>
    </>
  );
}
