import { supabase } from "@/lib/supabaseClient";
import { retryWithBackoff } from "./retryWithBackoff";

interface PendingMessage {
  role: "user" | "assistant";
  content: string;
  tempId?: string;
  image_url?: string;
  input_method?: "text" | "voice" | "button";
}

class MessageBatcher {
  private pendingMessages: Map<string, PendingMessage> = new Map();
  private batchTimeout: NodeJS.Timeout | null = null;
  private readonly BATCH_DELAY = 100; // 100мс для быстрой отправки

  addMessage(message: PendingMessage) {
    // Используем tempId как ключ для предотвращения дубликатов
    const key = message.tempId || `${message.role}-${Date.now()}-${Math.random()}`;
    
    // Проверяем, нет ли уже такого сообщения
    if (!this.pendingMessages.has(key)) {
      this.pendingMessages.set(key, message);
    }
    
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
    if (this.pendingMessages.size === 0) return;

    const messagesToSave = Array.from(this.pendingMessages.values());
    this.pendingMessages.clear();

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Сохраняем все сообщения одним запросом
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

      console.log(`Batched ${messagesToSave.length} messages successfully`);
    } catch (error) {
      console.error("Error saving batched messages:", error);
      // НЕ возвращаем сообщения обратно - они останутся в UI
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
