# Hint Quality — Prompt Patch (Phase A, deploy сегодня)

**Цель:** убить шаблон «Попробуй перечитать условие задачи и выделить ключевые данные» и заставить `generateHint` давать content-specific подсказки.

**Файл:** `supabase/functions/homework-api/guided_ai.ts`

**Связанный spec:** `docs/delivery/features/hint-quality/spec.md`

---

## 1. Новая константа — в начало файла (после импортов)

```ts
// Фразы, запрещённые в hint-сообщениях. Если модель их использует —
// регенерируем 1 раз с усиленным промптом, иначе fallback.
const FORBIDDEN_HINT_PHRASES: RegExp[] = [
  /перечитай\s+услов/i,
  /прочита[йе]\s+услов/i,
  /выдели\s+ключев/i,
  /подумай\s+внимательн/i,
  /вспомни\s+материал/i,
  /что\s+тебе\s+дано/i,
  /что\s+нам\s+дано/i,
  /какие\s+данные\s+у\s+нас/i,
  /обрати\s+внимание\s+на\s+услов/i,
  /попробуй\s+ещё\s+раз/i,
];

const MIN_HINT_LENGTH = 40;

function validateHintContent(text: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = (text ?? "").trim();
  if (trimmed.length < MIN_HINT_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  for (const rx of FORBIDDEN_HINT_PHRASES) {
    if (rx.test(trimmed)) {
      return { ok: false, reason: `forbidden:${rx.source}` };
    }
  }
  return { ok: true };
}

// Последний fallback, если модель даже после retry шлёт шаблон.
// Берём первое "физическое" существительное из task_text и строим nudge.
function buildFallbackHint(taskText: string): string {
  const physNouns = [
    "скорост", "ускорен", "сил", "масс", "энерги", "импульс",
    "давлен", "температур", "заряд", "ток", "напряжен", "сопротивлен",
    "частот", "длин волн", "период", "работ", "мощност",
  ];
  const plain = (taskText ?? "").toLowerCase();
  const hit = physNouns.find((n) => plain.includes(n));
  if (hit) {
    return `Посмотри, какая величина в задаче связана со словом «${hit}» — какой закон физики её описывает? Запиши формулу и подставь то, что известно.`;
  }
  return "Назови одну физическую величину, которую ты хочешь найти, и один закон, который её описывает. С этого и начнём.";
}
```

---

## 2. Обновить `buildGuidedSystemPrompt` — ветка `'hint'`

**Старый код** (найти блок, где `mode === 'hint'` формирует system prompt) — ЗАМЕНИТЬ на:

```ts
if (mode === "hint") {
  const level = Math.min(Math.max(params.hintLevel ?? 1, 1), 3);
  const levelInstruction = {
    1: "Level 1 (nudge): одним коротким вопросом направь внимание на ключевую физическую величину или закон из этой задачи. Не называй формулу прямо.",
    2: "Level 2 (hint): назови закон или формулу, которые применимы к этой задаче, и подскажи, какие величины в них подставить. Не решай за ученика.",
    3: "Level 3 (big hint): напиши формулу с подстановкой известных величин, но НЕ вычисляй финальный ответ. Оставь последний шаг ученику.",
  }[level];

  return [
    "Ты — физик-наставник в сервисе SokratAI. Ученик 16-18 лет готовится к ЕГЭ/ОГЭ по физике и просит подсказку по текущей задаче.",
    "",
    `УРОВЕНЬ ПОДСКАЗКИ: ${level}/3`,
    levelInstruction,
    "",
    "КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать фразы:",
    "- «перечитай условие», «прочитай условие»",
    "- «выдели ключевые данные»",
    "- «подумай внимательнее»",
    "- «вспомни материал»",
    "- «что тебе дано в задаче», «какие данные у нас»",
    "- «обрати внимание на условие»",
    "- «попробуй ещё раз»",
    "- любые общие сократические фразы без привязки к физике ИМЕННО этой задачи.",
    "",
    "ОБЯЗАТЕЛЬНО:",
    "- Упомяни конкретную физическую величину (скорость, ускорение, сила трения, напряжение, заряд, ...) ИЛИ конкретный закон (Ньютон, Ом, Кирхгоф, закон сохранения энергии, ...) из ЭТОЙ задачи.",
    "- Если задача на изображении и текст пустой — опиши что видишь и дай подсказку по видимым величинам.",
    "- Если у тебя недостаточно контекста — всё равно дай содержательный вопрос про физику, а не шаблон.",
    "- Длина: 1-3 предложения, без воды, без приветствий, без «давай подумаем вместе».",
    "- Не повторяй предыдущие подсказки — эскалируй, если ученик уже просил hint.",
    "",
    "КОНТЕКСТ ЗАДАЧИ будет в user-сообщении ниже.",
  ].join("\n");
}
```

> **Примечание:** параметр `hintLevel` нужно протянуть в `GenerateHintParams` (Phase B). Для **Phase A (сегодня)** допустимо использовать `level = 1` по умолчанию и не трогать сигнатуру — главное убить шаблонные фразы.

---

## 3. Обновить `generateHint` — добавить validation + retry + fallback

Внутри `generateHint`, после получения ответа модели (`rawText = response...`), ЗАМЕНИТЬ прямой `return rawText` на:

```ts
const firstCheck = validateHintContent(rawText);
if (firstCheck.ok) {
  return rawText;
}

console.warn("[generateHint] first attempt invalid:", firstCheck.reason, {
  taskOrder: params.taskOrder,
  preview: rawText?.slice(0, 120),
});

// Retry once with explicit correction
const retryMessages = [
  ...messages,
  {
    role: "assistant" as const,
    content: rawText,
  },
  {
    role: "user" as const,
    content:
      `Ты нарушил правило: твоя подсказка содержит запрещённый шаблон или слишком короткая (причина: ${firstCheck.reason}). ` +
      "Перепиши подсказку так, чтобы она явно упоминала конкретную физическую величину или закон из этой задачи. " +
      "1-3 предложения, без общих фраз.",
  },
];

const retryResponse = await callAiGateway({
  ...aiRequestBase,
  messages: retryMessages,
});
const retryText = extractTextFromResponse(retryResponse);
const secondCheck = validateHintContent(retryText);
if (secondCheck.ok) {
  return retryText;
}

console.error("[generateHint] retry also invalid, using fallback:", secondCheck.reason, {
  taskOrder: params.taskOrder,
});

return buildFallbackHint(params.taskText ?? "");
```

> Замени `callAiGateway`, `aiRequestBase`, `extractTextFromResponse` на актуальные имена из текущего файла — это структурная подсказка, а не copy-paste без контекста.

---

## 4. Verify перед деплоем

```bash
cd sokratai
npm run lint
npm run build
npm run smoke-check
```

## 5. Manual QA checklist (после deploy Lovable)

- [ ] Открыть test ДЗ с задачей на механику → запросить hint → получить что-то про силу/скорость/закон Ньютона
- [ ] Открыть ДЗ с электричеством → hint должен ссылаться на ток/напряжение/Ом
- [ ] Открыть ДЗ с задачей только на фото → hint не должен быть шаблоном
- [ ] Проверить логи Supabase edge function: нет `[generateHint] first attempt invalid` в массовом объёме (≤ 10% ок, >30% = prompt плохо работает)
- [ ] Отправить Егору скриншот 3 новых hint'ов из его пилота

## 6. Откат

Если регенерация удваивает latency критично — temporarily убрать retry блок, оставить только validation + fallback (fallback длинной не менее 40 символов, не триггерит forbidden).

## 7. Phase B (7-8 апр)

- Колонка `hint_count` в `homework_tutor_task_states`
- `handleRequestHint` читает `hint_count`, передаёт `hintLevel = min(hint_count + 1, 3)`
- Inc `hint_count` после успешной генерации
- Level-specific escalation уже в prompt (см. §2)
