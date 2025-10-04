import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Send, Mic, MessageSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/integrations/supabase/client";
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';

const MAX_MESSAGE_LENGTH = 2000;

interface Message {
  role: "user" | "assistant";
  content: string;
  id?: string;
}

const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    loadChatHistory();
  }, []);

  const loadChatHistory = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(20);

      if (error) throw error;

      if (data) {
        const loadedMessages: Message[] = data.map(msg => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
          id: msg.id
        }));
        setMessages(loadedMessages);
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
      toast.error("Не удалось загрузить историю чата");
    } finally {
      setLoadingHistory(false);
    }
  };

  const saveMessage = async (role: "user" | "assistant", content: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('chat_messages')
        .insert({
          user_id: user.id,
          role,
          content
        });

      if (error) throw error;
    } catch (error) {
      console.error('Error saving message:', error);
    }
  };

  const parseLatex = (text: string) => {
    const parts = [];
    let lastIndex = 0;
    
    // Match display math $$...$$
    const displayRegex = /\$\$(.*?)\$\$/g;
    // Match inline math $...$
    const inlineRegex = /\$(.*?)\$/g;
    
    let match;
    const allMatches: { index: number; length: number; type: 'display' | 'inline'; content: string }[] = [];
    
    while ((match = displayRegex.exec(text)) !== null) {
      allMatches.push({ 
        index: match.index, 
        length: match[0].length, 
        type: 'display', 
        content: match[1] 
      });
    }
    
    while ((match = inlineRegex.exec(text)) !== null) {
      // Avoid matching display math
      if (!allMatches.some(m => m.index <= match.index && match.index < m.index + m.length)) {
        allMatches.push({ 
          index: match.index, 
          length: match[0].length, 
          type: 'inline', 
          content: match[1] 
        });
      }
    }
    
    allMatches.sort((a, b) => a.index - b.index);
    
    allMatches.forEach((m, i) => {
      if (m.index > lastIndex) {
        parts.push(<span key={`text-${i}`}>{text.slice(lastIndex, m.index)}</span>);
      }
      
      if (m.type === 'display') {
        parts.push(
          <div key={`math-${i}`} className="my-2">
            <BlockMath math={m.content} />
          </div>
        );
      } else {
        parts.push(<InlineMath key={`math-${i}`} math={m.content} />);
      }
      
      lastIndex = m.index + m.length;
    });
    
    if (lastIndex < text.length) {
      parts.push(<span key="text-end">{text.slice(lastIndex)}</span>);
    }
    
    return parts.length > 0 ? parts : text;
  };

  const streamChat = async (userMessages: Message[]) => {
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
    
    // Сохраняем ответ ассистента после завершения стриминга
    if (assistantContent) {
      await saveMessage("assistant", assistantContent);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
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
    
    if (isLoading) return;

    const userMessage: Message = { role: "user", content: trimmedInput };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    // Сохраняем сообщение пользователя
    await saveMessage("user", userMessage.content);

    try {
      // Отправляем только последние 10 сообщений для контекста
      const recentMessages = newMessages.slice(-10);
      await streamChat(recentMessages);
    } catch (error) {
      console.error("Chat error:", error);
      toast.error("Ошибка при отправке сообщения");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-6 h-[calc(100vh-8rem)] md:h-[calc(100vh-5rem)] flex flex-col">
        <Card className="flex-1 flex flex-col overflow-hidden shadow-elegant">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
              <div
                key={index}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] p-4 rounded-2xl ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {parseLatex(message.content)}
                  </div>
                </div>
              </div>
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
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="p-4 border-t">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Напишите ваш вопрос..."
                disabled={isLoading}
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
