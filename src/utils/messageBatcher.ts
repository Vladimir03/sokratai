import { supabase } from "@/integrations/supabase/client";
import { retryWithBackoff } from "./retryWithBackoff";

interface PendingMessage {
  role: "user" | "assistant";
  content: string;
  tempId?: string;
  image_url?: string;
  input_method?: "text" | "voice" | "button";
}

class MessageBatcher {
  private pendingMessages: PendingMessage[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private readonly BATCH_DELAY = 2000; // 2 секунды для накопления

  addMessage(message: PendingMessage) {
    this.pendingMessages.push(message);
    
    // Сбрасываем предыдущий таймер
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    // Устанавливаем новый таймер для батча
    this.batchTimeout = setTimeout(() => {
      this.flush();
    }, this.BATCH_DELAY);
  }

  async flush(): Promise<void> {
    if (this.pendingMessages.length === 0) return;

    const messagesToSave = [...this.pendingMessages];
    this.pendingMessages = [];

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Сохраняем все сообщения одним запросом с retry
      await retryWithBackoff(async () => {
        const { error } = await supabase
          .from('chat_messages')
          .insert(
            messagesToSave.map(msg => ({
              user_id: user.id,
              role: msg.role,
              content: msg.content,
              image_url: msg.image_url || null,
              input_method: msg.input_method || 'text',
            }))
          );

        if (error) throw error;
      });

      console.log(`Batched ${messagesToSave.length} messages successfully`);
    } catch (error) {
      console.error("Error saving batched messages:", error);
      // Возвращаем сообщения обратно в очередь при ошибке
      this.pendingMessages.unshift(...messagesToSave);
    }
  }

  async forceFlush(): Promise<void> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    await this.flush();
  }
}

export const messageBatcher = new MessageBatcher();
