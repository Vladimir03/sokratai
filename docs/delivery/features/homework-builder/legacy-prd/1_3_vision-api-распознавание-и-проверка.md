## 1.3 Vision API: распознавание и проверка
**Цель**: добавить multimodal распознавание рукописного ответа и AI‑проверку против эталона.

### In‑scope
- `supabase/functions/telegram-bot/homework/vision_checker.ts`
- 2 функции: `recognizeHomeworkPhoto`, `checkHomeworkAnswer`.
- Унификация вывода в строгий JSON.

### Out‑of‑scope
- Улучшение качества фото (preprocessing) — можно позже.

### Функция 1: recognizeHomeworkPhoto(imageBase64, subject)
**Вход**:
- `imageBase64: string` (без префикса data:)
- `subject: 'math'|'physics'|'history'|'social'|'english'|'cs'`

**Выход**:
- `{ recognized_text: string, confidence: number (0..1), has_formulas: boolean }`

**Правила**:
- Если участок не читается — вставляй `[неразборчиво]`.
- Для формул: LaTeX (без окружения `$$`, если не нужно).
- Ограничение длины `recognized_text` (например, 8–12k символов) и мягкое усечение.

### Функция 2: checkHomeworkAnswer(recognized, task, answer, steps, subject)
**Вход**:
- `recognized_text`
- `task_text`
- `correct_answer` (может быть null)
- `solution_steps` (может быть null)
- `subject`

**Выход (единый формат)**:
- `{ is_correct: boolean, confidence: number, score: number, feedback: string, error_type: string }`

**Правила**:
- `feedback` ученику: НЕ давать готовый ответ, только намёк/направление.
- `score` в пределах `[0..max_score]` (max_score передаём позже из task; пока можно вернуть 0/1).
- `error_type`: подмножество перечислений из 1.1.

### Технические требования
- Использовать существующий `GEMINI_API_KEY` из `Deno.env`.
- Вызов: `gemini-2.5-flash:generateContent` (или соответствующий endpoint в вашем текущем клиенте).
- Таймауты: 30–45 сек на весь запрос.
- Retries: 1 повтор при сетевой ошибке/5xx.
- Логи: писать ошибку в консоль + вернуть безопасное сообщение пользователю.

### Приёмка
- На входе одно фото → возвращается распознанный текст + confidence.
- На входе распознанный текст и задача → возвращается оценка и фидбек.
- Выход — валидный JSON (без markdown).

### Тест‑кейсы
- Чёткое фото → confidence > 0.7
- Размытое фото → confidence падает, `[неразборчиво]` присутствует
- Пустой лист → recognized_text пустой/\"[неразборчиво]\" и низкий confidence

### Инструкция для Codex/Claude
Реализуй модуль `vision_checker.ts` с двумя функциями, строго валидируй JSON (парсинг+fallback). Добавь типы TS и минимальный слой «sanitize recognized_text».

---
