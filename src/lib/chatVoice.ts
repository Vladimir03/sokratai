import { supabase } from "@/lib/supabaseClient";

// HARDCODED — see src/lib/supabaseClient.ts for rationale (RU bypass, ignore Lovable auto-env).
const SUPABASE_URL = "https://api.sokratai.ru";

const CHAT_VOICE_URL = `${SUPABASE_URL}/functions/v1/chat/transcribe-voice`;

export class VoiceTranscriptionError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "VoiceTranscriptionError";
    this.code = code;
  }
}

export interface TranscribeChatVoiceOptions {
  audioBlob: Blob;
  fileName?: string;
  timeoutMs?: number;
}

export interface TranscribeChatVoiceResult {
  text: string;
}

export async function transcribeChatVoice({
  audioBlob,
  fileName = "voice.webm",
  timeoutMs = 45_000,
}: TranscribeChatVoiceOptions): Promise<TranscribeChatVoiceResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new VoiceTranscriptionError("Требуется авторизация", "NO_SESSION");
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const formData = new FormData();
    formData.append("file", audioBlob, fileName);

    const response = await fetch(CHAT_VOICE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorMessage = "Не удалось расшифровать голосовое сообщение";

      try {
        const errorBody = await response.json();
        if (typeof errorBody?.error === "string" && errorBody.error.trim()) {
          errorMessage = errorBody.error;
        }
      } catch {
        // Ignore malformed error responses and keep fallback copy.
      }

      throw new VoiceTranscriptionError(errorMessage, `HTTP_${response.status}`);
    }

    const data = await response.json();
    const text = typeof data?.text === "string" ? data.text.trim() : "";

    if (!text) {
      throw new VoiceTranscriptionError("Не удалось распознать речь", "EMPTY_TRANSCRIPT");
    }

    return { text };
  } catch (error) {
    if (error instanceof VoiceTranscriptionError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new VoiceTranscriptionError(
        "Расшифровка заняла слишком много времени. Попробуй ещё раз.",
        "TIMEOUT",
      );
    }

    throw new VoiceTranscriptionError(
      "Не удалось отправить голосовое сообщение на расшифровку.",
      "NETWORK_ERROR",
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}
