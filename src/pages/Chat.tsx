import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Send, Mic, MessageSquare, Square } from "lucide-react";
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
  image_url?: string;
}

const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingStartTime, setLoadingStartTime] = useState<number | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("ИИ думает...");
  const [showCancelButton, setShowCancelButton] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);
  const networkStatus = useNetworkStatus();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          status: "sent",
          image_url: msg.image_url
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
    tempId?: string,
    image_url?: string
  ) => {
    // Начинаем замер DB save
    PerformanceMonitor.startDbSave();
    
    // Добавляем в батч вместо немедленного сохранения
    messageBatcher.addMessage({ role, content, tempId, image_url });
    
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
      let contentBuffer = "";
      let lastUpdateTime = Date.now();

      // Batched update - накапливаем токены и обновляем раз в 100ms
      const flushUpdate = () => {
        const currentContent = assistantContent + contentBuffer;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: currentContent } : m
            );
          }
          return [...prev, { role: "assistant", content: currentContent }];
        });
        assistantContent = currentContent;
        contentBuffer = "";
        lastUpdateTime = Date.now();
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

              // Накапливаем токены в буфер
              contentBuffer += content;
              
              // Обновляем UI раз в 100ms
              const now = Date.now();
              if (now - lastUpdateTime > 100) {
                flushUpdate();
              }
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Финальное обновление - флашим оставшиеся токены
      if (contentBuffer) {
        flushUpdate();
      } else {
        // Если буфер пустой, просто обновляем финальный контент
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

  const handleImageUpload = useCallback(async (file: File) => {
    // Проверка размера (макс 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Файл слишком большой. Максимум 5MB');
      return;
    }

    // Проверка типа
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      toast.error('Поддерживаются только JPG, PNG, WebP и GIF');
      return;
    }

    setIsUploading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Требуется авторизация');
        return;
      }

      // Загрузка в Supabase Storage
      const fileExt = file.name.split('.').pop() || file.type.split('/')[1];
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Получение публичного URL
      const { data: { publicUrl } } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath);

      setSelectedImage(publicUrl);
      toast.success('✅ Изображение загружено! Добавьте вопрос и отправьте.');
    } catch (error) {
      console.error('Ошибка загрузки:', error);
      toast.error('❌ Не удалось загрузить изображение');
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    await handleImageUpload(file);
    
    // Сброс input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleImageUpload]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    // Ищем изображение в clipboard
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Проверяем, что это изображение
      if (item.type.startsWith('image/')) {
        e.preventDefault(); // Предотвращаем обычную вставку текста
        
        // Получаем файл из clipboard
        const file = item.getAsFile();
        if (!file) continue;
        
        // Показываем уведомление
        toast.info('📸 Скриншот обнаружен! Загружаю...');
        
        // Обрабатываем как обычную загрузку
        await handleImageUpload(file);
        
        break; // Берём только первое изображение
      }
    }
  }, [handleImageUpload]);

  const removeSelectedImage = useCallback(() => {
    setSelectedImage(null);
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
      
      // Вибрация при остановке
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }
  }, []);

  const handleVoiceInput = useCallback(() => {
    // Проверка поддержки Web Speech API
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      toast.error("Голосовой ввод не поддерживается в вашем браузере", { duration: 3000 });
      return;
    }

    // Если уже идёт запись, останавливаем
    if (isRecording && recognitionRef.current) {
      stopRecording();
      return;
    }

    // Останавливаем запись при начале печати
    if (input.length > 0) {
      toast.info("Очистите поле ввода перед голосовым вводом", { duration: 2000 });
      return;
    }

    // Создаём новый экземпляр распознавания
    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsRecording(true);
      
      // Вибрация при старте
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      
      // Проверка длины
      if (transcript.length > MAX_MESSAGE_LENGTH) {
        setInput(transcript.slice(0, MAX_MESSAGE_LENGTH));
        toast.warning(`Текст обрезан до ${MAX_MESSAGE_LENGTH} символов`, { duration: 3000 });
      } else {
        setInput(transcript);
      }
      
      setIsRecording(false);
      toast.success("✅ Текст распознан!", { duration: 2000 });
      
      // Фокус на input после распознавания
      setTimeout(() => {
        const inputElement = document.querySelector('input[type="text"]') as HTMLInputElement;
        inputElement?.focus();
      }, 100);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsRecording(false);
      
      if (event.error === 'no-speech') {
        toast.error("Не удалось распознать речь. Попробуйте ещё раз.", { duration: 3000 });
      } else if (event.error === 'not-allowed') {
        toast.error("Разрешите доступ к микрофону в настройках браузера", { duration: 4000 });
      } else if (event.error === 'aborted') {
        // Пользователь прервал запись, не показываем ошибку
      } else {
        toast.error("Ошибка распознавания речи", { duration: 3000 });
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (error) {
      console.error('Failed to start recognition:', error);
      toast.error("Не удалось запустить распознавание речи", { duration: 3000 });
      setIsRecording(false);
    }
  }, [isRecording, input, stopRecording]);

  // Останавливаем запись при размонтировании
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // Останавливаем запись при начале печати
  useEffect(() => {
    if (isRecording && input.length > 0 && recognitionRef.current) {
      stopRecording();
    }
  }, [input, isRecording, stopRecording]);

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
    saveMessageToBatch(msgToRetry.role, msgToRetry.content, tempId, msgToRetry.image_url);
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
    
    if (!trimmedInput && !selectedImage) {
      toast.error("Сообщение или изображение обязательны");
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
      content: trimmedInput || "Помоги с этой задачей",
      tempId,
      status: "sending",
      image_url: selectedImage || undefined
    };
    
    // Мгновенный optimistic update
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    
    // Мгновенно показываем placeholder для ответа
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);
    setIsLoading(true);

    // Сохраняем в батч полностью в фоне (не блокируем)
    saveMessageToBatch("user", trimmedInput || "Помоги с этой задачей", tempId, selectedImage || undefined);

    // Очищаем выбранное изображение
    setSelectedImage(null);

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
  }, [input, isLoading, messages, saveMessageToBatch, streamChat, networkStatus.quality, selectedImage]);

  return (
    <AuthGuard>
      <div className="fixed inset-0 flex items-center justify-center p-4 md:pb-4 pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <Card className="w-full max-w-5xl md:h-[calc(100vh-2rem)] h-[calc(100vh-2rem-4rem-env(safe-area-inset-bottom))] flex flex-col overflow-hidden shadow-elegant">
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
          <form onSubmit={handleSubmit} className="p-4 border-t relative">
            {/* Индикатор записи */}
            {isRecording && (
              <div className="absolute bottom-full left-0 right-0 mb-2 mx-4 p-3 bg-destructive text-destructive-foreground rounded-lg shadow-lg animate-pulse flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-white rounded-full animate-ping" />
                  <span className="font-medium text-sm md:text-base">🎤 Идёт запись... Говорите чётко</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={stopRecording}
                  className="text-destructive-foreground hover:bg-destructive/80 shrink-0"
                >
                  <Square className="w-4 h-4 mr-1" />
                  Остановить
                </Button>
              </div>
            )}
            
            {/* Превью загруженного изображения */}
            {selectedImage && (
              <div className="mb-3 relative inline-block">
                <img 
                  src={selectedImage} 
                  alt="Загруженное изображение" 
                  className="max-w-xs max-h-32 rounded-lg border border-border"
                />
                <button
                  type="button"
                  onClick={removeSelectedImage}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/90 transition-colors"
                  title="Удалить изображение"
                >
                  ✕
                </button>
              </div>
            )}
            
            {/* Индикатор загрузки */}
            {isUploading && (
              <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin">⏳</div>
                Загрузка изображения...
              </div>
            )}
            
            <div className="flex gap-2 items-end">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleFileSelect}
                disabled={isUploading || isLoading}
              />
              
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || isLoading}
                title="Прикрепить изображение"
              >
                📎
              </Button>
              
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={handlePaste}
                placeholder={selectedImage ? "Добавьте вопрос (опционально)" : "Напишите вопрос или вставьте скриншот (Ctrl+V) 📸"}
                className="flex-1"
                disabled={isLoading}
              />
              
              <Button 
                type="button" 
                variant={isRecording ? "destructive" : "outline"}
                size="icon" 
                disabled={isLoading || isUploading}
                onClick={handleVoiceInput}
                className={isRecording ? "animate-pulse" : ""}
                title={isRecording ? "Нажмите чтобы остановить запись" : "Голосовой ввод"}
              >
                {isRecording ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </Button>
              
              <Button 
                type="submit" 
                size="icon" 
                disabled={isLoading || isUploading || (!input.trim() && !selectedImage)}
              >
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
