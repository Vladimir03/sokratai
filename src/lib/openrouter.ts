import { toast } from "sonner";

const AGENTROUTER_API_URL = 'https://agentrouter.org/v1/chat/completions';
const MODEL = 'claude-sonnet-4-5-20250929';

// Fallback models in case primary fails
const FALLBACK_MODELS = [
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-5',
  'claude-3-5-sonnet-20241022'
];

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | MessageContent[];
}

interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
  }>;
  model: string;
  error?: {
    message: string;
  };
}

export async function sendToOpenRouter(
  messages: Message[],
  photoUrl?: string | null
): Promise<string> {
  const apiKey = import.meta.env.VITE_AGENTROUTER_API_KEY;
  
  if (!apiKey) {
    toast.error('AgentRouter API ключ не настроен');
    throw new Error('AgentRouter API key missing');
  }

  // Format messages for multimodal if photo exists
  const formattedMessages = messages.map(msg => {
    if (msg.role === 'user' && photoUrl && typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: [
          { type: 'text', text: msg.content },
          { type: 'image_url', image_url: { url: photoUrl } }
        ]
      };
    }
    return msg;
  });

  try {
    const response = await fetch(AGENTROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'EGE Repetitor'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: formattedMessages,
        models: FALLBACK_MODELS,
        temperature: 0.7,
        max_tokens: 4000,
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'AgentRouter API error');
    }

    const data: OpenRouterResponse = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    if (!data.choices || data.choices.length === 0) {
      throw new Error('Нет ответа от AI');
    }

    return data.choices[0].message.content;
  } catch (error) {
    console.error('AgentRouter API error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('rate limit')) {
        toast.error('Достигнут лимит запросов. Попробуйте позже.');
      } else if (error.message.includes('insufficient')) {
        toast.error('Недостаточно средств на AgentRouter.');
      } else {
        toast.error(`Ошибка AI: ${error.message}`);
      }
    }
    
    throw error;
  }
}

// Helper function to build system prompt
export function buildSystemPrompt(
  chatType: 'general' | 'homework_task',
  taskContext?: string
): Message {
  let prompt = 'Ты опытный репетитор по математике для подготовки к ЕГЭ. ';
  
  if (chatType === 'homework_task' && taskContext) {
    prompt += `\n\nКОНТЕКСТ ДОМАШНЕЙ ЗАДАЧИ:\n${taskContext}\n`;
  }
  
  prompt += `
Твои принципы:
1. Используй Сократовский метод - задавай наводящие вопросы вместо прямых ответов
2. Сначала убедись, что ученик понял условие задачи
3. Помогай находить решение самостоятельно, не давай готовый ответ сразу
4. Поддерживай и мотивируй ученика
5. Если ученик застрял, дай подсказку, но не полное решение
6. После решения предложи похожую задачу для закрепления

Отвечай на русском языке понятно и дружелюбно.`;

  return {
    role: 'system',
    content: prompt
  };
}
