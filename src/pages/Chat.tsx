import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ChatMessage from "@/components/ChatMessage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Image as ImageIcon, X, Menu } from "lucide-react";
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
import { sendToOpenRouter, buildSystemPrompt } from "@/lib/openrouter";

interface Message {
  role: "user" | "assistant";
  content: string;
  image_url?: string;
}

export default function Chat() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const chatIdFromUrl = searchParams.get('id');
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
  };

  const removeUploadedFile = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setUploadedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
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
    
    setMessages(prev => [...prev, userMessage]);
    setMessage("");
    removeUploadedFile();
    setIsLoading(true);

    await saveMessageToBatch(userMessage);

    try {
      // Build context for task if needed
      let taskContext = '';
      if (currentChat?.chat_type === 'homework_task' && currentChat.homework_task) {
        const task = currentChat.homework_task;
        taskContext = `Предмет: ${task.homework_set?.subject}
Тема: ${task.homework_set?.topic}
Номер задачи: ${task.task_number}

Условие задачи:
${task.condition_text || '[Фото условия доступно пользователю]'}

AI Анализ:
Тип: ${(task.ai_analysis as any)?.type || 'не определен'}
План решения: ${(task.ai_analysis as any)?.solution_steps?.join(', ') || 'не определен'}

Пользователь работает над этой конкретной задачей из домашнего задания.
Помоги ему решить её, используя Сократовский метод - не давай готовый ответ, 
а задавай наводящие вопросы и направляй к решению.`;
      }

      // Build system prompt
      const systemPrompt = buildSystemPrompt(
        (currentChat?.chat_type as 'general' | 'homework_task') || 'general',
        taskContext
      );

      // Format messages for edge function
      const apiMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        image_url: msg.image_url
      }));

      // Add user message
      apiMessages.push({
        role: 'user',
        content: userMessage.content,
        image_url: imageUrl || undefined
      });

      // Call edge function with streaming
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: apiMessages,
          systemPrompt: systemPrompt.content
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Ошибка вызова API');
      }

      if (!response.body) throw new Error('No response body');

      // Stream response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantContent += content;
              // Update last message or create new one
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { ...last, content: assistantContent }];
                }
                return [...prev, { role: 'assistant', content: assistantContent }];
              });
            }
          } catch (e) {
            // Incomplete JSON, put it back
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Save final assistant message
      if (assistantContent) {
        const assistantMessage: Message = {
          role: "assistant",
          content: assistantContent
        };
        await saveMessageToBatch(assistantMessage);
      }
      
      setIsLoading(false);
      queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
    } catch (error) {
      console.error(error);
      setIsLoading(false);
      toast({
        title: "Ошибка",
        description: "Не удалось отправить сообщение",
        variant: "destructive",
      });
    }
  };

  // Auto-start conversation with task context
  useEffect(() => {
    if (!currentChat?.homework_task || messages.length > 0 || loadingHistory) return;

    const generateWelcomeMessage = (task: any) => {
      const subject = task.homework_set?.subject || 'предмету';
      const topic = task.homework_set?.topic || '';
      const taskNumber = task.task_number;
      const condition = task.condition_text || 'условие доступно выше';
      const taskType = task.ai_analysis?.type || '';

      return `Привет! Вижу, ты работаешь над задачей ${taskNumber} из темы "${topic}" по ${subject}.

Условие: ${condition}

${taskType ? `Это ${taskType}.` : ''}

С чего начнём? Какие у тебя есть идеи по решению?`;
    };

    const firstMessage: Message = {
      role: 'assistant',
      content: generateWelcomeMessage(currentChat.homework_task)
    };

    setMessages([firstMessage]);
    saveMessageToBatch(firstMessage);
  }, [currentChat?.homework_task, messages.length, loadingHistory]);

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
      <div className="fixed inset-0 pt-16 pb-16 md:pb-0 overflow-hidden bg-background">
        <div className="flex h-full overflow-hidden relative">
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
            <div className="flex-shrink-0 border-b p-3 md:p-4 flex items-center gap-2 md:gap-3">
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

            <div className="flex-1 overflow-y-auto overflow-x-hidden px-4">
              {loadingHistory ? (
                <ChatSkeleton />
              ) : (
                <>
                  {messages.map((msg, index) => (
                    <ChatMessage key={index} message={msg} isLoading={false} onQuickMessage={() => {}} />
                  ))}
                  {isLoading && <LoadingIndicator />}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            <div className="flex-shrink-0 border-t p-3 md:p-4 bg-background">
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
                      onClick={removeUploadedFile}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-6 h-6 flex items-center justify-center hover:bg-destructive/90 transition-colors"
                      title="Удалить"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {/* Input area */}
                <div className="flex items-end gap-1 md:gap-2">
                  {/* File upload button */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    id="file-upload"
                    accept="image/*"
                    onChange={handleFileUpload}
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
                    onPaste={handlePaste}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={isMobile ? "Напиши вопрос..." : "Напиши свой вопрос или вставь скриншот (Ctrl+V)..."}
                    className="min-h-[48px] md:min-h-[60px] resize-none text-sm md:text-base"
                    disabled={isLoading}
                  />

                  {/* Send button */}
                  <Button
                    onClick={handleSend}
                    disabled={(!message.trim() && !uploadedFile) || isLoading}
                    size="icon"
                    className="h-12 w-12 md:h-[60px] md:w-[60px] shrink-0"
                  >
                    <Send className="h-4 w-4 md:h-5 md:w-5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
