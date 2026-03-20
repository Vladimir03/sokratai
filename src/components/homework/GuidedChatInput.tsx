/**
 * Simple chat input for the guided homework workspace.
 * Two submit buttons: "Ответ" (final answer, checked by AI) and "Шаг" (intermediate step, AI discussion).
 * Supports file attachments (images) via 📎 button with preview above textarea.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2, MessageCircle, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const modKey = isMac ? 'Cmd' : 'Ctrl';

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 3;

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
  placeholder?: string;
  attachedFiles: File[];
  onFileSelect: (file: File) => void;
  onFileRemove: (index: number) => void;
  isUploading: boolean;
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
        const objectUrl = getObjectUrl(file);
        return (
          <div
            key={`${file.name}-${file.size}-${file.lastModified}`}
            className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-1.5"
          >
            {/* Thumbnail */}
            <img
              src={objectUrl}
              alt={file.name}
              className="h-12 w-12 shrink-0 rounded object-cover"
            />

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

const GuidedChatInput = memo(
  ({
    onSendAnswer,
    onSendStep,
    isLoading,
    disabled = false,
    placeholder = 'Введите ответ или шаг решения...',
    attachedFiles,
    onFileSelect,
    onFileRemove,
    isUploading,
  }: GuidedChatInputProps) => {
    const [message, setMessage] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const resizeTextarea = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
    }, []);

    useEffect(() => {
      resizeTextarea();
    }, [message, resizeTextarea]);

    const clearAndReset = useCallback(() => {
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }, []);

    const hasContent = message.trim().length > 0 || attachedFiles.length > 0;
    const canSend = hasContent && !isLoading && !disabled && !isUploading;

    const handleSendAnswer = useCallback(() => {
      if (!canSend) return;
      onSendAnswer(message.trim());
      clearAndReset();
    }, [message, canSend, onSendAnswer, clearAndReset]);

    const handleSendStep = useCallback(() => {
      if (!canSend) return;
      onSendStep(message.trim());
      clearAndReset();
    }, [message, canSend, onSendStep, clearAndReset]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            handleSendAnswer();
          } else {
            handleSendStep();
          }
        }
      },
      [handleSendAnswer, handleSendStep],
    );

    const handleFileClick = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        if (!fileList) return;

        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i];

          // Check max files
          if (attachedFiles.length >= MAX_FILES) {
            toast.error(`Максимум ${MAX_FILES} вложения`);
            break;
          }

          // Check file type
          if (!ALLOWED_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith('.heic') && !file.name.toLowerCase().endsWith('.heif')) {
            toast.error('Поддерживаются: JPG, PNG, HEIC, WebP');
            continue;
          }

          // Check file size
          if (file.size > MAX_FILE_SIZE) {
            toast.error('Файл слишком большой. Максимум 10 МБ');
            continue;
          }

          onFileSelect(file);
        }

        // Reset input so same file can be re-selected
        e.target.value = '';
      },
      [attachedFiles.length, onFileSelect],
    );

    const attachDisabled = isLoading || disabled || isUploading;

    const spinner = (
      <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
    );

    return (
      <div className="border-t bg-background">
        {/* Attachment preview */}
        <AttachmentPreview
          files={attachedFiles}
          onRemove={onFileRemove}
          isUploading={isUploading}
        />

        {/* Input row */}
        <div className="flex items-end gap-2 p-3">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
            disabled={attachDisabled}
          />

          {/* Paperclip button */}
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

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isLoading || disabled}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              fontSize: '16px', // Prevent iOS Safari auto-zoom
              touchAction: 'manipulation', // Fix iOS 300ms tap delay
              maxHeight: '150px',
            }}
          />

          {/* Send buttons */}
          <div className="flex gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSendStep}
              disabled={!canSend}
              className="h-10 px-2.5 gap-1 text-xs whitespace-nowrap"
              title="Обсудить шаг (Enter)"
            >
              {isLoading ? spinner : <MessageCircle className="h-3.5 w-3.5" />}
              Шаг
            </Button>
            <Button
              size="sm"
              onClick={handleSendAnswer}
              disabled={!canSend}
              className="h-10 px-2.5 gap-1 text-xs whitespace-nowrap"
              title={`Итоговый ответ (${modKey}+Enter)`}
            >
              {isLoading ? spinner : <CheckCircle2 className="h-3.5 w-3.5" />}
              Ответ
            </Button>
          </div>
        </div>
      </div>
    );
  },
);

GuidedChatInput.displayName = 'GuidedChatInput';

export default GuidedChatInput;
