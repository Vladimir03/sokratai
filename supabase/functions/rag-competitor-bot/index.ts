/**
 * RAG Competitor Bot — Telegram bot backed by in-context RAG.
 *
 * Architecture:
 *   Telegram webhook → this Edge Function → OpenAI GPT (with full KB in prompt) → reply to Telegram
 *
 * Required env vars:
 *   RAG_BOT_TOKEN        — Telegram bot token (from BotFather)
 *   OPENAI_API_KEY        — OpenAI API key
 *   SUPABASE_URL          — auto-set by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase
 *
 * Knowledge base is stored in Supabase Storage bucket "rag-knowledge-base" as "knowledge_base.txt".
 * Upload it once via the provided upload script.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

// ── Config ──────────────────────────────────────────────────────────────────

const RAG_BOT_TOKEN = Deno.env.get("RAG_BOT_TOKEN");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TELEGRAM_API = `https://api.telegram.org/bot${RAG_BOT_TOKEN}`;

const SYSTEM_PROMPT = `Ты — AI-ассистент по изучению рынка и конкурентов в сфере EdTech / онлайн-образования.

Твоя задача — отвечать на вопросы пользователя СТРОГО на основе предоставленной базы знаний (переписки команды об изучении рынка, конкурентах, трендах образования, ЕГЭ/ОГЭ, репетиторстве).

Правила:
1. Отвечай только на основе информации из базы знаний ниже.
2. Если в базе знаний нет информации для ответа — честно скажи об этом.
3. Цитируй источники (автор, дата) когда это уместно.
4. Отвечай на русском языке.
5. Будь конкретным и полезным.
6. Если вопрос касается конкурентов, продуктов, метрик, трендов — ищи в базе знаний все релевантные упоминания.

БАЗА ЗНАНИЙ:
`;

// ── In-memory cache for knowledge base ──────────────────────────────────────

let knowledgeBaseCache: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getKnowledgeBase(): Promise<string> {
  const now = Date.now();
  if (knowledgeBaseCache && now - cacheTimestamp < CACHE_TTL_MS) {
    return knowledgeBaseCache;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase.storage
    .from("rag-knowledge-base")
    .download("knowledge_base.txt");

  if (error) {
    console.error("Failed to load knowledge base:", error);
    throw new Error("Knowledge base not available");
  }

  knowledgeBaseCache = await data.text();
  cacheTimestamp = now;
  console.log(`Knowledge base loaded: ${knowledgeBaseCache.length} chars`);
  return knowledgeBaseCache;
}

// ── Simple in-memory conversation history (per chat_id, last N messages) ────

const conversationHistory = new Map<number, Array<{ role: string; content: string }>>();
const MAX_HISTORY = 6; // last 3 exchanges (user + assistant)

function getHistory(chatId: number) {
  return conversationHistory.get(chatId) || [];
}

function addToHistory(chatId: number, role: string, content: string) {
  const history = getHistory(chatId);
  history.push({ role, content });
  // Keep only last N messages
  while (history.length > MAX_HISTORY) {
    history.shift();
  }
  conversationHistory.set(chatId, history);
}

// ── OpenAI call ─────────────────────────────────────────────────────────────

async function askOpenAI(question: string, chatId: number): Promise<string> {
  const kb = await getKnowledgeBase();
  const history = getHistory(chatId);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT + kb },
    ...history,
    { role: "user", content: question },
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("OpenAI error:", response.status, errText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content ?? "Не удалось получить ответ.";

  // Save to history
  addToHistory(chatId, "user", question);
  addToHistory(chatId, "assistant", answer);

  return answer;
}

// ── Telegram helpers ────────────────────────────────────────────────────────

async function sendTelegramMessage(chatId: number, text: string) {
  // Telegram max message length is 4096
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, 4000));
    remaining = remaining.slice(4000);
  }

  for (const chunk of chunks) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: "Markdown",
      }),
    });
  }
}

async function sendTypingAction(chatId: number) {
  await fetch(`${TELEGRAM_API}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS for manual invocations
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    if (!RAG_BOT_TOKEN) throw new Error("RAG_BOT_TOKEN not set");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

    const body = await req.json();
    console.log("Incoming update:", JSON.stringify(body).slice(0, 500));

    const message = body.message;
    if (!message?.text) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const chatId = message.chat.id;
    const userText = message.text.trim();

    // Handle /start command
    if (userText === "/start") {
      await sendTelegramMessage(
        chatId,
        "Привет! 👋 Я бот-ассистент по конкурентам и маркетингу.\n\n" +
          "Задай мне вопрос, и я поищу ответ в базе знаний из вашей переписки.\n\n" +
          "Примеры вопросов:\n" +
          "• Какие конкуренты упоминались?\n" +
          "• Какие маркетинговые стратегии обсуждались?\n" +
          "• Что команда говорила про ценообразование?\n\n" +
          "Команда /clear — очистить историю диалога."
      );
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle /clear command
    if (userText === "/clear") {
      conversationHistory.delete(chatId);
      await sendTelegramMessage(chatId, "История диалога очищена ✅");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Send typing indicator
    await sendTypingAction(chatId);

    // Get AI answer
    const answer = await askOpenAI(userText, chatId);
    await sendTelegramMessage(chatId, answer);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 200, // Return 200 to Telegram so it doesn't retry
      headers: { "Content-Type": "application/json" },
    });
  }
});
