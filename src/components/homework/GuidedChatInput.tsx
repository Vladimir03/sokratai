/**
 * Two-field chat input for the guided homework workspace.
 * AnswerField (green border, top): Enter = check answer via AI.
 * DiscussionField (gray border, bottom): Enter = discuss with AI.
 * Supports file attachments (images) via shared 📎 button with preview above answer field.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, FileText, Loader2, MessageCircle, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { MAX_GUIDED_CHAT_ATTACHMENTS } from '@/lib/homeworkThreadAttachments';

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = MAX_GUIDED_CHAT_ATTACHMENTS;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

interface GuidedChatInputProps {
  onSendAnswer: (text: string) => void;
  onSendStep: (text: string) => void;
  isLoading: boolean;
  disabled?: boolean;
  /** @deprecated Ignored — each field has its own hardcoded placeholder. Remove in Phase 3. */
  placeholder?: string;
  attachedFiles: File[];
  onFileSelect: (file: File) => void;
  onFileRemove: (index: number) => void;
  isUploading: boolean;
  taskNumber?: number;
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
    onSendAnswer,
    onSendStep,
    isLoading,
    disabled = false,
    attachedFiles,
    onFileSelect,
    onFileRemove,
    isUploading,
    taskNumber,
  }: GuidedChatInputProps) => {
    const [answerText, setAnswerText] = useState('');
    const [discussionText, setDiscussionText] = useState('');
    const [isDiscussionExpanded, setIsDiscussionExpanded] = useState(false);
    const answerRef = useRef<HTMLTextAreaElement>(null);
    const discussionRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Compact answer mode: hide label/hint + reduce padding on mobile when discussion is open
    const answerCompact = isDiscussionExpanded;

    useAutoResize(answerRef, answerText);
    useAutoResize(discussionRef, discussionText);

    // --- Send handlers ---

    const hasAnswerContent = answerText.trim().length > 0 || attachedFiles.length > 0;
    const hasDiscussionContent = discussionText.trim().length > 0 || attachedFiles.length > 0;
    const controlsDisabled = isLoading || disabled || isUploading;

    const canSendAnswer = hasAnswerContent && !controlsDisabled;
    const canSendDiscussion = hasDiscussionContent && !controlsDisabled;

    const handleSendAnswer = useCallback(() => {
      if (!canSendAnswer) return;
      onSendAnswer(answerText.trim());
      setAnswerText('');
      if (answerRef.current) answerRef.current.style.height = 'auto';
    }, [answerText, canSendAnswer, onSendAnswer]);

    const handleSendStep = useCallback(() => {
      if (!canSendDiscussion) return;
      onSendStep(discussionText.trim());
      setDiscussionText('');
      if (discussionRef.current) discussionRef.current.style.height = 'auto';
    }, [discussionText, canSendDiscussion, onSendStep]);

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
            toast.error('Файл слишком большой. Максимум 10 МБ');
            continue;
          }

          onFileSelect(file);
          availableSlots -= 1;
        }

        e.target.value = '';
      },
      [attachedFiles.length, onFileSelect],
    );

    const attachDisabled = controlsDisabled;

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
          toast.error('Файл слишком большой. Максимум 10 МБ');
          return;
        }

        e.preventDefault();
        onFileSelect(imageFile);
      },
      [attachDisabled, attachedFiles.length, onFileSelect],
    );

    // --- Placeholders ---

    const answerPlaceholder = taskNumber
      ? `Задача ${taskNumber}: введите ответ...`
      : 'Введите ответ...';

    const discussionPlaceholder = taskNumber
      ? `Задача ${taskNumber}: задайте вопрос AI...`
      : 'Задайте вопрос AI...';

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

        <div className="flex flex-col gap-2 p-3">
          {/* ===== ANSWER FIELD (green) ===== */}
          <div className={cn(
            "rounded-lg border-2 border-green-600",
            answerCompact ? "p-2 md:p-3" : "p-3"
          )}>
            {/* Label: hide on mobile in compact mode */}
            <div className={cn(
              "mb-2 flex items-center gap-1.5",
              answerCompact && "hidden md:flex"
            )}>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm font-bold text-green-700">Ответ к задаче</span>
            </div>

            {/* Input row */}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={handleFileClick}
                disabled={attachDisabled}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                style={{ touchAction: 'manipulation', minWidth: '44px', minHeight: '44px' }}
                aria-label="Прикрепить файл"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <textarea
                ref={answerRef}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                onKeyDown={handleAnswerKeyDown}
placeholder={answerPlaceholder}
                disabled={controlsDisabled}
                rows={1}
                className={textareaClasses + ' border border-input rounded-lg'}
                style={textareaStyle}
              />

              <Button
                size="sm"
                onClick={handleSendAnswer}
                disabled={!canSendAnswer}
                className="h-10 shrink-0 gap-1 whitespace-nowrap bg-green-600 px-3 text-xs hover:bg-green-700"
                style={{ touchAction: 'manipulation' }}
              >
                {isLoading ? spinner : <CheckCircle2 className="h-3.5 w-3.5" />}
                Проверить
              </Button>
            </div>

            {/* Hint: hide on mobile in compact mode */}
            <p className={cn(
              "mt-1 text-[10px] text-muted-foreground",
              answerCompact && "hidden md:block"
            )}>Enter = отправить на проверку</p>
          </div>

          {/* ===== DISCUSSION TOGGLE (mobile only) ===== */}
          <button
            type="button"
            onClick={() => setIsDiscussionExpanded(prev => !prev)}
            aria-expanded={isDiscussionExpanded}
            aria-controls="guided-discussion-field"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2.5 text-sm text-muted-foreground md:hidden"
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
              isDiscussionExpanded ? "max-h-96" : "max-h-0",
              "md:max-h-none md:overflow-visible"
            )}
          >
            <div className="rounded-lg border border-slate-200 p-3">
              {/* Label */}
              <div className="mb-2 flex items-center gap-1.5">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-muted-foreground">Обсуждение</span>
              </div>

              {/* Input row */}
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={handleFileClick}
                  disabled={attachDisabled}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ touchAction: 'manipulation', minWidth: '44px', minHeight: '44px' }}
                  aria-label="Прикрепить файл"
                >
                  <Paperclip className="h-4 w-4" />
                </button>

                <textarea
                  ref={discussionRef}
                  value={discussionText}
                  onChange={(e) => setDiscussionText(e.target.value)}
                  onKeyDown={handleDiscussionKeyDown}
                  placeholder={discussionPlaceholder}
                  disabled={controlsDisabled}
                  rows={1}
                  className={textareaClasses + ' border border-input rounded-lg'}
                  style={textareaStyle}
                />

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSendStep}
                  disabled={!canSendDiscussion}
                  className="h-10 shrink-0 gap-1 whitespace-nowrap px-3 text-xs"
                  style={{ touchAction: 'manipulation' }}
                >
                  {isLoading ? spinner : <MessageCircle className="h-3.5 w-3.5" />}
                  Спросить
                </Button>
              </div>

              {/* Hint */}
              <p className="mt-1 text-[10px] text-muted-foreground">Enter = обсудить с AI</p>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

GuidedChatInput.displayName = 'GuidedChatInput';

export default GuidedChatInput;
