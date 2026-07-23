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
import { groupSubjectsBySelection, normalizeStudentSubjects } from "@/lib/tutorSubjects";

interface CreateChatDialogProps {
  open: boolean;
  onClose: () => void;
  onChatCreated: (chatId: string) => void;
}

export function CreateChatDialog({ open, onClose, onChatCreated }: CreateChatDialogProps) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("💬");
  // Ф5 (subject-personalization): опц. предмет диалога → chats.subject —
  // детерминированный контекст для AI (сервер читает снапшот по chatId).
  const [subject, setSubject] = useState("");
  // Ф7: предметы ученика (profiles.subjects) — группа «Мои предметы» сверху.
  const [mySubjects, setMySubjects] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      if (!uid) return;
      const { data, error } = await supabase
        .from("profiles")
        .select("subjects, difficult_subject")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const row = data as { subjects?: unknown; difficult_subject?: unknown };
      // normalizeStudentSubjects: legacy-id → канонические (ревью 5.6 P2 №9).
      const arr = normalizeStudentSubjects(
        Array.isArray(row.subjects)
          ? (row.subjects as unknown[]).filter((s): s is string => typeof s === "string")
          : typeof row.difficult_subject === "string" && row.difficult_subject
            ? [row.difficult_subject]
            : [],
      );
      setMySubjects(arr);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const subjectGroups = groupSubjectsBySelection(mySubjects);
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
    const optimisticSubject = subject || null;

    // Immediately close modal and show optimistic chat
    setTitle("");
    setIcon("💬");
    setSubject("");
    onClose();
    onChatCreated(tempId);

    setIsCreating(true);

    try {
      // `subject` — narrow-cast escape hatch до регенерации types.ts Lovable
      // (паттерн tutorProfileApi gender): колонка chats.subject — миграция
      // 20260723130000. Ключ шлётся ТОЛЬКО при выбранном предмете; если
      // миграции ещё нет (skew) — одноразовый ретрай БЕЗ subject (ревью 5.6
      // P1 №2: чат обязан создаться, предмет — деградация, не блокер).
      const basePayload = {
        user_id: user.id,
        chat_type: 'custom',
        title: optimisticTitle,
        icon: optimisticIcon,
      };
      let { data: newChat, error } = await supabase
        .from('chats')
        .insert({
          ...basePayload,
          ...(optimisticSubject ? { subject: optimisticSubject } : {}),
        } as never)
        .select()
        .single();

      if (
        error &&
        optimisticSubject &&
        (error.code === 'PGRST204' || error.code === '42703')
      ) {
        console.warn('chat_subject_column_missing_fallback', error.message);
        ({ data: newChat, error } = await supabase
          .from('chats')
          .insert(basePayload as never)
          .select()
          .single());
      }

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

          <div className="space-y-2">
            <Label htmlFor="chat-subject">Предмет (опционально)</Label>
            <select
              id="chat-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isCreating}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-[16px] [touch-action:manipulation]"
            >
              <option value="">Без предмета</option>
              {subjectGroups.yours.length > 0 ? (
                <>
                  <optgroup label="Мои предметы">
                    {subjectGroups.yours.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Другие предметы">
                    {subjectGroups.others.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </optgroup>
                </>
              ) : (
                subjectGroups.others.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))
              )}
            </select>
            <p className="text-xs text-muted-foreground">
              Сократ будет держаться этого предмета в объяснениях.
            </p>
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
