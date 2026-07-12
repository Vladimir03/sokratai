import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

export function formatChatDateLabel(iso: string): string {
  const date = parseISO(iso);
  if (isToday(date)) return 'Сегодня';
  if (isYesterday(date)) return 'Вчера';
  return format(date, 'd MMMM', { locale: ru });
}

/** Telegram-пилюля даты между дневными группами сообщений. */
export function ChatDateSeparator({ iso }: { iso: string }) {
  return (
    <div className="flex justify-center py-2" role="separator">
      <span className="rounded-full bg-slate-900/60 px-3 py-0.5 text-xs font-medium text-white">
        {formatChatDateLabel(iso)}
      </span>
    </div>
  );
}

export default ChatDateSeparator;
