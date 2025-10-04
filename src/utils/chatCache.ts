interface CachedMessage {
  role: "user" | "assistant";
  content: string;
  id?: string;
  tempId?: string;
  status?: "sending" | "sent" | "error";
  timestamp: number;
}

const CACHE_KEY = "chat_messages_cache";
const MAX_CACHED_MESSAGES = 50;

export const saveChatToCache = (messages: CachedMessage[]) => {
  try {
    const recentMessages = messages.slice(-MAX_CACHED_MESSAGES);
    localStorage.setItem(CACHE_KEY, JSON.stringify(recentMessages));
  } catch (error) {
    console.error("Error saving to cache:", error);
  }
};

export const loadChatFromCache = (): CachedMessage[] => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.error("Error loading from cache:", error);
  }
  return [];
};

export const clearChatCache = () => {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (error) {
    console.error("Error clearing cache:", error);
  }
};
