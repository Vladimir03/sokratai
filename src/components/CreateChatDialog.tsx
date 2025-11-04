import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface CreateChatDialogProps {
  open: boolean;
  onClose: () => void;
  onChatCreated: (chatId: string) => void;
}

export function CreateChatDialog({ open, onClose, onChatCreated }: CreateChatDialogProps) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("💬");
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();

  // iOS fix - cleanup when dialog closes
  useEffect(() => {
    if (!open) {
      // Restore body styles when dialog closes
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.pointerEvents = '';
    }
  }, [open]);

  const handleCreate = async () => {
    if (!title.trim()) {
      toast({
        title: "Ошибка",
        description: "Введите название чата",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Пользователь не авторизован");

      const { data: newChat, error } = await supabase
        .from('chats')
        .insert({
          user_id: user.id,
          chat_type: 'custom',
          title: title.trim(),
          icon: icon || '💬'
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Успех",
        description: "Чат создан",
      });

      setTitle("");
      setIcon("💬");
      onClose();
      onChatCreated(newChat.id);
    } catch (error) {
      console.error('Error creating chat:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось создать чат",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Создать новый чат</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Название</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Параметры, Глупые вопросы..."
              disabled={isCreating}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="icon">Иконка (опционально)</Label>
            <Input
              id="icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="🎯"
              maxLength={2}
              disabled={isCreating}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isCreating}>
            Отмена
          </Button>
          <Button onClick={handleCreate} disabled={!title.trim() || isCreating}>
            {isCreating ? "Создание..." : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
