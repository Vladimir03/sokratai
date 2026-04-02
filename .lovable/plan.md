

## Voice Message Transcription in Telegram Bot

### Problem
Bot currently ignores voice messages. Need to transcribe them via Lemonfox API and process as text.

### Key constraint: No ffmpeg in Edge Functions
Supabase Edge Functions run in Deno isolate — no system binaries like ffmpeg. However, Lemonfox API (OpenAI-compatible) likely accepts OGG/OGA directly (Whisper-compatible APIs accept opus-in-ogg). We'll try sending OGG directly first; if it fails, we'll use a JS-based audio conversion library.

### Plan

**Step 1: Add LEMONFOX_API_KEY secret**
- Use `add_secret` tool to request the API key from user

**Step 2: Add `handleVoiceMessage()` function in `telegram-bot/index.ts`**

Logic:
1. Start typing indicator (`sendTypingLoop`)
2. Call Telegram `getFile` API to get `file_path`
3. Download OGG file from `https://api.telegram.org/file/bot{token}/{file_path}`
4. Send to Lemonfox API as `multipart/form-data` (file + `language=ru`)
5. On success: send transcription preview to user, then call `handleTextMessage()` with transcribed text
6. On failure: send error message, stop

Message format:
```
🎤 Расшифровка: "{transcribed text}"
```
Then the AI response follows as usual (via `handleTextMessage`).

**Step 3: Wire into message dispatch** (after photo handler, before final return ~line 8546)

Add block:
```
if (update.message?.voice) {
  // get session, check onboarding_state === 'completed'
  // call handleVoiceMessage(telegramUserId, session.user_id, update.message.voice)
}
```

### Technical details

- Voice messages in Telegram arrive as `update.message.voice` with `file_id`, `duration`, `mime_type` (usually `audio/ogg`)
- Lemonfox API is OpenAI-compatible — should accept OGG opus directly (no conversion needed)
- File download: `fetch(fileUrl)` → `arrayBuffer()` → build `FormData` with `Blob`
- Duration shown in user-facing message: `voice.duration` seconds
- `input_method: 'voice'` saved in `chat_messages` for analytics
- Error handling: if transcription returns empty or API fails → friendly message to user

### Files modified
- `supabase/functions/telegram-bot/index.ts` — add `handleVoiceMessage()` + dispatch block
- Secret: `LEMONFOX_API_KEY`

### Not changing
- `handleTextMessage` — reused as-is after transcription
- Frontend — no changes
- Database — no schema changes (existing `input_method` column used)

