import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ChatMessage from "@/components/ChatMessage";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ChatSkeleton from "@/components/ChatSkeleton";
import LoadingIndicator from "@/components/LoadingIndicator";
import { useSearchParams, useNavigate } from "react-router-dom";
import ConnectionIndicator from "@/components/ConnectionIndicator";
import { ChatSidebar } from "@/components/ChatSidebar";
import { TaskContextBanner } from "@/components/TaskContextBanner";
import Navigation from "@/components/Navigation";
import AuthGuard from "@/components/AuthGuard";
import { useIsMobile } from "@/hooks/use-mobile";
import ChatInput from "@/components/ChatInput";

interface Message {
  role: "user" | "assistant";
  content: string;
  image_url?: string;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const chatIdFromUrl = searchParams.get('id');
  const isMobile = useIsMobile();

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    }
  });

  // Ensure general chat exists
  const { data: generalChat } = useQuery({
    queryKey: ['general-chat', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      const { data: existingChat } = await supabase
        .from('chats')
        .select('id')
        .eq('user_id', user.id)
        .eq('chat_type', 'general')
        .maybeSingle();

      if (existingChat) return existingChat;

      const { data: newChat, error } = await supabase
        .from('chats')
        .insert({
          user_id: user.id,
          chat_type: 'general',
          title: 'Общий чат',
          icon: '📚'
        })
        .select()
        .single();

      if (error) throw error;
      return newChat;
    },
    enabled: !!user?.id
  });

  const currentChatId = chatIdFromUrl || generalChat?.id;

  // Fetch current chat details
  const { data: currentChat } = useQuery({
    queryKey: ['chat', currentChatId],
    queryFn: async () => {
      if (!currentChatId) return null;

      const { data, error } = await supabase
        .from('chats')
        .select(`
          *,
          homework_task:homework_tasks(
            *,
            homework_set:homework_sets(*)
          )
        `)
        .eq('id', currentChatId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!currentChatId
  });

  // Load chat history whenever chat changes
  useEffect(() => {
    if (!user?.id || !currentChatId) {
      setMessages([]);
      setLoadingHistory(false);
      return;
    }
    
    setLoadingHistory(true);
    
    const loadHistory = async () => {
      try {
        const { data, error } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('chat_id', currentChatId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        
        if (data && data.length > 0) {
          setMessages(data.map(msg => ({
            role: msg.role as "user" | "assistant",
            content: msg.content,
            image_url: msg.image_url || undefined
          })));
        } else {
          setMessages([]);
        }
      } catch (error) {
        console.error('Error loading chat history:', error);
        setMessages([]);
      } finally {
        setLoadingHistory(false);
      }
    };

    loadHistory();
  }, [user?.id, currentChatId]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Ошибка",
        description: "Можно загружать только изображения",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "Ошибка",
        description: "Файл слишком большой (макс. 10MB)",
        variant: "destructive",
      });
      return;
    }

    setUploadedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }, [toast]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          setUploadedFile(file);
          setPreviewUrl(URL.createObjectURL(file));
          e.preventDefault();
          toast({
            title: "Скриншот вставлен",
            description: "Изображение готово к отправке",
          });
          break;
        }
      }
    }
  }, [toast]);

  const removeUploadedFile = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setUploadedFile(null);
    setPreviewUrl(null);
  }, [previewUrl]);

  const saveMessageToBatch = async (msg: Message) => {
    if (!user?.id || !currentChatId) return;

    try {
      await supabase.from('chat_messages').insert({
        chat_id: currentChatId,
        user_id: user.id,
        role: msg.role,
        content: msg.content,
        image_url: msg.image_url
      });

      // Update chat's last_message_at
      await supabase
        .from('chats')
        .update({
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', currentChatId);
    } catch (error) {
      console.error('Error saving message:', error);
    }
  };

  const scrollToBottom = (smooth = true) => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  // Auto-scroll when messages change
  useEffect(() => {
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      scrollToBottom();
    });
  }, [messages]);

  async function streamChat({
    messages,
    onDelta,
    onDone,
    taskContext,
    chatId,
  }: {
    messages: Message[];
    onDelta: (deltaText: string) => void;
    onDone: () => void;
    taskContext?: string;
    chatId?: string;
  }) {
    const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({
        title: "Ошибка",
        description: "Требуется авторизация",
        variant: "destructive",
      });
      throw new Error("No session");
    }

    const resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ messages, taskContext, chatId }),
    });

    if (!resp.ok || !resp.body) {
      if (resp.status === 429) {
        toast({
          title: "Ошибка",
          description: "Превышен лимит запросов. Попробуйте позже.",
          variant: "destructive",
        });
      } else if (resp.status === 402) {
        toast({
          title: "Ошибка",
          description: "Требуется пополнение баланса.",
          variant: "destructive",
        });
      }
      throw new Error("Failed to start stream");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = "";
    let streamDone = false;

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
          if (content) onDelta(content);
        } catch {
          textBuffer = line + "\n" + textBuffer;
          break;
        }
      }
    }

    if (textBuffer.trim()) {
      for (let raw of textBuffer.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        if (raw.startsWith(":") || raw.trim() === "") continue;
        if (!raw.startsWith("data: ")) continue;
        const jsonStr = raw.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
        } catch {}
      }
    }

    onDone();
  }

  const handleSend = useCallback(async (message: string) => {
    if ((!message.trim() && !uploadedFile) || isLoading) return;

    let imageUrl: string | undefined = undefined;

    // Upload image if exists
    if (uploadedFile && user?.id) {
      const fileName = `${user.id}/${Date.now()}-${uploadedFile.name}`;
      
      const { data, error } = await supabase.storage
        .from('chat-images')
        .upload(fileName, uploadedFile);

      if (error) {
        toast({
          title: "Ошибка",
          description: "Не удалось загрузить изображение",
          variant: "destructive",
        });
        console.error('Upload error:', error);
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('chat-images')
        .getPublicUrl(fileName);

      imageUrl = publicUrl;
    }

    const userMessage: Message = { 
      role: "user", 
      content: message.trim() || '[Изображение]',
      image_url: imageUrl
    };
    
    // Используем функциональное обновление состояния
    setMessages(prev => [...prev, userMessage]);
    removeUploadedFile();
    setIsLoading(true);

    // Сохраняем сообщение пользователя
    await saveMessageToBatch(userMessage);

    let assistantSoFar = "";
    
    const upsertAssistant = (nextChunk: string) => {
      assistantSoFar += nextChunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const taskContext = currentChat?.homework_task 
        ? `Задача №${currentChat.homework_task.task_number}. Тема: ${currentChat.homework_task.homework_set?.topic}. Условие: ${currentChat.homework_task.condition_text}`
        : undefined;

      // Получаем актуальные сообщения для отправки
      const messagesToSend = [...messages, userMessage];

      await streamChat({
        messages: messagesToSend,
        onDelta: (chunk) => upsertAssistant(chunk),
        onDone: () => {
          setIsLoading(false);
          queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
        },
        taskContext,
        chatId: currentChatId,
      });

      // Сохраняем только если есть контент от ассистента
      if (assistantSoFar.trim()) {
        const finalAssistantMsg: Message = { role: "assistant", content: assistantSoFar };
        await saveMessageToBatch(finalAssistantMsg);
      }
    } catch (error) {
      console.error(error);
      setIsLoading(false);
      toast({
        title: "Ошибка",
        description: "Не удалось отправить сообщение",
        variant: "destructive",
      });
    }
  }, [messages, uploadedFile, isLoading, user?.id, removeUploadedFile, currentChat, currentChatId, queryClient, toast]);

  const handleQuickMessage = useCallback((quickText: string) => {
    handleSend(quickText);
  }, [handleSend]);

  // Auto-start conversation with task context using AI
  useEffect(() => {
    if (!currentChat?.homework_task || messages.length > 0 || loadingHistory || isLoading) return;

    const generateAIWelcomeMessage = async () => {
      const task = currentChat.homework_task;
      setIsLoading(true);

      let assistantSoFar = "";
      const upsertAssistant = (nextChunk: string) => {
        assistantSoFar += nextChunk;
        setMessages([{ role: "assistant", content: assistantSoFar }]);
      };

      try {
        const taskContext = `Задача №${task.task_number}. Тема: ${task.homework_set?.topic}. Условие: ${task.condition_text}`;
        
        await streamChat({
          messages: [{
            role: "user",
            content: "Привет! Помоги мне разобраться с этой задачей"
          }],
          onDelta: (chunk) => upsertAssistant(chunk),
          onDone: () => {
            setIsLoading(false);
          },
          taskContext,
          chatId: currentChatId,
        });

        const finalAssistantMsg: Message = { role: "assistant", content: assistantSoFar };
        await saveMessageToBatch(finalAssistantMsg);
      } catch (error) {
        console.error('Error generating welcome message:', error);
        setIsLoading(false);
        // Fallback to simple welcome message
        const fallbackMessage: Message = {
          role: 'assistant',
          content: `Привет! Вижу, ты работаешь над задачей ${task.task_number} из темы "${task.homework_set?.topic}". С чего начнём?`
        };
        setMessages([fallbackMessage]);
        await saveMessageToBatch(fallbackMessage);
      }
    };

    generateAIWelcomeMessage();
  }, [currentChat?.homework_task, messages.length, loadingHistory, isLoading]);

  const handleChatSelect = (chatId: string) => {
    navigate(`/chat?id=${chatId}`);
    if (isMobile) {
      setIsSidebarOpen(false);
    }
  };

  // Auto-open sidebar on desktop
  useEffect(() => {
    if (!isMobile) {
      setIsSidebarOpen(true);
    } else {
      setIsSidebarOpen(false);
    }
  }, [isMobile]);

  // Fix body overflow for chat page only
  useEffect(() => {
    document.body.classList.add('chat-page-fixed');
    return () => {
      document.body.classList.remove('chat-page-fixed');
    };
  }, []);

  if (!currentChatId) {
    return (
      <AuthGuard>
        <div className="min-h-screen bg-background">
          <Navigation />
          <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
            <ChatSkeleton />
          </div>
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <Navigation />
      <div className="fixed inset-0 top-[110px] md:top-[104px] bg-background flex flex-col">
        <div className="flex flex-1 overflow-hidden relative min-h-0">
          {/* Mobile overlay */}
          {isMobile && isSidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-40 mt-16"
              onClick={() => setIsSidebarOpen(false)}
            />
          )}

          {/* Sidebar */}
          <div className={`
            ${isMobile 
              ? 'fixed inset-y-0 left-0 z-50 w-80 transform transition-transform duration-300'
              : 'relative w-64'
            }
            ${isMobile && !isSidebarOpen ? '-translate-x-full' : 'translate-x-0'}
            bg-background border-r overflow-y-auto
          `}>
            <ChatSidebar
              currentChatId={currentChatId}
              onChatSelect={handleChatSelect}
              onClose={() => setIsSidebarOpen(false)}
              isMobile={isMobile}
            />
          </div>

          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div className="flex-shrink-0 border-b p-2 md:p-3 flex items-center gap-2 md:gap-3">
              {isMobile && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSidebarOpen(true)}
                  className="shrink-0"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              )}
              <h1 className="text-lg md:text-xl font-semibold flex items-center gap-2 flex-1 truncate">
                <span>{currentChat?.icon || '💬'}</span>
                <span className="truncate">{currentChat?.title || 'Чат'}</span>
              </h1>
              <ConnectionIndicator />
            </div>

            {currentChat?.chat_type === 'homework_task' && currentChat.homework_task && (
              <div className="flex-shrink-0">
                <TaskContextBanner task={currentChat.homework_task} />
              </div>
            )}

            <div 
              ref={messagesContainerRef} 
              className="flex-1 overflow-y-auto overflow-x-hidden px-4"
              style={{ 
                WebkitOverflowScrolling: 'touch',
                overscrollBehavior: 'contain'
              }}
            >
              {loadingHistory ? (
                <ChatSkeleton />
              ) : (
                <>
                  {messages.map((msg, index) => (
                    <ChatMessage key={index} message={msg} isLoading={false} onQuickMessage={handleQuickMessage} />
                  ))}
                  {isLoading && <LoadingIndicator />}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            <ChatInput
              uploadedFile={uploadedFile}
              previewUrl={previewUrl}
              isLoading={isLoading}
              isMobile={isMobile}
              onSend={handleSend}
              onFileUpload={handleFileUpload}
              onPaste={handlePaste}
              onRemoveFile={removeUploadedFile}
            />
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
