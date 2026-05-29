/**
 * Shared Groq Whisper transcription helper (voice-speaking-mvp, Этап 2, TASK-7,
 * 2026-05-29).
 *
 * Context:
 *   До этой задачи Whisper-вызовы жили inline в двух местах, оба hardcode
 *   `language='ru'`:
 *     - chat/index.ts::transcribeVoiceMessage (веб-чат голосовой ввод)
 *     - telegram-bot/index.ts::handleVoiceMessage (голосовухи в боте)
 *   Голосовые задания (task_kind='speaking') языковых ДЗ требуют
 *   ПАРАМЕТРИЧЕСКОГО language (french→fr и т.д.) — иначе FR-монолог
 *   транскрибируется как русский (мусор). Spec §3 («Gemini не понимает
 *   FR-голос → голос → Whisper(fr) → текст → Gemini грейдит транскрипт»).
 *
 *   Этот модуль — единый источник транскрипции с параметрическим language,
 *   таймаутом и retry. Вызовы бота/чата НЕ рефакторятся в этом PR (они
 *   ru-only и работают; миграция на helper — отдельная задача).
 *
 * Контракт ошибок (Spec §3, tasks.md TASK-7 AC):
 *   - FR-аудио → непустой транскрипт `{ text }`.
 *   - Groq 5xx / 429 / network / timeout → 1 retry → при повторном fail throw
 *     `VoiceTranscriptionError` (НЕ «успех с пустым текстом»). Caller отличает
 *     реальный сбой от тишины.
 *   - Тишина / нераспознаваемое (Whisper вернул 200 + пустой `text`) →
 *     `{ text: '' }` (НЕ throw). Caller (TASK-8) решает: НЕ звать Gemini,
 *     задачу не закрывать, дружелюбное «не удалось распознать речь».
 *   - Нет GROQ_API_KEY / пустой буфер / превышен размер → throw типизированной
 *     ошибки с `code` (caller мапит на HTTP-ответ).
 *
 * Guardrails:
 *   - PII-free логи: НИКОГДА не логируем `text`/транскрипт и тело ответа Groq —
 *     только `{ status, size, mimeType, lang, durationMs }` + booleans.
 *     Транскрипт = речь ученика, privacy-sensitive.
 *   - Таймаут через AbortController (не `AbortSignal.timeout` — единообразие
 *     с проектным cross-browser правилом, хотя это Deno-сервер).
 */

// Groq audio transcription endpoint (OpenAI-compatible).
const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

// Модель — та же, что в chat/index.ts (VOICE_TRANSCRIPTION_MODEL) и telegram-bot.
// Turbo: быстрая, мультиязычная (FR/EN/ES/RU нативно).
const WHISPER_MODEL = "whisper-large-v3-turbo";

// Per-attempt timeout. whisper-large-v3-turbo транскрибирует 7-мин аудио за
// секунды; основное время — upload файла (до MAX_VOICE_BYTES). 45s даёт запас
// на медленный мобильный upload; с 1 retry худший случай STT-шага = 90s, что
// оставляет бюджет edge-функции на последующий Gemini-грейдинг (TASK-8).
const TRANSCRIBE_TIMEOUT_MS = 45_000;

// initial attempt + 1 retry (Spec §8 / TASK-7 AC «1 retry на 5xx/network»).
const MAX_ATTEMPTS = 2;

/**
 * Хард-кап размера аудио. Single source of truth — TASK-9 переиспользует его как
 * клиентский size-cap (в паре с хард-капом длительности 7 мин, Spec §8).
 *
 * Расчёт: DELF B1 монолог 5-7 мин. 7 мин голоса:
 *   - Opus (webm) ~32kbps  ≈ 1.7 МБ
 *   - AAC (m4a)  ~128kbps  ≈ 6.7 МБ
 *   - AAC (m4a)  ~256kbps  ≈ 13.4 МБ (iOS Safari высокий битрейт)
 * 20 МБ покрывает worst-case iOS-запись с запасом и остаётся ПОД хард-лимитом
 * Groq (25 МБ) с margin 5 МБ (Spec §8 «7 мин ≈ 3-7 МБ — под лимитом Groq 25 МБ»).
 */
export const MAX_VOICE_BYTES = 20 * 1024 * 1024;

export type VoiceTranscriptionErrorCode =
  | "MISSING_API_KEY"
  | "EMPTY_AUDIO"
  | "AUDIO_TOO_LARGE"
  | "TRANSCRIPTION_FAILED";

/**
 * Типизированная ошибка транскрипции. `code` — для маппинга в HTTP-ответ
 * caller-ом (TASK-8): MISSING_API_KEY → 503, EMPTY_AUDIO/AUDIO_TOO_LARGE → 400,
 * TRANSCRIPTION_FAILED → 502. `status` — HTTP-статус от Groq (если был).
 */
export class VoiceTranscriptionError extends Error {
  readonly code: VoiceTranscriptionErrorCode;
  readonly status?: number;

  constructor(code: VoiceTranscriptionErrorCode, message: string, status?: number) {
    super(message);
    this.name = "VoiceTranscriptionError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Subject → ISO-639-1 язык для Whisper `language` параметра.
 * MVP: реально используется только `fr` (за feature-флагом). Прочие — код готов.
 * Неизвестный / нефонетический предмет (physics / maths / ...) → undefined =
 * Whisper auto-detect (поле в FormData не отправляется).
 */
export function subjectToWhisperLang(subject: string | null | undefined): string | undefined {
  if (!subject) return undefined;
  switch (subject.toLowerCase().trim()) {
    case "french":
      return "fr";
    case "english":
      return "en";
    case "spanish":
      return "es";
    case "russian":
    case "rus": // legacy subject id (см. LEGACY_SUBJECT_LABELS, src/types/homework.ts)
      return "ru";
    default:
      return undefined; // auto-detect
  }
}

// PII-free структурированный лог. Никогда не принимает text/транскрипт.
function logMeta(event: string, meta: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...meta }));
}

function voiceFilenameForMime(normalizedMime: string): string {
  // Groq инферит формат по расширению filename в multipart-части.
  // Mirror chat/index.ts::getVoiceFilename.
  if (normalizedMime.includes("ogg")) return "voice.ogg";
  if (normalizedMime.includes("mpeg") || normalizedMime.includes("mp3")) return "voice.mp3";
  if (normalizedMime.includes("mp4")) return "voice.m4a";
  if (normalizedMime.includes("wav")) return "voice.wav";
  return "voice.webm";
}

async function postToGroq(form: FormData, apiKey: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Транскрибирует аудио через Groq Whisper.
 *
 * @param audioBuffer  сырые байты аудио (m4a / webm / ogg / mp3 / wav).
 * @param opts.language  ISO-639-1 (`fr`/`en`/`es`/`ru`); undefined → auto-detect.
 * @param opts.mimeType  MIME исходного аудио (для имени файла / Blob type).
 * @returns `{ text }` — trimmed транскрипт; `''` при тишине/нераспознанном.
 * @throws  VoiceTranscriptionError при отсутствии ключа, пустом/большом буфере,
 *          или Groq-сбое после retry.
 */
export async function transcribeAudio(
  audioBuffer: ArrayBuffer,
  opts: { language?: string; mimeType: string },
): Promise<{ text: string }> {
  const { language, mimeType } = opts;

  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) {
    // НЕ логируем ключ; событие фиксируем для observability.
    logMeta("voice_transcribe_missing_key", {});
    throw new VoiceTranscriptionError("MISSING_API_KEY", "GROQ_API_KEY is not configured");
  }

  const size = audioBuffer.byteLength;
  if (size === 0) {
    throw new VoiceTranscriptionError("EMPTY_AUDIO", "Audio buffer is empty");
  }
  if (size > MAX_VOICE_BYTES) {
    throw new VoiceTranscriptionError(
      "AUDIO_TOO_LARGE",
      `Audio is ${size} bytes, exceeds MAX_VOICE_BYTES (${MAX_VOICE_BYTES})`,
    );
  }

  const normalizedMime = (mimeType || "application/octet-stream").toLowerCase().split(";")[0].trim();
  const blobType = normalizedMime || "application/octet-stream";
  const filename = voiceFilenameForMime(normalizedMime);
  const lang = language ?? null;

  let lastError: VoiceTranscriptionError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();

    // Свежая FormData на каждую попытку (надёжнее при повторной отправке).
    const form = new FormData();
    form.append("file", new Blob([audioBuffer], { type: blobType }), filename);
    form.append("model", WHISPER_MODEL);
    if (language) form.append("language", language);

    let res: Response;
    try {
      res = await postToGroq(form, apiKey, TRANSCRIBE_TIMEOUT_MS);
    } catch (_err) {
      // network error или AbortError (timeout) → retryable.
      lastError = new VoiceTranscriptionError("TRANSCRIPTION_FAILED", "Network/timeout error calling Groq");
      logMeta("voice_transcribe_network_error", {
        attempt,
        size,
        mimeType: normalizedMime,
        lang,
        durationMs: Date.now() - startedAt,
      });
      continue; // retry если остались попытки
    }

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      logMeta("voice_transcribe_ok", {
        attempt,
        status: res.status,
        size,
        mimeType: normalizedMime,
        lang,
        durationMs: Date.now() - startedAt,
        empty: text.length === 0,
      });
      return { text };
    }

    // Non-OK. Дренируем тело (освобождаем соединение), но НЕ логируем его (PII).
    await res.text().catch(() => "");
    const retryable = res.status >= 500 || res.status === 429;
    logMeta("voice_transcribe_http_error", {
      attempt,
      status: res.status,
      size,
      mimeType: normalizedMime,
      lang,
      durationMs: Date.now() - startedAt,
      retryable,
    });
    lastError = new VoiceTranscriptionError(
      "TRANSCRIPTION_FAILED",
      `Groq transcription failed with status ${res.status}`,
      res.status,
    );

    if (!retryable) {
      // 4xx (кроме 429) — постоянная ошибка, retry не поможет.
      throw lastError;
    }
    // retryable → следующая итерация (если осталась)
  }

  throw lastError ??
    new VoiceTranscriptionError("TRANSCRIPTION_FAILED", "Groq transcription failed after retries");
}
