# Handoff: Чат с Сократом по задаче ДЗ (Сократ AI)

## Overview

Это **дизайн-макет экрана решения задачи внутри домашнего задания** в Сократ AI — основной обучающей поверхности продукта.

Экран совмещает **две взаимодополняющие активности**:

1. **Сократический диалог с ИИ** — чат, в котором Сократ помогает наводящими вопросами (никогда не даёт готовый ответ).
2. **Сдача решения** — отдельный flow, в котором ученик отправляет числовой ответ + фото решения от руки + (опционально) текст и голос. Только это идёт на проверку и засчитывается в баллы.

Реализовано в трёх форм-факторах: **mobile (390px) / tablet (1024px) / desktop (1440px+)**. Все три используют один и тот же `SubmitSheet` для сдачи решения — разница только в чате и контекстной панели задачи.

## About the Design Files

Файлы в этом пакете — **дизайн-референс на HTML/React**. Это интерактивный прототип, показывающий нужное поведение и визуал, **не production-код для копирования**.

Задача — **воспроизвести этот дизайн в существующем кодстеке** Сократ AI (Vite + React 18 + TS + shadcn-ui + Tailwind + Supabase, репозиторий `Vladimir03/sokratai`), используя его компоненты, токены и паттерны. Текущая ветка имеет:

- Tailwind с уже задекларированной палитрой `socrat-*` (зелёный + охра).
- Компоненты shadcn-ui (Button, Input, Textarea, Sheet, Dialog).
- Supabase для хранения и аутентификации.
- gemini-3-flash как ИИ-проверщик решений (см. § Business logic).

Не таскайте классы `.s-*`, `.ch-*`, `.subm-*`, `.pc-*` в продакшн — это helper-классы дизайн-системы, в проде должны стать Tailwind-классы или shadcn-компоненты с теми же визуальными значениями.

## Fidelity

**High-fidelity.** Цвета, типографика, отступы, радиусы, тени, анимации заданы точно — воспроизводите пиксель-в-пиксель, маппя на shadcn/Tailwind. Копи (тексты) в макете — финальная, на русском, в стиле «ты» (см. tone of voice ниже).

---

## Screens / Layouts

### Layout 1 — Mobile (`<= 768px`)

Чат-доминирующий экран. Контекст задачи свёрнут в peek-карточку сверху, диалог занимает всё пространство, композер фиксирован снизу.

**Структура (вертикально):**

| # | Блок | Высота | Назначение |
|---|---|---|---|
| 1 | Topbar | 56px | ← / название ДЗ + предмет |
| 2 | ProblemContext (collapsed) | ~120px | step-индикатор 1–9 + "Задача 3 из 9 / 2 из 2 баллов" + "Показать задачу" |
| 3 | Чат-поток | flex: 1 | Сообщения, AI крупнее (с аватаром + кикером "Сократ"), ученик — компактнее, серым |
| 4 | ComposerMobile | ~120px | большая зелёная CTA "Сдать решение задачи" + строчка инпута чата |

**Topbar (mobile):**
- Высота 56px, `bg: var(--sokrat-card)`, нижняя граница 1px `--sokrat-border-light`.
- Слева: `<` chevron-left 22px в круглой ghost-кнопке 40×40, hover: `bg: var(--sokrat-surface)`.
- Центр: 2 строки. Eyebrow `12px / 600 / fg3` "Задача 3 / 9 · Физика". Title `16px / 700 / fg1` — название ДЗ.
- ⚠ Никаких "..." или других trailing-кнопок в шапке (намеренно убраны).

**ProblemContext (peek):**
- Степ-индикатор задач: 9 кругов 28×28, gap 8, между ними `—` connector 8px шириной, цвет `--sokrat-border`.
  - `done`: bg green-700, белая галочка.
  - `current`: bg green-100, обводка 2px green-700, цифра `--sokrat-green-800 / 700`.
  - `pending`: bg `--sokrat-border-light`, цифра `--sokrat-fg3 / 600`.
- Под индикатором ряд: `12px 600 fg3` "Задача 3 из 9" + `13px 700 green-800` "2 / 2 баллов" + справа кнопка "Показать задачу / Свернуть" (chevron).
- Раскрытое состояние добавляет: текст условия (15px / 1.55 / fg1), вопрос (15px / 700 / fg1), блок "Дано / Найти" (KaTeX inline math), warn-баннер `bg ochre-100, border-left 3px ochre-500`: «Это задача с развёрнутым решением — покажи ход рассуждений.»

**Чат-поток:**
- Padding 16px, gap 14px между сообщениями.
- **AI bubble (большой акцент):** аватар 32×32 (см. SokratAvatar) слева, рядом колонка:
  - kicker `11px / 700 / uppercase / letter-spacing 0.05em / green-700` — "Сократ".
  - bubble: `bg #FFFFFF, border 1px --sokrat-border-light, border-radius 16px (углы) / 6px (нижний-левый), padding 12px 14px, font-size 15px, line-height 1.55, color fg1, max-width 86%`.
  - Опционально quote-attachment: внутри bubble маленькая карточка `bg --sokrat-surface, border-left 2px green-500, font-size 12px, italic, fg2`.
- **User bubble (компактнее, справа):** без аватара, `align-self: flex-end, bg green-700, color #fff, border-radius 16px / 6px (нижний-правый), font-size 14px, padding 10px 14px, max-width 78%`.
- **System divider:** по центру, `bg --sokrat-surface, border-radius 9999px, font-size 11px / 700 / uppercase / letter-spacing 0.04em / fg3, padding 6px 12px`.
- **Typing indicator** (когда ИИ "думает"): тот же AI bubble, в bubble — `<TypingDots>` (3 точки 6×6, scale-bounce анимация 1.4s ease-in-out infinite, delay 0/0.16/0.32s, цвет green-700). Kicker дополняется: «Сократ ⟶ думает над подсказкой…».

**ComposerMobile:**
```
┌─────────────────────────────────────────┐
│  [✓] Сдать решение задачи        [↑]    │  primary CTA, bg green-700, h:56px, radius:14px
│      Ответ + фото решения от руки       │
├─────────────────────────────────────────┤
│  📎  Спроси Сократа о шаге…  🎤  [↑]   │  чат-инпут, h:48px, bg surface, radius:24px
└─────────────────────────────────────────┘
```
- CTA `Сдать решение задачи`: bg `--sokrat-green-700`, текст #fff 15/700, иконка check-circle-2 18px слева, chevron-up 14px справа. Subtitle справа 12/500 rgba(255,255,255,0.85). При наличии черновика — заменяется на `Черновик · 3 элемента`. На тапе → открывает `<SubmitSheet>`.
- Чат-инпут: `bg --sokrat-surface, border 1px --sokrat-border, radius 9999px`. Слева paperclip 18, справа mic 18 + send 36×36 (`bg green-700, color #fff, radius 50%`).

---

### Layout 2 — Tablet (`768px – 1280px`)

Split-экран 360px / остальное. Слева — задача целиком + SubmitCTA. Справа — чат.

```
┌─────────────────┬──────────────────────────────┐
│ ← Все задачи ДЗ │  ⓢ Сократ                    │
│ Физика · Колеб… │  наводит на решение, не…     │
├─────────────────┼──────────────────────────────┤
│ ProblemContext  │                              │
│ (всегда раскрыт)│  ChatThread                  │
│ + step-индикатор│  (большие сообщения)         │
│ + Дано/Найти    │                              │
│ + warn-баннер   │                              │
│                 │                              │
│                 ├──────────────────────────────┤
│                 │ Quick: 💡Подсказка 1/3       │
│                 │   Σ Формула  ❓Не понял     │
│                 │   ✓ Сдать решение            │
├─────────────────┤ 📎 [инпут_______] 🎤 [↑]    │
│ SubmitCTA bar   │                              │
│ ✓ Сдать решение │                              │
└─────────────────┴──────────────────────────────┘
```

**SubmitCTA (sticky bottom of left column):**
- `padding: 14px 18px, bg --sokrat-card, border-top 1px --sokrat-border-light`.
- Слева 2 строки: «Готов сдать решение?» 14/700 fg1 + черновик-сабтайтл 12/500 fg3.
- Справа большая кнопка: `bg green-700, h:48px, padding 0 20px, radius 12px, color #fff 15/700, gap 8, иконка check-circle-2 18, chevron-up 14, box-shadow 0 4px 14px rgba(27,107,74,0.25)`.
- Тап → открывает тот же `<SubmitSheet>` (модал-оверлей поверх всего экрана).

**Composer (tablet):**
- Quick-actions row сверху: чипы "Подсказка 1/3" / "Формула" / "Не понял" / **"Сдать решение"** (последняя — primary green, тоже открывает SubmitSheet).
- Основной ряд: paperclip + textarea-инпут + mic + send.
- Никаких "Заново / Очистить чат" — намеренно убраны.

---

### Layout 3 — Desktop (`>= 1280px`)

То же, что tablet, но левая колонка шире (460px), и в неё добавлен блок «Подсказки» (hint-ladder).

**Дополнительные элементы:**

- В topbar справа: 2 meta-чипа `clock-3 14 · «15 мин в сессии»` и `award 14 · +12 XP`.
- В правой шапке чата у "Сократ" есть AI-бэйдж: `bg green-100, color green-800, font-size 10/700, padding 2px 6px, radius 4px, letter-spacing 0.06em`.
- Блок Подсказки (под ProblemContext):
  - Заголовок: `lightbulb 16` + "Подсказки" + справа `1 из 3 открыто` (12/600 fg3).
  - Открытая подсказка: card `bg --sokrat-card, border 1px --sokrat-border-light, radius 12, padding 12 14, gap 12`. Слева бейдж-номер 24×24 круглый `bg green-100, color green-800, 12/700`.
  - Закрытая подсказка: dashed border-1px `--sokrat-border`, color fg3, иконка `lock 14` справа. Hover: `border green-700, bg green-50, color green-800`.

---

## SubmitSheet — общая для всех форм-факторов

Bottom-sheet (mobile) / centered modal (tablet+) для сдачи решения.

```
┌──────────────────────────────────────────┐
│  ╾── grab handle ──╼                     │  только mobile
│  Сдать задачу 3 из 9                 [×] │
│  Изменение энергии и начало … · 0/2 балл │
├──────────────────────────────────────────┤
│  ⓘ Развёрнутое решение: нужны и ответ,   │
│    и фото с ходом решения. Без хода — 0  │  hint baner (info-bg)
│    баллов.                               │
│                                          │
│  ① Числовой ответ              обязат.   │
│  ┌──────────────────────────┬─────────┐  │
│  │ например, 1,4            │   м/с   │  │
│  └──────────────────────────┴─────────┘  │
│                                          │
│  ② Фото решения от руки        обязат.   │
│  ┌────┐ ┌────┐ ┌────┐ ┌────────────┐    │
│  │ #1 │ │ #2 │ │ #3 │ │ + Ещё стр. │    │
│  └────┘ └────┘ └────┘ └────────────┘    │
│  Можно несколько страниц…                │
│  [📷 Камера] [🖼 Из галереи]            │
│                                          │
│  ③ Дополнить текстом         по желанию  │
│  ┌──────────────────────────────────┐   │
│  │ textarea                         │   │
│  └──────────────────────────────────┘   │
│                                          │
│  ④ Голосом                   по желанию  │
│  [● Записать голосовое объяснение]       │
│                                          │
├──────────────────────────────────────────┤
│  ☁ Черновик сохранён · 12 сек назад     │
│                                          │
│         [ Отправить на проверку ]        │  primary, disabled пока !ready
└──────────────────────────────────────────┘
```

### Таски разной природы — `taskKind`

Учитель в конструкторе ДЗ маркирует задачу одним из трёх типов:

| `taskKind` | Числовой ответ | Фото | Текст | Голос |
|---|---|---|---|---|
| `numeric` | обязателен | скрыт | по желанию | по желанию |
| `extended` (по умолчанию для ЕГЭ) | обязателен | **обязательно** | по желанию | по желанию |
| `proof` (доказательство) | скрыт | **обязательно** | по желанию | по желанию |

Кнопка `Отправить на проверку` `disabled`, пока обязательные поля не заполнены.

### PhotoStrip (мульти-страничная загрузка)

- Горизонтальный strip с тайлами 88×112px, gap 8px.
- Каждый тайл: thumbnail (object-fit cover) + бейдж номера страницы в правом-нижнем углу + delete-крестик в правом-верхнем.
- Последний тайл — `+ Сфотографировать / + Ещё страница` (dashed border, иконка камеры 22px, текст 12/600 fg2).
- Под strip две кнопки: `[📷 Камера]` (`<input type="file" capture="environment">`) и `[🖼 Из галереи]` (без `capture`).
- На десктопе вместо камеры — drag-and-drop зона (full-width dashed area, `Перетащи фото или нажми, чтобы выбрать`).

### VoiceRecorder

Mocked в дизайне. В проде — Web MediaRecorder API.
- Idle: ghost-кнопка `bg --sokrat-card, border 1px --sokrat-border, h:48, radius 12, gap 10`. Содержимое: красная точка 8×8, mic 16, label.
- Recording: `bg #FEE2E2, border red-500`, mic меняется на `square` (stop), label — счётчик `Запись… 0:12 · нажми чтобы остановить`.
- Recorded: ряд `[▶ play 28×28] [waveform] [0:14] [🗑 delete]`. Waveform — 22 столбика по 4×varH px, цвет `green-700`.

---

## Interactions & Behavior

### Сократический чат

- AI-сообщения **никогда** не идут на проверку и не влияют на баллы. Это диалог-помощь.
- При клике на AI-bubble **показать quote-attachment** если он есть (например, `положение равновесия → x = 0`).
- Typing-индикатор показывается **минимум 800ms**, даже если ответ пришёл быстрее (избегаем мерцания и подчёркиваем «обдумывание»).
- AI отвечает только при отправке нового user-message; **не реагирует на наличие фото в SubmitSheet** до момента нажатия `Отправить на проверку` (см. § Submission pipeline).

### Quick-actions в композере

| Кнопка | Действие |
|---|---|
| 💡 Подсказка 1/3 | Открывает следующую закрытую подсказку. **Бизнес-правило: каждая подсказка снимает 1 балл из максимума задачи**. Показать confirm-dialog «Открыть подсказку 2 из 3? Это снимет 1 балл» с CTA «Открыть» / «Отмена». |
| Σ Формула | Открывает math-keyboard / KaTeX inline editor для вставки формулы в инпут. |
| ❓ Не понял | Отправляет в чат предзаготовленное "Сократ, объясни ещё раз — я запутался". AI должен переформулировать предыдущую подсказку проще. |
| ✓ Сдать решение | Открывает SubmitSheet (то же, что primary CTA). |

### Submission pipeline (бизнес-логика)

```
  [User clicks "Отправить на проверку"]
         ↓
  state = "checking"  ─────────── overlay поверх SubmitSheet с шагами:
                                  ① Загружаем фото
                                  ② OCR · формулы          (Gemini 3 Flash)
                                  ③ Проверка хода решения   (Gemini 3 Flash, system prompt)
                                  ④ Подведение итогов
         ↓ (5–15 сек)
  ┌─────────┬──────────┬──────────┬────────────┐
  │ correct │ no-work  │step-error│  unclear   │
  └─────────┴──────────┴──────────┴────────────┘
```

**Состояния и их UX:**

| State | Условие от ИИ | UI |
|---|---|---|
| `correct` | answer == expected ∧ work == шаги ОК | ✅ зелёная карточка «Правильно! 2/2 баллов», +12 XP, +1 streak day, 2 кнопки: «Остаться на задаче» (ghost) / «Следующая задача» (primary). Закрытие SubmitSheet и пауза 600ms «happy moment». |
| `no-work` | answer == expected ∧ work отсутствует или формальный | ⚠ оранжевая карточка «Ответ верный, но нужен ход решения». **0 баллов**. CTA «Переснять решение» — возвращает в SubmitSheet с теми же фото в strip, но фокус на photo-блоке. |
| `step-error` | ошибка в конкретном шаге N | 🟠 карточка «Почти — споткнулся в шаге 3», подсветка фрагмента OCR-распознанного текста с шага. CTA «Обсудить с Сократом» — закрывает SubmitSheet и кладёт в чат AI-сообщение со специальным наводящим вопросом по шагу N. Балл 1/2 (частичный). |
| `unclear` *(добавить в проде)* | ИИ не уверен — например, плохое фото | "Не получилось разобрать — переснимите ровнее, без бликов". Не списывает попытку. |

**Penalty system (уже в коде кодстека):**

- Каждая открытая подсказка → `–1` балл из `taskScoreMax`.
- Поздняя сдача (после deadline) → балл умножается на коэффициент учителя (0.5 / 0 / без штрафа — настройка в конструкторе ДЗ).
- Все эти расчёты — backend, фронт только показывает уже посчитанный score.

### Автосохранение черновика (как Google Docs)

- Тригеры сохранения: `numeric onChange` (debounce 600ms), `text onChange` (debounce 1.2s), `photos.add/remove` (немедленно), `voice.record` (немедленно).
- Endpoint: `PATCH /homework/:hwId/tasks/:taskId/draft` с body `{numeric, text, photos[], voice}`.
- UI: `subm-saved` бейдж в footer SubmitSheet — иконка cloud-check + текст. Состояния:
  - `Черновик сохранён · 12 сек назад` (default)
  - `Сохраняем…` (in-flight, ≥250ms)
  - `Не сохранено · повторить` (error, click → retry)
- При навигации назад / закрытии шита черновик уже на сервере → не теряется.

### Restoring drafts

- При открытии задачи: `GET /homework/:hwId/tasks/:taskId/draft` → если есть, заполнить SubmitSheet и показать в ComposerMobile «Черновик · N элементов · 5 мин назад».
- Фото хранятся как S3 keys, восстанавливаются как presigned URLs.

### Parent notifications (новое в скоупе)

- При успешной сдаче (`correct`): push родителю с шаблоном «Артём решил задачу 3 из 9 «Изменение энергии…» — 2 балла. Streak: 7 дней 🔥».
- При `no-work` или 3-ём подряд `step-error`: push «Артёму трудно с задачей 3 — может, стоит подсказать?»
- Настройка частоты в кабинете родителя (off / digest / instant).

---

## State Management

### Per-task local state (React)

```ts
type SubmissionDraft = {
  numeric: string;        // "1,4" — храним как строку, нормализуем при отправке
  text: string;           // optional reasoning
  photos: { id: string; url: string; pageNo: number }[];
  voice: { url: string; durationSec: number } | null;
};

type ProblemChatState = {
  draft: SubmissionDraft;
  draftSavedAt: Date | null;
  draftSaveStatus: "idle" | "saving" | "saved" | "error";
  chatThread: ChatMessage[];
  chatInputDraft: string;        // не путать с submission draft
  hintsRevealed: number;          // 0..maxHints
  submitOpen: boolean;
  submitState: "idle" | "checking" | "correct" | "no-work" | "step-error" | "unclear";
  submitResult: GradedResult | null;
};
```

### Server state (Supabase / TanStack Query keys)

- `["homework", hwId, "task", taskId]` — задача + meta (taskKind, taskScoreMax, allowedHints).
- `["homework", hwId, "task", taskId, "draft"]` — черновик ученика.
- `["homework", hwId, "task", taskId, "chat"]` — история сообщений с Сократом.
- `["homework", hwId, "task", taskId, "submission"]` — последняя проверенная сдача.

### Mutations

- `submitDraft` — POST /submit; on success → invalidate `submission` + `task`. Backend дёргает Gemini 3 Flash, возвращает `GradedResult`.
- `revealHint` — POST /hint; on success → optimistic update `hintsRevealed`.
- `sendChatMessage` — POST /chat; SSE-стрим ответа Сократа.

### gemini-3-flash integration

В кодстеке уже есть подключение Gemini 3 Flash. Используется для:

1. **OCR-распознавание** фото решения → структурированный список шагов в LaTeX.
2. **Сократический диалог**: system prompt с правилом «ни в коем случае не давай ответ, только наводящие вопросы».
3. **Грейдинг сдачи**: на вход {distilled OCR, ожидаемый ответ, эталонное решение, taskKind}, на выход {state, scoreEarned, errorStepNo?, errorComment?}.

Все три — отдельные эндпоинты, не один большой prompt.

---

## Design Tokens

Все токены уже есть в `colors_and_type.css` и `student-kit/tokens.css`. Маппинг в Tailwind config — в `tailwind.config.ts` репозитория.

### Colors used in this screen

| Имя | Hex | Использование |
|---|---|---|
| `--sokrat-green-700` | `#1B6B4A` | primary CTA, AI-kicker, отправка |
| `--sokrat-green-800` | `#0F5237` | hover на primary, header-text |
| `--sokrat-green-100` | `#E8F5EE` | step-current, step-num bg, AI-badge |
| `--sokrat-ochre-500` | `#E8913A` | warn-баннер border-left, voice-recording, accent |
| `--sokrat-ochre-100` | `#FCEEDC` | warn-баннер bg, milestone bg |
| `--sokrat-card` | `#FFFFFF` | bubbles, cards |
| `--sokrat-surface` | `#F7F6F3` | page bg, system-divider, inputs bg |
| `--sokrat-border` | `#D4D2CB` | inputs border, dashed-zones |
| `--sokrat-border-light` | `#E5E5E0` | card borders, dividers |
| `--sokrat-fg1` | `#1A1816` | body text |
| `--sokrat-fg2` | `#4B4945` | secondary text |
| `--sokrat-fg3` | `#7A7771` | tertiary, captions |
| `--sokrat-state-success-bg` | `#E8F5EE` | correct verdict bg |
| `--sokrat-state-warning-bg` | `#FCEEDC` | no-work verdict bg |
| `--sokrat-state-danger-bg` | `#FEE2E2` | step-error verdict bg |

### Typography

- Family: `"Golos Text"` (уже в проде через Google Fonts), fallback `system-ui, -apple-system, sans-serif`.
- Sizes: 11 / 12 / 13 / 14 / 15 / 16 / 18 / 22 px.
- Weights: 400 / 500 / 600 / 700.
- Line-heights: 1.2 (titles), 1.4 (UI), 1.55 (body).
- Math: KaTeX для всего LaTeX.

### Spacing

- 4px base. Используются 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 32px.
- Card padding 12–20, sheet padding 16–24.

### Radii

- `sm: 8`, `md: 12`, `lg: 16`, `full: 9999`. Bubbles asymmetric (16 везде, но 6 на «хвостовом» углу).

### Shadows

- `--sokrat-shadow-xs: 0 1px 2px rgba(15,23,42,0.04)` — карточки.
- `0 4px 14px rgba(27,107,74,0.25)` — primary CTA в SubmitCTA.
- Никаких глубоких блюр-теней.

### Easing & motion

- Standard: `cubic-bezier(0.4, 0, 0.2, 1)`.
- Durations: 150–320ms; sheet-in 220ms.
- Specific:
  - Sheet bottom-up: `transform: translateY(100% → 0)` 220ms.
  - Typing dots: 1.4s ease-in-out infinite, scale `1 → 0.6 → 1`, delays 0/0.16/0.32.
  - Answerbar flash (если оставите такую анимацию): 1.1s ease-out, фон `green-100 → transparent`.
  - Verdict overlay: fade-in 200ms + scale `0.96 → 1`.

---

## Tone of Voice (копи)

- **«ты» к ученику** всегда: «Привет, Артём! Давай разберёмся вместе», «Сфотографируй решение», «Перепиши и сфотографируй заново».
- Без «вы поверите» / clickbait / fear-mongering.
- Сократ задаёт вопросы (вопросительные знаки!), не утверждает.
- Сленг ограниченно: «погнали», «хех», эмодзи 🔥 / ✅ только в celebrations.
- ALL-CAPS только для ЕГЭ / ОГЭ / ЕГЭ-ЧАСТЬ-2 (стримы и подкатегории).

---

## Files in this bundle

| Файл | Что внутри |
|---|---|
| `student-problem-chat.jsx` | Все React-компоненты экрана: `ProblemMobile`, `ProblemTablet`, `ProblemDesktop`, `Composer`, `ComposerMobile`, `SubmitCTA`, `SubmitSheet`, `PhotoStrip`, `VoiceRecorder`, `SubmitResult`, `ChatMessage`, `SokratAvatar`, `TypingDots`, `ProblemContext`. |
| `student-chat.css` | Все классы `.ch-*`, `.pc-*`, `.subm-*`, `.problem-mobile__*`, `.problem-split__*`. |
| `student-kit/tokens.css` | Helper-классы дизайн-системы (`.s-*`), используемые в макете. |
| `student-kit/primitives.jsx` | Атомы: `SIcon`, `SButton`, `SChip`, `SInlineMath`, `SFormulaBlock`, `SProgress`. |
| `colors_and_type.css` | Базовые токены — цвета, шрифты, градиенты, чувствительные к моду. |
| `Кабинет ученика — Домашка.html` | Полный родительский HTML (canvas с тремя artboard'ами, удобный референс). |
| `assets/sokrat-logo.png` | Логотип в шапке desktop. |
| `assets/sokrat-chat-icon.png` | Иконка чата (если используется в шапке). |

## Open questions / TODO для разработки

1. **Math-keyboard** для кнопки «Σ Формула» — сейчас в макете placeholder. Решите: shadcn-Popover с KaTeX-input или интеграция MathLive.
2. **Голосовое сообщение** — Web MediaRecorder в проде. Не забыть `getUserMedia({audio: true})` permissions flow.
3. **Drag-and-drop** для фото на десктопе — react-dropzone или нативный `ondrop`.
4. **SSE-стрим** ответа Сократа в чате — после первого AI-токена скрыть `Сократ думает над подсказкой…` и показывать прогрессивно.
5. **Offline-режим** — сейчас не покрыт макетом. Если ученик потеряет сеть на середине ввода, локальный draft в IndexedDB должен синкнуться при возврате.
6. **A11y**: SubmitSheet нужны `role="dialog"`, `aria-labelledby`, focus-trap. Verdict-карточки — `role="status"` с `aria-live="polite"` для loading и `aria-live="assertive"` для verdict.
7. **Tablet breakpoint** — макет показывает один tablet-лэйаут, но real-product может потребовать 2 (768–1024 + 1024–1280). Договоритесь о breakpoint-стратегии.
