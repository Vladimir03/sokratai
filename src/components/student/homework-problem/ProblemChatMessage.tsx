import { memo, lazy, Suspense } from 'react';
import { Quote } from 'lucide-react';
import { SokratAvatar } from './SokratAvatar';
import { TypingDots } from './TypingDots';
import { preprocessLatex } from '@/components/kb/ui/preprocessLatex';

// Heavy KaTeX rendering — lazy-load only when a message has math.
const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

export interface ProblemChatMessageData {
  id: string;
  who: 'system' | 'ai' | 'user' | 'typing';
  text?: string;
  /** AI-only kicker over the bubble (e.g. «Сократ» / «СОКРАТ»). */
  kicker?: string;
  /** AI-only optional inline quote-attachment (green left border). */
  attachment?: { kind: 'quote'; text: string };
  created_at?: string;
}

interface ProblemChatMessageProps {
  message: ProblemChatMessageData;
}

/**
 * Pixel-perfect single chat-message renderer for the new student
 * homework-problem screen (Phase 1, mobile). Mirrors design from
 * `design_handoff_homework_chat/student-problem-chat.jsx::ChatMessage`
 * + CSS `.ch-msg__*` rules.
 *
 * NOT shared with `src/components/homework/GuidedChatMessage.tsx` —
 * that component is the production guided-chat surface (used by
 * `GuidedHomeworkWorkspace` and tutor `GuidedThreadViewer`). Visual
 * differences (kicker case, bubble border treatment, quote-attachment)
 * justify a separate dedicated component for Phase 1. Phase 3 may
 * converge them after the new screen reaches feature parity and this
 * one becomes the canonical implementation.
 *
 * Bubble palette:
 * - AI:     bg `card` (white), border `socrat-border-light`, top-left
 *           corner squared (4px) for visual "tail", subtle xs shadow.
 * - User:   bg `socrat-border-light` (warm grey), `fg2` text, top-right
 *           corner squared. Self-aligned right.
 * - System: centered pill on `socrat-surface` bg.
 */
export const ProblemChatMessage = memo(function ProblemChatMessage({
  message,
}: ProblemChatMessageProps) {
  if (message.who === 'system') {
    return (
      <div className="flex justify-center my-1">
        <div className="text-xs font-medium text-slate-500 bg-socrat-surface rounded-full px-3 py-1.5 max-w-[85%] text-center">
          {message.text}
        </div>
      </div>
    );
  }

  if (message.who === 'typing') {
    return (
      <div className="flex gap-2.5 max-w-full">
        <SokratAvatar size={32} />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-socrat-primary pl-1 flex items-center gap-1.5">
            Сократ
            <span className="text-xs font-medium text-slate-500 normal-case tracking-normal italic">
              думает над подсказкой…
            </span>
          </div>
          <div className="self-start max-w-[86%] rounded-2xl rounded-tl-[4px] border border-socrat-border-light bg-white px-3.5 py-2.5 shadow-sm">
            <TypingDots />
          </div>
        </div>
      </div>
    );
  }

  if (message.who === 'ai') {
    const text = message.text ?? '';
    const hasMath = /\$|\\\(|\\\[/.test(text);
    return (
      <div className="flex gap-2.5 max-w-full">
        <SokratAvatar size={32} />
        <div className="flex flex-col gap-1 min-w-0 flex-1 max-w-[calc(100%-42px)]">
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-socrat-primary pl-1">
            {message.kicker ?? 'Сократ'}
          </div>
          {message.attachment?.kind === 'quote' ? (
            <div className="self-start inline-flex items-center gap-1.5 rounded-r-lg border-l-2 border-socrat-primary bg-socrat-primary-light px-2.5 py-1 text-xs font-semibold text-socrat-primary-dark">
              <Quote className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{message.attachment.text}</span>
            </div>
          ) : null}
          <div className="self-start max-w-[86%] rounded-2xl rounded-tl-[4px] border border-socrat-border-light bg-white px-3.5 py-2.5 shadow-sm text-[14.5px] leading-[1.5] text-slate-900 break-words [text-wrap:pretty]">
            {hasMath ? (
              <Suspense
                fallback={
                  <p className="whitespace-pre-wrap break-words">{text}</p>
                }
              >
                <MathText text={preprocessLatex(text)} />
              </Suspense>
            ) : (
              <p className="whitespace-pre-wrap break-words m-0">{text}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // user
  const text = message.text ?? '';
  return (
    <div className="flex justify-end max-w-full">
      <div className="self-end max-w-[80%] rounded-2xl rounded-tr-[4px] bg-socrat-border-light px-3 py-2 text-[13.5px] leading-[1.5] text-slate-700 break-words [text-wrap:pretty]">
        {text}
      </div>
    </div>
  );
});
