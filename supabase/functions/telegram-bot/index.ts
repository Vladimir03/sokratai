import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type OnboardingState = 'welcome' | 'waiting_grade' | 'waiting_subject' | 'waiting_goal' | 'completed';

interface OnboardingData {
  grade?: number;
  subject?: string;
  goal?: string;
  utm_source?: string;
  onboarding_message_id?: number;
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

async function sendTelegramMessage(
  chatId: number,
  text: string,
  extraParams?: Record<string, any>
) {
  // Debug logging to see what text is being sent
  console.log('=== SENDING MESSAGE ===');
  console.log('Text length:', text.length);
  console.log('Text preview (first 200 chars):', text.substring(0, 200));
  console.log('Text preview (chars 500-600):', text.substring(500, 600));
  console.log('Full text:', text);
  console.log('======================');

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...extraParams,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Telegram API error:', error);
    console.error('Failed message text:', text);
    throw new Error('Failed to send message');
  }

  return response.json();
}

async function editTelegramMessage(
  chatId: number,
  messageId: number,
  text: string,
  extraParams?: Record<string, any>
) {
  // Debug logging to see what text is being edited
  console.log('=== EDITING MESSAGE ===');
  console.log('Message ID:', messageId);
  console.log('Text length:', text.length);
  console.log('Text preview (first 200 chars):', text.substring(0, 200));
  console.log('Text preview (chars 500-600):', text.substring(500, 600));
  console.log('Full text:', text);
  console.log('======================');

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      ...extraParams,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Telegram API error:', error);
    throw new Error('Failed to edit message');
  }

  return response.json();
}

async function getOrCreateProfile(telegramUserId: number, telegramUsername?: string) {
  // Check if profile exists
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();

  if (existingProfile) {
    return existingProfile;
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
    console.error('Error creating user:', authError);
    throw new Error('Failed to create user');
  }

  // Update profile with telegram data
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .update({
      telegram_user_id: telegramUserId,
      telegram_username: telegramUsername,
      registration_source: 'telegram',
    })
    .eq('id', authData.user.id)
    .select()
    .single();

  if (profileError) {
    console.error('Error updating profile:', profileError);
    throw new Error('Failed to update profile');
  }

  return profile;
}

async function getOnboardingSession(telegramUserId: number) {
  const { data } = await supabase
    .from('telegram_sessions')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();

  return data;
}

async function getUserIdFromTelegram(telegramUserId: number): Promise<string | null> {
  // Try to get user_id from telegram_sessions first
  const session = await getOnboardingSession(telegramUserId);
  if (session?.user_id) {
    return session.user_id;
  }

  // If not in session, get from profiles table
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();

  return profile?.id || null;
}

async function updateOnboardingState(
  telegramUserId: number,
  userId: string,
  state: OnboardingState,
  data?: Partial<OnboardingData>
) {
  const session = await getOnboardingSession(telegramUserId);

  if (session) {
    await supabase
      .from('telegram_sessions')
      .update({
        onboarding_state: state,
        onboarding_data: data ? { ...session.onboarding_data, ...data } : session.onboarding_data,
      })
      .eq('telegram_user_id', telegramUserId);
  } else {
    await supabase
      .from('telegram_sessions')
      .insert({
        telegram_user_id: telegramUserId,
        user_id: userId,
        onboarding_state: state,
        onboarding_data: data || {},
      });
  }
}

async function handleStart(telegramUserId: number, telegramUsername: string | undefined, utmSource: string) {
  console.log('handleStart:', { telegramUserId, utmSource });

  // Get or create profile
  const profile = await getOrCreateProfile(telegramUserId, telegramUsername);

  // Record analytics
  await supabase.from('onboarding_analytics').insert({
    user_id: profile.id,
    source: 'telegram',
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
  const result = await sendTelegramMessage(telegramUserId, '📊 Шаг 1 из 3\n\nВ каком ты классе?', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '9 класс', callback_data: 'grade_9' },
          { text: '10 класс', callback_data: 'grade_10' },
          { text: '11 класс', callback_data: 'grade_11' },
        ],
      ],
    },
  });

  await updateOnboardingState(telegramUserId, userId, 'waiting_grade', { 
    utm_source: utmSource,
    onboarding_message_id: result.result.message_id 
  });
}

async function handleGradeSelection(telegramUserId: number, userId: string, grade: number, messageId?: number) {
  if (messageId) {
    await editTelegramMessage(telegramUserId, messageId, '📊 Шаг 2 из 3\n\nКакой предмет тебе даётся сложнее всего?', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📐 Математика', callback_data: 'subject_math' }],
          [{ text: '⚛️ Физика', callback_data: 'subject_physics' }],
          [{ text: '💻 Информатика', callback_data: 'subject_cs' }],
        ],
      },
    });
  }

  await updateOnboardingState(telegramUserId, userId, 'waiting_subject', { grade });
}

async function handleSubjectSelection(telegramUserId: number, userId: string, subject: string, messageId?: number) {
  if (messageId) {
    await editTelegramMessage(telegramUserId, messageId, '📊 Шаг 3 из 3\n\nДля чего готовишься?', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎯 ЕГЭ', callback_data: 'goal_ege' },
            { text: '📝 ОГЭ', callback_data: 'goal_oge' },
          ],
          [
            { text: '📚 Школьная программа', callback_data: 'goal_school' },
            { text: '🏆 Олимпиада', callback_data: 'goal_olympiad' },
          ],
        ],
      },
    });
  }

  await updateOnboardingState(telegramUserId, userId, 'waiting_goal', { subject });
}

async function completeOnboarding(telegramUserId: number, userId: string, goal: string, messageId?: number) {
  const session = await getOnboardingSession(telegramUserId);
  const data = session?.onboarding_data as OnboardingData;

  // Update profile
  await supabase
    .from('profiles')
    .update({
      grade: data.grade,
      difficult_subject: data.subject,
      learning_goal: goal,
      onboarding_completed: true,
    })
    .eq('telegram_user_id', telegramUserId);

  // Complete analytics
  await supabase
    .from('onboarding_analytics')
    .update({
      completed_at: new Date().toISOString(),
      grade: data.grade,
      subject: data.subject,
      goal: goal,
    })
    .eq('telegram_user_id', telegramUserId)
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1);

  const gradeText = data.grade ? `${data.grade} классе` : '';
  const subjectMap: Record<string, string> = {
    'math': 'математике',
    'physics': 'физике',
    'cs': 'информатике'
  };
  const subjectText = data.subject ? subjectMap[data.subject] || data.subject : 'выбранному предмету';
  const goalMap: Record<string, string> = {
    'ege': 'ЕГЭ',
    'oge': 'ОГЭ',
    'school': 'школьной программе',
    'olympiad': 'олимпиаде'
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
    await editTelegramMessage(
      telegramUserId,
      messageId,
      welcomeMessage,
      { reply_markup: { inline_keyboard: [] } }
    );
  }

  // Save welcome message to chat history for AI context
  try {
    const chatId = await getOrCreateTelegramChat(userId);
    await supabase
      .from('chat_messages')
      .insert({
        chat_id: chatId,
        user_id: userId,
        role: 'assistant',
        content: welcomeMessage,
        input_method: 'system'
      });
  } catch (error) {
    console.error('Error saving onboarding completion message:', error);
  }

  await updateOnboardingState(telegramUserId, userId, 'completed');
}

async function getOrCreateTelegramChat(userId: string) {
  // Get existing general chat for this user
  const { data: existingChat } = await supabase
    .from('chats')
    .select('id')
    .eq('user_id', userId)
    .eq('chat_type', 'general')
    .maybeSingle();

  if (existingChat) {
    return existingChat.id;
  }

  // Create new general chat
  const { data: newChat, error } = await supabase
    .from('chats')
    .insert({
      user_id: userId,
      chat_type: 'general',
      title: 'Telegram чат',
      icon: '💬',
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating chat:', error);
    throw new Error('Failed to create chat');
  }

  return newChat.id;
}

async function parseSSEStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  
  if (!reader) throw new Error('No response body');
  
  let fullContent = '';
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    
    // Обработка построчно
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      
      // Убираем \r если есть
      if (line.endsWith('\r')) line = line.slice(0, -1);
      
      // Пропускаем комментарии и пустые строки
      if (line.startsWith(':') || line.trim() === '') continue;
      
      // Обрабатываем data: строки
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') break;
        
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramUserId, action: 'typing' }),
    });
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

// ============= TELEGRAM FORMATTING UTILITIES =============

// LaTeX to Unicode symbol mappings
const LATEX_TO_UNICODE: Record<string, string> = {
  // Square roots
  '\\sqrt': '√',

  // Superscripts (common)
  '^2': '²',
  '^3': '³',
  '^4': '⁴',
  '^0': '⁰',
  '^1': '¹',
  '^5': '⁵',
  '^6': '⁶',
  '^7': '⁷',
  '^8': '⁸',
  '^9': '⁹',

  // Subscripts (common)
  '_0': '₀',
  '_1': '₁',
  '_2': '₂',
  '_3': '₃',
  '_4': '₄',
  '_5': '₅',
  '_6': '₆',
  '_7': '₇',
  '_8': '₈',
  '_9': '₉',

  // Math operators
  '\\pm': '±',
  '\\mp': '∓',
  '\\times': '×',
  '\\div': '÷',
  '\\cdot': '·',
  '\\approx': '≈',
  '\\neq': '≠',
  '\\ne': '≠',
  '\\leq': '≤',
  '\\le': '≤',
  '\\geq': '≥',
  '\\ge': '≥',
  '\\infty': '∞',
  '\\to': '→',
  '\\rightarrow': '→',
  '\\leftarrow': '←',
  '\\Rightarrow': '⇒',
  '\\Leftarrow': '⇐',
  '\\Leftrightarrow': '⇔',
  '\\in': '∈',
  '\\notin': '∉',
  '\\subset': '⊂',
  '\\supset': '⊃',
  '\\cup': '∪',
  '\\cap': '∩',
  '\\forall': '∀',
  '\\exists': '∃',
  '\\emptyset': '∅',
  '\\nabla': '∇',
  '\\partial': '∂',
  '\\int': '∫',
  '\\sum': '∑',
  '\\prod': '∏',

  // Greek letters (lowercase)
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\epsilon': 'ε',
  '\\varepsilon': 'ε',
  '\\zeta': 'ζ',
  '\\eta': 'η',
  '\\theta': 'θ',
  '\\vartheta': 'θ',
  '\\iota': 'ι',
  '\\kappa': 'κ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\nu': 'ν',
  '\\xi': 'ξ',
  '\\pi': 'π',
  '\\rho': 'ρ',
  '\\sigma': 'σ',
  '\\tau': 'τ',
  '\\upsilon': 'υ',
  '\\phi': 'φ',
  '\\varphi': 'φ',
  '\\chi': 'χ',
  '\\psi': 'ψ',
  '\\omega': 'ω',

  // Greek letters (uppercase)
  '\\Gamma': 'Γ',
  '\\Delta': 'Δ',
  '\\Theta': 'Θ',
  '\\Lambda': 'Λ',
  '\\Xi': 'Ξ',
  '\\Pi': 'Π',
  '\\Sigma': 'Σ',
  '\\Upsilon': 'Υ',
  '\\Phi': 'Φ',
  '\\Psi': 'Ψ',
  '\\Omega': 'Ω',

  // Fractions (common Unicode fractions)
  '\\frac{1}{2}': '½',
  '\\frac{1}{3}': '⅓',
  '\\frac{2}{3}': '⅔',
  '\\frac{1}{4}': '¼',
  '\\frac{3}{4}': '¾',
  '\\frac{1}{5}': '⅕',
  '\\frac{2}{5}': '⅖',
  '\\frac{3}{5}': '⅗',
  '\\frac{4}{5}': '⅘',
  '\\frac{1}{6}': '⅙',
  '\\frac{5}{6}': '⅚',
  '\\frac{1}{8}': '⅛',
  '\\frac{3}{8}': '⅜',
  '\\frac{5}{8}': '⅝',
  '\\frac{7}{8}': '⅞',
};

/**
 * Preprocesses LaTeX: removes delimiters and converts fractions
 */
function preprocessLatex(text: string): string {
  let result = text;

  // Remove display math delimiters $$ ... $$ (non-greedy)
  result = result.replace(/\$\$(.+?)\$\$/gs, '$1');

  // Remove inline math delimiters $ ... $ (non-greedy)
  result = result.replace(/\$([^$]+?)\$/g, '$1');

  // Convert \frac{numerator}{denominator} to (numerator)/(denominator)
  // Handle nested fractions by repeating the replacement
  for (let i = 0; i < 3; i++) {
    result = result.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)');
  }

  // Convert simple fractions without extra parentheses for single chars/numbers
  result = result.replace(/\(([a-zA-Z0-9]+)\)\/\(([a-zA-Z0-9]+)\)/g, (match, num, den) => {
    // Only simplify if both are single characters
    if (num.length === 1 && den.length === 1) {
      return `${num}/${den}`;
    }
    return match;
  });

  // Convert \sqrt{x} to √(x) for complex expressions, √x for simple
  result = result.replace(/\\sqrt\{([^{}]+)\}/g, (_, content) => {
    return content.length === 1 ? `√${content}` : `√(${content})`;
  });

  // Remove curly braces used for grouping (e.g., {x} -> x)
  // But be careful not to remove structural braces
  result = result.replace(/\{([^{}]+)\}/g, '$1');

  // Clean up double spaces
  result = result.replace(/\s+/g, ' ');

  return result;
}

/**
 * Converts LaTeX formulas to Unicode symbols
 */
function convertLatexToUnicode(text: string): string {
  let result = text;

  // Replace LaTeX commands with Unicode symbols
  for (const [latex, unicode] of Object.entries(LATEX_TO_UNICODE)) {
    const escapedLatex = latex.replace(/[\\^{}]/g, '\\$&');
    result = result.replace(new RegExp(escapedLatex, 'g'), unicode);
  }

  return result;
}

/**
 * Escapes HTML special characters to prevent parsing errors
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Converts markdown to Telegram HTML format
 */
function convertMarkdownToTelegramHTML(text: string): string {
  let result = text;

  // Bold: **text** or __text__ → <b>text</b>
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  result = result.replace(/__(.+?)__/g, '<b>$1</b>');

  // Italic: *text* or _text_ → <i>text</i> (but avoid conflicts with bold)
  result = result.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<i>$1</i>');
  result = result.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<i>$1</i>');

  // Code: `text` → <code>text</code>
  result = result.replace(/`(.+?)`/g, '<code>$1</code>');

  // Strikethrough: ~~text~~ → <s>text</s>
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

  return result;
}

/**
 * Main formatter function
 * Converts LaTeX and markdown to Telegram-friendly HTML format
 */
function formatForTelegram(text: string): string {
  // Step 1: Preprocess LaTeX (remove $ delimiters, convert fractions)
  let result = preprocessLatex(text);

  // Step 2: Convert LaTeX commands to Unicode symbols
  result = convertLatexToUnicode(result);

  // Step 3: Escape HTML special characters (< > &) to prevent parsing errors
  result = escapeHtml(result);

  // Step 4: Convert markdown to Telegram HTML
  result = convertMarkdownToTelegramHTML(result);

  return result;
}

/**
 * Generates Telegram inline keyboard JSON for Mini App button
 */
function generateMiniAppButton(solutionId: string): any {
  const WEBAPP_URL = Deno.env.get('VITE_WEBAPP_URL') || 'https://sokratai.lovable.app';
  
  return {
    inline_keyboard: [[{
      text: "📱 Открыть полное решение",
      web_app: {
        url: `${WEBAPP_URL}/miniapp/solution/${solutionId}`
      }
    }]]
  };
}

/**
 * Formats solution for Telegram message
 * Returns shortened version with button to open full solution
 */
function formatSolutionPreview(
  problem: string,
  answer: string,
  solutionId: string
): { text: string; replyMarkup: any } {
  const text = formatForTelegram(`
📝 **Задача:**
${problem}

✅ **Ответ:** ${answer}

👇 Нажми кнопку ниже, чтобы увидеть подробное решение с формулами!
  `.trim());
  
  return {
    text,
    replyMarkup: generateMiniAppButton(solutionId)
  };
}

function splitLongMessage(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const parts: string[] = [];
  let currentPart = '';
  const lines = text.split('\n');

  for (const line of lines) {
    if ((currentPart + line + '\n').length > maxLength) {
      if (currentPart) {
        parts.push(currentPart.trim());
        currentPart = '';
      }
      
      // If single line is too long, split it
      if (line.length > maxLength) {
        let remaining = line;
        while (remaining.length > 0) {
          parts.push(remaining.substring(0, maxLength));
          remaining = remaining.substring(maxLength);
        }
      } else {
        currentPart = line + '\n';
      }
    } else {
      currentPart += line + '\n';
    }
  }

  if (currentPart.trim()) {
    parts.push(currentPart.trim());
  }

  return parts;
}

// Create quick action inline keyboard
function createQuickActionsKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "📋 План решения",
          callback_data: "quick_action:plan"
        }
      ],
      [
        {
          text: "🔍 Объясни подробнее",
          callback_data: "quick_action:explain"
        }
      ],
      [
        {
          text: "✍️ Похожая задача",
          callback_data: "quick_action:similar"
        }
      ]
    ]
  };
}

/**
 * Extracts LaTeX formulas from text
 * Returns array of formulas without delimiters
 */
function extractLatexFormulas(text: string): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const formulas: string[] = [];

  try {
    // Extract display math $$...$$
    const displayMatches = text.matchAll(/\$\$(.+?)\$\$/gs);
    for (const match of displayMatches) {
      formulas.push(match[1].trim());
    }

    // Extract inline math $...$ (avoid already extracted display math)
    let tempText = text.replace(/\$\$(.+?)\$\$/gs, ''); // Remove display math first
    const inlineMatches = tempText.matchAll(/\$([^$\n]+?)\$/g);
    for (const match of inlineMatches) {
      const formula = match[1].trim();
      // Only add if it's substantial (not just a variable)
      if (formula.length > 2 || /[\\{}^_]/.test(formula)) {
        formulas.push(formula);
      }
    }
  } catch (error) {
    console.error('Error extracting LaTeX formulas:', error);
  }

  return formulas;
}

/**
 * Extracts final answer from AI response
 * Looks for common patterns like "Ответ:", "Итого:", etc.
 */
function extractFinalAnswer(aiResponse: string): string | null {
  if (!aiResponse || typeof aiResponse !== 'string') {
    return null;
  }

  try {
    // Common answer patterns in Russian
    const answerPatterns = [
      /(?:Ответ|Итоговый ответ|Финальный ответ|Результат):\s*(.+?)(?:\n\n|\n$|$)/is,
      /(?:Таким образом|Следовательно|Получаем),?\s*(.+?)(?:\n\n|\n$|$)/is,
    ];

    for (const pattern of answerPatterns) {
      const match = aiResponse.match(pattern);
      if (match && match[1]) {
        const answer = match[1].trim();
        // Extract LaTeX from answer if present
        const formulas = extractLatexFormulas(answer);
        return formulas.length > 0 ? formulas[0] : answer;
      }
    }

    // Try to find the last substantial formula as the answer
    const allFormulas = extractLatexFormulas(aiResponse);
    if (allFormulas.length > 0) {
      // Return the last formula (usually the final answer)
      return allFormulas[allFormulas.length - 1];
    }
  } catch (error) {
    console.error('Error extracting final answer:', error);
  }

  return null;
}

/**
 * Parses AI response into structured solution steps
 * Attempts to extract numbered steps, formulas, and final answer
 */
function parseSolutionSteps(aiResponse: string): any[] {
  if (!aiResponse || typeof aiResponse !== 'string') {
    return [{
      number: 1,
      title: "Решение",
      content: "Ответ недоступен",
      formula: null
    }];
  }

  const steps: any[] = [];

  try {
    // Try to find numbered steps (1., 2., etc. or 1), 2), etc. or **1.**, etc.)
    const stepRegex = /(?:^|\n)(?:\*\*)?(\d+)[.):\s](?:\*\*)?\s*([^\n]+)/g;
    let match;
    let stepNumber = 1;

    while ((match = stepRegex.exec(aiResponse)) !== null) {
      const title = match[2].trim();

      // Try to extract content after this step title
      const startPos = match.index + match[0].length;
      const nextMatch = stepRegex.exec(aiResponse);
      const endPos = nextMatch ? nextMatch.index : aiResponse.length;
      stepRegex.lastIndex = nextMatch ? nextMatch.index : aiResponse.length;

      const content = aiResponse.substring(startPos, endPos).trim();

      // Extract LaTeX formulas from this step's content
      const formulas = extractLatexFormulas(content);

      // Remove formulas from content text to avoid duplication in Mini App
      let cleanContent = content;
      formulas.forEach(formula => {
        cleanContent = cleanContent.replace(`$$${formula}$$`, '');
        cleanContent = cleanContent.replace(`$${formula}$`, '');
      });
      cleanContent = cleanContent.trim();

      steps.push({
        number: stepNumber++,
        title: title,
        content: cleanContent.substring(0, 500), // Limit content length
        formula: formulas.length > 0 ? formulas[0] : null // Use first formula for display
      });
    }

    // If no steps found, create a single step with the full response
    if (steps.length === 0) {
      const formulas = extractLatexFormulas(aiResponse);
      let cleanContent = aiResponse;

      // Remove formulas from content to avoid duplication
      formulas.forEach(formula => {
        cleanContent = cleanContent.replace(`$$${formula}$$`, '');
        cleanContent = cleanContent.replace(`$${formula}$`, '');
      });

      steps.push({
        number: 1,
        title: "Решение",
        content: cleanContent.trim().substring(0, 1000), // Limit to first 1000 chars
        formula: formulas.length > 0 ? formulas[0] : null
      });
    }
  } catch (error) {
    console.error('Error parsing solution steps:', error);
    steps.push({
      number: 1,
      title: "Решение",
      content: aiResponse?.substring(0, 1000) || "Ответ недоступен",
      formula: null
    });
  }

  return steps;
}

/**
 * Saves solution to database and returns solution ID
 */
async function saveSolution(
  telegramChatId: number,
  telegramUserId: number,
  userId: string,
  problemText: string,
  aiResponse: string
): Promise<string | null> {
  try {
    console.log('Saving solution:', {
      telegramChatId,
      telegramUserId,
      userId,
      problemTextLength: problemText?.length,
      aiResponseLength: aiResponse?.length
    });

    const solutionSteps = parseSolutionSteps(aiResponse);
    const finalAnswer = extractFinalAnswer(aiResponse);

    console.log('Parsed solution:', {
      stepsCount: solutionSteps.length,
      hasFormulas: solutionSteps.filter(s => s.formula).length,
      finalAnswer: finalAnswer?.substring(0, 50)
    });

    const solutionData = {
      problem: problemText,
      solution_steps: solutionSteps,
      final_answer: finalAnswer,
      raw_response: aiResponse
    };

    const { data: solution, error } = await supabase
      .from('solutions')
      .insert({
        telegram_chat_id: telegramChatId,
        telegram_user_id: telegramUserId,
        user_id: userId,
        problem_text: problemText,
        solution_data: solutionData
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to save solution:', {
        error: error.message,
        code: error.code,
        details: error.details
      });
      return null;
    }

    console.log('Solution saved successfully:', solution?.id);
    return solution?.id || null;
  } catch (error) {
    console.error('Error saving solution:', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    });
    return null;
  }
}

async function handleTextMessage(telegramUserId: number, userId: string, text: string) {
  console.log('=== START handleTextMessage ===');
  console.log('Step 1: Received message:', { telegramUserId, userId, text });

  try {
    console.log('Step 2: Getting or creating chat...');
    // Get or create chat
    const chatId = await getOrCreateTelegramChat(userId);
    console.log('Step 3: Chat ID obtained:', chatId);

    console.log('Step 4: Saving user message...');
    // Save user message
    await supabase.from('chat_messages').insert({
      chat_id: chatId,
      user_id: userId,
      role: 'user',
      content: text,
      input_method: 'text',
    });
    console.log('Step 5: User message saved');

  console.log('Step 6: Getting chat history...');
  // Get chat history - limit to last 20 messages (10 pairs)
  const { data: historyReversed } = await supabase
    .from('chat_messages')
    .select('role, content, image_url')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(20);

  // Filter out messages with neither content nor image, then reverse to chronological order
  const history = (historyReversed?.reverse() || []).filter(msg =>
    (msg.content && msg.content.trim() !== '') || msg.image_url
  );
  console.log('Step 7: Chat history retrieved, messages count:', history?.length);

    console.log('Step 8: Starting typing indicator...');
    // Start typing loop
    const stopTyping = { stop: false };
    const typingPromise = sendTypingLoop(telegramUserId, stopTyping);

    console.log('Step 9: Preparing AI chat request...');
    // Call AI chat function with service role authorization
    const chatRequestBody = {
      messages: history || [],
      chatId: chatId,
      userId: userId,
    };

    console.log('Step 10: Calling AI chat function...');
    console.log('Request body:', JSON.stringify(chatRequestBody, null, 2));

    const chatResponse = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(chatRequestBody),
    });
    console.log('Step 11: AI response received, status:', chatResponse.status);

    // Stop typing
    stopTyping.stop = true;
    await typingPromise;
    console.log('Step 12: Typing indicator stopped');

    // Handle rate limit error
    if (chatResponse.status === 429) {
      console.log('Step 13: Rate limit error');
      await sendTelegramMessage(
        telegramUserId,
        '⏳ Слишком много запросов. Подожди немного и попробуй снова.'
      );
      return;
    }

    // Handle payment required error
    if (chatResponse.status === 402) {
      console.log('Step 13: Payment required error');
      await sendTelegramMessage(
        telegramUserId,
        '💳 Закончились средства на балансе. Пожалуйста, пополни баланс в личном кабинете.'
      );
      return;
    }

    if (!chatResponse.ok) {
      const errorText = await chatResponse.text();
      console.error('Step 13: AI response error:', {
        status: chatResponse.status,
        statusText: chatResponse.statusText,
        error: errorText
      });
      await sendTelegramMessage(telegramUserId, '❌ Произошла ошибка. Попробуй ещё раз.');
      return;
    }

    console.log('Step 13: Parsing AI response stream...');
    // Parse SSE stream
    const aiContent = await parseSSEStream(chatResponse);
    console.log('Step 14: AI content parsed, length:', aiContent?.length);

    console.log('Step 15: Saving solution to database...');
    // Save solution to database
    const solutionId = await saveSolution(
      telegramUserId,
      telegramUserId,
      userId,
      text,
      aiContent
    );
    console.log('Step 16: Solution saved, ID:', solutionId);

    console.log('Step 17: Formatting content for Telegram...');
    // Format and save AI response
    const formattedContent = formatForTelegram(aiContent);
    console.log('Step 18: Content formatted, length:', formattedContent?.length);

    console.log('Step 19: Saving AI message to chat history...');
    await supabase.from('chat_messages').insert({
      chat_id: chatId,
      user_id: userId,
      role: 'assistant',
      content: aiContent,
    });
    console.log('Step 20: AI message saved');

    console.log('Step 21: Splitting and sending message parts...');
    // Split and send response if too long
    const messageParts = splitLongMessage(formattedContent);
    console.log('Step 22: Message split into', messageParts.length, 'parts');

    for (let i = 0; i < messageParts.length; i++) {
      if (i > 0) {
        // Small delay between parts
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`Step 23.${i + 1}: Sending message part ${i + 1}/${messageParts.length}`);
      // Add inline keyboard only to the last message part
      const isLastPart = i === messageParts.length - 1;
      await sendTelegramMessage(
        telegramUserId,
        messageParts[i],
        isLastPart ? { reply_markup: createQuickActionsKeyboard() } : undefined
      );
    }
    console.log('Step 24: All message parts sent');

    // Send Mini App button if solution was saved
    if (solutionId) {
      console.log('Step 25: Sending Mini App button...');
      await sendTelegramMessage(
        telegramUserId,
        '📱 Открой полное решение с формулами:',
        { reply_markup: generateMiniAppButton(solutionId) }
      );
      console.log('Step 26: Mini App button sent');
    }

    console.log('=== END handleTextMessage SUCCESS ===');
  } catch (error) {
    console.error('=== ERROR in handleTextMessage ===');
    console.error('Error details:', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      telegramUserId,
      textLength: text?.length,
      text: text
    });
    await sendTelegramMessage(telegramUserId, '❌ Произошла ошибка. Попробуй ещё раз.');
  }
}

async function handlePhotoMessage(telegramUserId: number, userId: string, photo: any, caption?: string) {
  console.log('Handling photo message:', { telegramUserId, photoId: photo.file_id });

  try {
    // Get file info from Telegram
    console.log('Step 1: Getting file info from Telegram...');
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${photo.file_id}`
    );
    const fileData = await fileResponse.json();

    if (!fileData.ok) {
      console.error('Telegram getFile failed:', fileData);
      throw new Error(`Failed to get file from Telegram: ${JSON.stringify(fileData)}`);
    }

    const filePath = fileData.result.file_path;
    console.log('Step 2: File path obtained:', filePath);

    // Download image from Telegram
    console.log('Step 3: Downloading image from Telegram...');
    const imageResponse = await fetch(
      `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`
    );

    if (!imageResponse.ok) {
      console.error('Failed to download image:', imageResponse.status);
      throw new Error(`Failed to download image: ${imageResponse.status}`);
    }

    const imageBlob = await imageResponse.blob();
    console.log('Step 4: Image downloaded, size:', imageBlob.size);

    // Upload to Supabase Storage
    console.log('Step 5: Uploading to Supabase Storage...');
    const fileName = `${userId}/${Date.now()}.jpg`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('chat-images')
      .upload(fileName, imageBlob, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error(`Failed to upload image: ${uploadError.message}`);
    }
    console.log('Step 6: Upload successful:', fileName);

    // Create signed URL for AI
    console.log('Step 7: Creating signed URL...');
    const { data: signedData, error: signError } = await supabase.storage
      .from('chat-images')
      .createSignedUrl(fileName, 86400); // 24 hours

    if (signError || !signedData) {
      console.error('Failed to create signed URL:', signError);
      throw new Error(`Failed to create signed URL: ${signError?.message}`);
    }
    console.log('Step 8: Signed URL created');

    // Get or create chat
    console.log('Step 9: Getting or creating chat...');
    const chatId = await getOrCreateTelegramChat(userId);
    console.log('Step 10: Chat ID:', chatId);

    // Save user message with image
    console.log('Step 11: Saving message to database...');
    await supabase.from('chat_messages').insert({
      chat_id: chatId,
      user_id: userId,
      role: 'user',
      content: caption || 'Помоги решить эту задачу',
      image_url: signedData.signedUrl,
      image_path: fileName,
      input_method: 'photo',
    });

  // Get chat history - limit to last 20 messages (10 pairs)
  console.log('Step 12: Getting chat history...');
  const { data: historyReversed, error: historyError } = await supabase
    .from('chat_messages')
    .select('role, content, image_url')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (historyError) {
    console.error('Failed to get chat history:', historyError);
  }

  // Filter out messages with neither content nor image, then reverse to chronological order
  const history = (historyReversed?.reverse() || []).filter(msg =>
    (msg.content && msg.content.trim() !== '') || msg.image_url
  );
  console.log('Step 13: Chat history loaded, messages:', history.length);
  console.log('Step 13.1: Messages to send to AI:', JSON.stringify(history, null, 2));

    // Start typing loop
    const stopTyping = { stop: false };
    const typingPromise = sendTypingLoop(telegramUserId, stopTyping);

    // Call AI chat function with service role authorization
    console.log('Step 14: Calling AI chat function...');

    const chatRequestBody = {
      messages: history || [],
      chatId: chatId,
      userId: userId,
    };

    console.log('Step 14.1: Request body to chat function:', JSON.stringify(chatRequestBody, null, 2));
    console.log('Step 14.2: Messages structure:');
    chatRequestBody.messages.forEach((msg: any, idx: number) => {
      console.log(`  Message ${idx + 1}:`, {
        role: msg.role,
        contentLength: msg.content?.length || 0,
        hasImageUrl: !!msg.image_url,
        imageUrlPreview: msg.image_url ? msg.image_url.substring(0, 80) + '...' : null
      });
    });

    const chatResponse = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(chatRequestBody),
    });

    // Stop typing
    stopTyping.stop = true;
    await typingPromise;

    console.log('Step 15: AI response status:', chatResponse.status);

    // Handle rate limit error
    if (chatResponse.status === 429) {
      await sendTelegramMessage(
        telegramUserId,
        '⏳ Слишком много запросов. Подожди немного и попробуй снова.'
      );
      return;
    }

    // Handle payment required error
    if (chatResponse.status === 402) {
      await sendTelegramMessage(
        telegramUserId,
        '💳 Закончились средства на балансе. Пожалуйста, пополни баланс в личном кабинете.'
      );
      return;
    }

    if (!chatResponse.ok) {
      const errorText = await chatResponse.text();
      console.error('AI response error:', chatResponse.status, errorText);
      await sendTelegramMessage(telegramUserId, `❌ Ошибка AI: ${errorText.substring(0, 100)}`);
      return;
    }

    // Parse SSE stream
    console.log('Step 16: Parsing AI response...');
    const aiContent = await parseSSEStream(chatResponse);
    console.log('Step 17: AI response parsed, length:', aiContent.length);

    // Save solution to database
    console.log('Step 18: Saving solution to database...');
    const problemText = caption || 'Задача из фото';
    const solutionId = await saveSolution(
      telegramUserId,
      telegramUserId,
      userId,
      problemText,
      aiContent
    );
    console.log('Step 19: Solution saved, ID:', solutionId);

    // Format and save AI response
    console.log('Step 20: Formatting content for Telegram...');
    const formattedContent = formatForTelegram(aiContent);

    console.log('Step 21: Saving AI response to database...');
    await supabase.from('chat_messages').insert({
      chat_id: chatId,
      user_id: userId,
      role: 'assistant',
      content: aiContent,
    });

    // Split and send response if too long
    console.log('Step 22: Splitting and sending messages...');
    const messageParts = splitLongMessage(formattedContent);
    console.log('Message parts:', messageParts.length);

    for (let i = 0; i < messageParts.length; i++) {
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      // Add inline keyboard only to the last message part
      const isLastPart = i === messageParts.length - 1;
      await sendTelegramMessage(
        telegramUserId,
        messageParts[i],
        isLastPart ? { reply_markup: createQuickActionsKeyboard() } : undefined
      );
    }

    // Send Mini App button if solution was saved
    if (solutionId) {
      console.log('Step 23: Sending Mini App button...');
      await sendTelegramMessage(
        telegramUserId,
        '📱 Открой полное решение с формулами:',
        { reply_markup: generateMiniAppButton(solutionId) }
      );
    }

    console.log('Photo message handled successfully!');
  } catch (error) {
    console.error('Error handling photo message:', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      telegramUserId,
      photoId: photo?.file_id
    });
    await sendTelegramMessage(telegramUserId, '❌ Произошла ошибка при обработке фото. Попробуй ещё раз.');
  }
}

async function handleCallbackQuery(callbackQuery: any) {
  const telegramUserId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message?.message_id;

  console.log('Handling callback query:', { telegramUserId, data });
  
  // Answer callback query to remove loading state
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      callback_query_id: callbackQuery.id,
      text: "Обрабатываю..." 
    }),
  });

  // Handle quick action buttons
  if (data.startsWith('quick_action:')) {
    console.log('=== QUICK ACTION HANDLER START ===');
    console.log('Quick action data:', data);

    try {
      console.log('QA Step 1: Getting userId for telegram_user_id:', telegramUserId);
      const userId = await getUserIdFromTelegram(telegramUserId);
      console.log('QA Step 2: UserId obtained:', userId);

      if (!userId) {
        console.error('QA ERROR: User not found for telegram_user_id:', telegramUserId);
        await sendTelegramMessage(telegramUserId, '❌ Пользователь не найден. Пожалуйста, нажми /start для регистрации.');
        return;
      }

      console.log('QA Step 3: Determining prompt text for action:', data);
      // Determine prompt text based on button
      let promptText = '';
      switch (data) {
        case 'quick_action:plan':
          promptText = 'Составь план решения этой задачи';
          console.log('QA Step 4: Action = plan');
          break;
        case 'quick_action:explain':
          promptText = 'Объясни этот момент подробнее';
          console.log('QA Step 4: Action = explain');
          break;
        case 'quick_action:similar':
          promptText = 'Дай мне похожую задачу для практики';
          console.log('QA Step 4: Action = similar');
          break;
        default:
          console.log('QA ERROR: Unknown quick action:', data);
          return;
      }

      console.log('QA Step 5: Prompt text determined:', promptText);
      console.log('QA Step 6: Sending confirmation message to user...');

      // Show user what they "sent"
      await sendTelegramMessage(telegramUserId, `⚡ ${promptText}`);
      console.log('QA Step 7: Confirmation message sent');

      console.log('QA Step 8: Calling handleTextMessage...');
      // Process as text message with button input method
      await handleTextMessage(telegramUserId, userId, promptText);
      console.log('QA Step 9: handleTextMessage completed');
      console.log('=== QUICK ACTION HANDLER END SUCCESS ===');
    } catch (error) {
      console.error('=== QUICK ACTION HANDLER ERROR ===');
      console.error('Error handling quick action:', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        data: data,
        telegramUserId: telegramUserId
      });
      await sendTelegramMessage(telegramUserId, '❌ Произошла ошибка. Попробуй ещё раз.');
    }
    return;
  }

  // Handle onboarding buttons
  const session = await getOnboardingSession(telegramUserId);
  if (!session) {
    console.error('No session found for user:', telegramUserId);
    return;
  }

  const state = session.onboarding_state as OnboardingState;
  const userId = session.user_id;
  const onboardingData = session.onboarding_data as OnboardingData;

  if (state === 'waiting_grade' && data.startsWith('grade_')) {
    const grade = parseInt(data.replace('grade_', ''));
    await handleGradeSelection(telegramUserId, userId, grade, messageId);
  } else if (state === 'waiting_subject' && data.startsWith('subject_')) {
    const subject = data.replace('subject_', '');
    await handleSubjectSelection(telegramUserId, userId, subject, messageId);
  } else if (state === 'waiting_goal' && data.startsWith('goal_')) {
    const goal = data.replace('goal_', '');
    await completeOnboarding(telegramUserId, userId, goal, messageId);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const update = await req.json();
    console.log('Received update:', JSON.stringify(update, null, 2));

    // Handle /start command
    if (update.message?.text?.startsWith('/start')) {
      const telegramUserId = update.message.from.id;
      const telegramUsername = update.message.from.username;
      const parts = update.message.text.split(' ');
      const utmSource = parts[1] || 'header_try';

      await handleStart(telegramUserId, telegramUsername, utmSource);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle callback queries (button presses)
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle text messages (after onboarding)
    if (update.message?.text && !update.message.text.startsWith('/')) {
      const telegramUserId = update.message.from.id;

      // Get user_id reliably (from session or profiles table)
      const userId = await getUserIdFromTelegram(telegramUserId);

      if (!userId) {
        console.log('User not found for text message, requesting /start');
        await sendTelegramMessage(telegramUserId, '👋 Привет! Для начала работы нажми /start');
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if user completed onboarding
      const session = await getOnboardingSession(telegramUserId);
      if (session && session.onboarding_state !== 'completed') {
        console.log('User has not completed onboarding yet');
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await handleTextMessage(telegramUserId, userId, update.message.text);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle photo messages (after onboarding)
    if (update.message?.photo) {
      const telegramUserId = update.message.from.id;

      // Get user_id reliably (from session or profiles table)
      const userId = await getUserIdFromTelegram(telegramUserId);

      if (!userId) {
        console.log('User not found for photo message, requesting /start');
        await sendTelegramMessage(telegramUserId, '👋 Привет! Для начала работы нажми /start');
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if user completed onboarding
      const session = await getOnboardingSession(telegramUserId);
      if (session && session.onboarding_state !== 'completed') {
        console.log('User has not completed onboarding yet');
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const photo = update.message.photo[update.message.photo.length - 1]; // Get largest photo
      await handlePhotoMessage(telegramUserId, userId, photo, update.message.caption);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error processing update:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
