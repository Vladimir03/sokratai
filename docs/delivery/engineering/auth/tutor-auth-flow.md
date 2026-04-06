# Tutor Auth Flow (Single-Role)

## Goal
- Исключить смешивание student/tutor сценариев.
- Гарантировать, что tutor вход и tutor регистрация идут только через tutor entrypoints.

## Entry Points
- Student login: `/login`
- Student signup: `/signup`
- Tutor login: `/tutor/login`
- Tutor registration: `/register-tutor`

## Role Rules
- Политика: `single-role` для tutor сценариев.
- Existing student email на `/register-tutor`: блокируем как business error.
- `assign-tutor-role` не поддерживает `upgrade_existing`.

## Tutor Email Login
1. `signInWithPassword`
2. RPC `is_tutor(user.id)`
3. Если `true` -> `/tutor/dashboard`
4. Если `false` -> `signOut` + ошибка `not_tutor_account`

## Tutor Telegram Login
1. `TutorTelegramLoginButton` создает token с `intended_role: "tutor"`.
2. `telegram-bot/handleWebLogin` назначает роль tutor по `intended_role`.
3. Клиент делает retry-проверку `is_tutor`.
4. Если роль не подтверждена -> `signOut` + ошибка `telegram_role_missing`, без редиректа в student кабинет.

## Tutor Registration via Email
1. `signUp` на `/register-tutor`
2. Если ошибка "email already exists" -> блокирующий ответ `existing_email`
3. Если пользователь создан -> invoke `assign-tutor-role`
4. При ошибке role assignment -> остаться на `/register-tutor` + `role_assignment_failed`
5. При успехе -> `/tutor/dashboard`

## Structured Client/Server Events
- `auth_event:existing_email`
- `auth_event:not_tutor_account`
- `auth_event:role_assignment_failed`
- `auth_event:telegram_role_missing`
- `auth_event:upgrade_existing_blocked`
