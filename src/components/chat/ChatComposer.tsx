import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAutoResizeTextarea } from '@/hooks/useAutoResizeTextarea';
import { usePasteImages } from '@/hooks/usePasteImages';
import { useMentionAutocomplete } from '@/hooks/chat/useMentionAutocomplete';
import { MAX_CHAT_ATTACHMENTS } from '@/lib/tutorStudentChatApi';
import { toast } from 'sonner';
import sokratChatIcon from '@/assets/sokrat-chat-icon.png';

const COMPOSER_MAX_HEIGHT = 120;
const MAX_CONTENT_CHARS = 4000;

export interface ChatComposerProps {
  /** false = отправка не состоялась (upload фото упал) — черновик сохраняем. */
  onSend: (content: string, files: File[]) => Promise<boolean | void> | boolean | void;
  onTyping?: () => void;
  disabled?: boolean;
  /** Причина блокировки (архивный ученик) — рендерится вместо композера. */
  disabledHint?: string | null;
  isSending?: boolean;
  mentionEnabled?: boolean;
}

/**
 * Композер чата репетитор↔ученик: авто-рост textarea (канонический хук),
 * фото (кнопка + Ctrl+V paste, кап 5), автоподстановка @СократAI при вводе `@`.
 * Enter = отправить на desktop / перенос строки на мобиле (зеркало ChatInput).
 * Не реюзает ChatInput — тот 1-файловый и связан с voice-флоу AI-чата.
 */
export const ChatComposer = memo(function ChatComposer({
  onSend,
  onTyping,
  disabled = false,
  disabledHint = null,
  isSending = false,
  mentionEnabled = true,
}: ChatComposerProps) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  useAutoResizeTextarea(textareaRef, text, COMPOSER_MAX_HEIGHT);

  const mention = useMentionAutocomplete(textareaRef, setText, mentionEnabled);

  // Object URLs превью — revoke на замену/анмаунт (memory leak guard).
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  const addFiles = useCallback(
    (incoming: File[]) => {
      setFiles((prev) => {
        const room = MAX_CHAT_ATTACHMENTS - prev.length;
        if (room <= 0) {
          toast.info(`Не больше ${MAX_CHAT_ATTACHMENTS} фото в одном сообщении`);
          return prev;
        }
        const accepted = incoming
          .filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
          .slice(0, room);
        if (accepted.length < incoming.length) {
          toast.info(
            accepted.length === 0
              ? 'Можно прикреплять только изображения'
              : `Добавлено ${accepted.length} из ${incoming.length} фото`,
          );
        }
        return accepted.length > 0 ? [...prev, ...accepted] : prev;
      });
    },
    [],
  );

  const handlePaste = usePasteImages({
    enabled: !disabled,
    maxFiles: MAX_CHAT_ATTACHMENTS,
    currentCount: files.length,
    onImagePasted: (file) => addFiles([file]),
    successToast: null,
    telemetryTag: 'tutor-student-chat',
  });

  const [isAwaitingSend, setIsAwaitingSend] = useState(false);
  const busy = isSending || isAwaitingSend;
  const canSend = !disabled && !busy && (text.trim().length > 0 || files.length > 0);

  const clearDraft = useCallback(() => {
    setText('');
    setFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSend) return;
    const content = text.trim();
    const outgoing = files;
    if (outgoing.length === 0) {
      // Текст — очищаем мгновенно (Telegram-скорость): оптимистичный пузырь
      // и «Повторить» на сбое живут в ленте, черновик держать не нужно.
      clearDraft();
      await onSend(content, []);
      return;
    }
    // С фото: сначала upload (может упасть) — черновик очищаем ТОЛЬКО при
    // успехе (ревью 5.6 P1: раньше частичный сбой терял сообщение и фото).
    setIsAwaitingSend(true);
    try {
      const ok = await onSend(content, outgoing);
      if (ok !== false) clearDraft();
    } finally {
      setIsAwaitingSend(false);
    }
  }, [canSend, clearDraft, files, onSend, text]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Открытый mention-поповер перехватывает Enter/Tab/Esc ДО Enter-to-send.
      if (mention.handleKeyDown(e)) return;
      if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit, isMobile, mention],
  );

  if (disabledHint) {
    return (
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm text-slate-500">
        {disabledHint}
      </div>
    );
  }

  return (
    <div className="relative border-t border-slate-200 bg-white">
      {mention.isOpen && (
        // Абсолютный div, НЕ Radix Popover — Radix крадёт фокус textarea на мобиле.
        <div className="absolute bottom-full left-3 z-20 mb-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault(); // не терять фокус textarea
              mention.select();
            }}
            className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-base hover:bg-socrat-surface"
            style={{ touchAction: 'manipulation' }}
          >
            <img
              src={sokratChatIcon}
              alt=""
              aria-hidden="true"
              className="h-6 w-6 rounded-full object-cover"
            />
            <span className="font-medium text-slate-900">СократAI</span>
            <span className="text-xs text-slate-400">позвать AI в чат</span>
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className="flex gap-2 overflow-x-auto touch-pan-x px-3 pt-2">
          {files.map((file, i) => (
            <div key={`${file.name}-${i}`} className="relative shrink-0">
              <img
                src={previews[i]}
                alt={`Фото ${i + 1}`}
                className="h-14 w-14 rounded-lg object-cover"
              />
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-white"
                style={{ touchAction: 'manipulation' }}
                aria-label="Убрать фото"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5 px-2 py-2" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || files.length >= MAX_CHAT_ATTACHMENTS}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-socrat-surface hover:text-slate-700 disabled:opacity-40"
          style={{ touchAction: 'manipulation' }}
          aria-label="Прикрепить фото"
        >
          <ImagePlus className="h-5 w-5" />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value.slice(0, MAX_CONTENT_CHARS));
            onTyping?.();
            mention.updateFromCaret();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onClick={mention.updateFromCaret}
          onBlur={() => window.setTimeout(mention.dismiss, 150)}
          placeholder="Сообщение…"
          disabled={disabled}
          className={cn(
            'min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5',
            // 16px обязателен — iOS Safari auto-zoom (rule 80)
            'text-base leading-snug text-slate-900 placeholder:text-slate-400',
            'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20',
          )}
        />

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSend}
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors',
            canSend ? 'bg-accent text-white hover:bg-accent/90' : 'bg-slate-100 text-slate-400',
          )}
          style={{ touchAction: 'manipulation' }}
          aria-label="Отправить"
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
});

export default ChatComposer;
