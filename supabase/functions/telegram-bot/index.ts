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

Отправь мне задачу текстом или фото - и начнём!`,

  header_try: `🎓 Привет! Я Сократ - твой ИИ-помощник по математике, физике и информатике!

Давай покажу, как я помогаю решать задачи. Отправь мне:
📸 Фото задачи из учебника
✏️ Или просто напиши задачу текстом

Попробуем прямо сейчас - первые 7 дней бесплатно!`,

  plan_free: `🎓 Привет! Я Сократ!
👋 Отлично, что решил попробовать

В бесплатном тарифе у тебя:
✅ 10 сообщений в день
✅ Решение задач с объяснениями
✅ Работа на всех устройствах

Давай решим первую задачу! Отправь фото или текст 📸`,

  plan_premium: `🎓 Привет! Я Сократ!
🚀 Супер выбор. Популярный тариф - это максимум возможностей!

Что ты получаешь за 699₽/месяц:
♾️ Неограниченные сообщения
🎯 Персональный план подготовки
📊 Отслеживание прогресса

Но сначала - 7 дней бесплатно! 
Отправь первую задачу и убедись сам 💪`,

  plan_pro: `🎓 Привет! Я Сократ!
🎯 Вау, ты нацелен на максимальный результат!

Тариф "ИИ + Репетитор" включает:
👨‍🏫 1 час с живым репетитором в неделю
🤖 Безлимитный ИИ-помощник 24/7

Начнем с ИИ-помощника (7 дней бесплатно).
Репетитора подключим после оплаты.

Какую задачу разберем первой? 🔥`,

  parent_trial: `Здравствуйте! Я Сократ - безопасный ИИ-помощник для подготовки к ЕГЭ.

Для родителей у нас есть:
✅ Полный контроль прогресса ребенка
✅ Отчеты об успеваемости
✅ Безопасная среда обучения

Хотите увидеть, как это работает?`,
};

async function sendTelegramMessage(
  chatId: number,
  text: string,
  extraParams?: Record<string, any>
) {
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
  
  if (messageId) {
    await editTelegramMessage(
      telegramUserId,
      messageId,
      `✅ Готово!\n\n🎉 Отлично! Теперь я знаю, что ты в ${gradeText}, готовишься к ${goalText} по ${subjectText}!
    
Теперь можешь:
• Отправить мне задачу текстом
• Загрузить фото задачи
• Задать любой вопрос по предмету

Я помогу тебе разобраться! 🚀`,
      { reply_markup: { inline_keyboard: [] } }
    );
  }

  await updateOnboardingState(telegramUserId, userId, 'completed');
}

async function handleCallbackQuery(callbackQuery: any) {
  const telegramUserId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message?.message_id;

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

  // Answer callback query to remove loading state
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQuery.id }),
  });
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
    }

    // Handle callback queries (button presses)
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
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
