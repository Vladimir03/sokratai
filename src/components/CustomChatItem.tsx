import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2, Check, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface Chat {
  id: string;
  chat_type: string;
  title: string | null;
  icon: string | null;
}

interface CustomChatItemProps {
  chat: Chat;
  isActive: boolean;
  onSelect: (chatId: string) => void;
  onDeleted?: () => void;
}

export function CustomChatItem({ chat, isActive, onSelect, onDeleted }: CustomChatItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(chat.title || "Новый чат");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSaveTitle = async () => {
    if (!editedTitle.trim()) {
      toast({
        title: "Ошибка",
        description: "Название чата не может быть пустым",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('chats')
        .update({ title: editedTitle.trim() })
        .eq('id', chat.id);

      if (error) throw error;

      toast({
        title: "Успешно",
        description: "Название чата обновлено",
      });

      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating chat title:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось обновить название чата",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('chats')
        .delete()
        .eq('id', chat.id);

      if (error) throw error;

      toast({
        title: "Успешно",
        description: "Чат удален",
      });

      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setShowDeleteDialog(false);
      
      if (onDeleted) {
        onDeleted();
      }
    } catch (error) {
      console.error('Error deleting chat:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось удалить чат",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelEdit = () => {
    setEditedTitle(chat.title || "Новый чат");
    setIsEditing(false);
  };

  return (
    <>
      <div
        className={`
          group relative w-full px-4 py-3 hover:bg-accent transition-colors
          ${isActive ? 'bg-accent border-l-4 border-primary' : ''}
        `}
      >
        {isEditing ? (
          <div className="flex items-center gap-2">
            <span className="text-xl">{chat.icon || '💬'}</span>
            <Input
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') handleCancelEdit();
              }}
              className="h-8 text-sm"
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={handleSaveTitle}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={handleCancelEdit}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSelect(chat.id)}
              className="flex-1 flex items-center gap-2 min-w-0 text-left"
            >
              <span className="text-xl">{chat.icon || '💬'}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {chat.title || "Новый чат"}
                </div>
              </div>
            </button>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 shrink-0">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteDialog(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить чат?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Все сообщения в этом чате будут удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Удаление..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
