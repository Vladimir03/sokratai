# Feature Spec: Hint Quality + ban шаблона «перечитай условие» (Е10)

**Версия:** v0.1
**Дата:** 2026-04-06
**Автор:** Vladimir
**Статус:** draft

---

## 0. Job Context (обязательная секция)

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Школьник (B2C) | S1: Разобраться в задаче и закрыть пробел | S1-1: Получить направляющую подсказку, а не готовый ответ | `...#S1` |
| Школьник (B2C) | S1 | S1-2: Не застрять на шаге и не бросить ДЗ | `...#S1` |
| Репетитор (B2B) | R1: Проверка ДЗ и разбор ошибок | R1-3: Делегировать «первую линию объяснений» AI, сохранив качество | `...#R1` |

### Wedge-связка

- **B2B-сегмент:** B2B-1 (репетитор физики ЕГЭ/ОГЭ)
- **B2C-сегмент:** S1 (школьник-финишёр)
- **Score матрицы:** высокий — плохой hint = главный churn-риск для ученика

### Pilot impact

Live signal Егора (2026-04-06): *«Ученики ненавидят "Попробуй перечитать условие задачи и выделить ключевые данные" — AI шлёт это слишком часто»*. Если hint остаётся шаблонным — ученик бросает guided chat, репетитор теряет core value prop и не платит 2000 ₽ после 15 апреля.

---

## 1. Summary

Перепиливаем prompt и логику `generateHint` в `supabase/functions/homework-api/guided_ai.ts` так, чтобы AI:
1. Никогда не использовал no-op шаблоны типа «перечитай условие», «выдели ключевые данные», «подумай внимательнее»
2. Давал content-specific подсказку, ссылающуюся на конкретные величины, законы и формулы из текущей задачи
3. Эскалировал подсказку по 3-ступенчатой лестнице: nudge → hint → big hint (на основе количества уже полученных hint'ов по задаче)

---

## 2. Problem

### Текущее поведение
`generateHint` в `guided_ai.ts` возвращает generic сократические фразы. В production наблюдается повторяющийся текст *«Попробуй перечитать условие задачи и выделить ключевые данные»* — это no-op (ученик уже это сделал) и воспринимается как отписка.

### Боль
- **Ученик**: фраза воспринимается как «AI тупой», теряет доверие, бросает задачу → метрика completion падает
- **Репетитор**: видит одинаковые хинты в thread viewer, теряет доверие к продукту → отказ платить
- **Продукт**: Khanmigo и Умскул дают физически-содержательные подсказки → сравнение не в нашу пользу

### Текущие «нанятые» решения
- Ученик пишет репетитору в Telegram «AI не помогает»
- Репетитор объясняет лично, AI-hint игнорируется

---

## 3. Solution

### Описание

**Компонент 1 — prompt-патч** (deploy сегодня, 6 апр):
- Добавить явный `FORBIDDEN_PHRASES` блок в system prompt для `generateHint`: запрет фраз-шаблонов
- Добавить positive instruction: «подсказка ОБЯЗАНА упоминать конкретную физическую величину, закон или формулу из этой задачи»
- Если модель не может дать содержательную подсказку без условия задачи — лучше вернуть короткий вопрос о конкретной величине, чем шаблон

**Компонент 2 — 3-ступенчатая лестница** (deploy 7-8 апр):
- Counter `hint_count` по task_state (уже есть? если нет — добавить)
- Level 1 (nudge): «какая величина здесь ключевая — и почему?»
- Level 2 (hint): «вспомни закон X, он связывает эти величины; попробуй записать»
- Level 3 (big hint): «формула выглядит так: ...; подставь свои значения»
- Escalation строго монотонная: следующий hint ≥ предыдущего по уровню

### Ключевые решения
- **Deterministic ban list**: проверять ответ модели regex'ом на запрещённые фразы; если сматчились — регенерировать с усиленным промптом (1 retry, не больше)
- **Content-specificity check (minimal)**: если hint < 40 символов или не содержит ни одного слова из условия задачи (rough heuristic) — регенерировать 1 раз
- **Level escalation в промпте, не в отдельных функциях**: один `generateHint` с параметром `level`, чтобы не дублировать логику передачи изображений
- **Сохраняем character**: Сократический стиль остаётся, но только на Level 1

### Scope

**In scope:**
- Prompt-патч в `buildGuidedSystemPrompt('hint', ...)` и `generateHint` (`guided_ai.ts`)
- `FORBIDDEN_PHRASES` constant + регенерация при matching
- `hint_count` по task_state (добавить колонку или использовать существующую метрику из messages)
- 3-ступенчатая лестница с level escalation
- Unit-level smoke test: 5 задач из KB × 3 уровня hint → ручная проверка

**Out of scope:**
- ML-based content quality check
- RLHF / fine-tuning
- Персонализация hint'ов под ученика
- Hint history UI для репетитора (увидит в thread viewer через Е9)
- Изменение UX в `GuidedChatInput` (кнопка Hint уже есть)

---

## 4. User Stories

### Школьник
> Когда я застрял на задаче по физике и прошу подсказку, я хочу получить конкретный nudge про величину или закон из этой задачи, а не «перечитай условие», чтобы не чувствовать что AI меня отфутболивает.

### Репетитор
> Когда я смотрю thread viewer ученика, я хочу видеть что AI даёт содержательные подсказки по моей задаче, чтобы доверять делегированию первой линии объяснений.

---

## 5. Technical Design

### Затрагиваемые файлы
- `supabase/functions/homework-api/guided_ai.ts` — `generateHint`, `buildGuidedSystemPrompt('hint')`, новая константа `FORBIDDEN_HINT_PHRASES`, новая функция `validateHintContent`
- `supabase/functions/homework-api/index.ts` — `handleRequestHint`: передать текущий `hint_count` в `generateHint`, инкрементировать после успешной генерации
- `src/components/homework/GuidedHomeworkWorkspace.tsx` — без изменений UI, но `requestHint()` может принять/вернуть level (optional)
- **Миграция (опционально)**: `alter table homework_tutor_task_states add column hint_count integer not null default 0`
- **НЕ трогать**: student frontend UI, tutor UI, DB для messages

### Data Model
```sql
-- Только если колонки ещё нет:
alter table public.homework_tutor_task_states
  add column if not exists hint_count integer not null default 0;
```
Alternative (no migration): COUNT `homework_tutor_thread_messages WHERE role='assistant' AND message_kind='hint' AND task_order=?`. Предпочтительно — миграция, дешевле при каждом hint.

### Prompt structure (hint system prompt)

```
Ты — физик-наставник. Ученик просит подсказку по задаче ЕГЭ/ОГЭ.

УРОВЕНЬ ПОДСКАЗКИ: {level}/3
- Level 1 (nudge): одним коротким вопросом направь внимание на ключевую величину или закон
- Level 2 (hint): назови закон/формулу, которые применимы, но не решай за ученика
- Level 3 (big hint): покажи формулу с подстановкой, но не вычисляй финальный ответ

КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать фразы:
- «перечитай условие»
- «выдели ключевые данные»
- «подумай внимательнее»
- «вспомни материал»
- «что тебе дано в задаче»
- любые общие фразы без привязки к физике этой задачи

ОБЯЗАТЕЛЬНО:
- Упоминай конкретную величину (скорость, ускорение, сила трения, напряжение, ...) или закон (Ньютон, Ом, Кирхгоф, ...) из ЭТОЙ задачи
- Если задача на изображении и текст пустой — опиши что видишь и дай подсказку по видимым величинам
- Длина: 1-3 предложения, без воды

КОНТЕКСТ ЗАДАЧИ: {task_text / task_image}
ПРЕДЫДУЩИЕ ПОДСКАЗКИ по этой задаче: {prior_hints}
ТЕКУЩЕЕ РЕШЕНИЕ УЧЕНИКА: {student_latest}
```

### Post-generation validation
```ts
const FORBIDDEN_HINT_PHRASES = [
  /перечитай\s+условие/i,
  /выдели\s+ключев/i,
  /подумай\s+внимательн/i,
  /вспомни\s+материал/i,
  /что\s+тебе\s+дано/i,
];

function validateHintContent(text: string): { ok: boolean; reason?: string } {
  for (const rx of FORBIDDEN_HINT_PHRASES) {
    if (rx.test(text)) return { ok: false, reason: `forbidden:${rx.source}` };
  }
  if (text.trim().length < 40) return { ok: false, reason: 'too_short' };
  return { ok: true };
}
```

Flow: `generate → validate → if !ok → regenerate ONCE with explicit "ты нарушил правило, вот забаненная фраза, переделай" → if still !ok → log + return fallback nudge that references at least one noun from task_text`.

### API
`handleRequestHint` возвращает тот же формат. Внутри — передаёт `hint_count` в `generateHint(level = min(hint_count + 1, 3))`.

### Миграции
1 миграция (опциональна, см. выше).

---

## 6. UX / UI

Без изменений. Hint появляется в чате как обычное assistant-сообщение с `message_kind='hint'`.

### UX-принципы (doc 16)
- «AI = draft + action»: hint — это draft-подсказка, action = следующая попытка ученика
- Сократический стиль сохраняем только на Level 1

### UI-паттерны (doc 17)
- Без изменений

---

## 7. Validation

### Как проверяем успех?
- **Leading (3 дня)**: 0 жалоб Егора на «перечитай условие»; в Supabase log'ах `forbidden:` matches → 0 за сутки после деплоя (после валидации); ручной sample 20 hint'ов из production thread messages — все ссылаются на физику задачи
- **Lagging (2 недели)**: hint-to-correct rate вырос (сейчас baseline = ?); Егор в еженедельном фидбеке упоминает «подсказки стали лучше»

### Связь с pilot KPI
Doc 18: «student task completion rate», «tutor trust in AI delegation». Оба KPI напрямую зависят от качества hint.

### Smoke check
```bash
npm run lint && npm run build && npm run smoke-check
```
Плюс manual QA:
1. Открыть ДЗ с 3 разными задачами (механика, электричество, задача на фото)
2. Запросить 3 hint'а подряд на каждой → проверить escalation и отсутствие шаблонов
3. Открыть thread viewer репетитора → убедиться что hint'ы осмысленные

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| Gemini/Lovable gateway игнорирует FORBIDDEN список | Средняя | Post-gen validation + 1 retry + fallback |
| Регенерация удваивает latency | Средняя | Retry только 1 раз; logging matches частоты регенерации |
| Level 3 даёт слишком много, ученик просто списывает | Средняя | Формула с подстановкой, но без финальных вычислений; Level 3 доступен только после двух предыдущих hint'ов |
| Fallback hint тоже шаблонный | Низкая | Fallback строится из noun из task_text + «какая эта величина и откуда её найти» |
| Hint не учитывает изображение задачи | Высокая | Переиспользовать existing image resolution path (`task_image_url` → signed → data URL), уже есть в `generateHint` |

### Открытые вопросы
1. Миграция `hint_count` vs COUNT-based — решаю при реализации (blocking: нет)
2. Fallback формулировка — нужен список noun из физики; можно brute-force RegExp extract

---

## 9. Implementation Tasks

### Phase A — Prompt patch (сегодня, 6 апр)
- [ ] Добавить `FORBIDDEN_HINT_PHRASES` в `guided_ai.ts`
- [ ] Обновить `buildGuidedSystemPrompt('hint', ...)` — новый prompt с запретами и обязательными полями
- [ ] Добавить `validateHintContent` + 1 retry в `generateHint`
- [ ] Fallback hint generator (простой — использует первое существительное из task_text)
- [ ] Deploy через Lovable (edge function)
- [ ] Manual QA на 3 задачах

### Phase B — Level escalation (7-8 апр)
- [ ] Миграция `hint_count` (или COUNT-based helper)
- [ ] `handleRequestHint` читает `hint_count`, передаёт `level`
- [ ] Инкремент `hint_count` после успешной генерации
- [ ] Level-specific guidance в prompt
- [ ] Smoke test 5 задач × 3 уровня

### Phase C — Monitoring (9 апр)
- [ ] Supabase log query: `forbidden:` matches, `too_short` matches, retry rate
- [ ] Ручной sample 20 production hints

---

## Parking Lot

- Content-specificity check через embeddings (task vs hint similarity) — revisit: если regex-ban не хватает
- Персонализация hint под уровень ученика (из his historical answers) — revisit: после 15 апр
- Hint ratings от ученика (thumbs up/down) — revisit: после Phase B, если нужен feedback loop

---

## Checklist перед approve

- [x] Job Context заполнен (S1-1, S1-2, R1-3)
- [x] Привязка к Core Jobs
- [x] Scope чёткий
- [x] UX-принципы учтены
- [x] Pilot impact описан
- [x] Метрики (leading + lagging)
- [x] High-risk файлы не затрагиваются (только guided_ai.ts + index.ts homework-api)
- [x] Student/Tutor изоляция сохранена
