/**
 * Reusable SSE streaming utility for the /functions/v1/chat endpoint.
 * Extracted from Chat.tsx streamChatWithRetry (lines 900-1096).
 */

import { supabase } from '@/lib/supabaseClient';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://vrsseotrfmsxpbciyqzc.supabase.co';

export class StreamChatError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'StreamChatError';
    this.code = code;
  }
}

export interface StreamChatMessage {
  role: string;
  content: string;
}

export interface StreamChatOptions {
  messages: StreamChatMessage[];
  systemPrompt?: string;
  taskContext?: string;
  /** Storage refs for task images; server resolves them into multimodal image_url parts */
  taskImageUrls?: string[];
  /** Signed HTTP URL for the latest student solution image; kept for backward compatibility */
  studentImageUrl?: string;
  /** Signed HTTP URLs for the latest student solution attachments */
  studentImageUrls?: string[];
  /**
   * Guided homework context — when present, the /chat endpoint fetches
   * tutor's reference solution (solution_text + solution_image_urls) server-side
   * using service-role, after verifying the student has access to the assignment.
   * Student-side API never exposes these refs directly.
   */
  guidedHomeworkAssignmentId?: string;
  guidedHomeworkTaskId?: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError?: (error: Error) => void;
  retries?: number;
  timeoutMs?: number;
}

/**
 * Stream a chat response from the AI gateway via SSE.
 *
 * Handles retry with exponential backoff for 5xx / timeout errors.
 * Non-retryable: 401, 402, 429 (limit_reached).
 */
export async function streamChat({
  messages,
  systemPrompt,
  taskContext,
  taskImageUrls,
  studentImageUrl,
  studentImageUrls,
  guidedHomeworkAssignmentId,
  guidedHomeworkTaskId,
  onDelta,
  onDone,
  onError,
  retries = 3,
  timeoutMs = 30_000,
}: StreamChatOptions): Promise<void> {
  const chatUrl = `${SUPABASE_URL}/functions/v1/chat`;
  const normalizedStudentImageUrls = (studentImageUrls?.length
    ? studentImageUrls
    : (studentImageUrl ? [studentImageUrl] : [])
  ).filter(Boolean);

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    // Safari < 16 doesn't support AbortSignal.timeout() — use manual setTimeout
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        clearTimeout(timeoutId);
        throw new StreamChatError('Требуется авторизация', 'NO_SESSION');
      }

      const resp = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          messages,
          systemPrompt,
          taskContext,
          taskImageUrls: taskImageUrls?.length ? taskImageUrls : undefined,
          studentImageUrl: normalizedStudentImageUrls[0] || undefined,
          studentImageUrls: normalizedStudentImageUrls.length > 0 ? normalizedStudentImageUrls : undefined,
          guidedHomeworkAssignmentId: guidedHomeworkAssignmentId || undefined,
          guidedHomeworkTaskId: guidedHomeworkTaskId || undefined,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        // Non-retryable errors
        if (resp.status === 429) {
          try {
            const errorData = await resp.json();
            if (errorData.error === 'limit_reached') {
              throw new StreamChatError('Достигнут дневной лимит сообщений', 'LIMIT_REACHED');
            }
          } catch (e) {
            if (e instanceof StreamChatError) throw e;
          }
          throw new StreamChatError('Превышен лимит запросов. Попробуйте позже.', 'RATE_LIMIT');
        }

        if (resp.status === 402) {
          throw new StreamChatError('Требуется пополнение баланса.', 'PAYMENT_REQUIRED');
        }

        // Retry on 5xx
        if (resp.status >= 500 && attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`⚠️ Server error ${resp.status}, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw new StreamChatError(`Ошибка сервера (HTTP ${resp.status})`, 'HTTP_ERROR');
      }

      if (!resp.body) {
        throw new StreamChatError('Нет ответа от сервера', 'NO_BODY');
      }

      // Parse SSE stream
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) onDelta(content);
          } catch {
            // Incomplete JSON — put line back into buffer and wait for more data
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Flush remaining buffer
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (raw.startsWith(':') || raw.trim() === '') continue;
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) onDelta(content);
          } catch {
            // ignore malformed trailing data
          }
        }
      }

      onDone();
      return; // Success
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      const err = error instanceof Error ? error : new Error(String(error));

      // Non-retryable errors — throw immediately
      if (err instanceof StreamChatError) {
        if (onError) onError(err);
        throw err;
      }

      // AbortError = timeout — retry
      if (err.name === 'AbortError') {
        if (attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`⏱️ Request timeout, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        const timeoutErr = new StreamChatError(
          'Превышен лимит времени ожидания. Попробуйте позже.',
          'TIMEOUT',
        );
        if (onError) onError(timeoutErr);
        throw timeoutErr;
      }

      // Network errors — retry
      if (attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`🌐 Network error, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Last attempt failed
      if (onError) onError(err);
      throw err;
    }
  }
}
