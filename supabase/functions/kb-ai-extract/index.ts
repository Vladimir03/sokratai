// kb-ai-extract — AI-загрузка задач (P0, extract-only).
// Spec: docs/delivery/features/kb-ai-task-loader/{spec.md §5, prompts.md §2/§3, tasks.md TASK-1/2}.
//
// This function ONLY extracts draft tasks from raw material (text + ≤10 photos)
// and returns them. It NEVER writes to the database — the client commits the
// selected drafts via the existing `insertTask` path (rule 40 dual-write-path).
//
// verify_jwt=true (gateway rejects anon). userId resolved via GoTrue, then the
// function works under service_role. Ownership: kb_folders.owner_id === userId.
// Errors: flat { error: <рус>, code } (rule 97). Logs: counts/status only — NEVER
// task text / answers / emails / names (rule 40 telemetry-convention; no PII).
//
// Images: client uploads pasted screenshots to bucket `kb-attachments` first and
// sends storage:// refs; we resolve ref → signed URL (service_role) → base64 and
// inject as multimodal image parts. `storage://` is NEVER sent to the AI as text.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  callLovableJson,
  inlineImageUrlToBase64,
  type LovableImagePart,
  type LovableMessage,
  type LovableTextPart,
} from "../_shared/ai-lovable.ts";
import { serializeAttachmentUrls } from "../_shared/attachment-refs.ts";
// ai-usage-logging (2026-07-06): source='kb_extract'. Observability only.
import { makeUsageLogger, type TokenUsage } from "../_shared/token-usage.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const KB_ATTACHMENTS_BUCKET = "kb-attachments";
const MAX_IMAGES = 10; // cost/latency cap per call (mirror client Ctrl+V cap)
const MAX_TEXT_CHARS = 60_000; // defensive cap on pasted material
const SIGNED_URL_TTL_SEC = 3600;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ANSWER_CONFIDENCE = new Set(["high", "medium", "low"]);
const VALID_ANSWER_FORMAT = new Set(["number", "text", "detailed", "matching", "choice"]);
const VALID_CHECK_FORMAT = new Set(["short_answer", "detailed_solution"]);
const VALID_EXAM = new Set(["ege", "oge"]);

const FALLBACK_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

// ─── System prompt (VERBATIM from prompts.md §2) ─────────────────────────────
// String.raw so LaTeX backslashes (\text, \frac, \sin, \alpha …) stay literal —
// a normal/template string would interpret \t as TAB, \f as form-feed, etc.
// (rule 80 / formula-trainer single-backslash bug class). Do NOT paraphrase.

const KB_EXTRACT_SYSTEM_PROMPT = String.raw`Ты — ассистент репетитора физики в сервисе «Сократ». Тебе дают сырой материал
(текст, фото страницы сборника, PDF-задачник, таблицу) и ты извлекаешь из него
ОТДЕЛЬНЫЕ задачи в структурированном виде для базы задач репетитора.

ТВОЯ ЗАДАЧА — РАСПОЗНАТЬ И СТРУКТУРИРОВАТЬ, НЕ ПРИДУМЫВАТЬ.

Правила:
1. Раздели материал на отдельные задачи. Не склеивай разные задачи и не дроби
   одну на части. Если на странице 8 задач — верни 8 объектов.
2. Текст условия (поле text): перепиши дословно, исправляя только явные опечатки
   распознавания. Все формулы и физические величины оформи inline-LaTeX в долларах:
   $v_0 = 2\ \text{м/с}$, $S_x = 15 - 9t + 3t^2$, $a = g(\sin\alpha - \mu\cos\alpha)$.
   Пиши ЧИСТЫЙ LaTeX: индексы $S_x$ (не «Sx»), степени $t^2$, $\sqrt{}$, $\frac{}{}$,
   $\cdot$, $\alpha$, $\mu$, $\pi$. Единицы — внутри $…$ через \text{} или как обычный
   текст после формулы. Не оставляй битых конструкций вроде «$1$S» или «3t²($S$».
   Таблицы с данными оформляй LaTeX-таблицей прямо в тексте (окружение array для
   KaTeX, например $$\begin{array}{cc} t,\ \text{с} & v,\ \text{м/с} \\ 0 & 0 \\ 2 & 4 \end{array}$$),
   а не прикрепляй таблицу картинкой.
3. Ответ (поле answer): впиши ТОЛЬКО если он явно есть в материале или однозначно
   следует из условия и ты уверен. Если ответа нет или есть сомнение —
   answer = null, answer_confidence = "low". НИКОГДА не выдумывай число.
4. Решение (поле solution): впиши ход решения, ТОЛЬКО если он есть в материале.
   Иначе null.
5. Критерии (поле rubric_text): впиши, ТОЛЬКО если в материале есть схема
   оценивания/критерии. Иначе null.
6. Классификация: определи exam ("ege"/"oge"/null), kim_number (1..30 или null),
   primary_score (если указан), answer_format, и предложи тему/подтему
   (topic_suggestion/subtopic_suggestion) по содержанию. Это подсказки — репетитор
   подтвердит.
7. Рисунки: укажи image_index (0-based по порядку приложенных файлов) ТОЛЬКО если
   выполнены ОБА условия: (а) это изображение содержит РОВНО ОДНУ задачу, и (б) в
   задаче есть существенный рисунок (график, схема, чертёж, электрическая цепь,
   иллюстрация), без которого её не решить. Если изображение содержит НЕСКОЛЬКО
   задач — НЕ прикрепляй его ни к одной (image_index = null, только распознанный текст).
   Если в задаче нет рисунка (чисто текстовая задача) — image_index = null. Если
   сомневаешься, нужен ли рисунок — image_index = null и добавь "image" в
   needs_review_fields. НЕ описывай рисунок текстом вместо самого рисунка и НЕ
   перерисовывай его; image_action = "attach_original". НИКОГДА не считай рисунком
   бланк ответов, номер задания, рамку или служебные пометки.
8. Уверенность: для каждого сомнительного поля добавь его имя в needs_review_fields.
9. Верни СТРОГО валидный JSON по заданной схеме. Без пояснений, без markdown-обёрток.

Контекст от репетитора (если передан): exam_hint, topic_hint — учитывай как приоритет.`;

// Output schema + one few-shot anchor (prompts.md §3 + §7) — strengthens valid
// JSON and the anti-hallucination case (задача без ответа → answer:null).
// String.raw to keep the JSON-escaped LaTeX (\\ \\text) literal.
const KB_EXTRACT_SCHEMA_BLOCK = String.raw`СХЕМА ВЫХОДА — верни РОВНО такой JSON-объект (без markdown, без текста вне JSON):
{
  "tasks": [
    {
      "text": "string (LaTeX в $…$)",
      "answer": "string | null",
      "answer_confidence": "high | medium | low",
      "solution": "string | null",
      "answer_format": "number | text | detailed | matching | choice | null",
      "check_format": "short_answer | detailed_solution | null",
      "kim_number": "integer 1..30 | null",
      "exam": "ege | oge | null",
      "primary_score": "integer | null",
      "rubric_text": "string | null",
      "topic_suggestion": "string",
      "subtopic_suggestion": "string",
      "source_label": "string",
      "image_index": "integer (0-based) | null",
      "image_action": "attach_original",
      "needs_review_fields": ["string"],
      "notes": "string | null"
    }
  ],
  "stats": { "found": 0, "low_confidence_answers": 0, "unreadable_images": 0 }
}

ПРИМЕР. Вход: «ЕГЭ-2026. 1. Тело движется равноускоренно со скоростью v0 = 2 м/с
с ускорением a = 0,5 м/с². Какова скорость через t = 6 с? Ответ: 5 м/с.
2. Камень свободно падает с высоты h = 20 м (g = 10 м/с²). Найдите время падения.»
Выход:
{"tasks":[{"text":"Тело движется равноускоренно со скоростью $v_0 = 2\\ \\text{м/с}$ с ускорением $a = 0{,}5\\ \\text{м/с}^2$. Какова скорость через $t = 6\\ \\text{с}$?","answer":"5 м/с","answer_confidence":"high","solution":null,"answer_format":"number","check_format":"short_answer","kim_number":1,"exam":"ege","primary_score":1,"rubric_text":null,"topic_suggestion":"Кинематика","subtopic_suggestion":"Равноускоренное движение","source_label":"ЕГЭ-2026","image_index":null,"image_action":"attach_original","needs_review_fields":[],"notes":null},{"text":"Камень свободно падает с высоты $h = 20\\ \\text{м}$ ($g = 10\\ \\text{м/с}^2$). Найдите время падения.","answer":null,"answer_confidence":"low","solution":null,"answer_format":"number","check_format":"short_answer","kim_number":1,"exam":"ege","primary_score":1,"rubric_text":null,"topic_suggestion":"Кинематика","subtopic_suggestion":"Свободное падение","source_label":"ЕГЭ-2026","image_index":null,"image_action":"attach_original","needs_review_fields":["answer"],"notes":"Ответ в материале не указан — оставлено пустым"}],"stats":{"found":2,"low_confidence_answers":1,"unreadable_images":0}}`;

// ─── System prompt (обществознание) — мультипредметный каталог (2026-07-06) ───
// Мираж физического промпта под обществознание: НЕТ формул/LaTeX; типы заданий —
// выбор верных суждений, установление соответствия, работа с текстом, план,
// развёрнутый ответ; № КИМ ЕГЭ 1..25 / ОГЭ 1..24. КЛЮЧЕВОЕ: каждое перечисляемое
// суждение — с новой строки (\n) → рендер MathText (Part A) покажет их читаемо.
// String.raw — чтобы \n в few-shot остался JSON-escape'ом (реальный перенос сделал
// бы пример-JSON невалидным; тот же resoning, что у физического SCHEMA_BLOCK).

const KB_EXTRACT_SYSTEM_PROMPT_SOCIAL = String.raw`Ты — ассистент репетитора обществознания в сервисе «Сократ». Тебе дают сырой
материал (текст, фото страницы сборника, PDF-задачник) и ты извлекаешь из него
ОТДЕЛЬНЫЕ задания в структурированном виде для базы задач репетитора.

ТВОЯ ЗАДАЧА — РАСПОЗНАТЬ И СТРУКТУРИРОВАТЬ, НЕ ПРИДУМЫВАТЬ.

Правила:
1. Раздели материал на отдельные задания. Не склеивай разные задания и не дроби
   одно на части. Если на странице 8 заданий — верни 8 объектов.
2. Текст условия (поле text): перепиши дословно, исправляя только явные опечатки
   распознавания. НЕ используй LaTeX и формулы — обществознание это обычный текст.
   ВАЖНО ПО ФОРМАТИРОВАНИЮ: каждое перечисляемое суждение / вариант / пункт пиши С
   НОВОЙ СТРОКИ (реальный перенос строки — символ \n в JSON). Например задание
   «Выберите верные суждения…» с вариантами 1)…5): сначала формулировка задания,
   затем каждое суждение «1) …», «2) …» на ОТДЕЛЬНОЙ строке. Для заданий на
   установление соответствия сохрани оба столбца читаемо (позиции А, Б, В … и
   1, 2, 3 … по строкам). НЕ склеивай варианты в один сплошной абзац.
3. Ответ (поле answer): впиши ТОЛЬКО если он явно есть в материале или однозначно
   следует из условия и ты уверен. Для «выбора верных суждений» ответ — цифры
   выбранных вариантов подряд (например «235»); для «соответствия» —
   последовательность цифр (например «21212»). Если ответа нет или есть сомнение —
   answer = null, answer_confidence = "low". НИКОГДА не выдумывай ответ.
4. Решение/пояснение (поле solution): впиши, ТОЛЬКО если оно есть в материале.
   Иначе null.
5. Критерии (поле rubric_text): для заданий с развёрнутым ответом (план,
   аргументация, работа с текстом, мини-сочинение) впиши схему оценивания, ТОЛЬКО
   если она есть в материале. Иначе null.
6. Классификация: определи exam ("ege"/"oge"/null), kim_number (ЕГЭ 1..25, ОГЭ
   1..24, или null), primary_score (если указан), answer_format, и предложи
   тему/подтему (topic_suggestion/subtopic_suggestion) по содержанию — разделы
   обществознания: «Человек и общество», «Экономика», «Социальные отношения»,
   «Политика», «Право». Это подсказки — репетитор подтвердит.
7. check_format: краткий ответ (цифры / слово / последовательность) →
   "short_answer"; задание с развёрнутым ответом (план, аргументация, работа с
   текстом, мини-сочинение) → "detailed_solution".
8. Рисунки: обществознание почти всегда текстовое. Укажи image_index (0-based по
   порядку приложенных файлов) ТОЛЬКО если выполнены ОБА условия: (а) изображение
   содержит РОВНО ОДНУ задачу, и (б) в задаче есть существенная иллюстрация (график,
   диаграмма), без которой её не решить. Если изображение содержит НЕСКОЛЬКО заданий
   — НЕ прикрепляй его ни к одной (image_index = null, только распознанный текст).
   Таблицу с данными по возможности переписывай текстом. Если сомневаешься —
   image_index = null и добавь "image" в needs_review_fields. НЕ перерисовывай
   иллюстрацию; image_action = "attach_original". НИКОГДА не считай рисунком бланк
   ответов, номер задания или рамку.
9. Уверенность: для каждого сомнительного поля добавь его имя в needs_review_fields.
10. Верни СТРОГО валидный JSON по заданной схеме. Без пояснений, без markdown-обёрток.

Контекст от репетитора (если передан): exam_hint, topic_hint — учитывай как приоритет.`;

const KB_EXTRACT_SCHEMA_BLOCK_SOCIAL = String.raw`СХЕМА ВЫХОДА — верни РОВНО такой JSON-объект (без markdown, без текста вне JSON):
{
  "tasks": [
    {
      "text": "string (обычный текст; каждый вариант/пункт с новой строки — \n)",
      "answer": "string | null",
      "answer_confidence": "high | medium | low",
      "solution": "string | null",
      "answer_format": "number | text | detailed | matching | choice | null",
      "check_format": "short_answer | detailed_solution | null",
      "kim_number": "integer (ЕГЭ 1..25, ОГЭ 1..24) | null",
      "exam": "ege | oge | null",
      "primary_score": "integer | null",
      "rubric_text": "string | null",
      "topic_suggestion": "string",
      "subtopic_suggestion": "string",
      "source_label": "string",
      "image_index": "integer (0-based) | null",
      "image_action": "attach_original",
      "needs_review_fields": ["string"],
      "notes": "string | null"
    }
  ],
  "stats": { "found": 0, "low_confidence_answers": 0, "unreadable_images": 0 }
}

ПРИМЕР. Вход: «2. Выберите верные суждения об обществе и запишите цифры, под которыми
они указаны. 1) Общество — часть материального мира. 2) Общество создаёт условия для
самореализации личности. 3) Развитие общества может иметь прогрессивный характер.
4) Изменения в обществе происходят только под влиянием внешних факторов. 5) Обществом
называют устойчивую систему социальных связей. Ответ: 235.»
Выход:
{"tasks":[{"text":"Выберите верные суждения об обществе и запишите цифры, под которыми они указаны.\n1) Общество — часть материального мира.\n2) Общество создаёт условия для самореализации личности.\n3) Развитие общества может иметь прогрессивный характер.\n4) Изменения в обществе происходят только под влиянием внешних факторов.\n5) Обществом называют устойчивую систему социальных связей.","answer":"235","answer_confidence":"high","solution":null,"answer_format":"number","check_format":"short_answer","kim_number":2,"exam":"ege","primary_score":2,"rubric_text":null,"topic_suggestion":"Человек и общество","subtopic_suggestion":"Общество как система","source_label":"","image_index":null,"image_action":"attach_original","needs_review_fields":[],"notes":null}],"stats":{"found":1,"low_confidence_answers":0,"unreadable_images":0}}`;

// ─── Generic-промпт для остальных школьных предметов (2026-07-07) ─────────────
// Полный словарь SUBJECTS (mirror-copy `src/types/homework.ts` — Deno не может
// импортировать фронтовые типы, конвенция rule 40). physics/social имеют
// выделенные калиброванные промпты; остальные — параметризованный generic:
// формульная LaTeX-инструкция только для формульных предметов (математика/
// информатика/химия/биология), гуманитарные/языки — чистый текст. КИМ-диапазоны
// per-предмет не хардкодим (карт ФИПИ нет) — «только если явно указан».

const SUBJECT_META_DENO: Record<string, { genitive: string; usesFormulas: boolean }> = {
  maths: { genitive: "математики", usesFormulas: true },
  physics: { genitive: "физики", usesFormulas: true },
  informatics: { genitive: "информатики", usesFormulas: true },
  russian: { genitive: "русского языка", usesFormulas: false },
  literature: { genitive: "литературы", usesFormulas: false },
  history: { genitive: "истории", usesFormulas: false },
  social: { genitive: "обществознания", usesFormulas: false },
  english: { genitive: "английского языка", usesFormulas: false },
  french: { genitive: "французского языка", usesFormulas: false },
  spanish: { genitive: "испанского языка", usesFormulas: false },
  chemistry: { genitive: "химии", usesFormulas: true },
  biology: { genitive: "биологии", usesFormulas: true },
  geography: { genitive: "географии", usesFormulas: false },
  other: { genitive: "школьного предмета", usesFormulas: false },
};

/** Известные предметы AI-загрузчика. Неизвестное значение → 'physics' (fallback). */
const VALID_SUBJECT = new Set(Object.keys(SUBJECT_META_DENO));

const GENERIC_FORMULA_RULE = String.raw`Все формулы, уравнения и специальные
   обозначения оформи inline-LaTeX в долларах: $x^2$, $\frac{a}{b}$, $\sqrt{}$,
   химические уравнения вида $2H_2 + O_2 \rightarrow 2H_2O$. Пиши ЧИСТЫЙ LaTeX,
   не оставляй битых конструкций.`;

const GENERIC_NO_FORMULA_RULE = String.raw`НЕ используй LaTeX и формулы — это
   предмет с обычным текстом.`;

function buildGenericExtractPrompt(subjectId: string): string {
  const meta = SUBJECT_META_DENO[subjectId] ?? SUBJECT_META_DENO.other;
  const formulaRule = meta.usesFormulas ? GENERIC_FORMULA_RULE : GENERIC_NO_FORMULA_RULE;
  return String.raw`Ты — ассистент репетитора ${meta.genitive} в сервисе «Сократ». Тебе дают сырой
материал (текст, фото страницы сборника, PDF-задачник) и ты извлекаешь из него
ОТДЕЛЬНЫЕ задания в структурированном виде для базы задач репетитора.

ТВОЯ ЗАДАЧА — РАСПОЗНАТЬ И СТРУКТУРИРОВАТЬ, НЕ ПРИДУМЫВАТЬ.

Правила:
1. Раздели материал на отдельные задания. Не склеивай разные задания и не дроби
   одно на части. Если на странице 8 заданий — верни 8 объектов.
2. Текст условия (поле text): перепиши дословно, исправляя только явные опечатки
   распознавания. ${formulaRule}
   ВАЖНО ПО ФОРМАТИРОВАНИЮ: каждый перечисляемый вариант / пункт / суждение пиши
   С НОВОЙ СТРОКИ (реальный перенос строки — символ \n в JSON), а не сплошным
   абзацем. Для заданий на установление соответствия сохрани оба столбца читаемо.
3. Ответ (поле answer): впиши ТОЛЬКО если он явно есть в материале или однозначно
   следует из условия и ты уверен. Если ответа нет или есть сомнение —
   answer = null, answer_confidence = "low". НИКОГДА не выдумывай ответ.
4. Решение/пояснение (поле solution): впиши, ТОЛЬКО если оно есть в материале.
   Иначе null.
5. Критерии (поле rubric_text): впиши схему оценивания, ТОЛЬКО если она есть в
   материале. Иначе null.
6. Классификация: exam ("ege"/"oge"/null — только если формат экзамена явно ясен
   из материала); kim_number — ТОЛЬКО если номер задания ЕГЭ/ОГЭ явно указан в
   материале, иначе null (НЕ угадывай); primary_score — только если указан;
   answer_format; предложи тему/подтему (topic_suggestion/subtopic_suggestion)
   по содержанию. Это подсказки — репетитор подтвердит.
7. check_format: краткий ответ (число / слово / последовательность / выбор) →
   "short_answer"; задание с развёрнутым ответом (сочинение, доказательство,
   развёрнутое решение, аргументация) → "detailed_solution".
8. Рисунки: укажи image_index (0-based по порядку приложенных файлов) ТОЛЬКО если
   выполнены ОБА условия: (а) изображение содержит РОВНО ОДНУ задачу, и (б) в
   задаче есть существенный рисунок (график, схема, карта, диаграмма), без
   которого её не решить. Если изображение содержит НЕСКОЛЬКО заданий — НЕ
   прикрепляй его ни к одному (image_index = null, только распознанный текст).
   Если сомневаешься — image_index = null и добавь "image" в needs_review_fields.
   НЕ перерисовывай рисунок; image_action = "attach_original". НИКОГДА не считай
   рисунком бланк ответов, номер задания или рамку.
9. Уверенность: для каждого сомнительного поля добавь его имя в needs_review_fields.
10. Верни СТРОГО валидный JSON по заданной схеме. Без пояснений, без markdown-обёрток.

Контекст от репетитора (если передан): exam_hint, topic_hint — учитывай как приоритет.`;
}

const KB_EXTRACT_SCHEMA_BLOCK_GENERIC = String.raw`СХЕМА ВЫХОДА — верни РОВНО такой JSON-объект (без markdown, без текста вне JSON):
{
  "tasks": [
    {
      "text": "string (каждый вариант/пункт с новой строки — \n)",
      "answer": "string | null",
      "answer_confidence": "high | medium | low",
      "solution": "string | null",
      "answer_format": "number | text | detailed | matching | choice | null",
      "check_format": "short_answer | detailed_solution | null",
      "kim_number": "integer | null (только если явно указан в материале)",
      "exam": "ege | oge | null",
      "primary_score": "integer | null",
      "rubric_text": "string | null",
      "topic_suggestion": "string",
      "subtopic_suggestion": "string",
      "source_label": "string",
      "image_index": "integer (0-based) | null",
      "image_action": "attach_original",
      "needs_review_fields": ["string"],
      "notes": "string | null"
    }
  ],
  "stats": { "found": 0, "low_confidence_answers": 0, "unreadable_images": 0 }
}

ПРИМЕР. Вход: «4. Расположите в хронологической последовательности исторические события.
1) Крещение Руси 2) Куликовская битва 3) призвание варягов. Ответ: 312.»
Выход:
{"tasks":[{"text":"Расположите в хронологической последовательности исторические события. Запишите цифры, которыми обозначены события, в правильной последовательности.\n1) Крещение Руси\n2) Куликовская битва\n3) призвание варягов","answer":"312","answer_confidence":"high","solution":null,"answer_format":"number","check_format":"short_answer","kim_number":null,"exam":null,"primary_score":null,"rubric_text":null,"topic_suggestion":"Древняя Русь","subtopic_suggestion":"","source_label":"","image_index":null,"image_action":"attach_original","needs_review_fields":[],"notes":null}],"stats":{"found":1,"low_confidence_answers":0,"unreadable_images":0}}`;

/**
 * Системный промпт + схема под предмет: physics/social — выделенные калиброванные;
 * остальные школьные — generic (параметризован предметом). Неизвестный id сюда не
 * доходит (VALID_SUBJECT-гейт → 'physics').
 */
function resolveExtractPrompt(subject: string): { systemPrompt: string; schemaBlock: string } {
  if (subject === "social") {
    return { systemPrompt: KB_EXTRACT_SYSTEM_PROMPT_SOCIAL, schemaBlock: KB_EXTRACT_SCHEMA_BLOCK_SOCIAL };
  }
  if (subject === "physics") {
    return { systemPrompt: KB_EXTRACT_SYSTEM_PROMPT, schemaBlock: KB_EXTRACT_SCHEMA_BLOCK };
  }
  return { systemPrompt: buildGenericExtractPrompt(subject), schemaBlock: KB_EXTRACT_SCHEMA_BLOCK_GENERIC };
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtractedTask {
  text: string;
  answer: string | null;
  answer_confidence: "high" | "medium" | "low";
  solution: string | null;
  answer_format: string | null;
  check_format: string | null;
  kim_number: number | null;
  exam: string | null;
  primary_score: number | null;
  rubric_text: string | null;
  topic_suggestion: string;
  subtopic_suggestion: string;
  source_label: string;
  image_index: number | null;
  image_action: "attach_original";
  needs_review_fields: string[];
  notes: string | null;
  // Edge-added (not from the model):
  attachment_ref: string | null;
  fingerprint_match: { scope: "mine" | "catalog"; folder_name: string | null } | null;
}

interface ExtractStats {
  found: number;
  low_confidence_answers: number;
  unreadable_images: number;
}

// ─── CORS ────────────────────────────────────────────────────────────────────

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get("KB_AI_EXTRACT_ALLOWED_ORIGINS") ??
    Deno.env.get("HOMEWORK_API_ALLOWED_ORIGINS");
  if (envOrigins) {
    return envOrigins.split(",").map((o) => o.trim()).filter(Boolean);
  }
  return FALLBACK_ORIGINS;
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = getAllowedOrigins();
  const isLovableOrigin =
    origin.endsWith(".lovableproject.com") || origin.endsWith(".lovable.app");
  const matchedOrigin = allowed.includes(origin) || isLovableOrigin ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": matchedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ─── Response helpers (rule 97 flat shape) ───────────────────────────────────

function jsonOk(cors: Record<string, string>, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function jsonError(
  cors: Record<string, string>,
  status: number,
  code: string,
  error: string,
): Response {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ─── Auth (GoTrue, mirror lesson-materials-api) ──────────────────────────────

async function authenticateUser(
  req: Request,
  cors: Record<string, string>,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Нет активной сессии. Войдите снова.");
  }
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  });
  if (!resp.ok) {
    console.error("kb_ai_extract_auth_failed", { status: resp.status });
    return jsonError(cors, 401, "UNAUTHORIZED", "Сессия истекла. Войдите снова.");
  }
  const user = await resp.json();
  if (!user?.id) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Сессия истекла. Войдите снова.");
  }
  return { userId: user.id as string };
}

// ─── Storage-ref helpers (mirror lesson-materials-api parseStorageRef) ───────

function hasUnsafeObjectPath(path: string): boolean {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some((segment) => segment === ".." || segment.includes("\\") || segment.includes("\0"));
}

function parseStorageRef(
  value: string | null | undefined,
): { bucket: string; objectPath: string } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("storage://")) return null;
  const rest = trimmed.slice("storage://".length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx <= 0 || slashIdx === rest.length - 1) return null;
  const objectPath = rest.slice(slashIdx + 1).replace(/^\/+/, "");
  if (!objectPath || hasUnsafeObjectPath(objectPath)) return null;
  return { bucket: rest.slice(0, slashIdx), objectPath };
}

/**
 * Validate a client-supplied image ref: must be `storage://kb-attachments/{userId}/…`.
 * Binds the upload to the requesting tutor (anti-SSRF / anti-cross-user read).
 * Returns the object path, or null if the ref is not an own kb-attachments image.
 */
function validateOwnKbImageRef(ref: string, userId: string): string | null {
  const parsed = parseStorageRef(ref);
  if (!parsed) return null;
  if (parsed.bucket !== KB_ATTACHMENTS_BUCKET) return null;
  if (!parsed.objectPath.startsWith(`${userId}/`)) return null;
  return parsed.objectPath;
}

// ─── Normalization helpers ───────────────────────────────────────────────────

function asTrimmedStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringOr(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function asIntInRange(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= min && i <= max ? i : null;
}

function asNonNegativeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeTask(raw: unknown, imageRefs: string[]): ExtractedTask | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const text = asTrimmedStringOrNull(r.text);
  if (!text) return null; // a draft without a condition is useless

  const confidenceRaw = typeof r.answer_confidence === "string"
    ? r.answer_confidence.toLowerCase()
    : "";
  const answer_confidence: ExtractedTask["answer_confidence"] =
    VALID_ANSWER_CONFIDENCE.has(confidenceRaw)
      ? (confidenceRaw as ExtractedTask["answer_confidence"])
      : "low";

  // Anti-hallucination: low confidence → never keep an answer.
  let answer = asTrimmedStringOrNull(r.answer);
  if (answer_confidence === "low") answer = null;

  const answerFormatRaw = typeof r.answer_format === "string" ? r.answer_format.toLowerCase() : "";
  const answer_format = VALID_ANSWER_FORMAT.has(answerFormatRaw) ? answerFormatRaw : null;

  const checkFormatRaw = typeof r.check_format === "string" ? r.check_format.toLowerCase() : "";
  const check_format = VALID_CHECK_FORMAT.has(checkFormatRaw) ? checkFormatRaw : null;

  const examRaw = typeof r.exam === "string" ? r.exam.toLowerCase() : "";
  const exam = VALID_EXAM.has(examRaw) ? examRaw : null;

  const image_index = asIntInRange(r.image_index, 0, imageRefs.length - 1);
  const attachment_ref = image_index !== null ? imageRefs[image_index] : null;

  const needs_review_fields = Array.isArray(r.needs_review_fields)
    ? r.needs_review_fields.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];

  return {
    text,
    answer,
    answer_confidence,
    solution: asTrimmedStringOrNull(r.solution),
    answer_format,
    check_format,
    kim_number: asIntInRange(r.kim_number, 1, 30),
    exam,
    primary_score: asNonNegativeNumber(r.primary_score),
    rubric_text: asTrimmedStringOrNull(r.rubric_text),
    topic_suggestion: asStringOr(r.topic_suggestion, ""),
    subtopic_suggestion: asStringOr(r.subtopic_suggestion, ""),
    source_label: asStringOr(r.source_label, ""),
    image_index,
    image_action: "attach_original",
    needs_review_fields,
    notes: asTrimmedStringOrNull(r.notes),
    attachment_ref,
    fingerprint_match: null, // filled by dedup pass
  };
}

// ─── AI extraction (with schema-level retry-once) ────────────────────────────

async function runExtraction(
  messages: LovableMessage[],
  // ai-usage-logging: pre-bound onUsage (source='kb_extract'). Undefined = none.
  onUsage?: (usage: TokenUsage | null) => void,
): Promise<unknown[]> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptMessages = attempt === 0
      ? messages
      : [
        ...messages,
        {
          role: "system" as const,
          content:
            'Предыдущий ответ был невалиден. Верни СТРОГО валидный JSON-объект вида {"tasks":[...],"stats":{...}} по схеме. Никакого текста вне JSON, без markdown.',
        },
      ];
    try {
      const obj = await callLovableJson(attemptMessages, "kb_ai_extract", onUsage);
      if (Array.isArray(obj.tasks)) return obj.tasks;
      console.warn("kb_ai_extract_schema_invalid", { attempt: attempt + 1, has_tasks: "tasks" in obj });
    } catch (error) {
      // Log only the error TYPE, never the message — model errors can embed
      // task text / answers (rule 40: no PII in logs).
      console.warn("kb_ai_extract_call_failed", {
        attempt: attempt + 1,
        error_type: error instanceof Error ? error.name : "unknown",
      });
      if (attempt === 1) throw error;
    }
  }
  throw new Error("EXTRACT_SCHEMA_INVALID");
}

// ─── Dedup (extract-time, edge-side; 3-arg kb_normalize_fingerprint) ─────────

async function applyDedupMarkers(
  db: SupabaseClient,
  userId: string,
  drafts: ExtractedTask[],
): Promise<void> {
  try {
    // Compute fingerprints in parallel (immutable SQL function).
    const fps = await Promise.all(
      drafts.map(async (d) => {
        const attUrl = serializeAttachmentUrls(d.attachment_ref ? [d.attachment_ref] : []);
        const { data, error } = await db.rpc("kb_normalize_fingerprint", {
          p_text: d.text,
          p_answer: d.answer,
          p_attachment_url: attUrl,
        });
        if (error || typeof data !== "string") return null;
        return data;
      }),
    );

    const uniqueFps = [...new Set(fps.filter((f): f is string => typeof f === "string"))];
    if (uniqueFps.length === 0) return;

    const { data: rows, error: rowsErr } = await db
      .from("kb_tasks")
      .select("fingerprint, folder_id, owner_id")
      .in("fingerprint", uniqueFps)
      .or(`owner_id.eq.${userId},owner_id.is.null`);
    if (rowsErr || !Array.isArray(rows)) return;

    // Resolve folder names for the tutor's own matches.
    const myFolderIds = [
      ...new Set(
        rows
          .filter((row) => row.owner_id === userId && typeof row.folder_id === "string")
          .map((row) => row.folder_id as string),
      ),
    ];
    const folderNameById = new Map<string, string>();
    if (myFolderIds.length > 0) {
      const { data: folders } = await db
        .from("kb_folders")
        .select("id, name")
        .in("id", myFolderIds);
      for (const f of folders ?? []) {
        if (typeof f.id === "string") folderNameById.set(f.id, (f.name as string) ?? "");
      }
    }

    // fp → best match (prefer the tutor's own base over the catalog).
    const matchByFp = new Map<string, { scope: "mine" | "catalog"; folder_name: string | null }>();
    for (const row of rows) {
      const fp = row.fingerprint as string;
      if (typeof fp !== "string") continue;
      if (row.owner_id === userId) {
        matchByFp.set(fp, {
          scope: "mine",
          folder_name: typeof row.folder_id === "string"
            ? folderNameById.get(row.folder_id) ?? null
            : null,
        });
      } else if (!matchByFp.has(fp)) {
        matchByFp.set(fp, { scope: "catalog", folder_name: null });
      }
    }

    drafts.forEach((d, i) => {
      const fp = fps[i];
      if (fp && matchByFp.has(fp)) d.fingerprint_match = matchByFp.get(fp)!;
    });
  } catch (error) {
    // Dedup is advisory — never fail extraction because of it.
    console.warn("kb_ai_extract_dedup_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

async function handleExtract(
  req: Request,
  cors: Record<string, string>,
  userId: string,
  db: SupabaseClient,
): Promise<Response> {
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    body = null;
  }
  if (!body) return jsonError(cors, 400, "VALIDATION", "Некорректный запрос.");

  const folderId = typeof body.folder_id === "string" ? body.folder_id.trim() : "";
  if (!UUID_RE.test(folderId)) {
    return jsonError(cors, 400, "VALIDATION", "Не выбрана папка для сохранения.");
  }

  const material = (body.material ?? {}) as Record<string, unknown>;
  const materialText = typeof material.text === "string" ? material.text.trim() : "";
  const imageRefsRaw = Array.isArray(material.image_refs)
    ? material.image_refs.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];

  if (imageRefsRaw.length > MAX_IMAGES) {
    return jsonError(cors, 400, "TOO_MANY_IMAGES", `Можно приложить не больше ${MAX_IMAGES} изображений за раз.`);
  }
  if (!materialText && imageRefsRaw.length === 0) {
    return jsonError(cors, 400, "EMPTY_MATERIAL", "Добавьте текст или хотя бы одно фото задачи.");
  }
  if (materialText.length > MAX_TEXT_CHARS) {
    return jsonError(cors, 400, "MATERIAL_TOO_LARGE", "Слишком много текста за один раз. Разбейте на части.");
  }

  // Ownership: folder must belong to the requesting tutor.
  const { data: folder, error: folderErr } = await db
    .from("kb_folders")
    .select("id")
    .eq("id", folderId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (folderErr) {
    console.error("kb_ai_extract_folder_lookup_failed", { status: folderErr.code ?? null });
    return jsonError(cors, 503, "FOLDER_LOOKUP_FAILED", "Не удалось проверить папку. Попробуйте ещё раз.");
  }
  if (!folder) {
    return jsonError(cors, 403, "INVALID_FOLDER", "Папка не найдена или недоступна.");
  }

  const examHint = typeof body.exam_hint === "string" && VALID_EXAM.has(body.exam_hint.toLowerCase())
    ? body.exam_hint.toLowerCase()
    : null;
  const topicHint = typeof body.topic_hint === "string" ? body.topic_hint.trim().slice(0, 120) : "";
  // Мультипредметный каталог (2026-07-06): выбирает системный промпт распознавания.
  const subject = typeof body.subject === "string" && VALID_SUBJECT.has(body.subject)
    ? body.subject
    : "physics";

  // Resolve own kb-attachments refs → signed URL → base64 (ordered; index matters).
  const orderedRefs: string[] = [];
  const imageParts: LovableImagePart[] = [];
  for (const ref of imageRefsRaw) {
    const objectPath = validateOwnKbImageRef(ref, userId);
    if (!objectPath) {
      console.warn("kb_ai_extract_image_ref_rejected", {}); // no PII (no path)
      continue;
    }
    const { data: signed, error: signErr } = await db.storage
      .from(KB_ATTACHMENTS_BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SEC);
    if (signErr || !signed?.signedUrl) {
      console.warn("kb_ai_extract_sign_failed", {});
      continue;
    }
    const dataUrl = await inlineImageUrlToBase64(signed.signedUrl, "kb_ai_extract_inline");
    if (!dataUrl) continue;
    // image_index in the AI output is 0-based over the SUCCESSFULLY attached refs.
    orderedRefs.push(ref);
    imageParts.push({ type: "image_url", image_url: { url: dataUrl } });
  }

  // If the material was images-only but none could be processed (rejected ref /
  // sign-fail / download-fail / SVG / too large), do NOT call the AI blind —
  // it would hallucinate from an empty prompt. (P1 #3)
  if (!materialText && orderedRefs.length === 0) {
    return jsonError(
      cors,
      422,
      "IMAGES_UNREADABLE",
      "Не удалось обработать изображения. Загрузите другие фото или добавьте текст.",
    );
  }

  // Build messages. Системный промпт + схема — по предмету (физика / обществознание).
  const { systemPrompt, schemaBlock } = resolveExtractPrompt(subject);
  const hintLines: string[] = [];
  if (examHint) hintLines.push(`exam_hint: ${examHint}`);
  if (topicHint) hintLines.push(`topic_hint: ${topicHint}`);
  const system = [
    systemPrompt,
    schemaBlock,
    hintLines.length > 0 ? `Контекст от репетитора:\n${hintLines.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  const userContent: Array<LovableTextPart | LovableImagePart> = [];
  const introText = materialText
    ? `Извлеки отдельные задачи из материала ниже.\n\nМАТЕРИАЛ:\n${materialText}`
    : "Извлеки отдельные задачи из приложенных изображений.";
  userContent.push({ type: "text", text: introText });
  for (const part of imageParts) userContent.push(part);

  const messages: LovableMessage[] = [
    { role: "system", content: system },
    { role: "user", content: userContent },
  ];

  // Call AI + retry-once on schema-invalid.
  // ai-usage-logging (2026-07-06): attribute extraction cost to the requesting
  // tutor (source='kb_extract'; no assignment). Fire-and-forget.
  const extractUsageLogger = makeUsageLogger(db, {
    userId,
    source: "kb_extract",
    assignmentId: null,
  });
  let rawTasks: unknown[];
  try {
    rawTasks = await runExtraction(messages, extractUsageLogger);
  } catch {
    return jsonError(cors, 502, "EXTRACT_FAILED", "Не удалось распознать задачи. Попробуйте ещё раз или измените материал.");
  }

  // Normalize.
  const drafts: ExtractedTask[] = [];
  for (const raw of rawTasks) {
    const norm = normalizeTask(raw, orderedRefs);
    if (norm) drafts.push(norm);
  }

  // Backstop (owner rule): if an input image maps to MORE than one task, it
  // contains multiple tasks → don't attach it to any (multi-task screenshot =
  // text only). The prompt already instructs this; this enforces it if the AI
  // over-attached. P0 can't crop a single figure out of a multi-task image.
  const imageIndexUsage = new Map<number, number>();
  for (const d of drafts) {
    if (d.image_index !== null) {
      imageIndexUsage.set(d.image_index, (imageIndexUsage.get(d.image_index) ?? 0) + 1);
    }
  }
  for (const d of drafts) {
    if (d.image_index !== null && (imageIndexUsage.get(d.image_index) ?? 0) > 1) {
      d.image_index = null;
      d.attachment_ref = null;
    }
  }

  // Dedup markers (advisory).
  await applyDedupMarkers(db, userId, drafts);

  const stats: ExtractStats = {
    found: drafts.length,
    low_confidence_answers: drafts.filter((d) => d.answer_confidence === "low").length,
    unreadable_images: imageRefsRaw.length - orderedRefs.length,
  };

  // PII-free log (counts only).
  console.log("kb_ai_extract_done", {
    found: stats.found,
    low_conf: stats.low_confidence_answers,
    images_in: imageRefsRaw.length,
    images_ok: orderedRefs.length,
    dedup_hits: drafts.filter((d) => d.fingerprint_match !== null).length,
  });

  return jsonOk(cors, { drafts, stats });
}

// ─── Entry ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return jsonError(cors, 405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.");
  }

  const auth = await authenticateUser(req, cors);
  if (auth instanceof Response) return auth;

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    return await handleExtract(req, cors, auth.userId, db);
  } catch (error) {
    console.error("kb_ai_extract_unhandled", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return jsonError(cors, 500, "INTERNAL", "Внутренняя ошибка. Попробуйте ещё раз.");
  }
});
