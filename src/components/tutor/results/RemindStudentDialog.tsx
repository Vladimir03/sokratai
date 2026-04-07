import { useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  remindHomeworkStudent,
  type RemindChannelPreference,
} from '@/lib/tutorHomeworkApi';
import {
  REMIND_MESSAGE_MAX_CHARS,
  remindPresetMessage,
} from '@/lib/homeworkResultsConstants';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
import { cn } from '@/lib/utils';

export type RemindChannel = 'telegram' | 'email';

interface RemindStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  studentId: string;
  studentName: string;
  assignmentTitle: string;
  /** Whether this student has a resolvable Telegram link. */
  hasTelegram: boolean;
  /** Whether this student has a non-placeholder email. */
  hasEmail: boolean;
  /** Called after a successful send so the parent can clear local state. */
  onSent?: () => void;
}

/**
 * Per-student re-engagement reminder dialog (Homework Results v2, AC-6 / AC-7).
 *
 * Strict no-fire-and-forget: tutor must explicitly click «Отправить»; the dialog
 * stays open on failure with a toast so the message can be retried. Telemetry
 * payload contains only ids and channel — never name, email, or message text.
 *
 * Channel selection: tabs `[Telegram] [Email]`. Default = Telegram when linked,
 * else Email. Tabs for unavailable channels are rendered disabled with a hint.
 */
export function RemindStudentDialog({
  open,
  onOpenChange,
  assignmentId,
  studentId,
  studentName,
  assignmentTitle,
  hasTelegram,
  hasEmail,
  onSent,
}: RemindStudentDialogProps) {
  const defaultChannel: RemindChannel = hasTelegram ? 'telegram' : 'email';
  const [channel, setChannel] = useState<RemindChannel>(defaultChannel);
  const [text, setText] = useState(() => remindPresetMessage(assignmentTitle));
  const [sending, setSending] = useState(false);

  // Reset channel + text whenever the dialog re-opens so the preset stays in
  // sync with the assignment title and previous edits don't bleed across opens.
  useEffect(() => {
    if (open) {
      setChannel(hasTelegram ? 'telegram' : 'email');
      setText(remindPresetMessage(assignmentTitle));
    }
  }, [open, assignmentTitle, hasTelegram]);

  const trimmed = text.trim();
  const tooLong = text.length > REMIND_MESSAGE_MAX_CHARS;
  const canSend = trimmed.length > 0 && !tooLong && !sending;

  const channelHint = useMemo(() => {
    if (channel === 'telegram') return 'Будет отправлено в Telegram';
    return 'Будет отправлено на email';
  }, [channel]);

  const sendLabel =
    channel === 'telegram' ? 'Отправить в Telegram' : 'Отправить на email';

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const preference: RemindChannelPreference = channel;
      const res = await remindHomeworkStudent(
        assignmentId,
        studentId,
        trimmed,
        preference,
      );
      trackGuidedHomeworkEvent('telegram_reminder_sent_from_results', {
        assignmentId,
        studentId,
        kind: 'remind',
        channel: res.channel,
      });
      toast.success(
        res.channel === 'telegram'
          ? 'Сообщение отправлено в Telegram'
          : 'Сообщение отправлено на email',
      );
      onSent?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
      toast.error(`Не удалось отправить: ${message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (sending ? null : onOpenChange(next))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Напомнить ученику</DialogTitle>
          <DialogDescription>
            {studentName} · ДЗ «{assignmentTitle}»
          </DialogDescription>
        </DialogHeader>

        {/* Channel tabs */}
        <div
          role="tablist"
          aria-label="Канал отправки"
          className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-sm"
        >
          <ChannelTab
            label="Telegram"
            icon={<Send className="h-4 w-4" />}
            active={channel === 'telegram'}
            disabled={!hasTelegram || sending}
            disabledHint="У ученика не привязан Telegram"
            onClick={() => setChannel('telegram')}
          />
          <ChannelTab
            label="Email"
            icon={<Mail className="h-4 w-4" />}
            active={channel === 'email'}
            disabled={!hasEmail || sending}
            disabledHint="У ученика нет email"
            onClick={() => setChannel('email')}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="remind-student-message"
            className="block text-sm font-medium text-slate-700"
          >
            Сообщение
          </label>
          {/*
            Native <textarea> instead of the shared shadcn Textarea — the latter
            uses text-sm (14px) which triggers iOS Safari auto-zoom on focus.
            16px (text-base) is mandatory per .claude/rules/80-cross-browser.md.
          */}
          <textarea
            id="remind-student-message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={sending}
            maxLength={REMIND_MESSAGE_MAX_CHARS}
            rows={5}
            className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Напиши сообщение ученику..."
          />
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{channelHint}</span>
            <span className={tooLong ? 'text-red-600' : undefined}>
              {text.length}/{REMIND_MESSAGE_MAX_CHARS}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Отмена
          </Button>
          <Button type="button" onClick={handleSend} disabled={!canSend}>
            {sending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {sendLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ChannelTabProps {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  disabled: boolean;
  disabledHint: string;
  onClick: () => void;
}

function ChannelTab({
  label,
  icon,
  active,
  disabled,
  disabledHint,
  onClick,
}: ChannelTabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-disabled={disabled}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors',
        active
          ? 'bg-white text-slate-900 shadow-sm'
          : 'text-slate-500 hover:text-slate-700',
        disabled && 'opacity-50 cursor-not-allowed hover:text-slate-500',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
