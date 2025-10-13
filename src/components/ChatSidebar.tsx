import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { CreateChatDialog } from "./CreateChatDialog";

interface ChatSidebarProps {
  currentChatId?: string;
  onChatSelect: (chatId: string) => void;
  onClose?: () => void;
  isMobile?: boolean;
}

interface Chat {
  id: string;
  chat_type: string;
  title: string | null;
  icon: string | null;
  last_message_at: string | null;
  homework_task?: {
    task_number: string;
    homework_set: {
      subject: string;
      topic: string;
    };
  };
  message_count?: Array<{ count: number }>;
}

export function ChatSidebar({ currentChatId, onChatSelect, onClose, isMobile }: ChatSidebarProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    }
  });

  const { data: chats = [] } = useQuery({
    queryKey: ['chats', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from('chats')
        .select(`
          *,
          homework_task:homework_tasks(
            task_number,
            homework_set:homework_sets(subject, topic)
          )
        `)
        .eq('user_id', user.id)
        .eq('is_archived', false)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Chat[];
    },
    enabled: !!user?.id
  });

  const generalChat = chats.find(c => c.chat_type === 'general');
  const taskChats = chats.filter(c => c.chat_type === 'homework_task');
  const customChats = chats.filter(c => c.chat_type === 'custom');

  const getDefaultTitle = (chat: Chat) => {
    if (chat.chat_type === 'general') return 'Общий чат';
    if (chat.chat_type === 'homework_task') {
      return `Задача ${chat.homework_task?.task_number || '?'}`;
    }
    return 'Новый чат';
  };

  const ChatItem = ({ chat }: { chat: Chat }) => {
    const isActive = currentChatId === chat.id;

    return (
      <button
        onClick={() => onChatSelect(chat.id)}
        className={`
          w-full px-4 py-3 text-left hover:bg-accent transition-colors
          ${isActive ? 'bg-accent border-l-4 border-primary' : ''}
        `}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">{chat.icon || '💬'}</span>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">
              {chat.title || getDefaultTitle(chat)}
            </div>
            {chat.homework_task && (
              <div className="text-xs text-muted-foreground truncate">
                {chat.homework_task.homework_set.topic}
              </div>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <>
      <div className="w-full flex flex-col h-full bg-background">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-lg">Чаты</h2>
          {isMobile && onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {generalChat && <ChatItem chat={generalChat} />}

          {taskChats.length > 0 && (
            <>
              <div className="px-4 py-2 text-sm text-muted-foreground font-medium mt-4">
                ЗАДАЧИ
              </div>
              {taskChats.map(chat => (
                <ChatItem key={chat.id} chat={chat} />
              ))}
            </>
          )}

          {customChats.length > 0 && (
            <>
              <div className="px-4 py-2 text-sm text-muted-foreground font-medium mt-4">
                МОИ ЧАТЫ
              </div>
              {customChats.map(chat => (
                <ChatItem key={chat.id} chat={chat} />
              ))}
            </>
          )}
        </div>

        <div className="p-4 border-t">
          <Button
            onClick={() => setShowCreateDialog(true)}
            variant="outline"
            className="w-full"
          >
            <Plus className="mr-2 h-4 w-4" />
            Новый чат
          </Button>
        </div>
      </div>

      <CreateChatDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onChatCreated={onChatSelect}
      />
    </>
  );
}
