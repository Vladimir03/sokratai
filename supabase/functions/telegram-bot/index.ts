import { createClient } from "npm:@supabase/supabase-js@2";

function calculateLessonPaymentAmount(
  durationMin: number,
  hourlyRateCents: number | null | undefined
): number | null {
  if (hourlyRateCents == null || hourlyRateCents <= 0 || durationMin <= 0) {
    return null;
  }
  return Math.round((durationMin / 60) * (hourlyRateCents / 100));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_FORMAT_V2 = (Deno.env.get("TELEGRAM_FORMAT_V2") ?? "true").toLowerCase() === "true";
const TELEGRAM_DIALOG_MAX_CHARS = 1000;
const TELEGRAM_MESSAGE_MAX_LENGTH = 4000;
const SITE_BASE_URL = "https://sokratai.ru";
const TELEGRAM_HISTORY_LIMIT = 8; // max messages to send to AI from Telegram
const TELEGRAM_CHAT_TIMEOUT_MS = 55_000; // 55s timeout for AI chat call

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/**
 * Compact chat history for Telegram AI calls:
 * - Keep only last TELEGRAM_HISTORY_LIMIT messages
 * - Strip image_url from all but the latest user message with an image
 * This prevents payload bloat when students send multiple photos.
 */
function compactHistoryForTelegram(
  messages: Array<{ role: string; content: string; image_url?: string | null; image_path?: string | null }>,
): Array<{ role: string; content: string; image_url?: string | null }> {
  const trimmed = messages.slice(-TELEGRAM_HISTORY_LIMIT);

  // Find index of last user message with image
  let lastImageIdx = -1;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i].role === "user" && trimmed[i].image_url) {
      lastImageIdx = i;
      break;
    }
  }

  return trimmed.map((msg, i) => ({
    role: msg.role,
    content: msg.content,
    image_url: i === lastImageIdx ? msg.image_url : undefined,
  }));
}

/**
 * Merge consecutive same-role messages into one to ensure proper turn-taking.
 * This prevents AI failures when previous calls failed and left multiple
 * consecutive user messages without assistant responses.
 */
const MERGED_MESSAGE_MAX_CHARS = 8000;

function mergeConsecutiveUserMessages(
  messages: Array<{ role: string; content: string; image_url?: string | null }>,
): Array<{ role: string; content: string; image_url?: string | null }> {
  if (messages.length === 0) return messages;

  const merged: Array<{ role: string; content: string; image_url?: string | null }> = [];

  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role && msg.role === "user") {
      // Merge: join content, keep latest image_url
      const candidate = last.content + "\n\n" + msg.content;
      // Truncate from the start to keep the most recent context within limit
      if (candidate.length > MERGED_MESSAGE_MAX_CHARS) {
        last.content = "…" + candidate.slice(candidate.length - MERGED_MESSAGE_MAX_CHARS + 1);
      } else {
        last.content = candidate;
      }
      if (msg.image_url) {
        last.image_url = msg.image_url;
      }
    } else {
      merged.push({ ...msg });
    }
  }

  return merged;
}

/**
 * Fetch AI chat with timeout, retry on transient errors (network + 5xx), and fallback message.
 * Returns Response or null if fallback was sent.
 */
async function fetchChatWithTimeout(
  body: Record<string, unknown>,
  telegramUserId: number,
  label: string,
): Promise<Response | null> {
  const MAX_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 2000;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_CHAT_TIMEOUT_MS);

    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Retry on 5xx (gateway timeout, internal error, etc.)
      if (resp.status >= 500 && attempt < MAX_ATTEMPTS - 1) {
        const errBody = await resp.text().catch(() => "");
        console.warn(`[${label}] attempt ${attempt + 1} got ${resp.status}, retrying in ${RETRY_DELAY_MS}ms`, {
          telegramUserId,
          status: resp.status,
          bodyPreview: errBody.substring(0, 200),
        });
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }

      return resp;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;

      const isRetryable = err instanceof Error && (
        err.name === "AbortError" ||
        err.message.includes("network") ||
        err.message.includes("fetch") ||
        err.message.includes("ECONNRESET")
      );

      if (isRetryable && attempt < MAX_ATTEMPTS - 1) {
        console.warn(`[${label}] attempt ${attempt + 1} failed, retrying in ${RETRY_DELAY_MS}ms`, {
          telegramUserId,
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
    }
  }

  // All attempts exhausted
  const isTimeout = lastError instanceof Error && lastError.name === "AbortError";
  console.error(`[${label}] chat fetch failed after ${MAX_ATTEMPTS} attempts`, {
    telegramUserId,
    error: isTimeout ? "TIMEOUT" : (lastError instanceof Error ? lastError.message : String(lastError)),
    historySize: (body.messages as unknown[])?.length ?? 0,
  });
  await safeSendError(
    telegramUserId,
    "Сейчас отвечаю дольше обычного. Попробуй ещё раз или перейди на сайт: https://sokratai.ru/chat",
  );
  return null;
}
const WEB_PAYMENT_URL = "https://sokratai.ru/profile?openPayment=true";
const WEB_PRICING_URL = "https://sokratai.ru/#pricing";
const WEBAPP_FALLBACK_URL = "https://sokratai.lovable.app";

type TelegramResponseMode = "dialog" | "solution" | "hint" | "explain";

function getWebAppBaseUrl(): string {
  return Deno.env.get("VITE_WEBAPP_URL") || WEBAPP_FALLBACK_URL;
}

const pluralizeDays = (days: number) => {
  const mod10 = days % 10;
  const mod100 = days % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
};

const premiumKeyboard = {
  inline_keyboard: [
    [{ text: "💳 Оформить Premium — 699₽/мес", url: WEB_PAYMENT_URL }],
    [{ text: "📱 Открыть веб-версию", url: WEB_PRICING_URL }],
  ],
};

interface SubscriptionStatus {
  is_premium: boolean;
  subscription_expires_at: string | null;
  is_trial_active: boolean;
  trial_ends_at: string | null;
  trial_days_left: number;
  daily_limit: number;
  messages_used: number;
  limit_reached: boolean;
}

async function getSubscriptionStatus(userId: string): Promise<SubscriptionStatus | null> {
  const { data, error } = await supabase
    .rpc("get_subscription_status", { p_user_id: userId })
    .single();

  if (error) {
    console.error("Failed to fetch subscription status:", error);
    return null;
  }

  return data as SubscriptionStatus;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU");
}

function formatSubscriptionStatus(status: SubscriptionStatus): string {
  const lines: string[] = [];
  if (status.is_premium) {
    lines.push("🌟 <b>Premium активен</b>");
    lines.push(`Действует до: <b>${formatDate(status.subscription_expires_at)}</b>`);
  } else if (status.is_trial_active) {
    lines.push("🎁 <b>Триал активен</b>");
    lines.push(`Осталось: <b>${status.trial_days_left ?? 0}</b> ${pluralizeDays(status.trial_days_left ?? 0)}`);
    lines.push(`До: <b>${formatDate(status.trial_ends_at)}</b>`);
  } else {
    lines.push("🆓 <b>Бесплатный доступ</b>");
  }

  lines.push("");
  lines.push(`Сообщения сегодня: <b>${status.messages_used}</b> / ${status.daily_limit}`);

  if (status.limit_reached) {
    lines.push("⏳ <b>Дневной лимит исчерпан</b>");
  }

  return lines.join("\n");
}

async function sendStatusSnippet(telegramUserId: number, status: any) {
  if (!status) return;

  if (status.is_trial_active) {
    const daysText = pluralizeDays(status.trial_days_left ?? 0);
    await sendTelegramMessage(
      telegramUserId,
      `🎁 Триал активен: осталось ${status.trial_days_left} ${daysText}. Подключи Premium за 699₽/мес, чтобы безлимит не закончился.`,
      { reply_markup: premiumKeyboard },
    );
    return;
  }

  if (!status.is_premium && !status.is_trial_active && status.limit_reached) {
    await sendTelegramMessage(
      telegramUserId,
      `⏳ Достигнут дневной лимит ${status.daily_limit} сообщений. Оформи Premium за 699₽/мес, чтобы получить безлимит и приоритетные ответы.`,
      { reply_markup: premiumKeyboard },
    );
  }
}

async function maybeSendTrialReminder(telegramUserId: number, userId: string) {
  const status = await getSubscriptionStatus(userId);
  if (!status) return;

  if (status.is_trial_active && status.trial_days_left <= 2) {
    const daysText = pluralizeDays(status.trial_days_left);
    await sendTelegramMessage(
      telegramUserId,
      `⏰ Триал заканчивается через ${status.trial_days_left} ${daysText}. Подключи Premium за 699₽/мес, чтобы сохранить безлимит и приоритетные ответы.`,
      { reply_markup: premiumKeyboard },
    );
  }
}

type OnboardingState = "welcome" | "waiting_grade" | "waiting_subject" | "waiting_goal" | "completed";

interface OnboardingData {
  grade?: number;
  subject?: string;
  goal?: string;
  utm_source?: string;
  onboarding_message_id?: number;
}

// ============= PRACTICE & DIAGNOSTIC TYPES =============

type BotMode = "chat" | "practice" | "diagnostic";

interface PracticeState {
  ege_number: number;
  current_problem_id: string;
  started_at: string;
}

interface DiagnosticProblemRef {
  id: string;
  ege_number: number;
}

interface DiagnosticAnswerRecord {
  answer: string;
  is_correct: boolean;
}

interface DiagnosticState {
  session_id: string;
  problems: DiagnosticProblemRef[];
  current_index: number;
  answers: Record<number, DiagnosticAnswerRecord>;
}

interface EgeProblem {
  id: string;
  ege_number: number;
  condition_text: string;
  condition_image_url: string | null;
  correct_answer: string;
  answer_type: string;
  answer_tolerance: number;
  solution_text: string | null;
  hints: string[];
  topic: string;
  subtopic: string | null;
  difficulty: number;
}

// Метаданные номеров ЕГЭ
const EGE_NUMBER_NAMES: Record<number, string> = {
  1: "Планиметрия",
  2: "Векторы",
  3: "Стереометрия",
  4: "Теория вероятностей",
  5: "Теория вероятностей (сложная)",
  6: "Уравнения",
  7: "Выражения",
  8: "Функция",
  9: "Текстовые задачи",
  10: "Прикладные задачи",
  11: "График функции",
  12: "Наибольшее/наименьшее",
};

// Шкала перевода первичных баллов в тестовые (2025)
function primaryToTestScore(primary: number): number {
  const scale: Record<number, number> = {
    0: 0, 1: 5, 2: 11, 3: 18, 4: 25, 5: 34, 6: 40,
    7: 46, 8: 52, 9: 58, 10: 64, 11: 70, 12: 72,
  };
  return scale[primary] ?? 0;
}

// Нормализация ответа для сравнения
function normalizeAnswer(answer: string): string {
  return answer
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/,/g, ".")
    .replace(/−/g, "-")
    .replace(/–/g, "-");
}

// Проверка правильности ответа
function checkAnswer(
  userAnswer: string,
  correctAnswer: string,
  answerType: string,
  tolerance: number = 0
): boolean {
  const normalizedUser = normalizeAnswer(userAnswer);
  const normalizedCorrect = normalizeAnswer(correctAnswer);

  if (answerType === "integer") {
    return parseInt(normalizedUser) === parseInt(normalizedCorrect);
  } else if (answerType === "decimal") {
    const userNum = parseFloat(normalizedUser);
    const correctNum = parseFloat(normalizedCorrect);
    return Math.abs(userNum - correctNum) <= (tolerance || 0.001);
  } else {
    return normalizedUser === normalizedCorrect;
  }
}

const welcomeMessages: Record<string, string> = {
  default: `🎓 Привет! Я Сократ AI - твой умный помощник по учёбе!

Помогаю разбираться с:
📐 Математикой
⚛️ Физикой  
💻 Информатикой

Что я умею:
✅ Объясняю решения простым языком
✅ Разбираю задачи по шагам
✅ Отвечаю на вопросы 24/7
✅ Помогаю готовиться к экзаменам

Попробуй бесплатно 7 дней! 🚀

Давай познакомимся! Ответь на 3 простых вопроса, чтобы я мог лучше тебе помогать 👇`,

  header_try: `🎓 Привет! Я Сократ AI - твой AI-помощник по математике, физике и информатике!

Помогаю школьникам понимать сложные темы и готовиться к экзаменам.

Попробуй бесплатно 7 дней! 🚀

Чтобы я мог лучше тебе помогать, ответь на 3 коротких вопроса 👇`,

  plan_free: `🎓 Привет! Я Сократ AI!
👋 Отлично, что решил попробовать

В бесплатном тарифе у тебя:
✅ 10 сообщений в день
✅ Решение задач с объяснениями
✅ Работа на всех устройствах

Давай познакомимся! Ответь на 3 вопроса, чтобы я понял, как тебе лучше помочь 👇`,

  plan_premium: `🎓 Привет! Я Сократ AI!
🚀 Супер выбор. Популярный тариф - это максимум возможностей!

Что ты получаешь за 699₽/месяц:
♾️ Неограниченные сообщения
🎯 Персональный план подготовки
📊 Отслеживание прогресса

Но сначала - 7 дней бесплатно! 💪

Ответь на 3 вопроса, чтобы я подстроился под тебя 👇`,

  plan_pro: `🎓 Привет! Я Сократ AI!
🎯 Вау, ты нацелен на максимальный результат!

Тариф "AI + Репетитор" включает:
👨‍🏫 1 час с живым репетитором в неделю
🤖 Безлимитный AI-помощник 24/7

Начнем с AI-помощника (7 дней бесплатно).
Репетитора подключим после оплаты.

Сначала давай познакомимся! Ответь на 3 вопроса для персонализации 👇`,

  parent_trial: `Здравствуйте! Я Сократ AI - безопасный AI-помощник для подготовки к ЕГЭ.

Для родителей у нас есть:
✅ Полный контроль прогресса ребенка
✅ Отчеты об успеваемости
✅ Безопасная среда обучения

Давайте настроим помощника под вашего ребенка. Ответьте на 3 вопроса 👇`,
};

async function sendTelegramMessage(chatId: number, text: string, extraParams?: Record<string, any>) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...extraParams,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("❌ Telegram API error:", error);
    console.error("📝 Message preview (first 200 chars):", text.substring(0, 200));
    console.error("📊 Message length:", text.length);
    throw new Error("Failed to send message");
  }

  return response.json();
}

async function safeSendError(chatId: number, text: string): Promise<void> {
  try {
    await sendTelegramMessage(chatId, text);
  } catch (e) {
    console.error("safeSendError: failed to deliver error message", {
      chatId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ID группы для просмотра статистики
const ADMIN_STATS_CHAT_ID = -5270269461;

// === GROUP CHAT HELPERS ===

const TELEGRAM_BOT_USERNAME = (Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "SokratAIBot").toLowerCase();

function isGroupChat(chatType: string | undefined): boolean {
  return chatType === "group" || chatType === "supergroup";
}

function extractBotMention(
  text: string,
  entities: Array<{ type: string; offset: number; length: number }> | undefined,
  botUsername: string,
): string | null {
  if (!entities) return null;

  // Collect all bot mention positions, sort in reverse order to preserve offsets during removal
  const botMentions = entities
    .filter(e => e.type === "mention"
      && text.slice(e.offset, e.offset + e.length).toLowerCase() === `@${botUsername}`)
    .sort((a, b) => b.offset - a.offset);

  if (botMentions.length === 0) return null;

  let cleaned = text;
  for (const mention of botMentions) {
    cleaned = cleaned.slice(0, mention.offset) + cleaned.slice(mention.offset + mention.length);
  }
  cleaned = cleaned.trim();
  return cleaned || null;
}

function isReplyToOurBot(message: any, botUsername: string): boolean {
  const repliedFrom = message?.reply_to_message?.from;
  return repliedFrom?.is_bot === true
    && repliedFrom?.username?.toLowerCase() === botUsername;
}

// Функция получения статистики воронки 11-классников
async function getFunnelStats(): Promise<string> {
  try {
    // Шаг 1: Всего 11-классников зашли в бота
    const { data: step1 } = await supabase
      .from('telegram_sessions')
      .select('telegram_user_id, onboarding_data');
    
    const all11thGraders = step1?.filter(s => {
      const data = s as any;
      const grade = data.onboarding_data?.grade;
      return grade === 11 || grade === '11' || String(grade) === '11';
    }) || [];
    const total11 = all11thGraders.length;

    // Шаг 2: Прошли онбординг
    const { data: step2 } = await supabase
      .from('telegram_sessions')
      .select('telegram_user_id, user_id, onboarding_data')
      .eq('onboarding_state', 'completed');
    
    const onboarded11 = step2?.filter(s => {
      const data = s as any;
      return data.onboarding_data?.grade === 11 || data.onboarding_data?.grade === '11';
    }) || [];
    const completedOnboarding = onboarded11.length;
    const pct2 = total11 > 0 ? ((completedOnboarding / total11) * 100).toFixed(0) : '0';

    // Шаг 3: Выбрали математику
    const mathUsers = onboarded11.filter(s => {
      const data = s as any;
      return data.onboarding_data?.subject === 'math';
    });
    const mathSelected = mathUsers.length;
    const pct3 = completedOnboarding > 0 ? ((mathSelected / completedOnboarding) * 100).toFixed(0) : '0';
    
    // Получаем user_id тех кто выбрал математику
    const mathUserIds = mathUsers.map(u => (u as any).user_id).filter(Boolean);

    // Шаг 4: Отправили хотя бы 1 сообщение
    let sentMessage = 0;
    if (mathUserIds.length > 0) {
      const { data: messagesData } = await supabase
        .from('chat_messages')
        .select('user_id')
        .eq('role', 'user')
        .in('user_id', mathUserIds);
      
      const uniqueMessageUsers = new Set(messagesData?.map(m => m.user_id) || []);
      sentMessage = uniqueMessageUsers.size;
    }
    const pct4 = mathSelected > 0 ? ((sentMessage / mathSelected) * 100).toFixed(0) : '0';

    // Получаем telegram_user_id для 11-классников с математикой
    const mathTelegramIds = mathUsers.map(u => (u as any).telegram_user_id).filter(Boolean);

    // Шаг 5: Рассылка отправлена (только 11-классникам с математикой)
    const { data: broadcastSentData } = await supabase
      .from('broadcast_logs')
      .select('telegram_user_id')
      .in('broadcast_type', ['scheduled_morning', 'scheduled_evening']);
    
    // Фильтруем только 11-классников с математикой
    const broadcastSentToMath11 = broadcastSentData?.filter(b => 
      mathTelegramIds.includes(b.telegram_user_id)
    ) || [];
    const uniqueBroadcastSent = new Set(broadcastSentToMath11.map(b => b.telegram_user_id));
    const broadcastSent = uniqueBroadcastSent.size;
    const pct5 = mathSelected > 0 ? ((broadcastSent / mathSelected) * 100).toFixed(0) : '0';

    // Шаг 6: Рассылка доставлена (success=true, только 11-классникам)
    const { data: broadcastReceivedData } = await supabase
      .from('broadcast_logs')
      .select('telegram_user_id')
      .in('broadcast_type', ['scheduled_morning', 'scheduled_evening'])
      .eq('success', true);
    
    const broadcastReceivedToMath11 = broadcastReceivedData?.filter(b => 
      mathTelegramIds.includes(b.telegram_user_id)
    ) || [];
    const uniqueBroadcastReceived = new Set(broadcastReceivedToMath11.map(b => b.telegram_user_id));
    const broadcastReceived = uniqueBroadcastReceived.size;
    const pct6 = broadcastSent > 0 ? ((broadcastReceived / broadcastSent) * 100).toFixed(0) : '0';

    // Шаг 7: Начали тренажёр/диагностику
    // Смотрим practice_attempts + diagnostic_sessions
    let startedFeature = 0;
    if (mathUserIds.length > 0) {
      const { data: practiceData } = await supabase
        .from('practice_attempts')
        .select('user_id')
        .in('user_id', mathUserIds);
      
      const { data: diagData } = await supabase
        .from('diagnostic_sessions')
        .select('user_id')
        .in('user_id', mathUserIds);
      
      const featureUsers = new Set([
        ...(practiceData?.map(p => p.user_id) || []),
        ...(diagData?.map(d => d.user_id) || [])
      ]);
      startedFeature = featureUsers.size;
    }
    const pct7 = broadcastReceived > 0 ? ((startedFeature / broadcastReceived) * 100).toFixed(0) : '0';

    // Шаг 8: Диагностика - начали и завершили
    let startedDiag = 0;
    let completedDiag = 0;
    if (mathUserIds.length > 0) {
      const { data: diagSessions } = await supabase
        .from('diagnostic_sessions')
        .select('user_id, status')
        .in('user_id', mathUserIds);
      
      startedDiag = new Set(diagSessions?.map(d => d.user_id) || []).size;
      completedDiag = new Set(diagSessions?.filter(d => d.status === 'completed').map(d => d.user_id) || []).size;
    }

    // === АНАЛИТИКА ===
    
    // Среднее сообщений на активного пользователя
    let avgMessages = 0;
    if (sentMessage > 0) {
      const { data: msgCount } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('role', 'user')
        .in('user_id', mathUserIds);
      avgMessages = Math.round((msgCount?.length || 0) / sentMessage);
    }

    // Тренажёр: количество попыток и точность
    let practiceAttempts = 0;
    let practiceAccuracy = 0;
    if (mathUserIds.length > 0) {
      const { data: attempts } = await supabase
        .from('practice_attempts')
        .select('is_correct')
        .in('user_id', mathUserIds);
      
      practiceAttempts = attempts?.length || 0;
      const correct = attempts?.filter(a => a.is_correct).length || 0;
      practiceAccuracy = practiceAttempts > 0 ? Math.round(correct * 100 / practiceAttempts) : 0;
    }

    // Retention D1: пользователи, которые вернулись на следующий день
    let retentionD1 = 0;
    if (mathUserIds.length > 0) {
      const { data: userFirstMessages } = await supabase
        .from('chat_messages')
        .select('user_id, created_at')
        .eq('role', 'user')
        .in('user_id', mathUserIds)
        .order('created_at', { ascending: true });
      
      // Группируем по user_id и находим первую дату
      const firstDateByUser: Record<string, string> = {};
      userFirstMessages?.forEach(m => {
        if (!firstDateByUser[m.user_id]) {
          firstDateByUser[m.user_id] = m.created_at?.slice(0, 10) || '';
        }
      });
      
      // Проверяем, есть ли сообщения на следующий день или позже
      const returnedUsers = new Set<string>();
      userFirstMessages?.forEach(m => {
        const firstDate = firstDateByUser[m.user_id];
        const msgDate = m.created_at?.slice(0, 10) || '';
        if (firstDate && msgDate > firstDate) {
          returnedUsers.add(m.user_id);
        }
      });
      retentionD1 = returnedUsers.size;
    }
    const pctRetention = sentMessage > 0 ? Math.round(retentionD1 * 100 / sentMessage) : 0;

    const now = new Date();
    const moscowTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const timeStr = moscowTime.toISOString().slice(0, 16).replace('T', ' ');

    return `📊 <b>Воронка 11-класс тг бот</b>

1️⃣ Зашли в бота: <b>${total11}</b>
2️⃣ Прошли онбординг: <b>${completedOnboarding}</b> (${pct2}%)
3️⃣ Выбрали математику: <b>${mathSelected}</b> (${pct3}%)
4️⃣ Написали сообщение: <b>${sentMessage}</b> (${pct4}%)
5️⃣ Рассылка отправлена: <b>${broadcastSent}</b> (${pct5}%)
6️⃣ Рассылка доставлена: <b>${broadcastReceived}</b> (${pct6}%)
7️⃣ Начали тренажёр: <b>${startedFeature}</b> (${pct7}%)
8️⃣ Диагностика: начали <b>${startedDiag}</b> / завершили <b>${completedDiag}</b>

📈 <b>Аналитика</b>
🔄 Retention: <b>${retentionD1}</b> вернулись (${pctRetention}%)
💬 Сообщений на юзера: <b>${avgMessages}</b>
✏️ Тренажёр: <b>${practiceAttempts}</b> задач, точность <b>${practiceAccuracy}%</b>

📅 Обновлено: ${timeStr} МСК`;
  } catch (error) {
    console.error('Error getting funnel stats:', error);
    return '❌ Ошибка получения статистики';
  }
}

async function setMyCommands() {
  const commands = [
    { command: "start", description: "Начать работу" },
    { command: "menu", description: "Главное меню" },
    { command: "practice", description: "Тренажёр ЕГЭ" },
    { command: "diagnostic", description: "Диагностика уровня" },
    { command: "status", description: "Статус подписки" },
    { command: "help", description: "Справка" },
    { command: "pay", description: "Отметить оплату ученика (для репетиторов)" }
  ];

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to set bot commands:", error);
    return false;
  }

  console.log("✅ Bot commands set successfully");
  return true;
}

async function setChatMenuButton(chatId?: number) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      menu_button: { type: "commands" },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to set chat menu button:", error);
    return false;
  }

  console.log("✅ Chat menu button set successfully", chatId ? `for chat ${chatId}` : "(global)");
  return true;
}

async function editTelegramMessage(chatId: number, messageId: number, text: string, extraParams?: Record<string, any>) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      ...extraParams,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Telegram API error:", error);
    throw new Error("Failed to edit message");
  }

  return response.json();
}

async function getOrCreateProfile(telegramUserId: number, telegramUsername?: string) {
  // Check if profile exists
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (existingProfile) {
    return existingProfile;
  }

  // Try to claim a manually created placeholder profile by telegram username
  if (telegramUsername) {
    const normalizedUsername = telegramUsername.trim().replace(/^@/, "").toLowerCase();
    const { data: placeholderProfile, error: placeholderError } = await supabase
      .from("profiles")
      .select("*")
      .ilike("telegram_username", normalizedUsername)
      .is("telegram_user_id", null)
      .eq("registration_source", "manual")
      .maybeSingle();

    if (placeholderError) {
      console.error("Error checking placeholder profile:", placeholderError);
    }

    if (placeholderProfile) {
      const { data: updatedProfile, error: updateError } = await supabase
        .from("profiles")
        .update({
          telegram_user_id: telegramUserId,
          telegram_username: normalizedUsername,
          registration_source: "telegram",
        })
        .eq("id", placeholderProfile.id)
        .select()
        .single();

      if (updateError) {
        console.error("Error updating placeholder profile:", updateError);
        throw new Error("Failed to update placeholder profile");
      }

      return updatedProfile;
    }
  }

  // Create new user and profile
  const tempEmail = `telegram_${telegramUserId}@temp.sokratai.ru`;
  const tempPassword = crypto.randomUUID();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: tempEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      telegram_user_id: telegramUserId,
      telegram_username: telegramUsername,
    },
  });

  if (authError || !authData.user) {
    // Handle case where auth user already exists but profile lost telegram_user_id
    if (authError?.message?.includes("already been registered")) {
      console.log("Auth user already exists, looking up by email:", tempEmail);
      
      // Search with high perPage to find the user; default is only 50
      let existingUser = null;
      let page = 1;
      while (!existingUser && page <= 10) {
        const { data: listData } = await supabase.auth.admin.listUsers({ page, perPage: 500 });
        if (!listData?.users?.length) break;
        existingUser = listData.users.find(u => u.email === tempEmail);
        page++;
      }
      console.log("Lookup result:", existingUser ? `found user ${existingUser.id}` : "user not found");
      
      if (existingUser) {
        const { data: recoveredProfile, error: recoverError } = await supabase
          .from("profiles")
          .update({
            telegram_user_id: telegramUserId,
            telegram_username: telegramUsername,
            registration_source: "telegram",
          })
          .eq("id", existingUser.id)
          .select()
          .single();
        
        if (!recoverError && recoveredProfile) {
          console.log("Recovered existing profile:", recoveredProfile.id);
          return recoveredProfile;
        }

        // Profile row missing -- create it
        console.log("Profile missing for auth user, inserting:", existingUser.id);
        const { data: insertedProfile, error: insertError } = await supabase
          .from("profiles")
          .insert({
            id: existingUser.id,
            username: telegramUsername || `user_${telegramUserId}`,
            telegram_user_id: telegramUserId,
            telegram_username: telegramUsername,
            registration_source: "telegram",
            trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .select()
          .single();

        if (!insertError && insertedProfile) {
          console.log("Created missing profile:", insertedProfile.id);
          return insertedProfile;
        }
        console.error("Failed to insert missing profile:", insertError);
      }
    }
    
    console.error("Error creating user:", authError);
    throw new Error("Failed to create user");
  }

  // Update profile with telegram data
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .update({
      telegram_user_id: telegramUserId,
      telegram_username: telegramUsername,
      registration_source: "telegram",
    })
    .eq("id", authData.user.id)
    .select()
    .single();

  if (profileError) {
    console.error("Error updating profile:", profileError);
    throw new Error("Failed to update profile");
  }

  return profile;
}

async function getOnboardingSession(telegramUserId: number) {
  const { data } = await supabase
    .from("telegram_sessions")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  return data;
}

async function resolveCanonicalUserIdByTelegram(
  telegramUserId: number,
): Promise<{ id: string; onboarding_completed: boolean | null } | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, onboarding_completed")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (error) {
    console.error("resolveCanonicalUserIdByTelegram failed:", { telegramUserId, error });
    return null;
  }

  return (data as { id: string; onboarding_completed: boolean | null } | null) ?? null;
}

async function getOrRepairOnboardingSession(telegramUserId: number) {
  const session = await getOnboardingSession(telegramUserId);
  const canonicalProfile = await resolveCanonicalUserIdByTelegram(telegramUserId);

  if (!canonicalProfile) {
    return session;
  }

  if (!session) {
    const onboardingState = canonicalProfile.onboarding_completed ? "completed" : "welcome";
    const { error } = await supabase
      .from("telegram_sessions")
      .insert({
        telegram_user_id: telegramUserId,
        user_id: canonicalProfile.id,
        onboarding_state: onboardingState,
        onboarding_data: {},
      });

    if (error) {
      console.error("telegram_session_user_repair_failed", {
        telegram_user_id: telegramUserId,
        old_user_id: null,
        new_user_id: canonicalProfile.id,
        reason: "missing_session",
        error: error.message,
      });
      return session;
    }

    console.log("telegram_session_user_repaired", {
      telegram_user_id: telegramUserId,
      old_user_id: null,
      new_user_id: canonicalProfile.id,
      reason: "missing_session",
    });

    return {
      telegram_user_id: telegramUserId,
      user_id: canonicalProfile.id,
      onboarding_state: onboardingState,
      onboarding_data: {},
    };
  }

  if (session.user_id === canonicalProfile.id) {
    return session;
  }

  const { error: repairError } = await supabase
    .from("telegram_sessions")
    .update({ user_id: canonicalProfile.id })
    .eq("telegram_user_id", telegramUserId);

  if (repairError) {
    console.error("telegram_session_user_repair_failed", {
      telegram_user_id: telegramUserId,
      old_user_id: session.user_id ?? null,
      new_user_id: canonicalProfile.id,
      reason: "mismatch",
      error: repairError.message,
    });
    return session;
  }

  console.log("telegram_session_user_repaired", {
    telegram_user_id: telegramUserId,
    old_user_id: session.user_id ?? null,
    new_user_id: canonicalProfile.id,
    reason: "mismatch",
  });

  return { ...session, user_id: canonicalProfile.id };
}

async function updateOnboardingState(
  telegramUserId: number,
  userId: string,
  state: OnboardingState,
  data?: Partial<OnboardingData>,
) {
  const session = await getOnboardingSession(telegramUserId);

  if (session) {
    await supabase
      .from("telegram_sessions")
      .update({
        user_id: userId,
        onboarding_state: state,
        onboarding_data: data ? { ...session.onboarding_data, ...data } : session.onboarding_data,
      })
      .eq("telegram_user_id", telegramUserId);
  } else {
    await supabase.from("telegram_sessions").insert({
      telegram_user_id: telegramUserId,
      user_id: userId,
      onboarding_state: state,
      onboarding_data: data || {},
    });
  }
}

async function handleWebLogin(telegramUserId: number, telegramUsername: string | undefined, token: string) {
  console.log("handleWebLogin:", { telegramUserId, token });

  try {
    // Find the token
    const { data: tokenData, error: tokenError } = await supabase
      .from("telegram_login_tokens")
      .select("*")
      .eq("token", token)
      .eq("status", "pending")
      .single();

    if (tokenError || !tokenData) {
      console.log("Token not found or already used");
      await sendTelegramMessage(telegramUserId, "❌ Ссылка для входа недействительна или устарела. Попробуйте снова на сайте.");
      return;
    }

    // Check if expired
    if (new Date(tokenData.expires_at) < new Date()) {
      console.log("Token expired");
      await sendTelegramMessage(telegramUserId, "❌ Время для входа истекло. Попробуйте снова на сайте.");
      return;
    }

    // Get or create profile
    const profile = await getOrCreateProfile(telegramUserId, telegramUsername);
    console.log("Profile for web login:", { profileId: profile.id, registrationSource: profile.registration_source });

    let session = null;

    // Check if this is a web user by looking at their auth.users email
    const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(profile.id);
    
    const userEmail = authUserData?.user?.email;
    const isWebUser = userEmail && !userEmail.includes('@telegram.user') && !userEmail.includes('@temp.sokratai.ru');
    
    console.log("Auth user check:", { userEmail, isWebUser, error: authUserError?.message });

    if (isWebUser && userEmail) {
      // This is a web user with real email - generate session using admin API
      console.log("Web user detected, generating session for:", userEmail);
      
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: userEmail,
      });
      
      console.log("Generate link result:", { 
        hasHashedToken: !!linkData?.properties?.hashed_token, 
        error: linkError?.message 
      });
      
      if (linkData?.properties?.hashed_token) {
        // Verify the OTP to get the session
        const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: linkData.properties.hashed_token,
          type: "magiclink",
        });
        
        console.log("Verify OTP result:", { 
          hasSession: !!verifyData?.session, 
          error: verifyError?.message 
        });
        
        if (verifyData?.session) {
          session = verifyData.session;
        }
      }
    } else {
      // Telegram-only user - use generateLink + verifyOtp (same as web users)
      // This ensures we use the SAME user created by getOrCreateProfile
      const telegramEmail = userEmail || `telegram_${telegramUserId}@temp.sokratai.ru`;

      console.log("Telegram user, generating session via magic link for:", telegramEmail);

      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: telegramEmail,
      });

      if (linkError) {
        console.error("Generate link error for telegram user:", linkError);
      }

      if (linkData?.properties?.hashed_token) {
        const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: linkData.properties.hashed_token,
          type: "magiclink",
        });

        if (verifyError) {
          console.error("Verify OTP error for telegram user:", verifyError);
        }

        if (verifyData?.session) {
          session = verifyData.session;
          console.log("Telegram user session created via magic link");
        }
      }
    }

    if (!session) {
      console.error("Failed to create session for user");
      await sendTelegramMessage(telegramUserId, "❌ Не удалось создать сессию. Попробуйте войти через email на сайте.");
      return;
    }

    // Ensure tutor role and profile when intended_role is 'tutor'
    if (tokenData.intended_role === 'tutor') {
      console.log("Tutor role ensure:", { intended_role: tokenData.intended_role });

      // Ensure tutor role exists
      const { data: existingRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", profile.id)
        .eq("role", "tutor")
        .maybeSingle();

      if (!existingRole) {
        const { error: roleError } = await supabase
          .from("user_roles")
          .insert({ user_id: profile.id, role: "tutor" });

        if (roleError) {
          console.error("Failed to assign tutor role:", roleError);
        } else {
          console.log("Tutor role assigned:", profile.id);
        }
      }

      // Ensure tutor profile exists
      const { data: existingTutor } = await supabase
        .from("tutors")
        .select("id")
        .eq("user_id", profile.id)
        .maybeSingle();

      if (!existingTutor) {
        const tutorName = profile.username
          || (telegramUsername ? `@${telegramUsername}` : null)
          || "Репетитор";
        const bookingLink = `tutor-${profile.id.substring(0, 8)}`;

        const { error: tutorError } = await supabase
          .from("tutors")
          .insert({
            user_id: profile.id,
            name: tutorName,
            booking_link: bookingLink,
            telegram_id: String(telegramUserId),
            telegram_username: telegramUsername,
          });

        if (tutorError) {
          console.error("Failed to create tutor profile:", tutorError);
        } else {
          console.log("Tutor profile created:", profile.id);
        }
      }
    }

    // Update token with session data
    await supabase
      .from("telegram_login_tokens")
      .update({
        telegram_user_id: telegramUserId,
        user_id: profile.id,
        status: "verified",
        verified_at: new Date().toISOString(),
        session_data: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        },
      })
      .eq("id", tokenData.id);

    console.log("Token verified successfully");

    await sendTelegramMessage(telegramUserId, `✅ Авторизация подтверждена!

Вернитесь в браузер — вход произойдёт автоматически.`);

  } catch (error) {
    console.error("Web login error:", error);
    await sendTelegramMessage(telegramUserId, "❌ Произошла ошибка. Попробуйте снова.");
  }
}

async function handleLinkAccount(telegramUserId: number, telegramUsername: string | undefined, token: string) {
  console.log("handleLinkAccount:", { telegramUserId, token });

  try {
    // Find the token
    const { data: tokenData, error: tokenError } = await supabase
      .from("telegram_login_tokens")
      .select("*")
      .eq("token", token)
      .eq("status", "pending")
      .eq("action_type", "link")
      .single();

    if (tokenError || !tokenData) {
      console.log("Link token not found or already used");
      await sendTelegramMessage(telegramUserId, "❌ Ссылка для связки недействительна или устарела. Попробуйте снова в профиле.");
      return;
    }

    // Check if expired
    if (new Date(tokenData.expires_at) < new Date()) {
      console.log("Link token expired");
      await sendTelegramMessage(telegramUserId, "❌ Время для связки истекло. Попробуйте снова в профиле.");
      return;
    }

    // Get user_id from token (this is the existing web user)
    const userId = tokenData.user_id;
    if (!userId) {
      console.log("No user_id in link token");
      await sendTelegramMessage(telegramUserId, "❌ Ошибка: пользователь не найден. Попробуйте снова.");
      return;
    }

    // Check if this Telegram account is already linked to another user
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("telegram_user_id", telegramUserId)
      .single();

    if (existingProfile && existingProfile.id !== userId) {
      // Automatic profile merge instead of rejection
      console.log("Starting automatic profile merge", { 
        fromProfile: existingProfile.id, 
        toProfile: userId 
      });
      
      const oldUserId = existingProfile.id;
      const newUserId = userId;
      
      await sendTelegramMessage(telegramUserId, "🔄 Обнаружен существующий аккаунт. Объединяю данные...");
      
      // 1. Transfer all data from old profile to new one
      const tablesToMigrate = [
        'chats',
        'chat_messages', 
        'solutions',
        'homework_sets',
        'user_solutions',
        'token_usage_logs',
        'answer_attempts',
        'onboarding_analytics',
        'message_feedback',
        'message_interactions'
      ];
      
      for (const table of tablesToMigrate) {
        const { error } = await supabase
          .from(table)
          .update({ user_id: newUserId })
          .eq('user_id', oldUserId);
        
        if (error) {
          console.error(`Error migrating ${table}:`, error);
        } else {
          console.log(`Migrated ${table} successfully`);
        }
      }
      
      // 2. Merge user_stats (XP and streak)
      const { data: oldStats } = await supabase
        .from('user_stats')
        .select('*')
        .eq('user_id', oldUserId)
        .single();
        
      const { data: newStats } = await supabase
        .from('user_stats')
        .select('*')
        .eq('user_id', newUserId)
        .single();
      
      if (oldStats) {
        if (newStats) {
          // Merge: sum XP, take max streak
          await supabase
            .from('user_stats')
            .update({
              total_xp: (newStats.total_xp || 0) + (oldStats.total_xp || 0),
              current_streak: Math.max(newStats.current_streak || 0, oldStats.current_streak || 0),
              level: Math.max(newStats.level || 1, oldStats.level || 1)
            })
            .eq('user_id', newUserId);
          
          // Delete old stats entry
          await supabase
            .from('user_stats')
            .delete()
            .eq('user_id', oldUserId);
        } else {
          // Just transfer stats
          await supabase
            .from('user_stats')
            .update({ user_id: newUserId })
            .eq('user_id', oldUserId);
        }
      }
      
      // 3. Update telegram_sessions to point to new user
      await supabase
        .from('telegram_sessions')
        .update({ user_id: newUserId })
        .eq('telegram_user_id', telegramUserId);
      
      // 4. Delete old profile
      const { error: deleteProfileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', oldUserId);
      
      if (deleteProfileError) {
        console.error("Error deleting old profile:", deleteProfileError);
      }
      
      // 5. Delete old auth user
      const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(oldUserId);
      
      if (deleteAuthError) {
        console.error("Error deleting old auth user:", deleteAuthError);
      }
      
      console.log("Profile merge completed successfully");
      
      // Continue with linking telegram_user_id to new profile (code below handles this)
    }

    // Update the existing profile with Telegram data
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        telegram_user_id: telegramUserId,
        telegram_username: telegramUsername,
      })
      .eq("id", userId);

    if (updateError) {
      console.error("Error updating profile:", updateError);
      await sendTelegramMessage(telegramUserId, "❌ Ошибка при связке аккаунтов. Попробуйте снова.");
      return;
    }

    // Also update tutors table if user is a tutor
    const { data: tutorData } = await supabase
      .from("tutors")
      .select("id")
      .eq("user_id", userId)
      .single();

    if (tutorData) {
      const { error: tutorUpdateError } = await supabase
        .from("tutors")
        .update({
          telegram_id: telegramUserId.toString(),
          telegram_username: telegramUsername,
        })
        .eq("id", tutorData.id);

      if (tutorUpdateError) {
        console.error("Error updating tutor telegram:", tutorUpdateError);
      } else {
        console.log("Tutor telegram updated successfully");
      }
    }

    // Update token status
    await supabase
      .from("telegram_login_tokens")
      .update({
        telegram_user_id: telegramUserId,
        status: "verified",
        verified_at: new Date().toISOString(),
      })
      .eq("id", tokenData.id);

    console.log("Account linked successfully");

    const successMessage = existingProfile && existingProfile.id !== userId
      ? `✅ Аккаунты успешно объединены!

📊 Мы автоматически перенесли все твои данные:
• Чаты и сообщения
• Решения задач
• Домашние задания
• Статистику и XP

Теперь ты можешь:
📱 Отправлять задачи через Telegram
💻 Продолжать работу на сайте

Все данные синхронизированы! 🎉`
      : `✅ Аккаунты успешно связаны!

Теперь ты можешь:
📱 Отправлять задачи через Telegram
💻 Продолжать работу на сайте

Все данные синхронизированы! 🎉`;

    await sendTelegramMessage(telegramUserId, successMessage);

  } catch (error) {
    console.error("Link account error:", error);
    await sendTelegramMessage(telegramUserId, "❌ Произошла ошибка. Попробуйте снова.");
  }
}

async function handleTutorInvite(telegramUserId: number, telegramUsername: string | undefined, inviteCode: string) {
  console.log("handleTutorInvite:", { telegramUserId, inviteCode });

  try {
    // 1. Find tutor by invite_code
    const { data: tutor, error: tutorError } = await supabase
      .from("tutors")
      .select("id, name, user_id")
      .eq("invite_code", inviteCode)
      .single();

    if (tutorError || !tutor) {
      console.log("Tutor not found for invite code:", inviteCode);
      await sendTelegramMessage(
        telegramUserId,
        "❌ Ссылка недействительна или устарела. Попросите репетитора прислать новую ссылку."
      );
      return;
    }

    // 2. Get or create student profile
    const profile = await getOrCreateProfile(telegramUserId, telegramUsername);

    // 3. Check if this student is already linked to this tutor
    const { data: existingLink } = await supabase
      .from("tutor_students")
      .select("id")
      .eq("tutor_id", tutor.id)
      .eq("student_id", profile.id)
      .maybeSingle();

    if (existingLink) {
      console.log("Student already linked to tutor:", { studentId: profile.id, tutorId: tutor.id });
      await sendTelegramMessage(
        telegramUserId,
        `✅ Вы уже подключены к репетитору ${tutor.name}!\n\n📸 Отправляйте фото задач\n✏️ Пишите вопросы\n\nЯ помогу разобраться! 🚀`
      );
      return;
    }

    // 4. Create tutor_students link
    const { error: insertError } = await supabase
      .from("tutor_students")
      .insert({
        tutor_id: tutor.id,
        student_id: profile.id,
        status: "active",
      });

    if (insertError) {
      console.error("Error creating tutor_students link:", insertError);
      await sendTelegramMessage(
        telegramUserId,
        "❌ Произошла ошибка. Попробуйте ещё раз или обратитесь к репетитору."
      );
      return;
    }

    console.log("Successfully linked student to tutor:", { studentId: profile.id, tutorId: tutor.id });

    // 5. Send success message
    const successMessage = `🎉 Вас добавил репетитор ${tutor.name}!

Теперь вы можете:
📸 Отправлять фото задач из учебника
✏️ Писать задачи текстом
❓ Задавать любые вопросы по предмету

Я — AI-помощник Сократ AI. Помогу разобраться с любой задачей! 🚀`;

    await sendTelegramMessage(telegramUserId, successMessage);

    // 6. Continue with onboarding if not completed
    if (!profile.onboarding_completed) {
      await supabase.from("onboarding_analytics").insert({
        user_id: profile.id,
        source: "telegram",
        utm_source: `tutor_${inviteCode}`,
        telegram_user_id: telegramUserId,
        started_at: new Date().toISOString(),
      });
      await startOnboarding(telegramUserId, profile.id, `tutor_${inviteCode}`);
    }

  } catch (error) {
    console.error("handleTutorInvite error:", error);
    await sendTelegramMessage(telegramUserId, "❌ Произошла ошибка. Попробуйте снова.");
  }
}

async function handleStart(telegramUserId: number, telegramUsername: string | undefined, utmSource: string) {
  console.log("handleStart:", { telegramUserId, utmSource });

  // Check if this is a web login request
  if (utmSource.startsWith("login_")) {
    const token = utmSource.replace("login_", "");
    await handleWebLogin(telegramUserId, telegramUsername, token);
    return;
  }

  // Check if this is an account link request
  if (utmSource.startsWith("link_")) {
    const token = utmSource.replace("link_", "");
    await handleLinkAccount(telegramUserId, telegramUsername, token);
    return;
  }

  // Check if this is a tutor invite request
  if (utmSource.startsWith("tutor_")) {
    const inviteCode = utmSource.replace("tutor_", "");
    await handleTutorInvite(telegramUserId, telegramUsername, inviteCode);
    return;
  }

  // Get or create profile
  const profile = await getOrCreateProfile(telegramUserId, telegramUsername);

  // Check if user already completed onboarding - send welcome back message instead
  if (profile.onboarding_completed) {
    console.log("User already completed onboarding, sending welcome back message");
    await updateOnboardingState(telegramUserId, profile.id, "completed");
    
    const welcomeBackMessage = `👋 С возвращением!

📸 Отправь фото задачи из учебника
✏️ Напиши задачу текстом  
❓ Задай вопрос по предмету

Я помогу тебе разобраться! 🚀`;

    await sendTelegramMessage(telegramUserId, welcomeBackMessage);
    return;
  }

  // Record analytics for NEW users only
  await supabase.from("onboarding_analytics").insert({
    user_id: profile.id,
    source: "telegram",
    utm_source: utmSource,
    telegram_user_id: telegramUserId,
    started_at: new Date().toISOString(),
  });

  // Send personalized welcome message
  const message = welcomeMessages[utmSource] || welcomeMessages.default;
  await sendTelegramMessage(telegramUserId, message);

  // Start onboarding
  await startOnboarding(telegramUserId, profile.id, utmSource);
}

async function startOnboarding(telegramUserId: number, userId: string, utmSource: string) {
  const result = await sendTelegramMessage(telegramUserId, "📊 Шаг 1 из 3\n\nВ каком ты классе?", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "9 класс", callback_data: "grade_9" },
          { text: "10 класс", callback_data: "grade_10" },
          { text: "11 класс", callback_data: "grade_11" },
        ],
      ],
    },
  });

  await updateOnboardingState(telegramUserId, userId, "waiting_grade", {
    utm_source: utmSource,
    onboarding_message_id: result.result.message_id,
  });
}

async function handleGradeSelection(telegramUserId: number, userId: string, grade: number, messageId?: number) {
  if (messageId) {
    await editTelegramMessage(telegramUserId, messageId, "📊 Шаг 2 из 3\n\nКакой предмет тебе даётся сложнее всего?", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📐 Математика", callback_data: "subject_math" }],
          [{ text: "⚛️ Физика", callback_data: "subject_physics" }],
          [{ text: "💻 Информатика", callback_data: "subject_cs" }],
        ],
      },
    });
  }

  await updateOnboardingState(telegramUserId, userId, "waiting_subject", { grade });
}

async function handleSubjectSelection(telegramUserId: number, userId: string, subject: string, messageId?: number) {
  if (messageId) {
    await editTelegramMessage(telegramUserId, messageId, "📊 Шаг 3 из 3\n\nДля чего готовишься?", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🎯 ЕГЭ", callback_data: "goal_ege" },
            { text: "📝 ОГЭ", callback_data: "goal_oge" },
          ],
          [
            { text: "📚 Школьная программа", callback_data: "goal_school" },
            { text: "🏆 Олимпиада", callback_data: "goal_olympiad" },
          ],
        ],
      },
    });
  }

  await updateOnboardingState(telegramUserId, userId, "waiting_goal", { subject });
}

async function completeOnboarding(telegramUserId: number, userId: string, goal: string, messageId?: number) {
  const session = await getOnboardingSession(telegramUserId);
  const data = session?.onboarding_data as OnboardingData;

  // Update profile
  await supabase
    .from("profiles")
    .update({
      grade: data.grade,
      difficult_subject: data.subject,
      learning_goal: goal,
      onboarding_completed: true,
    })
    .eq("telegram_user_id", telegramUserId);

  // Complete analytics
  await supabase
    .from("onboarding_analytics")
    .update({
      completed_at: new Date().toISOString(),
      grade: data.grade,
      subject: data.subject,
      goal: goal,
    })
    .eq("telegram_user_id", telegramUserId)
    .is("completed_at", null)
    .order("started_at", { ascending: false })
    .limit(1);

  const gradeText = data.grade ? `${data.grade} классе` : "";
  const subjectMap: Record<string, string> = {
    math: "математике",
    physics: "физике",
    cs: "информатике",
  };
  const subjectText = data.subject ? subjectMap[data.subject] || data.subject : "выбранному предмету";
  const goalMap: Record<string, string> = {
    ege: "ЕГЭ",
    oge: "ОГЭ",
    school: "школьной программе",
    olympiad: "олимпиаде",
  };
  const goalText = goalMap[goal] || goal;

  const welcomeMessage = `✅ Готово!

🎉 Отлично! Теперь я знаю, что ты в ${gradeText}, готовишься к ${goalText} по ${subjectText}!

Что дальше?
📸 Отправь фото задачи из учебника
✏️ Напиши задачу текстом  
❓ Задай вопрос по предмету

Я помогу тебе разобраться! 🚀`;

  if (messageId) {
    await editTelegramMessage(telegramUserId, messageId, welcomeMessage, { reply_markup: { inline_keyboard: [] } });
  }

  // Save welcome message to chat history for AI context
  try {
    const chatId = await getOrCreateTelegramChat(userId);
    await supabase.from("chat_messages").insert({
      chat_id: chatId,
      user_id: userId,
      role: "assistant",
      content: welcomeMessage,
      input_method: "system",
    });
  } catch (error) {
    console.error("Error saving onboarding completion message:", error);
  }

  await updateOnboardingState(telegramUserId, userId, "completed");
}

async function getOrCreateTelegramChat(userId: string) {
  // Get existing Telegram chat for this user (oldest one to avoid duplicates)
  const { data: existingChat, error: selectError } = await supabase
    .from("chats")
    .select("id")
    .eq("user_id", userId)
    .eq("chat_type", "general")
    .eq("title", "Telegram чат")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    console.error("Error finding existing chat:", selectError);
  }

  if (existingChat) {
    console.log(`Found existing Telegram chat: ${existingChat.id} for user: ${userId}`);
    return existingChat.id;
  }

  // Create new Telegram chat
  console.log(`Creating new Telegram chat for user: ${userId}`);
  const { data: newChat, error } = await supabase
    .from("chats")
    .insert({
      user_id: userId,
      chat_type: "general",
      title: "Telegram чат",
      icon: "💬",
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating chat:", error);
    throw new Error("Failed to create chat");
  }

  console.log(`Created new Telegram chat: ${newChat.id}`);
  return newChat.id;
}

// ============= PRACTICE & DIAGNOSTIC HELPER FUNCTIONS =============

// Отправка фото с условием задачи
async function sendTelegramPhoto(
  chatId: number,
  photoUrl: string,
  caption: string,
  extraParams?: Record<string, any>
) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "HTML",
      ...extraParams,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("❌ Telegram sendPhoto error:", error);
    throw new Error("Failed to send photo");
  }

  return response.json();
}

// Получение состояния практики/диагностики из сессии
async function getSessionState(telegramUserId: number): Promise<{
  practice_state: PracticeState | null;
  diagnostic_state: DiagnosticState | null;
  current_mode: BotMode;
  user_id: string | null;
  onboarding_state: string | null;
}> {
  const { data } = await supabase
    .from("telegram_sessions")
    .select("practice_state, diagnostic_state, current_mode, user_id, onboarding_state")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  return {
    practice_state: data?.practice_state as PracticeState | null,
    diagnostic_state: data?.diagnostic_state as DiagnosticState | null,
    current_mode: (data?.current_mode as BotMode) || "chat",
    user_id: data?.user_id || null,
    onboarding_state: data?.onboarding_state || null,
  };
}

// Обновление состояния практики
async function updatePracticeState(
  telegramUserId: number,
  practiceState: PracticeState | null
) {
  await supabase
    .from("telegram_sessions")
    .update({
      practice_state: practiceState,
      current_mode: practiceState ? "practice" : "chat",
    })
    .eq("telegram_user_id", telegramUserId);
}

// Обновление состояния диагностики
async function updateDiagnosticState(
  telegramUserId: number,
  diagnosticState: DiagnosticState | null
) {
  await supabase
    .from("telegram_sessions")
    .update({
      diagnostic_state: diagnosticState,
      current_mode: diagnosticState ? "diagnostic" : "chat",
    })
    .eq("telegram_user_id", telegramUserId);
}


// Получение публичного URL для изображения
// Обрабатывает: статические пути сайта (/images/...), Supabase Storage URL, внешние URL
async function getImageUrl(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) {
    console.log('📸 getImageUrl: no image URL provided');
    return null;
  }
  
  console.log(`📸 getImageUrl: processing URL: "${imageUrl}"`);
  
  // НОВОЕ: Если это относительный путь сайта (начинается с /)
  // Например: /images/problems/task-8-derivative.png
  if (imageUrl.startsWith('/')) {
    const fullUrl = `${SITE_BASE_URL}${imageUrl}`;
    console.log(`📸 getImageUrl: static site path detected, full URL: ${fullUrl}`);
    return fullUrl;
  }
  
  // Если это уже полный публичный URL (например, внешний хостинг)
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    console.log('📸 getImageUrl: detected full URL');
    
    // Проверяем, является ли это URL из Supabase Storage
    if (imageUrl.includes('/storage/v1/object/public/')) {
      // Это публичный URL из Storage - используем как есть
      console.log('📸 getImageUrl: public Supabase Storage URL, returning as-is');
      return imageUrl;
    }
    if (imageUrl.includes('/storage/v1/object/sign/')) {
      // Это signed URL - используем как есть (может быть expired)
      console.log('📸 getImageUrl: signed URL detected, returning as-is');
      return imageUrl;
    }
    if (imageUrl.includes('/storage/v1/object/')) {
      // Это приватный URL - нужен signed URL
      // Извлекаем путь файла
      const match = imageUrl.match(/\/storage\/v1\/object\/[^/]+\/([^?]+)/);
      if (match) {
        const bucketAndPath = match[1];
        const [bucket, ...pathParts] = bucketAndPath.split('/');
        const path = pathParts.join('/');
        
        console.log(`📸 getImageUrl: extracting from private URL - bucket=${bucket}, path=${path}`);
        
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, 3600); // 1 час
        
        if (!error && data) {
          console.log('📸 getImageUrl: created signed URL successfully');
          return data.signedUrl;
        }
        console.error('📸 getImageUrl: failed to create signed URL:', error);
      }
    }
    // Внешний URL (не Supabase) - возвращаем как есть
    console.log('📸 getImageUrl: external URL, returning as-is');
    return imageUrl;
  }
  
  // Если это относительный путь в Storage
  console.log('📸 getImageUrl: detected relative path');
  
  // Попробуем разные варианты бакетов
  const possibleBuckets = ['problem-images', 'ege-problems', 'images', 'public'];
  
  const parts = imageUrl.split('/');
  let bucket = 'problem-images'; // По умолчанию для задач
  let path = imageUrl;
  
  // Если первая часть похожа на имя бакета
  if (parts.length > 1 && !parts[0].includes('.')) {
    bucket = parts[0];
    path = parts.slice(1).join('/');
  }
  
  console.log(`📸 getImageUrl: trying bucket="${bucket}", path="${path}"`);
  
  // Пробуем получить публичный URL
  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path);
  
  if (publicData?.publicUrl) {
    console.log(`📸 getImageUrl: got public URL: ${publicData.publicUrl}`);
    return publicData.publicUrl;
  }
  
  // Если не получилось, создаём signed URL
  console.log(`📸 getImageUrl: trying to create signed URL for bucket="${bucket}", path="${path}"`);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 3600);
  
  if (!error && data) {
    console.log(`📸 getImageUrl: created signed URL: ${data.signedUrl.substring(0, 80)}...`);
    return data.signedUrl;
  }
  
  // Пробуем альтернативные бакеты
  for (const altBucket of possibleBuckets) {
    if (altBucket === bucket) continue;
    
    console.log(`📸 getImageUrl: trying alternative bucket="${altBucket}"`);
    const { data: altPublic } = supabase.storage.from(altBucket).getPublicUrl(imageUrl);
    if (altPublic?.publicUrl) {
      console.log(`📸 getImageUrl: found in bucket "${altBucket}": ${altPublic.publicUrl}`);
      return altPublic.publicUrl;
    }
  }
  
  console.error('📸 getImageUrl: FAILED to get image URL for:', imageUrl, 'Error:', error);
  return null;
}

// Проверяет, требует ли задача изображение на основе текста условия
function taskRequiresImage(conditionText: string): boolean {
  const text = conditionText?.toLowerCase() || '';
  return text.includes("на рисунке") ||
         text.includes("изображён") ||
         text.includes("изображен") ||
         text.includes("показан") ||
         text.includes("на графике") ||
         text.includes("на чертеже") ||
         text.includes("на схеме") ||
         text.includes("см. рис");
}

// Проверяем, является ли URL изображения валидным (не внешний проблемный)
function isValidImageUrl(url: string | null): boolean {
  if (!url) return false;
  
  // Относительные пути сайта считаем валидными
  if (url.startsWith('/')) return true;
  
  // Проверяем, что это не проблемный внешний домен
  const problematicDomains = [
    'math-ege.sdamgia.ru',
    'sdamgia.ru',
    'ege.sdamgia.ru'
  ];
  
  for (const domain of problematicDomains) {
    if (url.includes(domain)) {
      console.log(`⚠️ Skipping problematic image domain: ${domain}`);
      return false;
    }
  }
  
  return true;
}

// Получение случайной задачи по номеру ЕГЭ
async function getRandomProblem(egeNumber: number): Promise<EgeProblem | null> {
  const { data: problems, error } = await supabase
    .from("ege_problems")
    .select("*")
    .eq("ege_number", egeNumber)
    .eq("is_active", true)
    .limit(30);

  if (error || !problems || problems.length === 0) {
    console.error("Error fetching problems:", error);
    return null;
  }

  // Фильтруем задачи:
  // 1. Если текст ссылается на рисунок, должна быть валидная картинка
  // 2. Приоритет задачам без необходимости изображения
  const validProblems = problems.filter((p: any) => {
    const needsImage = taskRequiresImage(p.condition_text);
    const hasValidImage = isValidImageUrl(p.condition_image_url);
    
    // Пропускаем задачи, где нужно изображение, но его нет или оно проблемное
    if (needsImage && !hasValidImage) {
      console.log(`⚠️ Skipping problem ${p.id}: needs image but no valid URL`);
      return false;
    }
    
    return true;
  });

  console.log(`📝 Found ${problems.length} problems for EGE ${egeNumber}, ${validProblems.length} valid`);

  if (validProblems.length === 0) {
    // Если нет валидных, берём любую но очищаем ссылку на изображение
    const problem = problems[Math.floor(Math.random() * problems.length)] as EgeProblem;
    if (taskRequiresImage(problem.condition_text)) {
      problem.condition_image_url = null;
    }
    return problem;
  }

  return validProblems[Math.floor(Math.random() * validProblems.length)] as EgeProblem;
}

// Получение задачи по ID
async function getProblemById(problemId: string): Promise<EgeProblem | null> {
  const { data, error } = await supabase
    .from("ege_problems")
    .select("*")
    .eq("id", problemId)
    .single();

  if (error) {
    console.error("Error fetching problem:", error);
    return null;
  }

  return data as EgeProblem;
}

// Получение задач для диагностики (по 1 на каждый номер 1-12)
async function getDiagnosticProblems(): Promise<EgeProblem[]> {
  const { data: allProblems, error } = await supabase
    .from("ege_problems")
    .select("*")
    .eq("is_active", true)
    .eq("is_diagnostic", true)
    .gte("ege_number", 1)
    .lte("ege_number", 12);

  if (error || !allProblems) {
    console.error("Error fetching diagnostic problems:", error);
    return [];
  }

  // Фильтруем задачи с проблемными изображениями
  const validProblems = allProblems.filter((p: any) => {
    const needsImage = taskRequiresImage(p.condition_text);
    const hasValidImage = isValidImageUrl(p.condition_image_url);
    
    if (needsImage && !hasValidImage) {
      console.log(`⚠️ Skipping diagnostic problem ${p.id} (ege ${p.ege_number}): needs image but no valid URL`);
      return false;
    }
    return true;
  });

  console.log(`🎯 Diagnostic: ${allProblems.length} total, ${validProblems.length} valid`);

  // Группируем по номеру ЕГЭ и выбираем по 1 случайной задаче
  const problemsByNumber: Record<number, EgeProblem[]> = {};
  validProblems.forEach((p: any) => {
    if (!problemsByNumber[p.ege_number]) {
      problemsByNumber[p.ege_number] = [];
    }
    problemsByNumber[p.ege_number].push(p as EgeProblem);
  });

  const selected: EgeProblem[] = [];
  for (let i = 1; i <= 12; i++) {
    const list = problemsByNumber[i] || [];
    if (list.length > 0) {
      selected.push(list[Math.floor(Math.random() * list.length)]);
    } else {
      // Если нет валидных задач для этого номера, берём из невалидных без изображения
      const fallbackList = allProblems.filter((p: any) => p.ege_number === i);
      if (fallbackList.length > 0) {
        const problem = fallbackList[Math.floor(Math.random() * fallbackList.length)] as EgeProblem;
        // Очищаем проблемный URL
        if (taskRequiresImage(problem.condition_text) && !isValidImageUrl(problem.condition_image_url)) {
          problem.condition_image_url = null;
        }
        selected.push(problem);
        console.log(`⚠️ Using fallback problem for ege ${i}`);
      } else {
        console.log(`❌ NO PROBLEMS FOUND FOR EGE ${i} in diagnostic pool`);
      }
    }
  }

  console.log(`✅ Selected ${selected.length} problems for diagnostic test: ${selected.map(p => p.ege_number).join(', ')}`);
  return selected;
}

// Создание сетки кнопок выбора номера ЕГЭ
function createEgeNumberKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "1", callback_data: "practice_ege:1" },
        { text: "2", callback_data: "practice_ege:2" },
        { text: "3", callback_data: "practice_ege:3" },
        { text: "4", callback_data: "practice_ege:4" },
        { text: "5", callback_data: "practice_ege:5" },
        { text: "6", callback_data: "practice_ege:6" },
      ],
      [
        { text: "7", callback_data: "practice_ege:7" },
        { text: "8", callback_data: "practice_ege:8" },
        { text: "9", callback_data: "practice_ege:9" },
        { text: "10", callback_data: "practice_ege:10" },
        { text: "11", callback_data: "practice_ege:11" },
        { text: "12", callback_data: "practice_ege:12" },
      ],
    ],
  };
}

// Создание клавиатуры главного меню
function createMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📝 Тренажёр", callback_data: "practice_start" },
        { text: "🎯 Диагностика", callback_data: "diagnostic_start" },
      ],
      [
        { text: "💬 Спросить Сократ AI", callback_data: "chat_mode" },
        { text: "📊 Статус", callback_data: "subscription_status" },
      ],
      [
        { text: "📱 Mini App", web_app: { url: `${getWebAppBaseUrl()}/miniapp` } },
        { text: "💳 Premium", url: WEB_PAYMENT_URL },
      ],
    ],
  };
}

// Запись попытки в practice_attempts
async function savePracticeAttempt(
  userId: string,
  problemId: string,
  userAnswer: string,
  isCorrect: boolean,
  startedAt: string
) {
  const { error } = await supabase.from("practice_attempts").insert({
    user_id: userId,
    problem_id: problemId,
    user_answer: userAnswer,
    is_correct: isCorrect,
    started_at: startedAt,
    submitted_at: new Date().toISOString(),
    hints_used: 0,
    asked_ai: false,
  });

  if (error) {
    console.error("Error saving practice attempt:", error);
  }

  // Обновляем streak
  await supabase.rpc("check_and_update_streak", { p_user_id: userId });
}

// ============= PRACTICE HANDLERS =============

// Показ меню выбора номера ЕГЭ
async function handlePracticeStart(telegramUserId: number) {
  await sendTelegramMessage(
    telegramUserId,
    `📝 <b>Тренажёр ЕГЭ по математике</b>

Выбери номер задания:`,
    { reply_markup: createEgeNumberKeyboard() }
  );
}

// Отправка задачи пользователю
async function sendPracticeProblem(
  telegramUserId: number,
  userId: string,
  egeNumber: number
) {
  console.log(`📝 sendPracticeProblem: user=${telegramUserId}, ege=${egeNumber}`);

  // Получаем случайную задачу
  const problem = await getRandomProblem(egeNumber);

  if (!problem) {
    await sendTelegramMessage(
      telegramUserId,
      `😔 Нет задач для номера ${egeNumber}. Попробуй другой номер.`,
      { reply_markup: createEgeNumberKeyboard() }
    );
    return;
  }

  // Сохраняем состояние
  const practiceState: PracticeState = {
    ege_number: egeNumber,
    current_problem_id: problem.id,
    started_at: new Date().toISOString(),
  };
  await updatePracticeState(telegramUserId, practiceState);

  // Форматируем условие
  const topicName = EGE_NUMBER_NAMES[egeNumber] || "Задача";
  const conditionFormatted = formatForTelegram(problem.condition_text);
  const header = `📐 <b>Задание №${egeNumber}</b> • ${topicName}\n${"─".repeat(20)}`;
  const footer = `\n\n✏️ <i>Введи ответ:</i>`;

  const cancelKeyboard = {
    inline_keyboard: [
      [{ text: "❌ Отмена", callback_data: "practice_cancel" }],
    ],
  };

  // Получаем URL картинки (с signed URL если нужно)
  const imageUrl = await getImageUrl(problem.condition_image_url);
  console.log(`📸 Image URL for problem: original=${problem.condition_image_url}, resolved=${imageUrl}`);

  // Если есть картинка — отправляем фото
  if (imageUrl) {
    try {
      await sendTelegramPhoto(
        telegramUserId,
        imageUrl,
        `${header}\n\n${conditionFormatted}${footer}`,
        { reply_markup: cancelKeyboard }
      );
    } catch (e) {
      // Если не удалось отправить фото, отправляем текст
      console.error("Failed to send photo, sending text instead:", e);
      await sendTelegramMessage(
        telegramUserId,
        `${header}\n\n${conditionFormatted}\n\n🖼️ <i>(Не удалось загрузить изображение)</i>${footer}`,
        { reply_markup: cancelKeyboard }
      );
    }
  } else {
    await sendTelegramMessage(
      telegramUserId,
      `${header}\n\n${conditionFormatted}${footer}`,
      { reply_markup: cancelKeyboard }
    );
  }
}

// Проверка ответа в тренажёре
async function handlePracticeAnswer(
  telegramUserId: number,
  userId: string,
  userAnswer: string
): Promise<boolean> {
  console.log(`📝 handlePracticeAnswer: user=${telegramUserId}, answer="${userAnswer}"`);

  // Получаем состояние
  const state = await getSessionState(telegramUserId);
  if (!state.practice_state) {
    console.log("No practice state found");
    return false;
  }

  const practiceState = state.practice_state;

  // Получаем задачу
  const problem = await getProblemById(practiceState.current_problem_id);
  if (!problem) {
    console.error("Problem not found:", practiceState.current_problem_id);
    await updatePracticeState(telegramUserId, null);
    return false;
  }

  // Проверяем ответ
  const isCorrect = checkAnswer(
    userAnswer,
    problem.correct_answer,
    problem.answer_type,
    problem.answer_tolerance
  );

  // Записываем попытку
  await savePracticeAttempt(
    userId,
    problem.id,
    userAnswer,
    isCorrect,
    practiceState.started_at
  );

  // Очищаем состояние
  await updatePracticeState(telegramUserId, null);

  // Формируем клавиатуру результата
  const resultKeyboard = {
    inline_keyboard: [
      [
        { text: "➡️ След. задача", callback_data: `practice_ege:${practiceState.ege_number}` },
        { text: "📖 Решение", callback_data: `practice_solution:${problem.id}` },
      ],
      [
        { text: "🔢 Другой номер", callback_data: "practice_start" },
        { text: "🏠 Меню", callback_data: "main_menu" },
      ],
    ],
  };

  // Отправляем результат
  if (isCorrect) {
    await sendTelegramMessage(
      telegramUserId,
      `✅ <b>Верно!</b> 🎉\n\nТак держать! +10 XP`,
      { reply_markup: resultKeyboard }
    );
  } else {
    await sendTelegramMessage(
      telegramUserId,
      `❌ <b>Неверно</b>\n\n🎯 Правильный ответ: <code>${problem.correct_answer}</code>`,
      { reply_markup: resultKeyboard }
    );
  }

  return true;
}

// Показ решения задачи
async function handlePracticeSolution(
  telegramUserId: number,
  problemId: string
) {
  const problem = await getProblemById(problemId);
  if (!problem) {
    await sendTelegramMessage(telegramUserId, "❌ Задача не найдена");
    return;
  }

  const topicName = EGE_NUMBER_NAMES[problem.ege_number] || "Задача";
  
  let solutionText = problem.solution_text || "Решение пока не добавлено";
  
  // Форматируем решение
  const formatted = formatForTelegram(solutionText);
  
  const keyboard = {
    inline_keyboard: [
      [
        { text: "➡️ Другая задача", callback_data: `practice_ege:${problem.ege_number}` },
        { text: "🔢 Выбор номера", callback_data: "practice_start" },
      ],
    ],
  };

  await sendTelegramMessage(
    telegramUserId,
    `📖 <b>Решение задания №${problem.ege_number}</b> • ${topicName}\n${"─".repeat(20)}\n\n${formatted}`,
    { reply_markup: keyboard }
  );
}

// ============= DIAGNOSTIC HANDLERS =============

// Показ интро диагностики
async function handleDiagnosticIntro(telegramUserId: number) {
  const keyboard = {
    inline_keyboard: [
      [{ text: "▶️ Начать тест", callback_data: "diagnostic_begin" }],
      [{ text: "🏠 Назад в меню", callback_data: "main_menu" }],
    ],
  };

  await sendTelegramMessage(
    telegramUserId,
    `🎯 <b>Диагностика уровня</b>

📊 12 задач • ~15 минут • Бесплатно

Узнай свой примерный балл ЕГЭ и получи персональные рекомендации!

<b>Как это работает:</b>
• По 1 задаче на каждый номер (1-12)
• Без ограничения времени
• Ответы не показываются сразу
• В конце — твой прогноз балла

<i>Готов? Нажми "Начать тест" 👇</i>`,
    { reply_markup: keyboard }
  );
}

// Старт диагностики
async function handleDiagnosticStart(telegramUserId: number, userId: string) {
  console.log(`🎯 handleDiagnosticStart: user=${telegramUserId}`);

  // Создаём сессию в БД
  const { data: newSession, error: sessionError } = await supabase
    .from("diagnostic_sessions")
    .insert({
      user_id: userId,
      total_questions: 12,
      status: "in_progress",
    })
    .select()
    .single();

  if (sessionError || !newSession) {
    console.error("Error creating diagnostic session:", sessionError);
    await sendTelegramMessage(telegramUserId, "❌ Ошибка при создании сессии. Попробуй позже.");
    return;
  }

  // Получаем задачи для диагностики
  const problems = await getDiagnosticProblems();

  if (problems.length === 0) {
    await sendTelegramMessage(telegramUserId, "❌ Нет задач для диагностики. Обратись к поддержке.");
    return;
  }

  // Сохраняем состояние
  const diagnosticState: DiagnosticState = {
    session_id: newSession.id,
    problems: problems.map((p) => ({ id: p.id, ege_number: p.ege_number })),
    current_index: 0,
    answers: {},
  };
  await updateDiagnosticState(telegramUserId, diagnosticState);

  // Отправляем первый вопрос
  await sendDiagnosticQuestion(telegramUserId, diagnosticState, problems[0]);
}

// Отправка вопроса диагностики
async function sendDiagnosticQuestion(
  telegramUserId: number,
  state: DiagnosticState,
  problem: EgeProblem
) {
  const current = state.current_index + 1;
  const total = state.problems.length;
  
  // Прогресс-бар
  const filled = Math.floor((current / total) * 10);
  const empty = 10 - filled;
  const progress = "█".repeat(filled) + "░".repeat(empty);
  
  const topicName = EGE_NUMBER_NAMES[problem.ege_number] || "Задача";
  const conditionFormatted = formatForTelegram(problem.condition_text);
  
  const header = `📊 <b>Вопрос ${current}/${total}</b> • №${problem.ege_number} ${topicName}\n${progress}`;
  const footer = `\n\n✏️ <i>Введи ответ:</i>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "⏭️ Пропустить", callback_data: "diagnostic_skip" }],
      [{ text: "❌ Прервать тест", callback_data: "diagnostic_cancel" }],
    ],
  };

  // Получаем URL картинки (с signed URL если нужно)
  const imageUrl = await getImageUrl(problem.condition_image_url);
  console.log(`📸 Diagnostic image: original=${problem.condition_image_url}, resolved=${imageUrl}`);

  // Если есть картинка — отправляем фото
  if (imageUrl) {
    try {
      await sendTelegramPhoto(
        telegramUserId,
        imageUrl,
        `${header}\n\n${conditionFormatted}${footer}`,
        { reply_markup: keyboard }
      );
    } catch (e) {
      console.error("Failed to send diagnostic photo:", e);
      await sendTelegramMessage(
        telegramUserId,
        `${header}\n\n${conditionFormatted}\n\n🖼️ <i>(Не удалось загрузить изображение)</i>${footer}`,
        { reply_markup: keyboard }
      );
    }
  } else {
    await sendTelegramMessage(
      telegramUserId,
      `${header}\n\n${conditionFormatted}${footer}`,
      { reply_markup: keyboard }
    );
  }
}

// Обработка ответа в диагностике
async function handleDiagnosticAnswer(
  telegramUserId: number,
  userId: string,
  userAnswer: string,
  isSkip: boolean = false
): Promise<boolean> {
  console.log(`🎯 handleDiagnosticAnswer: user=${telegramUserId}, answer="${userAnswer}", skip=${isSkip}`);

  // Получаем состояние
  const sessionState = await getSessionState(telegramUserId);
  if (!sessionState.diagnostic_state) {
    console.log("No diagnostic state found");
    return false;
  }

  const state = sessionState.diagnostic_state;
  const currentProblemRef = state.problems[state.current_index];

  // Получаем задачу для проверки
  const problem = await getProblemById(currentProblemRef.id);
  if (!problem) {
    console.error("Diagnostic problem not found:", currentProblemRef.id);
    return false;
  }

  // Проверяем ответ
  const isCorrect = isSkip
    ? false
    : checkAnswer(userAnswer, problem.correct_answer, problem.answer_type, problem.answer_tolerance);

  // Записываем ответ в БД
  await supabase.from("diagnostic_answers").insert({
    session_id: state.session_id,
    problem_id: problem.id,
    ege_number: problem.ege_number,
    user_answer: isSkip ? "" : userAnswer,
    is_correct: isCorrect,
    question_order: state.current_index + 1,
  });

  // Обновляем состояние
  state.answers[state.current_index] = {
    answer: isSkip ? "" : userAnswer,
    is_correct: isCorrect,
  };

  if (state.current_index < state.problems.length - 1) {
    // Переходим к следующему вопросу
    state.current_index++;
    await updateDiagnosticState(telegramUserId, state);

    // Обновляем прогресс в сессии
    await supabase
      .from("diagnostic_sessions")
      .update({ current_question: state.current_index + 1 })
      .eq("id", state.session_id);

    // Получаем следующую задачу
    const nextProblem = await getProblemById(state.problems[state.current_index].id);
    if (nextProblem) {
      await sendDiagnosticQuestion(telegramUserId, state, nextProblem);
    }
  } else {
    // Завершаем диагностику
    await completeDiagnostic(telegramUserId, userId, state);
  }

  return true;
}

// Завершение диагностики и показ результата
async function completeDiagnostic(
  telegramUserId: number,
  userId: string,
  state: DiagnosticState
) {
  console.log(`🎯 completeDiagnostic: user=${telegramUserId}`);

  // Подсчитываем результат
  const correctCount = Object.values(state.answers).filter((a) => a.is_correct).length;
  const testScore = primaryToTestScore(correctCount);

  // Находим слабые и сильные темы
  const weakTopics: number[] = [];
  const strongTopics: number[] = [];
  
  state.problems.forEach((p, i) => {
    if (state.answers[i]?.is_correct) {
      strongTopics.push(p.ege_number);
    } else {
      weakTopics.push(p.ege_number);
    }
  });

  // Рекомендуемая тема — первая неправильно решённая по номеру
  const recommendedTopic = weakTopics.length > 0 ? Math.min(...weakTopics) : null;

  // Обновляем сессию в БД
  await supabase
    .from("diagnostic_sessions")
    .update({
      status: "completed",
      predicted_primary_score: correctCount,
      predicted_test_score: testScore,
      completed_at: new Date().toISOString(),
      weak_topics: weakTopics,
      strong_topics: strongTopics,
      recommended_start_topic: recommendedTopic,
    })
    .eq("id", state.session_id);

  // Обновляем профиль
  await supabase
    .from("profiles")
    .update({
      diagnostic_completed: true,
      last_diagnostic_at: new Date().toISOString(),
      last_diagnostic_score: testScore,
    })
    .eq("id", userId);

  // Очищаем состояние
  await updateDiagnosticState(telegramUserId, null);

  // Формируем текст результата
  const total = state.problems.length;
  const percentage = Math.round((correctCount / total) * 100);

  // Эмодзи для уровня
  let levelEmoji = "🌟";
  let levelText = "Отличный результат!";
  if (testScore < 40) {
    levelEmoji = "💪";
    levelText = "Есть куда расти!";
  } else if (testScore < 60) {
    levelEmoji = "👍";
    levelText = "Хорошее начало!";
  } else if (testScore < 75) {
    levelEmoji = "🔥";
    levelText = "Отличный уровень!";
  }

  // Формируем список слабых тем
  let weakTopicsText = "";
  if (weakTopics.length > 0) {
    const weakTopicsList = weakTopics
      .sort((a, b) => a - b)
      .slice(0, 5)
      .map((n) => `• №${n} — ${EGE_NUMBER_NAMES[n] || "Задача"}`)
      .join("\n");
    weakTopicsText = `\n\n📈 <b>Нужно подтянуть:</b>\n${weakTopicsList}`;
  }

  // Формируем список сильных тем
  let strongTopicsText = "";
  if (strongTopics.length > 0) {
    const strongTopicsList = strongTopics
      .sort((a, b) => a - b)
      .slice(0, 3)
      .map((n) => `• №${n} — ${EGE_NUMBER_NAMES[n] || "Задача"}`)
      .join("\n");
    strongTopicsText = `\n\n💪 <b>Сильные темы:</b>\n${strongTopicsList}`;
  }

  // Рекомендация
  const recommendationText = recommendedTopic
    ? `\n\n💡 <b>Рекомендация:</b>\nНачни тренировку с задания <b>№${recommendedTopic}</b> — это даст максимальный прирост балла!`
    : "\n\n💡 Отличный результат! Продолжай тренироваться для закрепления!";

  // Клавиатура
  const keyboard = recommendedTopic
    ? {
        inline_keyboard: [
          [
            {
              text: `📝 Начать тренировку №${recommendedTopic}`,
              callback_data: `practice_ege:${recommendedTopic}`,
            },
          ],
          [
            { text: "📝 Тренажёр", callback_data: "practice_start" },
            { text: "🏠 Меню", callback_data: "main_menu" },
          ],
        ],
      }
    : {
        inline_keyboard: [
          [
            { text: "📝 Тренажёр", callback_data: "practice_start" },
            { text: "🏠 Меню", callback_data: "main_menu" },
          ],
        ],
      };

  await sendTelegramMessage(
    telegramUserId,
    `🎯 <b>Результат диагностики</b>

${levelEmoji} ${levelText}

📊 <b>Прогноз:</b> ${testScore} баллов ЕГЭ
✅ <b>Верно:</b> ${correctCount}/${total} (${percentage}%)${strongTopicsText}${weakTopicsText}${recommendationText}`,
    { reply_markup: keyboard }
  );
}

// Отмена диагностики
async function handleDiagnosticCancel(telegramUserId: number) {
  const state = await getSessionState(telegramUserId);
  
  if (state.diagnostic_state) {
    // Помечаем сессию как abandoned
    await supabase
      .from("diagnostic_sessions")
      .update({ status: "abandoned" })
      .eq("id", state.diagnostic_state.session_id);
  }

  await updateDiagnosticState(telegramUserId, null);

  await sendTelegramMessage(
    telegramUserId,
    `❌ Диагностика прервана.\n\nМожешь начать заново в любое время!`,
    { reply_markup: createMainMenuKeyboard() }
  );
}

// ============= PAYMENT HANDLING =============

// Mobile payment marking type (used by /pay command flow)
type PendingPaymentRow = {
  payment_id: string;
  tutor_student_id: string;
  student_name: string;
  amount: number;
  period: string | null;
  due_date: string | null;
  lesson_start_at: string | null;  // actual lesson date from tutor_lessons (matches cabinet)
};

type ParsedPaymentCallback = {
  paymentStatus: string;
  lessonId: string;
  callbackAmount: number | null;
  callbackFormat: "legacy" | "v2";
};

type LessonPaymentContext = {
  lessonId: string;
  studentName: string;
  durationMin: number;
  hourlyRateCents: number | null;
  paymentAmount: number | null;
  parentContact: string | null;
};

function parsePaymentCallbackData(data: string): ParsedPaymentCallback | null {
  // Legacy format: payment:status:amount:lesson_id
  // New format: payment:status:lesson_id
  const parts = data.split(":");
  if (parts[0] !== "payment") return null;

  if (parts.length === 4) {
    const [, paymentStatus, amountStr, lessonId] = parts;
    const parsedAmount = Number.parseInt(amountStr, 10);
    return {
      paymentStatus,
      lessonId,
      callbackAmount: Number.isFinite(parsedAmount) ? parsedAmount : null,
      callbackFormat: "legacy",
    };
  }

  if (parts.length === 3) {
    const [, paymentStatus, lessonId] = parts;
    return {
      paymentStatus,
      lessonId,
      callbackAmount: null,
      callbackFormat: "v2",
    };
  }

  return null;
}

async function getTutorByTelegramId(telegramUserId: number): Promise<{ id: string; telegram_id: string } | null> {
  const { data: tutor, error } = await supabase
    .from("tutors")
    .select("id, telegram_id")
    .eq("telegram_id", telegramUserId.toString())
    .single();

  if (error || !tutor) {
    return null;
  }

  return tutor;
}

async function getLessonPaymentContext(
  tutorId: string,
  lessonId: string
): Promise<LessonPaymentContext | null> {
  const { data: lesson, error } = await supabase
    .from("tutor_lessons")
    .select(`
      id,
      tutor_id,
      duration_min,
      payment_amount,
      tutor_students (
        parent_contact,
        hourly_rate_cents,
        profiles (
          username
        )
      ),
      profiles (
        username
      )
    `)
    .eq("id", lessonId)
    .eq("tutor_id", tutorId)
    .single();

  if (error || !lesson) {
    console.error("Error fetching lesson payment context:", error);
    return null;
  }

  const tutorStudent = (lesson as any).tutor_students;
  const tutorStudentProfileName = tutorStudent?.profiles?.username;
  const lessonStudentName = (lesson as any).profiles?.username;

  return {
    lessonId: lesson.id,
    studentName: tutorStudentProfileName || lessonStudentName || "ученика",
    durationMin: lesson.duration_min,
    hourlyRateCents: tutorStudent?.hourly_rate_cents ?? null,
    paymentAmount: lesson.payment_amount ?? null,
    parentContact: tutorStudent?.parent_contact ?? null,
  };
}

function resolveLessonAmount(
  lessonContext: LessonPaymentContext | null,
  callbackAmount: number | null
): number | null {
  if (lessonContext) {
    const calculated = calculateLessonPaymentAmount(
      lessonContext.durationMin,
      lessonContext.hourlyRateCents
    );
    if (calculated != null && calculated > 0) {
      return calculated;
    }
    if (lessonContext.paymentAmount != null && lessonContext.paymentAmount > 0) {
      return lessonContext.paymentAmount;
    }
  }

  if (callbackAmount != null && callbackAmount > 0) {
    return callbackAmount;
  }

  return null;
}

async function sendPaymentReminderPrompt(
  telegramUserId: number,
  lessonId: string,
  amount: number | null
) {
  const amountText = amount != null ? ` (${amount} ₽)` : "";
  await sendTelegramMessage(
    telegramUserId,
    `✨ <b>Double WOW</b>\n\nОтправить напоминание родителю с вашими реквизитами${amountText}?`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Да", callback_data: `payment_remind:yes:${lessonId}` },
            { text: "Нет", callback_data: `payment_remind:no:${lessonId}` },
          ],
        ],
      },
    }
  );
}

async function handlePaymentRemindCallback(telegramUserId: number, data: string) {
  const parts = data.split(":");
  if (parts.length !== 3) {
    console.error("Invalid payment reminder callback data:", data);
    return;
  }

  const [, decision, lessonId] = parts;
  const tutor = await getTutorByTelegramId(telegramUserId);
  if (!tutor) {
    await sendTelegramMessage(
      telegramUserId,
      "❌ Вы не найдены как репетитор. Свяжите Telegram в настройках."
    );
    return;
  }

  if (decision === "no") {
    console.log("payment_remind_no", { telegramUserId, lessonId });
    await sendTelegramMessage(telegramUserId, "Окей, напоминание не отправляем 👌");
    return;
  }

  if (decision !== "yes") {
    console.error("Unknown payment reminder decision:", decision);
    return;
  }

  console.log("payment_remind_yes", { telegramUserId, lessonId });

  const lessonContext = await getLessonPaymentContext(tutor.id, lessonId);
  if (!lessonContext) {
    await sendTelegramMessage(
      telegramUserId,
      "❌ Не удалось найти данные занятия для формирования напоминания."
    );
    return;
  }

  const { data: calendarSettings, error: calendarSettingsError } = await supabase
    .from("tutor_calendar_settings")
    .select("payment_details_text")
    .eq("tutor_id", tutor.id)
    .single();

  if (calendarSettingsError) {
    console.error("Error fetching tutor payment details:", calendarSettingsError);
  }

  const paymentDetailsText = (calendarSettings?.payment_details_text ?? "").trim();
  if (!paymentDetailsText) {
    await sendTelegramMessage(
      telegramUserId,
      "ℹ️ Реквизиты не заполнены.\n\nДобавьте их в веб-интерфейсе:\nРасписание → Настройки календаря → Реквизиты для оплаты."
    );
    return;
  }

  const resolvedAmount = resolveLessonAmount(lessonContext, null);
  const amountLine = resolvedAmount != null ? `${resolvedAmount} ₽` : "по договоренности";
  const parentContactLine = lessonContext.parentContact
    ? `\nКонтакт родителя: ${escapeHtml(lessonContext.parentContact)}`
    : "";

  const reminderText = `Здравствуйте! Напоминаю об оплате занятия с ${lessonContext.studentName}.\nСумма: ${amountLine}\n\nРеквизиты для оплаты:\n${paymentDetailsText}\n\nСпасибо!`;

  await sendTelegramMessage(
    telegramUserId,
    `📨 <b>Шаблон напоминания готов</b>${parentContactLine}\n\n${escapeHtml(reminderText)}`
  );
}

async function handlePaymentCallback(telegramUserId: number, data: string, messageId?: number) {
  const parsed = parsePaymentCallbackData(data);
  if (!parsed) {
    console.error("Invalid payment callback data:", data);
    return;
  }

  console.log("payment_callback_parsed", {
    telegramUserId,
    lessonId: parsed.lessonId,
    paymentStatus: parsed.paymentStatus,
    callbackAmount: parsed.callbackAmount,
    callbackFormat: parsed.callbackFormat,
  });

  const tutor = await getTutorByTelegramId(telegramUserId);
  if (!tutor) {
    await sendTelegramMessage(
      telegramUserId,
      "❌ Вы не найдены как репетитор. Свяжите Telegram в настройках."
    );
    return;
  }

  let statusText = "";
  let emoji = "";
  let shouldOfferReminder = false;
  let amountForReminder: number | null = null;

  if (parsed.paymentStatus === "cancelled") {
    const { error } = await supabase
      .from("tutor_lessons")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: "tutor",
        payment_reminder_sent: true,
      })
      .eq("id", parsed.lessonId)
      .eq("tutor_id", tutor.id);

    if (error) {
      console.error("Error cancelling lesson:", error);
      await sendTelegramMessage(telegramUserId, "❌ Ошибка при отмене урока.");
      return;
    }

    statusText = "Урок отменен";
    emoji = "❌";
  } else {
    const lessonContext = await getLessonPaymentContext(tutor.id, parsed.lessonId);
    const resolvedAmount = resolveLessonAmount(lessonContext, parsed.callbackAmount);
    const rpcAmount = resolvedAmount ?? 0;

    const { error } = await supabase.rpc("complete_lesson_and_create_payment", {
      _lesson_id: parsed.lessonId,
      _amount: rpcAmount,
      _payment_status: parsed.paymentStatus,
      _tutor_telegram_id: telegramUserId.toString(),
    });

    if (error) {
      console.error("Error completing lesson and creating payment:", error);
      await sendTelegramMessage(telegramUserId, "❌ Ошибка при завершении урока.");
      return;
    }

    console.log("payment_upsert_done", {
      telegramUserId,
      lessonId: parsed.lessonId,
      paymentStatus: parsed.paymentStatus,
      amount: rpcAmount,
    });

    switch (parsed.paymentStatus) {
      case "paid":
        statusText = "Оплачено";
        emoji = "✅";
        shouldOfferReminder = true;
        amountForReminder = resolvedAmount;
        break;
      case "paid_earlier":
        statusText = "Оплачено ранее";
        emoji = "💳";
        break;
      case "pending":
        statusText = "Оплатит позже";
        emoji = "⏳";
        shouldOfferReminder = true;
        amountForReminder = resolvedAmount;
        break;
      default:
        statusText = parsed.paymentStatus;
        emoji = "📝";
    }
  }

  // Edit the original message to show the result
  if (messageId) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramUserId,
        message_id: messageId,
        text: `${emoji} <b>Действие выполнено</b>\n\n${statusText}`,
        parse_mode: "HTML",
      }),
    });
  } else {
    await sendTelegramMessage(
      telegramUserId,
      `${emoji} Статус обновлён: ${statusText}`
    );
  }

  if (shouldOfferReminder) {
    await sendPaymentReminderPrompt(telegramUserId, parsed.lessonId, amountForReminder);
  }
}

// ============= MOBILE PAYMENT MARKING (/pay command) =============

function formatRub(amount: number): string {
  return `${amount.toLocaleString("ru-RU")} ₽`;
}

// Returns Russian short date e.g. "21 февраля".
// Primary source: lesson_start_at (actual lesson date, matches cabinet).
// Fallback: due_date, then period text.
function formatLessonDate(row: PendingPaymentRow): string {
  const ts = row.lesson_start_at ?? (row.due_date ? `${row.due_date}T00:00:00` : null);
  if (!ts) return row.period ?? "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return row.period ?? ts;
  const months = [
    "января","февраля","марта","апреля","мая","июня",
    "июля","августа","сентября","октября","ноября","декабря",
  ];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function pluralizeStudents(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "ученик";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "ученика";
  return "учеников";
}

async function getPendingPaymentsByTelegram(telegramUserId: number): Promise<PendingPaymentRow[]> {
  const { data, error } = await supabase.rpc(
    "get_tutor_pending_payments_by_telegram",
    { _telegram_id: telegramUserId.toString() }
  );
  if (error) {
    console.error("paym_list_rpc_error", { telegramUserId, error });
    return [];
  }
  return (data ?? []) as PendingPaymentRow[];
}

async function handlePaymList(telegramUserId: number, messageId?: number) {
  const rows = await getPendingPaymentsByTelegram(telegramUserId);

  if (rows.length === 0) {
    const text = "✅ <b>Нет должников</b>\n\nВсе оплаты в порядке! Используй кабинет для добавления платежей.";
    if (messageId) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramUserId,
          message_id: messageId,
          text,
          parse_mode: "HTML",
        }),
      });
    } else {
      await sendTelegramMessage(telegramUserId, text);
    }
    return;
  }

  // Group by student
  const studentMap = new Map<string, { name: string; total: number; ids: string[] }>();
  for (const row of rows) {
    const existing = studentMap.get(row.tutor_student_id);
    if (existing) {
      existing.total += row.amount;
      existing.ids.push(row.payment_id);
    } else {
      studentMap.set(row.tutor_student_id, {
        name: row.student_name,
        total: row.amount,
        ids: [row.payment_id],
      });
    }
  }

  const summaries = Array.from(studentMap.entries());
  const totalDebt = summaries.reduce((acc, [, s]) => acc + s.total, 0);

  // One button per student (single column for mobile readability)
  const keyboard = summaries.map(([studentId, s]) => [
    {
      text: `💳 ${s.name} — ${formatRub(s.total)}`,
      callback_data: `paym_s:${studentId}`,
    },
  ]);
  keyboard.push([{ text: "🔄 Обновить", callback_data: "paym_list" }]);

  const text =
    `💰 <b>Должники (${summaries.length} ${pluralizeStudents(summaries.length)})</b>\n` +
    `Итого: <b>${formatRub(totalDebt)}</b>`;

  if (messageId) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramUserId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard },
      }),
    });
  } else {
    await sendTelegramMessage(telegramUserId, text, {
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  console.log("paym_list_shown", { telegramUserId, studentCount: summaries.length });
}

async function handlePaymStudent(
  telegramUserId: number,
  tutorStudentId: string,
  messageId?: number
) {
  const allRows = await getPendingPaymentsByTelegram(telegramUserId);
  const studentRows = allRows.filter((r) => r.tutor_student_id === tutorStudentId);

  if (studentRows.length === 0) {
    // Already paid or invalid — refresh list
    await handlePaymList(telegramUserId, messageId);
    return;
  }

  const studentName = studentRows[0].student_name;
  const totalDebt = studentRows.reduce((acc, r) => acc + r.amount, 0);

  // Rows are already ordered newest-first by the RPC.
  // Build bullet list showing actual lesson date per payment.
  const paymentLines = studentRows.map((r) => {
    const dateStr = formatLessonDate(r);
    return `• ${formatRub(r.amount)} — 📅 ${dateStr}`;
  });

  const headerText =
    studentRows.length === 1
      ? `👤 <b>${studentName}</b>\n💰 К оплате: <b>${formatRub(totalDebt)}</b>`
      : `👤 <b>${studentName}</b>\n💰 Общий долг: <b>${formatRub(totalDebt)}</b>`;

  const text = `${headerText}\n\n${paymentLines.join("\n")}`;

  // One button per payment row (individual lesson date selection)
  const perPaymentButtons = studentRows.map((r) => [
    {
      text: `✅ ${formatLessonDate(r)} — ${formatRub(r.amount)}`,
      callback_data: `paym_ok:${r.payment_id}`,
    },
  ]);

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    ...perPaymentButtons,
  ];

  // "Mark all" convenience button only when multiple payments
  if (studentRows.length > 1) {
    keyboard.push([
      {
        text: `✅ Все сразу — ${formatRub(totalDebt)}`,
        callback_data: `paym_oks:${tutorStudentId}`,
      },
    ]);
  }

  keyboard.push([{ text: "◀ Все должники", callback_data: "paym_list" }]);

  if (messageId) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramUserId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard },
      }),
    });
  } else {
    await sendTelegramMessage(telegramUserId, text, {
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

async function handlePaymOk(
  telegramUserId: number,
  paymentId: string,
  messageId?: number
) {
  const { data: success, error } = await supabase.rpc(
    "mark_payment_as_paid_by_telegram",
    {
      _payment_id: paymentId,
      _telegram_id: telegramUserId.toString(),
    }
  );

  if (error || !success) {
    console.error("paym_ok_error", { telegramUserId, paymentId, error });
    await sendTelegramMessage(
      telegramUserId,
      "❌ Не удалось отметить оплату. Попробуй ещё раз или отметь в кабинете."
    );
    return;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("ru-RU");
  const timeStr = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const confirmText = `✅ <b>Оплата отмечена!</b>\n📅 ${dateStr}, ${timeStr}`;

  console.log("paym_ok_done", { telegramUserId, paymentId });

  if (messageId) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramUserId,
        message_id: messageId,
        text: confirmText,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "◀ К должникам", callback_data: "paym_list" }]],
        },
      }),
    });
  } else {
    await sendTelegramMessage(telegramUserId, confirmText, {
      reply_markup: {
        inline_keyboard: [[{ text: "◀ К должникам", callback_data: "paym_list" }]],
      },
    });
  }
}

async function handlePaymOkStudent(
  telegramUserId: number,
  tutorStudentId: string,
  messageId?: number
) {
  const allRows = await getPendingPaymentsByTelegram(telegramUserId);
  const studentRows = allRows.filter((r) => r.tutor_student_id === tutorStudentId);

  if (studentRows.length === 0) {
    await sendTelegramMessage(telegramUserId, "✅ Все оплаты уже отмечены.");
    return;
  }

  let markedCount = 0;
  let totalMarked = 0;
  for (const row of studentRows) {
    const { data: success } = await supabase.rpc("mark_payment_as_paid_by_telegram", {
      _payment_id: row.payment_id,
      _telegram_id: telegramUserId.toString(),
    });
    if (success) {
      markedCount++;
      totalMarked += row.amount;
    }
  }

  const studentName = studentRows[0].student_name;
  const now = new Date();
  const dateStr = now.toLocaleDateString("ru-RU");
  const timeStr = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const confirmText =
    `✅ <b>${studentName} — ${formatRub(totalMarked)}</b>\n` +
    `💰 Оплата отмечена!\n` +
    `📅 ${dateStr}, ${timeStr}`;

  console.log("paym_oks_done", { telegramUserId, tutorStudentId, markedCount, totalMarked });

  if (messageId) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramUserId,
        message_id: messageId,
        text: confirmText,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "◀ К должникам", callback_data: "paym_list" }]],
        },
      }),
    });
  } else {
    await sendTelegramMessage(telegramUserId, confirmText, {
      reply_markup: {
        inline_keyboard: [[{ text: "◀ К должникам", callback_data: "paym_list" }]],
      },
    });
  }
}

async function parseSSEStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) throw new Error("No response body");

  let fullContent = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Обработка построчно
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      // Убираем \r если есть
      if (line.endsWith("\r")) line = line.slice(0, -1);

      // Пропускаем комментарии и пустые строки
      if (line.startsWith(":") || line.trim() === "") continue;

      // Обрабатываем data: строки
      if (line.startsWith("data: ")) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") break;

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
          }
        } catch (e) {
          // Игнорируем ошибки парсинга
          continue;
        }
      }
    }
  }

  return fullContent;
}

async function sendTypingLoop(chatId: number, stopSignal: { stop: boolean }) {
  while (!stopSignal.stop) {
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action: "typing" }),
      });
    } catch (_) {
      // Non-critical — typing indicator failure must never break the main flow
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// ============= TELEGRAM FORMATTING UTILITIES =============

// LaTeX to Unicode symbol mappings
const LATEX_TO_UNICODE: Record<string, string> = {
  // Square roots
  "\\sqrt": "√",

  // Superscripts (common)
  "^2": "²",
  "^3": "³",
  "^4": "⁴",
  "^0": "⁰",
  "^1": "¹",
  "^5": "⁵",
  "^6": "⁶",
  "^7": "⁷",
  "^8": "⁸",
  "^9": "⁹",

  // Subscripts (numbers)
  _0: "₀",
  _1: "₁",
  _2: "₂",
  _3: "₃",
  _4: "₄",
  _5: "₅",
  _6: "₆",
  _7: "₇",
  _8: "₈",
  _9: "₉",

  // Subscripts (letters for log bases)
  _a: "ₐ",
  _e: "ₑ",
  _o: "ₒ",
  _x: "ₓ",
  _h: "ₕ",
  _k: "ₖ",
  _l: "ₗ",
  _m: "ₘ",
  _n: "ₙ",
  _p: "ₚ",
  _s: "ₛ",
  _t: "ₜ",

  // Logarithms
  "\\log": "log",
  "\\ln": "ln",
  "\\lg": "lg",

  // Math operators
  "\\pm": "±",
  "\\mp": "∓",
  "\\times": "×",
  "\\div": "÷",
  "\\cdot": "·",
  "\\approx": "≈",
  "\\neq": "≠",
  "\\ne": "≠",
  "\\leq": "≤",
  "\\le": "≤",
  "\\geq": "≥",
  "\\ge": "≥",
  "\\infty": "∞",
  "\\to": "→",
  "\\rightarrow": "→",
  "\\leftarrow": "←",
  "\\Rightarrow": "⇒",
  "\\Leftarrow": "⇐",
  "\\Leftrightarrow": "⇔",
  "\\in": "∈",
  "\\notin": "∉",
  "\\subset": "⊂",
  "\\supset": "⊃",
  "\\cup": "∪",
  "\\cap": "∩",
  "\\forall": "∀",
  "\\exists": "∃",
  "\\emptyset": "∅",
  "\\nabla": "∇",
  "\\partial": "∂",
  "\\int": "∫",
  "\\sum": "∑",
  "\\prod": "∏",

  // Greek letters (lowercase)
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\epsilon": "ε",
  "\\varepsilon": "ε",
  "\\zeta": "ζ",
  "\\eta": "η",
  "\\theta": "θ",
  "\\vartheta": "θ",
  "\\iota": "ι",
  "\\kappa": "κ",
  "\\lambda": "λ",
  "\\mu": "μ",
  "\\nu": "ν",
  "\\xi": "ξ",
  "\\pi": "π",
  "\\rho": "ρ",
  "\\sigma": "σ",
  "\\tau": "τ",
  "\\upsilon": "υ",
  "\\phi": "φ",
  "\\varphi": "φ",
  "\\chi": "χ",
  "\\psi": "ψ",
  "\\omega": "ω",

  // Greek letters (uppercase)
  "\\Gamma": "Γ",
  "\\Delta": "Δ",
  "\\Theta": "Θ",
  "\\Lambda": "Λ",
  "\\Xi": "Ξ",
  "\\Pi": "Π",
  "\\Sigma": "Σ",
  "\\Upsilon": "Υ",
  "\\Phi": "Φ",
  "\\Psi": "Ψ",
  "\\Omega": "Ω",

  // Fractions (common Unicode fractions)
  "\\frac{1}{2}": "½",
  "\\frac{1}{3}": "⅓",
  "\\frac{2}{3}": "⅔",
  "\\frac{1}{4}": "¼",
  "\\frac{3}{4}": "¾",
  "\\frac{1}{5}": "⅕",
  "\\frac{2}{5}": "⅖",
  "\\frac{3}{5}": "⅗",
  "\\frac{4}{5}": "⅘",
  "\\frac{1}{6}": "⅙",
  "\\frac{5}{6}": "⅚",
  "\\frac{1}{8}": "⅛",
  "\\frac{3}{8}": "⅜",
  "\\frac{5}{8}": "⅝",
  "\\frac{7}{8}": "⅞",
};

/**
 * Preprocesses LaTeX: removes delimiters, converts fractions, detects complex formulas
 */
function preprocessLatex(text: string): string {
  let result = text;
  let hasComplexFormula = false;

  // DEBUG: Log if we have \frac patterns
  if (result.includes('\\frac')) {
    console.log('\n🔍 LATEX INPUT contains \\frac patterns');
    const fracMatches = result.match(/\\frac[^\s]*/g);
    if (fracMatches) {
      console.log('Found \\frac patterns:', fracMatches);
    }
  }

  // First, detect complex formulas before processing
  // Check display math $$ ... $$
  const displayMathMatches = text.match(/\$\$(.+?)\$\$/gs);
  if (displayMathMatches) {
    for (const match of displayMathMatches) {
      const formula = match.replace(/\$\$/g, "");
      if (isComplexFormula(formula)) {
        hasComplexFormula = true;
        break;
      }
    }
  }

  // Check inline math $ ... $
  if (!hasComplexFormula) {
    const inlineMathMatches = text.match(/\$([^$]+?)\$/g);
    if (inlineMathMatches) {
      for (const match of inlineMathMatches) {
        const formula = match.replace(/\$/g, "");
        if (isComplexFormula(formula)) {
          hasComplexFormula = true;
          break;
        }
      }
    }
  }

  // Remove display math delimiters $$ ... $$ (non-greedy)
  result = result.replace(/\$\$(.+?)\$\$/gs, "$1");

  // Remove inline math delimiters $ ... $ (non-greedy)
  result = result.replace(/\$([^$]+?)\$/g, "$1");

  // STEP 0: Convert logarithms with bases
  // \log_a x → logₐ x, \log_{10} x → log₁₀ x, \log_2 x → log₂ x
  const subscriptMap: Record<string, string> = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
    '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
    'a': 'ₐ', 'e': 'ₑ', 'i': 'ᵢ', 'o': 'ₒ', 'u': 'ᵤ',
    'x': 'ₓ', 'n': 'ₙ', 'm': 'ₘ', 'k': 'ₖ', 'p': 'ₚ',
    'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'j': 'ⱼ', 'h': 'ₕ',
    'b': 'ᵦ', 'c': 'c', 'd': 'd', 'f': 'f', 'g': 'g',
  };
  
  // Debug: check for log patterns
  if (result.includes('log')) {
    console.log('📊 LOG PATTERN FOUND in text:', result.substring(0, 150));
  }
  
  // \log_{base} → log with subscript base
  result = result.replace(/\\log_\{([^{}]+)\}/g, (match, base) => {
    console.log(`📊 Converting \\log_{${base}} to subscript`);
    const subscriptBase = base.split('').map((c: string) => subscriptMap[c.toLowerCase()] || c).join('');
    return `log${subscriptBase}`;
  });
  
  // \log_X (single char base) → log with subscript
  result = result.replace(/\\log_([a-zA-Z0-9])/g, (match, base) => {
    console.log(`📊 Converting \\log_${base} to subscript`);
    const subscriptBase = subscriptMap[base.toLowerCase()] || base;
    return `log${subscriptBase}`;
  });
  
  // \ln → ln (natural log)
  result = result.replace(/\\ln\b/g, 'ln');
  
  // \lg → lg (common log base 10)  
  result = result.replace(/\\lg\b/g, 'lg');
  
  // Plain \log → log
  result = result.replace(/\\log\b/g, 'log');
  
  // Also handle cases without backslash: log_a → logₐ (but not inside words)
  result = result.replace(/\blog_\{([^{}]+)\}/g, (match, base) => {
    const subscriptBase = base.split('').map((c: string) => subscriptMap[c.toLowerCase()] || c).join('');
    return `log${subscriptBase}`;
  });
  
  result = result.replace(/\blog_([a-zA-Z0-9])(?![a-zA-Z])/g, (match, base) => {
    const subscriptBase = subscriptMap[base.toLowerCase()] || base;
    return `log${subscriptBase}`;
  });

  // STEP 1: Convert \sqrt{x} FIRST to remove nested braces
  // This allows \frac regex to work properly
  result = result.replace(/\\sqrt\{([^{}]+)\}/g, (match, content) => {
    console.log('🔢 Converting sqrt:', match);
    return content.length === 1 ? `√${content}` : `√(${content})`;
  });

  // STEP 2: Convert proper \frac{numerator}{denominator} to (numerator)/(denominator)
  // Now works because nested braces from \sqrt are gone
  for (let i = 0; i < 3; i++) {
    result = result.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (match, num, den) => {
      console.log('✅ Converting proper fraction:', match);
      return `(${num})/(${den})`;
    });
  }

  // STEP 3: Handle malformed fractions (if AI generated without braces)
  // Special case 1: Quadratic formula with discriminant
  // Pattern: \frac-b ± √D2a → (-b ± √D)/2a
  result = result.replace(
    /\\frac(-?[a-z])\s*([\+\-±∓])\s*√([A-Z])(\d+[a-z])/gi,
    (match, var1, op, radical, coef) => {
      console.log('✅ Fixed malformed quadratic fraction:', match);
      return `(${var1} ${op} √${radical})/${coef}`;
    }
  );

  // Special case 2: General malformed fractions
  result = result.replace(
    /\\frac([^{}\s]+?)(\d+[a-z]+)(?=\s|[.,;:]|$)/gi,
    (match, numerator, denominator) => {
      console.log('⚠️ Fixed general malformed fraction:', match);
      return `(${numerator})/${denominator}`;
    }
  );

  // Last resort fallback: remove \frac prefix
  result = result.replace(
    /\\frac([^{\s][^\s]*)/g,
    (match, rest) => {
      console.log('⚠️ Fallback: Removing \\frac prefix:', match);
      return rest;
    }
  );

  // STEP 4: Remove remaining curly braces (now safe to do)
  result = result.replace(/\{([^{}]+)\}/g, "$1");

  // Normalize spaces but preserve newlines
  result = result.replace(/[ \t]+/g, " ");
  // Collapse 3+ consecutive newlines to 2 to keep readable spacing
  result = result.replace(/\n{3,}/g, "\n\n");

  // Add hint about Mini App if complex formulas detected
  if (hasComplexFormula) {
    // Ensure there's an empty line before the hint
    if (!result.endsWith("\n\n")) {
      result += "\n\n";
    }
    result += "📱 <i>Для красивого отображения формул открой Mini App ниже</i>";
  }

  return result;
}

/**
 * Converts LaTeX formulas to Unicode symbols
 */
function convertLatexToUnicode(text: string): string {
  let result = text;

  // Replace LaTeX commands with Unicode symbols
  for (const [latex, unicode] of Object.entries(LATEX_TO_UNICODE)) {
    const escapedLatex = latex.replace(/[\\^{}]/g, "\\$&");
    result = result.replace(new RegExp(escapedLatex, "g"), unicode);
  }

  return result;
}

/**
 * Converts markdown headings to bold text with spacing
 */
function convertMarkdownHeadings(text: string): string {
  let result = text;

  // Convert ### Heading, ## Heading, # Heading to bold with newlines
  // Process from most specific (###) to least specific (#) to avoid conflicts
  result = result.replace(/^### (.+)$/gm, "\n**$1**\n");
  result = result.replace(/^## (.+)$/gm, "\n**$1**\n");
  result = result.replace(/^# (.+)$/gm, "\n**$1**\n");

  return result;
}

/**
 * Converts markdown lists to emoji markers
 */
function convertMarkdownLists(text: string): string {
  let result = text;

  // Emoji numbers for ordered lists (1-10)
  const numberEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

  // Convert numbered lists (1. , 2. , etc.)
  // First pass: detect numbered lists and convert to emoji
  result = result.replace(/^(\d+)\.\s+(.+)$/gm, (match, num, text) => {
    const number = parseInt(num);
    if (number >= 1 && number <= 10) {
      return `${numberEmojis[number - 1]} ${text}`;
    } else {
      // For numbers > 10, use simple format
      return `${num}. ${text}`;
    }
  });

  // Convert bulleted lists (- or * at start of line)
  result = result.replace(/^[-*]\s+(.+)$/gm, "📌 $1");

  // Handle special emoji-based lists from AI (like 1️⃣, 2️⃣, etc that are already there)
  // These should already be fine, no conversion needed

  return result;
}

/**
 * Adds spacing between blocks (paragraphs, lists, formulas)
 */
function addBlockSpacing(text: string): string {
  let result = text;

  // Add spacing after bold headings if not already present
  result = result.replace(/(\*\*[^*]+\*\*)\n([^\n])/g, "$1\n\n$2");
  
  // УЛУЧШЕНО: If bold block starts right after ANY character with colon, move it to new paragraph
  // Убираем требование пробела после двоеточия
  result = result.replace(/([^\n]):(\*\*[^*]+\*\*)/g, "$1:\n\n$2");
  
  // НОВОЕ: Add spacing before bold headings that end with colon
  // Это обработает случай когда перед "**План решения:**" нет переноса
  result = result.replace(/([^\n])(\*\*[^*\n]+:\*\*)/g, "$1\n\n$2");

  // Add spacing between list items and regular text
  // Match lines starting with emoji list markers
  result = result.replace(/(^[📌1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟].+)$/gm, (match, p1, offset, string) => {
    // Check if next line exists and doesn't start with a list marker
    const nextLineMatch = string.slice(offset + match.length).match(/^\n([^\n])/);
    if (nextLineMatch && !nextLineMatch[1].match(/[📌1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟]/)) {
      return match + "\n";
    }
    return match;
  });

  // Add spacing before list items (если перед ними нет переноса)
  result = result.replace(/([^\n])\n([📌1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟])/g, "$1\n\n$2");

  // Ensure spacing after special emoji markers
  result = result.replace(/(^[✅❌💡🎯⚠️🗺️].+)$/gm, (match, p1, offset, string) => {
    const nextLineMatch = string.slice(offset + match.length).match(/^\n([^\n])/);
    if (nextLineMatch && !nextLineMatch[1].match(/[✅❌💡🎯⚠️🗺️📌1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟]/)) {
      return match + "\n";
    }
    return match;
  });

  // Clean up excessive newlines (more than 2 in a row → keep 2)
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}

/**
 * Detects if a LaTeX formula is complex
 */
function isComplexFormula(formula: string): boolean {
  // Consider complex if:
  // 1. Length > 50 characters
  if (formula.length > 50) return true;

  // 2. Contains nested fractions (multiple \frac)
  const fracMatches = formula.match(/\\frac/g);
  if (fracMatches && fracMatches.length > 1) return true;

  // 3. Contains matrices, integrals, summations
  if (formula.match(/\\begin\{(matrix|pmatrix|bmatrix|array)\}|\\int|\\sum|\\prod|\\lim/)) {
    return true;
  }

  // 4. Contains complex nested structures
  const openBraces = (formula.match(/\{/g) || []).length;
  if (openBraces > 3) return true;

  return false;
}

/**
 * Escapes HTML special characters to prevent Telegram API parsing errors
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Cleans up markdown formatting issues (newlines around markers)
 */
function cleanMarkdownFormatting(text: string): string {
  let result = text;

  // Auto-close bold markers for section headers like "**Решение:" / "**Ответ:" / "**Шаг 1:"
  result = result.replace(
    /^\s*\*\*([^*\n]+?:)\s*$/gm,
    "**$1**"
  );
  result = result.replace(
    /^\s*\*\*([^*\n]+?:)([^*\n]*)$/gm,
    "**$1**$2"
  );

  // DEBUG: Log BEFORE cleanup
  console.log("\n🧹 BEFORE cleanMarkdownFormatting:");
  if (text.includes("**План решения:")) {
    const planIndex = text.indexOf("**План решения:");
    console.log('Found "**План решения:" - next 150 chars:');
    console.log(
      text
        .substring(planIndex, planIndex + 150)
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t"),
    );
  }

  // MOST AGGRESSIVE: Remove ANY line that contains ONLY ** (with optional spaces/tabs)
  // This catches cases like: "**План решения:\n\n**\n\n1️⃣"
  result = result.replace(/^[ \t]*\*\*[ \t]*$/gm, "");

  // Remove excessive empty lines that may result from above cleanup
  result = result.replace(/\n{3,}/g, "\n\n");

  // DEBUG: Log AFTER first cleanup
  console.log("\n🧹 AFTER removing standalone **:");
  if (result.includes("**План решения:")) {
    const planIndex = result.indexOf("**План решения:");
    console.log('Found "**План решения:" - next 150 chars:');
    console.log(
      result
        .substring(planIndex, planIndex + 150)
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t"),
    );
  }

  // Fix: Remove lines that contain ONLY ** (standalone markers)
  // This happens when AI generates: **Header:**\n\n**\n
  result = result.replace(/\n\s*\*\*\s*\n/g, "\n");

  // Fix: Remove ** at the start of a line after empty line
  result = result.replace(/\n\n\*\*\s*$/gm, "\n\n");

  // Fix: **text:** followed by newlines and closing ** (more flexible)
  // Matches: **План решения:\n\n**\n OR **Метод:\n\n** (at end of line/file)
  result = result.replace(/(\*\*[^*\n]+:)\s*\n+\s*\*\*\s*(?=\n|$)/gm, "$1\n\n");
  
  // Fix: **text:** followed by closing ** at end of line (no trailing newline)
  result = result.replace(/(\*\*[^*\n]+:)\s*\n+\s*\*\*\s*$/gm, "$1");
  
  // Fix: **text (without colon)** with newlines inside
  // Matches: **План решения\n\n**
  result = result.replace(/(\*\*[^*\n]+)\s*\n+\s*\*\*(?=\s|$)/gm, "$1**");

  // Fix: **text\n\n** → **text**
  // Remove newlines between opening ** and closing **
  result = result.replace(/\*\*([^\n*]+)\n+\*\*/g, "**$1**");

  // Fix: **\n\ntext** → **text**
  // Remove newlines after opening **
  result = result.replace(/\*\*\n+([^\n*]+)/g, "**$1");

  // Fix: text\n\n** → text**
  // Remove newlines before closing **
  result = result.replace(/([^\n*]+)\n+\*\*/g, "$1**");

  // Same for underscores __text__
  result = result.replace(/__([^\n_]+)\n+__/g, "__$1__");
  result = result.replace(/__\n+([^\n_]+)/g, "__$1");
  result = result.replace(/([^\n_]+)\n+__/g, "$1__");

  // DEBUG: Log AFTER all cleanup
  console.log("\n✅ AFTER all markdown cleanup:");
  if (result.includes("План решения")) {
    const planIndex = result.indexOf("План решения");
    console.log('Found "План решения" - next 150 chars:');
    console.log(
      result
        .substring(planIndex, planIndex + 150)
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t")
    );
  }

  return result;
}

/**
 * Converts markdown to Telegram HTML format
 * NOTE: Text should already have HTML entities escaped before calling this
 */
function convertMarkdownToTelegramHTML(text: string): string {
  let result = text;

  // Code blocks: ```code``` → <pre>code</pre>
  result = result.replace(/```([^`]+)```/g, "<pre>$1</pre>");

  // Bold: **text** or __text__ → <b>text</b>
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic: *text* or _text_ → <i>text</i> (but avoid conflicts with bold)
  result = result.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<i>$1</i>");
  result = result.replace(/(?<!_)_([^_]+?)_(?!_)/g, "<i>$1</i>");

  // Inline code: `text` → <code>text</code>
  result = result.replace(/`(.+?)`/g, "<code>$1</code>");

  // Strikethrough: ~~text~~ → <s>text</s>
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  return result;
}

/**
 * Fixes unbalanced HTML tags to prevent Telegram parsing errors
 * Uses a more robust algorithm with proper validation
 */
function fixHtmlTags(text: string): string {
  const allowedTags = ['b', 'i', 'u', 's', 'code', 'pre', 'a'];
  const stack: Array<{tag: string, pos: number}> = [];
  const tokens: Array<{type: 'text' | 'tag', content: string, isClosing?: boolean, tagName?: string}> = [];
  
  // Step 1: Tokenize the HTML
  let i = 0;
  while (i < text.length) {
    const tagStart = text.indexOf('<', i);
    
    if (tagStart === -1) {
      // No more tags, rest is text
      if (i < text.length) {
        tokens.push({type: 'text', content: text.substring(i)});
      }
      break;
    }
    
    // Add text before tag
    if (tagStart > i) {
      tokens.push({type: 'text', content: text.substring(i, tagStart)});
    }
    
    // Find tag end
    const tagEnd = text.indexOf('>', tagStart);
    if (tagEnd === -1) {
      // Malformed tag, treat as text
      tokens.push({type: 'text', content: text.substring(tagStart)});
      break;
    }
    
    const fullTag = text.substring(tagStart, tagEnd + 1);
    const tagContent = text.substring(tagStart + 1, tagEnd).trim();
    
    // Parse tag
    const isClosing = tagContent.startsWith('/');
    const tagName = isClosing ? tagContent.substring(1).trim() : tagContent.split(/\s/)[0].trim();
    
    // Only process allowed tags
    if (allowedTags.includes(tagName)) {
      tokens.push({type: 'tag', content: fullTag, isClosing, tagName});
    } else {
      // Escape invalid tags
      tokens.push({type: 'text', content: fullTag.replace(/</g, '&lt;').replace(/>/g, '&gt;')});
    }
    
    i = tagEnd + 1;
  }
  
  // Step 2: Build result with proper tag balancing
  let result = '';
  for (let j = 0; j < tokens.length; j++) {
    const token = tokens[j];
    
    if (token.type === 'text') {
      result += token.content;
    } else if (token.type === 'tag') {
      if (token.isClosing) {
        // Check if we have a matching opening tag
        const lastIndex = stack.findIndex(item => item.tag === token.tagName);
        if (lastIndex !== -1) {
          // Close all tags from this one to the top of stack
          const tagsToClose = stack.splice(lastIndex);
          // Add the closing tag for the matched one
          result += token.content;
          // Re-open any tags that were closed prematurely (in reverse order, excluding the one we just closed)
          for (let k = tagsToClose.length - 2; k >= 0; k--) {
            result += `<${tagsToClose[k].tag}>`;
            stack.push(tagsToClose[k]);
          }
        } else {
          // No matching opening tag, skip it
          console.log(`⚠️ Skipping unmatched closing tag: ${token.content}`);
        }
      } else {
        // Opening tag
        result += token.content;
        stack.push({tag: token.tagName!, pos: result.length});
      }
    }
  }
  
  // Step 3: Close any remaining open tags
  while (stack.length > 0) {
    const unclosed = stack.pop();
    console.log(`⚠️ Auto-closing unclosed tag: <${unclosed!.tag}>`);
    result += `</${unclosed!.tag}>`;
  }
  
  return result;
}

/**
 * Main formatter function
 * Converts LaTeX and markdown to Telegram-friendly HTML format
 * Order matters: process structure first, then formatting
 */
function formatForTelegram(text: string): string {
  // Step 1: Convert markdown headings to bold with spacing (before other processing)
  let result = convertMarkdownHeadings(text);

  // Step 2: Convert markdown lists to emoji markers (before HTML conversion)
  result = convertMarkdownLists(result);

  // Step 3: Preprocess LaTeX (remove $ delimiters, convert fractions, detect complex formulas)
  result = preprocessLatex(result);

  // Step 4: Convert LaTeX commands to Unicode symbols
  result = convertLatexToUnicode(result);

  // Step 5: Add spacing between blocks (after structure is clear, before HTML)
  result = addBlockSpacing(result);

  // DEBUG: Log after block spacing
  console.log("\n📐 AFTER addBlockSpacing (first 300 chars):");
  console.log(result.substring(0, 300).replace(/\n/g, "\\n"));

  // Step 5.5: Clean up markdown formatting issues (newlines around markers)
  result = cleanMarkdownFormatting(result);

  // Step 5.6: Escape HTML entities to prevent Telegram API parsing errors
  // This must be done BEFORE markdown-to-HTML conversion
  result = escapeHtml(result);

  // Step 6: Convert markdown to Telegram HTML (last step, preserves HTML tags)
  result = convertMarkdownToTelegramHTML(result);

  // Step 7: Fix any unbalanced HTML tags (prevent Telegram parsing errors)
  result = fixHtmlTags(result);
  
  // Step 8: Log final HTML for debugging
  console.log('🔍 Final HTML length:', result.length);
  if (result.includes('<i>')) {
    const iCount = (result.match(/<i>/g) || []).length;
    const iCloseCount = (result.match(/<\/i>/g) || []).length;
    console.log(`🔍 <i> tags: ${iCount} opening, ${iCloseCount} closing`);
    if (iCount !== iCloseCount) {
      console.error(`❌ Unbalanced <i> tags detected! Opening: ${iCount}, Closing: ${iCloseCount}`);
    }
  }
  if (result.includes('<b>')) {
    const bCount = (result.match(/<b>/g) || []).length;
    const bCloseCount = (result.match(/<\/b>/g) || []).length;
    console.log(`🔍 <b> tags: ${bCount} opening, ${bCloseCount} closing`);
    if (bCount !== bCloseCount) {
      console.error(`❌ Unbalanced <b> tags detected! Opening: ${bCount}, Closing: ${bCloseCount}`);
    }
  }

  return result;
}

/**
 * Enhanced formatter for button responses (solution/hint/explain)
 * Creates a clear, structured layout optimized for students learning math
 * Processes RAW AI output BEFORE base formatting
 */
function formatForTelegramStructured(text: string): string {
  let result = text;

  // === STEP 1: Pre-process raw text to add structure BEFORE base formatting ===

  // Add newlines BEFORE step markers (Шаг 1:, Шаг 2:, etc.)
  // This handles cases like "...текст.Шаг 2:" or "...текст.**Шаг 2:**"
  result = result.replace(/([^\n])(\*{0,2}Шаг\s*\d+[:.:])/g, "$1\n\n$2");

  // Add newlines BEFORE "Ответ:" or "**Ответ:**"
  result = result.replace(/([^\n])(\*{0,2}Ответ\*{0,2}[:.:])/g, "$1\n\n$2");

  // Add newlines BEFORE "Решение:" at the start
  result = result.replace(/^(\*{0,2}Решение\*{0,2}[:.:])/gm, "\n$1");

  // Add newline AFTER "Решение:" if followed immediately by text
  result = result.replace(/(\*{0,2}Решение\*{0,2}[:.:])([^\n\s*])/g, "$1\n$2");

  // Add newline AFTER step headers if followed immediately by text
  result = result.replace(/(\*{0,2}Шаг\s*\d+[:.:]?\s*[^*\n]*\*{0,2})([^\n])/g, "$1\n$2");

  // === STEP 2: Apply base Telegram formatting ===
  result = formatForTelegram(result);

  // === STEP 3: Enhance step numbers with emojis ===
  const stepEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

  // Convert "<b>Шаг N:</b>" or "<b>Шаг N. Title</b>" to emoji format
  result = result.replace(/<b>Шаг\s*(\d+)[:.]\s*([^<]*)<\/b>/gi, (match, num, title) => {
    const n = parseInt(num);
    const emoji = n <= 10 ? stepEmojis[n - 1] : `<b>${n}.</b>`;
    const titlePart = title.trim() ? ` <b>${title.trim()}</b>` : "";
    return `\n\n${emoji}${titlePart}\n`;
  });

  // Also handle plain "Шаг N:" without bold
  result = result.replace(/(?<![<\w])Шаг\s*(\d+)[:.]\s*/gi, (match, num) => {
    const n = parseInt(num);
    const emoji = n <= 10 ? stepEmojis[n - 1] : `<b>${n}.</b>`;
    return `\n\n${emoji} `;
  });

  // === STEP 4: Highlight final answer ===
  result = result.replace(
    /<b>Ответ[:.]*<\/b>/gi,
    "\n\n🎯 <b>Ответ:</b>"
  );

  // Plain "Ответ:" without bold
  result = result.replace(
    /(?<![<\w])Ответ[:.]\s*/gi,
    "\n\n🎯 <b>Ответ:</b> "
  );

  // === STEP 5: Enhance key sections ===
  result = result.replace(/<b>(Дано|Найти|Решение|Проверка)[:.]*<\/b>/gi, "\n\n📝 <b>$1:</b>");
  result = result.replace(/(?<![<\w])(Дано|Найти|Проверка)[:.]\s*/gi, "\n\n📝 <b>$1:</b> ");

  // === STEP 6: Clean up formatting ===

  // Clean up excessive newlines (more than 2)
  result = result.replace(/\n{3,}/g, "\n\n");

  // Remove leading newlines
  result = result.replace(/^\n+/, "");

  return result.trim();
}

/**
 * Generates Telegram inline keyboard JSON for Mini App button
 */
function generateMiniAppButton(solutionId: string): any {
  const miniAppUrl = `${getWebAppBaseUrl()}/miniapp/solution/${solutionId}`;

  console.log("🔗 Mini App button URL:", miniAppUrl);
  console.log("📱 Solution ID:", solutionId);

  return {
    inline_keyboard: [
      [
        {
          text: "📱 Открыть полное решение",
          web_app: {
            url: miniAppUrl,
          },
        },
      ],
    ],
  };
}

/**
 * Formats solution for Telegram message
 * Returns shortened version with button to open full solution
 */
function formatSolutionPreview(
  problem: string,
  answer: string,
  solutionId: string,
): { text: string; replyMarkup: any } {
  const text = formatForTelegram(
    `
📝 **Задача:**
${problem}

✅ **Ответ:** ${answer}

👇 Нажми кнопку ниже, чтобы увидеть подробное решение с формулами!
  `.trim(),
  );

  return {
    text,
    replyMarkup: generateMiniAppButton(solutionId),
  };
}

function splitLongMessage(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const parts: string[] = [];
  let currentPart = "";
  const lines = text.split("\n");

  for (const line of lines) {
    if ((currentPart + line + "\n").length > maxLength) {
      if (currentPart) {
        parts.push(currentPart.trim());
        currentPart = "";
      }

      // If single line is too long, split it
      if (line.length > maxLength) {
        let remaining = line;
        while (remaining.length > 0) {
          parts.push(remaining.substring(0, maxLength));
          remaining = remaining.substring(maxLength);
        }
      } else {
        currentPart = line + "\n";
      }
    } else {
      currentPart += line + "\n";
    }
  }

  if (currentPart.trim()) {
    parts.push(currentPart.trim());
  }

  return parts;
}

interface TelegramFormatBlock {
  type: "paragraph" | "heading" | "step" | "list" | "answer" | "question" | "formula";
  label?: string;
  text: string;
  items?: string[];
  stepNumber?: number;
}

interface TelegramFormatResult {
  formatted: string;
  parts: string[];
  truncated: boolean;
  usedFallback: boolean;
}

function normalizeTelegramResponseText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripMarkdownNoise(text: string): string {
  let result = text;

  // Remove markdown headings and blockquotes that render poorly in Telegram.
  result = result.replace(/^\s*#{1,6}\s+/gm, "");
  result = result.replace(/^\s*>\s?/gm, "");
  result = result.replace(/^\s*[-=]{3,}\s*$/gm, "");

  // Keep code content, drop fences.
  result = result.replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, "$1");

  // Remove noisy standalone markdown markers.
  result = result.replace(/^\s*\*\*\s*$/gm, "");
  result = result.replace(/^\s*__\s*$/gm, "");

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function simplifyLatexExpression(expression: string): string {
  let formula = expression.trim();
  formula = formula.replace(/\\left|\\right/g, "");

  let prev = "";
  while (prev !== formula) {
    prev = formula;
    formula = formula.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)");
  }

  formula = formula.replace(/[{}]/g, "");
  formula = convertLatexToUnicode(formula);
  return formula.replace(/\s+/g, " ").trim();
}

function simplifyLatexForTelegram(text: string): string {
  let result = text;

  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_match, expression) => {
    const converted = simplifyLatexExpression(expression);
    return converted ? `\n${converted}\n` : "";
  });

  result = result.replace(/\$([^$\n]+?)\$/g, (_match, expression) => {
    const converted = simplifyLatexExpression(expression);
    return converted || expression;
  });

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function removeInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")
    .trim();
}

function parseTelegramBlocks(text: string, responseMode: TelegramResponseMode): TelegramFormatBlock[] {
  const chunks = text
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const blocks: TelegramFormatBlock[] = [];
  const labelRegex = /^(Идея|Мини-шаг|Вопрос|Ответ|Решение|Подсказка|Разбор шага|Пример)\s*:\s*(.*)$/i;
  const stepRegex = /^(?:\*\*)?\s*Шаг\s*(\d+)\s*[:.)-]?\s*(?:\*\*)?\s*(.*)$/i;
  const listItemRegex = /^(\d+[.)]|[-*•])\s+(.+)$/;

  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const firstLine = removeInlineMarkdown(lines[0]);
    const stepMatch = firstLine.match(stepRegex);
    if (stepMatch) {
      const body = [stepMatch[2], ...lines.slice(1)].filter(Boolean).join(" ").trim();
      blocks.push({
        type: "step",
        stepNumber: parseInt(stepMatch[1], 10),
        text: removeInlineMarkdown(body),
      });
      continue;
    }

    const labelMatch = firstLine.match(labelRegex);
    if (labelMatch) {
      const label = labelMatch[1];
      const body = [labelMatch[2], ...lines.slice(1)].filter(Boolean).join(" ").trim();
      const lower = label.toLowerCase();

      if (lower === "ответ") {
        blocks.push({ type: "answer", label: "Ответ", text: removeInlineMarkdown(body) });
      } else if (lower === "вопрос") {
        blocks.push({ type: "question", label: "Вопрос", text: removeInlineMarkdown(body) });
      } else if (lower === "решение") {
        blocks.push({ type: "heading", label: "Решение", text: removeInlineMarkdown(body) });
      } else {
        blocks.push({ type: "paragraph", label, text: removeInlineMarkdown(body) });
      }
      continue;
    }

    const listItems = lines
      .map((line) => line.match(listItemRegex))
      .filter(Boolean)
      .map((match) => removeInlineMarkdown((match as RegExpMatchArray)[2]));

    if (listItems.length === lines.length) {
      blocks.push({ type: "list", text: "", items: listItems });
      continue;
    }

    const joined = removeInlineMarkdown(lines.join(" "));
    const looksLikeFormula =
      /\\frac|\\sqrt|\\sum|\\int|[=±≤≥∞∑∫]/.test(joined) &&
      joined.replace(/[0-9a-zA-Zа-яА-Я\s=+\-*/().,:]/g, "").length < 20;

    if (looksLikeFormula) {
      blocks.push({ type: "formula", text: joined });
      continue;
    }

    blocks.push({ type: "paragraph", text: joined });
  }

  // Return blocks as-is for natural formatting — no forced Идея/Мини-шаг/Вопрос restructuring
  return blocks;
}

function blockPlainLength(block: TelegramFormatBlock): number {
  if (block.items) {
    return block.items.join(" ").length;
  }
  const labelPart = block.label ? `${block.label}: `.length : 0;
  return labelPart + block.text.length;
}

function applyBlockCharLimit(
  blocks: TelegramFormatBlock[],
  maxChars?: number,
): { blocks: TelegramFormatBlock[]; truncated: boolean } {
  if (!maxChars || maxChars <= 0) {
    return { blocks, truncated: false };
  }

  const limited: TelegramFormatBlock[] = [];
  let total = 0;
  let truncated = false;

  for (const block of blocks) {
    const separator = limited.length > 0 ? 2 : 0;
    const blockLength = blockPlainLength(block);

    if (total + separator + blockLength <= maxChars) {
      limited.push(block);
      total += separator + blockLength;
      continue;
    }

    const remaining = maxChars - total - separator;
    if (remaining > 20) {
      if (block.items && block.items.length > 0) {
        const items: string[] = [];
        let used = 0;
        for (const item of block.items) {
          const extra = (items.length > 0 ? 1 : 0) + item.length;
          if (used + extra > remaining - 1) break;
          items.push(item);
          used += extra;
        }
        if (items.length > 0) {
          items[items.length - 1] = `${items[items.length - 1].replace(/\.*$/, "")}…`;
          limited.push({ ...block, items });
        }
      } else {
        const source = block.text || "";
        const clipped = source.slice(0, Math.max(0, remaining - 1)).trim();
        if (clipped) {
          limited.push({ ...block, text: `${clipped}…` });
        }
      }
    }

    truncated = true;
    break;
  }

  if (limited.length === 0 && blocks.length > 0) {
    const fallbackText = blocks[0].text.slice(0, Math.max(0, maxChars - 1)).trim();
    limited.push({ ...blocks[0], text: `${fallbackText}…` });
    truncated = true;
  }

  return { blocks: limited, truncated };
}

function renderTelegramInline(text: string): string {
  const cleaned = removeInlineMarkdown(text).replace(/\s+/g, " ").trim();
  return escapeHtml(cleaned);
}

function renderTelegramBlock(block: TelegramFormatBlock): string {
  switch (block.type) {
    case "heading": {
      const title = block.label || block.text || "Разбор";
      const body = block.text && block.text !== block.label ? ` ${renderTelegramInline(block.text)}` : "";
      return `<b>${escapeHtml(title)}:</b>${body}`.trim();
    }
    case "step": {
      const header = `<b>Шаг ${block.stepNumber ?? 1}:</b>`;
      if (!block.text) return header;
      return `${header} ${renderTelegramInline(block.text)}`;
    }
    case "answer":
      return `<b>Ответ:</b> ${renderTelegramInline(block.text)}`.trim();
    case "question":
      return `<b>Вопрос:</b> ${renderTelegramInline(block.text)}`.trim();
    case "list":
      return (block.items || []).map((item) => `• ${renderTelegramInline(item)}`).join("\n");
    case "formula":
      return `<code>${renderTelegramInline(block.text)}</code>`;
    case "paragraph":
    default: {
      if (block.label) {
        return `<b>${escapeHtml(block.label)}:</b> ${renderTelegramInline(block.text)}`.trim();
      }
      return renderTelegramInline(block.text);
    }
  }
}

function splitHtmlSafely(text: string, maxLength: number = TELEGRAM_MESSAGE_MAX_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [fixHtmlTags(text)];
  }

  const parts: string[] = [];
  const allowedTags = new Set(["b", "i", "u", "s", "code", "pre"]);
  const stack: string[] = [];
  let current = "";
  let i = 0;

  const closeOpenTags = () => {
    for (let idx = stack.length - 1; idx >= 0; idx--) {
      current += `</${stack[idx]}>`;
    }
  };

  const reopenTags = () => stack.map((tag) => `<${tag}>`).join("");

  while (i < text.length) {
    if (text[i] === "<") {
      const tagEnd = text.indexOf(">", i);
      if (tagEnd !== -1) {
        const token = text.slice(i, tagEnd + 1);
        const tagMatch = token.match(/^<\/?([a-z]+)(?:\s[^>]*)?>$/i);
        if (tagMatch && allowedTags.has(tagMatch[1].toLowerCase())) {
          if (current.length + token.length > maxLength && current.length > 0) {
            closeOpenTags();
            parts.push(fixHtmlTags(current.trim()));
            current = reopenTags();
          }

          current += token;

          const tagName = tagMatch[1].toLowerCase();
          const isClosing = token.startsWith("</");
          if (isClosing) {
            const idx = stack.lastIndexOf(tagName);
            if (idx !== -1) stack.splice(idx, 1);
          } else if (!token.endsWith("/>")) {
            stack.push(tagName);
          }

          i = tagEnd + 1;
          continue;
        }
      }
    }

    const char = text[i];
    if (current.length + 1 > maxLength && current.length > 0) {
      closeOpenTags();
      parts.push(fixHtmlTags(current.trim()));
      current = reopenTags();
    }
    current += char;
    i += 1;
  }

  if (current.trim()) {
    closeOpenTags();
    parts.push(fixHtmlTags(current.trim()));
  }

  return parts.filter(Boolean);
}

function splitTelegramHtmlByBlocks(
  renderedBlocks: string[],
  maxLength: number = TELEGRAM_MESSAGE_MAX_LENGTH,
): string[] {
  if (renderedBlocks.length === 0) {
    return [];
  }

  const parts: string[] = [];
  let currentBlocks: string[] = [];
  let currentLength = 0;

  for (const block of renderedBlocks) {
    const separator = currentBlocks.length > 0 ? 2 : 0;
    const nextLength = currentLength + separator + block.length;

    if (nextLength <= maxLength) {
      currentBlocks.push(block);
      currentLength = nextLength;
      continue;
    }

    if (currentBlocks.length > 0) {
      parts.push(currentBlocks.join("\n\n"));
      currentBlocks = [];
      currentLength = 0;
    }

    if (block.length <= maxLength) {
      currentBlocks.push(block);
      currentLength = block.length;
      continue;
    }

    const oversizedParts = splitHtmlSafely(block, maxLength);
    parts.push(...oversizedParts);
  }

  if (currentBlocks.length > 0) {
    parts.push(currentBlocks.join("\n\n"));
  }

  return parts
    .flatMap((part) => (part.length > maxLength ? splitHtmlSafely(part, maxLength) : [part]))
    .map((part) => fixHtmlTags(part.trim()))
    .filter(Boolean);
}

function formatTelegramResponseV2(
  rawText: string,
  options: { responseMode: TelegramResponseMode; maxChars?: number },
): TelegramFormatResult {
  const normalized = normalizeTelegramResponseText(rawText);
  const noMarkdownNoise = stripMarkdownNoise(normalized);
  const withSimpleLatex = simplifyLatexForTelegram(noMarkdownNoise);
  const blocks = parseTelegramBlocks(withSimpleLatex, options.responseMode);
  const limited = applyBlockCharLimit(blocks, options.maxChars);
  const renderedBlocks = limited.blocks.map(renderTelegramBlock).filter(Boolean);
  const formatted = fixHtmlTags(renderedBlocks.join("\n\n").trim());
  const parts = splitTelegramHtmlByBlocks(renderedBlocks, TELEGRAM_MESSAGE_MAX_LENGTH);

  return {
    formatted,
    parts: parts.length > 0 ? parts : [formatted],
    truncated: limited.truncated,
    usedFallback: false,
  };
}

function formatTelegramResponseWithFallback(
  rawText: string,
  options: { responseMode: TelegramResponseMode; maxChars?: number },
): TelegramFormatResult {
  if (!TELEGRAM_FORMAT_V2) {
    const formatted = formatForTelegramStructured(rawText);
    const parts = splitLongMessage(formatted, TELEGRAM_MESSAGE_MAX_LENGTH);
    return {
      formatted,
      parts,
      truncated: false,
      usedFallback: true,
    };
  }

  try {
    return formatTelegramResponseV2(rawText, options);
  } catch (error) {
    console.error("⚠️ Telegram format V2 failed, using fallback:", error);
    const formatted = formatForTelegramStructured(rawText);
    const parts = splitLongMessage(formatted, TELEGRAM_MESSAGE_MAX_LENGTH);
    return {
      formatted,
      parts,
      truncated: false,
      usedFallback: true,
    };
  }
}

async function getLatestSolutionIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("solutions")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch latest solution ID:", error);
    return null;
  }

  return data?.id ?? null;
}

async function resolveKeyboardSolutionId(userId: string, currentSolutionId?: string | null): Promise<string | null> {
  if (currentSolutionId) return currentSolutionId;
  return getLatestSolutionIdForUser(userId);
}

function createQuickActionsKeyboard(solutionId?: string | null) {
  const inline_keyboard: Array<Array<Record<string, unknown>>> = [
    [
      {
        text: "✅ Покажи решение",
        callback_data: "help_depth:solution",
      },
      {
        text: "💡 Дай подсказку",
        callback_data: "help_depth:hint",
      },
    ],
    [
      {
        text: "📖 Разобрать шаг",
        callback_data: "help_depth:explain",
      },
    ],
  ];

  if (solutionId) {
    inline_keyboard.push([
      {
        text: "📱 Открыть полное решение",
        web_app: {
          url: `${getWebAppBaseUrl()}/miniapp/solution/${solutionId}`,
        },
      },
    ]);
  }

  return { inline_keyboard };
}

/**
 * Extracts LaTeX formulas from text
 * Returns object with display formulas and text without them
 */
function extractLatexFormulas(text: string): { formulas: string[]; textWithoutFormulas: string } {
  const formulas: string[] = [];
  let textWithoutFormulas = text;

  // Extract display mode formulas $$...$$
  const displayMatches = text.match(/\$\$(.+?)\$\$/gs);
  if (displayMatches) {
    for (const match of displayMatches) {
      const formula = match.replace(/\$\$/g, "").trim();
      if (formula) {
        formulas.push(formula);
        // Remove from text
        textWithoutFormulas = textWithoutFormulas.replace(match, "");
      }
    }
  }

  // Extract inline formulas $...$ (but be careful with single $ signs)
  const inlineMatches = text.match(/\$([^$\n]+?)\$/g);
  if (inlineMatches) {
    for (const match of inlineMatches) {
      const formula = match.replace(/\$/g, "").trim();
      // Only consider it a formula if it contains LaTeX commands or math symbols
      if (formula && (formula.includes("\\") || formula.match(/[a-z]_|[a-z]\^|\^[0-9]/))) {
        formulas.push(formula);
      }
    }
  }

  return { formulas, textWithoutFormulas: textWithoutFormulas.trim() };
}

/**
 * Extracts final answer from AI response
 */
function extractFinalAnswer(aiResponse: string): string | null {
  // Look for answer patterns - including formats without bold markers
  const patterns = [
    /\*\*Ответ:\*\*\s*(.+?)(?:\n\n|\n(?=[А-ЯA-Z])|$)/s,
    /Ответ:\s*(.+?)(?:\n\n|\n(?=[А-ЯA-Z])|$)/s,
    /\*\*Итог:\*\*\s*(.+?)(?:\n\n|\n(?=[А-ЯA-Z])|$)/s,
    /\*\*Итоговый ответ:\*\*\s*(.+?)(?:\n\n|\n(?=[А-ЯA-Z])|$)/s,
    /\*\*Финальный ответ:\*\*\s*(.+?)(?:\n\n|\n(?=[А-ЯA-Z])|$)/s,
    /Итак[,:]?\s*(.+?)(?:\n\n|\n(?=[А-ЯA-Z])|$)/is,
    /Значит,?\s+(.+?)(?:\n\n|\n(?=[А-ЯA-Z])|$)/is,
  ];

  for (const pattern of patterns) {
    const match = aiResponse.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Parses AI response into structured solution steps
 * Extracts steps, content, formulas, and methods from raw AI response
 */
function parseSolutionSteps(aiResponse: string): any[] {
  const steps: any[] = [];

  // Split text into potential sections using various heading patterns
  // Patterns: ### Heading, **Heading:**, 1. Heading, **Шаг N:**, **Шаг 1: Title**
  // FIXED: Changed .+? to [^*\n]+ (greedy) to properly capture full title text
  const sectionRegex =
    /(?:^|\n)(?:#{1,3}\s+(.+)|(?:\*\*)?(?:Шаг\s+)?(\d+)[.):\s]+\s*([^*\n]+)(?:\*\*)?|(?:\*\*)([^*]+)(?:\*\*):)/gm;

  const sections: Array<{ start: number; title: string; number?: number }> = [];
  let match;

  while ((match = sectionRegex.exec(aiResponse)) !== null) {
    const title = match[1] || match[3] || match[4] || "";
    const number = match[2] ? parseInt(match[2]) : undefined;
    sections.push({
      start: match.index,
      title: title.trim(),
      number,
    });
  }

  // If we found sections, extract content for each
  if (sections.length > 0) {
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const nextSection = sections[i + 1];
      const endPos = nextSection ? nextSection.start : aiResponse.length;

      // Extract content between this section and the next
      const fullContent = aiResponse.substring(section.start, endPos);

      // Remove the heading line itself
      const contentLines = fullContent.split("\n").slice(1).join("\n").trim();

      // Extract formulas from content
      const { formulas, textWithoutFormulas } = extractLatexFormulas(contentLines);

      // Extract method hints (lines starting with 💡, Метод:, etc)
      const methodMatch = contentLines.match(/(?:💡\s*)?(?:\*\*)?Метод:(?:\*\*)?\s*(.+?)(?:\n|$)/);
      const method = methodMatch ? methodMatch[1].trim() : null;

      // Get the main formula (usually the first display formula)
      const mainFormula = formulas.length > 0 ? formulas[0] : null;

      // Clean content: remove method line if present
      let cleanContent = textWithoutFormulas;
      if (methodMatch) {
        cleanContent = cleanContent.replace(methodMatch[0], "").trim();
      }

      steps.push({
        number: section.number || i + 1,
        title: section.title || `Шаг ${i + 1}`,
        content: cleanContent.substring(0, 800), // Reasonable limit
        formula: mainFormula,
        method: method,
      });
    }
  }

  // Fallback: if no structured sections found, try simple numbered list
  if (steps.length === 0) {
    const simpleStepRegex = /(?:^|\n)(\d+)[.)]\s+(.+?)(?=\n\d+[.)]|\n\n|$)/gs;
    let stepMatch;
    let stepNum = 1;

    while ((stepMatch = simpleStepRegex.exec(aiResponse)) !== null) {
      const content = stepMatch[2].trim();
      const { formulas } = extractLatexFormulas(content);

      steps.push({
        number: stepNum++,
        title: content.substring(0, 60).trim() + (content.length > 60 ? "..." : ""),
        content: content.substring(0, 800),
        formula: formulas.length > 0 ? formulas[0] : null,
        method: null,
      });
    }
  }

  // Fallback: split text into logical blocks by paragraphs
  if (steps.length === 0) {
    // Split by double newlines (paragraph breaks)
    const paragraphs = aiResponse.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    // If we have multiple paragraphs, create steps from them
    if (paragraphs.length > 1) {
      let stepNum = 1;

      for (const para of paragraphs) {
        const trimmed = para.trim();
        if (trimmed.length < 20) continue; // Skip very short paragraphs (might be headers)

        // Extract formulas
        const { formulas, textWithoutFormulas } = extractLatexFormulas(trimmed);

        // Extract title from first line if it's short and ends with colon
        let title = null;
        let content = trimmed;
        const firstLineMatch = trimmed.match(/^(.{1,80}):\s*\n/);
        if (firstLineMatch) {
          title = firstLineMatch[1].trim();
          content = trimmed.substring(firstLineMatch[0].length).trim();
        } else {
          // Use first sentence or first 60 chars as title
          const firstSentence = trimmed.match(/^([^.!?]{1,80})/);
          if (firstSentence && firstSentence[1].length > 20) {
            title = firstSentence[1].trim() + (trimmed.length > firstSentence[1].length ? "..." : "");
            content = trimmed;
          } else {
            title = `Шаг ${stepNum}`;
          }
        }

        steps.push({
          number: stepNum++,
          title: title || `Шаг ${stepNum}`,
          content: textWithoutFormulas.substring(0, 800),
          formula: formulas.length > 0 ? formulas[0] : null,
          method: null,
        });
      }
    }
  }

  // Ultimate fallback: create a single step with full response
  if (steps.length === 0) {
    const { formulas } = extractLatexFormulas(aiResponse);

    // Try to extract a title from first line
    let title = "Решение";
    const firstLineMatch = aiResponse.match(/^(.{1,80}):/);
    if (firstLineMatch) {
      title = firstLineMatch[1].trim();
    }

    steps.push({
      number: 1,
      title: title,
      content: aiResponse.substring(0, 1000),
      formula: formulas.length > 0 ? formulas[0] : null,
      method: null,
    });
  }

  console.log(`📊 Parsed ${steps.length} steps from AI response`);
  if (steps.length > 0) {
    console.log("📋 Step titles:", steps.map((s) => `${s.number}. ${s.title}`).join(" | "));
  }

  return steps;
}

/**
 * Saves solution to database and returns solution ID
 * Parses AI response BEFORE formatting for Telegram
 */
async function saveSolution(
  telegramChatId: number,
  telegramUserId: number,
  userId: string,
  problemText: string,
  aiResponse: string,
): Promise<string | null> {
  try {
    console.log("💾 Saving solution...");
    console.log("📏 AI response length:", aiResponse.length, "chars");
    console.log("📝 Preview:", aiResponse.substring(0, 150) + "...");

    // Parse the RAW AI response before any Telegram formatting
    const solutionSteps = parseSolutionSteps(aiResponse);
    const finalAnswer = extractFinalAnswer(aiResponse);

    console.log(`✅ Parsing complete: ${solutionSteps.length} steps found`);
    console.log("📋 Titles:", solutionSteps.map((s, i) => `${i + 1}:"${s.title}"`).join(", "));
    console.log("🎯 Final answer:", finalAnswer ? `"${finalAnswer.substring(0, 50)}..."` : "NOT FOUND");

    const solutionData = {
      problem: problemText,
      solution_steps: solutionSteps,
      final_answer: finalAnswer,
      raw_response: aiResponse,
    };

    console.log("💾 Inserting into database...");

    const { data: solution, error } = await supabase
      .from("solutions")
      .insert({
        telegram_chat_id: telegramChatId,
        telegram_user_id: telegramUserId,
        user_id: userId,
        problem_text: problemText,
        solution_data: solutionData,
      })
      .select("id")
      .single();

    if (error) {
      console.error("❌ DB insert failed:", error.message);
      return null;
    }

    console.log("✅ Solution saved! ID:", solution?.id);
    return solution?.id || null;
  } catch (error) {
    console.error("❌ saveSolution error:", error instanceof Error ? error.message : error);
    return null;
  }
}

async function handleTextMessage(telegramUserId: number, userId: string, text: string) {
  console.log("Handling text message:", { telegramUserId, text });

  try {
    // Get or create chat
    const chatId = await getOrCreateTelegramChat(userId);

    // Check subscription/limits before processing
    const status = await getSubscriptionStatus(userId);
    if (status && !status.is_premium && !status.is_trial_active && status.limit_reached) {
      await sendStatusSnippet(telegramUserId, status);
      return;
    }

    // Save user message
    await supabase.from("chat_messages").insert({
      chat_id: chatId,
      user_id: userId,
      role: "user",
      content: text,
      input_method: "text",
    });

    // Функция для обновления signed URL для старых изображений
    async function refreshImageUrls(messages: any[]) {
      return await Promise.all(
        messages.map(async (msg) => {
          if (msg.image_path) {
            const { data: signedData, error } = await supabase.storage
              .from("chat-images")
              .createSignedUrl(msg.image_path, 3600);
            if (!error && signedData) {
              return { ...msg, image_url: signedData.signedUrl };
            }
          }
          return msg;
        })
      );
    }

    // Get chat history - limit to last 20 messages, then compact
    const { data: historyReversed } = await supabase
      .from("chat_messages")
      .select("role, content, image_url, image_path")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(20);

    let history = historyReversed?.reverse() || [];
    
    // Compact history: keep only last N messages, strip old images
    const compacted = compactHistoryForTelegram(history);
    
    // Merge consecutive user messages to ensure proper turn-taking
    const merged = mergeConsecutiveUserMessages(compacted);
    
    // Refresh signed URLs only for messages that still have images
    const readyHistory = await refreshImageUrls(merged);
    
    const imageCount = readyHistory.filter(m => m.image_url).length;
    console.log("📊 [handleTextMessage] history compact:", {
      rawCount: history.length,
      compactedCount: readyHistory.length,
      imagesKept: imageCount,
    });

    // Start typing loop
    const stopTyping = { stop: false };
    const typingPromise = sendTypingLoop(telegramUserId, stopTyping);

    // Call AI chat function with timeout
    const chatResponse = await fetchChatWithTimeout({
      messages: readyHistory,
      chatId: chatId,
      userId: userId,
      responseProfile: "telegram_compact",
      responseMode: "dialog",
      maxChars: TELEGRAM_DIALOG_MAX_CHARS,
    }, telegramUserId, "handleTextMessage");

    // Stop typing
    stopTyping.stop = true;
    await typingPromise;

    if (!chatResponse) return; // fallback already sent

    // Handle rate limit error
    if (chatResponse.status === 429) {
      const errorBody = await chatResponse.json().catch(() => null);
      const limit = errorBody?.limit ?? 10;
      await sendTelegramMessage(
        telegramUserId,
        `⏳ Достигнут дневной лимит ${limit} сообщений. Оформи Premium за 699₽/мес, чтобы получить безлимит и приоритетные ответы.`,
        { reply_markup: premiumKeyboard },
      );
      return;
    }

    // Handle payment required error
    if (chatResponse.status === 402) {
      await sendTelegramMessage(
        telegramUserId,
        "💳 Закончились средства на балансе. Пожалуйста, пополни баланс в личном кабинете.",
      );
      return;
    }

    if (!chatResponse.ok) {
      console.error("AI response error:", chatResponse.status, await chatResponse.text());
      await sendTelegramMessage(telegramUserId, "❌ Произошла ошибка. Попробуй ещё раз.");
      return;
    }

    // Parse SSE stream
    const aiContent = await parseSSEStream(chatResponse);

    // DEBUG: Log raw AI response
    console.log("🤖 RAW AI RESPONSE (first 500 chars):");
    console.log(aiContent.substring(0, 500));
    console.log("\n📊 Checking for problematic patterns:");
    if (aiContent.includes("**План решения:")) {
      const planIndex = aiContent.indexOf("**План решения:");
      console.log('Found "**План решения:" at position', planIndex);
      console.log("Next 100 chars:", aiContent.substring(planIndex, planIndex + 100).replace(/\n/g, "\\n"));
    }
    if (aiContent.includes("**Метод:")) {
      const methodIndex = aiContent.indexOf("**Метод:");
      console.log('Found "**Метод:" at position', methodIndex);
      console.log("Next 100 chars:", aiContent.substring(methodIndex, methodIndex + 100).replace(/\n/g, "\\n"));
    }

    // Save solution to database
    const solutionId = await saveSolution(telegramUserId, telegramUserId, userId, text, aiContent);

    const formatResult = formatTelegramResponseWithFallback(aiContent, {
      responseMode: "dialog",
      maxChars: TELEGRAM_DIALOG_MAX_CHARS,
    });
    console.log("🧾 Telegram format stats:", {
      responseMode: "dialog",
      rawLen: aiContent.length,
      finalLen: formatResult.formatted.length,
      truncated: formatResult.truncated,
      partsCount: formatResult.parts.length,
      usedFallback: formatResult.usedFallback,
    });

    await supabase.from("chat_messages").insert({
      chat_id: chatId,
      user_id: userId,
      role: "assistant",
      content: aiContent,
    });

    const keyboardSolutionId = await resolveKeyboardSolutionId(userId, solutionId);
    const messageParts = formatResult.parts;
    for (let i = 0; i < messageParts.length; i++) {
      if (i > 0) {
        // Small delay between parts
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Add inline keyboard only to the last message part
      const isLastPart = i === messageParts.length - 1;
      await sendTelegramMessage(
        telegramUserId,
        messageParts[i],
        isLastPart ? { reply_markup: createQuickActionsKeyboard(keyboardSolutionId) } : undefined,
      );
    }

    // Post-response UX nudges
    await maybeSendTrialReminder(telegramUserId, userId);
  } catch (error) {
    console.error("handleTextMessage error:", {
      telegramUserId,
      userId,
      textPreview: text.substring(0, 100),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await safeSendError(telegramUserId, "❌ Произошла ошибка. Попробуй ещё раз.");
  }
}

// === GROUP CHAT AI HANDLER ===

async function handleGroupTextMessage(
  groupChatId: number,
  messageId: number,
  telegramUserId: number,
  userId: string,
  text: string,
  replyContext?: string,
) {
  console.log("📢 Handling group text message:", { groupChatId, telegramUserId, text: text.substring(0, 100) });

  try {
    // Check subscription/limits before processing
    const status = await getSubscriptionStatus(userId);
    if (status && !status.is_premium && !status.is_trial_active && status.limit_reached) {
      await sendTelegramMessage(
        groupChatId,
        `⏳ Достигнут дневной лимит ${status.daily_limit} сообщений. Напиши мне в личные сообщения для информации о Premium.`,
        { reply_to_message_id: messageId },
      );
      return;
    }

    // Start typing loop in the group chat
    const stopTyping = { stop: false };
    const typingPromise = sendTypingLoop(groupChatId, stopTyping);

    try {
      // Build messages for AI
      const messages: Array<{ role: string; content: string }> = [];
      if (replyContext) {
        messages.push({ role: "assistant", content: replyContext });
      }
      messages.push({ role: "user", content: text });

      // Call AI chat function with group context (with timeout + retry)
      const chatResponse = await fetchChatWithTimeout({
        messages,
        userId,
        responseProfile: "telegram_compact",
        responseMode: "dialog",
        maxChars: TELEGRAM_DIALOG_MAX_CHARS,
        taskContext: "Ты отвечаешь на вопрос ученика в групповом чате Telegram (репетитор и ученики). Отвечай кратко и по делу. Не задавай личных вопросов (класс, имя). Просто ответь на вопрос по предмету.",
      }, groupChatId, "handleGroupTextMessage");

      if (!chatResponse) return; // fallback already sent

      // Handle rate limit error
      if (chatResponse.status === 429) {
        await sendTelegramMessage(
          groupChatId,
          "⏳ Слишком много запросов. Попробуй чуть позже.",
          { reply_to_message_id: messageId },
        );
        return;
      }

      if (!chatResponse.ok) {
        console.error("AI response error (group):", chatResponse.status, await chatResponse.text());
        await sendTelegramMessage(
          groupChatId,
          "❌ Произошла ошибка. Попробуй ещё раз.",
          { reply_to_message_id: messageId },
        );
        return;
      }

      // Parse SSE stream
      const aiContent = await parseSSEStream(chatResponse);

      const formatResult = formatTelegramResponseWithFallback(aiContent, {
        responseMode: "dialog",
        maxChars: TELEGRAM_DIALOG_MAX_CHARS,
      });

      // Send response parts as reply to the student's message
      const messageParts = formatResult.parts;
      for (let i = 0; i < messageParts.length; i++) {
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        await sendTelegramMessage(
          groupChatId,
          messageParts[i],
          // Only the first part is a reply to the original message
          i === 0 ? { reply_to_message_id: messageId } : undefined,
        );
      }
    } finally {
      stopTyping.stop = true;
      await typingPromise;
    }
  } catch (error) {
    console.error("Error handling group text message:", error);
    await sendTelegramMessage(
      groupChatId,
      "❌ Произошла ошибка. Попробуй ещё раз.",
      { reply_to_message_id: messageId },
    );
  }
}

// === GROUP CHAT PHOTO HANDLER ===

async function handleGroupPhotoMessage(
  groupChatId: number,
  messageId: number,
  telegramUserId: number,
  userId: string,
  photo: { file_id: string },
  caption: string | null,
  replyContext?: string,
) {
  console.log("📸 Handling group photo message:", { groupChatId, telegramUserId, photoId: photo.file_id });

  try {
    // Check subscription/limits before processing
    const status = await getSubscriptionStatus(userId);
    if (status && !status.is_premium && !status.is_trial_active && status.limit_reached) {
      await sendTelegramMessage(
        groupChatId,
        `⏳ Достигнут дневной лимит ${status.daily_limit} сообщений. Напиши мне в личные сообщения для информации о Premium.`,
        { reply_to_message_id: messageId },
      );
      return;
    }

    // Download photo from Telegram
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${photo.file_id}`,
    );
    const fileData = await fileResponse.json();
    if (!fileData.ok) {
      throw new Error(`Failed to get file from Telegram: ${JSON.stringify(fileData)}`);
    }

    const filePath = fileData.result.file_path;
    const imageResponse = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.status}`);
    }
    const imageBlob = await imageResponse.blob();

    // Upload to Supabase Storage
    const fileName = `${userId}/${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("chat-images")
      .upload(fileName, imageBlob, { contentType: "image/jpeg", upsert: false });

    if (uploadError) {
      throw new Error(`Failed to upload image: ${uploadError.message}`);
    }

    // Create signed URL for AI (24 hours)
    const { data: signedData, error: signError } = await supabase.storage
      .from("chat-images")
      .createSignedUrl(fileName, 86400);

    if (signError || !signedData) {
      throw new Error(`Failed to create signed URL: ${signError?.message}`);
    }

    // Start typing loop
    const stopTyping = { stop: false };
    const typingPromise = sendTypingLoop(groupChatId, stopTyping);

    try {
      // Build multimodal message for AI
      const messages: Array<{ role: string; content: string; image_url?: string }> = [];
      if (replyContext) {
        messages.push({ role: "assistant", content: replyContext });
      }
      messages.push({
        role: "user",
        content: caption || "Помоги решить эту задачу",
        image_url: signedData.signedUrl,
      });

      // Call AI chat function with group context (with timeout + retry)
      const chatResponse = await fetchChatWithTimeout({
        messages,
        userId,
        responseProfile: "telegram_compact",
        responseMode: "dialog",
        maxChars: TELEGRAM_DIALOG_MAX_CHARS,
        taskContext: "Ты отвечаешь на вопрос ученика в групповом чате Telegram (репетитор и ученики). Ученик прислал фото задачи. Разбери задачу и помоги решить. Отвечай кратко и по делу.",
      }, groupChatId, "handleGroupPhotoMessage");

      if (!chatResponse) return; // fallback already sent

      if (chatResponse.status === 429) {
        await sendTelegramMessage(
          groupChatId,
          "⏳ Слишком много запросов. Попробуй чуть позже.",
          { reply_to_message_id: messageId },
        );
        return;
      }

      if (!chatResponse.ok) {
        console.error("AI response error (group photo):", chatResponse.status, await chatResponse.text());
        await sendTelegramMessage(
          groupChatId,
          "❌ Произошла ошибка. Попробуй ещё раз.",
          { reply_to_message_id: messageId },
        );
        return;
      }

      // Parse SSE stream and send response
      const aiContent = await parseSSEStream(chatResponse);
      const formatResult = formatTelegramResponseWithFallback(aiContent, {
        responseMode: "dialog",
        maxChars: TELEGRAM_DIALOG_MAX_CHARS,
      });

      const messageParts = formatResult.parts;
      for (let i = 0; i < messageParts.length; i++) {
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        await sendTelegramMessage(
          groupChatId,
          messageParts[i],
          i === 0 ? { reply_to_message_id: messageId } : undefined,
        );
      }
    } finally {
      stopTyping.stop = true;
      await typingPromise;
    }
  } catch (error) {
    console.error("Error handling group photo message:", error);
    await sendTelegramMessage(
      groupChatId,
      "❌ Ошибка при обработке фото. Попробуй ещё раз.",
      { reply_to_message_id: messageId },
    );
  }
}

async function handlePhotoMessage(telegramUserId: number, userId: string, photo: any, caption?: string) {
  console.log("Handling photo message:", { telegramUserId, photoId: photo.file_id });

  try {
    // Get file info from Telegram
    console.log("Step 1: Getting file info from Telegram...");
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${photo.file_id}`,
    );
    const fileData = await fileResponse.json();

    if (!fileData.ok) {
      console.error("Telegram getFile failed:", fileData);
      throw new Error(`Failed to get file from Telegram: ${JSON.stringify(fileData)}`);
    }

    const filePath = fileData.result.file_path;
    console.log("Step 2: File path obtained:", filePath);

    // Download image from Telegram
    console.log("Step 3: Downloading image from Telegram...");
    const imageResponse = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);

    if (!imageResponse.ok) {
      console.error("Failed to download image:", imageResponse.status);
      throw new Error(`Failed to download image: ${imageResponse.status}`);
    }

    const imageBlob = await imageResponse.blob();
    console.log("Step 4: Image downloaded, size:", imageBlob.size);

    // Upload to Supabase Storage
    console.log("Step 5: Uploading to Supabase Storage...");
    const fileName = `${userId}/${Date.now()}.jpg`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("chat-images")
      .upload(fileName, imageBlob, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error(`Failed to upload image: ${uploadError.message}`);
    }
    console.log("Step 6: Upload successful:", fileName);

    // Create signed URL for AI
    console.log("Step 7: Creating signed URL...");
    const { data: signedData, error: signError } = await supabase.storage
      .from("chat-images")
      .createSignedUrl(fileName, 86400); // 24 hours

    if (signError || !signedData) {
      console.error("Failed to create signed URL:", signError);
      throw new Error(`Failed to create signed URL: ${signError?.message}`);
    }
    console.log("Step 8: Signed URL created");

    // Функция для обновления signed URL для старых изображений
    async function refreshImageUrls(messages: any[]) {
      return await Promise.all(
        messages.map(async (msg) => {
          if (msg.image_path) {
            const { data: signedData, error } = await supabase.storage
              .from("chat-images")
              .createSignedUrl(msg.image_path, 3600);
            if (!error && signedData) {
              return { ...msg, image_url: signedData.signedUrl };
            }
          }
          return msg;
        })
      );
    }

    // Get or create chat
    console.log("Step 9: Getting or creating chat...");
    const chatId = await getOrCreateTelegramChat(userId);
    console.log("Step 10: Chat ID:", chatId);

    // Save user message with image
    console.log("Step 11: Saving message to database...");
    await supabase.from("chat_messages").insert({
      chat_id: chatId,
      user_id: userId,
      role: "user",
      content: caption || "Помоги решить эту задачу",
      image_url: signedData.signedUrl,
      image_path: fileName,
      input_method: "photo",
    });

    // Get chat history - limit to last 20 messages, then compact
    console.log("Step 12: Getting chat history...");
    const { data: historyReversed, error: historyError } = await supabase
      .from("chat_messages")
      .select("role, content, image_url, image_path")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (historyError) {
      console.error("Failed to get chat history:", historyError);
    }

    let history = historyReversed?.reverse() || [];
    console.log("Step 13: Chat history loaded, messages:", history.length);

    // Compact history: keep only last N messages, strip old images
    const compacted = compactHistoryForTelegram(history);
    
    // Merge consecutive user messages to ensure proper turn-taking
    const merged = mergeConsecutiveUserMessages(compacted);
    
    // Refresh signed URLs only for messages that still have images
    const readyHistory = await refreshImageUrls(merged);
    
    const imageCount = readyHistory.filter((m: any) => m.image_url).length;
    console.log("📊 [handlePhotoMessage] history compact:", {
      rawCount: history.length,
      compactedCount: readyHistory.length,
      imagesKept: imageCount,
    });

    // Start typing loop
    const stopTyping = { stop: false };
    const typingPromise = sendTypingLoop(telegramUserId, stopTyping);

    // Call AI chat function with timeout
    console.log("Step 14: Calling AI chat function...");
    const chatResponse = await fetchChatWithTimeout({
      messages: readyHistory,
      chatId: chatId,
      userId: userId,
      responseProfile: "telegram_compact",
      responseMode: "dialog",
      maxChars: TELEGRAM_DIALOG_MAX_CHARS,
    }, telegramUserId, "handlePhotoMessage");

    // Stop typing
    stopTyping.stop = true;
    await typingPromise;

    if (!chatResponse) return; // fallback already sent

    console.log("Step 15: AI response status:", chatResponse.status);

    // Handle rate limit error
    if (chatResponse.status === 429) {
      await sendTelegramMessage(telegramUserId, "⏳ Слишком много запросов. Подожди немного и попробуй снова.");
      return;
    }

    // Handle payment required error
    if (chatResponse.status === 402) {
      await sendTelegramMessage(
        telegramUserId,
        "💳 Закончились средства на балансе. Пожалуйста, пополни баланс в личном кабинете.",
      );
      return;
    }

    if (!chatResponse.ok) {
      const errorText = await chatResponse.text();
      console.error("AI response error:", chatResponse.status, errorText);
      await sendTelegramMessage(telegramUserId, `❌ Ошибка AI: ${errorText.substring(0, 100)}`);
      return;
    }

    // Parse SSE stream
    console.log("Step 16: Parsing AI response...");
    const aiContent = await parseSSEStream(chatResponse);
    console.log("Step 17: AI response parsed, length:", aiContent.length);

    // Save solution to database
    console.log("Step 18: Saving solution to database...");
    const problemText = caption || "Задача из фото";
    const solutionId = await saveSolution(telegramUserId, telegramUserId, userId, problemText, aiContent);
    console.log("Step 19: Solution saved, ID:", solutionId);

    // Format and save AI response
    console.log("Step 20: Formatting content for Telegram...");
    const formatResult = formatTelegramResponseWithFallback(aiContent, {
      responseMode: "dialog",
      maxChars: TELEGRAM_DIALOG_MAX_CHARS,
    });
    console.log("🧾 Telegram format stats:", {
      responseMode: "dialog",
      rawLen: aiContent.length,
      finalLen: formatResult.formatted.length,
      truncated: formatResult.truncated,
      partsCount: formatResult.parts.length,
      usedFallback: formatResult.usedFallback,
    });

    console.log("Step 21: Saving AI response to database...");
    await supabase.from("chat_messages").insert({
      chat_id: chatId,
      user_id: userId,
      role: "assistant",
      content: aiContent,
    });

    // Split and send response if too long
    console.log("Step 22: Splitting and sending messages...");
    const keyboardSolutionId = await resolveKeyboardSolutionId(userId, solutionId);
    const messageParts = formatResult.parts;
    console.log("Message parts:", messageParts.length);

    for (let i = 0; i < messageParts.length; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      // Add inline keyboard only to the last message part
      const isLastPart = i === messageParts.length - 1;
      await sendTelegramMessage(
        telegramUserId,
        messageParts[i],
        isLastPart ? { reply_markup: createQuickActionsKeyboard(keyboardSolutionId) } : undefined,
      );
    }

    console.log("Photo message handled successfully!");
  } catch (error) {
    console.error("handlePhotoMessage error:", {
      telegramUserId,
      userId,
      photoFileId: photo?.file_id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await safeSendError(telegramUserId, "❌ Ошибка при обработке фото. Попробуй ещё раз.");
  }
}

// ============= VOICE MESSAGE TRANSCRIPTION =============

async function handleVoiceMessage(
  telegramUserId: number,
  userId: string,
  voice: { file_id: string; duration: number; mime_type?: string },
) {
  console.log("Handling voice message:", { telegramUserId, duration: voice.duration, mime: voice.mime_type });

  const stopSignal = { stop: false };
  const typingPromise = sendTypingLoop(telegramUserId, stopSignal);

  try {
    // 1. Get file path from Telegram
    const fileInfoRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: voice.file_id }),
      },
    );
    const fileInfoData = await fileInfoRes.json();
    if (!fileInfoData.ok || !fileInfoData.result?.file_path) {
      stopSignal.stop = true;
      await sendTelegramMessage(telegramUserId, "❌ Не удалось получить голосовое сообщение. Попробуй ещё раз.");
      return;
    }

    const filePath = fileInfoData.result.file_path;

    // 2. Download the OGG file
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
      stopSignal.stop = true;
      await sendTelegramMessage(telegramUserId, "❌ Не удалось скачать голосовое сообщение.");
      return;
    }
    const audioBuffer = await fileRes.arrayBuffer();

    // 3. Send to Groq Whisper API for transcription (OpenAI-compatible)
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_API_KEY) {
      stopSignal.stop = true;
      console.error("GROQ_API_KEY is not configured");
      await sendTelegramMessage(telegramUserId, "❌ Расшифровка голосовых временно недоступна.");
      return;
    }

    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer], { type: voice.mime_type || "audio/ogg" }), "voice.ogg");
    formData.append("model", "whisper-large-v3-turbo");
    formData.append("language", "ru");

    const transcribeRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: formData,
    });

    if (!transcribeRes.ok) {
      const errText = await transcribeRes.text().catch(() => "unknown");
      console.error("Groq transcription failed:", { status: transcribeRes.status, body: errText });
      stopSignal.stop = true;
      await sendTelegramMessage(telegramUserId, "❌ Не удалось расшифровать голосовое сообщение. Попробуй отправить текстом.");
      return;
    }

    const transcribeData = await transcribeRes.json();
    const transcribedText = transcribeData?.text?.trim();

    if (!transcribedText) {
      stopSignal.stop = true;
      await sendTelegramMessage(telegramUserId, "❌ Не удалось распознать речь. Попробуй записать ещё раз или отправь текстом.");
      return;
    }

    stopSignal.stop = true;
    await typingPromise;

    // 4. Show transcription to user
    const durationStr = voice.duration >= 60
      ? `${Math.floor(voice.duration / 60)}:${String(voice.duration % 60).padStart(2, "0")}`
      : `0:${String(voice.duration).padStart(2, "0")}`;

    await sendTelegramMessage(telegramUserId, `🎤 Расшифровка [${durationStr}]:\n«${transcribedText}»`);

    // 5. Process as regular text message
    await handleTextMessage(telegramUserId, userId, transcribedText);
  } catch (err) {
    stopSignal.stop = true;
    await typingPromise;
    console.error("handleVoiceMessage error:", {
      telegramUserId,
      userId,
      voiceDuration: voice.duration,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    await safeSendError(telegramUserId, "❌ Ошибка при обработке голосового сообщения. Попробуй ещё раз.");
  }
}

/**
 * Handles button actions (solution/hint/explain) by editing the original message
 * Instead of sending new messages, this function edits the message where buttons were clicked
 */
async function handleButtonAction(
  telegramUserId: number,
  userId: string,
  promptText: string,
  originalMessageId: number | undefined,
  responseHeader: string,
  responseMode: TelegramResponseMode,
) {
  console.log("Handling button action:", { telegramUserId, promptText, originalMessageId, responseMode });

  try {
    // Get or create chat
    const chatId = await getOrCreateTelegramChat(userId);

    // Check subscription/limits before processing
    const status = await getSubscriptionStatus(userId);
    if (status && !status.is_premium && !status.is_trial_active && status.limit_reached) {
      if (originalMessageId) {
        await editTelegramMessage(
          telegramUserId,
          originalMessageId,
          `${responseHeader}\n\n⏳ Достигнут дневной лимит. Оформи Premium для безлимита.`
        );
      }
      await sendStatusSnippet(telegramUserId, status);
      return;
    }

    // Save user message (button action)
    await supabase.from("chat_messages").insert({
      chat_id: chatId,
      user_id: userId,
      role: "user",
      content: promptText,
      input_method: "button",
    });

    // Функция для обновления signed URL для старых изображений
    async function refreshImageUrls(messages: any[]) {
      return await Promise.all(
        messages.map(async (msg) => {
          if (msg.image_path) {
            const { data: signedData, error } = await supabase.storage
              .from("chat-images")
              .createSignedUrl(msg.image_path, 3600);

            if (!error && signedData) {
              return { ...msg, image_url: signedData.signedUrl };
            }
          }
          return msg;
        })
      );
    }

    // Get chat history - limit to last 20 messages
    const { data: historyReversed } = await supabase
      .from("chat_messages")
      .select("role, content, image_url, image_path")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(20);

    let history = historyReversed?.reverse() || [];
    history = await refreshImageUrls(history);

    // Start typing loop
    const stopTyping = { stop: false };
    const typingPromise = sendTypingLoop(telegramUserId, stopTyping);

    // Call AI chat function (with timeout + retry)
    const chatResponse = await fetchChatWithTimeout({
      messages: history || [],
      chatId: chatId,
      userId: userId,
      responseProfile: "telegram_compact",
      responseMode,
    }, telegramUserId, "handleButtonAction");

    // Stop typing
    stopTyping.stop = true;
    await typingPromise;

    if (!chatResponse) return; // fallback already sent

    // Handle errors
    if (chatResponse.status === 429) {
      const errorBody = await chatResponse.json().catch(() => null);
      const limit = errorBody?.limit ?? 10;
      if (originalMessageId) {
        await editTelegramMessage(
          telegramUserId,
          originalMessageId,
          `${responseHeader}\n\n⏳ Достигнут дневной лимит ${limit} сообщений.`
        );
      }
      await sendTelegramMessage(
        telegramUserId,
        `Оформи Premium за 699₽/мес, чтобы получить безлимит.`,
        { reply_markup: premiumKeyboard }
      );
      return;
    }

    if (chatResponse.status === 402) {
      if (originalMessageId) {
        await editTelegramMessage(
          telegramUserId,
          originalMessageId,
          `${responseHeader}\n\n💳 Закончились средства на балансе.`
        );
      }
      return;
    }

    if (!chatResponse.ok) {
      console.error("AI response error:", chatResponse.status, await chatResponse.text());
      if (originalMessageId) {
        await editTelegramMessage(
          telegramUserId,
          originalMessageId,
          `${responseHeader}\n\n❌ Произошла ошибка. Попробуй ещё раз.`
        );
      }
      return;
    }

    // Parse SSE stream
    const aiContent = await parseSSEStream(chatResponse);

    // Save AI response
    await supabase.from("chat_messages").insert({
      chat_id: chatId,
      user_id: userId,
      role: "assistant",
      content: aiContent,
    });

    // Format for Telegram with improved structure
    const formatResult = formatTelegramResponseWithFallback(aiContent, {
      responseMode,
    });
    console.log("🧾 Telegram format stats:", {
      responseMode,
      rawLen: aiContent.length,
      finalLen: formatResult.formatted.length,
      truncated: formatResult.truncated,
      partsCount: formatResult.parts.length,
      usedFallback: formatResult.usedFallback,
    });

    // Build final message with header
    const fullMessage = `${responseHeader}\n\n${formatResult.formatted}`;

    // Split if too long (Telegram limit is ~4096 chars)
    const messageParts = splitHtmlSafely(fullMessage, TELEGRAM_MESSAGE_MAX_LENGTH);
    const keyboardSolutionId = await resolveKeyboardSolutionId(userId);

    // Edit the original message with the first part
    if (originalMessageId && messageParts.length > 0) {
      try {
        if (messageParts.length === 1) {
          // Single part: edit the message with response and include buttons
          await editTelegramMessage(
            telegramUserId,
            originalMessageId,
            messageParts[0],
            { reply_markup: createQuickActionsKeyboard(keyboardSolutionId) }
          );
        } else {
          // Multiple parts: edit with first part (no buttons)
          await editTelegramMessage(
            telegramUserId,
            originalMessageId,
            messageParts[0]
          );

          // Send remaining parts as new messages
          for (let i = 1; i < messageParts.length; i++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const isLastPart = i === messageParts.length - 1;
            await sendTelegramMessage(
              telegramUserId,
              messageParts[i],
              isLastPart ? { reply_markup: createQuickActionsKeyboard(keyboardSolutionId) } : undefined
            );
          }
        }
      } catch (e) {
        console.error("Failed to edit message with response:", e);
        // Fallback: send as new message
        for (let i = 0; i < messageParts.length; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const isLastPart = i === messageParts.length - 1;
          await sendTelegramMessage(
            telegramUserId,
            messageParts[i],
            isLastPart ? { reply_markup: createQuickActionsKeyboard(keyboardSolutionId) } : undefined
          );
        }
      }
    } else {
      // No original message to edit, send as new
      for (let i = 0; i < messageParts.length; i++) {
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const isLastPart = i === messageParts.length - 1;
        await sendTelegramMessage(
          telegramUserId,
          messageParts[i],
          isLastPart ? { reply_markup: createQuickActionsKeyboard(keyboardSolutionId) } : undefined
        );
      }
    }

    // Post-response UX nudges
    await maybeSendTrialReminder(telegramUserId, userId);
  } catch (error) {
    console.error("Error handling button action:", error);
    if (originalMessageId) {
      try {
        await editTelegramMessage(
          telegramUserId,
          originalMessageId,
          `${responseHeader}\n\n❌ Произошла ошибка. Попробуй ещё раз.`
        );
      } catch (e) {
        await sendTelegramMessage(telegramUserId, "❌ Произошла ошибка. Попробуй ещё раз.");
      }
    } else {
      await sendTelegramMessage(telegramUserId, "❌ Произошла ошибка. Попробуй ещё раз.");
    }
  }
}

async function handleCallbackQuery(callbackQuery: any) {
  const telegramUserId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message?.message_id;

  console.log("Handling callback query:", { telegramUserId, data, messageId });

  // Handle help depth control buttons
  if (data.startsWith("help_depth:")) {
    const session = await getOnboardingSession(telegramUserId);

    if (!session?.user_id) {
      // Answer callback query with error
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: "❌ Сессия не найдена",
          show_alert: true,
        }),
      });
      await sendTelegramMessage(telegramUserId, "❌ Сессия не найдена. Нажми /start");
      return;
    }

    const userId = session.user_id;
    const helpLevel = data.replace("help_depth:", "");

    // Determine prompt text and response header based on help depth level
    let promptText = "";
    let responseHeader = "";
    let buttonText = "";
    let responseMode: TelegramResponseMode = "dialog";

    switch (helpLevel) {
      case "solution":
        promptText = "Покажи полное решение этой задачи с ответом. Не задавай вопросов, просто реши.";
        responseHeader = "<b>Решение:</b>";
        buttonText = "Показываю решение...";
        responseMode = "solution";
        break;
      case "hint":
        promptText = "Дай мне только подсказку для следующего шага. Не решай полностью, только намекни на направление.";
        responseHeader = "<b>Подсказка:</b>";
        buttonText = "Готовлю подсказку...";
        responseMode = "hint";
        break;
      case "explain":
        promptText = "Объясни подробнее последний шаг или концепцию. Разбери детально с примерами.";
        responseHeader = "<b>Разбор шага:</b>";
        buttonText = "Разбираю шаг...";
        responseMode = "explain";
        break;
      default:
        return;
    }

    // Answer callback query immediately
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQuery.id,
        text: buttonText,
      }),
    });

    // Send NEW message with loading state (don't edit original - keep its buttons)
    let loadingMessageId: number | undefined;
    try {
      const loadingResponse = await sendTelegramMessage(
        telegramUserId,
        `${responseHeader}\n\n⏳ <i>Генерирую ответ...</i>`
      );
      loadingMessageId = loadingResponse?.result?.message_id;
      console.log("Loading message sent, ID:", loadingMessageId);
    } catch (e) {
      console.error("Failed to send loading message:", e);
    }

    // Process the button action - edit the LOADING message (not original)
    await handleButtonAction(telegramUserId, userId, promptText, loadingMessageId, responseHeader, responseMode);
    return;
  }

  // Answer callback query immediately (default response)
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQuery.id,
      text: "Обрабатываю...",
    }),
  });

  // Get session for all handlers
  const session = await getOnboardingSession(telegramUserId);
  const userId = session?.user_id;

  // ============= PRACTICE CALLBACKS =============
  
  // Main menu
  if (data === "main_menu") {
    await sendTelegramMessage(
      telegramUserId,
      `🎓 <b>Сократ AI</b> — твой AI-репетитор по математике\n\nВыбери, что хочешь делать:`,
      { reply_markup: createMainMenuKeyboard() }
    );
    return;
  }

  // Subscription status
  if (data === "subscription_status") {
    if (!userId) {
      await sendTelegramMessage(telegramUserId, "❌ Сессия не найдена. Нажми /start");
      return;
    }

    const status = await getSubscriptionStatus(userId);
    if (!status) {
      await sendTelegramMessage(telegramUserId, "❌ Не удалось получить статус подписки. Попробуй позже.");
      return;
    }

    await sendTelegramMessage(
      telegramUserId,
      formatSubscriptionStatus(status),
      !status.is_premium ? { reply_markup: premiumKeyboard } : undefined,
    );
    return;
  }

  // Practice start (выбор номера)
  if (data === "practice_start") {
    await handlePracticeStart(telegramUserId);
    return;
  }

  // Practice: выбор конкретного номера ЕГЭ
  if (data.startsWith("practice_ege:")) {
    if (!userId) {
      await sendTelegramMessage(telegramUserId, "❌ Сессия не найдена. Нажми /start");
      return;
    }
    const egeNumber = parseInt(data.replace("practice_ege:", ""));
    await sendPracticeProblem(telegramUserId, userId, egeNumber);
    return;
  }

  // Practice: отмена
  if (data === "practice_cancel") {
    await updatePracticeState(telegramUserId, null);
    await sendTelegramMessage(
      telegramUserId,
      `❌ Задача отменена.\n\nВыбери другой номер или вернись в меню:`,
      { reply_markup: createEgeNumberKeyboard() }
    );
    return;
  }

  // Practice: показ решения
  if (data.startsWith("practice_solution:")) {
    const problemId = data.replace("practice_solution:", "");
    await handlePracticeSolution(telegramUserId, problemId);
    return;
  }

  // ============= DIAGNOSTIC CALLBACKS =============

  // Diagnostic intro (start screen)
  if (data === "diagnostic_start") {
    await handleDiagnosticIntro(telegramUserId);
    return;
  }

  // Diagnostic begin (actually start the test)
  if (data === "diagnostic_begin") {
    if (!userId) {
      await sendTelegramMessage(telegramUserId, "❌ Сессия не найдена. Нажми /start");
      return;
    }
    await handleDiagnosticStart(telegramUserId, userId);
    return;
  }

  // Diagnostic skip question
  if (data === "diagnostic_skip") {
    if (!userId) {
      await sendTelegramMessage(telegramUserId, "❌ Сессия не найдена. Нажми /start");
      return;
    }
    await handleDiagnosticAnswer(telegramUserId, userId, "", true);
    return;
  }

  // Diagnostic cancel
  if (data === "diagnostic_cancel") {
    await handleDiagnosticCancel(telegramUserId);
    return;
  }

  // ============= PAYMENT CALLBACKS (for tutors) =============

  // ─── Mobile payment marking (/pay flow) ───────────────────────────
  if (data === "paym_list") {
    await handlePaymList(telegramUserId, callbackQuery.message?.message_id);
    return;
  }

  if (data.startsWith("paym_s:")) {
    await handlePaymStudent(telegramUserId, data.slice(7), callbackQuery.message?.message_id);
    return;
  }

  if (data.startsWith("paym_ok:")) {
    await handlePaymOk(telegramUserId, data.slice(8), callbackQuery.message?.message_id);
    return;
  }

  if (data.startsWith("paym_oks:")) {
    await handlePaymOkStudent(telegramUserId, data.slice(9), callbackQuery.message?.message_id);
    return;
  }
  // ──────────────────────────────────────────────────────────────────

  if (data.startsWith("payment_remind:")) {
    await handlePaymentRemindCallback(telegramUserId, data);
    return;
  }

  if (data.startsWith("payment:")) {
    await handlePaymentCallback(telegramUserId, data, callbackQuery.message?.message_id);
    return;
  }

  // ============= CHAT MODE CALLBACK =============
  
  if (data === "chat_mode") {
    // Очищаем состояния practice/diagnostic если есть
    await updatePracticeState(telegramUserId, null);
    await updateDiagnosticState(telegramUserId, null);
    
    await sendTelegramMessage(
      telegramUserId,
      `💬 <b>Режим чата с Сократ AI</b>

Отправь мне:
📸 Фото задачи из учебника
✏️ Текст задачи или вопроса

Я помогу тебе разобраться! 🚀`,
      { reply_markup: { inline_keyboard: [[{ text: "🏠 Меню", callback_data: "main_menu" }]] } }
    );
    return;
  }

  // ============= UPDATE NEWS CALLBACK =============

  if (data === "update_details") {
    const detailsMessage = `🚀 <b>Подробнее об обновлениях:</b>

<b>1. Все школьные предметы</b>
Теперь Сократ AI помогает не только с математикой, но и с:
• Обществознанием и историей
• Биологией и химией
• Русским языком и литературой
• Английским и географией

<b>2. Улучшенные объяснения</b>
• Лучше понимает контекст задачи
• Точнее решает сложные задачи ЕГЭ
• Даёт более структурированные ответы

<b>3. Графики и визуализация</b>
Попроси «построй график y = x² - 4x + 3» — Сократ AI нарисует его прямо в чате! Работает в веб-версии.

🎯 <i>Попробуй прямо сейчас — отправь задачу из сегодняшней домашки!</i>`;

    await sendTelegramMessage(telegramUserId, detailsMessage, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📊 Попробовать графики", url: "https://sokratai.ru/chat" }],
          [{ text: "🏠 В меню", callback_data: "main_menu" }],
        ],
      },
    });
    return;
  }

  // ============= ONBOARDING CALLBACKS =============

  if (!session) {
    console.error("No session found for user:", telegramUserId);
    return;
  }

  const state = session.onboarding_state as OnboardingState;
  const onboardingData = session.onboarding_data as OnboardingData;

  if (state === "waiting_grade" && data.startsWith("grade_")) {
    const grade = parseInt(data.replace("grade_", ""));
    await handleGradeSelection(telegramUserId, userId!, grade, messageId);
  } else if (state === "waiting_subject" && data.startsWith("subject_")) {
    const subject = data.replace("subject_", "");
    await handleSubjectSelection(telegramUserId, userId!, subject, messageId);
  } else if (state === "waiting_goal" && data.startsWith("goal_")) {
    const goal = data.replace("goal_", "");
    await completeOnboarding(telegramUserId, userId!, goal, messageId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Declared before try so it's accessible in catch
  let fallbackChatId: number | null = null;
  let errorMessageDelivered = false;

  try {
    // Handle special action to set bot menu commands
    const url = new URL(req.url);
    if (url.searchParams.get("action") === "set_commands") {
      const success = await setMyCommands();
      const menuSuccess = await setChatMenuButton();
      return new Response(JSON.stringify({ ok: success && menuSuccess }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const update = await req.json();
    console.log("Received update:", JSON.stringify(update, null, 2));

    // Extract fallback chat ID for top-level error handling
    fallbackChatId = update?.message?.from?.id
      ?? update?.message?.chat?.id
      ?? update?.callback_query?.from?.id
      ?? null;

    // === GROUP CHAT HANDLING (early return — does not affect private chat logic) ===
    if (update.message && isGroupChat(update.message.chat?.type)) {
      const groupChatId = update.message.chat.id;
      const telegramUserId = update.message.from?.id;
      const messageId = update.message.message_id;

      // Anonymous channel posts or service messages have no `from` — skip silently
      if (!telegramUserId) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let questionText: string | null = null;
      let replyContext: string | undefined;

      // Check for @mention in text message
      if (update.message.text) {
        questionText = extractBotMention(
          update.message.text,
          update.message.entities,
          TELEGRAM_BOT_USERNAME,
        );

        // Check for reply-to-our-bot (even without @mention)
        if (!questionText && isReplyToOurBot(update.message, TELEGRAM_BOT_USERNAME)) {
          questionText = update.message.text;
          replyContext = update.message.reply_to_message?.text;
        }
      }

      // Check for photo with @mention in caption or reply-to-bot with photo
      if (!questionText && update.message.photo) {
        if (update.message.caption) {
          questionText = extractBotMention(
            update.message.caption,
            update.message.caption_entities,
            TELEGRAM_BOT_USERNAME,
          );
        }
        // Photo as reply-to-our-bot (no @mention needed)
        if (!questionText && isReplyToOurBot(update.message, TELEGRAM_BOT_USERNAME)) {
          questionText = update.message.caption || "Помоги решить эту задачу";
          replyContext = update.message.reply_to_message?.text;
        }
      }

      if (!questionText) {
        // Bot not mentioned and not replied to — ignore
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Resolve user
      const session = await getOnboardingSession(telegramUserId);
      if (!session?.user_id) {
        await sendTelegramMessage(
          groupChatId,
          "👋 Привет! Чтобы я мог помочь, сначала напиши мне /start в личных сообщениях.",
          { reply_to_message_id: messageId },
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Route to photo or text handler
      // Check photo on current message OR on the replied-to message
      const messagePhoto = update.message.photo;
      const replyPhoto = update.message.reply_to_message?.photo;
      const photoArray = messagePhoto || replyPhoto;

      if (photoArray) {
        const photo = photoArray[photoArray.length - 1];
        await handleGroupPhotoMessage(groupChatId, messageId, telegramUserId, session.user_id, photo, questionText, replyContext);
      } else {
        await handleGroupTextMessage(groupChatId, messageId, telegramUserId, session.user_id, questionText, replyContext);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // === END GROUP CHAT HANDLING ===

    // Handle /start command
    if (update.message?.text?.startsWith("/start")) {
      const telegramUserId = update.message.from.id;
      const telegramUsername = update.message.from.username;
      const parts = update.message.text.split(" ");
      const utmSource = parts[1] || "header_try";

      const commandsConfigured = await setMyCommands();
      if (!commandsConfigured) {
        console.error("Failed to refresh Telegram commands on /start");
      }

      await setChatMenuButton(telegramUserId);
      await handleStart(telegramUserId, telegramUsername, utmSource);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle /practice command
    if (update.message?.text === "/practice" || update.message?.text === "/train") {
      const telegramUserId = update.message.from.id;
      const session = await getOnboardingSession(telegramUserId);
      
      if (session && session.onboarding_state === "completed") {
        await handlePracticeStart(telegramUserId);
      } else {
        await sendTelegramMessage(telegramUserId, "❌ Сначала пройди регистрацию. Нажми /start");
      }
      
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle /diagnostic command
    if (update.message?.text === "/diagnostic" || update.message?.text === "/test") {
      const telegramUserId = update.message.from.id;
      const session = await getOnboardingSession(telegramUserId);
      
      if (session && session.onboarding_state === "completed") {
        await handleDiagnosticIntro(telegramUserId);
      } else {
        await sendTelegramMessage(telegramUserId, "❌ Сначала пройди регистрацию. Нажми /start");
      }
      
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle /menu command
    if (update.message?.text === "/menu") {
      const telegramUserId = update.message.from.id;
      const session = await getOnboardingSession(telegramUserId);
      
      if (session && session.onboarding_state === "completed") {
        await sendTelegramMessage(
          telegramUserId,
          `🎓 <b>Сократ AI</b> — твой AI-репетитор по математике\n\nВыбери, что хочешь делать:`,
          { reply_markup: createMainMenuKeyboard() }
        );
      } else {
        await sendTelegramMessage(telegramUserId, "❌ Сначала пройди регистрацию. Нажми /start");
      }
      
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle /status command
    if (update.message?.text === "/status") {
      const telegramUserId = update.message.from.id;
      const session = await getOnboardingSession(telegramUserId);

      if (session && session.onboarding_state === "completed") {
        const status = await getSubscriptionStatus(session.user_id);
        if (!status) {
          await sendTelegramMessage(telegramUserId, "❌ Не удалось получить статус подписки. Попробуй позже.");
        } else {
          await sendTelegramMessage(
            telegramUserId,
            formatSubscriptionStatus(status),
            !status.is_premium ? { reply_markup: premiumKeyboard } : undefined,
          );
        }
      } else {
        await sendTelegramMessage(telegramUserId, "❌ Сначала пройди регистрацию. Нажми /start");
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle /help command
    if (update.message?.text === "/help") {
      const telegramUserId = update.message.from.id;
      
      await sendTelegramMessage(
        telegramUserId,
        `🎓 <b>Сократ AI — AI-репетитор по математике ЕГЭ</b>

<b>Доступные команды:</b>
/start — начать работу
/menu — главное меню
/practice — тренажёр ЕГЭ
/diagnostic — диагностика уровня
/status — статус подписки
/help — эта справка

<b>Что я умею:</b>
📝 Тренажёр — решай задачи 1-12 части ЕГЭ
🎯 Диагностика — узнай свой уровень
💬 AI-чат — задай любой вопрос
📸 Фото задачи — отправь фото, я помогу решить

Просто напиши или отправь фото! 🚀`
      );
      
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle /pay command (tutor: mark pending payments)
    if (update.message?.text === "/pay") {
      const telegramUserId = update.message.from.id;
      const tutor = await getTutorByTelegramId(telegramUserId);
      if (!tutor) {
        await sendTelegramMessage(
          telegramUserId,
          "❌ Команда /pay доступна только репетиторам.\n\nЕсли вы репетитор — свяжите Telegram в настройках кабинета."
        );
      } else {
        await handlePaymList(telegramUserId);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle /stats command (admin group only)
    if (update.message?.text === "/stats" || update.message?.text?.startsWith("/stats@")) {
      const chatId = update.message.chat.id;
      const telegramUserId = update.message.from.id;
      
      console.log("Stats command received from chat:", chatId);
      
      // Only respond in the admin stats group
      if (chatId === ADMIN_STATS_CHAT_ID) {
        const stats = await getFunnelStats();
        await sendTelegramMessage(chatId, stats);
      }
      
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle /chatid command (debug helper)
    if (update.message?.text === "/chatid") {
      const chatId = update.message.chat.id;
      await sendTelegramMessage(chatId, `Chat ID: <code>${chatId}</code>`);
      
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle callback queries (button presses)
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle text messages
    if (update.message?.text && !update.message.text.startsWith("/")) {
      const telegramUserId = update.message.from.id;
      const session = await getOrRepairOnboardingSession(telegramUserId);

      if (session?.user_id) {
        const text = update.message.text;

        if (session.onboarding_state === "completed") {
          // Check if user is in practice mode
          const sessionState = await getSessionState(telegramUserId);

          if (sessionState.practice_state) {
            // User is answering a practice question
            const handled = await handlePracticeAnswer(telegramUserId, session.user_id, text);
            if (handled) {
              return new Response(JSON.stringify({ ok: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }

          if (sessionState.diagnostic_state) {
            // User is answering a diagnostic question
            const handled = await handleDiagnosticAnswer(telegramUserId, session.user_id, text, false);
            if (handled) {
              return new Response(JSON.stringify({ ok: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }

          // Default: AI chat mode
          await handleTextMessage(telegramUserId, session.user_id, text);
        } else {
          console.warn("telegram_onboarding_incomplete:text", { telegramUserId, state: session.onboarding_state });
          await safeSendError(telegramUserId, "Давай сначала завершим регистрацию! Нажми /start");
        }
      } else {
        console.warn("telegram_no_session:text", { telegramUserId, hasSession: !!session });
        await safeSendError(telegramUserId, "Для начала работы нажми /start");
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle photo messages
    if (update.message?.photo) {
      const telegramUserId = update.message.from.id;
      const session = await getOrRepairOnboardingSession(telegramUserId);

      if (session?.user_id) {
        const photo = update.message.photo[update.message.photo.length - 1]; // Get largest photo

        if (session.onboarding_state === "completed") {
          // If in practice/diagnostic mode, cancel it first
          const sessionState = await getSessionState(telegramUserId);
          if (sessionState.practice_state || sessionState.diagnostic_state) {
            await updatePracticeState(telegramUserId, null);
            await updateDiagnosticState(telegramUserId, null);
            await sendTelegramMessage(
              telegramUserId,
              "📸 Вижу фото! Переключаюсь в режим AI-помощника..."
            );
          }

          await handlePhotoMessage(telegramUserId, session.user_id, photo, update.message.caption);
        } else {
          console.warn("telegram_onboarding_incomplete:photo", { telegramUserId, state: session.onboarding_state });
          await safeSendError(telegramUserId, "Давай сначала завершим регистрацию! Нажми /start");
        }
      } else {
        console.warn("telegram_no_session:photo", { telegramUserId, hasSession: !!session });
        await safeSendError(telegramUserId, "Для начала работы нажми /start");
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle voice messages
    if (update.message?.voice) {
      const telegramUserId = update.message.from.id;
      const session = await getOrRepairOnboardingSession(telegramUserId);

      if (session?.user_id && session.onboarding_state === "completed") {
        await handleVoiceMessage(telegramUserId, session.user_id, update.message.voice);
      } else if (!session?.user_id) {
        console.warn("telegram_no_session:voice", { telegramUserId });
        await safeSendError(telegramUserId, "Для начала работы нажми /start");
      } else {
        console.warn("telegram_onboarding_incomplete:voice", { telegramUserId, state: session?.onboarding_state });
        await safeSendError(telegramUserId, "Давай сначала завершим регистрацию! Нажми /start");
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error processing update:", error);
    if (fallbackChatId) {
      try {
        await sendTelegramMessage(fallbackChatId, "❌ Произошла непредвиденная ошибка. Попробуй ещё раз или напиши /start.");
        errorMessageDelivered = true;
      } catch (sendErr) {
        console.error("Failed to deliver top-level error message:", sendErr instanceof Error ? sendErr.message : String(sendErr));
      }
    }
    // If we delivered error message — return 200 (user is informed, no point retrying).
    // If we couldn't deliver — return 500 so Telegram retries the update.
    if (errorMessageDelivered) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
