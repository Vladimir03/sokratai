import { memo, lazy, Suspense, useState, useMemo } from "react";
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X } from "lucide-react";

// Динамическая загрузка только ReactMarkdown компонента
const ReactMarkdown = lazy(() => import('react-markdown'));

interface Message {
  role: "user" | "assistant";
  content: string;
  id?: string;
  tempId?: string;
  status?: "sending" | "sent" | "error";
  error?: string;
  image_url?: string;
  input_method?: "text" | "voice" | "button";
}

interface ChatMessageProps {
  message: Message;
  isLoading: boolean;
  onQuickMessage: (text: string) => void;
  onRetry?: () => void;
}

const ChatMessage = memo(({ message, isLoading, onQuickMessage, onRetry }: ChatMessageProps) => {
  const [imageModalOpen, setImageModalOpen] = useState(false);

  // Мемоизируем markdown компоненты для избежания пересоздания
  const markdownComponents = useMemo(() => ({
    p: ({ node, ...props }: any) => <p className="mb-3 leading-relaxed last:mb-0" {...props} />,
    strong: ({ node, ...props }: any) => <strong className="font-bold text-primary" {...props} />,
    ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-3 space-y-1" {...props} />,
    ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-3 space-y-2" {...props} />,
    li: ({ node, ...props }: any) => <li className="ml-2" {...props} />,
    h3: ({ node, ...props }: any) => <h3 className="font-bold text-lg mt-4 mb-2" {...props} />,
  }), []);

  const getStatusIcon = () => {
    if (message.role !== "user") return null;
    
    switch (message.status) {
      case "sending":
        return <span className="text-xs opacity-60 ml-2">⏳</span>;
      case "sent":
        return <span className="text-xs opacity-60 ml-2">✓</span>;
      case "error":
        return <span className="text-xs text-red-400 ml-2">❌</span>;
      default:
        return null;
    }
  };

  return (
    <>
      {/* Модальное окно для просмотра изображения на весь экран */}
      {message.image_url && (
        <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
          <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden">
            <button
              onClick={() => setImageModalOpen(false)}
              className="absolute top-4 right-4 z-50 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
              aria-label="Закрыть"
            >
              <X className="h-6 w-6" />
            </button>
            <div className="w-full h-full flex items-center justify-center p-4">
              <img 
                src={message.image_url} 
                alt="Увеличенное изображение"
                className="max-w-full max-h-[90vh] object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
      
      <div className={`flex mb-6 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-[80%] ${message.role === "user" ? "" : "space-y-3"}`}>
          {/* Индикатор метода ввода для пользовательских сообщений */}
          {message.role === "user" && message.input_method && (
            <div className="flex items-center gap-1.5 mb-1 text-xs opacity-60">
              {message.input_method === "voice" && (
                <>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 3a3 3 0 00-3 3v4a3 3 0 006 0V6a3 3 0 00-3-3zM5 10a1 1 0 011 1v1a4 4 0 008 0v-1a1 1 0 112 0v1a6 6 0 01-11.999.002L4 12a1 1 0 011-1z"/>
                  </svg>
                  <span>Голосовой ввод</span>
                </>
              )}
              {message.input_method === "button" && (
                <>
                  <span>⚡</span>
                  <span>Быстрая кнопка</span>
                </>
              )}
            </div>
          )}
          
          <div
            className={`p-4 rounded-2xl ${
              message.role === "user"
                ? message.status === "error" 
                  ? "bg-destructive/20 text-foreground border border-destructive/40"
                  : "bg-primary text-primary-foreground"
                : "bg-muted"
            }`}
          >
            {/* Отображение изображения */}
            {message.image_url && (
              <div className="mb-3">
                <img 
                  src={message.image_url} 
                  alt="Загруженное изображение"
                  className="max-w-sm rounded-lg border border-border/20 cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setImageModalOpen(true)}
                />
              </div>
            )}
            
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <Suspense fallback={<div className="animate-pulse">{message.content}</div>}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={markdownComponents}
                >
                  {message.content}
                </ReactMarkdown>
              </Suspense>
            </div>
            <div className="flex items-center justify-end mt-1">
              {getStatusIcon()}
            </div>
          </div>
          
          {message.status === "error" && onRetry && (
            <button
              onClick={onRetry}
              className="text-xs px-3 py-1.5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-full border border-destructive/40 transition-colors"
            >
              🔄 Повторить отправку
            </button>
          )}
          
          {message.role === "assistant" && !isLoading && (
            <div className="flex gap-2 flex-wrap px-1">
              <button 
                onClick={() => onQuickMessage("Объясни этот момент подробнее")}
                className="text-xs px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-full border border-purple-200 transition-colors dark:bg-purple-950 dark:hover:bg-purple-900 dark:text-purple-300 dark:border-purple-800"
                disabled={isLoading}
              >
                🔍 Объясни подробнее
              </button>
              
              <button 
                onClick={() => onQuickMessage("Покажи полное решение с объяснением каждого шага")}
                className="text-xs px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-full border border-blue-200 transition-colors dark:bg-blue-950 dark:hover:bg-blue-900 dark:text-blue-300 dark:border-blue-800"
                disabled={isLoading}
              >
                📋 Полное решение
              </button>
              
              <button 
                onClick={() => onQuickMessage("Дай мне похожую задачу для практики")}
                className="text-xs px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 rounded-full border border-green-200 transition-colors dark:bg-green-950 dark:hover:bg-green-900 dark:text-green-300 dark:border-green-800"
                disabled={isLoading}
              >
                ✍️ Похожая задача
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
});

ChatMessage.displayName = "ChatMessage";

export default ChatMessage;
