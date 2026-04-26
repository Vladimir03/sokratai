import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import ChatMessage from "@/components/ChatMessage";
import { Button } from "@/components/ui/button";
import { Menu, ChevronDown, X, CreditCard } from "lucide-react";
import { PaymentModal } from "@/components/PaymentModal";
import { useVirtualizer } from '@tanstack/react-virtual';
import { useToast } from "@/hooks/use-toast";
import ChatSkeleton from "@/components/ChatSkeleton";
import LoadingIndicator from "@/components/LoadingIndicator";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import ConnectionIndicator from "@/components/ConnectionIndicator";
import { ChatSidebar } from "@/components/ChatSidebar";
import Navigation from "@/components/Navigation";
import AuthGuard from "@/components/AuthGuard";
import { useIsMobile, useDeviceType, isAndroid } from "@/hooks/use-mobile";
import ChatInput from "@/components/ChatInput";
import DevPanel from "@/components/DevPanel";
import { PageContent } from "@/components/PageContent";
import { saveChatToSessionCache, loadChatFromSessionCache, clearChatCache } from "@/utils/chatCache";
import { preloadPyodide } from "@/utils/pyodide";
import { haptics } from "@/utils/haptics";
import { useSubscription } from "@/hooks/useSubscription";
import { SubscriptionBanner, MessageLimitWarning, TrialExpiryReminder } from "@/components/SubscriptionBanner";
import DateSeparator, { formatDateLabel, isDifferentDay } from "@/components/DateSeparator";

type MessageStatus = 'sending' | 'sent' | 'ai_thinking' | 'delivered' | 'failed';

interface Message {
  role: "user" | "assistant";
  content: string;
  image_url?: string;
  image_path?: string; // File path in storage (persistent)
  id?: string;
  feedback?: 'like' | 'dislike' | null;
  input_method?: 'text' | 'voice' | 'button';
  status?: MessageStatus;
  created_at?: string; // ISO timestamp for message time display
}

const pluralizeDays = (days: number) => {
  const mod10 = days % 10;
  const mod100 = days % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showUploadHint, setShowUploadHint] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [touchStart, setTouchStart] = useState<{x: number, y: number} | null>(null);
  const [touchEnd, setTouchEnd] = useState<{x: number, y: number} | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [oldestMessageTimestamp, setOldestMessageTimestamp] = useState<string | null>(null);
  const [trialReminderDismissed, setTrialReminderDismissed] = useState(false);
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [floatingDate, setFloatingDate] = useState<string | null>(null);
  const [showFloatingDate, setShowFloatingDate] = useState(false);
  const lastScrollTopRef = useRef(0);
  const floatingDateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const MESSAGES_PER_PAGE = 15;
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
  const topSentinelRef = useRef<HTMLDivElement>(null); // Для определения скролла к началу чата
  const lastLoadTriggerScrollRef = useRef<number | null>(null); // Для hysteresis триггера загрузки истории
  
  // Refs для предотвращения пересоздания loadMoreMessages
  const hasMoreMessagesRef = useRef(hasMoreMessages);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const oldestTimestampRef = useRef<string | null>(oldestMessageTimestamp);
  
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const chatIdFromUrl = searchParams.get('id');
  const isMobile = useIsMobile();
  const deviceType = useDeviceType();
  
  // Обработка контекста из Practice (кнопка "Спроси Сократа")
  const practiceState = location.state as { 
    initialMessage?: string; 
    chatType?: string;
    problemContext?: { ege_number: number; topic: string; condition: string };
  } | null;
  const initialMessageFromPractice = practiceState?.initialMessage;
  const practiceMessageSentRef = useRef(false);
  const pendingPracticeMessageRef = useRef<string | null>(null);
  
  // Сохраняем сообщение из Practice для отправки после загрузки чата
  useEffect(() => {
    if (initialMessageFromPractice && !practiceMessageSentRef.current && !pendingPracticeMessageRef.current) {
      console.log('📚 Practice message received, queuing for send...');
      pendingPracticeMessageRef.current = initialMessageFromPractice;
      // НЕ очищаем state здесь - это делается после отправки в эффекте ниже
    }
  }, [initialMessageFromPractice]);

  // Предзагрузка Pyodide для быстрого рендеринга графиков
  useEffect(() => {
    // Загружаем Pyodide в фоне через 3 секунды после открытия чата
    const timer = setTimeout(() => {
      preloadPyodide();
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Функция для оценки размера сообщения на основе его контента
  const estimateMessageSize = useCallback((index: number) => {
    const msg = messages[index];
    if (!msg) return 200; // Default fallback
    
    let estimatedHeight = 80; // Base height (padding, margins)
    
    // Estimate based on content length
    const contentLength = msg.content?.length || 0;
    const estimatedLines = Math.ceil(contentLength / 80); // ~80 chars per line
    estimatedHeight += estimatedLines * 24; // ~24px per line
    
    // Add extra height for images
    if (msg.image_url) {
      estimatedHeight += 300; // Image height + margins
    }
    
    // Assistant messages tend to be longer
    if (msg.role === 'assistant') {
      estimatedHeight += 40; // Extra for action buttons
    }
    
    // Clamp between reasonable bounds
    return Math.min(Math.max(estimatedHeight, 100), 800);
  }, [messages]);

  // Виртуализация для длинных чатов
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: estimateMessageSize,
    overscan: 5,
    enabled: messages.length > 50,
    getItemKey: (index) => messages[index]?.id || `idx-${index}`,
  });

  const virtualizationEnabled = messages.length > 50;

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    }
  });

  // Resolve student display name for AI system prompt gender/name guidance.
  // Uses profiles.username; auto-generated placeholders (telegram_*, user_*) are excluded → null.
  const { data: studentDisplayName } = useQuery<string | null>({
    queryKey: ['user-profile-name', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .maybeSingle();
      const username = (data as any)?.username?.trim() ?? '';
      if (!username || /^(telegram_|user_)\d+$/i.test(username)) return null;
      return username;
    },
    enabled: Boolean(user?.id),
    staleTime: 10 * 60 * 1000, // 10 min — name changes rarely
  });

  // Subscription and message limits
  const subscription = useSubscription(user?.id);

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
          content: 'Привет! 👋 Я Сократ AI — твой AI-помощник по школьным предметам.\n\nЯ не просто даю готовые ответы. Я задаю вопросы-подсказки, чтобы ты сам понял, как решать задачи. Это помогает тебе учиться, а не просто списывать.\n\n📚 Что я умею:\n\n1. Объясняю сложные темы простым языком\n2. Помогаю разобраться с домашкой\n3. Показываю решения задач с помощью кнопки "Покажи решение"\n4. Даю подсказки с помощью кнопки "Дай подсказку"\n5. Даю подробные объяснения с помощью кнопки "Объясни подробнее"\n6. Генерирую похожие задачи для практики\n\n💡 Задай мне любой вопрос по математике, физике, информатике, химии, русскому или другому школьному предмету — и я помогу разобраться!'
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
      // КРИТИЧНО: Передаем location.state дальше, чтобы не потерять контекст из тренажёра
      navigate(`/chat?id=${generalChat.id}`, { replace: true, state: location.state });
    }
  }, [chatIdFromUrl, generalChat?.id, currentChatId, navigate, location.state]);

  // Fetch current chat details
  const { data: currentChat } = useQuery({
    queryKey: ['chat', currentChatId],
    queryFn: async () => {
      if (!currentChatId) return null;

      const { data, error } = await supabase
        .from('chats')
        .select('*')
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
      saveChatToSessionCache(previousChatIdRef.current, messages, user.id, hasMoreMessages, oldestMessageTimestamp);
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
    setHasMoreMessages(true);
    setOldestMessageTimestamp(null);
    
    const loadHistory = async () => {
      try {
        // Сначала попробовать загрузить из кеша для быстрого отображения
        const cachedData = loadChatFromSessionCache(currentChatId, user.id);
        if (cachedData && cachedData.messages.length > 0) {
          setMessages(cachedData.messages);
          setHasMoreMessages(cachedData.hasMoreMessages ?? true);
          setOldestMessageTimestamp(cachedData.oldestMessageTimestamp ?? null);
          console.log(`⚡ Quick load from cache: ${cachedData.messages.length} messages`);
        }
        
        // Затем загрузить только последние N сообщений из БД
        const { data, error } = await supabase
          .from('chat_messages')
          .select(`
            *,
            feedback:message_feedback(feedback_type)
          `)
          .eq('chat_id', currentChatId)
          .order('created_at', { ascending: false })
          .limit(MESSAGES_PER_PAGE);

        // Проверить, не была ли отменена загрузка
        if (abortController.signal.aborted) {
          console.log('⚠️ History load aborted, ignoring results');
          return;
        }

        if (error) {
          console.error('Error loading chat history:', error);
          if (!cachedData) {
            setMessages([]);
          }
          setLoadingHistory(false);
          return;
        }
        
        console.log('Raw data from database:', data);
        console.log('First message created_at:', data?.[0]?.created_at);
        
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
              feedback: (msg.feedback as any)?.[0]?.feedback_type || null,
              created_at: msg.created_at
            };
          }));
          
          // Reverse array to display oldest to newest
          const reversedMessages = loadedMessages.reverse();
          setMessages(reversedMessages);
          
          // Set pagination state - синхронизировать refs сразу
          const hasMore = data.length === MESSAGES_PER_PAGE;
          const oldestTs = data[data.length - 1].created_at;
          hasMoreMessagesRef.current = hasMore;
          oldestTimestampRef.current = oldestTs;
          setHasMoreMessages(hasMore);
          setOldestMessageTimestamp(oldestTs);
          
          // Initialize wasAtBottomRef to true for auto-scroll on first load
          wasAtBottomRef.current = true;
          
          // Обновить кеш с актуальными данными
          saveChatToSessionCache(currentChatId, reversedMessages, user.id, hasMore, data[data.length - 1].created_at);
          console.log(`✅ Loaded ${reversedMessages.length} messages for chat ${currentChatId}, hasMore: ${hasMore}`);
        } else {
          // If general chat is empty, add welcome message
          if (chatType === 'general') {
            console.log('📝 Adding welcome message to empty general chat');
            const { error: insertError } = await supabase.from('chat_messages').insert({
              chat_id: currentChatId,
              user_id: user.id,
              role: 'assistant',
              content: 'Привет! 👋 Я Сократ AI — твой AI-помощник по школьным предметам.\n\nЯ не просто даю готовые ответы. Я задаю вопросы-подсказки, чтобы ты сам понял, как решать задачи. Это помогает тебе учиться, а не просто списывать.\n\n📚 Что я умею:\n\n1. Объясняю сложные темы простым языком\n2. Помогаю разобраться с домашкой\n3. Показываю решения задач с помощью кнопки "Покажи решение"\n4. Даю подсказки с помощью кнопки "Дай подсказку"\n5. Даю подробные объяснения с помощью кнопки "Объясни подробнее"\n6. Генерирую похожие задачи для практики\n\n💡 Задай мне любой вопрос по математике, физике, информатике, химии, русскому или другому школьному предмету — и я помогу разобраться!'
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
                    feedback: (msg.feedback as any)?.[0]?.feedback_type || null,
                    created_at: msg.created_at
                  };
                  })); 
                setMessages(updatedMessages);
                saveChatToSessionCache(currentChatId, updatedMessages, user.id, false, null);
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

  // Load more messages when scrolling to top
  // Синхронизация refs с state для стабильности loadMoreMessages
  useEffect(() => {
    hasMoreMessagesRef.current = hasMoreMessages;
    isLoadingMoreRef.current = isLoadingMore;
    oldestTimestampRef.current = oldestMessageTimestamp;
  }, [hasMoreMessages, isLoadingMore, oldestMessageTimestamp]);

  // Диагностическое логирование пагинации
  useEffect(() => {
    console.log('📊 Pagination state:', {
      hasMoreMessages,
      isLoadingMore,
      oldestMessageTimestamp,
      messagesCount: messages.length,
      loadingHistory,
    });
  }, [hasMoreMessages, isLoadingMore, oldestMessageTimestamp, messages.length, loadingHistory]);

  const loadMoreMessages = useCallback(async () => {
    const oldestTimestamp = oldestTimestampRef.current;

    // Guard against parallel loads or missing state
    if (!user?.id || !currentChatId || !oldestTimestamp || isLoadingMoreRef.current || !hasMoreMessagesRef.current) {
      return;
    }

    const loadId = Date.now();
    console.log(`📜 [${loadId}] Loading more messages before:`, oldestTimestamp);

    // Single-flight lock before async work
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select(`
          *,
          feedback:message_feedback(feedback_type)
        `)
        .eq('chat_id', currentChatId)
        .lt('created_at', oldestTimestamp)
        .order('created_at', { ascending: false })
        .limit(MESSAGES_PER_PAGE);

      if (error) throw error;

      if (data && data.length > 0) {
        // Сохранить ОБЕ scroll метрики
        const scrollContainer = messagesContainerRef.current;
        const oldScrollHeight = scrollContainer?.scrollHeight || 0;
        const oldScrollTop = scrollContainer?.scrollTop || 0;

        // Generate signed URLs for images
        const newMessages = await Promise.all(data.map(async (msg: any) => {
          let imageUrl = undefined;
          
          if (msg.image_path) {
            const { data: signedData } = await supabase.storage
              .from('chat-images')
              .createSignedUrl(msg.image_path, 86400);

            if (signedData) {
              imageUrl = signedData.signedUrl;
            }
          } else if (msg.image_url) {
            try {
              const signMatch = msg.image_url.match(/\/sign\/chat-images\/(.+?)\?/);
              const publicMatch = msg.image_url.match(/\/public\/chat-images\/(.+)$/);
              const extractedPath = signMatch?.[1] || publicMatch?.[1];
              
              if (extractedPath) {
                const { data: signedData } = await supabase.storage
                  .from('chat-images')
                  .createSignedUrl(extractedPath, 86400);
                
                if (signedData) {
                  imageUrl = signedData.signedUrl;
                }
              } else if (msg.image_url.includes('/public/')) {
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
            feedback: (msg.feedback as any)?.[0]?.feedback_type || null,
            created_at: msg.created_at
          };
        }));

        // Reverse and prepend to existing messages
        const reversedNew = newMessages.reverse();
        setMessages(prev => [...reversedNew, ...prev]);
        
        // Обновить ref напрямую для следующего вызова
        const newTimestamp = data[data.length - 1].created_at;
        oldestTimestampRef.current = newTimestamp;
        setOldestMessageTimestamp(newTimestamp);
        
        console.log(`✅ [${loadId}] Loaded ${newMessages.length} messages (batch of ${MESSAGES_PER_PAGE})`);

        // Правильно восстановить scroll position
        requestAnimationFrame(() => {
          if (scrollContainer) {
            const attemptRestore = (pass: number) => {
              const measuredHeight = scrollContainer.scrollHeight;
              const virtualSize = rowVirtualizer.getTotalSize();
            const bestHeight = Math.max(measuredHeight, virtualSize, oldScrollHeight);
            const scrollDiff = Math.max(bestHeight - oldScrollHeight, 0);

            const needMoreData =
              bestHeight <= oldScrollHeight ||
              (messages.length > 50 && virtualSize === 0);

              if (needMoreData && pass < 4) {
                requestAnimationFrame(() => attemptRestore(pass + 1));
                return;
              }

            const restored = oldScrollTop + scrollDiff;
            const anchored = Math.max(restored, 0);
            scrollContainer.scrollTop = anchored;
            lastLoadTriggerScrollRef.current = anchored;
            console.log(`📍 [${loadId}] Scroll restored (pass ${pass}): bestHeight ${bestHeight}, diff ${scrollDiff}, anchored ${anchored}`);
            };

            attemptRestore(1);
          }
        });
      }

      // If less than page size, we've reached the beginning
      if (!data || data.length < MESSAGES_PER_PAGE) {
        hasMoreMessagesRef.current = false;
        setHasMoreMessages(false);
        console.log(`📌 [${loadId}] Reached beginning of chat history`);
      }
    } catch (error) {
      console.error('Error loading more messages:', error);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [user?.id, currentChatId, MESSAGES_PER_PAGE]); // Только стабильные зависимости!

  // Single scroll listener to trigger history load near top (Telegram-like) с hysteresis
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || loadingHistory) return;
    
    let scrollTimeout: NodeJS.Timeout;
    
    const handleScroll = () => {
      // Debounce для предотвращения множественных вызовов
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const { scrollTop, scrollHeight, clientHeight } = container;
        
        // Триггер когда пользователь в верхних 20% контента или scrollTop < 300px
        const scrollPercentage = scrollHeight > clientHeight 
          ? scrollTop / (scrollHeight - clientHeight) 
          : 1;

        // Hysteresis: требуем дополнительный подъём вверх от последнего триггера
        const lastTrigger = lastLoadTriggerScrollRef.current;
        const movedFurtherUp = lastTrigger === null || scrollTop < lastTrigger - 60;
        // Сброс hysteresis когда пользователь опустился достаточно вниз
        if (scrollTop > 800 && lastLoadTriggerScrollRef.current !== null) {
          lastLoadTriggerScrollRef.current = null;
        }
        
        // Используем refs для проверки условий
        if ((scrollTop < 300 || scrollPercentage < 0.2) && 
            hasMoreMessagesRef.current && 
            !isLoadingMoreRef.current &&
            movedFurtherUp) {
          console.log('🔄 Scroll trigger near top (debounced)', { scrollTop, scrollPercentage, movedFurtherUp });
          lastLoadTriggerScrollRef.current = scrollTop;
          loadMoreMessages();
        }
      }, 50); // Уменьшен debounce до 50ms для быстрого отклика
    };
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      clearTimeout(scrollTimeout);
      container.removeEventListener('scroll', handleScroll);
    };
  }, [loadMoreMessages, loadingHistory]); // Добавлен loadingHistory

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      haptics.warning();
      toast({
        title: "Ошибка",
        description: "Можно загружать только изображения",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      haptics.warning();
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
    
    // Haptic feedback при успешной загрузке файла
    haptics.success();
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

  const saveMessageToBatch = async (msg: Message): Promise<{ id: string; created_at: string } | null> => {
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
      }).select('id, created_at').single();

      if (error) throw error;

      // Update chat's last_message_at
      await supabase
        .from('chats')
        .update({
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', currentChatId);

      return data ? { id: data.id, created_at: data.created_at } : null;
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
  
  // Initial scroll to bottom when chat loads
  useEffect(() => {
    if (!loadingHistory && messages.length > 0) {
      requestAnimationFrame(() => {
        // Check if scroll position was restored
        const hasRestoredScroll = scrollPositionsRef.current.has(currentChatId);
        
        // Only scroll to bottom if no saved position
        if (!hasRestoredScroll) {
          scrollToBottom(false);
          console.log('⬇️ Auto-scrolled to bottom on chat open');
        }
      });
    }
  }, [loadingHistory, currentChatId]);

  // Retry механизм с экспоненциальным backoff для отправки сообщений
  async function streamChatWithRetry({
    messages,
    onDelta,
    onDone,
    taskContext,
    chatId,
    retries = 3,
  }: {
    messages: Message[];
    onDelta: (deltaText: string) => void;
    onDone: () => void;
    taskContext?: string;
    chatId?: string;
    retries?: number;
  }) {
    // HARDCODED proxy URL — see src/lib/supabaseClient.ts for rationale (RU bypass, ignore Lovable auto-env).
    const supabaseUrl = "https://api.sokratai.ru";
    const CHAT_URL = `${supabaseUrl}/functions/v1/chat`;

    for (let attempt = 0; attempt < retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.warn(`⏱️ Request timeout after 30s (attempt ${attempt + 1}/${retries})`);
        controller.abort();
      }, 30000); // 30 секунд таймаут

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          clearTimeout(timeoutId);
          toast({
            title: "Ошибка",
            description: "Требуется авторизация",
            variant: "destructive",
          });
          throw new Error("No session");
        }

        console.log(`📤 Sending message (attempt ${attempt + 1}/${retries})`);

        const resp = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ messages, taskContext, chatId, studentName: studentDisplayName ?? undefined }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Проверка статуса
        if (!resp.ok) {
          // Не retry для лимита запросов и баланса
          if (resp.status === 429) {
            // Check if it's a daily limit error
            try {
              const errorData = await resp.json();
              if (errorData.error === 'limit_reached') {
                throw new Error("LIMIT_REACHED");
              }
            } catch (e) {
              if (e instanceof Error && e.message === 'LIMIT_REACHED') throw e;
            }
            toast({
              title: "Ошибка",
              description: "Превышен лимит запросов. Попробуйте позже.",
              variant: "destructive",
            });
            throw new Error("Rate limit exceeded");
          } else if (resp.status === 402) {
            toast({
              title: "Ошибка",
              description: "Требуется пополнение баланса.",
              variant: "destructive",
            });
            throw new Error("Payment required");
          }

          // Retry на 5xx ошибках сервера
          if (resp.status >= 500 && attempt < retries - 1) {
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(`⚠️ Server error ${resp.status}, retrying in ${delay}ms...`);
            toast({
              title: "Проблема на сервере",
              description: `Повторяю попытку (${attempt + 1}/${retries})...`,
              duration: 2000,
            });
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          throw new Error(`HTTP ${resp.status}`);
        }

        if (!resp.body) {
          throw new Error("No response body");
        }

        // Успешный ответ - читаем stream
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

        console.log(`✅ Message sent successfully (attempt ${attempt + 1})`);
        onDone();
        return; // Успех - выходим из retry loop

      } catch (error: any) {
        clearTimeout(timeoutId);

        // Обработка AbortError (таймаут)
        if (error.name === 'AbortError') {
          if (attempt < retries - 1) {
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(`⏱️ Request timeout, retrying in ${delay}ms...`);
            toast({
              title: "Запрос занял слишком много времени",
              description: `Повторяю попытку (${attempt + 1}/${retries})...`,
              duration: 2000,
            });
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          console.error('❌ All retry attempts failed due to timeout');
          throw new Error("Превышен лимит времени ожидания. Попробуйте позже.");
        }

        // Обработка сетевых ошибок
        if (error.message.includes('fetch') || error.message.includes('network')) {
          if (attempt < retries - 1) {
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(`🌐 Network error, retrying in ${delay}ms...`);
            toast({
              title: "Проблема с интернетом",
              description: `Повторяю попытку (${attempt + 1}/${retries})...`,
              duration: 2000,
            });
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        // Последняя попытка провалилась
        if (attempt === retries - 1) {
          console.error('❌ All retry attempts failed:', error);
          throw error;
        }

        // Retry для других ошибок
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`⚠️ Error on attempt ${attempt + 1}, retrying in ${delay}ms:`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  const updateMessageStatus = useCallback((messageId: string, status: MessageStatus) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId ? { ...msg, status } : msg
    ));
  }, []);

  const handleSend = useCallback(async (message: string, inputMethod: 'text' | 'voice' | 'button' = 'text') => {
    if ((!message.trim() && !uploadedFile) || isLoading) return;
    
    // Check subscription limit
    if (subscription.limitReached) {
      toast({
        title: "Лимит исчерпан",
        description: "Вы использовали все сообщения на сегодня. Оформите подписку для безлимитного доступа!",
        variant: "destructive",
      });
      return;
    }
    
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
    
    // Haptic feedback при отправке сообщения
    haptics.impact();
    
    // Защита от множественных вызовов (iOS Safari bug)
    if (isSendingRef.current) {
      console.log('⚠️ Already sending, ignoring duplicate call');
      
      toast({
        title: "Подождите",
        description: "Сообщение уже отправляется...",
        duration: 1500,
        variant: "default"
      });
      
      return;
    }
    
    isSendingRef.current = true;
    console.log('🔒 Send flag set to true');

    // Таймаут для автоматического сброса флага отправки (защита от зависания)
    const sendTimeoutId = setTimeout(() => {
      if (isSendingRef.current) {
        console.warn('⏱️ Send timeout - resetting flag after 30 seconds');
        isSendingRef.current = false;
        toast({
          title: "Таймаут отправки",
          description: "Попробуйте отправить сообщение снова",
          variant: "destructive",
        });
      }
    }, 30000); // 30 секунд

    // Создаем optimistic message СРАЗУ после проверок (ДО загрузки изображения)
    const optimisticMessageId = `temp-${Date.now()}`;
    const optimisticMessage: Message = {
      id: optimisticMessageId,
      role: 'user',
      content: message.trim() || '[Изображение]',
      status: 'sending',
      input_method: inputMethod,
      created_at: new Date().toISOString(),
    };

    // Добавляем в UI сразу (оптимистичный UI)
    setMessages(prev => {
      const newMessages = [...prev, optimisticMessage];
      if (user?.id && currentChatId) {
        saveChatToSessionCache(currentChatId, newMessages, user.id, hasMoreMessages, oldestMessageTimestamp);
      }
      return newMessages;
    });

    console.log('📝 Optimistic message added:', optimisticMessageId);

    try {
      // Загрузка изображения (если есть)
      let imageUrl: string | undefined;
      let imageFileName: string | undefined;
      
      if (uploadedFile && user?.id) {
        const fileName = `${user.id}/${Date.now()}-${uploadedFile.name}`;
        
        const { data, error } = await supabase.storage
          .from('chat-images')
          .upload(fileName, uploadedFile);

        if (error) {
          console.error('Upload error:', error);
          throw new Error("Не удалось загрузить изображение");
        }

        // Save fileName for database, generate signed URL for display
        imageFileName = fileName;
        
        const { data: signedData, error: urlError } = await supabase.storage
          .from('chat-images')
          .createSignedUrl(fileName, 86400); // 24 hours

        if (urlError || !signedData) {
          console.error('Signed URL error:', urlError);
          throw new Error("Не удалось создать ссылку на файл");
        }

        imageUrl = signedData.signedUrl;
        
        // Обновляем optimistic message с изображением
        setMessages(prev => prev.map(msg => 
          msg.id === optimisticMessageId 
            ? { ...msg, content: message.trim() || '[Изображение]', image_url: imageUrl, image_path: imageFileName }
            : msg
        ));
      }

      removeUploadedFile();
      setIsLoading(true);

      // Сохраняем сообщение в БД
      const savedMessage = await saveMessageToBatch({
        role: 'user',
        content: message.trim() || '[Изображение]',
        image_url: imageUrl,
        image_path: imageFileName,
        input_method: inputMethod,
      });

      // Обновляем optimistic message с реальным ID, статусом 'sent' и created_at
      if (savedMessage) {
        setMessages(prev => {
          const updated = prev.map(msg => 
            msg.id === optimisticMessageId 
              ? { ...msg, id: savedMessage.id, status: 'sent' as MessageStatus, created_at: savedMessage.created_at }
              : msg
          );
          if (user?.id && currentChatId) {
            saveChatToSessionCache(currentChatId, updated, user.id, hasMoreMessages, oldestMessageTimestamp);
          }
          return updated;
        });
        console.log('✅ Message saved with ID:', savedMessage.id, 'created_at:', savedMessage.created_at);
      }

      // Обновляем статус на 'ai_thinking'
      const finalMessageId = savedMessage?.id || optimisticMessageId;
      updateMessageStatus(finalMessageId, 'ai_thinking');

      let assistantSoFar = "";
      
      const upsertAssistant = (nextChunk: string) => {
        assistantSoFar += nextChunk;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
          }
          return [...prev, { role: "assistant", content: assistantSoFar, created_at: new Date().toISOString() }];
        });
      };

      const taskContext = undefined;

      // Отправляем только последние 15 сообщений
      const messagesToSend = messages.slice(-15);

      await streamChatWithRetry({
        messages: [...messagesToSend, {
          role: "user" as const,
          content: message.trim() || '[Изображение]',
          image_url: imageUrl,
          image_path: imageFileName,
          input_method: inputMethod
        }],
        onDelta: (chunk) => upsertAssistant(chunk),
        onDone: () => {
          // Обновляем статус на 'delivered' когда все готово
          updateMessageStatus(finalMessageId, 'delivered');
          setIsLoading(false);
          queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
        },
        taskContext,
        chatId: currentChatId,
        retries: 3,
      });

      // Increment message counter for free users
      if (!subscription.isPremium) {
        subscription.incrementMessageCount();
      }

      // Сохраняем только если есть контент от ассистента
      if (assistantSoFar.trim()) {
        const finalAssistantMsg: Message = { role: "assistant", content: assistantSoFar, created_at: new Date().toISOString() };
        const savedAssistantMsg = await saveMessageToBatch(finalAssistantMsg);
        
        // Обновляем локальное сообщение ассистента с id и created_at из БД
        if (savedAssistantMsg) {
          setMessages(prev => {
            const updated = prev.map((m, i) => 
              (i === prev.length - 1 && m.role === 'assistant') 
                ? { ...m, id: savedAssistantMsg.id, created_at: savedAssistantMsg.created_at } 
                : m
            );
            // Обновляем кеш с полным диалогом
            if (user?.id && currentChatId) {
              saveChatToSessionCache(currentChatId, updated, user.id, hasMoreMessages, oldestMessageTimestamp);
            }
            return updated;
          });
        }
      }
    } catch (error) {
      console.error('❌ Error sending message:', error);
      
      // Handle daily limit reached
      if (error instanceof Error && error.message === 'LIMIT_REACHED') {
        subscription.setLimitReached(true);
        subscription.refresh();
      }
      
      // КРИТИЧНО: Обновляем статус на 'failed' чтобы показать кнопку повтора
      updateMessageStatus(optimisticMessageId, 'failed');
      
      isSendingRef.current = false;
      setIsLoading(false);
      
      // Haptic feedback при ошибке
      haptics.error();
      
      toast({
        title: "Ошибка",
        description: error instanceof Error && error.message === 'LIMIT_REACHED' 
          ? "Лимит сообщений на сегодня исчерпан" 
          : error instanceof Error ? error.message : "Не удалось отправить сообщение",
        variant: "destructive",
      });
      
      return; // Выходим из функции
    } finally {
      clearTimeout(sendTimeoutId);
      isSendingRef.current = false;
      console.log('🔓 Send flag reset to false');
    }
  }, [messages, uploadedFile, isLoading, loadingHistory, user?.id, removeUploadedFile, currentChat, currentChatId, queryClient, toast, updateMessageStatus, subscription]);

  const handleRetryMessage = useCallback((messageContent: string, inputMethod: 'text' | 'voice' | 'button' = 'text') => {
    // Haptic feedback при повторной попытке
    haptics.button();
    // Удалить failed сообщение
    setMessages(prev => prev.filter(msg => msg.status !== 'failed'));
    // Отправить заново
    handleSend(messageContent, inputMethod);
  }, [handleSend]);

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
    
    // Clear saved scroll position to ensure scroll to bottom
    scrollPositionsRef.current.delete(chatId);
    console.log(`🗑️ Cleared saved scroll for chat ${chatId} - will scroll to bottom`);
    
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
    setTouchStart({
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY
    });
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    setTouchEnd({
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY
    });
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchStart || !touchEnd) return;
    
    const horizontalDistance = touchStart.x - touchEnd.x;
    const verticalDistance = Math.abs(touchStart.y - touchEnd.y);
    
    // Increased threshold from 50px to 75px for more intentional swipe
    const isLeftSwipe = horizontalDistance > 75;
    // Only close if horizontal swipe is dominant (not vertical scroll)
    const isHorizontalSwipe = Math.abs(horizontalDistance) > verticalDistance * 2;
    
    if (isLeftSwipe && isHorizontalSwipe && isMobile && isSidebarOpen) {
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

  // Floating date on scroll up - Telegram style
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || messages.length === 0) return;
    
    let isCurrentlyShowing = false;
    
    const findFirstVisibleDate = (): string | null => {
      const messageElements = container.querySelectorAll('[data-message-index]');
      const containerRect = container.getBoundingClientRect();
      
      for (const element of messageElements) {
        const rect = element.getBoundingClientRect();
        // Check if element is visible in container viewport
        if (rect.top >= containerRect.top - 50 && rect.top <= containerRect.top + 100) {
          const messageIndex = parseInt(element.getAttribute('data-message-index') || '0', 10);
          const message = messages[messageIndex];
          if (message?.created_at) {
            return message.created_at;
          }
        }
      }
      return null;
    };
    
    const handleScrollForFloatingDate = () => {
      const { scrollTop } = container;
      const isScrollingUp = scrollTop < lastScrollTopRef.current - 5; // Add threshold to prevent jitter
      const isScrollingDown = scrollTop > lastScrollTopRef.current + 5;
      lastScrollTopRef.current = scrollTop;
      
      // Clear existing hide timeout on any scroll
      if (floatingDateTimeoutRef.current) {
        clearTimeout(floatingDateTimeoutRef.current);
      }
      
      // Show floating date when scrolling UP and not at the very top
      if (isScrollingUp && scrollTop > 100) {
        const firstVisibleDate = findFirstVisibleDate();
        
        if (firstVisibleDate) {
          // Only update date, avoid re-render if already showing
          setFloatingDate(firstVisibleDate);
          if (!isCurrentlyShowing) {
            isCurrentlyShowing = true;
            setShowFloatingDate(true);
          }
        }
      }
      
      // Always set timeout to hide after inactivity (2.5 seconds)
      floatingDateTimeoutRef.current = setTimeout(() => {
        isCurrentlyShowing = false;
        setShowFloatingDate(false);
      }, 2500);
    };
    
    container.addEventListener('scroll', handleScrollForFloatingDate, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScrollForFloatingDate);
      if (floatingDateTimeoutRef.current) {
        clearTimeout(floatingDateTimeoutRef.current);
      }
    };
  }, [messages]);

  // Автофокус на textarea после загрузки чата
  useEffect(() => {
    if (!loadingHistory && !isLoading && currentChatId) {
      const textareaElement = document.querySelector('textarea');
      if (textareaElement) {
        requestAnimationFrame(() => {
          textareaElement.focus();
        });
      }
    }
  }, [loadingHistory, isLoading, currentChatId]);

  // Автоматическая отправка сообщения из Practice ("Спроси Сократа")
  useEffect(() => {
    const pendingMessage = pendingPracticeMessageRef.current;
    
    console.log('📚 Practice effect check:', {
      pendingMessage: !!pendingMessage,
      sent: practiceMessageSentRef.current,
      loadingHistory,
      isLoading,
      currentChatId,
      userId: user?.id,
    });
    
    if (
      pendingMessage && 
      !practiceMessageSentRef.current && 
      !loadingHistory && 
      !isLoading && 
      currentChatId &&
      user?.id
    ) {
      console.log('📚 Sending practice context message NOW:', pendingMessage.slice(0, 100) + '...');
      practiceMessageSentRef.current = true;
      
      // Небольшая задержка для стабильности UI
      setTimeout(() => {
        const messageToSend = pendingPracticeMessageRef.current;
        pendingPracticeMessageRef.current = null;
        if (messageToSend) {
          handleSend(messageToSend, 'button');
          // Очищаем state из location после отправки
          window.history.replaceState({}, document.title);
        }
      }, 500);
    }
  }, [loadingHistory, isLoading, currentChatId, user?.id, handleSend]);

  if (!currentChatId) {
    return (
      <AuthGuard>
        <div className="min-h-screen bg-background">
          <Navigation />
          <div className="flex items-center justify-center h-[calc(100dvh-4rem)]">
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
        <div className="fixed inset-0 top-14 flex flex-col">
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
                ? 'fixed top-14 bottom-0 left-0 z-50 w-80 transform transition-transform duration-300'
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
                {/* Message counter / Trial badge for non-premium users - hide when limit reached to avoid duplicate with bottom banner */}
                {!subscription.isPremium && !subscription.isLoading && !subscription.limitReached && (
                  <SubscriptionBanner 
                    messagesUsed={subscription.messagesUsed}
                    dailyLimit={subscription.dailyLimit}
                    isPremium={subscription.isPremium}
                    limitReached={subscription.limitReached}
                    isTrialActive={subscription.isTrialActive}
                    trialDaysLeft={subscription.trialDaysLeft}
                    onOpenPayment={() => setIsPaymentModalOpen(true)}
                  />
                )}
                <ConnectionIndicator />
              </div>


              {/* Trial expiry reminder */}
              {subscription.isTrialActive && subscription.trialDaysLeft <= 2 && !trialReminderDismissed && (
                <TrialExpiryReminder 
                  trialDaysLeft={subscription.trialDaysLeft}
                  onDismiss={() => setTrialReminderDismissed(true)}
                  onOpenPayment={() => setIsPaymentModalOpen(true)}
                />
              )}

              <div 
                ref={messagesContainerRef} 
                className={`
                  flex-1 overflow-y-auto overflow-x-hidden px-4
                  ${isTransitioning ? 'opacity-0' : 'opacity-100'}
                `}
                style={{ 
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehavior: 'contain',
                  overscrollBehaviorY: 'contain',
                  // Use smooth scroll only on desktop for better mobile performance
                  scrollBehavior: isMobile ? 'auto' : 'smooth',
                  // Apply opacity transition only during chat transitions, not during scroll
                  transition: isTransitioning ? 'opacity 150ms ease-in-out' : 'none',
                  // Avoid transform on Android to prevent flicker, use it only on iOS
                  ...(deviceType === 'ios' ? { WebkitTransform: 'translate3d(0,0,0)' } : {}),
                  // Remove willChange on Android as it causes GPU layer issues
                  ...(deviceType !== 'android' ? { willChange: 'scroll-position' } : {})
                }}
              >
                {/* Floating date on scroll up - Telegram style - inside scroll container */}
                {floatingDate && (
                  <div 
                    className={`
                      sticky top-2 left-0 right-0 z-40 pointer-events-none flex justify-center
                      transition-all duration-300 ease-out
                      ${showFloatingDate ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}
                    `}
                  >
                    <div className="px-3 py-1.5 rounded-full bg-black/60 text-white text-xs font-medium backdrop-blur-sm shadow-lg">
                      {formatDateLabel(floatingDate)}
                    </div>
                  </div>
                )}
                
                {loadingHistory ? (
                  <ChatSkeleton />
                ) : (
                  <>
                    {/* Sentinel for infinite scroll */}
                    <div ref={topSentinelRef} className="h-4" />
                    
                    {/* Manual load more button as fallback */}
                    {hasMoreMessages && !isLoadingMore && (
                      <div className="flex justify-center py-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={loadMoreMessages}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          ↑ Загрузить предыдущие сообщения
                        </Button>
                      </div>
                    )}
                    
                    {/* Loading indicator for older messages */}
                    {isLoadingMore && (
                      <div className="flex justify-center py-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          Загрузка сообщений...
                        </div>
                      </div>
                    )}
                    
                    {/* Beginning of chat indicator */}
                    {!hasMoreMessages && messages.length > 0 && (
                      <div className="flex justify-center py-6">
                        <div className="text-sm text-muted-foreground">
                          📌 Начало переписки
                        </div>
                      </div>
                    )}
                    
                    {messages.length > 50 ? (
                      // Виртуализированный рендер для больших чатов
                      <div
                        className="virtualized-container"
                        style={{
                          height: `${rowVirtualizer.getTotalSize()}px`,
                          width: '100%',
                          position: 'relative',
                        }}
                      >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                          const msg = messages[virtualRow.index];
                          const prevMsg = virtualRow.index > 0 ? messages[virtualRow.index - 1] : null;
                          const showDateSeparator = virtualRow.index === 0 || isDifferentDay(prevMsg?.created_at, msg.created_at);
                          return (
                            <div
                              key={virtualRow.index}
                              data-index={virtualRow.index}
                              data-message-index={virtualRow.index}
                              ref={rowVirtualizer.measureElement}
                              className="virtualized-item"
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                // Use translate3d for GPU acceleration
                                transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                                // Prevent subpixel rendering issues
                                WebkitFontSmoothing: 'subpixel-antialiased',
                              }}
                            >
                              {showDateSeparator && msg.created_at && (
                                <DateSeparator date={msg.created_at} />
                              )}
                              <ChatMessage
                                key={msg.id || virtualRow.index}
                                message={msg}
                                isLoading={false}
                                onQuickMessage={handleQuickMessage}
                                onFeedback={handleMessageFeedback}
                                onInteraction={handleMessageInteraction}
                                onRetry={msg.status === 'failed' ? () => handleRetryMessage(msg.content || '[Изображение]', msg.input_method) : undefined}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      // Обычный рендер для маленьких чатов
                      messages.map((msg, index) => {
                        const prevMsg = index > 0 ? messages[index - 1] : null;
                        // Показываем разделитель для первого сообщения или если день изменился
                        const showDateSeparator = (index === 0 && msg.created_at) || isDifferentDay(prevMsg?.created_at, msg.created_at);
                        
                        return (
                          <div key={msg.id || index} data-message-index={index}>
                            {showDateSeparator && msg.created_at && (
                              <DateSeparator date={msg.created_at} />
                            )}
                            <ChatMessage 
                              message={msg} 
                              isLoading={false} 
                              onQuickMessage={handleQuickMessage}
                              onFeedback={handleMessageFeedback}
                              onInteraction={handleMessageInteraction}
                              onRetry={msg.status === 'failed' ? () => handleRetryMessage(msg.content || '[Изображение]', msg.input_method) : undefined}
                            />
                          </div>
                        );
                      })
                    )}
                    {isLoading && <LoadingIndicator />}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Scroll to bottom button - Telegram style - OUTSIDE scroll container */}
              {showScrollButton && (
                <button
                  onClick={() => {
                    haptics.tap();
                    scrollToBottom(true);
                  }}
                  className="fixed bottom-20 md:bottom-24 right-4 md:right-6 z-50 flex items-center justify-center w-11 h-11 md:w-12 md:h-12 bg-white border border-gray-300 rounded-full shadow-lg hover:bg-gray-50 active:scale-95 transition-all duration-200 animate-in fade-in zoom-in-90 slide-in-from-bottom-2"
                  aria-label="Прокрутить вниз"
                >
                  <ChevronDown className="w-5 h-5 md:w-6 md:h-6 text-gray-600" />
                </button>
              )}

              {/* Full subscription banner when limit is reached */}
              {subscription.limitReached && (
                <SubscriptionBanner 
                  messagesUsed={subscription.messagesUsed}
                  dailyLimit={subscription.dailyLimit}
                  isPremium={subscription.isPremium}
                  limitReached={subscription.limitReached}
                  showFull={true}
                  isTrialActive={subscription.isTrialActive}
                  trialDaysLeft={subscription.trialDaysLeft}
                  onOpenPayment={() => setIsPaymentModalOpen(true)}
                />
              )}

              {/* Trial status bar near input */}
              {subscription.isTrialActive && !subscription.limitReached && !trialBannerDismissed && (
                <div className="px-4 pb-3">
                  <div className="rounded-xl border bg-accent/5 text-foreground shadow-sm relative">
                    <button
                      onClick={() => setTrialBannerDismissed(true)}
                      className="absolute top-2 right-2 p-1 hover:bg-black/10 rounded-full transition-colors"
                      aria-label="Закрыть"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 py-3 pr-10">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-accent">
                          Бесплатный 7-дневный триал
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Осталось {subscription.trialDaysLeft} {pluralizeDays(subscription.trialDaysLeft)}. Подключи Premium за 699₽/мес, чтобы сохранить безлимит после триала.
                        </p>
                      </div>
                      <Button 
                        size="sm" 
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => setIsPaymentModalOpen(true)}
                      >
                        <CreditCard className="w-4 h-4 mr-2" />
                        Оформить Premium
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="relative">
                <ChatInput
                  fileInputRef={fileInputRef}
                  uploadedFile={uploadedFile}
                  previewUrl={previewUrl}
                  isLoading={isLoading || subscription.limitReached}
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
      
      {/* Payment Modal */}
      <PaymentModal 
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        onSuccess={() => {
          subscription.refresh();
        }}
      />
    </AuthGuard>
  );
}
