import { Check, CheckCheck, Clock, CircleAlert } from 'lucide-react';
import type { MessageSendStatus } from '@/types/tutorStudentChat';

/** Telegram-статус собственного сообщения: ⏱ отправляется → ✓ доставлено → ✓✓ прочитано. */
export function ReadTicks({ status }: { status: MessageSendStatus }) {
  if (status === 'failed') {
    return <CircleAlert className="h-3.5 w-3.5 text-red-500" aria-label="Не отправлено" />;
  }
  if (status === 'sending') {
    return <Clock className="h-3.5 w-3.5 text-slate-400" aria-label="Отправляется" />;
  }
  if (status === 'read') {
    return <CheckCheck className="h-3.5 w-3.5 text-accent" aria-label="Прочитано" />;
  }
  return <Check className="h-3.5 w-3.5 text-slate-400" aria-label="Отправлено" />;
}

export default ReadTicks;
