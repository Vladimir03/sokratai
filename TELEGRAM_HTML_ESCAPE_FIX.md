# 🐛 Исправление ошибки парсинга HTML в Telegram Bot

## Проблема

При нажатии кнопки "План решения" в Telegram боте пользователь получал ошибку:
```
❌ Произошла ошибка. Попробуй ещё раз.
```

### Логи ошибки

```json
{
  "error": "Bad Request: can't parse entities: Unsupported start tag \"0).\" at byte offset 674"
}
```

### Причина

Функция `formatForTelegram` **НЕ экранировала HTML спецсимволы** (`<`, `>`, `&`) перед отправкой в Telegram API.

Если AI ответ содержал математические выражения или текст со спецсимволами:
- `a < b` — Telegram парсил `<` как начало HTML тега
- `0) a > b` — Telegram считал `>` концом несуществующего тега
- `A & B` — Невалидная HTML entity

**Пример проблемного текста:**
```
**План решения:**

0) Сравни a < b
1) Найди x > 0
```

**Что видел Telegram API:**
```html
<b>План решения:</b>

0) Сравни a < b      ← ❌ Невалидный HTML!
1) Найди x > 0       ← ❌ Невалидный HTML!
```

**Ошибка:** `Unsupported start tag "0)."` — Telegram решил, что `0).` это HTML тег.

---

## Решение

### 1. Добавлена функция `escapeHtml`

```typescript
/**
 * Escapes HTML special characters to prevent Telegram API parsing errors
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')   // & → &amp;
    .replace(/</g, '&lt;')    // < → &lt;
    .replace(/>/g, '&gt;');   // > → &gt;
}
```

### 2. Обновлена функция `formatForTelegram`

**БЫЛО:**
```typescript
function formatForTelegram(text: string): string {
  let result = convertMarkdownHeadings(text);
  result = convertMarkdownLists(result);
  result = preprocessLatex(result);
  result = convertLatexToUnicode(result);
  result = addBlockSpacing(result);
  result = convertMarkdownToTelegramHTML(result);  // ← HTML символы НЕ экранированы!
  return result;
}
```

**СТАЛО:**
```typescript
function formatForTelegram(text: string): string {
  let result = convertMarkdownHeadings(text);
  result = convertMarkdownLists(result);
  result = preprocessLatex(result);
  result = convertLatexToUnicode(result);
  result = addBlockSpacing(result);

  // ✅ ДОБАВЛЕНО: Экранирование HTML перед конвертацией markdown
  result = escapeHtml(result);

  result = convertMarkdownToTelegramHTML(result);
  return result;
}
```

### 3. Упрощена функция `convertMarkdownToTelegramHTML`

Теперь функция НЕ вызывает `escapeHtml` внутри, т.к. текст уже экранирован:

```typescript
function convertMarkdownToTelegramHTML(text: string): string {
  let result = text;

  // Bold: **text** → <b>text</b>
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Italic, code, strikethrough...

  return result;  // Без дополнительного escapeHtml!
}
```

---

## Как это работает

### Пример 1: Текст с математическими операторами

**Входной текст:**
```
**План решения:**

0) Сравни a < b
1) Найди x > 0
```

**После escapeHtml:**
```
**План решения:**

0) Сравни a &lt; b
1) Найди x &gt; 0
```

**После convertMarkdownToTelegramHTML:**
```html
<b>План решения:</b>

0) Сравни a &lt; b
1) Найди x &gt; 0
```

**Telegram API принимает:** ✅ Валидный HTML

### Пример 2: Жирный текст с амперсандом

**Входной текст:**
```
**Шаг 1:** A & B
```

**После escapeHtml:**
```
**Шаг 1:** A &amp; B
```

**После convertMarkdownToTelegramHTML:**
```html
<b>Шаг 1:</b> A &amp; B
```

**Telegram API принимает:** ✅ Валидный HTML

---

## Дополнительные улучшения

### 1. Улучшено логирование ошибок

**В `sendTelegramMessage`:**
```typescript
if (!response.ok) {
  const error = await response.text();
  console.error('❌ Telegram API error:', error);
  console.error('📝 Message preview (first 200 chars):', text.substring(0, 200));
  console.error('📊 Message length:', text.length);
  throw new Error('Failed to send message');
}
```

### 2. Улучшено логирование парсинга

**В `parseSolutionSteps`:**
```typescript
console.log(`📊 Parsed ${steps.length} steps from AI response`);
if (steps.length > 0) {
  console.log('📋 Step titles:', steps.map(s => `${s.number}. ${s.title}`).join(' | '));
}
```

**В `saveSolution`:**
```typescript
console.log('💾 Saving solution...');
console.log('📏 AI response length:', aiResponse.length, 'chars');
console.log('📝 Preview:', aiResponse.substring(0, 150) + '...');

console.log(`✅ Parsing complete: ${solutionSteps.length} steps found`);
console.log('📋 Titles:', solutionSteps.map((s, i) => `${i + 1}:"${s.title}"`).join(', '));
console.log('🎯 Final answer:', finalAnswer ? `"${finalAnswer.substring(0, 50)}..."` : 'NOT FOUND');
```

---

## Тестирование

### Тест 1: Математические операторы
```javascript
const input = 'Найди x: x > 5 и x < 10';
const output = formatForTelegram(input);
// Output: "Найди x: x &gt; 5 и x &lt; 10"
// ✅ Корректно экранировано
```

### Тест 2: Жирный текст с спецсимволами
```javascript
const input = '**Формула:** a < b & c > d';
const output = formatForTelegram(input);
// Output: "<b>Формула:</b> a &lt; b &amp; c &gt; d"
// ✅ HTML теги валидны, содержимое экранировано
```

### Тест 3: Нумерованный список
```javascript
const input = '**План решения:**\n\n0) a < b';
const output = formatForTelegram(input);
// Output: "<b>План решения:</b>\n\n0) a &lt; b"
// ✅ Telegram API примет без ошибок
```

---

## Влияние на пользователей

### До исправления:
- ❌ Кнопка "План решения" вызывала ошибку
- ❌ Любой текст с `<`, `>`, `&` приводил к сбою
- ❌ Пользователи не могли получить решение

### После исправления:
- ✅ Кнопка "План решения" работает корректно
- ✅ Математические выражения (`a < b`, `x > 0`) отображаются правильно
- ✅ Все спецсимволы экранируются автоматически
- ✅ Улучшенные логи для отладки будущих проблем

---

## Измененные файлы

1. **`supabase/functions/telegram-bot/index.ts`:**
   - Добавлена функция `escapeHtml` (строка 823)
   - Обновлена `convertMarkdownToTelegramHTML` (строка 834)
   - Обновлена `formatForTelegram` (добавлен шаг экранирования, строка 880)
   - Улучшено логирование в `sendTelegramMessage` (строка 112)
   - Улучшено логирование в `parseSolutionSteps` (строка 1208)
   - Улучшено логирование в `saveSolution` (строка 1228)

---

## Статус

✅ **Исправлено**
✅ **Протестировано**
⏳ **Готово к деплою**

---

## Следующие шаги

1. ✅ Commit изменений
2. ✅ Push в репозиторий
3. ⏳ Deploy edge function `telegram-bot` в Supabase
4. ⏳ Тестирование на реальных пользователях

---

## Команды для деплоя

```bash
# Deploy telegram-bot edge function
supabase functions deploy telegram-bot

# Проверить логи после деплоя
supabase functions logs telegram-bot --follow
```

---

## Дополнительная информация

### Telegram HTML Parser

Telegram поддерживает ограниченный набор HTML тегов:
- `<b>`, `<strong>` — жирный
- `<i>`, `<em>` — курсив
- `<u>`, `<ins>` — подчеркнутый
- `<s>`, `<strike>`, `<del>` — зачеркнутый
- `<code>` — моноширинный
- `<pre>` — преформатированный
- `<a href="...">` — ссылка

**Важно:**
- Все остальные символы `<`, `>`, `&` ДОЛЖНЫ быть экранированы как `&lt;`, `&gt;`, `&amp;`
- Nested теги НЕ поддерживаются (нельзя `<b><i>текст</i></b>`)
- Максимальная длина сообщения: 4096 символов

### Ссылки

- [Telegram Bot API - Formatting Options](https://core.telegram.org/bots/api#formatting-options)
- [HTML Entity Reference](https://developer.mozilla.org/en-US/docs/Glossary/Entity)
