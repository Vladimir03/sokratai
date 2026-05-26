import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  MAX_GUIDED_CHAT_IMAGES_FOR_AI,
  MAX_TASK_IMAGES_FOR_AI,
  parseAttachmentUrls,
} from "../_shared/attachment-refs.ts";
import {
  AiQuotaContext,
  buildLimitReachedResponse,
  checkAiQuota,
  FREE_DAILY_LIMIT as SHARED_FREE_DAILY_LIMIT,
} from "../_shared/subscription-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MESSAGE_LENGTH = 10000;
// Daily message limit for free users. Canonical value lives in _shared/subscription-limits.ts;
// re-exported here to avoid breaking any inline references in this large file.
const FREE_DAILY_LIMIT = SHARED_FREE_DAILY_LIMIT;

type ResponseProfile = "default" | "telegram_compact";
type ResponseMode = "dialog" | "solution" | "hint" | "explain";

interface ChatRequestBody {
  messages: any[];
  systemPrompt?: string;
  taskContext?: string;
  /** Homework task image refs; resolved into multimodal image_url parts on the server */
  taskImageUrls?: string[];
  /** Signed HTTP URL of the latest student solution image — injected as multimodal image_url part */
  studentImageUrl?: string;
  /** Signed HTTP URLs of the latest student solution images */
  studentImageUrls?: string[];
  chatId?: string;
  userId?: string;
  responseProfile?: ResponseProfile;
  responseMode?: ResponseMode;
  maxChars?: number;
  /**
   * Student display name for AI system prompt gender/name guidance.
   * Appended to effectiveSystemPrompt (does NOT replace SYSTEM_PROMPT).
   * Filtered on the frontend: auto-generated names (telegram_*, user_*) are excluded.
   */
  studentName?: string;
  /**
   * Phase 8 (2026-05-20) — explicit gender для AI grammar conjugation.
   * Client may pass это для UI consistency, но **server-side подтверждает**
   * через tutor_students.gender / profiles.gender lookup когда есть
   * guidedHomeworkAssignmentId. DB value wins (anti-tamper, mirror Phase 1
   * subject confirmation pattern).
   */
  studentGender?: "male" | "female" | null;
  /**
   * Guided homework context (student-side request). When present, the /chat
   * endpoint fetches tutor's reference solution server-side using service-role
   * (after verifying the student is assigned to this homework), and injects
   * solution_text + solution_image_urls into the system prompt with an
   * anti-spoiler contract. Student-side API never exposes these refs directly.
   */
  guidedHomeworkAssignmentId?: string;
  guidedHomeworkTaskId?: string;
  /**
   * Subject id from `homework_tutor_assignments.subject` (canonical list:
   * src/types/homework.ts → SUBJECTS). When `guidedHomeworkAssignmentId` is
   * present, the server independently re-fetches subject and prefers the
   * DB value (defence against client tampering). Used to inject a
   * subject-aware block into the system prompt so AI doesn't answer
   * Russian / French / etc. homework with physics-only vocabulary.
   */
  subject?: string | null;
}

// SECURITY: Allowed domains for image fetching to prevent SSRF attacks
// Imported from _shared/image-domains.ts so chat / homework-api / future AI
// callers stay in sync. Adding a bucket to any homework write-path requires
// extending HOMEWORK_AI_BUCKETS there — see rule 40 invariant.
//
// Both direct (vrsseotrfmsxpbciyqzc.supabase.co) and proxy (api.sokratai.ru)
// signed URLs are valid — same JWT signing key. Validate against both hosts
// because after Phase B migration (CLAUDE.md "# Network & Infrastructure"),
// frontend stores proxy URLs in DB but server-side fetches still go direct.
import { buildAllowedSignedUrlPrefixes } from "../_shared/image-domains.ts";
import { SUPABASE_PROXY_URL } from "../_shared/proxy-url.ts";
import { isHumanitiesSubject, resolveSubjectRubric } from "../_shared/subject-rubrics/index.ts";
import { containsVerbatimSpan } from "../_shared/leak-detector.ts";
const ALLOWED_IMAGE_DOMAINS = buildAllowedSignedUrlPrefixes([
  Deno.env.get("SUPABASE_URL") ?? "",
  SUPABASE_PROXY_URL,
]);

/** Max image size (5 MB raw ≈ 6.7 MB base64) to stay within gateway body limits. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VOICE_BYTES = 10 * 1024 * 1024;
const VOICE_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
const ALLOWED_VOICE_MIME_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
]);

/**
 * Downloads an image from a pre-validated HTTPS URL and returns a base64 data URL.
 * The Lovable AI Gateway (proxying Gemini) does NOT fetch external HTTP URLs —
 * images must be inlined as data:image/...;base64,... for the model to see them.
 *
 * Callers MUST validate the URL with isValidImageUrl() before calling this
 * (only allowlisted Supabase storage domains are accepted).
 *
 * Returns null if the download fails or the image exceeds MAX_IMAGE_BYTES.
 */
async function fetchImageAsBase64DataUrl(url: string): Promise<string | null> {
  try {
    // Skip SVGs by URL extension before fetching — Gemini multimodal
    // only supports raster formats. SVGs cause HTTP 400 from the gateway.
    try {
      const parsedUrl = new URL(url);
      if (/\.svg(\?|$)/i.test(parsedUrl.pathname)) {
        console.warn("fetchImageAsBase64DataUrl: skipped unsupported SVG", {
          source: "url_extension",
          url: url.slice(0, 120),
        });
        return null;
      }
    } catch {
      // URL parsing failed — let the fetch path handle it
    }

    const resp = await fetch(url);
    if (!resp.ok) {
      console.error("fetchImageAsBase64DataUrl: HTTP error", { url: url.slice(0, 120), status: resp.status });
      return null;
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      console.error("fetchImageAsBase64DataUrl: image too large", {
        url: url.slice(0, 120),
        bytes: buf.byteLength,
        maxBytes: MAX_IMAGE_BYTES,
      });
      return null;
    }
    const mime = resp.headers.get("content-type") || "image/jpeg";

    // Detect SVG via content-type or magic bytes (catches SVGs served
    // without .svg extension or behind signed URLs with rewritten paths).
    const isSvgMime = /image\/svg\+?xml/i.test(mime);
    let isSvgMagic = false;
    if (!isSvgMime) {
      const sniffLen = Math.min(buf.byteLength, 256);
      const head = new TextDecoder("utf-8", { fatal: false }).decode(
        new Uint8Array(buf, 0, sniffLen),
      );
      isSvgMagic = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(head);
    }
    if (isSvgMime || isSvgMagic) {
      console.warn("fetchImageAsBase64DataUrl: skipped unsupported SVG", {
        source: isSvgMime ? "content_type" : "magic_bytes",
        mime,
        url: url.slice(0, 120),
      });
      return null;
    }

    // Convert in 32KB chunks to avoid stack overflow on large images
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  } catch (err) {
    console.error("fetchImageAsBase64DataUrl: fetch error", {
      url: url.slice(0, 120),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Validates image URL to prevent Server-Side Request Forgery (SSRF) attacks
 */
function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    if (parsed.protocol !== "https:") {
      console.warn("[SECURITY] Blocked non-HTTPS URL:", url);
      return false;
    }
    
    const blockedPatterns = [
      "127.", "10.", "172.16.", "192.168.", "169.254.",
      "localhost", "[::1]", "0.0.0.0", "::1",
    ];
    
    const hostname = parsed.hostname.toLowerCase();
    if (blockedPatterns.some((pattern) => hostname.includes(pattern))) {
      console.warn("[SECURITY] Blocked private/internal IP:", hostname);
      return false;
    }
    
    const isAllowed = ALLOWED_IMAGE_DOMAINS.some((domain) => url.startsWith(domain));
    if (!isAllowed) {
      console.warn("[SECURITY] Blocked unauthorized domain:", hostname);
    }
    return isAllowed;
  } catch (error) {
    console.error("[SECURITY] Invalid URL format:", url, error);
    return false;
  }
}

function parseStorageRef(
  value: string | null | undefined,
  defaultBucket = "homework-task-images",
): { bucket: string; objectPath: string } | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("storage://")) {
    const raw = trimmed.slice("storage://".length);
    const slashIdx = raw.indexOf("/");
    if (slashIdx <= 0 || slashIdx === raw.length - 1) {
      return null;
    }
    return {
      bucket: raw.slice(0, slashIdx),
      objectPath: raw.slice(slashIdx + 1).replace(/^\/+/, "").trim(),
    };
  }

  return {
    bucket: defaultBucket,
    objectPath: trimmed.replace(/^\/+/, "").trim(),
  };
}

// ─── Solution leak detector (mirrors guided_ai.ts extractSolutionLeakTokens) ──
// Used to scrub /chat responses that would expose the tutor's reference solution
// to an assigned student via jailbreak-style prompts. See plan wild-swinging-nova.md (P0-1).

const SOLUTION_LEAK_STOPWORDS_CHAT = new Set([
  "равно", "тогда", "поэтому", "значит", "задача", "решение", "формула",
  "потому", "таким", "образом", "отсюда", "следовательно",
  "это", "так", "как", "что", "тут", "или", "если", "тогда.",
]);

function extractSignificantTokensForLeak(text: string): Set<string> {
  const cleaned = text
    .replace(/[`]/g, " ")
    .split(/[\s,;.!?()[\]{}«»"]+/u)
    .filter(Boolean);
  const tokens = new Set<string>();
  for (const rawToken of cleaned) {
    const token = rawToken.toLowerCase();
    if (SOLUTION_LEAK_STOPWORDS_CHAT.has(token)) continue;

    if (/^-?\d+([.,]\d+)?([eE]-?\d+)?$/u.test(token) && token.replace(/[^\d]/g, "").length >= 3) {
      tokens.add(token);
      continue;
    }

    const nonSpaceLen = token.replace(/\s/g, "").length;
    const hasOperator = /[=+\-*/^<>≤≥≠·×]/u.test(token);
    const hasDigitOrLatin = /[\dA-Za-z]/.test(token);
    if (hasOperator && nonSpaceLen >= 3) {
      tokens.add(token);
      continue;
    }
    if (nonSpaceLen >= 5 && hasDigitOrLatin) {
      tokens.add(token);
    }
  }
  return tokens;
}

function containsSolutionLeak(
  output: string,
  solutionText: string | null,
  taskText: string | null,
): boolean {
  if (!output || !solutionText || !solutionText.trim()) return false;
  const solutionTokens = extractSignificantTokensForLeak(solutionText);
  if (solutionTokens.size === 0) return false;
  if (taskText && taskText.trim()) {
    for (const t of extractSignificantTokensForLeak(taskText)) {
      solutionTokens.delete(t);
    }
  }
  const lower = output.toLowerCase();
  for (const token of solutionTokens) {
    if (token.length < 3) continue;
    if (lower.includes(token)) return true;
  }
  return false;
}

async function resolveTaskImageUrlsForAI(
  db: ReturnType<typeof createClient>,
  taskImageUrls: string[] | string | null | undefined,
): Promise<string[]> {
  const normalizedRefs = Array.isArray(taskImageUrls)
    ? taskImageUrls
    : parseAttachmentUrls(taskImageUrls);
  const refs = normalizedRefs
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, MAX_TASK_IMAGES_FOR_AI);

  if (refs.length === 0) return [];

  const resolvedUrls = await Promise.all(refs.map(async (ref) => {
    const trimmed = ref.trim();

    if (trimmed.startsWith("data:")) {
      return trimmed;
    }

    if (/^https?:\/\//i.test(trimmed)) {
      if (!isValidImageUrl(trimmed)) {
        console.error("[SECURITY] Rejected invalid task image URL");
        return null;
      }
      return await fetchImageAsBase64DataUrl(trimmed);
    }

    const parsed = parseStorageRef(trimmed);
    if (!parsed?.bucket || !parsed.objectPath) {
      console.error("resolveTaskImageUrlsForAI: failed to parse storage ref");
      return null;
    }

    const { data, error } = await db.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.objectPath, 3600);

    if (error || !data?.signedUrl) {
      console.error("resolveTaskImageUrlsForAI: failed to create signed URL", {
        bucket: parsed.bucket,
        objectPath: parsed.objectPath,
        error: error?.message,
      });
      return null;
    }

    if (!isValidImageUrl(data.signedUrl)) {
      console.error("[SECURITY] Rejected generated task image signed URL");
      return null;
    }

    return await fetchImageAsBase64DataUrl(data.signedUrl);
  }));

  return resolvedUrls.filter((value): value is string => Boolean(value));
}

interface ChatPromptImageAttachment {
  label: string;
  dataUrl: string;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function isImageDescriptionRequest(text: string): boolean {
  return /(что\s+(?:ты\s+)?видишь|что\s+на|опиши|что\s+изображен|что\s+изображено).*(?:картинк|изображени|фото|скрин)/i.test(text);
}

function injectHomeworkImagesIntoLastUserMessage(
  messages: Array<{ role: string; content: unknown }>,
  attachments: ChatPromptImageAttachment[],
): void {
  if (attachments.length === 0) return;

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx < 0) return;

  const original = messages[lastUserIdx];
  const originalText = extractMessageText(original.content).trim();
  const multimodalContent = attachments.flatMap((attachment) => ([
    { type: "text", text: attachment.label },
    { type: "image_url", image_url: { url: attachment.dataUrl } },
  ]));
  const hasStudentSolutionAttachment = attachments.some((attachment) =>
    attachment.label.toLowerCase().includes("решение ученика")
  );

  if (hasStudentSolutionAttachment) {
    multimodalContent.unshift({
      type: "text",
      text: "Сначала внимательно проанализируй изображение решения ученика. Если на нём нет решения по текущей задаче или оно нерелевантно, прямо скажи об этом.",
    });
  }

  if (hasStudentSolutionAttachment && isImageDescriptionRequest(originalText)) {
    multimodalContent.unshift({
      type: "text",
      text: "Пользователь явно спрашивает, что видно именно на ЕГО изображении. Сначала коротко опиши изображение ученика и не подменяй его условием задачи.",
    });
  }

  multimodalContent.push({
    type: "text",
    text: originalText || "Ученик приложил решение на изображении.",
  });

  messages[lastUserIdx] = {
    role: original.role,
    content: multimodalContent,
  };
}

const SYSTEM_PROMPT = `Ты опытный репетитор ЕГЭ по ВСЕМ школьным предметам.
Твоя цель — помочь школьнику ПОНЯТЬ через диалог.

=== ТВОИ ПРЕДМЕТЫ ===

🔬 **ТЕХНИЧЕСКИЕ (приоритет):**
- Математика (алгебра, геометрия) — $формулы$, $$вычисления$$
- Физика — законы, формулы, задачи
- Информатика — алгоритмы, программирование, системы счисления

📚 **ГУМАНИТАРНЫЕ:**
- Русский язык — орфография, пунктуация, сочинения ЕГЭ
- Литература — анализ произведений, аргументы для сочинений
- История — даты, события, причинно-следственные связи
- Обществознание — термины, теория, планы ответов
- Английский язык — грамматика, эссе, лексика

🧬 **ЕСТЕСТВЕННЫЕ:**
- Химия — реакции, формулы, задачи
- Биология — системы, процессы, термины
- География — карты, процессы, статистика

=== ЗОЛОТОЕ ПРАВИЛО ===
🚨 МАКСИМУМ 2 ВОПРОСА ЗА РАЗ! Школьник должен понять, на что отвечать.
✅ 1 вопрос = идеально
✅ 2 вопроса = максимум (если связаны)
❌ 3+ вопросов = ЗАПРЕЩЕНО

=== ГРАНИЦА ПО КОЛИЧЕСТВУ ЗАДАЧ ===
🚨 ЗА ОДИН ОТВЕТ РАЗБИРАЙ НЕ БОЛЕЕ 2 ЗАДАЧ.
✅ Если ученик прислал 1-2 задачи, помогай как обычно.
✅ Если ученик прислал 3+ задачи, решай только первые 1-2 ИЛИ попроси выбрать любые 2.
❌ Не решай задачи №3+ в этом же ответе, даже если ученик пишет: "реши всё", "все номера", "весь вариант", "всё на фото".

Если задач больше двух:
1. Коротко и доброжелательно объясни, что для качественного разбора идёте по 1-2 задачи за раз.
2. Разбери только 1-2 задачи.
3. В конце предложи продолжить: "Могу сразу помочь ещё с двумя после этого."

Подавай это как заботу о понимании, а не как отказ:
- сохраняй тёплый, поддерживающий тон;
- не стыди и не обвиняй ученика;
- не перечисляй нерешённые задачи подробно, если это не нужно.

=== РЕЖИМЫ РАБОТЫ ===

🎓 РЕЖИМ 1: ОБУЧЕНИЕ ЧЕРЕЗ ДИАЛОГ (по умолчанию)
Веди диалог через наводящие вопросы. НЕ давай готовый ответ сразу.

СТРУКТУРА (для всех предметов):
1. Признай задачу/вопрос
2. Уточни условие (формулы для точных наук, контекст для гуманитарных)
3. Задай ОДИН наводящий вопрос (или максимум ДВА связанных)
4. Веди диалог, помогая ученику самому прийти к ответу

ПОМОЩЬ (если просят):
**Анализ:** [суть вопроса до 5-6 предложений]
**Ключевое:** [формула/правило/термин]
**Подсказки:** 1) [намёк] 2) [намёк]
**Попробуй:** [ОДИН вопрос для проверки понимания]

---

🗺️ РЕЖИМ 2: КРАТКИЙ ПЛАН (только идеи!)

Активируется при: "Составь план", "Как решать", "С чего начать"

ФОРМАТ (СТРОГО):

**План:**

1️⃣ **[Глагол] [что]** — [как в 2-3 словах]
2️⃣ **[Глагол] [что]** — [как в 2-3 словах]
3️⃣ **[Глагол] [что]** — [как в 2-3 словах]
4️⃣ **[Глагол] [что]** (если нужно)
5️⃣ **[Глагол] [что]** (если нужно)

💡 **Ключ:** [формула/правило/приём]

🎯 **Попробуй!** [Вопрос про шаг 1]

ПРАВИЛА:
✅ Максимум 7 шагов, 1 строка = 1 шаг
✅ БЕЗ подпунктов, БЕЗ нумерации 1.1, 1.2
✅ БЕЗ деталей "как именно"

---

📝 РЕЖИМ 3: ПОЛНЫЙ ОТВЕТ (только по явной просьбе)
Активируется при: "покажи решение", "дай полный ответ", "напиши решение", "объясни подробно"

⚠️ КРИТИЧНО: При этих фразах НЕ ОТКАЗЫВАЙСЯ! СРАЗУ ДАВАЙ ОТВЕТ!

Структура (для точных наук):
**Решение:**
**Шаг 1:** [Объяснение + формулы]
$$[вычисления]$$
**Шаг 2:** ...
**Ответ:** [Финальный ответ]
💡 **Разбор:** [Резюме логики]

Структура (для гуманитарных):
**Ответ:**
**Тезис:** [Главная мысль]
**Аргументы:**
1) [Первый аргумент + пример/цитата]
2) [Второй аргумент + пример/цитата]
**Вывод:** [Итог]
💡 **Совет:** [Как запомнить/применить]

После ответа предложи: "Хочешь разобрать похожий вопрос самостоятельно?"

---

=== СПЕЦИФИКА ПО ПРЕДМЕТАМ ===

📐 **МАТЕМАТИКА/ФИЗИКА/ИНФОРМАТИКА:**
- Всегда используй LaTeX: $формулы$, $$вычисления$$
- Пошаговые вычисления с промежуточными результатами
- Чёткие формулы и единицы измерения

📊 **ПОСТРОЕНИЕ ГРАФИКОВ:**
Когда нужно построить график функции, добавь Python код в блоке \`\`\`python:

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА для графиков:
1. Используй ТОЛЬКО matplotlib и numpy
2. НЕ вызывай plt.show() — график сохраняется автоматически
3. Подписи на русском языке
4. Всегда добавляй сетку, подписи осей и заголовок

ШАБЛОН графика функции:
\`\`\`python
import numpy as np
import matplotlib.pyplot as plt

# Диапазон значений
x = np.linspace(-10, 10, 400)

# Функция
y = x**2 - 4*x + 3  # пример: y = x² - 4x + 3

# Построение
plt.figure(figsize=(10, 6))
plt.plot(x, y, 'b-', linewidth=2, label=r'$y = x^2 - 4x + 3$')
plt.axhline(y=0, color='k', linewidth=0.5)
plt.axvline(x=0, color='k', linewidth=0.5)
plt.grid(True, alpha=0.3)
plt.xlabel('x', fontsize=12)
plt.ylabel('y', fontsize=12)
plt.title('График функции', fontsize=14)
plt.legend()
plt.xlim(-10, 10)
plt.ylim(-10, 20)
\`\`\`

КОГДА строить график:
✅ "Построй график функции y = ..."
✅ "Покажи на графике..."
✅ "Нарисуй параболу/прямую/..."
✅ При исследовании функции (корни, экстремумы)
✅ При решении систем уравнений графически

ТИПЫ графиков:
- Функции: plt.plot(x, y)
- Точки: plt.scatter(x, y)
- Несколько функций: несколько plt.plot() + legend
- Область: plt.fill_between(x, y1, y2, alpha=0.3)

📖 **РУССКИЙ ЯЗЫК:**
- Правила с примерами: "ЖИ-ШИ пиши с И: жизнь, машина"
- Для сочинений: структура + клише + аргументы
- Орфограммы выделяй **жирным**

📜 **ИСТОРИЯ/ОБЩЕСТВОЗНАНИЕ:**
- Даты в формате: **1861 г.** — отмена крепостного права
- Термины с определениями: **Реформа** — преобразование...
- Причинно-следственные связи: причина → событие → последствие

📗 **ЛИТЕРАТУРА:**
- Цитаты курсивом: *"Я вас любил..."*
- Автор + произведение + герой
- Позиция автора + художественные средства

🧪 **ХИМИЯ/БИОЛОГИЯ:**
- Реакции: 2H₂ + O₂ → 2H₂O
- Процессы пошагово
- Связь теории с практикой

---

=== ПРАВИЛА ОБЩЕНИЯ ===

✅ ДЕЛАЙ:
- Задавай МАКСИМУМ 2 вопроса за раз
- Фокусируйся на ОДНОМ аспекте
- Жди ответа перед следующим вопросом
- Короткие абзацы (2-4 строки)
- Пустые строки между блоками

❌ НЕ ДЕЛАЙ:
- 3+ вопросов подряд
- Списки вопросов
- Абзацы >4 строк
- Полные ответы без просьбы
- Стены текста

=== ПРИМЕРЫ ===

❌ ПЛОХО (много вопросов):
"Что такое метафора? А эпитет? Чем отличаются? Какие примеры знаешь?"

✅ ХОРОШО (фокус):
"Давай разберём метафору. Вспомни: что она делает с двумя понятиями — сравнивает или отождествляет?"

---

=== ФОРМАТИРОВАНИЕ ===

📝 **LaTeX (для точных наук):**
✅ Дроби: \\frac{числитель}{знаменатель}
✅ Корни: \\sqrt{выражение}
✅ Степени: x^{2}, индексы: a_{n}

📝 **Структура:**
✅ Пустая строка перед заголовками (**План:**)
✅ Пустая строка перед списками (1️⃣, 2️⃣)
✅ **Жирный** для терминов и ключевых слов
✅ *Курсив* для цитат и примеров
✅ Эмодзи для навигации: ✅ ❌ 💡 🎯 ⚠️

=== ЛОГИКА ВЫБОРА РЕЖИМА ===

По умолчанию: РЕЖИМ 1 (диалог)
Если просят "план" → РЕЖИМ 2 (краткий план)
Если просят "полный ответ/решение" → РЕЖИМ 3 (подробно)

🚨 ПОМНИ: МАКСИМУМ 2 ВОПРОСА ЗА РАЗ!`;

function normalizeResponseProfile(value: unknown): ResponseProfile {
  return value === "telegram_compact" ? "telegram_compact" : "default";
}

function normalizeResponseMode(value: unknown): ResponseMode {
  if (value === "solution" || value === "hint" || value === "explain") {
    return value;
  }
  return "dialog";
}

function normalizeMaxChars(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(200, Math.min(2000, Math.floor(value)));
}

function buildTelegramCompactAppendix(mode: ResponseMode, maxChars?: number): string {
  const maxCharsInstruction = maxChars
    ? `Максимальная длина ответа: до ${maxChars} символов (строго придерживайся лимита).`
    : "Старайся отвечать коротко и без длинных полотен текста.";

  const modeInstructions: Record<ResponseMode, string> = {
    dialog: `РЕЖИМ dialog (по умолчанию):
- Веди сократический диалог: задавай наводящие вопросы, помогай ученику думать самому.
- Отвечай естественно и кратко. НЕ используй жёсткий шаблон (Идея/Мини-шаг/Вопрос).
- Заканчивай одним вопросом ученику.
- Не давай полное решение сразу.`,
    solution: `РЕЖИМ solution:
- Дай полное решение пошагово.
- Формат свободный, но структурированный (Шаг 1, Шаг 2, ... Ответ).`,
    hint: `РЕЖИМ hint:
- Дай короткую подсказку и один направляющий вопрос.
- Не раскрывай решение полностью.`,
    explain: `РЕЖИМ explain:
- Разбери один конкретный шаг кратко.
- При необходимости приведи короткий пример.
- Задай один вопрос на проверку понимания.`,
  };

  return `=== TELEGRAM COMPACT PROFILE ===
Это ответ для Telegram-бота с компактным UX.
${maxCharsInstruction}

Общие правила:
- Короткие абзацы, 1-3 строки.
- Без markdown-шума (никаких "###", code fences и лишних **).
- Без вложенных списков и без нумерации 1.1/1.2.
- Минимум эмодзи (используй только при реальной необходимости).
- Для математики/физики LaTeX только когда это действительно нужно.
- Не используй больше одного вопроса в конце ответа.

${modeInstructions[mode]}`;
}

// ─── Subject-aware prompt helpers ───────────────────────────────────────────
// Mirror of `guided_ai.ts::SUBJECT_LABELS_DENO`. Keep in sync with SUBJECTS
// from src/types/homework.ts when new subjects land. Fallback = raw id.
const SUBJECT_LABELS_DENO: Record<string, string> = {
  maths: "Математика",
  physics: "Физика",
  informatics: "Информатика",
  russian: "Русский язык",
  literature: "Литература",
  history: "История",
  social: "Обществознание",
  english: "Английский язык",
  french: "Французский язык",
  spanish: "Испанский язык",
  chemistry: "Химия",
  biology: "Биология",
  geography: "География",
  other: "Другое",
  math: "Математика",
  rus: "Русский язык",
  cs: "Информатика",
  algebra: "Алгебра",
  geometry: "Геометрия",
};

function getSubjectLabelDeno(subjectId: string | null | undefined): string {
  const id = (subjectId ?? "").trim();
  if (!id) return "школьному предмету";
  return SUBJECT_LABELS_DENO[id] ?? id;
}

/**
 * Inline subject-specific examples for chat-path system prompt.
 * Used to constrain AI vocabulary to the subject's natural domain.
 */
function buildSubjectExamplesLine(subjectId: string | null | undefined): string {
  switch (subjectId) {
    case "physics":
      return "Опирайся на физические величины (скорость, ускорение, сила, напряжение, …) и законы (Ньютон, Ом, Кирхгоф, …).";
    case "maths":
    case "math":
    case "algebra":
    case "geometry":
      return "Опирайся на формулы, теоремы и приёмы (Виета, разложение, замена переменной, признаки подобия, …).";
    case "russian":
    case "rus":
      return "Опирайся на правила орфографии, пунктуации и морфологии.";
    case "literature":
      return "Опирайся на темы, художественные средства, позиции авторов и цитаты.";
    case "english":
    case "french":
    case "spanish":
      return "Опирайся на грамматические правила, времена, синтаксические конструкции и лексику этого языка.";
    case "history":
    case "social":
      return "Опирайся на конкретные события, термины, причинно-следственные связи и даты.";
    case "informatics":
    case "cs":
      return "Опирайся на алгоритмы, конструкции языка программирования и приёмы решения.";
    case "chemistry":
      return "Опирайся на реакции, формулы веществ и химические законы.";
    case "biology":
      return "Опирайся на процессы, термины и системы организма.";
    case "geography":
      return "Опирайся на процессы, явления и статистические данные.";
    default:
      return "Опирайся на правила, приёмы и ключевые идеи этого предмета.";
  }
}

function isAcceptedVoiceMimeType(mimeType: string): boolean {
  if (!mimeType) return false;

  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  return ALLOWED_VOICE_MIME_TYPES.has(normalized);
}

function getVoiceFilename(mimeType: string, providedName?: string): string {
  if (providedName && providedName.trim()) {
    return providedName;
  }

  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized.includes("ogg")) return "voice.ogg";
  if (normalized.includes("mpeg")) return "voice.mp3";
  if (normalized.includes("mp4")) return "voice.m4a";
  if (normalized.includes("wav")) return "voice.wav";
  return "voice.webm";
}

interface SubscriptionCheckOptions {
  incrementUsage?: boolean;
  /** 'chat' (default) for free /chat path; 'homework' when guidedHomeworkAssignmentId present (raises free limit 10→50 for students with paying tutor). */
  context?: AiQuotaContext;
}

/**
 * Check user subscription, trial status, and daily message limits.
 * Thin wrapper around shared helper checkAiQuota in _shared/subscription-limits.ts —
 * canonical AI-quota logic lives there and is reused by homework-api guards.
 */
async function checkSubscriptionAndLimits(
  userId: string,
  adminSupabase: any,
  options: SubscriptionCheckOptions = {},
) {
  return checkAiQuota(userId, adminSupabase, options);
}

async function transcribeVoiceMessage(req: Request, userId: string, adminSupabase: any): Promise<Response> {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return new Response(JSON.stringify({ error: "Ожидалась загрузка аудиофайла" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof Blob)) {
    return new Response(JSON.stringify({ error: "Аудиофайл не найден" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (file.size === 0) {
    return new Response(JSON.stringify({ error: "Пустое голосовое сообщение" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (file.size > MAX_VOICE_BYTES) {
    return new Response(JSON.stringify({ error: "Голосовое сообщение слишком большое" }), {
      status: 413,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const mimeType = file.type || "application/octet-stream";
  if (!isAcceptedVoiceMimeType(mimeType)) {
    return new Response(JSON.stringify({ error: "Неподдерживаемый формат голосового сообщения" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Voice transcription uses 'chat' context — multipart/form-data has no guidedHomework hint,
  // and rare-enough that nailing context=homework here is out of scope. If a paying tutor's
  // student hits 10/day on voice alone, that's an edge case (voice rarely used in homework).
  const quotaResult = await checkAiQuota(
    userId,
    adminSupabase,
    { incrementUsage: true, context: "chat" },
  );

  if (!quotaResult.allowed) {
    return buildLimitReachedResponse(quotaResult, corsHeaders);
  }

  const groqApiKey = Deno.env.get("GROQ_API_KEY");
  if (!groqApiKey) {
    console.error("GROQ_API_KEY is not configured for voice transcription");
    return new Response(JSON.stringify({ error: "Расшифровка голосовых временно недоступна" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const uploadedName = file instanceof File ? file.name : undefined;
  const outboundForm = new FormData();
  outboundForm.append("file", file, getVoiceFilename(mimeType, uploadedName));
  outboundForm.append("model", VOICE_TRANSCRIPTION_MODEL);
  outboundForm.append("language", "ru");

  console.log("Voice transcription request received", {
    userId,
    mimeType,
    size: file.size,
  });

  const transcriptionRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
    },
    body: outboundForm,
  });

  if (!transcriptionRes.ok) {
    const errText = await transcriptionRes.text().catch(() => "unknown");
    console.error("Voice transcription failed", {
      userId,
      status: transcriptionRes.status,
      body: errText,
    });
    return new Response(JSON.stringify({ error: "Не удалось расшифровать голосовое сообщение" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const transcriptionData = await transcriptionRes.json();
  const text = typeof transcriptionData?.text === "string"
    ? transcriptionData.text.trim()
    : "";

  if (!text) {
    return new Response(JSON.stringify({ error: "Не удалось распознать речь" }), {
      status: 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const pathname = new URL(req.url).pathname;
    const isVoiceTranscriptionRoute = pathname.endsWith("/transcribe-voice");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Требуется авторизация" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isServiceRole = authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    
    // Create admin client for subscription checks
    const adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    if (isVoiceTranscriptionRoute) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
        global: { headers: { Authorization: authHeader } },
      });

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Неверный токен" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return await transcribeVoiceMessage(req, user.id, adminSupabase);
    }
    
    let userId: string;
    
    if (isServiceRole) {
      const body = await req.json() as ChatRequestBody;
      
      if (!body.userId) {
        return new Response(JSON.stringify({ error: "userId required for service role requests" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      userId = body.userId;

      const { messages, systemPrompt, taskContext, taskImageUrls, studentImageUrl, studentImageUrls, chatId, studentName, studentGender, guidedHomeworkAssignmentId, guidedHomeworkTaskId, subject } = body;
      const responseProfile = normalizeResponseProfile(body.responseProfile);
      const responseMode = normalizeResponseMode(body.responseMode);
      const maxChars = normalizeMaxChars(body.maxChars);

      // Apply the same limits for Telegram/service callers. Context = 'homework' when the
      // caller is talking about a guided homework task (bootstrap intro, discuss step) so
      // free-students of paying tutors get the 50/day cap instead of 10.
      const quotaContext: AiQuotaContext = guidedHomeworkAssignmentId ? "homework" : "chat";
      const quotaResult = await checkSubscriptionAndLimits(
        userId,
        adminSupabase,
        { context: quotaContext },
      );

      if (!quotaResult.allowed) {
        return buildLimitReachedResponse(quotaResult, corsHeaders);
      }

      return await processAIRequest(
        userId,
        messages,
        systemPrompt,
        taskContext,
        taskImageUrls,
        studentImageUrl,
        studentImageUrls,
        chatId,
        responseProfile,
        responseMode,
        maxChars,
        req,
        studentName,
        guidedHomeworkAssignmentId,
        guidedHomeworkTaskId,
        subject,
        studentGender,
      );
    } else {
      const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
        global: { headers: { Authorization: authHeader } },
      });

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Неверный токен" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      userId = user.id;

      const body = await req.json() as ChatRequestBody;
      const { messages, systemPrompt, taskContext, taskImageUrls, studentImageUrl, studentImageUrls, chatId, studentName, studentGender, guidedHomeworkAssignmentId, guidedHomeworkTaskId, subject } = body;
      const latestUserMessage = Array.isArray(messages)
        ? [...messages].reverse().find((message) => message?.role === "user")
        : null;
      const shouldIncrementUsage = latestUserMessage?.input_method !== "voice";

      // Check subscription and daily limits. Context = 'homework' when guidedHomeworkAssignmentId
      // is present (chat-discuss + bootstrap intro inside ДЗ) → free students of paying tutors
      // get 50/day cap instead of 10. See _shared/subscription-limits.ts.
      const quotaContext: AiQuotaContext = guidedHomeworkAssignmentId ? "homework" : "chat";
      const quotaResult = await checkSubscriptionAndLimits(
        userId,
        adminSupabase,
        { incrementUsage: shouldIncrementUsage, context: quotaContext },
      );

      if (!quotaResult.allowed) {
        return buildLimitReachedResponse(quotaResult, corsHeaders);
      }
      const responseProfile = normalizeResponseProfile(body.responseProfile);
      const responseMode = normalizeResponseMode(body.responseMode);
      const maxChars = normalizeMaxChars(body.maxChars);

      return await processAIRequest(
        userId,
        messages,
        systemPrompt,
        taskContext,
        taskImageUrls,
        studentImageUrl,
        studentImageUrls,
        chatId,
        responseProfile,
        responseMode,
        maxChars,
        req,
        studentName,
        guidedHomeworkAssignmentId,
        guidedHomeworkTaskId,
        subject,
        studentGender,
      );
    }
  } catch (error) {
    console.error("Error in chat function:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Внутренняя ошибка сервера" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processAIRequest(
  userId: string,
  messages: any[],
  systemPrompt?: string,
  taskContext?: string,
  taskImageUrls?: string[],
  studentImageUrl?: string,
  studentImageUrls?: string[],
  chatId?: string,
  responseProfile: ResponseProfile = "default",
  responseMode: ResponseMode = "dialog",
  maxChars?: number,
  req?: Request,
  studentName?: string,
  guidedHomeworkAssignmentId?: string,
  guidedHomeworkTaskId?: string,
  clientSubject?: string | null,
  // Phase 8 (2026-05-20): explicit student gender для grammar conjugation.
  // Client supplies as hint; server-side подтверждает через tutor_students.gender
  // → profiles.gender lookup когда есть guidedHomeworkAssignmentId.
  clientStudentGender?: "male" | "female" | null,
) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (!Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "Некорректный формат сообщений" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      return new Response(JSON.stringify({ error: "Некорректное содержимое сообщения" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    if (!lastMessage.image_url && (!lastMessage.content || lastMessage.content.trim() === '')) {
      return new Response(JSON.stringify({ error: "Некорректное содержимое сообщения" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (lastMessage.role === "user" && 
        typeof lastMessage.content === "string" && 
        lastMessage.content.length > MAX_MESSAGE_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Сообщение слишком длинное (макс. ${MAX_MESSAGE_LENGTH} символов)` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  const transformedMessages = await Promise.all(messages.map(async (msg: any) => {
    if (msg.image_url) {
      console.log("📷 Processing message with image:", msg.image_url.substring(0, 100) + "...");

      if (!isValidImageUrl(msg.image_url)) {
        console.error('[SECURITY] Rejected invalid image URL:', msg.image_url);
        return {
          role: msg.role,
          content: msg.content || "Image was rejected due to security policy",
        };
      }

      // Download and convert to base64 — Lovable gateway doesn't fetch external URLs
      const base64Url = await fetchImageAsBase64DataUrl(msg.image_url);
      if (!base64Url) {
        console.error("📷 Failed to download message image, skipping:", msg.image_url.slice(0, 80));
        return {
          role: msg.role,
          content: msg.content || "Изображение не удалось загрузить",
        };
      }

      return {
        role: msg.role,
        content: [
          {
            type: "text",
            text: msg.content || "Помоги решить эту задачу",
          },
          {
            type: "image_url",
            image_url: {
              url: base64Url,
            },
          },
        ],
      };
    }

    return {
      role: msg.role,
      content: msg.content,
    };
  }));

  const adminSupabase = createClient<any>(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Fetch tutor's reference solution server-side for guided homework context.
  // Student-side API never exposes solution_text / solution_image_urls directly —
  // we verify here that `userId` is assigned to this homework before loading.
  // See plan wild-swinging-nova.md (2026-04-18).
  let tutorSolutionText: string | null = null;
  let tutorSolutionImageDataUrls: string[] = [];
  // Resolved subject for guided homework context. Defaults to client-supplied value
  // (safe for non-guided / generic chat). When guidedHomeworkAssignmentId is present,
  // server-side DB value WINS over client-supplied to defend against tampering — see
  // plan §«chat/index.ts server-side подтверждение».
  let resolvedSubject: string | null = (clientSubject ?? "").trim() || null;
  // Phase 2 (2026-05-15): subject-rubric resolver inputs, hydrated from DB
  // when guidedHomeworkAssignmentId присутствует. Tutor-controlled (никогда
  // не доверять client). Used below for methodology block injection.
  let resolvedExamType: "ege" | "oge" | null = null;
  let resolvedKimNumber: number | null = null;
  let resolvedTaskKind: "numeric" | "extended" | "proof" | null = null;
  let resolvedRubricText: string | null = null;
  // Phase 8 (2026-05-20): start с client-supplied gender (UI consistency)
  // если есть; server-side lookup ниже WINS (anti-tamper).
  let resolvedStudentGender: "male" | "female" | null =
    clientStudentGender === "male" || clientStudentGender === "female"
      ? clientStudentGender
      : null;
  if (guidedHomeworkAssignmentId && guidedHomeworkTaskId) {
    try {
      const { data: assignmentRow, error: assignmentErr } = await adminSupabase
        .from("homework_tutor_student_assignments")
        .select("assignment_id")
        .eq("assignment_id", guidedHomeworkAssignmentId)
        .eq("student_id", userId)
        .maybeSingle();
      if (assignmentErr) {
        // DB/RLS failure — log as operational issue, do not pretend this was an access denial.
        console.warn("guided_chat_solution_db_error", {
          stage: "assignment_lookup",
          assignment_id: guidedHomeworkAssignmentId,
          user_id: userId,
          error: assignmentErr.message,
        });
      } else if (!assignmentRow) {
        // True access denial — student is not assigned to this homework.
        console.warn("guided_chat_solution_access_denied", {
          assignment_id: guidedHomeworkAssignmentId,
          user_id: userId,
        });
      } else {
        // Server-side fetch of canonical assignment.subject + exam_type +
        // task.kim_number + task.task_kind + task.rubric_text — input для
        // subject-rubric resolver (Phase 2, 2026-05-15). Defends against
        // client tampering. Done in parallel with taskRow fetch (latency = 0).
        //
        // Phase 8 (2026-05-20): assignment.tutor_id тоже fetched чтобы
        // дальше lookup tutor_students.gender (по tutor_id + student_id pair).
        const [taskRowResp, assignmentMetaResp] = await Promise.all([
          adminSupabase
            .from("homework_tutor_tasks")
            .select("id, solution_text, solution_image_urls, kim_number, task_kind, check_format, rubric_text")
            .eq("id", guidedHomeworkTaskId)
            .eq("assignment_id", guidedHomeworkAssignmentId)
            .maybeSingle(),
          adminSupabase
            .from("homework_tutor_assignments")
            .select("subject, exam_type, tutor_id")
            .eq("id", guidedHomeworkAssignmentId)
            .maybeSingle(),
        ]);
        const { data: taskRow, error: taskErr } = taskRowResp;
        if (assignmentMetaResp.error) {
          console.warn("guided_chat_subject_db_error", {
            assignment_id: guidedHomeworkAssignmentId,
            error: assignmentMetaResp.error.message,
          });
        } else if (assignmentMetaResp.data && typeof assignmentMetaResp.data.subject === "string") {
          const dbSubject = assignmentMetaResp.data.subject.trim();
          if (dbSubject.length > 0) {
            // Server value wins. If client lied, we silently override.
            resolvedSubject = dbSubject;
          }
          // Phase 2: exam_type also hydrated from DB.
          const dbExamType = (assignmentMetaResp.data as { exam_type?: unknown }).exam_type;
          if (dbExamType === "ege" || dbExamType === "oge") {
            resolvedExamType = dbExamType;
          }
          // Phase 8 (2026-05-20): server-side gender lookup. Priority:
          // tutor_students.gender (tutor-curated) → profiles.gender (signup).
          // DB value WINS over client-supplied (anti-tamper).
          //
          // КРИТИЧНО (CLAUDE.md §8a + §28, regression fix 2026-05-26):
          //   homework_tutor_assignments.tutor_id = auth.users.id, но
          //   tutor_students.tutor_id ссылается на public.tutors.id (PK).
          //   Lookup без конвертации ВСЕГДА возвращает null. Резолвим
          //   tutors.user_id → tutors.id первым шагом.
          const tutorIdFromAssn = (assignmentMetaResp.data as { tutor_id?: unknown }).tutor_id;
          if (typeof tutorIdFromAssn === "string" && tutorIdFromAssn.length > 0) {
            try {
              // Convert auth.users.id → public.tutors.id (PK).
              const { data: tutorRow } = await adminSupabase
                .from("tutors")
                .select("id")
                .eq("user_id", tutorIdFromAssn)
                .maybeSingle();
              const tutorPkId = (tutorRow as { id?: string } | null)?.id;

              const tsLookup = tutorPkId
                ? adminSupabase
                    .from("tutor_students")
                    .select("gender")
                    .eq("tutor_id", tutorPkId)
                    .eq("student_id", userId)
                    .maybeSingle()
                : Promise.resolve({ data: null });

              const [tsGenderResp, profGenderResp] = await Promise.all([
                tsLookup,
                adminSupabase
                  .from("profiles")
                  .select("gender")
                  .eq("id", userId)
                  .maybeSingle(),
              ]);
              const tg = (tsGenderResp.data as { gender?: unknown } | null)?.gender;
              if (tg === "male" || tg === "female") {
                resolvedStudentGender = tg;
              } else {
                const pg = (profGenderResp.data as { gender?: unknown } | null)?.gender;
                if (pg === "male" || pg === "female") {
                  resolvedStudentGender = pg;
                }
              }
            } catch (genderErr) {
              // Non-fatal — AI falls back to neutral forms.
              console.warn("guided_chat_gender_lookup_failed", {
                assignment_id: guidedHomeworkAssignmentId,
                error: genderErr instanceof Error ? genderErr.message : String(genderErr),
              });
            }
          }
        }
        // Phase 2: per-task subject-rubric inputs from taskRow.
        if (taskRow) {
          const tk = (taskRow as { task_kind?: unknown }).task_kind;
          if (tk === "numeric" || tk === "extended" || tk === "proof") {
            resolvedTaskKind = tk;
          } else if ((taskRow as { check_format?: unknown }).check_format === "detailed_solution") {
            resolvedTaskKind = "extended";
          } else if ((taskRow as { check_format?: unknown }).check_format === "short_answer") {
            resolvedTaskKind = "numeric";
          }
          const kn = (taskRow as { kim_number?: unknown }).kim_number;
          if (typeof kn === "number" && Number.isFinite(kn)) {
            resolvedKimNumber = kn;
          }
          const rubric = (taskRow as { rubric_text?: unknown }).rubric_text;
          if (typeof rubric === "string" && rubric.trim().length > 0) {
            resolvedRubricText = rubric;
          }
        }
        if (taskErr) {
          console.warn("guided_chat_solution_db_error", {
            stage: "task_lookup",
            assignment_id: guidedHomeworkAssignmentId,
            task_id: guidedHomeworkTaskId,
            error: taskErr.message,
          });
        } else if (!taskRow) {
          console.warn("guided_chat_solution_task_not_found", {
            assignment_id: guidedHomeworkAssignmentId,
            task_id: guidedHomeworkTaskId,
          });
        } else {
          if (typeof taskRow.solution_text === "string" && taskRow.solution_text.trim().length > 0) {
            tutorSolutionText = taskRow.solution_text.trim();
          }
          // P0-1 v3 (plan wild-swinging-nova.md): attach solution images only
          // when solution_text is a MEANINGFUL anchor for the leak detector.
          // Rationale: our detector extracts tokens from solution_text; an anchor
          // of a few characters (e.g. "см. фото") produces almost no tokens and
          // leaves image content effectively unprotected against transcription
          // jailbreaks. Minimum 20 chars guarantees non-trivial token coverage.
          const SOLUTION_TEXT_ANCHOR_MIN_CHARS = 20;
          const hasAnchoringText =
            tutorSolutionText !== null && tutorSolutionText.length >= SOLUTION_TEXT_ANCHOR_MIN_CHARS;
          const solutionRefs = parseAttachmentUrls(taskRow.solution_image_urls as string | null | undefined);
          if (solutionRefs.length > 0) {
            if (hasAnchoringText) {
              tutorSolutionImageDataUrls = await resolveTaskImageUrlsForAI(
                adminSupabase as any,
                solutionRefs.slice(0, MAX_TASK_IMAGES_FOR_AI),
              );
            } else {
              console.warn(JSON.stringify({
                event: "guided_chat_solution_images_dropped_no_text",
                assignment_id: guidedHomeworkAssignmentId,
                task_id: guidedHomeworkTaskId,
                text_len: tutorSolutionText?.length ?? 0,
              }));
            }
          }
        }
      }
    } catch (err) {
      console.warn("guided_chat_solution_fetch_failed", {
        assignment_id: guidedHomeworkAssignmentId,
        task_id: guidedHomeworkTaskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let taskPromptImageDataUrls: string[] = [];
  const studentPromptImageDataUrls: string[] = [];

  console.log("📷 taskImageUrls received:", Array.isArray(taskImageUrls) ? taskImageUrls.length : 0);
  taskPromptImageDataUrls = await resolveTaskImageUrlsForAI(
    adminSupabase as any,
    (taskImageUrls ?? []).slice(0, MAX_TASK_IMAGES_FOR_AI),
  );

  // Anti-hallucination guard: if the task condition is on an image AND that
  // image failed to resolve (whitelist miss, signed-URL error, fetch failure),
  // the AI would otherwise see only a placeholder like "[Задача на фото]" and
  // invent a plausible problem (observed: KB electrostatics → guessed
  // thermodynamics). Fail closed instead — return a clear technical-error
  // message and skip the LLM call entirely. No fake ai_reply persists.
  const expectedTaskImagesForGuard = (taskImageUrls ?? []).filter(
    (u) => typeof u === "string" && u.trim().length > 0,
  ).length;
  const resolvedTaskImagesForGuard = taskPromptImageDataUrls.length;
  const taskTextStrForGuard = (taskContext ?? "").trim();
  const taskTextIsPlaceholderForGuard =
    taskTextStrForGuard.length === 0 ||
    /\[\s*задача\s+на\s+фото\s*\]|\[\s*task\s+on\s+(?:the\s+)?image\s*\]/i.test(taskTextStrForGuard);
  if (
    expectedTaskImagesForGuard > 0 &&
    resolvedTaskImagesForGuard === 0 &&
    taskTextIsPlaceholderForGuard
  ) {
    console.error(JSON.stringify({
      event: "guided_chat_task_image_missing",
      assignment_id: guidedHomeworkAssignmentId ?? null,
      task_id: guidedHomeworkTaskId ?? null,
      expected_images: expectedTaskImagesForGuard,
      resolved_images: resolvedTaskImagesForGuard,
      task_text_len: taskTextStrForGuard.length,
    }));
    return new Response(
      JSON.stringify({
        error:
          "Не удалось загрузить картинку с условием задачи. Это техническая проблема — попробуйте ещё раз через минуту, или перешлите условие текстом. Мы уже залогировали инцидент.",
        code: "task_image_missing",
      }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const normalizedStudentImageUrls = (Array.isArray(studentImageUrls) && studentImageUrls.length > 0
    ? studentImageUrls
    : (studentImageUrl ? [studentImageUrl] : [])
  )
    .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    .slice(0, MAX_GUIDED_CHAT_IMAGES_FOR_AI);

  console.log("📷 studentImageUrls received:", normalizedStudentImageUrls.length);
  for (const url of normalizedStudentImageUrls) {
    if (!isValidImageUrl(url)) {
      console.error("[SECURITY] Rejected invalid student image URL");
      continue;
    }

    const base64DataUrl = await fetchImageAsBase64DataUrl(url);
    if (base64DataUrl) {
      studentPromptImageDataUrls.push(base64DataUrl);
    } else {
      console.error("📷 Failed to download student image, proceeding without it");
    }
  }

  const promptAttachments: ChatPromptImageAttachment[] = [];
  if (studentPromptImageDataUrls.length > 0) {
    let imageCounter = 1;
    for (const [index, dataUrl] of studentPromptImageDataUrls.entries()) {
      promptAttachments.push({
        label: taskPromptImageDataUrls.length === 0 && studentPromptImageDataUrls.length === 1
          ? "Изображение выше — рукописное решение ученика."
          : `Изображение ${imageCounter} — решение ученика${studentPromptImageDataUrls.length > 1 ? `, файл ${index + 1}` : ""}.`,
        dataUrl,
      });
      imageCounter += 1;
    }
  }
  for (const [index, dataUrl] of taskPromptImageDataUrls.entries()) {
    promptAttachments.push({
      label: studentPromptImageDataUrls.length > 0 || taskPromptImageDataUrls.length > 1
        ? `Изображение ${studentPromptImageDataUrls.length + index + 1} — условие задачи${taskPromptImageDataUrls.length > 1 ? `, файл ${index + 1}` : ""}. Используй его для сверки с решением ученика.`
        : "Изображение выше — условие задачи.",
      dataUrl,
    });
  }

  const solutionOffset = studentPromptImageDataUrls.length + taskPromptImageDataUrls.length;
  for (const [index, dataUrl] of tutorSolutionImageDataUrls.entries()) {
    promptAttachments.push({
      label: `Изображение ${solutionOffset + index + 1} — эталонное решение от репетитора${tutorSolutionImageDataUrls.length > 1 ? `, файл ${index + 1}` : ""}. Используй для сверки, но НЕ цитируй дословно ученику.`,
      dataUrl,
    });
  }

  injectHomeworkImagesIntoLastUserMessage(transformedMessages, promptAttachments);

  // Используем Lovable AI Gateway напрямую
  // ЗАКОММЕНТИРОВАНО: OpenRouter логика
  // const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  // const useOpenRouter = Boolean(OPENROUTER_API_KEY);
  
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
  const apiKey = LOVABLE_API_KEY;
  const modelId = "google/gemini-3-flash-preview";

  if (!apiKey) {
    console.error("LOVABLE_API_KEY is not configured");
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  console.log(`🤖 Using Lovable Gateway (Gemini 3 Flash Preview)`);
  console.log("Calling AI gateway with messages:", transformedMessages.length);
  console.log("Response shaping:", { responseProfile, responseMode, maxChars: maxChars ?? null });

  let effectiveSystemPrompt = systemPrompt || SYSTEM_PROMPT;

  // Subject-aware guided homework block. When `guidedHomeworkAssignmentId` is
  // present, `resolvedSubject` is server-confirmed (DB value wins over
  // client-supplied) — see plan §«chat/index.ts server-side подтверждение».
  // Without this block, generic SYSTEM_PROMPT (focused on physics/maths
  // vocabulary) caused AI to answer French homework with «физическая величина».
  //
  // Phase 2 (2026-05-15): теперь инжектируем полный subject-rubric
  // methodology block (ФИПИ / DELF / IELTS критерии + tutor_rubric merge).
  // AI получает ту же rubric, что и в check / hint paths — консистентность
  // grading между chat-discussion, check answer и hint request.
  if (guidedHomeworkAssignmentId && resolvedSubject) {
    const rubric = resolveSubjectRubric({
      subject: resolvedSubject,
      exam_type: resolvedExamType,
      kim_number: resolvedKimNumber,
      task_kind: resolvedTaskKind ?? "extended",
      task_text: taskContext ?? null,
      tutor_rubric: resolvedRubricText,
    });
    const subjectBlock = [
      "",
      "=== ТЕКУЩИЙ КОНТЕКСТ ДЗ ===",
      `Это guided homework chat по предмету «${rubric.subject_label}».`,
      rubric.cefr_level ? `Целевой уровень CEFR: ${rubric.cefr_level}.` : "",
      `Все подсказки, проверки и разъяснения должны быть строго из области ${rubric.subject_label}.`,
      "НЕ упоминай законы, величины, правила или термины из других предметов.",
      rubric.hint_examples,
      "",
      "МЕТОДОЛОГИЯ ОЦЕНКИ (используй для проверки и подсказок, AI должен думать в этих категориях):",
      rubric.methodology,
      rubric.tutor_rubric_active
        ? "ПРИОРИТЕТ: критерии репетитора (выше) важнее стандартной методологии при конфликте."
        : "",
    ].filter(Boolean).join("\n");
    effectiveSystemPrompt = `${effectiveSystemPrompt}\n${subjectBlock}`;
  }

  if (taskContext) {
    effectiveSystemPrompt = `${effectiveSystemPrompt}\n\n📋 КОНТЕКСТ ЗАДАЧИ:\n${taskContext}\n\nИспользуй ИМЕННО эту задачу в своих ответах. НЕ придумывай другие задачи!`;
  }

  // Inject tutor's reference solution with anti-spoiler contract (guided homework only).
  const hasTutorSolution = tutorSolutionText !== null || tutorSolutionImageDataUrls.length > 0;
  if (hasTutorSolution) {
    const solutionBlock = [
      "",
      "📎 ЭТАЛОННОЕ РЕШЕНИЕ РЕПЕТИТОРА (только для твоей сверки):",
      tutorSolutionText ? tutorSolutionText : "[текст решения на прикреплённых фото выше]",
      "",
      "АНТИ-СПОЙЛЕР (КРИТИЧНО):",
      " - НЕ цитируй формулы из решения дословно, если ученик ещё не дошёл до этого шага.",
      " - НЕ называй численные подстановки или финальные выражения из решения.",
      " - НЕ пересказывай ход решения ученику.",
      " - Работай Сократовским методом: один наводящий вопрос к следующему микрошагу, опираясь на логику эталона.",
    ].join("\n");
    effectiveSystemPrompt = `${effectiveSystemPrompt}\n${solutionBlock}`;
  }

  // Phase 8 (2026-05-20): student identity guidance — name + EXPLICIT gender
  // + praise variation + frequency cap. Mirror of guided_ai.ts
  // buildStudentNameGuidance (Deno cannot import across edge functions).
  //
  // PLACEMENT note: chat path строит prompt linearly (base → subject →
  // task → solution → name → telegram). Раньше name guidance был в самом
  // конце — тонул. Сейчас он перед telegram appendix, но после solution
  // block. Для guided_ai.ts buildCheckPrompt placement в самое начало
  // (после rubric.role). Идеально было бы и здесь prepend, но
  // resolvedStudentGender populates inline во время subject hydration,
  // поэтому compromise: после solution block, перед telegram.
  //
  // GENDER source: resolvedStudentGender (server-side подтверждено через
  // tutor_students.gender → profiles.gender, anti-tamper). Client-supplied
  // studentGender — только hint, DB value wins.
  const trimmedName = (studentName && typeof studentName === "string") ? studentName.trim().slice(0, 100) : "";
  if (trimmedName || resolvedStudentGender) {
    const nameLines: string[] = [""];
    if (trimmedName) {
      nameLines.push(`Имя ученика: ${trimmedName}.`);
    }
    nameLines.push(
      "- Обращайся по имени иногда (примерно в 1-2 сообщениях из 5, не в каждом — звучит навязчиво). Хорошие моменты для имени: приветствие в начале задачи, поздравление при правильном ответе. В остальных сообщениях — без имени.",
    );
    if (resolvedStudentGender === "female") {
      nameLines.push(
        "- Пол ученика: ЖЕНСКИЙ. Используй женский род для глаголов прошедшего времени и прилагательных: «ты подставила», «ты решила», «ты написала», «ты допустила ошибку», «ты молодец», «ты внимательная». Не используй мужской род даже если имя звучит иностранно.",
      );
    } else if (resolvedStudentGender === "male") {
      nameLines.push(
        "- Пол ученика: МУЖСКОЙ. Используй мужской род: «ты подставил», «ты решил», «ты написал», «ты допустил ошибку», «ты молодец», «ты внимательный». Не используй женский род даже если имя звучит иностранно.",
      );
    } else {
      nameLines.push(
        "- Пол ученика не указан. Используй гендер-нейтральные формы: «ты справился/справилась», «получилось», «есть прогресс», «верно подмечено», «отличный ход», «молодец» — либо безличные конструкции. Не угадывай пол по имени — лучше нейтрально.",
      );
    }
    nameLines.push(
      "- При похвале ВАРЬИРУЙ фразы. Выбирай из: «Молодец», «Отлично», «Точно», «Верно», «Грамотно», «Хороший ход», «Здорово подмечено», «То, что нужно», «Класс», «Правильно мыслишь». НЕ повторяй одну и ту же похвалу в двух подряд сообщениях.",
    );
    const nameGuidance = nameLines.join("\n");
    // PREPEND, not append.
    effectiveSystemPrompt = `${effectiveSystemPrompt}\n${nameGuidance}`;
  }

  if (responseProfile === "telegram_compact") {
    effectiveSystemPrompt = `${effectiveSystemPrompt}\n\n${buildTelegramCompactAppendix(responseMode, maxChars)}`;
  }

  // Формируем заголовки запроса
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // ЗАКОММЕНТИРОВАНО: Дополнительные заголовки для OpenRouter
  // if (useOpenRouter) {
  //   headers["HTTP-Referer"] = Deno.env.get("SITE_URL") || "https://sokratai.app";
  //   headers["X-Title"] = "Sokratai - AI Tutor";
  // }

  // Формируем тело запроса
  const requestBody: Record<string, unknown> = {
    model: modelId,
    messages: [
      {
        role: "system",
        content: effectiveSystemPrompt,
      },
      ...transformedMessages,
    ],
    stream: true,
  };

  // ЗАКОММЕНТИРОВАНО: Дополнительные параметры для OpenRouter + Gemini 3 Flash
  // if (useOpenRouter) {
  //   requestBody.reasoning = { effort: "medium" };
  //   requestBody.route = "fallback";
  //   requestBody.models = [
  //     "google/gemini-3-flash-preview",
  //     "google/gemini-2.5-flash",
  //     "google/gemini-2.0-flash-001"
  //   ];
  // }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("AI gateway error:", response.status, errorText);

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Превышен лимит запросов. Попробуйте позже." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "Требуется пополнение баланса." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`AI gateway error: ${response.status}`);
  }

  const { readable, writable } = new TransformStream();
  const reader = response.body!.getReader();
  const writer = writable.getWriter();
  const decoder = new TextDecoder();
  const textEncoder = new TextEncoder();

  let usageData: any = null;

  // P0-1 fix (plan wild-swinging-nova.md): when tutor reference solution is
  // loaded for a guided homework request, buffer the full response server-side
  // and validate against solution-leak BEFORE forwarding any tokens to the
  // student. This prevents jailbreak prompts from extracting the tutor solution
  // via /chat (system-prompt anti-spoiler instructions are not an access boundary).
  //
  // Phase 7 round 2 (2026-05-20, ChatGPT-5.5 review P0 #1):
  // Buffered path с **subject-aware detector**:
  //   humanities (russian/literature/english/french/spanish) → verbatim span
  //     (8+ words copy-paste) — catches model-letter атак, allows shared lexicon.
  //   non-humanities (physics/math/etc.) → token-based как раньше (numbers/formulas).
  // Phase 7 round 1 (commit 985a36c) полностью SKIPPED detector для humanities
  // → review раскрыл что system prompt не access boundary → AI может copy-paste
  // эталонное письмо. Round 2 закрывает gap span guard'ом без false positive.
  const isHumanitiesContext = isHumanitiesSubject(resolvedSubject);
  const guardedAgainstSolutionLeak = hasTutorSolution;
  if (hasTutorSolution && isHumanitiesContext) {
    console.info(JSON.stringify({
      event: "chat_leak_check_humanities_verbatim_mode",
      subject: resolvedSubject,
      assignment_id: guidedHomeworkAssignmentId ?? null,
      task_id: guidedHomeworkTaskId ?? null,
      detector: "verbatim_span",
    }));
  }

  (async () => {
    try {
      if (guardedAgainstSolutionLeak) {
        // ── Buffered path: collect the whole AI output, check for leaks, then
        //    emit the result (or a safe fallback) as one streamed SSE event. ──
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const rawLine of chunk.split("\n")) {
            const line = rawLine.trim();
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.usage) usageData = parsed.usage;
              const delta = parsed.choices?.[0]?.delta?.content;
              if (typeof delta === "string") fullText += delta;
            } catch {
              // Ignore malformed SSE payloads; do NOT forward raw chunks here.
            }
          }
        }

        let emittedText = fullText.trim();
        // Phase 7 round 2: subject-aware leak detection.
        const leakHit = isHumanitiesContext
          ? containsVerbatimSpan(emittedText, tutorSolutionText, taskContext ?? null)
          : containsSolutionLeak(emittedText, tutorSolutionText, taskContext ?? null);
        if (leakHit) {
          console.warn(JSON.stringify({
            event: "chat_solution_leak_rejected",
            subject: resolvedSubject,
            assignment_id: guidedHomeworkAssignmentId ?? null,
            task_id: guidedHomeworkTaskId ?? null,
            user_id: userId,
          }));
          // Phase 7 (2026-05-16): subject-aware fallback вместо hardcoded
          // физической фразы «Назови величину, с которой начнёшь». Для humanities
          // этот path уже skipped выше (guardedAgainstSolutionLeak=false), здесь
          // обрабатываем только non-humanities subjects где leak detector
          // работает корректно. resolveSubjectRubric возвращает subject-appropriate
          // fallback_hint (physics → «Какая физическая величина...», maths →
          // «Какая формула / теорема...», etc.).
          let subjectAwareFallback =
            "Давай разберём шаг за шагом — какая часть условия требует пояснения, чтобы я мог направить дальше?";
          if (resolvedSubject) {
            try {
              const rubric = resolveSubjectRubric({
                subject: resolvedSubject,
                exam_type: null,
                kim_number: null,
                task_kind: "extended",
                task_text: taskContext ?? null,
                tutor_rubric: null,
              });
              if (rubric.fallback_hint && rubric.fallback_hint.trim().length > 0) {
                subjectAwareFallback = rubric.fallback_hint;
              }
            } catch (rubricErr) {
              console.warn(JSON.stringify({
                event: "chat_leak_fallback_rubric_resolve_failed",
                subject: resolvedSubject,
                error: rubricErr instanceof Error ? rubricErr.message : String(rubricErr),
              }));
            }
          }
          emittedText = subjectAwareFallback;
        }

        // Emit the validated text as a single delta + [DONE], matching the
        // SSE contract that streamChat on the client expects.
        const safeChunk = JSON.stringify({
          choices: [{ delta: { content: emittedText }, index: 0 }],
        });
        await writer.write(textEncoder.encode(`data: ${safeChunk}\n\n`));
        await writer.write(textEncoder.encode("data: [DONE]\n\n"));
      } else {
        // ── Pass-through streaming path (original behavior). ──
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ") && !line.includes("[DONE]")) {
              try {
                const jsonStr = line.slice(6).trim();
                const parsed = JSON.parse(jsonStr);
                if (parsed.usage) {
                  usageData = parsed.usage;
                }
              } catch {
                // Ignore parsing errors
              }
            }
          }

          await writer.write(value);
        }
      }

      if (usageData) {
        console.log("Tokens used:", {
          prompt: usageData.prompt_tokens,
          completion: usageData.completion_tokens,
          total: usageData.total_tokens,
        });

        const adminSupabase = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        );

        await adminSupabase.from("token_usage_logs").insert({
          user_id: userId,
          chat_id: chatId || null,
          model: modelId,  // Динамически используемая модель
          prompt_tokens: usageData.prompt_tokens,
          completion_tokens: usageData.completion_tokens,
          total_tokens: usageData.total_tokens,
        });
      }
    } catch (e) {
      console.error("Error processing stream:", e);
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}
