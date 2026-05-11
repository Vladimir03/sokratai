import { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Send,
  X,
} from 'lucide-react';

interface NumericAnswerComposerProps {
  /** Inline answer draft (left-side green field). */
  answerDraft: string;
  onAnswerDraftChange: (value: string) => void;
  onSendAnswer: () => void;
  /** Discussion draft (collapsible chat row). */
  discussionDraft: string;
  onDiscussionDraftChange: (value: string) => void;
  onSendDiscussion: () => void;
  /** Hint button — стационарен рядом с answer field. */
  onHintClick: () => void;
  isRequestingHint: boolean;
  /** Mic для discussion field (запись + транскрибирование в discussion). */
  onMicClick: () => void;
  micRecording: boolean;
  micDurationSec: number;
  micSupported: boolean;
  isTranscribing: boolean;
  /** File attachment (paperclip) — только в discussion row. */
  onPaperclipClick: () => void;
  attachmentRefs: string[];
  onRemoveAttachment: (ref: string) => void;
  isUploadingAttachment: boolean;
  /** AI streaming state — disable inputs пока стримит. */
  isStreaming: boolean;
  /** Answer-submit pending state. */
  isAnswerSubmitting: boolean;
  /** Если задача уже completed — primary CTA flips на «Следующая задача». */
  isCurrentCompleted: boolean;
  hasNextTask: boolean;
  onNavigateNext: () => void;
}

/**
 * Inline composer for `task_kind='numeric'` tasks (Phase 1.3,
 * preview-QA #8, 2026-05-11).
 *
 * Three rows:
 *   1. **Answer row** (always visible): 💡 hint + green-bordered input
 *      «Ответ...» + send button. Tap send → `checkAnswer` API path
 *      (formal grading, may close task). Самое популярное действие на
 *      numeric задачах = одна строка, один клик.
 *   2. **Discussion toggle** (always visible, small): «Обсудить шаг
 *      с AI ▼» / «Свернуть ▲» button.
 *   3. **Discussion row** (collapsible, hidden by default): paperclip +
 *      input «Спроси Сократа о шаге...» + 🎤 mic + send. Discussion =
 *      `/chat` endpoint (does NOT close task — Phase 1.2 contract).
 *
 * Mirrors legacy desktop pattern из `GuidedChatInput.tsx:611-810` но
 * мобильно-адаптирован: меньшие padding, иконки 18px, touch-manipulation
 * на каждом interactive.
 *
 * После completion (CORRECT verdict): answer row hidden, discussion row
 * + toggle тоже hidden; вместо них показывается primary CTA «Следующая
 * задача →» / «Назад к ДЗ» (как и в большой submission flow).
 */
export function NumericAnswerComposer({
  answerDraft,
  onAnswerDraftChange,
  onSendAnswer,
  discussionDraft,
  onDiscussionDraftChange,
  onSendDiscussion,
  onHintClick,
  isRequestingHint,
  onMicClick,
  micRecording,
  micDurationSec,
  micSupported,
  isTranscribing,
  onPaperclipClick,
  attachmentRefs,
  onRemoveAttachment,
  isUploadingAttachment,
  isStreaming,
  isAnswerSubmitting,
  isCurrentCompleted,
  hasNextTask,
  onNavigateNext,
}: NumericAnswerComposerProps) {
  const [discussionExpanded, setDiscussionExpanded] = useState(false);

  // Completion state — answer + discussion заменяются на «Следующая
  // задача» CTA. (Аналогично большому composer'у extended-задач.)
  if (isCurrentCompleted) {
    return (
      <div className="flex flex-col gap-2 bg-white border-t border-socrat-border-light px-2.5 pt-2 pb-2.5 shrink-0">
        <button
          type="button"
          onClick={onNavigateNext}
          aria-label={hasNextTask ? 'Следующая задача' : 'Назад к ДЗ'}
          className="flex items-center gap-2.5 w-full px-3 py-2.5 bg-socrat-primary hover:bg-socrat-primary-dark text-white rounded-[14px] text-left transition-colors touch-manipulation"
        >
          <span className="grid place-items-center w-7 h-7 rounded-full bg-white/20 shrink-0">
            <ArrowRight className="h-[18px] w-[18px] stroke-2" aria-hidden="true" />
          </span>
          <span className="flex flex-col flex-1 min-w-0 gap-px">
            <span className="text-sm font-bold leading-tight">
              {hasNextTask ? 'Следующая задача' : 'Назад к ДЗ'}
            </span>
            <span className="text-[11px] font-medium text-white/80 truncate">
              Задача сдана
            </span>
          </span>
        </button>
      </div>
    );
  }

  const canSendAnswer =
    !isAnswerSubmitting && !isStreaming && answerDraft.trim().length > 0;

  const canSendDiscussion =
    !isStreaming &&
    !isUploadingAttachment &&
    !isTranscribing &&
    (discussionDraft.trim().length > 0 || attachmentRefs.length > 0);

  return (
    <div className="flex flex-col gap-2 bg-white border-t border-socrat-border-light px-2.5 pt-2 pb-2.5 shrink-0">
      {/* Row 1 — Answer field (green border, primary action) */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Запросить подсказку"
          disabled={isAnswerSubmitting || isRequestingHint || isStreaming}
          onClick={onHintClick}
          className="grid place-items-center w-9 h-10 rounded-[10px] text-amber-600 hover:bg-amber-50 hover:text-amber-700 shrink-0 touch-manipulation transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRequestingHint ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
          ) : (
            <Lightbulb className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </button>
        <input
          type="text"
          value={answerDraft}
          onChange={(e) => onAnswerDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSendAnswer) {
              e.preventDefault();
              onSendAnswer();
            }
          }}
          placeholder="Ответ..."
          disabled={isAnswerSubmitting || isStreaming}
          // 16px font-size — prevent iOS Safari auto-zoom on focus.
          style={{ fontSize: '16px' }}
          className="flex-1 min-w-0 h-10 px-3.5 bg-white border-2 border-socrat-primary rounded-[20px] text-sm text-slate-900 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-socrat-primary/20 disabled:opacity-50"
          aria-label="Ответ"
        />
        <button
          type="button"
          aria-label="Отправить ответ"
          disabled={!canSendAnswer}
          onClick={onSendAnswer}
          className="grid place-items-center w-10 h-10 rounded-full bg-socrat-primary hover:bg-socrat-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white shrink-0 touch-manipulation transition-colors"
        >
          {isAnswerSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Row 2 — Discussion toggle (small, collapsed by default) */}
      <button
        type="button"
        onClick={() => setDiscussionExpanded((v) => !v)}
        aria-expanded={discussionExpanded}
        aria-controls="numeric-discussion-row"
        className="inline-flex items-center justify-center gap-1.5 self-start text-[11px] font-semibold text-socrat-muted hover:text-slate-900 touch-manipulation py-1 px-2 rounded-md transition-colors"
      >
        {discussionExpanded ? 'Свернуть обсуждение' : 'Обсудить шаг с AI'}
        {discussionExpanded ? (
          <ChevronUp className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        )}
      </button>

      {/* Row 3 — Discussion field (collapsible) */}
      <div
        id="numeric-discussion-row"
        className={`flex flex-col gap-2 overflow-hidden transition-[max-height] duration-200 ${
          discussionExpanded ? 'max-h-96' : 'max-h-0'
        }`}
        aria-hidden={!discussionExpanded}
      >
        {attachmentRefs.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {attachmentRefs.map((ref) => (
              <span
                key={ref}
                className="inline-flex items-center gap-1 text-xs bg-socrat-surface text-slate-700 rounded-full pl-2 pr-1 py-0.5"
              >
                Фото
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(ref)}
                  aria-label="Удалить вложение"
                  className="grid place-items-center w-5 h-5 rounded-full hover:bg-socrat-border-light"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            {isUploadingAttachment ? (
              <span className="text-xs text-socrat-muted inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Загрузка...
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Прикрепить фото"
            disabled={isUploadingAttachment || isStreaming || !discussionExpanded}
            onClick={onPaperclipClick}
            className="grid place-items-center w-9 h-10 rounded-[10px] text-slate-500 hover:bg-socrat-surface hover:text-slate-900 shrink-0 touch-manipulation disabled:opacity-50"
          >
            <Paperclip className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <input
            type="text"
            value={discussionDraft}
            onChange={(e) => onDiscussionDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSendDiscussion) {
                e.preventDefault();
                onSendDiscussion();
              }
            }}
            placeholder={
              isTranscribing
                ? 'Расшифровываем…'
                : micRecording
                ? `Запись: ${micDurationSec}с`
                : 'Спроси Сократа о шаге…'
            }
            disabled={isStreaming || isTranscribing || micRecording || !discussionExpanded}
            tabIndex={discussionExpanded ? 0 : -1}
            // 16px to prevent iOS auto-zoom.
            style={{ fontSize: '16px' }}
            className="flex-1 min-w-0 h-10 px-3.5 bg-socrat-surface border border-socrat-border rounded-[20px] text-sm text-slate-900 outline-none focus-visible:border-socrat-primary focus-visible:ring-2 focus-visible:ring-socrat-primary/20 disabled:opacity-50"
            aria-label="Сообщение Сократу для обсуждения шага"
          />
          <button
            type="button"
            aria-label={micRecording ? 'Остановить запись' : 'Записать голосом'}
            disabled={isStreaming || isTranscribing || !micSupported}
            onClick={onMicClick}
            className={`grid place-items-center w-9 h-10 rounded-[10px] shrink-0 touch-manipulation transition-colors disabled:opacity-50 ${
              micRecording
                ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                : 'text-slate-500 hover:bg-socrat-surface hover:text-slate-900'
            }`}
          >
            {micRecording ? (
              <MicOff className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : (
              <Mic className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            aria-label="Отправить обсуждение"
            disabled={!canSendDiscussion}
            onClick={onSendDiscussion}
            className="grid place-items-center w-10 h-10 rounded-full bg-slate-700 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white shrink-0 touch-manipulation transition-colors"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
