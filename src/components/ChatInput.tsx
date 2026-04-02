import { memo, useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Image as ImageIcon, X, Loader2, Camera, ImagePlus, Mic, MicOff } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { haptics } from "@/utils/haptics";
import { transcribeChatVoice } from "@/lib/chatVoice";
import { toast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChatInputProps {
  fileInputRef?: React.RefObject<HTMLInputElement>;
  uploadedFile: File | null;
  previewUrl: string | null;
  isLoading: boolean;
  isMobile: boolean;
  onSend: (message: string, inputMethod?: 'text' | 'voice' | 'button') => Promise<void> | void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveFile: () => void;
  value?: string;
  onValueChange?: (value: string) => void;
}

const MAX_VOICE_RECORDING_SECONDS = 120;

const formatVoiceDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  if (safeSeconds >= 60) {
    return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
  }
  return `0:${String(safeSeconds).padStart(2, "0")}`;
};

const ChatInput = memo(({
  fileInputRef,
  uploadedFile,
  previewUrl,
  isLoading,
  isMobile,
  onSend,
  onFileUpload,
  onPaste,
  onRemoveFile,
  value,
  onValueChange,
}: ChatInputProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const voiceStatusTimeoutRef = useRef<number | null>(null);
  const voiceAutoStopTriggeredRef = useRef(false);
  const [message, setMessage] = useState("");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const [draftInputMethod, setDraftInputMethod] = useState<'text' | 'voice'>("text");
  const [voiceStatusText, setVoiceStatusText] = useState<string | null>(null);
  const isMobileDevice = useIsMobile();
  
  const {
    isRecording,
    isSupported: isVoiceSupported,
    recordingDurationSeconds,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceRecorder();

  const clearVoiceStatus = useCallback(() => {
    if (voiceStatusTimeoutRef.current !== null) {
      window.clearTimeout(voiceStatusTimeoutRef.current);
      voiceStatusTimeoutRef.current = null;
    }
    setVoiceStatusText(null);
  }, []);

  const setTemporaryVoiceStatus = useCallback((text: string, durationMs = 2500) => {
    clearVoiceStatus();
    setVoiceStatusText(text);
    voiceStatusTimeoutRef.current = window.setTimeout(() => {
      setVoiceStatusText(null);
      voiceStatusTimeoutRef.current = null;
    }, durationMs);
  }, [clearVoiceStatus]);

  useEffect(() => {
    return () => {
      clearVoiceStatus();
    };
  }, [clearVoiceStatus]);

  const resetComposer = useCallback(() => {
    setMessage("");
    setDraftInputMethod("text");
    onValueChange?.("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "40px";
    }
  }, [onValueChange]);

  const adjustTextareaHeight = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = 'auto';
    const maxHeight = isMobileDevice ? 96 : 120;
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
  }, [isMobileDevice]);

  const applyDraftValue = useCallback((nextValue: string, inputMethod: 'text' | 'voice') => {
    setMessage(nextValue);
    setDraftInputMethod(inputMethod);
    onValueChange?.(nextValue);

    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      adjustTextareaHeight(textareaRef.current);
      textareaRef.current.focus();
      const caretPosition = nextValue.length;
      textareaRef.current.setSelectionRange(caretPosition, caretPosition);
    });
  }, [adjustTextareaHeight, onValueChange]);

  const handleVoiceButton = useCallback(async () => {
    if (isLoading || isTranscribingVoice) {
      return;
    }

    if (isRecording) {
      haptics.success();
      setIsTranscribingVoice(true);
      setVoiceStatusText("Расшифровываю голосовое...");

      try {
        const recording = await stopRecording();
        if (!recording) {
          clearVoiceStatus();
          return;
        }

        const { text } = await transcribeChatVoice({
          audioBlob: recording.blob,
          fileName: recording.fileName,
        });

        const normalizedTranscript = text.replace(/\s+/g, " ").trim();
        if (!normalizedTranscript) {
          throw new Error("Не удалось распознать речь. Попробуй записать ещё раз.");
        }

        const combinedMessage = message.trim()
          ? `${message.trim()}\n${normalizedTranscript}`
          : normalizedTranscript;
        const previewText = normalizedTranscript.length > 90
          ? `${normalizedTranscript.slice(0, 87)}...`
          : normalizedTranscript;

        applyDraftValue(combinedMessage, "voice");
        setTemporaryVoiceStatus(
          `Расшифровка [${formatVoiceDuration(recording.durationSeconds)}]: «${previewText}». Проверь текст и нажми отправить.`,
          4000,
        );
      } catch (error) {
        console.error("Voice transcription failed:", error);
        clearVoiceStatus();
        haptics.error();
        toast({
          title: "Не удалось расшифровать",
          description: error instanceof Error ? error.message : "Попробуй записать голосовое ещё раз.",
          variant: "destructive",
        });
      } finally {
        setIsTranscribingVoice(false);
      }

      return;
    }

    clearVoiceStatus();
    const started = await startRecording();
    if (started) {
      haptics.tap();
    }
  }, [
    clearVoiceStatus,
    isLoading,
    isRecording,
    isTranscribingVoice,
    message,
    applyDraftValue,
    setTemporaryVoiceStatus,
    startRecording,
    stopRecording,
  ]);

  const handleCancelVoiceRecording = useCallback(() => {
    cancelRecording();
    clearVoiceStatus();
    setDraftInputMethod("text");
    haptics.button();
  }, [cancelRecording, clearVoiceStatus]);

  // Синхронизировать с внешним value
  useEffect(() => {
    if (value !== undefined && value !== message) {
      setMessage(value);
      setDraftInputMethod("text");
      if (textareaRef.current) {
        adjustTextareaHeight(textareaRef.current);
      }
    }
  }, [value, adjustTextareaHeight]);

  useEffect(() => {
    if (!isRecording) {
      voiceAutoStopTriggeredRef.current = false;
      return;
    }

    if (recordingDurationSeconds < MAX_VOICE_RECORDING_SECONDS) {
      return;
    }

    if (voiceAutoStopTriggeredRef.current) {
      return;
    }

    voiceAutoStopTriggeredRef.current = true;
    toast({
      title: "Лимит записи",
      description: "Достигнут лимит 2 минуты. Останавливаю запись и готовлю расшифровку.",
    });
    void handleVoiceButton();
  }, [handleVoiceButton, isRecording, recordingDurationSeconds]);

  // Handle iOS keyboard appearance
  useEffect(() => {
    let isKeyboardOpen = false;
    let initialHeight = window.innerHeight;

    const handleResize = () => {
      const currentHeight = window.innerHeight;
      const heightDifference = initialHeight - currentHeight;
      
      // Keyboard is opening if height decreased by more than 150px
      const keyboardOpening = heightDifference > 150;
      
      if (keyboardOpening && document.activeElement === textareaRef.current) {
        isKeyboardOpen = true;
        // Only scroll into view if the user just focused the input
        // Use a shorter delay for better UX
        setTimeout(() => {
          if (textareaRef.current && document.activeElement === textareaRef.current) {
            textareaRef.current.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'end' 
            });
          }
        }, 100);
      } else if (currentHeight > initialHeight - 50) {
        // Keyboard is closing
        isKeyboardOpen = false;
        initialHeight = currentHeight;
      }
    };

    const handleFocus = () => {
      // Update initial height when input is focused
      initialHeight = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);
    textareaRef.current?.addEventListener('focus', handleFocus);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      textareaRef.current?.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      adjustTextareaHeight(textareaRef.current);
    }
  }, [message, isMobileDevice]);

  // Wrapper to handle file upload and reset input values
  const handleFileUploadWrapper = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onFileUpload(e);
    // Reset input values to allow re-selecting the same file
    if (e.target) {
      e.target.value = "";
    }
  }, [onFileUpload]);

  const handleTextSend = useCallback(() => {
    if ((!message.trim() && !uploadedFile) || isLoading || isRecording || isTranscribingVoice) {
      return;
    }

    clearVoiceStatus();
    void onSend(message, draftInputMethod);
    resetComposer();
  }, [
    clearVoiceStatus,
    draftInputMethod,
    isLoading,
    isRecording,
    isTranscribingVoice,
    message,
    onSend,
    resetComposer,
    uploadedFile,
  ]);

  const activeVoiceStatus = isTranscribingVoice
    ? "Расшифровываю голосовое..."
    : isRecording
      ? `Идёт запись ${formatVoiceDuration(recordingDurationSeconds)}`
      : voiceStatusText;

  return (
    <div className="flex-shrink-0 border-t p-2 md:p-4 bg-background" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
      <div className="max-w-4xl mx-auto space-y-2 md:space-y-3">
        {/* Preview uploaded file - Telegram style */}
        {previewUrl && (
          <div className="relative w-full">
            <div className="relative rounded-xl overflow-hidden border border-border shadow-lg bg-muted/50">
              <img
                src={previewUrl}
                alt="Preview"
                className="w-full max-h-[50vh] md:max-h-96 object-contain"
              />
              <button
                onClick={onRemoveFile}
                className="absolute top-3 right-3 bg-destructive/90 hover:bg-destructive text-destructive-foreground rounded-full w-8 h-8 md:w-9 md:h-9 flex items-center justify-center transition-all hover:scale-110 shadow-md"
                title="Удалить"
              >
                <X className="h-5 w-5 md:h-6 md:w-6" />
              </button>
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="relative flex items-end gap-1 md:gap-2">
          {/* File upload inputs */}
          {/* Backward compatibility input */}
          <input
            ref={fileInputRef}
            type="file"
            id="file-upload"
            accept="image/*"
            onChange={handleFileUploadWrapper}
            className="hidden"
          />
          {/* Gallery input */}
          <input
            ref={galleryInputRef}
            type="file"
            id="gallery-upload"
            accept="image/*"
            onChange={handleFileUploadWrapper}
            className="hidden"
          />
          {/* Camera input */}
          <input
            ref={cameraInputRef}
            type="file"
            id="camera-upload"
            accept="image/*"
            capture="environment"
            onChange={handleFileUploadWrapper}
            className="hidden"
          />
          
          {/* Image upload button - opens sheet */}
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 md:h-11 md:w-11 shrink-0"
            onClick={() => setIsSheetOpen(true)}
            disabled={isLoading || isRecording || isTranscribingVoice}
            title="Загрузить фото"
          >
            <ImageIcon className="h-4 w-4 md:h-5 md:w-5" />
          </Button>

          {/* Selection Sheet */}
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetContent side="bottom" className="rounded-t-3xl pb-8">
              <SheetHeader>
                <SheetTitle className="text-center">Выберите источник</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-3">
                {/* Camera option */}
                <button
                  onClick={() => {
                    cameraInputRef.current?.click();
                    setIsSheetOpen(false);
                  }}
                  className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-muted transition-colors text-left"
                >
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Camera className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold">Сфотографировать</div>
                    <div className="text-sm text-muted-foreground">
                      Сделать фото с камеры
                    </div>
                  </div>
                </button>

                {/* Gallery option */}
                <button
                  onClick={() => {
                    galleryInputRef.current?.click();
                    setIsSheetOpen(false);
                  }}
                  className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-muted transition-colors text-left"
                >
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <ImagePlus className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold">Выбрать из галереи</div>
                    <div className="text-sm text-muted-foreground">
                      Выбрать фото из галереи
                    </div>
                  </div>
                </button>
              </div>
            </SheetContent>
          </Sheet>

          {/* Voice recording indicator */}
          {activeVoiceStatus && (
            <div className="absolute -top-8 left-0 right-0 text-center">
              <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded-md">
                {activeVoiceStatus}
              </span>
            </div>
          )}

          {/* Text input */}
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => {
              const newValue = e.target.value;
              if (voiceStatusText) {
                clearVoiceStatus();
              }
              setMessage(newValue);
              if (!newValue.trim()) {
                setDraftInputMethod("text");
              }
              adjustTextareaHeight(e.target);
              onValueChange?.(newValue);
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
                handleTextSend();
              }
            }}
            placeholder={isMobile ? "Напиши вопрос..." : "Напиши свой вопрос или вставь скриншот (Ctrl+V)..."}
            rows={1}
            className="flex-1 resize-none overflow-y-auto !min-h-[40px] md:!min-h-[44px] text-sm md:text-base py-2.5 transition-[height] duration-150 leading-6"
            disabled={isLoading || isTranscribingVoice}
            style={{ 
              fontSize: isMobile ? '16px' : undefined,
              height: '40px',
              maxHeight: isMobileDevice ? '96px' : '120px'
            }}
          />

          {/* Voice input button */}
          {isVoiceSupported && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isRecording ? "destructive" : "outline"}
                    size="icon"
                    className={`h-10 w-10 md:h-11 md:w-11 shrink-0 transition-all ${
                      isRecording ? 'animate-pulse' : ''
                    }`}
                    onClick={() => {
                      void handleVoiceButton();
                    }}
                    disabled={isLoading || isTranscribingVoice}
                  >
                    {isTranscribingVoice ? (
                      <Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin" />
                    ) : isRecording ? (
                      <MicOff className="h-4 w-4 md:h-5 md:w-5" />
                    ) : (
                      <Mic className="h-4 w-4 md:h-5 md:w-5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isTranscribingVoice
                    ? "Расшифровываю..."
                    : isRecording
                      ? "Остановить и расшифровать"
                      : "Записать голосовое"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Send button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={isRecording ? handleCancelVoiceRecording : handleTextSend}
                  disabled={isTranscribingVoice || (!isRecording && (((!message.trim() && !uploadedFile) || isLoading)))}
                  size="icon"
                  className="h-10 w-10 md:h-11 md:w-11 shrink-0"
                >
                  {isRecording ? (
                    <X className="h-4 w-4 md:h-5 md:w-5" />
                  ) : isLoading ? (
                    <Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 md:h-5 md:w-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {isRecording
                  ? "Отменить запись"
                  : isLoading
                    ? "Отправка..."
                    : "Отправить"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
});

ChatInput.displayName = "ChatInput";

export default ChatInput;
