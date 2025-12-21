import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AdminChatView } from "./AdminChatView";
import { Search, MessageSquare, User } from "lucide-react";

interface ChatWithUser {
  id: string;
  title: string | null;
  last_message_at: string | null;
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
      // Получаем все чаты
      const { data: chatsData, error: chatsError } = await supabase
        .from("chats")
        .select("id, title, last_message_at, created_at, updated_at, user_id")
        .order("updated_at", { ascending: false });

      if (chatsError) throw chatsError;

      if (!chatsData || chatsData.length === 0) {
        setChats([]);
        return;
      }

      // Получаем количество сообщений от пользователей для каждого чата
      const chatIds = chatsData.map((c) => c.id);
      const { data: messagesCount, error: messagesError } = await supabase
        .from("chat_messages")
        .select("chat_id")
        .in("chat_id", chatIds)
        .eq("role", "user");

      if (messagesError) throw messagesError;

      // Считаем сообщения по чатам
      const countMap: Record<string, number> = {};
      messagesCount?.forEach((m) => {
        if (m.chat_id) {
          countMap[m.chat_id] = (countMap[m.chat_id] || 0) + 1;
        }
      });

      // Фильтруем чаты где есть хотя бы 1 сообщение от пользователя
      const chatsWithMessages = chatsData.filter(
        (c) => countMap[c.id] && countMap[c.id] >= 1
      );

      // Получаем уникальные user_id
      const userIds = [...new Set(chatsWithMessages.map((c) => c.user_id))];

      // Получаем профили
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, username, telegram_username, grade")
        .in("id", userIds);

      if (profilesError) throw profilesError;

      // Создаём карту профилей
      const profilesMap: Record<string, typeof profiles[0]> = {};
      profiles?.forEach((p) => {
        profilesMap[p.id] = p;
      });

      // Собираем финальный результат
      const result: ChatWithUser[] = chatsWithMessages.map((chat) => ({
        ...chat,
        message_count: countMap[chat.id] || 0,
        user: profilesMap[chat.user_id] || null,
      }));

      setChats(result);
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
        onBack={() => setSelectedChatId(null)}
      />
    );
  }

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
          <ScrollArea className="h-[600px]">
            <div className="space-y-1">
              {filteredChats.map((chat) => (
                <div
                  key={chat.id}
                  onClick={() => setSelectedChatId(chat.id)}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium">{getUserDisplayName(chat)}</div>
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
                      {format(new Date(chat.last_message_at || chat.updated_at || chat.created_at), "d MMM, HH:mm", {
                        locale: ru,
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="mt-4 text-sm text-muted-foreground text-center">
          Всего чатов: {filteredChats.length}
        </div>
      </CardContent>
    </Card>
  );
};
