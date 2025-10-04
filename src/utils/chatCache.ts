interface CachedMessage {
  role: "user" | "assistant";
  content: string;
  id?: string;
  tempId?: string;
  status?: "sending" | "sent" | "error";
  timestamp: number;
}

interface CacheData {
  messages: CachedMessage[];
  timestamp: number;
  userId: string;
}

const SESSION_CACHE_KEY = "chat_messages_session";
const LOCAL_CACHE_KEY = "chat_messages_cache";
const MAX_CACHED_MESSAGES = 50;
const CACHE_TTL = 30 * 60 * 1000; // 30 минут

export const saveChatToSessionCache = (messages: CachedMessage[], userId: string) => {
  try {
    const recentMessages = messages.slice(-MAX_CACHED_MESSAGES);
    const cacheData: CacheData = {
      messages: recentMessages,
      timestamp: Date.now(),
      userId,
    };
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(cacheData));
    // Дублируем в localStorage как fallback
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cacheData));
  } catch (error) {
    console.error("Error saving to cache:", error);
  }
};

export const loadChatFromSessionCache = (userId: string): CachedMessage[] | null => {
  try {
    // Сначала пробуем sessionStorage
    let cached = sessionStorage.getItem(SESSION_CACHE_KEY);
    let storage = "session";
    
    // Если нет, пробуем localStorage
    if (!cached) {
      cached = localStorage.getItem(LOCAL_CACHE_KEY);
      storage = "local";
    }
    
    if (cached) {
      const cacheData: CacheData = JSON.parse(cached);
      
      // Проверяем TTL и userId
      const isExpired = Date.now() - cacheData.timestamp > CACHE_TTL;
      const isWrongUser = cacheData.userId !== userId;
      
      if (isExpired || isWrongUser) {
        console.log(`Cache expired or wrong user in ${storage}Storage, clearing...`);
        clearChatCache();
        return null;
      }
      
      console.log(`Loaded ${cacheData.messages.length} messages from ${storage}Storage`);
      return cacheData.messages;
    }
  } catch (error) {
    console.error("Error loading from cache:", error);
  }
  return null;
};

export const clearChatCache = () => {
  try {
    sessionStorage.removeItem(SESSION_CACHE_KEY);
    localStorage.removeItem(LOCAL_CACHE_KEY);
  } catch (error) {
    console.error("Error clearing cache:", error);
  }
};
