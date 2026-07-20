import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, Check, Loader2, AlertCircle, RefreshCw, Mail } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { getStudentClaimShareLink, formatClaimCode } from '@/utils/telegramLinks';
import { connectHomeworkStudentByEmail } from '@/lib/tutorHomeworkApi';
import { pluralizeRu } from '@/lib/pluralizeRu';

export interface ConnectStudentTarget {
  student_id: string;
  name: string;
}

interface ConnectStudentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Если задан — доступна авто-отправка приглашения+ДЗ на email. Без него
   *  (подключение с карточки ученика, без контекста ДЗ) — только QR/ссылка. */
  assignmentId?: string | null;
  students: ConnectStudentTarget[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Онбординг-активация v2 (T3) + №43 (2026-07-20) — гейт «Подключить ученика».
 * Открывается при первой отправке ДЗ ученику без канала И повторно с карточки
 * ученика (код многоразовый до регистрации — репетитор возвращается сюда, если
 * ученик потерял вход). Короткий код (диктуется) + ссылка + QR + «Отправить на
 * email» (авто). Telegram/WhatsApp — той же ссылкой (копировать).
 */
export function ConnectStudentSheet({ open, onOpenChange, assignmentId, students }: ConnectStudentSheetProps) {
  const { toast } = useToast();
  const [index, setIndex] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [tokenError, setTokenError] = useState(false);
  const [tokenErrorMsg, setTokenErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const current = students[index];
  const claimLink = token ? getStudentClaimShareLink(token) : '';
  // Короткий 8-симв. код (№43) — показываем крупно; legacy 32-hex → null
  // (только ссылка/QR, ротация в короткий произойдёт на стороне RPC).
  const shortCode = token ? formatClaimCode(token) : null;
  const total = students.length;

  // Сброс индекса при каждом открытии.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Резолв claim-токена для текущего ученика (tutor_students → RPC).
  useEffect(() => {
    if (!open || !current) return;
    let cancelled = false;
    setToken(null);
    setTokenError(false);
    setTokenErrorMsg(null);
    setCopied(false);
    setCodeCopied(false);
    setEmail('');
    setLoadingToken(true);
    (async () => {
      try {
        const { data: ts, error: tsErr } = await supabase
          .from('tutor_students')
          .select('id')
          .eq('student_id', current.student_id)
          .maybeSingle();
        if (tsErr || !ts?.id) throw tsErr ?? new Error('not_found');
        const { data: tok, error: rpcErr } = await supabase.rpc('tutor_ensure_student_claim_token', {
          p_tutor_student_id: ts.id,
        });
        if (rpcErr || !tok || typeof tok !== 'string') throw rpcErr ?? new Error('no_token');
        if (!cancelled) setToken(tok);
      } catch (e) {
        if (!cancelled) {
          // Ученик уже активен (RPC RAISE STUDENT_ALREADY_ACTIVE) — внятное
          // сообщение вместо generic; retry бесполезен (review round-3 P2).
          const msg = e instanceof Error ? e.message : String(e ?? '');
          setTokenErrorMsg(
            /STUDENT_ALREADY_ACTIVE/i.test(msg)
              ? 'Ученик уже зарегистрировался — он входит по паролю или по ссылке на почту. Код больше не нужен.'
              : null,
          );
          setTokenError(true);
        }
      } finally {
        if (!cancelled) setLoadingToken(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current?.student_id, reloadKey]);

  const advanceOrClose = () => {
    if (index < total - 1) {
      setIndex((i) => i + 1);
    } else {
      onOpenChange(false);
    }
  };

  const handleCopy = async () => {
    if (!claimLink) return;
    const ok = await copyText(claimLink);
    if (ok) {
      setCopied(true);
      toast({ title: 'Ссылка скопирована', description: 'Отправь её ученику — в любой чат.' });
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast({ title: 'Не удалось скопировать', variant: 'destructive' });
    }
  };

  const handleCopyCode = async () => {
    if (!shortCode) return;
    const ok = await copyText(shortCode);
    if (ok) {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } else {
      toast({ title: 'Не удалось скопировать', variant: 'destructive' });
    }
  };

  const handleSendEmail = async () => {
    if (!current || !assignmentId) return;
    if (!EMAIL_RE.test(email.trim())) {
      toast({ title: 'Введите корректный email', variant: 'destructive' });
      return;
    }
    setSendingEmail(true);
    try {
      const res = await connectHomeworkStudentByEmail(assignmentId, current.student_id, email.trim());
      if (res.email_enqueued) {
        toast({
          title: 'Приглашение отправлено',
          description: `${current.name} получит ссылку и задание на почту.`,
        });
        advanceOrClose();
      } else {
        // Канал захвачен, но письмо не поставилось в очередь (review P2 #7) —
        // не выдаём «отправлено», оставляем sheet, чтобы тутор скопировал ссылку.
        toast({
          title: 'Email сохранён, но письмо не ушло',
          description: 'Скопируйте ссылку выше и отправьте ученику вручную.',
          variant: 'destructive',
        });
      }
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : 'Не удалось отправить приглашение',
        variant: 'destructive',
      });
    } finally {
      setSendingEmail(false);
    }
  };

  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-sokrat-mode="tutor">
        <DialogHeader>
          <DialogTitle>Подключить · {current.name}</DialogTitle>
          <DialogDescription>
            Дальше задания приходят ученику сами. Код и ссылка работают, пока ученик не заведёт
            свою почту и пароль, — возвращайся сюда, если он потеряет вход.
          </DialogDescription>
        </DialogHeader>

        {loadingToken ? (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            <span className="text-sm">Готовим ссылку…</span>
          </div>
        ) : tokenError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-8 w-8 text-amber-500" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {tokenErrorMsg ?? 'Не удалось подготовить ссылку. Попробуйте ещё раз.'}
            </p>
            {tokenErrorMsg ? (
              <Button variant="outline" onClick={() => onOpenChange(false)} style={{ touchAction: 'manipulation' }}>
                Понятно
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)} style={{ touchAction: 'manipulation' }}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Повторить
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {shortCode && (
              <button
                type="button"
                onClick={handleCopyCode}
                className="flex min-h-[44px] w-full flex-col items-center gap-1 rounded-lg border border-border bg-socrat-surface px-4 py-3 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-accent/20"
                style={{ touchAction: 'manipulation' }}
                aria-label="Скопировать код входа"
                title="Скопировать код"
              >
                <span className="font-mono text-2xl font-semibold tracking-widest text-slate-900 tabular-nums">
                  {shortCode}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {codeCopied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
                  {codeCopied ? 'Код скопирован' : 'Код входа — нажми, чтобы скопировать'}
                </span>
              </button>
            )}
            {shortCode && (
              <p className="-mt-2 text-center text-xs text-muted-foreground">
                Продиктуй код — ученик введёт его на sokratai.ru на странице входа.
              </p>
            )}

            <div className="flex justify-center rounded-lg bg-white p-4">
              <QRCode value={claimLink} size={168} />
            </div>

            <Button className="w-full" onClick={handleCopy} style={{ touchAction: 'manipulation' }}>
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? 'Скопировано' : 'Скопировать ссылку'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Покажи QR на занятии/звонке или отправь ссылку в любой чат — Telegram, WhatsApp.
            </p>

            {assignmentId && (
              <>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  или отправить на email
                  <span className="h-px flex-1 bg-border" />
                </div>

                <div className="flex gap-2">
                  <Input
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="student@mail.ru"
                    className="text-base"
                  />
                  <Button
                    variant="outline"
                    onClick={handleSendEmail}
                    disabled={sendingEmail}
                    style={{ touchAction: 'manipulation' }}
                  >
                    {sendingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Сократ сам пришлёт приглашение и задание на почту.
                </p>
              </>
            )}

            <Button variant="ghost" className="w-full" onClick={advanceOrClose} style={{ touchAction: 'manipulation' }}>
              {total > 1 ? `Готово · ${index + 1}/${total}` : 'Готово'}
            </Button>
            {total > 1 && index < total - 1 && (
              <p className="text-center text-xs text-muted-foreground">
                Ещё {total - index - 1}{' '}
                {pluralizeRu(total - index - 1, ['ученик', 'ученика', 'учеников'])} без канала.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
