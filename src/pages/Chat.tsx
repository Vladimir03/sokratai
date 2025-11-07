import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ChatMessage from "@/components/ChatMessage";
import { Button } from "@/components/ui/button";
import { Menu, ChevronDown } from "lucide-react";
import { useVirtualizer } from '@tanstack/react-virtual';
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
import Onboarding from "@/components/Onboarding";
import DevPanel from "@/components/DevPanel";
import { subjectNames } from "@/data/onboardingTasks";
import { PageContent } from "@/components/PageContent";
import { saveChatToSessionCache, loadChatFromSessionCache, clearChatCache } from "@/utils/chatCache";

interface Message {
  role: "user" | "assistant";
  content: string;
  image_url?: string;
  image_path?: string; // File path in storage (persistent)
  id?: string;
  feedback?: 'like' | 'dislike' | null;
  input_method?: 'text' | 'voice' | 'button';
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showUploadHint, setShowUploadHint] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSendingRef = useRef(false); // Защита от дублирования отправки (iOS fix)
  const abortControllerRef = useRef<AbortController | null>(null); // Защита от race conditions
  const previousChatIdRef = useRef<string | null>(null); // Отслеживание предыдущего чата
  const scrollPositionsRef = useRef<Map<string, number>>(new Map()); // Сохранение scroll позиций
  const draftsRef = useRef<Map<string, string>>(new Map()); // Сохранение черновиков
  const blobUrlsRef = useRef<Set<string>>(new Set()); // Отслеживание blob URLs для cleanup
  const lastClickRef = useRef<number>(0); // Debounce для кликов
  const wasAtBottomRef = useRef(true); // Отслеживание позиции скролла для автоскролла
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const chatIdFromUrl = searchParams.get('id');
  const isMobile = useIsMobile();

  // Виртуализация для длинных чатов
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: () => 200,
    overscan: 5,
    enabled: messages.length > 50,
  });

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    }
  });

  // Ensure general chat exists - always use the FIRST created general chat
  const { data: generalChat, isLoading: isLoadingGeneralChat } = useQuery({
    queryKey: ['general-chat', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      // Find the FIRST created general chat (oldest one) to avoid duplicates
      const { data: existingChat, error } = await supabase
        .from('chats')
        .select('id')
        .eq('user_id', user.id)
        .eq('chat_type', 'general')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      // If chat exists, use it
      if (existingChat && !error) {
        console.log('✅ Found existing general chat:', existingChat.id);
        return existingChat;
      }

      // Only create new chat if genuinely doesn't exist (PGRST116 = no rows)
      if (error && error.code !== 'PGRST116') {
        console.error('Error finding general chat:', error);
        throw error;
      }

      // No general chat found - create new one for truly new user
      console.log('📝 Creating new general chat for new user');
      const { data: newChat, error: insertError } = await supabase
        .from('chats')
        .insert({
          user_id: user.id,
          chat_type: 'general',
          title: 'Общий чат',
          icon: '📚'
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Add welcome message only for truly new users
      if (newChat) {
        await supabase.from('chat_messages').insert({
          chat_id: newChat.id,
          user_id: user.id,
          role: 'assistant',
          content: 'Привет! 👋 Я Сократ — твой ИИ-помощник по математике, физике и информатике.\n\nЯ не просто даю готовые ответы. Я задаю вопросы-подсказки, чтобы ты сам понял, как решать задачи. Это помогает тебе учиться, а не просто списывать.\n\n📚 Что я умею:\n\n1. Объясняю сложные темы простым языком\n2. Помогаю разобраться с домашкой\n3. Показываю план решения задач с помощью кнопки "План решения"\n4. Даю подробные объяснения с помощью кнопки "Объясни подробнее"\n5. Генерирую похожие задачи для практики\n\n💡 Задай мне любой вопрос по математике, физике или информатике, и я помогу тебе разобраться!'
        });
        console.log('✅ Welcome message added for new user');
      }

      return newChat;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes to prevent duplicate queries
  });

  const currentChatId = chatIdFromUrl || generalChat?.id;

  // Redirect to general chat if no chat ID in URL and general chat is loaded
  useEffect(() => {
    if (!chatIdFromUrl && generalChat?.id && currentChatId !== generalChat.id) {
      console.log('Redirecting to general chat:', generalChat.id);
      navigate(`/chat?id=${generalChat.id}`, { replace: true });
    }
  }, [chatIdFromUrl, generalChat?.id, currentChatId, navigate]);

  // Check onboarding status
  useEffect(() => {
    if (!user?.id || !generalChat?.id) return;

    const checkOnboarding = async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('id', user.id)
        .single();

      if (!profile?.onboarding_completed) {
        setShowOnboarding(true);
      }
    };

    checkOnboarding();
  }, [user?.id, generalChat?.id]);

  // Handle onboarding completion
  const handleOnboardingComplete = async (
    grade: number,
    subject: string,
    goal: string,
    quickMessage?: string
  ) => {
    if (!user?.id || !generalChat?.id) return;

    // Update profile
    await supabase
      .from('profiles')
      .update({
        grade,
        difficult_subject: subject,
        learning_goal: goal,
        onboarding_completed: true
      })
      .eq('id', user.id);

    // Add welcome message from assistant
    const welcomeMessage = `Привет! 👋 Я Сократ — твой ИИ-помощник по математике, физике и информатике.

Я не просто даю готовые ответы. Я задаю наводящие вопросы, чтобы ты сам понял(а), как решать задачи. Это помогает тебе учиться, а не просто списывать.

📚 Что я умею:

1. Объясняю сложные темы простым языком
2. Помогаю разобраться с домашкой
3. Показываю план решения задач с помощью кнопки "План решения"
4. Даю подробные объяснения с помощью кнопки "Объясни подробнее"
5. Генерирую похожие задачи для практики

💡 ${quickMessage ? `Хочешь, чтобы я помог тебе разобраться с твоим вопросом "${quickMessage}"?` : 'Задай мне любой вопрос по математике, физике или информатике, и я помогу тебе разобраться!'}`;

    // Insert message into database
    const { data: insertedMessage } = await supabase.from('chat_messages').insert({
      chat_id: generalChat.id,
      user_id: user.id,
      role: 'assistant',
      content: welcomeMessage
    }).select().single();

    // Add message to local state immediately for instant display
    if (insertedMessage) {
      setMessages([{
        id: insertedMessage.id,
        role: 'assistant',
        content: welcomeMessage
      }]);
    }

    // Close onboarding after message is ready
    setShowOnboarding(false);

    // Show hint for upload button
    setTimeout(() => {
      setShowUploadHint(true);
      setTimeout(() => setShowUploadHint(false), 5000);
    }, 500);
  };

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

  const chatType = currentChat?.chat_type;

  // Load chat history whenever chat changes
  useEffect(() => {
    if (!user?.id || !currentChatId) {
    console.log('Skipping history load: no user or chatId', { userId: user?.id, currentChatId });
      setMessages([]);
      setLoadingHistory(false);
      return;
    }
    
    // Сохранить scroll position и сообщения предыдущего чата
    if (previousChatIdRef.current && messagesContainerRef.current) {
      const currentScroll = messagesContainerRef.current.scrollTop;
      if (currentScroll > 0) {
        scrollPositionsRef.current.set(previousChatIdRef.current, currentScroll);
        console.log(`💾 Saved scroll position ${currentScroll} for chat ${previousChatIdRef.current}`);
      }
    }
    
    // Сохранить сообщения предыдущего чата в кеш
    if (previousChatIdRef.current && previousChatIdRef.current !== currentChatId && messages.length > 0) {
      console.log(`💾 Saving ${messages.length} messages for previous chat ${previousChatIdRef.current}`);
      saveChatToSessionCache(previousChatIdRef.current, messages, user.id);
    }
    
    // Отменить предыдущую загрузку если она в процессе
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      console.log('⚠️ Aborted previous history load');
    }
    
    // Создать новый AbortController для этой загрузки
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    previousChatIdRef.current = currentChatId;
    
    console.log('Loading history for chat:', currentChatId);
    setIsTransitioning(true);
    setLoadingHistory(true);
    
    const loadHistory = async () => {
      try {
        // Сначала попробовать загрузить из кеша для быстрого отображения
        const cachedMessages = loadChatFromSessionCache(currentChatId, user.id);
        if (cachedMessages && cachedMessages.length > 0) {
          setMessages(cachedMessages);
          console.log(`⚡ Quick load from cache: ${cachedMessages.length} messages`);
        }
        
        // Затем загрузить актуальные данные из БД
        const { data, error } = await supabase
          .from('chat_messages')
          .select(`
            *,
            feedback:message_feedback(feedback_type)
          `)
          .eq('chat_id', currentChatId)
          .order('created_at', { ascending: true });

        // Проверить, не была ли отменена загрузка
        if (abortController.signal.aborted) {
          console.log('⚠️ History load aborted, ignoring results');
          return;
        }

        if (error) {
          console.error('Error loading chat history:', error);
          if (!cachedMessages) {
            setMessages([]);
          }
          setLoadingHistory(false);
          return;
        }
        
        console.log('Raw data from database:', data);
        
        if (data && data.length > 0) {
          // Generate fresh signed URLs for images
          const loadedMessages = await Promise.all(data.map(async (msg: any) => {
            let imageUrl = undefined;
            
            // Priority: generate fresh URL from image_path
            if (msg.image_path) {
              // New messages with file path - generate fresh signed URL
              const { data: signedData } = await supabase.storage
                .from('chat-images')
                .createSignedUrl(msg.image_path, 86400); // 24 hours

              if (signedData) {
                imageUrl = signedData.signedUrl;
              }
            } else if (msg.image_url) {
              // Old messages: extract path from expired URL and generate fresh signed URL
              try {
                // Extract path from signed URLs: .../sign/chat-images/USER_ID/FILE.jpg?token=...
                const signMatch = msg.image_url.match(/\/sign\/chat-images\/(.+?)\?/);
                // Extract path from public URLs: .../public/chat-images/USER_ID/FILE.jpg
                const publicMatch = msg.image_url.match(/\/public\/chat-images\/(.+)$/);
                
                const extractedPath = signMatch?.[1] || publicMatch?.[1];
                
                if (extractedPath) {
                  // Generate fresh signed URL for old messages
                  const { data: signedData } = await supabase.storage
                    .from('chat-images')
                    .createSignedUrl(extractedPath, 86400); // 24 hours
                  
                  if (signedData) {
                    imageUrl = signedData.signedUrl;
                  }
                } else if (msg.image_url.includes('/public/')) {
                  // Public URLs don't expire - use as is
                  imageUrl = msg.image_url;
                }
              } catch (error) {
                console.error('Failed to extract path from old image URL:', error);
              }
            }
            
            return {
              role: msg.role as "user" | "assistant",
              content: msg.content,
              image_url: imageUrl,
              image_path: msg.image_path || undefined,
              id: msg.id,
              feedback: (msg.feedback as any)?.[0]?.feedback_type || null
            };
          }));
          setMessages(loadedMessages);
          // Обновить кеш с актуальными данными
          saveChatToSessionCache(currentChatId, loadedMessages, user.id);
          console.log(`✅ Loaded ${loadedMessages.length} messages for chat ${currentChatId}`);
        } else {
          // If general chat is empty, add welcome message
          if (chatType === 'general') {
            console.log('📝 Adding welcome message to empty general chat');
            const { error: insertError } = await supabase.from('chat_messages').insert({
              chat_id: currentChatId,
              user_id: user.id,
              role: 'assistant',
              content: 'Привет! 👋 Я Сократ — твой ИИ-помощник по математике, физике и информатике.\n\nЯ не просто даю готовые ответы. Я задаю вопросы-подсказки, чтобы ты сам понял, как решать задачи. Это помогает тебе учиться, а не просто списывать.\n\n📚 Что я умею:\n\n1. Объясняю сложные темы простым языком\n2. Помогаю разобраться с домашкой\n3. Показываю план решения задач с помощью кнопки "План решения"\n4. Даю подробные объяснения с помощью кнопки "Объясни подробнее"\n5. Генерирую похожие задачи для практики\n\n💡 Задай мне любой вопрос по математике, физике или информатике, и я помогу тебе разобраться!'
            });
            
            if (!insertError) {
              // Reload messages after adding welcome message
              const { data: updatedData } = await supabase
                .from('chat_messages')
                .select(`
                  *,
                  feedback:message_feedback(feedback_type)
                `)
                .eq('chat_id', currentChatId)
                .order('created_at', { ascending: true });
              
              if (updatedData) {
                const updatedMessages = await Promise.all(updatedData.map(async (msg: any) => {
                  let imageUrl = undefined;
                  
                  // Priority: generate fresh URL from image_path
                  if (msg.image_path) {
                    const { data: signedData } = await supabase.storage
                      .from('chat-images')
                      .createSignedUrl(msg.image_path, 86400);
                    
                    if (signedData) {
                      imageUrl = signedData.signedUrl;
                    }
                  } else if (msg.image_url) {
                    // Old messages: extract path from expired URL and generate fresh signed URL
                    try {
                      // Extract path from signed URLs: .../sign/chat-images/USER_ID/FILE.jpg?token=...
                      const signMatch = msg.image_url.match(/\/sign\/chat-images\/(.+?)\?/);
                      // Extract path from public URLs: .../public/chat-images/USER_ID/FILE.jpg
                      const publicMatch = msg.image_url.match(/\/public\/chat-images\/(.+)$/);
                      
                      const extractedPath = signMatch?.[1] || publicMatch?.[1];
                      
                      if (extractedPath) {
                        // Generate fresh signed URL for old messages
                        const { data: signedData } = await supabase.storage
                          .from('chat-images')
                          .createSignedUrl(extractedPath, 86400); // 24 hours
                        
                        if (signedData) {
                          imageUrl = signedData.signedUrl;
                        }
                      } else if (msg.image_url.includes('/public/')) {
                        // Public URLs don't expire - use as is
                        imageUrl = msg.image_url;
                      }
                    } catch (error) {
                      console.error('Failed to extract path from old image URL:', error);
                    }
                  }
                  
                  return {
                    role: msg.role as "user" | "assistant",
                    content: msg.content,
                    image_url: imageUrl,
                    image_path: msg.image_path || undefined,
                    id: msg.id,
                    feedback: (msg.feedback as any)?.[0]?.feedback_type || null
                  };
                }));
                setMessages(updatedMessages);
                saveChatToSessionCache(currentChatId, updatedMessages, user.id);
                console.log('✅ Welcome message added and loaded');
              }
            }
          } else {
            setMessages([]);
            console.log(`⚠️ No messages found for chat ${currentChatId}`);
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          console.log('⚠️ History load aborted due to error');
          return;
        }
        console.error('❌ Error loading chat history:', error);
        setMessages([]);
      } finally {
        if (!abortController.signal.aborted) {
          setLoadingHistory(false);
          // Восстановить scroll position для нового чата
          if (messagesContainerRef.current) {
            const savedScroll = scrollPositionsRef.current.get(currentChatId);
            if (savedScroll !== undefined && savedScroll > 0) {
              requestAnimationFrame(() => {
                if (messagesContainerRef.current) {
                  messagesContainerRef.current.scrollTop = savedScroll;
                  console.log(`⚡ Restored scroll position ${savedScroll} for chat ${currentChatId}`);
                }
              });
            }
          }
          // Плавное появление сообщений
          setTimeout(() => setIsTransitioning(false), 150);
          console.log('History loading complete. loadingHistory set to false');
        }
      }
    };

    loadHistory();
    
    // Cleanup function
    return () => {
      if (abortController === abortControllerRef.current) {
        abortControllerRef.current = null;
      }
    };
  }, [user?.id, currentChatId, chatType]);

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
    const newPreviewUrl = URL.createObjectURL(file);
    blobUrlsRef.current.add(newPreviewUrl);
    setPreviewUrl(newPreviewUrl);
  }, [toast]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          setUploadedFile(file);
          const newPreviewUrl = URL.createObjectURL(file);
          blobUrlsRef.current.add(newPreviewUrl);
          setPreviewUrl(newPreviewUrl);
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
      blobUrlsRef.current.delete(previewUrl);
    }
    setUploadedFile(null);
    setPreviewUrl(null);
    
    // Reset input value to allow re-uploading the same file
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [previewUrl]);

  // Cleanup blob URLs при unmount
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      blobUrlsRef.current.clear();
      console.log('🧹 Cleaned up all blob URLs');
    };
  }, []);

  const saveMessageToBatch = async (msg: Message): Promise<string | null> => {
    if (!user?.id || !currentChatId) {
      console.error('❌ Cannot save message: missing user or chatId', { 
        userId: user?.id, 
        currentChatId 
      });
      throw new Error('Чат ещё не загружен. Попробуйте снова через секунду.');
    }

    try {
      const { data, error } = await supabase.from('chat_messages').insert({
        chat_id: currentChatId,
        user_id: user.id,
        role: msg.role,
        content: msg.content,
        image_path: msg.image_path, // Save file path instead of URL
        input_method: msg.input_method || 'text'
      }).select('id').single();

      if (error) throw error;

      // Update chat's last_message_at
      await supabase
        .from('chats')
        .update({
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', currentChatId);

      return data?.id || null;
    } catch (error) {
      console.error('❌ Error saving message:', error);
      throw error;
    }
  };

  const scrollToBottom = (smooth = true) => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  // Auto-scroll when messages change - ONLY if user was already at bottom
  useEffect(() => {
    // Only auto-scroll if user was at the bottom before new messages arrived
    if (wasAtBottomRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
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

  const handleSend = useCallback(async (message: string, inputMethod: 'text' | 'voice' | 'button' = 'text') => {
    if ((!message.trim() && !uploadedFile) || isLoading) return;
    
    // Проверка что чат загружен
    if (!currentChatId || loadingHistory) {
      toast({
        title: "Подождите",
        description: "Чат ещё загружается...",
        duration: 2000,
        variant: "default"
      });
      return;
    }
    
    // Защита от множественных вызовов (iOS Safari bug)
    if (isSendingRef.current) {
      console.log('Already sending, ignoring duplicate call');
      
      toast({
        title: "Подождите",
        description: "Сообщение уже отправляется...",
        duration: 1500,
        variant: "default"
      });
      
      return;
    }
    
    isSendingRef.current = true;

    let imageUrl: string | undefined = undefined;
    let imageFileName: string | undefined = undefined;

    // Upload image if exists
    if (uploadedFile && user?.id) {
      const fileName = `${user.id}/${Date.now()}-${uploadedFile.name}`;
      
      const { data, error } = await supabase.storage
        .from('chat-images')
        .upload(fileName, uploadedFile);

      if (error) {
        isSendingRef.current = false; // Reset on error
        toast({
          title: "Ошибка",
          description: "Не удалось загрузить изображение",
          variant: "destructive",
        });
        console.error('Upload error:', error);
        return;
      }

      // Save fileName for database, generate signed URL for display
      imageFileName = fileName;
      
      const { data: signedData, error: urlError } = await supabase.storage
        .from('chat-images')
        .createSignedUrl(fileName, 86400); // 24 hours

      if (urlError || !signedData) {
        isSendingRef.current = false;
        toast({
          title: "Ошибка",
          description: "Не удалось создать ссылку на файл",
          variant: "destructive",
        });
        console.error('Signed URL error:', urlError);
        return;
      }

      imageUrl = signedData.signedUrl;
    }

    const userMessage: Message = { 
      role: "user", 
      content: message.trim() || '[Изображение]',
      image_url: imageUrl,
      image_path: imageFileName, // Save file path for database
      input_method: inputMethod
    };
    
    // Используем функциональное обновление состояния
    setMessages(prev => {
      const newMessages = [...prev, userMessage];
      // Сохраняем в кеш сразу
      if (user?.id && currentChatId) {
        saveChatToSessionCache(currentChatId, newMessages, user.id);
      }
      return newMessages;
    });
    removeUploadedFile();
    setIsLoading(true);

    try {
      // Сохраняем сообщение пользователя и получаем id из БД
      const userMessageId = await saveMessageToBatch(userMessage);
      
      // Обновляем локальное сообщение с id из БД
      if (userMessageId) {
        setMessages(prev => {
          const updated = prev.map((m, i) => 
            i === prev.length - 1 ? { ...m, id: userMessageId } : m
          );
          // Обновляем кеш
          if (user?.id && currentChatId) {
            saveChatToSessionCache(currentChatId, updated, user.id);
          }
          return updated;
        });
      }
    } catch (error) {
      console.error('Failed to save user message:', error);
      isSendingRef.current = false;
      setIsLoading(false);
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось отправить сообщение",
        variant: "destructive",
      });
      return;
    }

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
      // Отправляем taskContext только в первом сообщении
      const taskContext = (currentChat?.homework_task && messages.length === 0)
        ? `Задача №${currentChat.homework_task.task_number}. Тема: ${currentChat.homework_task.homework_set?.topic}. Условие: ${currentChat.homework_task.condition_text}`
        : undefined;

      // Отправляем только последние 15 сообщений
      const allMessages = [...messages, userMessage];
      const messagesToSend = allMessages.slice(-15);

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
        const assistantMessageId = await saveMessageToBatch(finalAssistantMsg);
        
        // Обновляем локальное сообщение ассистента с id из БД
        if (assistantMessageId) {
          setMessages(prev => {
            const updated = prev.map((m, i) => 
              (i === prev.length - 1 && m.role === 'assistant') ? { ...m, id: assistantMessageId } : m
            );
            // Обновляем кеш с полным диалогом
            if (user?.id && currentChatId) {
              saveChatToSessionCache(currentChatId, updated, user.id);
            }
            return updated;
          });
        }
      }
    } catch (error) {
      console.error(error);
      setIsLoading(false);
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось отправить сообщение",
        variant: "destructive",
      });
    } finally {
      // Всегда сбрасываем флаг отправки
      isSendingRef.current = false;
    }
  }, [messages, uploadedFile, isLoading, loadingHistory, user?.id, removeUploadedFile, currentChat, currentChatId, queryClient, toast]);

  const handleQuickMessage = useCallback((quickText: string) => {
    handleSend(quickText, 'button');
  }, [handleSend]);

  const handleMessageFeedback = useCallback(async (messageId: string, feedbackType: 'like' | 'dislike' | null) => {
    if (!user?.id) return;

    try {
      if (!feedbackType) {
        // Удалить фидбек
        await supabase
          .from('message_feedback')
          .delete()
          .eq('message_id', messageId)
          .eq('user_id', user.id);
      } else {
        // Upsert фидбек
        await supabase
          .from('message_feedback')
          .upsert({
            message_id: messageId,
            user_id: user.id,
            feedback_type: feedbackType
          }, {
            onConflict: 'message_id,user_id'
          });
      }
      
      // Обновить локальный state
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, feedback: feedbackType } : msg
      ));
    } catch (error) {
      console.error('Error updating feedback:', error);
    }
  }, [user?.id]);

  const handleMessageInteraction = useCallback(async (
    messageId: string,
    interactionType: 'copy' | 'view' | 'share'
  ) => {
    if (!user?.id) return;

    try {
      // Проверяем, существует ли запись
      const { data: existing } = await supabase
        .from('message_interactions')
        .select('id, interaction_count')
        .eq('message_id', messageId)
        .eq('user_id', user.id)
        .eq('interaction_type', interactionType)
        .maybeSingle();

      if (existing) {
        // Если запись есть - увеличиваем счётчик
        await supabase
          .from('message_interactions')
          .update({ 
            interaction_count: existing.interaction_count + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        // Если записи нет - создаём новую
        await supabase
          .from('message_interactions')
          .insert({
            message_id: messageId,
            user_id: user.id,
            interaction_type: interactionType,
            interaction_count: 1
          });
      }
    } catch (error) {
      console.error('Error logging interaction:', error);
      // Не показываем ошибку пользователю - это фоновое логирование
    }
  }, [user?.id]);

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
    // Debounce protection
    const now = Date.now();
    if (now - lastClickRef.current < 300) {
      console.log('⚠️ Chat select ignored (debounce)');
      return;
    }
    lastClickRef.current = now;
    
    // Don't navigate to temp chats
    if (chatId.startsWith('temp-')) {
      return;
    }
    
    // iOS fix - cleanup before navigation
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.pointerEvents = '';
    
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

  // iOS Safari fix - prevent scroll freeze
  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    if (isIOS) {
      const preventScrollFreeze = () => {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.pointerEvents = '';
      };
      
      // Initial cleanup
      preventScrollFreeze();
      
      // Handle navigation events
      window.addEventListener('popstate', preventScrollFreeze);
      
      // Handle visibility changes
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          preventScrollFreeze();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      return () => {
        window.removeEventListener('popstate', preventScrollFreeze);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        preventScrollFreeze();
      };
    }
  }, []);

  // Handler для изменения draft
  const handleDraftChange = useCallback((chatId: string, text: string) => {
    draftsRef.current.set(chatId, text);
  }, []);

  // Получить текущий draft
  const currentDraft = currentChatId ? (draftsRef.current.get(currentChatId) || '') : '';

  // Touch handlers для swipe gesture (закрытие сайдбара)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    
    if (isLeftSwipe && isMobile && isSidebarOpen) {
      setIsSidebarOpen(false);
      console.log('👈 Sidebar closed by swipe');
    }
    
    setTouchStart(null);
    setTouchEnd(null);
  }, [touchStart, touchEnd, isMobile, isSidebarOpen]);

  // Блокировка body scroll при открытом sidebar на мобильных
  useEffect(() => {
    if (isMobile && isSidebarOpen) {
      const scrollY = window.scrollY;
      
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
      
      console.log('🔒 Body scroll locked (sidebar open)');
      
      return () => {
        const scrollYToRestore = document.body.style.top;
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.body.style.top = '';
        
        if (scrollYToRestore) {
          window.scrollTo(0, parseInt(scrollYToRestore || '0') * -1);
        }
        
        console.log('🔓 Body scroll restored');
      };
    }
  }, [isMobile, isSidebarOpen]);

  // Scroll listener для кнопки "scroll to bottom" - Telegram style
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    let timeoutId: NodeJS.Timeout;
    
    const handleScroll = () => {
      // Debounce для оптимизации
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const { scrollTop, scrollHeight, clientHeight } = container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        const isNearBottom = distanceFromBottom < 300;
        
        // Сохраняем состояние "внизу ли пользователь" для автоскролла
        wasAtBottomRef.current = isNearBottom;
        
        // Показать кнопку только если:
        // 1. Пользователь прокрутил вверх (не у самого низа)
        // 2. Есть сообщения для прокрутки
        setShowScrollButton(!isNearBottom && messages.length > 3);
      }, 50);
    };
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
    };
  }, [messages.length]);

  // Автофокус на textarea после загрузки чата
  useEffect(() => {
    if (!loadingHistory && !isLoading && currentChatId) {
      const textareaElement = document.querySelector('textarea');
      if (textareaElement && !showOnboarding) {
        requestAnimationFrame(() => {
          textareaElement.focus();
        });
      }
    }
  }, [loadingHistory, isLoading, currentChatId, showOnboarding]);

  // Show onboarding if needed
  if (showOnboarding && user?.id) {
    return (
      <AuthGuard>
        <div className="min-h-screen bg-background">
          <Navigation />
          <Onboarding
            userId={user.id}
            onComplete={handleOnboardingComplete}
          />
        </div>
      </AuthGuard>
    );
  }

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
      <div className="min-h-screen bg-background">
        <Navigation />
        
        {user?.id && (
          <DevPanel 
            userId={user.id} 
            onReset={() => window.location.reload()} 
          />
        )}
        
        {/* Chat container with proper offset for fixed navigation */}
        <div className="fixed inset-0 top-[110px] md:top-[104px] flex flex-col">
          <div className="flex flex-1 overflow-hidden relative min-h-0">
            {/* Mobile overlay */}
            {isMobile && isSidebarOpen && (
              <div
                className="fixed inset-0 bg-black/50 z-40"
                onClick={() => setIsSidebarOpen(false)}
              />
            )}

            {/* Sidebar */}
            <div 
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              className={`
              ${isMobile 
                ? 'fixed top-[110px] bottom-0 left-0 z-50 w-80 transform transition-transform duration-300'
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

            <div className="relative flex-1 flex flex-col overflow-hidden min-w-0">
              <div className="flex-shrink-0 border-b p-2 md:p-3 flex items-center gap-2 md:gap-3 bg-background">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className="shrink-0 md:hidden"
                >
                  <Menu className="h-5 w-5" />
                </Button>
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
                className={`
                  flex-1 overflow-y-auto overflow-x-hidden px-4
                  transition-opacity duration-150
                  ${isTransitioning ? 'opacity-0' : 'opacity-100'}
                `}
                style={{ 
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehavior: 'contain',
                  transform: 'translateZ(0)',
                  willChange: 'scroll-position'
                }}
              >
                {loadingHistory ? (
                  <ChatSkeleton />
                ) : (
                  <>
                    {messages.length > 50 ? (
                      // Виртуализированный рендер для больших чатов
                      <div
                        style={{
                          height: `${rowVirtualizer.getTotalSize()}px`,
                          width: '100%',
                          position: 'relative',
                        }}
                      >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                          const msg = messages[virtualRow.index];
                          const prevMsg = virtualRow.index > 0 ? messages[virtualRow.index - 1] : null;
                          return (
                            <div
                              key={virtualRow.index}
                              data-index={virtualRow.index}
                              ref={rowVirtualizer.measureElement}
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualRow.start}px)`,
                              }}
                            >
                              <ChatMessage
                                key={msg.id || virtualRow.index}
                                message={msg}
                                isLoading={false}
                                onQuickMessage={handleQuickMessage}
                                onFeedback={handleMessageFeedback}
                                onInteraction={handleMessageInteraction}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      // Обычный рендер для маленьких чатов
                      messages.map((msg, index) => (
                        <ChatMessage 
                          key={msg.id || index} 
                          message={msg} 
                          isLoading={false} 
                          onQuickMessage={handleQuickMessage}
                          onFeedback={handleMessageFeedback}
                          onInteraction={handleMessageInteraction}
                        />
                      ))
                    )}
                    {isLoading && <LoadingIndicator />}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Scroll to bottom button - Telegram style - OUTSIDE scroll container */}
              {showScrollButton && (
                <button
                  onClick={() => scrollToBottom(true)}
                  className="
                    fixed bottom-20 md:bottom-24 right-4 md:right-6 z-50
                    flex items-center justify-center
                    w-10 h-10 md:w-12 md:h-12
                    bg-white
                    border border-gray-300
                    rounded-full
                    shadow-lg
                    hover:bg-gray-50
                    active:scale-95
                    transition-all
                    duration-200
                    animate-fade-in
                  "
                  aria-label="Прокрутить вниз"
                >
                  <ChevronDown className="w-5 h-5 md:w-6 md:h-6 text-gray-600" />
                </button>
              )}

              <div className="relative">
                <ChatInput
                  fileInputRef={fileInputRef}
                  uploadedFile={uploadedFile}
                  previewUrl={previewUrl}
                  isLoading={isLoading}
                  isMobile={isMobile}
                  onSend={handleSend}
                  onFileUpload={handleFileUpload}
                  onPaste={handlePaste}
                  onRemoveFile={removeUploadedFile}
                  value={currentDraft}
                  onValueChange={(value) => currentChatId && handleDraftChange(currentChatId, value)}
                />
                
                {/* Upload hint */}
                {showUploadHint && (
                  <div className="absolute bottom-20 left-4 animate-bounce z-50">
                    <div className="bg-accent text-accent-foreground px-3 py-2 rounded-lg text-sm shadow-lg">
                      👇 Нажми сюда, чтобы загрузить фото!
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
