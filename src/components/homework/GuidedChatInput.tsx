/**
 * Two-field chat input for the guided homework workspace.
 * AnswerField (green border, top): Enter = check answer via AI.
 * DiscussionField (gray border, bottom): Enter = discuss with AI.
 * Supports file attachments (images) via shared 📎 button with preview above answer field.
 * Supports voice recording -> transcription -> draft confirmation for both fields.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, FileText, Loader2, MessageCircle, Mic, MicOff, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  MAX_GUIDED_CHAT_ATTACHMENTS,
  MAX_GUIDED_CHAT_ATTACHMENT_FILE_BYTES,
  MAX_GUIDED_CHAT_ATTACHMENT_TOTAL_BYTES,
} from '@/lib/homeworkThreadAttachments';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { transcribeThreadVoice } from '@/lib/studentHomeworkApi';

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
];
const MAX_FILE_SIZE = MAX_GUIDED_CHAT_ATTACHMENT_FILE_BYTES;
const MAX_FILES = MAX_GUIDED_CHAT_ATTACHMENTS;
const MAX_VOICE_RECORDING_SECONDS = 120;

type VoiceTarget = 'answer' | 'discussion';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function getTotalAttachmentBytes(files: Array<Pick<File, 'size'>>): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function formatVoiceDuration(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  if (safeSeconds >= 60) {
    return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
  }
  return `0:${String(safeSeconds).padStart(2, '0')}`;
}

function appendVoiceTranscript(currentText: string, transcript: string): string {
  const trimmedCurrent = currentText.trim();
  return trimmedCurrent ? `${trimmedCurrent}\n${transcript}` : transcript;
}

interface GuidedChatInputProps {
  threadId?: string | null;
  onSendAnswer: (text: string) => void;
  onSendStep: (text: string) => void;
  isLoading: boolean;
  disabled?: boolean;
  attachedFiles: File[];
  onFileSelect: (file: File) => void;
  onFileRemove: (index: number) => void;
  isUploading: boolean;
  taskNumber?: number;
  answerPlaceholder?: string;
  initialAnswerText?: string;
  initialDiscussionText?: string;
  onDraftChange?: (answer: string, discussion: string) => void;
}

/** Attachment preview card above textarea */
function AttachmentPreview({
  files,
  onRemove,
  isUploading,
}: {
  files: File[];
  onRemove: (index: number) => void;
  isUploading: boolean;
}) {
  const urlsRef = useRef<Map<File, string>>(new Map());

  // Create object URLs for image thumbnails
  const getObjectUrl = useCallback((file: File): string => {
    const existing = urlsRef.current.get(file);
    if (existing) return existing;
    const url = URL.createObjectURL(file);
    urlsRef.current.set(file, url);
    return url;
  }, []);

  // Cleanup object URLs on unmount
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  // Cleanup URLs for removed files
  useEffect(() => {
    const fileSet = new Set(files);
    const urls = urlsRef.current;
    urls.forEach((url, file) => {
      if (!fileSet.has(file)) {
        URL.revokeObjectURL(url);
        urls.delete(file);
      }
    });
  }, [files]);

  if (files.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 px-3 pt-2">
      {files.map((file, index) => {
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const objectUrl = !isPdf ? getObjectUrl(file) : null;
        return (
          <div
            key={`${file.name}-${file.size}-${file.lastModified}`}
            className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-1.5"
          >
            {/* Thumbnail */}
            {objectUrl ? (
              <img
                src={objectUrl}
                alt={file.name}
                className="h-12 w-12 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-background text-muted-foreground">
                <FileText className="h-5 w-5" />
              </div>
            )}

            {/* File info */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
            </div>

            {/* Remove / uploading indicator */}
            {isUploading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="shrink-0 rounded-full p-1 hover:bg-muted"
                style={{ touchAction: 'manipulation' }}
                aria-label={`Удалить ${file.name}`}
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Auto-resize a textarea to fit content up to maxHeight */
function useAutoResize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [ref, value]);
}

const spinner = (
  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
);

const GuidedChatInput = memo(
  ({
    threadId,
    onSendAnswer,
    onSendStep,
    isLoading,
    disabled = false,
    attachedFiles,
    onFileSelect,
    onFileRemove,
    isUploading,
    taskNumber,
    answerPlaceholder: answerPlaceholderProp,
    initialAnswerText = '',
    initialDiscussionText = '',
    onDraftChange,
  }: GuidedChatInputProps) => {
    const [answerText, setAnswerText] = useState(initialAnswerText);
    const [discussionText, setDiscussionText] = useState(initialDiscussionText);
    const [isDiscussionExpanded, setIsDiscussionExpanded] = useState(false);
    const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
    const [voiceTarget, setVoiceTarget] = useState<VoiceTarget | null>(null);
    const [voiceStatusText, setVoiceStatusText] = useState<string | null>(null);
    const [voiceStatusTarget, setVoiceStatusTarget] = useState<VoiceTarget | null>(null);
    const answerRef = useRef<HTMLTextAreaElement>(null);
    const discussionRef = useRef<HTMLTextAreaElement>(null);
    const answerTextRef = useRef(initialAnswerText);
    const discussionTextRef = useRef(initialDiscussionText);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const voiceStatusTimeoutRef = useRef<number | null>(null);
    const voiceAutoStopTriggeredRef = useRef(false);

    const {
      isRecording,
      isSupported: isVoiceSupported,
      recordingDurationSeconds,
      startRecording,
      stopRecording,
      cancelRecording,
    } = useVoiceRecorder();

    // Compact answer mode: hide label/hint + reduce padding on mobile when discussion is open
    const answerCompact = isDiscussionExpanded;

    useAutoResize(answerRef, answerText);
    useAutoResize(discussionRef, discussionText);

    useEffect(() => {
      answerTextRef.current = answerText;
    }, [answerText]);

    useEffect(() => {
      discussionTextRef.current = discussionText;
    }, [discussionText]);

    const clearVoiceStatus = useCallback(() => {
      if (voiceStatusTimeoutRef.current !== null) {
        window.clearTimeout(voiceStatusTimeoutRef.current);
        voiceStatusTimeoutRef.current = null;
      }
      setVoiceStatusText(null);
      setVoiceStatusTarget(null);
    }, []);

    const setTemporaryVoiceStatus = useCallback((target: VoiceTarget, text: string, durationMs = 4000) => {
      clearVoiceStatus();
      setVoiceStatusTarget(target);
      setVoiceStatusText(text);
      voiceStatusTimeoutRef.current = window.setTimeout(() => {
        setVoiceStatusText(null);
        setVoiceStatusTarget(null);
        voiceStatusTimeoutRef.current = null;
      }, durationMs);
    }, [clearVoiceStatus]);

    useEffect(() => {
      return () => {
        clearVoiceStatus();
      };
    }, [clearVoiceStatus]);

    // Sync draft text to parent (parent stores in ref — no re-render)
    useEffect(() => {
      onDraftChange?.(answerText, discussionText);
    }, [answerText, discussionText, onDraftChange]);

    // --- Send handlers ---

    const hasAnswerContent = answerText.trim().length > 0 || attachedFiles.length > 0;
    const hasDiscussionContent = discussionText.trim().length > 0 || attachedFiles.length > 0;
    const controlsDisabled = isLoading || disabled || isUploading;
    const answerRecording = isRecording && voiceTarget === 'answer';
    const discussionRecording = isRecording && voiceTarget === 'discussion';

    const canSendAnswer = hasAnswerContent && !controlsDisabled && !isRecording && !isTranscribingVoice;
    const canSendDiscussion = hasDiscussionContent && !controlsDisabled && !isRecording && !isTranscribingVoice;

    const handleSendAnswer = useCallback(() => {
      if (!canSendAnswer) return;
      clearVoiceStatus();
      onSendAnswer(answerText.trim());
      answerTextRef.current = '';
      setAnswerText('');
      if (answerRef.current) answerRef.current.style.height = 'auto';
    }, [answerText, canSendAnswer, clearVoiceStatus, onSendAnswer]);

    const handleSendStep = useCallback(() => {
      if (!canSendDiscussion) return;
      clearVoiceStatus();
      onSendStep(discussionText.trim());
      discussionTextRef.current = '';
      setDiscussionText('');
      if (discussionRef.current) discussionRef.current.style.height = 'auto';
    }, [discussionText, canSendDiscussion, clearVoiceStatus, onSendStep]);

    const focusVoiceTarget = useCallback((target: VoiceTarget, nextValue: string) => {
      requestAnimationFrame(() => {
        const field = target === 'answer' ? answerRef.current : discussionRef.current;
        if (!field) return;
        field.focus();
        field.setSelectionRange(nextValue.length, nextValue.length);
      });
    }, []);

    const applyVoiceTranscript = useCallback((
      target: VoiceTarget,
      transcript: string,
      durationSeconds: number,
    ) => {
      const normalizedTranscript = transcript.replace(/\s+/g, ' ').trim();
      if (!normalizedTranscript) {
        throw new Error('Не удалось распознать речь. Попробуй записать ещё раз.');
      }

      const currentValue = target === 'answer'
        ? answerTextRef.current
        : discussionTextRef.current;
      const nextValue = appendVoiceTranscript(currentValue, normalizedTranscript);

      if (target === 'answer') {
        answerTextRef.current = nextValue;
        setAnswerText(nextValue);
      } else {
        discussionTextRef.current = nextValue;
        setDiscussionText(nextValue);
      }

      if (target === 'discussion') {
        setIsDiscussionExpanded(true);
      }

      const previewText = normalizedTranscript.length > 90
        ? `${normalizedTranscript.slice(0, 87)}...`
        : normalizedTranscript;
      const actionLabel = target === 'answer' ? 'Проверить' : 'Написать';

      setTemporaryVoiceStatus(
        target,
        `Расшифровка [${formatVoiceDuration(durationSeconds)}]: «${previewText}». Проверь текст и нажми ${actionLabel}.`,
      );
      focusVoiceTarget(target, nextValue);
    }, [
      focusVoiceTarget,
      setTemporaryVoiceStatus,
    ]);

    const handleVoiceButton = useCallback(async (target: VoiceTarget) => {
      if (!threadId || controlsDisabled || isTranscribingVoice) {
        return;
      }

      if (isRecording) {
        if (voiceTarget !== target) {
          toast.info('Сначала завершите текущую запись.');
          return;
        }

        setIsTranscribingVoice(true);
        setVoiceStatusTarget(target);
        setVoiceStatusText('Расшифровываю голосовое...');

        try {
          const recording = await stopRecording();
          if (!recording) {
            clearVoiceStatus();
            return;
          }

          const { text } = await transcribeThreadVoice(threadId, recording.blob, recording.fileName);
          applyVoiceTranscript(target, text, recording.durationSeconds);
        } catch (error) {
          console.error('Homework voice transcription failed:', error);
          clearVoiceStatus();
          toast.error(error instanceof Error ? error.message : 'Не удалось расшифровать голосовое сообщение.');
        } finally {
          setIsTranscribingVoice(false);
          setVoiceTarget(null);
        }

        return;
      }

      clearVoiceStatus();
      const started = await startRecording();
      if (!started) {
        return;
      }

      setVoiceTarget(target);
      if (target === 'discussion') {
        setIsDiscussionExpanded(true);
      }
    }, [
      applyVoiceTranscript,
      clearVoiceStatus,
      controlsDisabled,
      isRecording,
      isTranscribingVoice,
      startRecording,
      stopRecording,
      threadId,
      voiceTarget,
    ]);

    const handleCancelVoiceRecording = useCallback(() => {
      cancelRecording();
      clearVoiceStatus();
      setVoiceTarget(null);
    }, [cancelRecording, clearVoiceStatus]);

    useEffect(() => {
      if (!isRecording) {
        voiceAutoStopTriggeredRef.current = false;
        return;
      }

      if (recordingDurationSeconds < MAX_VOICE_RECORDING_SECONDS) {
        return;
      }

      if (voiceAutoStopTriggeredRef.current || !voiceTarget) {
        return;
      }

      voiceAutoStopTriggeredRef.current = true;
      toast.info('Достигнут лимит 2 минуты. Останавливаю запись и готовлю расшифровку.');
      void handleVoiceButton(voiceTarget);
    }, [handleVoiceButton, isRecording, recordingDurationSeconds, voiceTarget]);

    // --- KeyDown: Enter = send from own field, Shift+Enter = newline ---

    const handleAnswerKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendAnswer();
        }
      },
      [handleSendAnswer],
    );

    const handleDiscussionKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendStep();
        }
      },
      [handleSendStep],
    );

    // --- File handling ---

    const handleFileClick = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        if (!fileList) return;

        let availableSlots = MAX_FILES - attachedFiles.length;
        let totalBytes = getTotalAttachmentBytes(attachedFiles);
        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i];

          if (availableSlots <= 0) {
            toast.error(`Максимум ${MAX_FILES} вложения`);
            break;
          }

          if (!ALLOWED_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith('.heic') && !file.name.toLowerCase().endsWith('.heif')) {
            toast.error('Поддерживаются: JPG, PNG, HEIC, WebP, PDF');
            continue;
          }

          if (file.size > MAX_FILE_SIZE) {
            toast.error(`Файл слишком большой. Максимум ${formatFileSize(MAX_FILE_SIZE)}`);
            continue;
          }

          if (totalBytes + file.size > MAX_GUIDED_CHAT_ATTACHMENT_TOTAL_BYTES) {
            toast.error(
              `Суммарный размер вложений не должен превышать ${formatFileSize(MAX_GUIDED_CHAT_ATTACHMENT_TOTAL_BYTES)}`,
            );
            continue;
          }

          onFileSelect(file);
          totalBytes += file.size;
          availableSlots -= 1;
        }

        e.target.value = '';
      },
      [attachedFiles, onFileSelect],
    );

    const attachDisabled = controlsDisabled || isRecording || isTranscribingVoice;

    // --- Clipboard paste: image → onFileSelect, text → native textarea ---

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
        let imageFile: File | undefined;
        const files = Array.from(e.clipboardData.files);
        imageFile = files.find((f) => f.type.startsWith('image/'));

        if (!imageFile && e.clipboardData.items) {
          for (let i = 0; i < e.clipboardData.items.length; i++) {
            const item = e.clipboardData.items[i];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
              imageFile = item.getAsFile() ?? undefined;
              break;
            }
          }
        }

        if (!imageFile) return; // text paste — let textarea handle it

        if (attachDisabled) {
          e.preventDefault();
          return;
        }

        if (attachedFiles.length >= MAX_FILES) {
          e.preventDefault();
          toast.error(`Максимум ${MAX_FILES} вложения`);
          return;
        }

        if (!ALLOWED_TYPES.includes(imageFile.type)) {
          e.preventDefault();
          toast.error('Поддерживаются: JPG, PNG, HEIC, WebP, PDF');
          return;
        }

        if (imageFile.size > MAX_FILE_SIZE) {
          e.preventDefault();
          toast.error(`Файл слишком большой. Максимум ${formatFileSize(MAX_FILE_SIZE)}`);
          return;
        }

        if (getTotalAttachmentBytes(attachedFiles) + imageFile.size > MAX_GUIDED_CHAT_ATTACHMENT_TOTAL_BYTES) {
          e.preventDefault();
          toast.error(
            `Суммарный размер вложений не должен превышать ${formatFileSize(MAX_GUIDED_CHAT_ATTACHMENT_TOTAL_BYTES)}`,
          );
          return;
        }

        e.preventDefault();
        onFileSelect(imageFile);
      },
      [attachDisabled, attachedFiles, onFileSelect],
    );

    // --- Placeholders ---

    const resolvedAnswerPlaceholder = answerPlaceholderProp || 'Ответ...';
    const discussionPlaceholder = 'Обсуди с AI...';
    const hasVoiceControls = Boolean(threadId) && isVoiceSupported;
    const answerVoiceStatus = (() => {
      if (isTranscribingVoice && voiceTarget === 'answer') return 'Расшифровываю голосовое...';
      if (isRecording && voiceTarget === 'answer') return `Идёт запись ${formatVoiceDuration(recordingDurationSeconds)}`;
      return voiceStatusTarget === 'answer' ? voiceStatusText : null;
    })();
    const discussionVoiceStatus = (() => {
      if (isTranscribingVoice && voiceTarget === 'discussion') return 'Расшифровываю голосовое...';
      if (isRecording && voiceTarget === 'discussion') return `Идёт запись ${formatVoiceDuration(recordingDurationSeconds)}`;
      return voiceStatusTarget === 'discussion' ? voiceStatusText : null;
    })();

    // --- Shared styles ---

    const textareaClasses =
      'flex-1 resize-none rounded-lg border-0 bg-transparent px-3 py-2 text-base ring-0 placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50';

    const textareaStyle: React.CSSProperties = {
      fontSize: '16px', // Prevent iOS Safari auto-zoom
      touchAction: 'manipulation',
      maxHeight: '150px',
    };

    return (
      <div className="border-t bg-background" onPaste={handlePaste}>
        {/* Hidden file input — shared between both fields */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          className="hidden"
          onChange={handleFileChange}
          disabled={attachDisabled}
        />

        {/* Attachment preview — above answer field */}
        <AttachmentPreview
          files={attachedFiles}
          onRemove={onFileRemove}
          isUploading={isUploading}
        />

        <div className="flex flex-col gap-1.5 p-2 md:gap-2 md:p-3">
          {/* ===== ANSWER FIELD (green) ===== */}
          <div className={cn(
            "rounded-lg border-2 border-green-600",
            answerCompact ? "p-2 md:p-3" : "p-3"
          )}>
            {/* Label: hide on mobile in compact mode */}
            <div className={cn(
              "mb-1 md:mb-2 flex items-center gap-1.5",
              answerCompact && "hidden md:flex"
            )}>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm font-bold text-green-700">Ответ к задаче</span>
            </div>

            {answerVoiceStatus && (
              <div className="mb-2 text-xs text-muted-foreground">
                {answerVoiceStatus}
              </div>
            )}

            {/* Input row */}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={handleFileClick}
                disabled={attachDisabled}
                className="flex h-8 w-8 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                style={{ touchAction: 'manipulation' }}
                aria-label="Прикрепить файл"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <textarea
                ref={answerRef}
                value={answerText}
                onChange={(e) => {
                  if (voiceStatusTarget === 'answer') {
                    clearVoiceStatus();
                  }
                  answerTextRef.current = e.target.value;
                  setAnswerText(e.target.value);
                }}
                onKeyDown={handleAnswerKeyDown}
                placeholder={resolvedAnswerPlaceholder}
                disabled={controlsDisabled || isTranscribingVoice || discussionRecording}
                rows={1}
                className={textareaClasses + ' border border-input rounded-lg'}
                style={textareaStyle}
              />

              {hasVoiceControls && (
                <button
                  type="button"
                  onClick={() => {
                    void handleVoiceButton('answer');
                  }}
                  disabled={controlsDisabled || isTranscribingVoice || discussionRecording}
                  className="flex h-8 w-8 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ touchAction: 'manipulation' }}
                  aria-label={answerRecording ? 'Остановить и расшифровать голосовое' : 'Записать голосовое для ответа'}
                  title={answerRecording ? 'Остановить и расшифровать' : 'Записать голосовое'}
                >
                  {isTranscribingVoice && voiceTarget === 'answer' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : answerRecording ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>
              )}

              <Button
                size="sm"
                onClick={answerRecording ? handleCancelVoiceRecording : handleSendAnswer}
                disabled={isTranscribingVoice || discussionRecording || (!answerRecording && !canSendAnswer)}
                className="h-8 md:h-10 shrink-0 gap-1 whitespace-nowrap bg-green-600 px-3 text-xs hover:bg-green-700"
                style={{ touchAction: 'manipulation' }}
              >
                {answerRecording ? (
                  <X className="h-3.5 w-3.5" />
                ) : isLoading ? (
                  spinner
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {answerRecording ? 'Отмена' : 'Проверить'}
              </Button>
            </div>

          </div>

          {/* ===== DISCUSSION TOGGLE (mobile only) ===== */}
          <button
            type="button"
            onClick={() => setIsDiscussionExpanded(prev => !prev)}
            aria-expanded={isDiscussionExpanded}
            aria-controls="guided-discussion-field"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2.5 text-sm text-muted-foreground"
            style={{ touchAction: 'manipulation' }}
          >
            <MessageCircle className="h-4 w-4" />
            {isDiscussionExpanded ? 'Свернуть обсуждение \u25B4' : 'Обсудить шаг с AI \u25BE'}
          </button>

          {/* ===== DISCUSSION FIELD (gray) ===== */}
          <div
            id="guided-discussion-field"
            className={cn(
              "transition-all duration-200 overflow-hidden",
              isDiscussionExpanded ? "max-h-96" : "max-h-0"
            )}
          >
            <div className="rounded-lg border border-slate-200 p-2 md:p-3">
              {/* Label */}
              <div className="mb-1 md:mb-2 flex items-center gap-1.5">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-muted-foreground">Обсуждение</span>
              </div>

              {discussionVoiceStatus && (
                <div className="mb-2 text-xs text-muted-foreground">
                  {discussionVoiceStatus}
                </div>
              )}

              {/* Input row */}
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={handleFileClick}
                  disabled={attachDisabled}
                  className="flex h-8 w-8 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ touchAction: 'manipulation' }}
                  aria-label="Прикрепить файл"
                >
                  <Paperclip className="h-4 w-4" />
                </button>

                <textarea
                  ref={discussionRef}
                  value={discussionText}
                  onChange={(e) => {
                    if (voiceStatusTarget === 'discussion') {
                      clearVoiceStatus();
                    }
                    discussionTextRef.current = e.target.value;
                    setDiscussionText(e.target.value);
                  }}
                  onKeyDown={handleDiscussionKeyDown}
                  placeholder={discussionPlaceholder}
                  disabled={controlsDisabled || isTranscribingVoice || answerRecording}
                  rows={1}
                  className={textareaClasses + ' border border-input rounded-lg'}
                  style={textareaStyle}
                />

                {hasVoiceControls && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleVoiceButton('discussion');
                    }}
                    disabled={controlsDisabled || isTranscribingVoice || answerRecording}
                    className="flex h-8 w-8 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ touchAction: 'manipulation' }}
                    aria-label={discussionRecording ? 'Остановить и расшифровать голосовое' : 'Записать голосовое для обсуждения'}
                    title={discussionRecording ? 'Остановить и расшифровать' : 'Записать голосовое'}
                  >
                    {isTranscribingVoice && voiceTarget === 'discussion' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : discussionRecording ? (
                      <MicOff className="h-4 w-4" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                  </button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={discussionRecording ? handleCancelVoiceRecording : handleSendStep}
                  disabled={isTranscribingVoice || answerRecording || (!discussionRecording && !canSendDiscussion)}
                  className="h-8 md:h-10 shrink-0 gap-1 whitespace-nowrap px-3 text-xs"
                  style={{ touchAction: 'manipulation' }}
                >
                  {discussionRecording ? (
                    <X className="h-3.5 w-3.5" />
                  ) : isLoading ? (
                    spinner
                  ) : (
                    <MessageCircle className="h-3.5 w-3.5" />
                  )}
                  {discussionRecording ? 'Отмена' : 'Написать'}
                </Button>
              </div>

            </div>
          </div>
        </div>
      </div>
    );
  },
);

GuidedChatInput.displayName = 'GuidedChatInput';

export default GuidedChatInput;
