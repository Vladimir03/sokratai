import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, User, Bot, Image as ImageIcon, Globe } from "lucide-react";

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
  image_url: string | null;
  image_path: string | null;
  signedImageUrl?: string | null;
}

interface AdminChatViewProps {
  chatId: string;
  userName: string;
  userGrade: number | null;
  platform?: "web" | "telegram";
  onBack: () => void;
}

export const AdminChatView = ({
  chatId,
  userName,
  userGrade,
  platform,
  onBack,
}: AdminChatViewProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchMessages();
  }, [chatId]);

  const fetchMessages = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-crm", {
        body: { action: "messages", chatId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessages((data?.messages as Message[]) || []);
    } catch (err) {
      console.error("Error fetching messages:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">{userName}</CardTitle>
              {platform && (
                <Badge variant="outline" className="text-[10px] h-4 px-1 uppercase flex items-center gap-1">
                  {platform === "telegram" ? (
                    <Bot className="w-3 h-3 text-socrat-telegram" />
                  ) : (
                    <Globe className="w-3 h-3 text-emerald-500" />
                  )}
                  {platform}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {userGrade ? `${userGrade} класс` : "Класс не указан"} •{" "}
              {messages.length} сообщений
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            Сообщений нет
          </div>
        ) : (
          <ScrollArea className="h-[400px] md:h-[600px]">
            <div className="p-4 space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {message.role !== "user" && (
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    {(message.signedImageUrl || message.image_url) && (
                      <div className="mb-2">
                        <a
                          href={message.signedImageUrl || message.image_url || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img
                            src={message.signedImageUrl || message.image_url || ""}
                            alt="Прикреплённое изображение"
                            className="max-w-full max-h-48 rounded-md object-contain"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                            }}
                          />
                          <div className="hidden flex items-center gap-1 text-sm opacity-70">
                            <ImageIcon className="w-4 h-4" />
                            <span>Изображение</span>
                          </div>
                        </a>
                      </div>
                    )}
                    <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                    <div
                      className={`text-xs mt-1 ${
                        message.role === "user"
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground"
                      }`}
                    >
                      {format(new Date(message.created_at), "d MMM, HH:mm", {
                        locale: ru,
                      })}
                    </div>
                  </div>
                  {message.role === "user" && (
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
