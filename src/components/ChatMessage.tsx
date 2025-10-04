import { memo } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface Message {
  role: "user" | "assistant";
  content: string;
  id?: string;
}

interface ChatMessageProps {
  message: Message;
  isLoading: boolean;
  onQuickMessage: (text: string) => void;
}

const markdownComponents = {
  p: ({ node, ...props }: any) => <p className="mb-3 leading-relaxed last:mb-0" {...props} />,
  strong: ({ node, ...props }: any) => <strong className="font-bold text-primary" {...props} />,
  ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-3 space-y-1" {...props} />,
  ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-3 space-y-2" {...props} />,
  li: ({ node, ...props }: any) => <li className="ml-2" {...props} />,
  h3: ({ node, ...props }: any) => <h3 className="font-bold text-lg mt-4 mb-2" {...props} />,
};

const ChatMessage = memo(({ message, isLoading, onQuickMessage }: ChatMessageProps) => {
  return (
    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] ${message.role === "user" ? "" : "space-y-3"}`}>
        <div
          className={`p-4 rounded-2xl ${
            message.role === "user"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
        >
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        </div>
        
        {message.role === "assistant" && !isLoading && (
          <div className="flex gap-2 flex-wrap px-1">
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
            
            <button 
              onClick={() => onQuickMessage("Объясни этот момент подробнее")}
              className="text-xs px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-full border border-purple-200 transition-colors dark:bg-purple-950 dark:hover:bg-purple-900 dark:text-purple-300 dark:border-purple-800"
              disabled={isLoading}
            >
              🔍 Подробнее
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

ChatMessage.displayName = "ChatMessage";

export default ChatMessage;
