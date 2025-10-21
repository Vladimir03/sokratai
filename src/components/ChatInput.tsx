import { memo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Image as ImageIcon, X } from "lucide-react";

interface ChatInputProps {
  message: string;
  setMessage: (message: string) => void;
  uploadedFile: File | null;
  previewUrl: string | null;
  isLoading: boolean;
  isMobile: boolean;
  onSend: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveFile: () => void;
}

const ChatInput = memo(({
  message,
  setMessage,
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
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={isMobile ? "Напиши вопрос..." : "Напиши свой вопрос или вставь скриншот (Ctrl+V)..."}
            className="!h-12 md:!h-[60px] !min-h-[48px] md:!min-h-[60px] !max-h-12 md:!max-h-[60px] resize-none text-sm md:text-base py-3"
            disabled={isLoading}
            style={{ fontSize: isMobile ? '16px' : undefined }}
          />

          {/* Send button */}
          <Button
            onClick={onSend}
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
