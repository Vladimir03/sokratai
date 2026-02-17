import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getState as getHomeworkState,
  resetState as resetHomeworkState,
  setState as setHomeworkState,
  type HomeworkContext,
  type HomeworkState,
} from "./homework/state_machine.ts";
import {
  ensureSubmissionItemsForTasks,
  formatHomeworkResultsMessage,
  getHomeworkPhotoSaveErrorCode,
  runHomeworkAiCheck,
  saveHomeworkPhotoAnswer,
  saveHomeworkTextAnswer,
} from "./homework/homework_handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_FORMAT_V2 = (Deno.env.get("TELEGRAM_FORMAT_V2") ?? "true").toLowerCase() === "true";
const TELEGRAM_DIALOG_MAX_CHARS = 700;
const TELEGRAM_MESSAGE_MAX_LENGTH = 4000;
const SITE_BASE_URL = "https://sokratai.ru";
const HOMEWORK_TASK_IMAGE_DEFAULT_BUCKET = "homework-task-images";
const HOMEWORK_TASK_IMAGE_FALLBACK_BUCKETS = ["chat-images", "homework-images"];
const HOMEWORK_TASK_IMAGE_CAPTION_LIMIT = 900;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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

interface HomeworkAssignment {
  id: string;
  title: string;
  subject: string;
  deadline: string | null;
}

interface HomeworkTask {
  id: string;
  order_num: number;
  task_text: string;
  task_image_url: string | null;
  max_score: number;
}

interface HomeworkSubmissionItemAnswer {
  student_text: string | null;
  student_image_urls: string[] | null;
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
  default: `🎓 Привет! Я Сократ - твой умный помощник по учёбе!

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

  header_try: `🎓 Привет! Я Сократ - твой ИИ-помощник по математике, физике и информатике!

Помогаю школьникам понимать сложные темы и готовиться к экзаменам.

Попробуй бесплатно 7 дней! 🚀

Чтобы я мог лучше тебе помогать, ответь на 3 коротких вопроса 👇`,

  plan_free: `🎓 Привет! Я Сократ!
👋 Отлично, что решил попробовать

В бесплатном тарифе у тебя:
✅ 10 сообщений в день
✅ Решение задач с объяснениями
✅ Работа на всех устройствах

Давай познакомимся! Ответь на 3 вопроса, чтобы я понял, как тебе лучше помочь 👇`,

  plan_premium: `🎓 Привет! Я Сократ!
🚀 Супер выбор. Популярный тариф - это максимум возможностей!

Что ты получаешь за 699₽/месяц:
♾️ Неограниченные сообщения
🎯 Персональный план подготовки
📊 Отслеживание прогресса

Но сначала - 7 дней бесплатно! 💪

Ответь на 3 вопроса, чтобы я подстроился под тебя 👇`,

  plan_pro: `🎓 Привет! Я Сократ!
🎯 Вау, ты нацелен на максимальный результат!

Тариф "ИИ + Репетитор" включает:
👨‍🏫 1 час с живым репетитором в неделю
🤖 Безлимитный ИИ-помощник 24/7

Начнем с ИИ-помощника (7 дней бесплатно).
Репетитора подключим после оплаты.

Сначала давай познакомимся! Ответь на 3 вопроса для персонализации 👇`,

  parent_trial: `Здравствуйте! Я Сократ - безопасный ИИ-помощник для подготовки к ЕГЭ.

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

// ID группы для просмотра статистики
const ADMIN_STATS_CHAT_ID = -5270269461;

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
    { command: "homework", description: "Режим домашки" },
    { command: "cancel", description: "Отмена текущего режима" },
    { command: "status", description: "Статус подписки" },
    { command: "help", description: "Справка" }
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

Я — AI-помощник Сократ. Помогу разобраться с любой задачей! 🚀`;

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

async function handleHomeworkCancelFlow(
  telegramUserId: number,
  userId?: string | null,
): Promise<void> {
  await updatePracticeState(telegramUserId, null);
  await updateDiagnosticState(telegramUserId, null);

  if (userId) {
    await resetHomeworkState(userId);
  }

  await sendTelegramMessage(
    telegramUserId,
    `✅ Текущий режим сброшен.

Ты снова в обычном режиме чата с Сократом.`,
  );
}

// ============= HOMEWORK STATE MACHINE HELPERS =============

async function getHomeworkStateSafe(
  userId: string,
): Promise<{ state: HomeworkState; context: HomeworkContext }> {
  try {
    return await getHomeworkState(userId);
  } catch (error) {
    console.error("Failed to read homework state, fallback to IDLE:", { userId, error });
    return { state: "IDLE", context: {} };
  }
}

function normalizeHomeworkContext(context: HomeworkContext): HomeworkContext {
  const taskIds = Array.isArray(context.task_ids) ? context.task_ids : [];
  const images = Array.isArray(context.images) ? context.images : [];
  const answers = context.answers_by_task && typeof context.answers_by_task === "object"
    ? context.answers_by_task
    : {};

  return {
    assignment_id: context.assignment_id,
    submission_id: context.submission_id,
    task_index: typeof context.task_index === "number" && context.task_index > 0 ? context.task_index : 1,
    total_tasks: typeof context.total_tasks === "number" ? context.total_tasks : taskIds.length,
    task_ids: taskIds,
    text: typeof context.text === "string" ? context.text : "",
    images,
    answers_by_task: answers,
  };
}

function getCurrentHomeworkTaskId(context: HomeworkContext): string | null {
  const normalized = normalizeHomeworkContext(context);
  const index = (normalized.task_index ?? 1) - 1;
  return normalized.task_ids?.[index] ?? null;
}

async function getActiveHomeworkAssignmentsForStudent(studentId: string): Promise<HomeworkAssignment[]> {
  const { data: links, error: linksError } = await supabase
    .from("homework_tutor_student_assignments")
    .select("assignment_id")
    .eq("student_id", studentId);

  if (linksError) {
    console.error("Failed to fetch homework assignment links:", linksError);
    throw new Error("Failed to fetch homework links");
  }

  const assignmentIds = [...new Set((links ?? []).map((row: any) => row.assignment_id).filter(Boolean))];
  if (assignmentIds.length === 0) {
    return [];
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from("homework_tutor_assignments")
    .select("id, title, subject, deadline")
    .in("id", assignmentIds)
    .eq("status", "active")
    .order("deadline", { ascending: true, nullsFirst: false });

  if (assignmentsError) {
    console.error("Failed to fetch active assignments:", assignmentsError);
    throw new Error("Failed to fetch active assignments");
  }

  return (assignments ?? []) as HomeworkAssignment[];
}

async function getHomeworkAssignmentVisibilityStatsForStudent(studentId: string): Promise<{
  assignedLinksCount: number;
  activeAssignmentsCount: number;
  draftAssignmentsCount: number;
}> {
  const { data: links, error: linksError } = await supabase
    .from("homework_tutor_student_assignments")
    .select("assignment_id")
    .eq("student_id", studentId);

  if (linksError) {
    console.error("Failed to fetch assignment visibility links:", { studentId, linksError });
    throw new Error("Failed to fetch assignment visibility links");
  }

  const assignmentIds = [...new Set((links ?? []).map((row: any) => row.assignment_id).filter(Boolean))];
  if (assignmentIds.length === 0) {
    return {
      assignedLinksCount: 0,
      activeAssignmentsCount: 0,
      draftAssignmentsCount: 0,
    };
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from("homework_tutor_assignments")
    .select("id, status")
    .in("id", assignmentIds);

  if (assignmentsError) {
    console.error("Failed to fetch assignment visibility statuses:", { studentId, assignmentsError });
    throw new Error("Failed to fetch assignment visibility statuses");
  }

  const activeAssignmentsCount = (assignments ?? []).filter((row: any) => row.status === "active").length;
  const draftAssignmentsCount = (assignments ?? []).filter((row: any) => row.status === "draft").length;

  return {
    assignedLinksCount: assignmentIds.length,
    activeAssignmentsCount,
    draftAssignmentsCount,
  };
}

async function getHomeworkTasksForAssignment(assignmentId: string): Promise<HomeworkTask[]> {
  const { data, error } = await supabase
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, max_score")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  if (error) {
    console.error("Failed to fetch homework tasks:", { assignmentId, error });
    throw new Error("Failed to fetch homework tasks");
  }

  return (data ?? []) as HomeworkTask[];
}

async function getHomeworkTaskById(taskId: string, assignmentId: string): Promise<HomeworkTask | null> {
  const { data, error } = await supabase
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, max_score")
    .eq("id", taskId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch homework task by id:", { taskId, assignmentId, error });
    throw new Error("Failed to fetch homework task");
  }

  return (data as HomeworkTask | null) ?? null;
}

async function getHomeworkSubmissionItemAnswer(
  submissionId: string,
  taskId: string,
): Promise<HomeworkSubmissionItemAnswer | null> {
  const { data, error } = await supabase
    .from("homework_tutor_submission_items")
    .select("student_text, student_image_urls")
    .eq("submission_id", submissionId)
    .eq("task_id", taskId)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch homework submission item answer:", { submissionId, taskId, error });
    throw new Error("Failed to fetch homework submission item answer");
  }

  return (data as HomeworkSubmissionItemAnswer | null) ?? null;
}

function hasHomeworkAnswer(answer: HomeworkSubmissionItemAnswer | null): boolean {
  if (!answer) return false;
  const hasText = typeof answer.student_text === "string" && answer.student_text.trim().length > 0;
  const hasImages = Array.isArray(answer.student_image_urls) && answer.student_image_urls.length > 0;
  return hasText || hasImages;
}

async function getLatestHomeworkSubmissionForStudent(studentId: string): Promise<{
  id: string;
  status: string;
  submitted_at: string | null;
} | null> {
  const { data, error } = await supabase
    .from("homework_tutor_submissions")
    .select("id, status, submitted_at")
    .eq("student_id", studentId)
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (error) {
    console.error("Failed to fetch latest homework submission for student:", { studentId, error });
    throw new Error("Failed to fetch latest homework submission");
  }

  const row = (data ?? [])[0];
  return row
    ? {
      id: row.id as string,
      status: row.status as string,
      submitted_at: (row.submitted_at as string | null) ?? null,
    }
    : null;
}

async function runHomeworkAiCheckAndSendResult(
  telegramUserId: number,
  userId: string,
  submissionId: string,
): Promise<void> {
  const summary = await runHomeworkAiCheck(submissionId);

  const { data: updatedSubmission, error: updateError } = await supabase
    .from("homework_tutor_submissions")
    .update({
      status: "ai_checked",
      total_score: summary.total_score,
      total_max_score: summary.total_max_score,
    })
    .eq("id", submissionId)
    .eq("student_id", userId)
    .in("status", ["submitted", "ai_checked"])
    .select("status")
    .maybeSingle();

  if (updateError) {
    throw new Error(`Failed to update submission after AI check: ${updateError.message}`);
  }

  if (!updatedSubmission) {
    const { data: existingSubmission, error: existingError } = await supabase
      .from("homework_tutor_submissions")
      .select("status")
      .eq("id", submissionId)
      .eq("student_id", userId)
      .maybeSingle();

    if (existingError || !existingSubmission) {
      throw new Error(`Failed to verify submission status after AI check: ${existingError?.message ?? "not found"}`);
    }

    const status = existingSubmission.status as string;
    if (status === "tutor_reviewed") {
      await sendTelegramMessage(
        telegramUserId,
        "ℹ️ Домашка уже проверена репетитором. Повторная авто-проверка не требуется.",
      );
      return;
    }
  }

  try {
    await notifyTutorOnSubmission(submissionId);
  } catch (notifyErr) {
    console.error("homework_tutor_notify_after_ai_check_failed", {
      submission_id: submissionId,
      error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
    });
  }

  await sendTelegramMessage(
    telegramUserId,
    formatHomeworkResultsMessage(summary),
    { reply_markup: createHomeworkReviewKeyboard(submissionId) },
  );
}

async function notifyTutorOnSubmission(submissionId: string): Promise<void> {
  console.log("homework_tutor_notify_start", { submission_id: submissionId });

  try {
    const { data: submission, error: subErr } = await supabase
      .from("homework_tutor_submissions")
      .select("id, assignment_id, student_id, status, total_score, total_max_score")
      .eq("id", submissionId)
      .maybeSingle();

    if (subErr || !submission) {
      console.error("homework_tutor_notify_error", {
        submission_id: submissionId,
        reason: "submission_not_found",
        error: subErr?.message,
      });
      return;
    }

    const status = submission.status as string;
    if (status !== "ai_checked" && status !== "tutor_reviewed") {
      console.log("homework_tutor_notify_skipped", {
        submission_id: submissionId,
        reason: "status_not_checked",
        status,
      });
      return;
    }

    const { data: assignment, error: assErr } = await supabase
      .from("homework_tutor_assignments")
      .select("id, title, tutor_id")
      .eq("id", submission.assignment_id)
      .maybeSingle();

    if (assErr || !assignment) {
      console.error("homework_tutor_notify_error", {
        submission_id: submissionId,
        reason: "assignment_not_found",
        error: assErr?.message,
      });
      return;
    }

    const tutorUserId = assignment.tutor_id as string;

    let tutorChatId: number | null = null;

    const { data: tutorRow } = await supabase
      .from("tutors")
      .select("telegram_id")
      .eq("user_id", tutorUserId)
      .maybeSingle();

    if (tutorRow?.telegram_id) {
      const parsed = parseInt(String(tutorRow.telegram_id), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        tutorChatId = parsed;
      }
    }

    if (!tutorChatId) {
      const { data: sessionRow } = await supabase
        .from("telegram_sessions")
        .select("telegram_user_id")
        .eq("user_id", tutorUserId)
        .maybeSingle();

      if (sessionRow?.telegram_user_id) {
        const parsed = typeof sessionRow.telegram_user_id === "number"
          ? sessionRow.telegram_user_id
          : parseInt(String(sessionRow.telegram_user_id), 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          tutorChatId = parsed;
        }
      }
    }

    if (!tutorChatId) {
      console.log("homework_tutor_notify_skipped_no_chat_id", {
        submission_id: submissionId,
        tutor_user_id: tutorUserId,
      });
      return;
    }

    const { data: studentProfile } = await supabase
      .from("profiles")
      .select("username, telegram_username")
      .eq("id", submission.student_id)
      .maybeSingle();

    const studentName = studentProfile?.username
      || (studentProfile?.telegram_username ? `@${studentProfile.telegram_username}` : null)
      || "Ученик";

    const totalScore = (submission.total_score as number) ?? 0;
    const totalMaxScore = (submission.total_max_score as number) ?? 0;
    const percent = totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0;

    const { data: submissionItems } = await supabase
      .from("homework_tutor_submission_items")
      .select("ai_is_correct, ai_error_type")
      .eq("submission_id", submissionId);

    const items = (submissionItems ?? []) as Array<{ ai_is_correct: boolean | null; ai_error_type: string | null }>;
    let nOk = 0;
    let nBad = 0;
    const errorCounts: Record<string, number> = {};
    let hasIncompleteContext = false;

    for (const it of items) {
      if (it.ai_is_correct === true) {
        nOk++;
      } else {
        nBad++;
      }
      if (it.ai_error_type && it.ai_error_type !== "correct") {
        errorCounts[it.ai_error_type] = (errorCounts[it.ai_error_type] || 0) + 1;
      }
      if (it.ai_error_type === "incomplete") {
        hasIncompleteContext = true;
      }
    }

    const errorLabels: Record<string, string> = {
      calculation: "Ошибка вычисления",
      concept: "Ошибка в концепции",
      formatting: "Оформление",
      incomplete: "Неполное решение",
      factual_error: "Фактическая ошибка",
      weak_argument: "Слабая аргументация",
      wrong_answer: "Неверный ответ",
      partial: "Частично верно",
    };

    const topErrors = Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const topErrorStr = topErrors.length > 0
      ? topErrors.map(([t, c]) => `${errorLabels[t] ?? t} (${c})`).join(", ")
      : "—";

    const safeTitle = (assignment.title as string).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeName = String(studentName).replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const lines: string[] = [
      `📬 <b>${safeName}</b> сдал «${safeTitle}»`,
      `📊 Итого: <b>${totalScore}/${totalMaxScore}</b> (${percent}%)`,
      `✅ ${nOk} | ❌ ${nBad} | Ошибки: ${topErrorStr}`,
    ];

    if (hasIncompleteContext) {
      lines.push("⚠️ AI: недостаточно контекста по части задач (проверь вручную)");
    }

    const message = lines.join("\n");

    const baseUrl = Deno.env.get("VITE_WEBAPP_URL") || SITE_BASE_URL;
    const deepLink = `${baseUrl}/tutor/homework/${assignment.id}/results?submission=${submissionId}`;

    await sendTelegramMessage(tutorChatId, message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 Открыть submission", url: deepLink }],
        ],
      },
    });

    console.log("homework_tutor_notify_success", {
      submission_id: submissionId,
      tutor_chat_id: tutorChatId,
      student_name: studentName,
    });
  } catch (error) {
    console.error("homework_tutor_notify_error", {
      submission_id: submissionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function verifyHomeworkAssignmentForStudent(
  assignmentId: string,
  studentId: string,
): Promise<HomeworkAssignment | null> {
  const { data: link, error: linkError } = await supabase
    .from("homework_tutor_student_assignments")
    .select("assignment_id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (linkError) {
    console.error("Failed to verify homework assignment link:", { assignmentId, studentId, linkError });
    throw new Error("Failed to verify homework assignment link");
  }

  if (!link) {
    return null;
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from("homework_tutor_assignments")
    .select("id, title, subject, deadline")
    .eq("id", assignmentId)
    .eq("status", "active")
    .maybeSingle();

  if (assignmentError) {
    console.error("Failed to verify active assignment:", { assignmentId, assignmentError });
    throw new Error("Failed to verify active assignment");
  }

  return (assignment as HomeworkAssignment | null) ?? null;
}

async function getOrCreateHomeworkSubmission(
  assignmentId: string,
  studentId: string,
  telegramUserId: number,
): Promise<string> {
  const { data: existing, error: existingError } = await supabase
    .from("homework_tutor_submissions")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (existingError) {
    console.error("Failed to fetch homework submission:", { assignmentId, studentId, existingError });
    throw new Error("Failed to fetch homework submission");
  }

  if (existing?.id) {
    return existing.id as string;
  }

  const { data: created, error: createError } = await supabase
    .from("homework_tutor_submissions")
    .insert({
      assignment_id: assignmentId,
      student_id: studentId,
      telegram_chat_id: telegramUserId,
      status: "in_progress",
    })
    .select("id")
    .single();

  if (!createError && created?.id) {
    return created.id as string;
  }

  if ((createError as any)?.code === "23505") {
    const { data: retried, error: retryError } = await supabase
      .from("homework_tutor_submissions")
      .select("id")
      .eq("assignment_id", assignmentId)
      .eq("student_id", studentId)
      .maybeSingle();

    if (retryError || !retried?.id) {
      console.error("Failed to recover duplicate submission:", { assignmentId, studentId, retryError });
      throw new Error("Failed to recover homework submission");
    }

    return retried.id as string;
  }

  console.error("Failed to create homework submission:", { assignmentId, studentId, createError });
  throw new Error("Failed to create homework submission");
}

function buildHomeworkTaskMessage(
  assignmentTitle: string,
  task: HomeworkTask,
  taskIndex: number,
  totalTasks: number,
) {
  return `📘 <b>${escapeHtml(assignmentTitle)}</b>

🧩 Задача ${taskIndex} из ${totalTasks}
${escapeHtml(task.task_text)}

Отправь ответ текстом или фото (до 4 фото), затем нажми «Далее».
Для выхода из режима: /cancel`;
}

async function createSignedHomeworkTaskImageUrl(
  bucket: string,
  objectPath: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, 3600);
  if (error || !data?.signedUrl) {
    return null;
  }
  return data.signedUrl;
}

async function resolveHomeworkTaskImageUrl(taskImageUrl: string | null): Promise<string | null> {
  if (!taskImageUrl || typeof taskImageUrl !== "string") {
    return null;
  }

  const trimmed = taskImageUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    if (trimmed.includes("/storage/v1/object/public/")) {
      return trimmed;
    }
    if (trimmed.includes("/storage/v1/object/sign/")) {
      return trimmed;
    }
    const privateStorageMatch = trimmed.match(/\/storage\/v1\/object\/([^/]+)\/([^?]+)/);
    if (privateStorageMatch) {
      const visibility = privateStorageMatch[1];
      const rawPath = privateStorageMatch[2];
      if (visibility !== "public" && visibility !== "sign") {
        const slashIdx = rawPath.indexOf("/");
        if (slashIdx > 0 && slashIdx < rawPath.length - 1) {
          const bucket = rawPath.slice(0, slashIdx);
          const objectPath = rawPath.slice(slashIdx + 1);
          const signedUrl = await createSignedHomeworkTaskImageUrl(bucket, objectPath);
          if (signedUrl) return signedUrl;
        }
      }
    }
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    return `${SITE_BASE_URL}${trimmed}`;
  }

  if (trimmed.startsWith("storage://")) {
    const raw = trimmed.slice("storage://".length);
    const slashIdx = raw.indexOf("/");
    if (slashIdx > 0 && slashIdx < raw.length - 1) {
      const bucket = raw.slice(0, slashIdx);
      const objectPath = raw.slice(slashIdx + 1).replace(/^\/+/, "");
      if (bucket && objectPath) {
        return await createSignedHomeworkTaskImageUrl(bucket, objectPath);
      }
    }
    return null;
  }

  const normalizedPath = trimmed.replace(/^\/+/, "");
  if (!normalizedPath) {
    return null;
  }

  const pathParts = normalizedPath.split("/");
  if (pathParts.length > 1) {
    const possibleBucket = pathParts[0];
    if (
      possibleBucket === HOMEWORK_TASK_IMAGE_DEFAULT_BUCKET ||
      HOMEWORK_TASK_IMAGE_FALLBACK_BUCKETS.includes(possibleBucket)
    ) {
      const objectPath = pathParts.slice(1).join("/");
      const signedUrl = await createSignedHomeworkTaskImageUrl(possibleBucket, objectPath);
      if (signedUrl) return signedUrl;
    }
  }

  const candidateBuckets = [HOMEWORK_TASK_IMAGE_DEFAULT_BUCKET, ...HOMEWORK_TASK_IMAGE_FALLBACK_BUCKETS];
  for (const bucket of candidateBuckets) {
    const signedUrl = await createSignedHomeworkTaskImageUrl(bucket, normalizedPath);
    if (signedUrl) return signedUrl;
  }

  return null;
}

async function sendHomeworkTaskStep(
  telegramUserId: number,
  assignmentTitle: string,
  task: HomeworkTask,
  taskIndex: number,
  totalTasks: number,
) {
  const taskMessage = buildHomeworkTaskMessage(assignmentTitle, task, taskIndex, totalTasks);
  const keyboard = createHomeworkTaskKeyboard(false);
  const taskImageUrl = await resolveHomeworkTaskImageUrl(task.task_image_url);

  if (!taskImageUrl) {
    await sendTelegramMessage(telegramUserId, taskMessage, { reply_markup: keyboard });
    return;
  }

  if (taskMessage.length <= HOMEWORK_TASK_IMAGE_CAPTION_LIMIT) {
    try {
      await sendTelegramPhoto(telegramUserId, taskImageUrl, taskMessage, { reply_markup: keyboard });
      return;
    } catch (error) {
      console.error("homework_task_send_photo_failed", {
        task_id: task.id,
        task_index: taskIndex,
        error: error instanceof Error ? error.message : String(error),
      });
      await sendTelegramMessage(
        telegramUserId,
        "⚠️ Фото к задаче временно недоступно. Показываю условие текстом.",
      );
      await sendTelegramMessage(telegramUserId, taskMessage, { reply_markup: keyboard });
      return;
    }
  }

  try {
    await sendTelegramPhoto(telegramUserId, taskImageUrl, "📎 Фото к задаче");
  } catch (error) {
    console.error("homework_task_send_photo_failed", {
      task_id: task.id,
      task_index: taskIndex,
      error: error instanceof Error ? error.message : String(error),
    });
    await sendTelegramMessage(
      telegramUserId,
      "⚠️ Фото к задаче временно недоступно. Показываю условие текстом.",
    );
  }

  await sendTelegramMessage(telegramUserId, taskMessage, { reply_markup: keyboard });
}

async function handleHomeworkCommand(telegramUserId: number, userId: string) {
  try {
    await updatePracticeState(telegramUserId, null);
    await updateDiagnosticState(telegramUserId, null);
    await setHomeworkState(userId, "HW_SELECTING", {});

    const assignments = await getActiveHomeworkAssignmentsForStudent(userId);
    const visibilityStats = await getHomeworkAssignmentVisibilityStatsForStudent(userId);

    console.log("homework_visibility_diagnostics", {
      student_id: userId,
      assigned_links_count: visibilityStats.assignedLinksCount,
      active_assignments_count: visibilityStats.activeAssignmentsCount,
      draft_assignments_count: visibilityStats.draftAssignmentsCount,
    });

    if (assignments.length === 0) {
      if (
        visibilityStats.assignedLinksCount > 0 &&
        visibilityStats.draftAssignmentsCount > 0
      ) {
        await sendTelegramMessage(
          telegramUserId,
          `📚 <b>Режим «Домашка»</b>

ДЗ назначены, но ещё не активированы репетитором.
Попроси репетитора перевести задание в активный статус.

Для выхода в обычный чат: /cancel`,
        );
        return;
      }

      await sendTelegramMessage(
        telegramUserId,
        `📚 <b>Режим «Домашка»</b>

Сейчас нет активных назначенных домашних заданий.
Когда репетитор назначит ДЗ, снова используй /homework.

Для выхода в обычный чат: /cancel`,
      );
      return;
    }

    await sendTelegramMessage(
      telegramUserId,
      `📚 <b>Режим «Домашка»</b>

Выбери активное домашнее задание:`,
      { reply_markup: createHomeworkAssignmentsKeyboard(assignments) },
    );
  } catch (error) {
    console.error("handleHomeworkCommand error:", error);
    await sendTelegramMessage(telegramUserId, "❌ Не удалось открыть режим домашки. Попробуй ещё раз.");
  }
}

async function handleHomeworkStartCallback(
  telegramUserId: number,
  userId: string,
  assignmentId: string,
) {
  const assignment = await verifyHomeworkAssignmentForStudent(assignmentId, userId);
  if (!assignment) {
    await sendTelegramMessage(
      telegramUserId,
      "❌ Эта домашка недоступна. Нажми /homework, чтобы загрузить актуальный список.",
    );
    return;
  }

  const tasks = await getHomeworkTasksForAssignment(assignment.id);
  if (tasks.length === 0) {
    await sendTelegramMessage(
      telegramUserId,
      "❌ В этой домашке пока нет задач. Обратись к репетитору.",
    );
    return;
  }

  const submissionId = await getOrCreateHomeworkSubmission(assignment.id, userId, telegramUserId);
  const taskIds = tasks.map((task) => task.id);
  await ensureSubmissionItemsForTasks(submissionId, taskIds);

  const initialContext: HomeworkContext = {
    assignment_id: assignment.id,
    submission_id: submissionId,
    task_index: 1,
    total_tasks: tasks.length,
    task_ids: taskIds,
    text: "",
    images: [],
    answers_by_task: {},
  };

  await setHomeworkState(userId, "HW_SUBMITTING", initialContext);
  await sendHomeworkTaskStep(
    telegramUserId,
    assignment.title,
    tasks[0],
    1,
    tasks.length,
  );
}

async function handleHomeworkNextCallback(telegramUserId: number, userId: string) {
  const stateData = await getHomeworkStateSafe(userId);
  if (stateData.state !== "HW_SUBMITTING") {
    await sendTelegramMessage(
      telegramUserId,
      "ℹ️ Сейчас ты не на шаге отправки ответа. Нажми /homework, чтобы начать заново.",
    );
    return;
  }

  const context = normalizeHomeworkContext(stateData.context);
  const assignmentId = context.assignment_id;
  const submissionId = context.submission_id;
  const taskIds = context.task_ids ?? [];
  const totalTasks = context.total_tasks ?? taskIds.length;
  const currentTaskIndex = context.task_index ?? 1;
  const currentTaskId = getCurrentHomeworkTaskId(context);

  if (!assignmentId || !submissionId || !currentTaskId || taskIds.length === 0 || totalTasks === 0) {
    console.error("Invalid homework context for hw_next:", context);
    await resetHomeworkState(userId);
    await sendTelegramMessage(telegramUserId, "❌ Состояние домашки повреждено. Нажми /homework и начни заново.");
    return;
  }

  const currentAnswer = await getHomeworkSubmissionItemAnswer(submissionId, currentTaskId);
  if (!hasHomeworkAnswer(currentAnswer)) {
    await sendTelegramMessage(
      telegramUserId,
      "📝 Сначала пришли текст или фото ответа на текущую задачу, затем нажми «Далее».",
      { reply_markup: createHomeworkTaskKeyboard(false) },
    );
    return;
  }

  const persistedText = (currentAnswer?.student_text ?? "").trim();
  const persistedImages = Array.isArray(currentAnswer?.student_image_urls)
    ? currentAnswer!.student_image_urls.filter((value): value is string => typeof value === "string")
    : [];

  const answersByTask = { ...(context.answers_by_task ?? {}) };
  answersByTask[currentTaskId] = {
    text: persistedText,
    images: [...persistedImages],
  };

  if (currentTaskIndex < totalTasks) {
    const nextTaskIndex = currentTaskIndex + 1;
    const nextTaskId = taskIds[nextTaskIndex - 1];
    if (!nextTaskId) {
      console.error("Next task id missing in context:", context);
      await resetHomeworkState(userId);
      await sendTelegramMessage(telegramUserId, "❌ Не удалось перейти к следующей задаче. Нажми /homework.");
      return;
    }

    const nextTask = await getHomeworkTaskById(nextTaskId, assignmentId);
    if (!nextTask) {
      await resetHomeworkState(userId);
      await sendTelegramMessage(telegramUserId, "❌ Следующая задача не найдена. Нажми /homework.");
      return;
    }

    const { data: assignment } = await supabase
      .from("homework_tutor_assignments")
      .select("title")
      .eq("id", assignmentId)
      .maybeSingle();

    const nextContext: HomeworkContext = {
      ...context,
      task_index: nextTaskIndex,
      text: "",
      images: [],
      answers_by_task: answersByTask,
    };

    await setHomeworkState(userId, "HW_SUBMITTING", nextContext);
    await sendHomeworkTaskStep(
      telegramUserId,
      assignment?.title ?? "Домашка",
      nextTask,
      nextTaskIndex,
      totalTasks,
    );
    return;
  }

  const confirmContext: HomeworkContext = {
    ...context,
    text: "",
    images: [],
    answers_by_task: answersByTask,
  };
  await setHomeworkState(userId, "HW_CONFIRMING", confirmContext);

  const answeredCount = Object.keys(answersByTask).length;
  await sendTelegramMessage(
    telegramUserId,
    `✅ Ответы по всем задачам собраны (${answeredCount}/${totalTasks}).

Нажми кнопку ниже, чтобы отправить домашку на проверку.`,
    { reply_markup: createHomeworkSubmitKeyboard() },
  );
}

async function handleHomeworkSubmitCallback(telegramUserId: number, userId: string) {
  const stateData = await getHomeworkStateSafe(userId);
  if (stateData.state !== "HW_CONFIRMING") {
    if (stateData.state === "IDLE") {
      try {
        const latestSubmission = await getLatestHomeworkSubmissionForStudent(userId);
        if (!latestSubmission) {
          await sendTelegramMessage(
            telegramUserId,
            "ℹ️ Сначала заверши ответы по задачам. Нажми /homework, чтобы продолжить.",
          );
          return;
        }

        if (latestSubmission.status === "submitted") {
          await sendTelegramMessage(
            telegramUserId,
            "⏳ Пытаюсь завершить AI-проверку последней отправленной домашки...",
          );
          try {
            await runHomeworkAiCheckAndSendResult(telegramUserId, userId, latestSubmission.id);
          } catch (error) {
            console.error("Retry AI check failed for submitted homework:", { userId, latestSubmission, error });
            await sendTelegramMessage(
              telegramUserId,
              "⚠️ Домашка отправлена, но сейчас не удалось выполнить AI-проверку. Попробуй позже.",
            );
          }
          return;
        }

        if (["ai_checked", "tutor_reviewed"].includes(latestSubmission.status)) {
          await sendTelegramMessage(
            telegramUserId,
            "ℹ️ Последняя домашка уже проверена. Нажми /homework, чтобы отправить новую.",
          );
          return;
        }
      } catch (error) {
        console.error("Failed to process homework submit retry:", { userId, error });
      }
    }

    await sendTelegramMessage(
      telegramUserId,
      "ℹ️ Сначала заверши ответы по задачам. Нажми /homework, чтобы продолжить.",
    );
    return;
  }

  const context = normalizeHomeworkContext(stateData.context);
  if (!context.submission_id || !context.assignment_id) {
    console.error("Invalid homework context for hw_submit:", context);
    await resetHomeworkState(userId);
    await sendTelegramMessage(telegramUserId, "❌ Не удалось отправить домашку. Нажми /homework и начни заново.");
    return;
  }

  try {
    const nowIso = new Date().toISOString();
    const { data: updatedRow, error: updateError } = await supabase
      .from("homework_tutor_submissions")
      .update({
        status: "submitted",
        submitted_at: nowIso,
      })
      .eq("id", context.submission_id)
      .eq("student_id", userId)
      .eq("status", "in_progress")
      .select("id, status")
      .maybeSingle();

    if (updateError) {
      console.error("Failed to submit homework submission:", updateError);
      await sendTelegramMessage(telegramUserId, "❌ Ошибка при отправке домашки. Попробуй ещё раз.");
      return;
    }

    let status = (updatedRow?.status as string | undefined) ?? "submitted";
    if (!updatedRow) {
      const { data: existingSubmission, error: existingError } = await supabase
        .from("homework_tutor_submissions")
        .select("status")
        .eq("id", context.submission_id)
        .eq("student_id", userId)
        .maybeSingle();

      if (existingError || !existingSubmission) {
        console.error("Failed to verify submission after empty update:", { existingError, context });
        await sendTelegramMessage(telegramUserId, "❌ Не удалось подтвердить отправку. Попробуй позже.");
        return;
      }

      status = existingSubmission.status as string;
      if (!["submitted", "ai_checked", "tutor_reviewed"].includes(status)) {
        await sendTelegramMessage(
          telegramUserId,
          "❌ Домашка ещё не готова к отправке. Проверь ответы и повтори попытку.",
        );
        return;
      }
    }

    if (status === "submitted") {
      await sendTelegramMessage(
        telegramUserId,
        "⏳ Домашка отправлена. Запускаю AI-проверку, это может занять до минуты...",
      );
      try {
        await runHomeworkAiCheckAndSendResult(telegramUserId, userId, context.submission_id);
      } catch (error) {
        console.error("Failed to run AI check for submitted homework:", {
          userId,
          submissionId: context.submission_id,
          error,
        });
        await sendTelegramMessage(
          telegramUserId,
          "⚠️ Домашка отправлена, но не удалось выполнить AI-проверку. Попробуй позже.",
        );
      }
      return;
    }

    await sendTelegramMessage(
      telegramUserId,
      "ℹ️ Домашка уже проверена. Нажми /homework, чтобы отправить новую.",
    );
  } finally {
    await resetHomeworkState(userId);
  }
}

async function handleHomeworkCallback(
  telegramUserId: number,
  userId: string | null | undefined,
  data: string,
) {
  if (!userId) {
    await sendTelegramMessage(telegramUserId, "❌ Сначала нажми /start, чтобы подготовить аккаунт.");
    return;
  }

  try {
    if (data === "hw_photo_help") {
      await sendTelegramMessage(
        telegramUserId,
        `📷 <b>Как отправить фото ответа</b>

1) Сделай чёткое фото страницы.
2) Убедись, что текст и формулы читаются.
3) Отправь фото в чат (до 4 фото на задачу).
4) После этого нажми «Далее».

Для выхода из режима домашки: /cancel`,
      );
      return;
    }

    if (data === "hw_cancel") {
      await handleHomeworkCancelFlow(telegramUserId, userId);
      return;
    }

    if (data.startsWith("hw_review:")) {
      await sendTelegramMessage(
        telegramUserId,
        "🧠 Режим разбора ошибок будет доступен в Sprint 3. Пока можно отправить новую домашку через /homework.",
      );
      return;
    }

    if (data.startsWith("hw_start:")) {
      const assignmentId = data.split(":")[1];
      if (!assignmentId) {
        await sendTelegramMessage(telegramUserId, "❌ Некорректная команда выбора домашки.");
        return;
      }
      await handleHomeworkStartCallback(telegramUserId, userId, assignmentId);
      return;
    }

    if (data === "hw_next") {
      await handleHomeworkNextCallback(telegramUserId, userId);
      return;
    }

    if (data === "hw_submit") {
      await handleHomeworkSubmitCallback(telegramUserId, userId);
      return;
    }

    await sendTelegramMessage(telegramUserId, "ℹ️ Неизвестная команда домашки. Нажми /homework.");
  } catch (error) {
    console.error("handleHomeworkCallback error:", { data, userId, error });
    await sendTelegramMessage(telegramUserId, "❌ Ошибка в режиме домашки. Нажми /homework и попробуй снова.");
  }
}

async function handleHomeworkTextInput(
  telegramUserId: number,
  userId: string,
  text: string,
  stateData: { state: HomeworkState; context: HomeworkContext },
) {
  if (stateData.state === "HW_SUBMITTING") {
    const value = text.trim();
    if (!value) {
      await sendTelegramMessage(telegramUserId, "✍️ Пустой ответ не сохранён. Отправь текст или фото.");
      return;
    }

    const context = normalizeHomeworkContext(stateData.context);
    const submissionId = context.submission_id;
    const currentTaskId = getCurrentHomeworkTaskId(context);
    if (!submissionId || !currentTaskId) {
      console.error("Invalid homework context for text answer:", context);
      await resetHomeworkState(userId);
      await sendTelegramMessage(telegramUserId, "❌ Не удалось сохранить ответ. Нажми /homework и начни заново.");
      return;
    }

    try {
      await saveHomeworkTextAnswer(submissionId, currentTaskId, value);

      await setHomeworkState(userId, "HW_SUBMITTING", {
        ...context,
        text: value,
      });

      await sendTelegramMessage(
        telegramUserId,
        "✅ Текст ответа сохранён. Если нужно, добавь фото и нажми «Далее».",
        { reply_markup: createHomeworkTaskKeyboard(true) },
      );
    } catch (error) {
      console.error("Failed to save homework text answer:", {
        userId,
        submissionId,
        currentTaskId,
        error,
      });
      await sendTelegramMessage(
        telegramUserId,
        "❌ Не удалось сохранить текст ответа. Попробуй ещё раз.",
        { reply_markup: createHomeworkTaskKeyboard(false) },
      );
    }
    return;
  }

  if (stateData.state === "HW_CONFIRMING") {
    await sendTelegramMessage(
      telegramUserId,
      "ℹ️ Все ответы уже собраны. Нажми «Отправить на проверку» или /cancel.",
      { reply_markup: createHomeworkSubmitKeyboard() },
    );
    return;
  }

  if (stateData.state === "HW_SELECTING") {
    await sendTelegramMessage(
      telegramUserId,
      "ℹ️ Сначала выбери домашку кнопкой из списка (или снова нажми /homework).",
    );
    return;
  }

  await sendTelegramMessage(telegramUserId, "ℹ️ Домашка в этом состоянии не принимает текст. Нажми /cancel.");
}

async function handleHomeworkPhotoInput(
  telegramUserId: number,
  userId: string,
  photo: any,
  caption: string | undefined,
  stateData: { state: HomeworkState; context: HomeworkContext },
) {
  if (stateData.state !== "HW_SUBMITTING") {
    await sendTelegramMessage(
      telegramUserId,
      "ℹ️ Сейчас фото не требуется для домашки. Нажми /cancel или продолжи текущий шаг.",
    );
    return;
  }

  const fileId = photo?.file_id;
  if (!fileId) {
    await sendTelegramMessage(telegramUserId, "❌ Не удалось получить фото. Попробуй ещё раз.");
    return;
  }

  const context = normalizeHomeworkContext(stateData.context);
  const assignmentId = context.assignment_id;
  const submissionId = context.submission_id;
  const currentTaskId = getCurrentHomeworkTaskId(context);
  if (!assignmentId || !submissionId || !currentTaskId) {
    console.error("Invalid homework context for photo answer:", context);
    await resetHomeworkState(userId);
    await sendTelegramMessage(telegramUserId, "❌ Не удалось сохранить фото. Нажми /homework и начни заново.");
    return;
  }

  const captionText = (caption ?? "").trim();
  if (!TELEGRAM_BOT_TOKEN) {
    await sendTelegramMessage(telegramUserId, "❌ Техническая ошибка загрузки фото. Попробуй позже.");
    return;
  }

  console.log("homework_photo_save_start", {
    user_id: userId,
    assignment_id: assignmentId,
    submission_id: submissionId,
    task_id: currentTaskId,
  });

  try {
    const savedPhoto = await saveHomeworkPhotoAnswer({
      assignmentId,
      submissionId,
      taskId: currentTaskId,
      telegramFileId: fileId,
      telegramBotToken: TELEGRAM_BOT_TOKEN,
      studentId: userId,
    });

    if (captionText) {
      await saveHomeworkTextAnswer(submissionId, currentTaskId, captionText);
    }

    await setHomeworkState(userId, "HW_SUBMITTING", {
      ...context,
      images: savedPhoto.image_paths,
      text: captionText || context.text || "",
    });

    console.log("homework_photo_save_success", {
      user_id: userId,
      assignment_id: assignmentId,
      submission_id: submissionId,
      task_id: currentTaskId,
      saved_images_count: savedPhoto.image_paths.length,
    });

    await sendTelegramMessage(
      telegramUserId,
      `✅ Фото сохранено (${savedPhoto.image_paths.length}/4). Если нужно, добавь текст и нажми «Далее».`,
      { reply_markup: createHomeworkTaskKeyboard(true) },
    );
  } catch (error) {
    const errorCode = getHomeworkPhotoSaveErrorCode(error);
    if (errorCode === "MAX_IMAGES_REACHED") {
      await sendTelegramMessage(
        telegramUserId,
        "⚠️ Можно прикрепить максимум 4 фото к одной задаче. Лишние фото не сохранены.",
        { reply_markup: createHomeworkTaskKeyboard(true) },
      );
      return;
    }

    console.error("homework_photo_save_error", {
      user_id: userId,
      assignment_id: assignmentId,
      submission_id: submissionId,
      task_id: currentTaskId,
      error_code: errorCode,
      error: error instanceof Error ? error.message : String(error),
    });

    let userMessage = "❌ Не удалось обработать фото. Попробуй ещё раз.";
    if (errorCode === "HOMEWORK_BUCKET_NOT_FOUND") {
      userMessage = "⚠️ Временная проблема хранилища. Попробуй отправить фото позже.";
    } else if (errorCode === "TELEGRAM_GET_FILE_FAILED" || errorCode === "TELEGRAM_DOWNLOAD_FAILED") {
      userMessage = "⚠️ Не удалось скачать фото из Telegram. Отправь это фото ещё раз.";
    } else if (errorCode === "SUBMISSION_ITEM_UPDATE_FAILED") {
      userMessage = "⚠️ Фото получено, но не сохранилось в ответе. Отправь фото ещё раз.";
    } else if (errorCode === "HOMEWORK_IMAGE_UPLOAD_FAILED") {
      userMessage = "⚠️ Не удалось загрузить фото в хранилище. Попробуй ещё раз чуть позже.";
    }

    await sendTelegramMessage(
      telegramUserId,
      userMessage,
      { reply_markup: createHomeworkTaskKeyboard(false) },
    );
  }
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
        { text: "💬 Спросить Сократа", callback_data: "chat_mode" },
        { text: "📊 Статус", callback_data: "subscription_status" },
      ],
      [
        { text: "📱 Mini App", web_app: { url: `${getWebAppBaseUrl()}/miniapp` } },
        { text: "💳 Premium", url: WEB_PAYMENT_URL },
      ],
    ],
  };
}

function createHomeworkAssignmentsKeyboard(assignments: HomeworkAssignment[]) {
  return {
    inline_keyboard: assignments.map((assignment) => {
      const deadline = assignment.deadline ? ` · до ${formatDate(assignment.deadline)}` : "";
      const rawLabel = `📚 ${assignment.title}${deadline}`;
      const buttonLabel = rawLabel.length > 60 ? `${rawLabel.slice(0, 57)}...` : rawLabel;
      return [
        {
          text: buttonLabel,
          callback_data: `hw_start:${assignment.id}`,
        },
      ];
    }),
  };
}

function createHomeworkTaskKeyboard(hasAnswer: boolean) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "📷 Как отправить фото", callback_data: "hw_photo_help" }],
  ];

  if (hasAnswer) {
    rows.push([{ text: "➡️ Далее", callback_data: "hw_next" }]);
  }

  rows.push([{ text: "❌ Отмена", callback_data: "hw_cancel" }]);
  return { inline_keyboard: rows };
}

function createHomeworkSubmitKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "✅ Отправить на проверку", callback_data: "hw_submit" }],
      [{ text: "❌ Отмена", callback_data: "hw_cancel" }],
    ],
  };
}

function createHomeworkReviewKeyboard(submissionId: string) {
  return {
    inline_keyboard: [[{ text: "🧠 Разобрать ошибки", callback_data: `hw_review:${submissionId}` }]],
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

async function handlePaymentCallback(telegramUserId: number, data: string, messageId?: number) {
  // Parse callback data: payment:status:lesson_id
  const parts = data.split(":");
  if (parts.length !== 3) {
    console.error("Invalid payment callback data:", data);
    return;
  }

  const [, paymentStatus, lessonId] = parts;

  // Get tutor's telegram_id to verify ownership
  const { data: tutor } = await supabase
    .from("tutors")
    .select("id, telegram_id")
    .eq("telegram_id", telegramUserId.toString())
    .single();

  if (!tutor) {
    await sendTelegramMessage(
      telegramUserId,
      "❌ Вы не найдены как репетитор. Свяжите Telegram в настройках."
    );
    return;
  }

  // Update payment status
  const { error } = await supabase.rpc("update_lesson_payment", {
    _lesson_id: lessonId,
    _payment_status: paymentStatus,
    _tutor_telegram_id: telegramUserId.toString(),
  });

  if (error) {
    console.error("Error updating payment status:", error);
    await sendTelegramMessage(telegramUserId, "❌ Ошибка при обновлении статуса оплаты.");
    return;
  }

  // Format response based on status
  let statusText = "";
  let emoji = "";
  switch (paymentStatus) {
    case "paid":
      statusText = "Оплачено";
      emoji = "✅";
      break;
    case "paid_earlier":
      statusText = "Оплачено ранее";
      emoji = "💳";
      break;
    case "pending":
      statusText = "Оплатит позже";
      emoji = "⏳";
      break;
    default:
      statusText = paymentStatus;
      emoji = "📝";
  }

  // Edit the original message to show the result
  if (messageId) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramUserId,
        message_id: messageId,
        text: `${emoji} <b>Статус оплаты обновлён</b>\n\n${statusText}`,
        parse_mode: "HTML",
      }),
    });
  } else {
    await sendTelegramMessage(
      telegramUserId,
      `${emoji} Статус оплаты обновлён: ${statusText}`
    );
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

async function sendTypingLoop(telegramUserId: number, stopSignal: { stop: boolean }) {
  while (!stopSignal.stop) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramUserId, action: "typing" }),
    });
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

  if (responseMode !== "dialog") {
    return blocks;
  }

  const containsLabeledDialog = blocks.some((b) => (b.label || "").toLowerCase() === "идея")
    && blocks.some((b) => (b.label || "").toLowerCase() === "мини-шаг")
    && blocks.some((b) => b.type === "question" || (b.label || "").toLowerCase() === "вопрос");

  if (containsLabeledDialog) {
    return blocks;
  }

  const plainText = blocks
    .map((block) => block.items ? block.items.join(" ") : block.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plainText) {
    return blocks;
  }

  const sentences = plainText.split(/(?<=[.!?])\s+/).filter(Boolean);
  const idea = sentences.slice(0, 2).join(" ").trim() || plainText.slice(0, 180).trim();
  const ministep = sentences.slice(2, 3).join(" ").trim() || "Сделай один вычислительный шаг и проверь знак/единицы.";
  const existingQuestion = sentences.find((s) => s.includes("?"));
  const question = existingQuestion || "Какой следующий шаг ты попробуешь сделать?";

  return [
    { type: "paragraph", label: "Идея", text: idea },
    { type: "paragraph", label: "Мини-шаг", text: ministep },
    { type: "question", label: "Вопрос", text: question.replace(/\?*$/, "?") },
  ];
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
          // Если есть image_path, создаём новый signed URL
          if (msg.image_path) {
            const { data: signedData, error } = await supabase.storage
              .from("chat-images")
              .createSignedUrl(msg.image_path, 3600); // 1 hour для истории
            
            if (!error && signedData) {
              return { ...msg, image_url: signedData.signedUrl };
            }
          }
          return msg;
        })
      );
    }

    // Get chat history - limit to last 20 messages (10 pairs)
    const { data: historyReversed } = await supabase
      .from("chat_messages")
      .select("role, content, image_url, image_path")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(20);

    let history = historyReversed?.reverse() || [];
    
    // Обновить signed URLs для всех изображений в истории
    history = await refreshImageUrls(history);

    // Start typing loop
    const stopTyping = { stop: false };
    const typingPromise = sendTypingLoop(telegramUserId, stopTyping);

    // Call AI chat function with service role authorization
    const chatResponse = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: history || [],
        chatId: chatId,
        userId: userId,
        responseProfile: "telegram_compact",
        responseMode: "dialog",
        maxChars: TELEGRAM_DIALOG_MAX_CHARS,
      }),
    });

    // Stop typing
    stopTyping.stop = true;
    await typingPromise;

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
    console.error("Error handling text message:", error);
    await sendTelegramMessage(telegramUserId, "❌ Произошла ошибка. Попробуй ещё раз.");
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
          // Если есть image_path, создаём новый signed URL
          if (msg.image_path) {
            const { data: signedData, error } = await supabase.storage
              .from("chat-images")
              .createSignedUrl(msg.image_path, 3600); // 1 hour для истории
            
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

    // Get chat history - limit to last 20 messages (10 pairs)
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

    // Обновить signed URLs для всех изображений в истории
    console.log("Step 13.5: Refreshing image URLs...");
    history = await refreshImageUrls(history);
    console.log("Step 13.5: Image URLs refreshed");

    // Start typing loop
    const stopTyping = { stop: false };
    const typingPromise = sendTypingLoop(telegramUserId, stopTyping);

    // Call AI chat function with service role authorization
    console.log("Step 14: Calling AI chat function...");
    const chatResponse = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: history || [],
        chatId: chatId,
        userId: userId,
        responseProfile: "telegram_compact",
        responseMode: "dialog",
        maxChars: TELEGRAM_DIALOG_MAX_CHARS,
      }),
    });

    // Stop typing
    stopTyping.stop = true;
    await typingPromise;

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
    console.error("❌ Error handling photo message:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
    const errorMsg = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(telegramUserId, `❌ Ошибка при обработке фото: ${errorMsg.substring(0, 200)}`);
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

    // Call AI chat function
    const chatResponse = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: history || [],
        chatId: chatId,
        userId: userId,
        responseProfile: "telegram_compact",
        responseMode,
      }),
    });

    // Stop typing
    stopTyping.stop = true;
    await typingPromise;

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

  // ============= HOMEWORK CALLBACKS =============
  if (data.startsWith("hw_")) {
    await handleHomeworkCallback(telegramUserId, userId, data);
    return;
  }

  // ============= PRACTICE CALLBACKS =============
  
  // Main menu
  if (data === "main_menu") {
    await sendTelegramMessage(
      telegramUserId,
      `🎓 <b>Сократ</b> — твой AI-репетитор по математике\n\nВыбери, что хочешь делать:`,
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
      `💬 <b>Режим чата с Сократом</b>

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
Теперь Сократ помогает не только с математикой, но и с:
• Обществознанием и историей
• Биологией и химией
• Русским языком и литературой
• Английским и географией

<b>2. Улучшенные объяснения</b>
• Лучше понимает контекст задачи
• Точнее решает сложные задачи ЕГЭ
• Даёт более структурированные ответы

<b>3. Графики и визуализация</b>
Попроси «построй график y = x² - 4x + 3» — Сократ нарисует его прямо в чате! Работает в веб-версии.

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

    // Handle /homework command
    if (update.message?.text === "/homework") {
      const telegramUserId = update.message.from.id;
      const session = await getOnboardingSession(telegramUserId);

      if (!session?.user_id) {
        await sendTelegramMessage(telegramUserId, "❌ Сначала нажми /start, чтобы подготовить аккаунт.");
      } else {
        await handleHomeworkCommand(telegramUserId, session.user_id);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle /cancel command
    if (update.message?.text === "/cancel") {
      const telegramUserId = update.message.from.id;
      const session = await getOnboardingSession(telegramUserId);
      await handleHomeworkCancelFlow(telegramUserId, session?.user_id ?? null);

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
          `🎓 <b>Сократ</b> — твой AI-репетитор по математике\n\nВыбери, что хочешь делать:`,
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
        `🎓 <b>Сократ — AI-репетитор по математике ЕГЭ</b>

<b>Доступные команды:</b>
/start — начать работу
/menu — главное меню
/practice — тренажёр ЕГЭ
/diagnostic — диагностика уровня
/homework — режим домашки
/cancel — выйти из режима домашки
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
      const session = await getOnboardingSession(telegramUserId);

      if (session?.user_id) {
        const text = update.message.text;

        const homeworkState = await getHomeworkStateSafe(session.user_id);
        if (homeworkState.state !== "IDLE") {
          await handleHomeworkTextInput(telegramUserId, session.user_id, text, homeworkState);
          return new Response(JSON.stringify({ ok: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

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
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle photo messages
    if (update.message?.photo) {
      const telegramUserId = update.message.from.id;
      const session = await getOnboardingSession(telegramUserId);

      if (session?.user_id) {
        const photo = update.message.photo[update.message.photo.length - 1]; // Get largest photo

        const homeworkState = await getHomeworkStateSafe(session.user_id);
        if (homeworkState.state !== "IDLE") {
          await handleHomeworkPhotoInput(
            telegramUserId,
            session.user_id,
            photo,
            update.message.caption,
            homeworkState,
          );
          return new Response(JSON.stringify({ ok: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

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
        }
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
