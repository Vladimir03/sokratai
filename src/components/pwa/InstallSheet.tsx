import { Link } from 'react-router-dom';
import { Bell, MoreVertical, Share, SquarePlus } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { isIosDevice } from '@/lib/pwaInstall';
import sokratLogo from '@/assets/sokrat-logo.png';

export interface InstallSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Подзаголовок ценности («Получай сообщения репетитора…»). */
  subtitle?: string;
}

/**
 * Bottom-sheet с инструкцией установки на экран «Домой» — для платформ без
 * нативного install-промпта (iOS всегда; Android-браузеры без
 * beforeinstallprompt). Два визуальных шага + ссылка на подробную /install.
 * На iOS один клик невозможен by Apple — это максимально короткий путь.
 */
export function InstallSheet({ open, onOpenChange, subtitle }: InstallSheetProps) {
  const ios = isIosDevice();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-3">
            <img src={sokratLogo} alt="" aria-hidden="true" className="h-10 w-10 rounded-xl" />
            <div>
              <SheetTitle className="text-lg">Сократ на экране телефона</SheetTitle>
              <SheetDescription className="text-sm">
                {subtitle ?? 'Уведомления о сообщениях и домашках — как в мессенджере'}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ol className="mt-4 space-y-3">
          <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
              1
            </span>
            {ios ? (
              <p className="text-base text-slate-800">
                Нажмите{' '}
                <span className="mx-0.5 inline-flex translate-y-0.5 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-sm font-medium">
                  <Share className="h-4 w-4 text-sky-600" aria-hidden="true" />
                  Поделиться
                </span>{' '}
                внизу Safari
              </p>
            ) : (
              <p className="text-base text-slate-800">
                Откройте{' '}
                <span className="mx-0.5 inline-flex translate-y-0.5 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-sm font-medium">
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                  меню браузера
                </span>{' '}
                (три точки)
              </p>
            )}
          </li>
          <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
              2
            </span>
            <p className="text-base text-slate-800">
              Выберите{' '}
              <span className="mx-0.5 inline-flex translate-y-0.5 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-sm font-medium">
                <SquarePlus className="h-4 w-4 text-accent" aria-hidden="true" />
                {ios ? 'На экран „Домой"' : 'Добавить на главный экран'}
              </span>
            </p>
          </li>
        </ol>

        <div className="mt-4 flex items-start gap-2 rounded-xl bg-accent/5 p-3">
          <Bell className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <p className="text-sm text-slate-700">
            После установки откройте Сократ с новой иконки и разрешите уведомления —
            они начнут приходить, как в мессенджере.
          </p>
        </div>

        <Link
          to="/install"
          className="mt-3 block text-center text-sm font-medium text-accent underline-offset-2 hover:underline"
          onClick={() => onOpenChange(false)}
          style={{ touchAction: 'manipulation' }}
        >
          Подробная инструкция для всех браузеров
        </Link>
      </SheetContent>
    </Sheet>
  );
}

export default InstallSheet;
