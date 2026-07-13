import { memo } from 'react';
import { format, isToday, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Archive, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/common/UserAvatar';
import type { ChatConversationListItem, ChatPerspective } from '@/types/tutorStudentChat';

function formatRowTime(iso: string | null): string {
  if (!iso) return '';
  const date = parseISO(iso);
  if (isToday(date)) return format(date, 'HH:mm');
  return format(date, 'd MMM', { locale: ru });
}

export interface ConversationRowProps {
  item: ChatConversationListItem;
  myRole: ChatPerspective;
  active?: boolean;
  /** Стабильный колбэк с параметром (НЕ inline-замыкание на строку) — иначе memo мёртв (ревью 5.6 р.2 #8). */
  onSelect: (item: ChatConversationListItem) => void;
}

/** Telegram-строка списка чатов: аватар, имя (bold при непрочитанном), превью, время, бейдж. */
export const ConversationRow = memo(function ConversationRow({
  item,
  myRole,
  active = false,
  onSelect,
}: ConversationRowProps) {
  const hasUnread = item.unread_count > 0;
  const isGroupItem = item.kind === 'group' || Boolean(item.group);
  // Группа: имя автора уже запечено в превью сервером («Вася: …»);
  // клиент добавляет только 'СократAI: ' (assistant без имени).
  const previewPrefix = item.last_message_sender === 'assistant'
    ? 'СократAI: '
    : !isGroupItem && item.last_message_sender === myRole
      ? 'Вы: '
      : '';
  const preview = item.last_message_preview
    ? `${previewPrefix}${item.last_message_preview}`
    : 'Нет сообщений — напишите первым';

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        'flex w-full min-h-[64px] items-center gap-3 px-3 py-2.5 text-left transition-colors',
        active ? 'bg-accent/10' : 'hover:bg-socrat-surface',
      )}
      style={{ touchAction: 'manipulation' }}
      aria-current={active ? 'true' : undefined}
    >
      {isGroupItem ? (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-socrat-folder-bg">
          <Users className="h-5 w-5 text-socrat-folder" aria-hidden="true" />
        </span>
      ) : (
        <UserAvatar
          name={item.partner_name}
          avatarUrl={item.partner_avatar_url}
          gender={(item.partner_gender as 'male' | 'female' | null) ?? null}
          size="md"
          className="shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              'truncate text-[15px] text-slate-900',
              hasUnread ? 'font-bold' : 'font-medium',
            )}
          >
            {item.partner_name}
          </span>
          <span className="shrink-0 text-xs text-slate-400">
            {formatRowTime(item.last_message_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm',
              hasUnread ? 'text-slate-700' : 'text-slate-500',
              !item.last_message_preview && 'italic text-slate-400',
            )}
          >
            {preview}
          </span>
          {hasUnread ? (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-none text-white">
              {item.unread_count > 99 ? '99+' : item.unread_count}
            </span>
          ) : item.archived ? (
            <Archive className="h-4 w-4 shrink-0 text-slate-300" aria-label="В архиве" />
          ) : null}
        </div>
      </div>
    </button>
  );
});

export default ConversationRow;
