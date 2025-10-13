import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ChatMessage from "@/components/ChatMessage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ChatSkeleton from "@/components/ChatSkeleton";
import { useSearchParams, useNavigate } from "react-router-dom";
import ConnectionIndicator from "@/components/ConnectionIndicator";
import { ChatSidebar } from "@/components/ChatSidebar";
import { TaskContextBanner } from "@/components/TaskContextBanner";

const SYSTEM_PROMPT = "Ты опытный репетитор по математике для подготовки к ЕГЭ. Используй Сократовский метод - задавай наводящие вопросы вместо прямых ответов.";

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
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const chatIdFromUrl = searchParams.get('id');

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

  useEffect(() => {
    if (user?.id && currentChatId) {
      loadChatHistory();
    }
  }, [user?.id, currentChatId]);

  const loadChatHistory = async () => {
    if (!user?.id || !currentChatId) return;
    
    setLoadingHistory(true);
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
          image_url: msg.image_url
        })));
      } else {
        setMessages([]);
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
    } finally {
      setLoadingHistory(false);
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

  async function streamChat({
    messages,
    systemPrompt,
    onDelta,
    onDone,
  }: {
    messages: Message[];
    systemPrompt: string;
    onDelta: (deltaText: string) => void;
    onDone: () => void;
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
      body: JSON.stringify({ messages, systemPrompt }),
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

  const handleSend = async () => {
    if (!message.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: message.trim() };
    const userMessages = [...messages, userMessage];
    setMessages(userMessages);
    setMessage("");
    setIsLoading(true);

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
      let systemPrompt = SYSTEM_PROMPT;
      
      if (currentChat?.chat_type === 'homework_task' && currentChat.homework_task) {
        const task = currentChat.homework_task;
        systemPrompt += `

КОНТЕКСТ ДОМАШНЕЙ ЗАДАЧИ:
Предмет: ${task.homework_set?.subject}
Тема: ${task.homework_set?.topic}
Номер задачи: ${task.task_number}

Условие задачи:
${task.condition_text || '[Фото условия доступно пользователю]'}

AI Анализ:
Тип: ${(task.ai_analysis as any)?.type || 'не определен'}
План решения: ${(task.ai_analysis as any)?.solution_steps?.join(', ') || 'не определен'}

---

Пользователь работает над этой конкретной задачей из домашнего задания.
Помоги ему решить её, используя Сократовский метод - не давай готовый ответ, 
а задавай наводящие вопросы и направляй к решению.`;
      }

      await streamChat({
        messages: userMessages,
        systemPrompt,
        onDelta: (chunk) => upsertAssistant(chunk),
        onDone: () => {
          setIsLoading(false);
          queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
        },
      });

      const finalAssistantMsg: Message = { role: "assistant", content: assistantSoFar };
      await saveMessageToBatch(finalAssistantMsg);
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
  };

  if (!currentChatId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <ChatSkeleton />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ChatSidebar
        currentChatId={currentChatId}
        onChatSelect={handleChatSelect}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b p-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <span>{currentChat?.icon || '💬'}</span>
            <span>{currentChat?.title || 'Чат'}</span>
          </h1>
          <ConnectionIndicator />
        </div>

        {currentChat?.chat_type === 'homework_task' && currentChat.homework_task && (
          <TaskContextBanner task={currentChat.homework_task} />
        )}

        <div className="flex-1 overflow-y-auto pb-32 px-4">
          {loadingHistory ? (
            <ChatSkeleton />
          ) : (
            <>
              {messages.map((msg, index) => (
                <ChatMessage key={index} message={msg} isLoading={false} onQuickMessage={() => {}} />
              ))}
              {isLoading && (
                <div className="flex justify-start mb-4">
                  <div className="bg-secondary text-secondary-foreground rounded-lg p-4 max-w-[80%]">
                    <div className="flex items-center gap-2">
                      <div className="animate-bounce">●</div>
                      <div className="animate-bounce delay-100">●</div>
                      <div className="animate-bounce delay-200">●</div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        <div className="border-t p-4 bg-background">
          <div className="flex gap-2 max-w-4xl mx-auto">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Напиши свой вопрос..."
              className="min-h-[60px] resize-none"
              disabled={isLoading}
            />
            <Button
              onClick={handleSend}
              disabled={!message.trim() || isLoading}
              size="icon"
              className="h-[60px] w-[60px]"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
