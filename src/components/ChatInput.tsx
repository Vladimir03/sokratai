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
      const newHeight = Math.min(textarea.scrollHeight, isMobile ? 120 : 150);
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
            className="h-12 w-12 md:h-[60px] md:w-[60px] shrink-0"
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
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (message.trim() || uploadedFile) {
                  onSend(message, 'text');
                  setMessage("");
                  setTimeout(() => {
                    if (textareaRef.current) {
                      textareaRef.current.style.height = 'auto';
                    }
                  }, 0);
                }
              }
            }}
            placeholder={isMobile ? "Напиши вопрос..." : "Напиши свой вопрос или вставь скриншот (Ctrl+V)..."}
            className="!min-h-[48px] md:!min-h-[60px] resize-none text-sm md:text-base py-3 overflow-y-auto"
            disabled={isLoading}
            style={{ 
              fontSize: isMobile ? '16px' : undefined,
              height: '48px'
            }}
          />

          {/* Send button */}
          <Button
            onClick={() => {
              if (message.trim() || uploadedFile) {
                onSend(message, 'text');
                setMessage("");
              }
            }}
            disabled={(!message.trim() && !uploadedFile) || isLoading}
            size="icon"
            className="h-12 w-12 md:h-[60px] md:w-[60px] shrink-0"
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
