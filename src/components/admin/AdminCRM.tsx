import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { AdminChatView } from "./AdminChatView";
import { Search, MessageSquare, User, Globe, Bot } from "lucide-react";

interface ChatWithUser {
  id: string;
  title: string | null;
  chat_type: string;
  last_message_at: string | null;
  actual_last_message: string; // Реальная дата последнего сообщения
  updated_at: string;
  created_at: string;
  user_id: string;
  message_count: number;
  user: {
    username: string;
    telegram_username: string | null;
    grade: number | null;
  } | null;
}

export const AdminCRM = () => {
  const [chats, setChats] = useState<ChatWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);

  useEffect(() => {
    fetchChats();
  }, []);

  const fetchChats = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-crm", {
        body: { action: "list" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setChats((data?.chats as ChatWithUser[]) || []);
    } catch (err) {
      console.error("Error fetching chats:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredChats = chats.filter((chat) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const username = chat.user?.username?.toLowerCase() || "";
    const telegramUsername = chat.user?.telegram_username?.toLowerCase() || "";
    return username.includes(query) || telegramUsername.includes(query);
  });

  const getChatPlatform = (chat: ChatWithUser) => {
    if (chat.title === "Telegram чат") return "telegram";
    return "web";
  };

  const getUserDisplayName = (chat: ChatWithUser) => {
    if (chat.user?.telegram_username) {
      return `@${chat.user.telegram_username}`;
    }
    return chat.user?.username || "Неизвестный";
  };

  if (selectedChatId) {
    const selectedChat = chats.find((c) => c.id === selectedChatId);
    return (
      <AdminChatView
        chatId={selectedChatId}
        userName={selectedChat ? getUserDisplayName(selectedChat) : ""}
        userGrade={selectedChat?.user?.grade || null}
        platform={selectedChat ? getChatPlatform(selectedChat) : undefined}
        onBack={() => setSelectedChatId(null)}
      />
    );
  }

  const webChats = filteredChats.filter(chat => getChatPlatform(chat) === "web");
  const telegramChats = filteredChats.filter(chat => getChatPlatform(chat) === "telegram");

  const ChatList = ({ chatsToDisplay }: { chatsToDisplay: ChatWithUser[] }) => (
    <ScrollArea className="h-[400px] md:h-[600px]">
      <div className="space-y-1">
        {chatsToDisplay.map((chat) => (
          <div
            key={chat.id}
            onClick={() => setSelectedChatId(chat.id)}
            className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border"
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-border">
                  {getChatPlatform(chat) === "telegram" ? (
                    <Bot className="w-3 h-3 text-socrat-telegram" />
                  ) : (
                    <Globe className="w-3 h-3 text-emerald-500" />
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <div className="font-medium">{getUserDisplayName(chat)}</div>
                  <Badge variant="outline" className="text-[10px] h-4 px-1 uppercase">
                    {getChatPlatform(chat)}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {chat.user?.grade ? `${chat.user.grade} класс` : "Класс не указан"}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium">
                {chat.message_count} сообщ.
              </div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(chat.actual_last_message), "d MMM, HH:mm", {
                  locale: ru,
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5" />
          Переписки с пользователями
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Поиск */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <User className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>Чаты не найдены</p>
          </div>
        ) : (
          <Tabs defaultValue="all" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="all">Все ({filteredChats.length})</TabsTrigger>
              <TabsTrigger value="web">Веб ({webChats.length})</TabsTrigger>
              <TabsTrigger value="telegram">Telegram ({telegramChats.length})</TabsTrigger>
            </TabsList>
            
            <TabsContent value="all">
              <ChatList chatsToDisplay={filteredChats} />
            </TabsContent>
            
            <TabsContent value="web">
              {webChats.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">Веб-чаты не найдены</div>
              ) : (
                <ChatList chatsToDisplay={webChats} />
              )}
            </TabsContent>
            
            <TabsContent value="telegram">
              {telegramChats.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">Telegram-чаты не найдены</div>
              ) : (
                <ChatList chatsToDisplay={telegramChats} />
              )}
            </TabsContent>
          </Tabs>
        )}

        <div className="mt-4 text-sm text-muted-foreground text-center">
          Всего чатов: {filteredChats.length}
        </div>
      </CardContent>
    </Card>
  );
};
