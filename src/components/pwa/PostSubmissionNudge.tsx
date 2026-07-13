import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { InstallSheet } from '@/components/pwa/InstallSheet';
import { useNotificationsSetup } from '@/hooks/useNotificationsSetup';

const SHOWN_KEY = 'sokrat-pwa-post-submit-shown';

/**
 * Одноразовый надж после ПЕРВОЙ успешной сдачи решения — момент максимальной
 * мотивации («узнай первым, когда репетитор проверит»). Показывается один раз
 * за всё время (localStorage), только если есть что настраивать (push/установка).
 * `tick` инкрементится родителем на каждый успешный submit.
 */
export function PostSubmissionNudge({ tick }: { tick: number }) {
  const setup = useNotificationsSetup();
  const [open, setOpen] = useState(false);
  const [installSheetOpen, setInstallSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Актуальный eligibility для отложенного таймера (без пересоздания таймера).
  const hasActionRef = useRef(false);
  hasActionRef.current = setup.nextAction !== null;

  useEffect(() => {
    if (tick === 0) return;
    try {
      if (localStorage.getItem(SHOWN_KEY) === '1') return;
    } catch {
      return;
    }
    // Дать verdict-фидбеку отрисоваться, потом мягко предложить. Одноразовый
    // флаг жжём В МОМЕНТ показа (ревью 5.6 P1: запись за 1.6с до показа +
    // unmount навсегда съедали надж); eligibility перечитывается на файринге
    // (capability могла появиться/исчезнуть за паузу).
    const timer = window.setTimeout(() => {
      if (!hasActionRef.current) return;
      try {
        if (localStorage.getItem(SHOWN_KEY) === '1') return;
        localStorage.setItem(SHOWN_KEY, '1');
      } catch {
        return;
      }
      setOpen(true);
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [tick]);

  const action = setup.nextAction;
  if (!action) return null;

  const handleCta = async () => {
    if (busy) return;
    setBusy(true);
    console.info('[pwa-nudge] clicked', { context: 'post-submission', kind: action.kind });
    try {
      if (action.kind === 'push') {
        const ok = await setup.runPush();
        if (ok) toast.success('Уведомления включены!');
        else toast.error('Не удалось включить уведомления — можно повторить из Профиля.');
        setOpen(false);
        return;
      }
      if (action.kind === 'install-native') {
        const outcome = await setup.runNativeInstall();
        if (outcome === 'accepted') toast.success('Сократ добавлен на экран телефона!');
        setOpen(false);
        return;
      }
      // iOS / ручной Android — инструкция
      setOpen(false);
      setInstallSheetOpen(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="text-left">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
                <CheckCircle2 className="h-5 w-5 text-accent" aria-hidden="true" />
              </span>
              <div>
                <SheetTitle className="text-lg">Решение отправлено</SheetTitle>
                <SheetDescription className="text-sm">
                  Узнайте первым, когда репетитор проверит работу
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCta()}
              className="min-h-[48px] rounded-xl bg-accent px-4 text-base font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
              style={{ touchAction: 'manipulation' }}
            >
              {busy ? '…' : action.label}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-[44px] rounded-xl px-4 text-sm font-medium text-slate-500 hover:text-slate-700"
              style={{ touchAction: 'manipulation' }}
            >
              Не сейчас
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <InstallSheet
        open={installSheetOpen}
        onOpenChange={setInstallSheetOpen}
        subtitle="Уведомления о проверке ДЗ и сообщениях репетитора"
      />
    </>
  );
}

export default PostSubmissionNudge;
