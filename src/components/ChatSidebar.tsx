import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, X, Loader2 } from "lucide-react";
import { useState, useRef } from "react";
import { CreateChatDialog } from "./CreateChatDialog";
import { CustomChatItem } from "./CustomChatItem";
import { useNavigate } from "react-router-dom";
import { isIOS } from "@/hooks/use-mobile";

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
  const [optimisticChats, setOptimisticChats] = useState<Array<{id: string, title: string, icon: string}>>([]);
  const navigate = useNavigate();

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
  
  // Merge optimistic chats with real chats (remove optimistic ones that are now real)
  const realChatIds = new Set(chats.map(c => c.id));
  const pendingOptimisticChats = optimisticChats.filter(oc => !realChatIds.has(oc.id));

  const getDefaultTitle = (chat: Chat) => {
    if (chat.chat_type === 'general') return 'Общий чат';
    if (chat.chat_type === 'homework_task') {
      return `Задача ${chat.homework_task?.task_number || '?'}`;
    }
    return 'Новый чат';
  };

  const ChatItem = ({ chat }: { chat: Chat }) => {
    const isActive = currentChatId === chat.id;
    const lastClickRef = useRef<number>(0);

    const handleInteraction = (e: React.TouchEvent | React.MouseEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastClickRef.current < 300) {
        console.log('⚠️ Click ignored (debounce)');
        return;
      }
      lastClickRef.current = now;
      onChatSelect(chat.id);
    };

    return (
      <button
        {...(isIOS() 
          ? { onTouchEnd: handleInteraction as React.TouchEventHandler }
          : { onClick: handleInteraction as React.MouseEventHandler }
        )}
        className={`
          w-full px-4 py-3 text-left [@media(hover:hover)]:hover:bg-accent transition-colors
          ${isActive ? 'bg-accent border-l-4 border-primary' : ''}
        `}
        style={{ touchAction: 'manipulation' }}
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

  const handleChatDeleted = () => {
    // Navigate to general chat if current chat was deleted
    if (generalChat) {
      navigate(`/chat?id=${generalChat.id}`);
    }
  };

  const handleChatCreated = (chatIdOrTempId: string) => {
    // Check if it's a temp ID (optimistic)
    if (chatIdOrTempId.startsWith('temp-')) {
      const tempChat = {
        id: chatIdOrTempId,
        title: '',
        icon: '💬'
      };
      setOptimisticChats(prev => [...prev, tempChat]);
    } else {
      // Real chat created - remove all optimistic chats and navigate
      setOptimisticChats([]);
      onChatSelect(chatIdOrTempId);
      
      // Закрыть сайдбар на мобильных
      if (isMobile && onClose) {
        onClose();
        console.log('📱 Sidebar closed after chat creation (mobile)');
      }
    }
  };

  const OptimisticChatItem = ({ chat }: { chat: {id: string, title: string, icon: string} }) => {
    return (
      <div className="w-full px-4 py-3 bg-accent/50 border-l-4 border-primary/50 animate-pulse">
        <div className="flex items-center gap-2">
          <span className="text-xl opacity-70">{chat.icon}</span>
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <div className="font-medium truncate opacity-70">
              Создаю чат...
            </div>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
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
              className="h-11 w-11"
              title="Закрыть"
            >
              <X className="h-6 w-6" />
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {generalChat && <ChatItem chat={generalChat} />}

          {taskChats.length > 0 && (
            <>
              <div className="px-4 py-2 text-sm text-muted-foreground font-medium mt-4">
                ДОМАШКА
              </div>
              {taskChats.map(chat => (
                <ChatItem key={chat.id} chat={chat} />
              ))}
            </>
          )}

          {(customChats.length > 0 || pendingOptimisticChats.length > 0) && (
            <>
              <div className="px-4 py-2 text-sm text-muted-foreground font-medium mt-4">
                МОИ ЧАТЫ
              </div>
              {pendingOptimisticChats.map(chat => (
                <OptimisticChatItem key={chat.id} chat={chat} />
              ))}
              {customChats.map(chat => (
                <CustomChatItem 
                  key={chat.id} 
                  chat={chat}
                  isActive={currentChatId === chat.id}
                  onSelect={onChatSelect}
                  onDeleted={handleChatDeleted}
                />
              ))}
            </>
          )}
        </div>

        <div className="p-4 border-t">
          <Button
            onClick={() => setShowCreateDialog(true)}
            onTouchEnd={(e) => {
              // iOS fix: prevent 300ms delay and ensure immediate response
              e.preventDefault();
              setShowCreateDialog(true);
            }}
            variant="outline"
            className="w-full"
            style={{ 
              touchAction: 'manipulation',
              userSelect: 'none',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Новый чат
          </Button>
        </div>
      </div>

      <CreateChatDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onChatCreated={handleChatCreated}
      />
    </>
  );
}
