import { useCallback, useState } from 'react';
import { AI_MENTION_TOKEN } from '@/lib/tutorStudentChatApi';

// Trailing-anchor детект «@часть_имени» перед кареткой. Capturing group вместо
// lookbehind (Safari < 16.4, rule 80).
const MENTION_QUERY_RE = /(^|\s)@([\wа-яА-ЯёЁ]*)$/u;

const CANDIDATES = ['сократai', 'sokratai'];

interface MentionMatch {
  /** Индекс символа `@` в value. */
  start: number;
  query: string;
}

function detectMention(value: string, caret: number): MentionMatch | null {
  const upToCaret = value.slice(0, caret);
  const m = upToCaret.match(MENTION_QUERY_RE);
  if (!m) return null;
  const query = (m[2] ?? '').toLowerCase();
  if (!CANDIDATES.some((c) => c.startsWith(query))) return null;
  return { start: caret - query.length - 1, query };
}

/**
 * Автоподстановка @СократAI в композере (Telegram-mention UX): ввод `@` →
 * подсказка над полем, Enter/Tab/тап вставляет токен. Вставка через
 * `setRangeText` + ручной dispatch `input` (Safari-квирк: setRangeText не
 * фаерит input — прецедент MathQuickPicker).
 */
export function useMentionAutocomplete(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  onValueChange: (value: string) => void,
  enabled: boolean,
) {
  const [match, setMatch] = useState<MentionMatch | null>(null);

  const updateFromCaret = useCallback(() => {
    if (!enabled) return;
    const el = textareaRef.current;
    if (!el) return;
    setMatch(detectMention(el.value, el.selectionStart ?? el.value.length));
  }, [enabled, textareaRef]);

  const dismiss = useCallback(() => setMatch(null), []);

  const select = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !match) return;
    const caret = el.selectionStart ?? el.value.length;
    el.setRangeText(`${AI_MENTION_TOKEN} `, match.start, caret, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    onValueChange(el.value);
    setMatch(null);
    el.focus();
  }, [match, onValueChange, textareaRef]);

  /** Вернёт true, если событие обработано (не отдавать его Enter-to-send). */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!match) return false;
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        select();
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMatch(null);
        return true;
      }
      return false;
    },
    [match, select],
  );

  return {
    isOpen: match !== null,
    updateFromCaret,
    dismiss,
    select,
    handleKeyDown,
  };
}
