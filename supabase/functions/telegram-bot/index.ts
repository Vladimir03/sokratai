import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const WEB_PAYMENT_URL = "https://sokratai.ru/profile?openPayment=true";
const WEB_PRICING_URL = "https://sokratai.ru/#pricing";

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
      // Telegram-only user - use password-based flow
      const generatedEmail = `tg_${telegramUserId}@telegram.user`;
      const generatedPassword = `tg_${telegramUserId}_${profile.id}`;
      
      console.log("Telegram user, trying password flow for:", generatedEmail);

      // Try to sign in
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: generatedEmail,
        password: generatedPassword,
      });

      if (signInData?.session) {
        session = signInData.session;
        console.log("Sign in successful");
      } else {
        console.log("Sign in failed:", signInError?.message);
        
        // Try to sign up
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: generatedEmail,
          password: generatedPassword,
          options: {
            data: {
              telegram_user_id: telegramUserId,
              telegram_username: telegramUsername,
            },
          },
        });

        if (signUpData?.session) {
          session = signUpData.session;
          console.log("Sign up successful");
        } else if (signUpError) {
          console.error("Sign up error:", signUpError);
        }
      }
    }

    if (!session) {
      console.error("Failed to create session for user");
      await sendTelegramMessage(telegramUserId, "❌ Не удалось создать сессию. Попробуйте войти через email на сайте.");
      return;
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

  // Subscripts (common)
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
    return `\n━━━━━━━━━━━━━━━━\n${emoji}${titlePart}`;
  });

  // Also handle plain "Шаг N:" without bold
  result = result.replace(/(?<![<\w])Шаг\s*(\d+)[:.]\s*/gi, (match, num) => {
    const n = parseInt(num);
    const emoji = n <= 10 ? stepEmojis[n - 1] : `<b>${n}.</b>`;
    return `\n━━━━━━━━━━━━━━━━\n${emoji} `;
  });

  // === STEP 4: Highlight final answer ===
  result = result.replace(
    /<b>Ответ[:.]*<\/b>/gi,
    "\n━━━━━━━━━━━━━━━━\n🎯 <b>ОТВЕТ:</b>"
  );

  // Plain "Ответ:" without bold
  result = result.replace(
    /(?<![<\w])Ответ[:.]\s*/gi,
    "\n━━━━━━━━━━━━━━━━\n🎯 <b>ОТВЕТ:</b> "
  );

  // === STEP 5: Enhance key sections ===
  result = result.replace(/<b>(Дано|Найти|Решение|Проверка)[:.]*<\/b>/gi, "📝 <b>$1:</b>");
  result = result.replace(/(?<![<\w])(Дано|Найти|Проверка)[:.]\s*/gi, "\n📝 <b>$1:</b> ");

  // === STEP 6: Clean up formatting ===

  // Remove separator at very beginning
  result = result.replace(/^[\n\s]*━━/, "━━");
  if (result.startsWith("━━")) {
    result = result.replace(/^━━━━━━━━━━━━━━━━\n*/, "");
  }

  // Remove duplicate separators
  result = result.replace(/(━━━━━━━━━━━━━━━━[\n\s]*){2,}/g, "━━━━━━━━━━━━━━━━\n\n");

  // Remove separator at the very end
  result = result.replace(/[\n\s]*━━━━━━━━━━━━━━━━[\n\s]*$/, "");

  // Clean up excessive newlines (more than 2)
  result = result.replace(/\n{3,}/g, "\n\n");

  // Ensure space after separators
  result = result.replace(/━━━━━━━━━━━━━━━━\n([^\n])/g, "━━━━━━━━━━━━━━━━\n\n$1");

  // Remove leading newlines
  result = result.replace(/^\n+/, "");

  return result.trim();
}

/**
 * Generates Telegram inline keyboard JSON for Mini App button
 */
function generateMiniAppButton(solutionId: string): any {
  const WEBAPP_URL = Deno.env.get("VITE_WEBAPP_URL") || "https://sokratai.lovable.app";
  const miniAppUrl = `${WEBAPP_URL}/miniapp/solution/${solutionId}`;

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

// Create quick action inline keyboard for help depth control
function createQuickActionsKeyboard() {
  return {
    inline_keyboard: [
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
          text: "📖 Объясни подробнее",
          callback_data: "help_depth:explain",
        },
      ],
    ],
  };
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

    // Format and save AI response
    const formattedContent = formatForTelegram(aiContent);

    // DEBUG: Log formatted result
    console.log("\n📝 FORMATTED RESULT (first 500 chars):");
    console.log(formattedContent.substring(0, 500));

    await supabase.from("chat_messages").insert({
      chat_id: chatId,
      user_id: userId,
      role: "assistant",
      content: aiContent,
    });

    // Split and send response if too long
    const messageParts = splitLongMessage(formattedContent);
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
        isLastPart ? { reply_markup: createQuickActionsKeyboard() } : undefined,
      );
    }

    // Send Mini App button if solution was saved
    if (solutionId) {
      await sendTelegramMessage(telegramUserId, "📱 Открой полное решение с формулами:", {
        reply_markup: generateMiniAppButton(solutionId),
      });
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
    const formattedContent = formatForTelegram(aiContent);

    console.log("Step 21: Saving AI response to database...");
    await supabase.from("chat_messages").insert({
      chat_id: chatId,
      user_id: userId,
      role: "assistant",
      content: aiContent,
    });

    // Split and send response if too long
    console.log("Step 22: Splitting and sending messages...");
    const messageParts = splitLongMessage(formattedContent);
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
        isLastPart ? { reply_markup: createQuickActionsKeyboard() } : undefined,
      );
    }

    // Send Mini App button if solution was saved
    if (solutionId) {
      console.log("Step 23: Sending Mini App button...");
      await sendTelegramMessage(telegramUserId, "📱 Открой полное решение с формулами:", {
        reply_markup: generateMiniAppButton(solutionId),
      });
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
  responseHeader: string
) {
  console.log("Handling button action:", { telegramUserId, promptText, originalMessageId });

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
    const formattedContent = formatForTelegramStructured(aiContent);

    // Build final message with header
    const fullMessage = `${responseHeader}\n\n${formattedContent}`;

    // Split if too long (Telegram limit is ~4096 chars)
    const messageParts = splitLongMessage(fullMessage, 4000);

    // Edit the original message with the first part
    if (originalMessageId && messageParts.length > 0) {
      try {
        if (messageParts.length === 1) {
          // Single part: edit the message with response and include buttons
          await editTelegramMessage(
            telegramUserId,
            originalMessageId,
            messageParts[0],
            { reply_markup: createQuickActionsKeyboard() }
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
              isLastPart ? { reply_markup: createQuickActionsKeyboard() } : undefined
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
            isLastPart ? { reply_markup: createQuickActionsKeyboard() } : undefined
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
          isLastPart ? { reply_markup: createQuickActionsKeyboard() } : undefined
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

    switch (helpLevel) {
      case "solution":
        promptText = "Покажи полное решение этой задачи с ответом. Не задавай вопросов, просто реши.";
        responseHeader = "✅ <b>Решение:</b>";
        buttonText = "✅ Показываю решение...";
        break;
      case "hint":
        promptText = "Дай мне только подсказку для следующего шага. Не решай полностью, только намекни на направление.";
        responseHeader = "💡 <b>Подсказка:</b>";
        buttonText = "💡 Готовлю подсказку...";
        break;
      case "explain":
        promptText = "Объясни подробнее последний шаг или концепцию. Разбери детально с примерами.";
        responseHeader = "📖 <b>Подробное объяснение:</b>";
        buttonText = "📖 Готовлю объяснение...";
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
    await handleButtonAction(telegramUserId, userId, promptText, loadingMessageId, responseHeader);
    return;
  }

  // Answer callback query for onboarding buttons
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQuery.id,
      text: "Обрабатываю...",
    }),
  });

  // Handle onboarding buttons
  const session = await getOnboardingSession(telegramUserId);
  if (!session) {
    console.error("No session found for user:", telegramUserId);
    return;
  }

  const state = session.onboarding_state as OnboardingState;
  const userId = session.user_id;
  const onboardingData = session.onboarding_data as OnboardingData;

  if (state === "waiting_grade" && data.startsWith("grade_")) {
    const grade = parseInt(data.replace("grade_", ""));
    await handleGradeSelection(telegramUserId, userId, grade, messageId);
  } else if (state === "waiting_subject" && data.startsWith("subject_")) {
    const subject = data.replace("subject_", "");
    await handleSubjectSelection(telegramUserId, userId, subject, messageId);
  } else if (state === "waiting_goal" && data.startsWith("goal_")) {
    const goal = data.replace("goal_", "");
    await completeOnboarding(telegramUserId, userId, goal, messageId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const update = await req.json();
    console.log("Received update:", JSON.stringify(update, null, 2));

    // Handle /start command
    if (update.message?.text?.startsWith("/start")) {
      const telegramUserId = update.message.from.id;
      const telegramUsername = update.message.from.username;
      const parts = update.message.text.split(" ");
      const utmSource = parts[1] || "header_try";

      await handleStart(telegramUserId, telegramUsername, utmSource);
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

    // Handle text messages (after onboarding)
    if (update.message?.text && !update.message.text.startsWith("/")) {
      const telegramUserId = update.message.from.id;
      const session = await getOnboardingSession(telegramUserId);

      if (session && session.onboarding_state === "completed") {
        await handleTextMessage(telegramUserId, session.user_id, update.message.text);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle photo messages (after onboarding)
    if (update.message?.photo) {
      const telegramUserId = update.message.from.id;
      const session = await getOnboardingSession(telegramUserId);

      if (session && session.onboarding_state === "completed") {
        const photo = update.message.photo[update.message.photo.length - 1]; // Get largest photo
        await handlePhotoMessage(telegramUserId, session.user_id, photo, update.message.caption);
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
