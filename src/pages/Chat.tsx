import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Send, Mic, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/integrations/supabase/client";
import ChatMessage from "@/components/ChatMessage";
import ChatSkeleton from "@/components/ChatSkeleton";
import ConnectionIndicator from "@/components/ConnectionIndicator";
import { saveChatToSessionCache, loadChatFromSessionCache } from "@/utils/chatCache";
import { messageBatcher } from "@/utils/messageBatcher";
import { debounce } from "@/utils/debounce";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { PerformanceMonitor } from "@/utils/performanceMetrics";
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
  const [loadingStartTime, setLoadingStartTime] = useState<number | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("ИИ думает...");
  const [showCancelButton, setShowCancelButton] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  const abortControllerRef = useRef<AbortController | null>(null);
  const networkStatus = useNetworkStatus();

  // Показываем уведомление при плохом соединении
  useEffect(() => {
    if (networkStatus.quality === 'offline') {
      toast.error("Нет подключения к интернету. Работаем в офлайн-режиме.");
    } else if (networkStatus.quality === 'poor') {
      toast.warning("Слабое соединение. Возможны задержки.");
    }
  }, [networkStatus.quality]);

  // Мгновенный scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
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
    
    // Логируем статистику при монтировании
    setTimeout(() => {
      PerformanceMonitor.logSessionStats();
    }, 1000);
    
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
    // Начинаем замер DB save
    PerformanceMonitor.startDbSave();
    
    // Добавляем в батч вместо немедленного сохранения
    messageBatcher.addMessage({ role, content, tempId });
    
    // Завершаем замер DB save (батчинг асинхронный, но мы замеряем добавление в очередь)
    setTimeout(() => {
      PerformanceMonitor.endDbSave();
    }, 10);
    
    // Обновляем статус на "sent" мгновенно (оптимистично)
    if (tempId) {
      setMessages(prev => prev.map(msg => 
        msg.tempId === tempId 
          ? { ...msg, status: "sent" as const }
          : msg
      ));
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

  // Динамические сообщения загрузки на основе времени
  useEffect(() => {
    if (!isLoading || !loadingStartTime) {
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - loadingStartTime;
      
      if (elapsed > 15000) {
        setShowCancelButton(true);
      }
      
      if (elapsed > 10000) {
        setLoadingMessage("Почти готово...");
      } else if (elapsed > 5000) {
        setLoadingMessage("ИИ решает сложную задачу...");
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isLoading, loadingStartTime]);


  const streamChat = useCallback(async (userMessages: Message[]) => {
    const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Требуется авторизация");
      throw new Error("No session");
    }

    // Инициализация состояния загрузки
    setLoadingStartTime(Date.now());
    setLoadingMessage("ИИ думает...");
    setShowCancelButton(false);

    // Получаем последнее сообщение пользователя для метрик
    const lastUserMessage = userMessages
      .slice()
      .reverse()
      .find(m => m.role === 'user');
    const userQuery = lastUserMessage?.content || '';

    // Начинаем замер производительности
    PerformanceMonitor.startRequest(undefined, userQuery);

    // Таймаут для отмены через 30 секунд
    abortControllerRef.current = new AbortController();
    const cancelTimer = setTimeout(() => {
      abortControllerRef.current?.abort();
      toast.error("Запрос занял слишком много времени. Попробуйте снова.", {
        duration: 5000,
        action: {
          label: "Повторить",
          onClick: () => window.location.reload()
        }
      });
    }, 30000);
    
    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: userMessages }),
        signal: abortControllerRef.current?.signal,
      });

      // Отменяем таймер при успешном ответе
      clearTimeout(cancelTimer);

      if (!resp.ok) {
        const errorMessage = `HTTP ${resp.status}: ${resp.statusText}`;
        console.error('🔴 Network error:', {
          status: resp.status,
          statusText: resp.statusText,
          url: CHAT_URL,
        });

        if (resp.status === 429) {
          toast.error("Превышен лимит запросов. Попробуйте позже.");
          PerformanceMonitor.endRequest(false, "Rate limit exceeded");
          throw new Error("Rate limit exceeded");
        }
        if (resp.status === 402) {
          toast.error("Требуется пополнение баланса.");
          PerformanceMonitor.endRequest(false, "Payment required");
          throw new Error("Payment required");
        }
        
        PerformanceMonitor.endRequest(false, errorMessage);
        throw new Error("Failed to start stream");
      }

      if (!resp.body) {
        PerformanceMonitor.endRequest(false, "No response body");
        throw new Error("No response body");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;
      let assistantContent = "";
      let firstTokenReceived = false;
      let updateScheduled = false;

      // Debounced update для уменьшения re-renders
      const scheduleUpdate = () => {
        if (!updateScheduled) {
          updateScheduled = true;
          setTimeout(() => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, content: assistantContent } : m
                );
              }
              return [...prev, { role: "assistant", content: assistantContent }];
            });
            updateScheduled = false;
          }, 50);
        }
      };

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
              // Фиксируем первый токен
              if (!firstTokenReceived) {
                PerformanceMonitor.recordFirstToken();
                firstTokenReceived = true;
              }

              assistantContent += content;
              scheduleUpdate();
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Финальное обновление
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: assistantContent } : m
          );
        }
        return [...prev, { role: "assistant", content: assistantContent }];
      });
      
      // Сохраняем ответ ассистента в батч
      if (assistantContent) {
        saveMessageToBatch("assistant", assistantContent);
      }

      // Завершаем замер успешно
      clearTimeout(cancelTimer);
      setLoadingStartTime(null);
      setShowCancelButton(false);
      abortControllerRef.current = null;
      PerformanceMonitor.endRequest(true);
    } catch (error) {
      clearTimeout(cancelTimer);
      setLoadingStartTime(null);
      setShowCancelButton(false);
      abortControllerRef.current = null;
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Проверяем, был ли запрос отменен
      if (errorMessage.includes('abort')) {
        console.warn('Request aborted due to timeout');
        return; // Не пробрасываем ошибку, тост уже показан
      }
      
      console.error('🔴 Stream error:', {
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
      PerformanceMonitor.endRequest(false, errorMessage);
      throw error;
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

  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      setLoadingStartTime(null);
      setShowCancelButton(false);
      abortControllerRef.current = null;
      
      // Убираем пустой placeholder ответа
      setMessages(prev => prev.filter(m => m.content !== ""));
      
      toast.info("Запрос отменен. Вы можете отправить новое сообщение.");
    }
  }, []);

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
    
    // Мгновенный optimistic update
    setMessages(prev => [...prev, userMessage]);
    
    // Мгновенно показываем placeholder для ответа
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);
    setIsLoading(true);

    // Сохраняем в батч полностью в фоне (не блокируем)
    saveMessageToBatch("user", text, tempId);

    try {
      // Начинаем стриминг немедленно
      const recentMessages = [...messages, userMessage].slice(-10);
      await streamChat(recentMessages);
    } catch (error) {
      console.error("Chat error:", error);
      // Убираем placeholder при ошибке
      setMessages(prev => prev.filter(m => m.content !== ""));
      toast.error("Ошибка при отправке сообщения");
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, messages, saveMessageToBatch, streamChat, networkStatus.quality]);

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
    
    // Мгновенный optimistic update
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    
    // Мгновенно показываем placeholder для ответа
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);
    setIsLoading(true);

    // Сохраняем в батч полностью в фоне (не блокируем)
    saveMessageToBatch("user", trimmedInput, tempId);

    try {
      // Начинаем стриминг немедленно без задержек
      const recentMessages = [...messages, userMessage].slice(-10);
      await streamChat(recentMessages);
    } catch (error) {
      console.error("Chat error:", error);
      // Убираем placeholder при ошибке
      setMessages(prev => prev.filter(m => m.content !== ""));
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
              <ChatSkeleton />
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
                onQuickMessage={sendQuickMessage}
                onRetry={message.status === "error" && message.tempId ? () => retryMessage(message.tempId!) : undefined}
              />
            ))}

            {/* Прогресс-бар загрузки */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex flex-col gap-2 max-w-[80%]">
                  <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-secondary/50 border border-border/50">
                    <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    <span className="text-sm text-foreground font-medium">{loadingMessage}</span>
                  </div>
                  {showCancelButton && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={cancelRequest}
                      className="w-fit self-start"
                    >
                      Отменить запрос
                    </Button>
                  )}
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
