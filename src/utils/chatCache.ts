interface CachedMessage {
  role: "user" | "assistant";
  content: string;
  id?: string;
  image_url?: string;
  feedback?: 'like' | 'dislike' | null;
  input_method?: 'text' | 'voice' | 'button';
}

interface CacheData {
  messages: CachedMessage[];
  timestamp: number;
  userId: string;
  hasMoreMessages?: boolean;
  oldestMessageTimestamp?: string | null;
}

const MAX_CACHED_MESSAGES = 50;
const CACHE_TTL = 30 * 60 * 1000; // 30 минут

const getCacheKey = (chatId: string, storage: 'session' | 'local') => {
  return `chat_${chatId}_${storage}`;
};

export const saveChatToSessionCache = (
  chatId: string, 
  messages: CachedMessage[], 
  userId: string,
  hasMoreMessages?: boolean,
  oldestMessageTimestamp?: string | null
) => {
  try {
    const recentMessages = messages.slice(-MAX_CACHED_MESSAGES);
    const cacheData: CacheData = {
      messages: recentMessages,
      timestamp: Date.now(),
      userId,
      hasMoreMessages,
      oldestMessageTimestamp,
    };
    sessionStorage.setItem(getCacheKey(chatId, 'session'), JSON.stringify(cacheData));
    // Дублируем в localStorage как fallback
    localStorage.setItem(getCacheKey(chatId, 'local'), JSON.stringify(cacheData));
    console.log(`💾 Saved ${messages.length} messages to cache for chat ${chatId}`);
  } catch (error) {
    console.error("Error saving to cache:", error);
  }
};

export const loadChatFromSessionCache = (chatId: string, userId: string): { messages: CachedMessage[], hasMoreMessages?: boolean, oldestMessageTimestamp?: string | null } | null => {
  try {
    // Сначала пробуем sessionStorage
    let cached = sessionStorage.getItem(getCacheKey(chatId, 'session'));
    let storage = "session";
    
    // Если нет, пробуем localStorage
    if (!cached) {
      cached = localStorage.getItem(getCacheKey(chatId, 'local'));
      storage = "local";
    }
    
    if (cached) {
      const cacheData: CacheData = JSON.parse(cached);
      
      // Проверяем TTL и userId
      const isExpired = Date.now() - cacheData.timestamp > CACHE_TTL;
      const isWrongUser = cacheData.userId !== userId;
      
      if (isExpired || isWrongUser) {
        console.log(`Cache expired or wrong user in ${storage}Storage, clearing...`);
        clearChatCache(chatId);
        return null;
      }
      
      console.log(`📂 Loaded ${cacheData.messages.length} messages from ${storage}Storage for chat ${chatId}`);
      return {
        messages: cacheData.messages,
        hasMoreMessages: cacheData.hasMoreMessages,
        oldestMessageTimestamp: cacheData.oldestMessageTimestamp,
      };
    }
  } catch (error) {
    console.error("Error loading from cache:", error);
  }
  return null;
};

export const clearChatCache = (chatId?: string) => {
  try {
    if (chatId) {
      sessionStorage.removeItem(getCacheKey(chatId, 'session'));
      localStorage.removeItem(getCacheKey(chatId, 'local'));
      console.log(`🗑️ Cleared cache for chat ${chatId}`);
    } else {
      // Очистить весь кеш чатов
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith('chat_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
      
      const localKeysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('chat_')) {
          localKeysToRemove.push(key);
        }
      }
      localKeysToRemove.forEach(key => localStorage.removeItem(key));
      console.log(`🗑️ Cleared all chat caches`);
    }
  } catch (error) {
    console.error("Error clearing cache:", error);
  }
};
