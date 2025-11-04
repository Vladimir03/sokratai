import { memo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Image as ImageIcon, X } from "lucide-react";

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

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      // Calculate the line height and max lines (Telegram-style)
      const lineHeight = 24; // Base line height
      const maxLines = isMobile ? 4 : 5;
      const maxHeight = lineHeight * maxLines;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;
    }
  };

  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    adjustTextareaHeight();
  };

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
        <div className="flex items-center gap-1 md:gap-2">
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
            onChange={handleMessageChange}
            onPaste={onPaste}
            onKeyDown={(e) => {
              // On mobile, Enter creates new line (like Telegram)
              // On desktop, Enter sends (Shift+Enter for new line)
              if (e.key === "Enter") {
                if (isMobile) {
                  // On mobile, allow Enter to create new line
                  return;
                } else if (!e.shiftKey) {
                  // On desktop, Enter without Shift sends message
                  e.preventDefault();
                  if (message.trim() || uploadedFile) {
                    onSend(message, 'text');
                    setMessage("");
                    setTimeout(() => {
                      if (textareaRef.current) {
                        textareaRef.current.style.height = 'auto';
                        textareaRef.current.style.height = isMobile ? '40px' : '44px';
                      }
                    }, 0);
                  }
                }
              }
            }}
            placeholder={isMobile ? "Сообщение..." : "Напиши свой вопрос или вставь скриншот (Ctrl+V)..."}
            className="!min-h-0 resize-none text-sm md:text-base py-2.5 md:py-3 overflow-y-auto transition-all duration-150 leading-6"
            disabled={isLoading}
            rows={1}
            style={{ 
              fontSize: isMobile ? '16px' : undefined,
              height: isMobile ? '40px' : '44px',
              maxHeight: isMobile ? '96px' : '120px'
            }}
          />

          {/* Send button */}
          <Button
            onClick={() => {
              if (message.trim() || uploadedFile) {
                onSend(message, 'text');
                setMessage("");
                setTimeout(() => {
                  if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                    textareaRef.current.style.height = isMobile ? '40px' : '44px';
                  }
                }, 0);
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
