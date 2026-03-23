


## Plan: Fix Telegram Bot Silent Failures

### Status: DONE ✅

### Changes made in `supabase/functions/telegram-bot/index.ts`:

1. **`compactHistoryForTelegram()`** — новая функция, обрезает историю до 8 сообщений и оставляет `image_url` только у последнего user-сообщения с картинкой. Предотвращает раздувание payload при множественных фото.

2. **`fetchChatWithTimeout()`** — обёртка над fetch к `/functions/v1/chat` с 55-секундным AbortController timeout. При таймауте или сетевой ошибке отправляет ученику fallback-сообщение со ссылкой на сайт вместо молчания.

3. **`handleTextMessage`** — использует compact history + timeout fetch.

4. **`handlePhotoMessage`** — использует compact history + timeout fetch. Signed URL обновляются только для оставшихся после компактизации сообщений.

5. **Диагностические логи** — оба handler'а логируют rawCount, compactedCount, imagesKept.

### Не затронуто:
- `chat/index.ts` — без изменений
- `guided_ai.ts` — без изменений  
- Guided homework flow — не затронут (использует отдельные поля `studentImageUrls`/`taskImageUrl`)
- Фронтенд — без изменений
