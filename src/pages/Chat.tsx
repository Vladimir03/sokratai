import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Send, Mic, MessageSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/integrations/supabase/client";
import ChatMessage from "@/components/ChatMessage";
import ConnectionIndicator from "@/components/ConnectionIndicator";
import { saveChatToSessionCache, loadChatFromSessionCache } from "@/utils/chatCache";
import { messageBatcher } from "@/utils/messageBatcher";
import { debounce } from "@/utils/debounce";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
// KaTeX CSS теперь загружается динамически в ChatMessage

const MAX_MESSAGE_LENGTH = 2000;

interface Message {
  role: "user" | "assistant";
  content: string;
  id?: string;
  tempId?: string;
  status?: "sending" | "sent" | "error";
  error?: string;
}

const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  const networkStatus = useNetworkStatus();

  // Показываем уведомление при плохом соединении
  useEffect(() => {
    if (networkStatus.quality === 'offline') {
      toast.error("Нет подключения к интернету. Работаем в офлайн-режиме.");
    } else if (networkStatus.quality === 'poor') {
      toast.warning("Слабое соединение. Возможны задержки.");
    }
  }, [networkStatus.quality]);

  // Debounced scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      if (parentRef.current) {
        parentRef.current.scrollTop = parentRef.current.scrollHeight;
      }
    }, 100);
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  const loadChatHistory = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoadingHistory(false);
        return;
      }

      // Пробуем загрузить из sessionStorage кэша
      const cachedMessages = loadChatFromSessionCache(user.id);
      if (cachedMessages && cachedMessages.length > 0) {
        console.log("Loading from session cache");
        setMessages(cachedMessages.map(msg => ({
          role: msg.role,
          content: msg.content,
          id: msg.id,
          tempId: msg.tempId,
          status: msg.status === "sent" ? undefined : msg.status
        })));
        setLoadingHistory(false);
        return; // Работаем только с кэшем, не делаем запрос
      }

      // Только если кэш пустой или истек, делаем запрос
      console.log("Loading from database");
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(50);

      if (error) throw error;

      if (data) {
        const loadedMessages: Message[] = data.map(msg => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
          id: msg.id,
          status: "sent"
        }));
        setMessages(loadedMessages);
        saveChatToSessionCache(loadedMessages.map(msg => ({
          ...msg,
          timestamp: Date.now()
        })), user.id);
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
      toast.error("Не удалось загрузить историю чата");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadChatHistory();
    
    // Flush pending messages при размонтировании
    return () => {
      messageBatcher.forceFlush();
    };
  }, [loadChatHistory]);

  // Сохранение с батчингом
  const saveMessageToBatch = useCallback((
    role: "user" | "assistant", 
    content: string,
    tempId?: string
  ) => {
    // Добавляем в батч вместо немедленного сохранения
    messageBatcher.addMessage({ role, content, tempId });
    
    // Обновляем статус на "sent" сразу (оптимистично)
    if (tempId) {
      setTimeout(() => {
        setMessages(prev => prev.map(msg => 
          msg.tempId === tempId 
            ? { ...msg, status: "sent" as const }
            : msg
        ));
      }, 100);
    }
  }, []);

  // Обновляем кэш при изменении сообщений
  useEffect(() => {
    if (messages.length > 0) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          saveChatToSessionCache(messages.map(msg => ({
            ...msg,
            timestamp: Date.now()
          })), user.id);
        }
      });
    }
  }, [messages]);


  const streamChat = useCallback(async (userMessages: Message[]) => {
    const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Требуется авторизация");
      throw new Error("No session");
    }
    
    const resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ messages: userMessages }),
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        toast.error("Превышен лимит запросов. Попробуйте позже.");
        throw new Error("Rate limit exceeded");
      }
      if (resp.status === 402) {
        toast.error("Требуется пополнение баланса.");
        throw new Error("Payment required");
      }
      throw new Error("Failed to start stream");
    }

    if (!resp.body) throw new Error("No response body");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = "";
    let streamDone = false;
    let assistantContent = "";

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      textBuffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
        let line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") {
          streamDone = true;
          break;
        }

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) {
            assistantContent += content;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, content: assistantContent } : m
                );
              }
              return [...prev, { role: "assistant", content: assistantContent }];
            });
          }
        } catch {
          textBuffer = line + "\n" + textBuffer;
          break;
        }
      }
    }
    
    // Сохраняем ответ ассистента в батч
    if (assistantContent) {
      saveMessageToBatch("assistant", assistantContent);
    }
  }, [saveMessageToBatch]);

  const retryMessage = useCallback(async (tempId: string) => {
    const msgToRetry = messages.find(m => m.tempId === tempId);
    if (!msgToRetry) return;

    // Обновляем статус на "sending"
    setMessages(prev => prev.map(msg => 
      msg.tempId === tempId 
        ? { ...msg, status: "sending" as const, error: undefined }
        : msg
    ));

    // Пытаемся сохранить снова через батчер
    saveMessageToBatch(msgToRetry.role, msgToRetry.content, tempId);
  }, [messages, saveMessageToBatch]);

  const sendQuickMessage = useCallback(async (text: string) => {
    // Блокируем отправку при offline
    if (networkStatus.quality === 'offline') {
      toast.error("Нет подключения к интернету");
      return;
    }

    if (isLoading) return;

    const tempId = `temp_${Date.now()}_${Math.random()}`;
    const userMessage: Message = { 
      role: "user", 
      content: text,
      tempId,
      status: "sending"
    };
    
    // Optimistic update
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    // Сохраняем в батч (не блокируем UI)
    saveMessageToBatch("user", text, tempId);

    try {
      // Начинаем стриминг сразу
      const recentMessages = [...messages, userMessage].slice(-10);
      await streamChat(recentMessages);
    } catch (error) {
      console.error("Chat error:", error);
      toast.error("Ошибка при отправке сообщения");
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, messages, saveMessageToBatch, streamChat, networkStatus.quality]);

  // Debounced версия для quick messages
  const debouncedSendQuickMessage = useCallback(
    debounce(sendQuickMessage, 500),
    [sendQuickMessage]
  );

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    
    if (!trimmedInput) {
      toast.error("Сообщение не может быть пустым");
      return;
    }
    
    if (trimmedInput.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Максимальная длина: ${MAX_MESSAGE_LENGTH} символов`);
      return;
    }

    // Блокируем отправку при offline
    if (networkStatus.quality === 'offline') {
      toast.error("Нет подключения к интернету");
      return;
    }
    
    if (isLoading) return;

    const tempId = `temp_${Date.now()}_${Math.random()}`;
    const userMessage: Message = { 
      role: "user", 
      content: trimmedInput,
      tempId,
      status: "sending"
    };
    
    // Optimistic update
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Сохраняем в батч (не блокируем UI)
    saveMessageToBatch("user", trimmedInput, tempId);

    try {
      // Начинаем стриминг сразу
      const recentMessages = [...messages, userMessage].slice(-10);
      await streamChat(recentMessages);
    } catch (error) {
      console.error("Chat error:", error);
      toast.error("Ошибка при отправке сообщения");
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, saveMessageToBatch, streamChat, networkStatus.quality]);

  return (
    <AuthGuard>
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Card className="w-full max-w-5xl h-[calc(100vh-2rem)] flex flex-col overflow-hidden shadow-elegant">
          {/* Header with connection indicator */}
          <div className="p-3 border-b flex justify-between items-center">
            <h2 className="text-sm font-medium">ИИ-репетитор</h2>
            <ConnectionIndicator />
          </div>

          {/* Messages */}
          <div ref={parentRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {loadingHistory ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                <MessageSquare className="w-16 h-16 mx-auto mb-4 text-primary/50" />
                <h3 className="text-xl font-semibold mb-2">Начните диалог с ИИ-репетитором</h3>
                <p>Задайте любой вопрос по математике и получите детальное объяснение</p>
              </div>
            ) : null}

            {messages.map((message, index) => (
              <ChatMessage
                key={message.id || message.tempId || index}
                message={message}
                isLoading={isLoading}
                onQuickMessage={debouncedSendQuickMessage}
                onRetry={message.status === "error" && message.tempId ? () => retryMessage(message.tempId!) : undefined}
              />
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted p-4 rounded-2xl">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0.4s" }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="p-4 border-t">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Напишите ваш вопрос..."
                className="flex-1"
              />
              <Button type="button" variant="outline" size="icon" disabled={isLoading}>
                <Mic className="w-4 h-4" />
              </Button>
              <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </AuthGuard>
  );
};

export default Chat;
