import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();

  // iOS fix - cleanup when dialog closes and ensure immediate opening
  useEffect(() => {
    if (!open) {
      // Restore body styles when dialog closes
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.pointerEvents = '';
    } else {
      // Ensure dialog opens immediately on iOS
      // Force a reflow to ensure the dialog is rendered
      requestAnimationFrame(() => {
        const titleInput = document.getElementById('title');
        if (titleInput) {
          titleInput.focus();
        }
      });
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Create optimistic chat
    const tempId = `temp-${Date.now()}`;
    const optimisticTitle = title.trim();
    const optimisticIcon = icon || '💬';
    
    // Immediately close modal and show optimistic chat
    setTitle("");
    setIcon("💬");
    onClose();
    onChatCreated(tempId);

    setIsCreating(true);

    try {
      const { data: newChat, error } = await supabase
        .from('chats')
        .insert({
          user_id: user.id,
          chat_type: 'custom',
          title: optimisticTitle,
          icon: optimisticIcon
        })
        .select()
        .single();

      if (error) throw error;

      // Invalidate cache to show real chat
      await queryClient.invalidateQueries({ queryKey: ['chats', user.id] });

      toast({
        title: "Чат создан ✓",
        duration: 2000,
      });

      // Navigate to real chat
      onChatCreated(newChat.id);
    } catch (error) {
      console.error('Error creating chat:', error);
      
      // Invalidate to remove optimistic chat
      await queryClient.invalidateQueries({ queryKey: ['chats', user.id] });
      
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
