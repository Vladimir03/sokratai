import { memo, useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Image as ImageIcon, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface ChatInputProps {
  uploadedFile: File | null;
  previewUrl: string | null;
  isLoading: boolean;
  isMobile: boolean;
  onSend: (message: string, inputMethod?: 'text' | 'voice' | 'button') => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveFile: () => void;
}

const ChatInput = memo(({
  uploadedFile,
  previewUrl,
  isLoading,
  isMobile,
  onSend,
  onFileUpload,
  onPaste,
  onRemoveFile,
}: ChatInputProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState("");
  const isMobileDevice = useIsMobile();

  const adjustTextareaHeight = (element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = 'auto';
    const maxHeight = isMobileDevice ? 96 : 120; // 4 lines mobile, 5 lines desktop
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
  };

  useEffect(() => {
    if (textareaRef.current) {
      adjustTextareaHeight(textareaRef.current);
    }
  }, [message, isMobileDevice]);

  return (
    <div className="flex-shrink-0 border-t p-2 md:p-4 bg-background" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
      <div className="max-w-4xl mx-auto space-y-2 md:space-y-3">
        {/* Preview uploaded file */}
        {previewUrl && (
          <div className="relative inline-block w-full md:w-auto">
            <img
              src={previewUrl}
              alt="Preview"
              className="max-h-32 w-full md:w-auto object-contain rounded-lg border border-border"
            />
            <button
              onClick={onRemoveFile}
              className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center hover:bg-destructive/90 transition-colors"
              title="Удалить"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end gap-1 md:gap-2">
          {/* File upload button */}
          <input
            ref={fileInputRef}
            type="file"
            id="file-upload"
            accept="image/*"
            onChange={onFileUpload}
            className="hidden"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 md:h-11 md:w-11 shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            title="Загрузить фото"
          >
            <ImageIcon className="h-4 w-4 md:h-5 md:w-5" />
          </Button>

          {/* Text input */}
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              adjustTextareaHeight(e.target);
            }}
            onPaste={(e) => {
              onPaste(e);
              setTimeout(() => {
                if (textareaRef.current) {
                  adjustTextareaHeight(textareaRef.current);
                }
              }, 0);
            }}
            onKeyDown={(e) => {
              // На мобильных Enter создает новую строку, отправка только кнопкой
              // На desktop Enter отправляет, Shift+Enter - новая строка
              if (e.key === "Enter" && !e.shiftKey && !isMobileDevice) {
                e.preventDefault();
                if (message.trim() || uploadedFile) {
                  onSend(message, 'text');
                  setMessage("");
                  if (textareaRef.current) {
                    textareaRef.current.style.height = '40px';
                  }
                }
              }
            }}
            placeholder={isMobile ? "Напиши вопрос..." : "Напиши свой вопрос или вставь скриншот (Ctrl+V)..."}
            rows={1}
            className="flex-1 resize-none overflow-y-auto !min-h-[40px] md:!min-h-[44px] text-sm md:text-base py-2.5 transition-[height] duration-150 leading-6"
            disabled={isLoading}
            style={{ 
              fontSize: isMobile ? '16px' : undefined,
              height: '40px',
              maxHeight: isMobileDevice ? '96px' : '120px'
            }}
          />

          {/* Send button */}
          <Button
            onClick={() => {
              if (message.trim() || uploadedFile) {
                onSend(message, 'text');
                setMessage("");
                if (textareaRef.current) {
                  textareaRef.current.style.height = '40px';
                }
              }
            }}
            disabled={(!message.trim() && !uploadedFile) || isLoading}
            size="icon"
            className="h-10 w-10 md:h-11 md:w-11 shrink-0"
          >
            <Send className="h-4 w-4 md:h-5 md:w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
});

ChatInput.displayName = "ChatInput";

export default ChatInput;
