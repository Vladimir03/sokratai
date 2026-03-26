# Task Specs: Phase 0 — Telegram-независимый онбординг

**PRD:** `docs/features/specs/homework-multichannel-delivery-prd.md`
**Прототип:** `docs/features/specs/phase0-prototype.html`
**Дата:** 2026-03-26
**Тип задачи:** A — Critical blocker (пилот невозможен без онбординга)

---

## Контекст проблемы

С февраля 2026 Telegram заблокирован Роскомнадзором в России (~80-90% недоступен без VPN). **Вся цепочка онбординга зависит от Telegram:**

- Invite-страница (`InviteToTelegram.tsx`) — только QR к Telegram-боту
- Добавление ученика (`AddStudentDialog.tsx`) — `telegram_username` обязателен
- Привязка ученик→репетитор — только через Telegram-бот (`handleTutorInvite`)
- Логин (`Login.tsx`) — Telegram primary, email secondary
- OG-теги (`index.html`) — устаревшие (математика вместо физики)

**Следствие:** репетитор не может завести учеников → нет кому отправлять ДЗ → пилот провален.

---

## Scope

**В scope:**
- Новая invite-страница с email-регистрацией (rewrite `InviteToTelegram.tsx`)
- `AddStudentDialog.tsx` — email как альтернатива telegram_username
- Новая Edge function `claim-invite` (web-based tutor-student linking)
- `Login.tsx` — email primary, Telegram secondary
- `index.html` — актуальные OG-теги
- Обновление `tutor-manual-add-student` для email

**Вне scope:**
- Push-уведомления (Phase 1)
- Email-доставка ДЗ (Phase 1)
- Account merge Telegram→Email (P2-4)
- Динамические OG-теги (P2-5)
- Telegram-бот (не трогаем — работает как fallback для VPN-пользователей)
- Auth flow Telegram-кнопки (TelegramLoginButton.tsx — без изменений)
- Новые npm-зависимости

---

## Обзор фаз

| Фаза | Описание | Effort | Зависимости |
|------|----------|--------|-------------|
| **Phase 1** | OG-теги + новая invite-страница | M | — |
| **Phase 2** | Edge function `claim-invite` (web-linking) | M | — |
| **Phase 3** | Интеграция invite-страницы + claim-invite | S | Phase 1, 2 |
| **Phase 4** | Login.tsx — email primary | S | — |
| **Phase 5** | AddStudentDialog — email поле + edge function | M | — |
| **Phase 6** | QA: кросс-браузерная проверка + e2e flow | S | Phase 1-5 |

**Рекомендация:** Phase 1 + Phase 2 параллельно → Phase 3 → Phase 4 + Phase 5 параллельно → Phase 6.

---

## Phase 1: OG-теги + новая invite-страница

### Задача 1.1: Обновить OG-теги в index.html

**Файл:** `index.html`

**Текущее состояние (before):**
```html
<meta property="og:title" content="ИИ-репетитор по математике ЕГЭ - Подготовка 24/7" />
<meta property="og:description" content="Готовься к ЕГЭ по математике с ИИ-репетитором. Решай задачи, получай объяснения и отслеживай прогресс 24/7" />
<meta property="og:image" content="https://lovable.dev/opengraph-image-p98pqg.png" />
```

**Target состояние (after):**
```html
<meta property="og:title" content="Сократ — AI-помощник для подготовки к ЕГЭ и ОГЭ" />
<meta property="og:description" content="Готовься к ЕГЭ и ОГЭ по физике и математике с AI-помощником 24/7" />
<meta property="og:url" content="https://sokratai.ru" />
<meta property="og:site_name" content="Сократ" />
<!-- og:image — оставить текущий если нет брендированного -->
```

Также обновить:
```html
<title>Сократ — AI-помощник для подготовки к ЕГЭ и ОГЭ</title>
<meta name="description" content="Готовься к ЕГЭ и ОГЭ по физике и математике с AI-помощником 24/7" />
```

**Acceptance criteria:**
- [x] `og:title` содержит «Сократ» и «ЕГЭ и ОГЭ» (не только ЕГЭ)
- [x] `og:description` упоминает физику (не только математику)
- [x] `og:url` = `https://sokratai.ru`
- [x] `og:site_name` = `Сократ`
- [x] `<title>` и `<meta name="description">` синхронизированы с OG-тегами
- [x] Twitter card теги обновлены аналогично
- [x] Inline CSS hero-секция (if exists) обновлена текстом

**Не делать:**
- Не удалять Yandex Metrika, preconnect, modulepreload
- Не менять структуру inline CSS / hero skeleton

---

### Задача 1.2: Переписать InviteToTelegram.tsx → InvitePage.tsx

**Файл:** `src/pages/InviteToTelegram.tsx` → переименовать в `src/pages/InvitePage.tsx`

**Текущее состояние (before):**
```typescript
// InviteToTelegram.tsx
// Показывает: QR-код к Telegram-боту + кнопка «Открыть Telegram» + 3-шаговая инструкция
// Нет email-регистрации
// Fetch: tutors.select().eq('invite_code', inviteCode).single()
```

**Target состояние (after):**
```typescript
// InvitePage.tsx — полная переработка
// Layout:
// ┌──────────────────────────────────────┐
// │  «Вас пригласил репетитор {Имя}»     │
// │                                      │
// │  [Имя ученика              ]         │
// │  [Email                    ]         │
// │  [Пароль                   ]         │
// │  [Зарегистрироваться]                │
// │                                      │
// │  Уже есть аккаунт? → переключить     │
// │  на форму входа (email + пароль)      │
// │                                      │
// │  ───── или ─────                     │
// │                                      │
// │  ▸ Подключиться через Telegram       │
// │    (collapsed, с пометкой VPN)       │
// └──────────────────────────────────────┘
```

**Детали реализации:**

1. **Имя файла**: переименовать `InviteToTelegram.tsx` → `InvitePage.tsx`. Обновить import в роутере (`App.tsx` или route config)

2. **Route**: `/invite/:code` — без изменений URL

3. **Data fetching (без изменений)**:
```typescript
// Запрос репетитора по invite_code — как сейчас
const { data: tutor } = await supabase
  .from('tutors')
  .select('id, name, invite_code, user_id')
  .eq('invite_code', inviteCode)
  .single();
```

4. **Два режима формы**: `isLogin: boolean` state
   - `isLogin = false` (default): Регистрация — поля: имя ученика, email, пароль
   - `isLogin = true`: Вход — поля: email, пароль
   - Переключатель: «Уже есть аккаунт? Войти» / «Нет аккаунта? Зарегистрироваться»

5. **Регистрация**:
```typescript
const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: `${window.location.origin}/homework`,
    data: { full_name: studentName } // метаданные для profiles
  }
});
// email_confirm: true в Supabase Dashboard (без верификации)
```

6. **Вход**:
```typescript
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password
});
```

7. **После auth (оба случая)**:
```typescript
// Сохранить invite_code для claim
localStorage.setItem('pending_invite_code', inviteCode);
// Redirect → /homework (или claim-invite вызовется в AuthGuard/эффекте)
```

8. **Telegram-секция**: collapsed accordion внизу
```typescript
const [showTelegram, setShowTelegram] = useState(false);
// Кнопка: «Или подключитесь через Telegram»
// При раскрытии: QR + кнопка «Открыть Telegram» + текст «нужен VPN»
```

9. **Валидация** (zod или inline):
   - Email: стандартный email-формат
   - Пароль: min 8 chars, 1 uppercase, 1 digit (как на `/signup`)
   - Имя ученика (только при регистрации): min 2 chars

10. **Success state**:
   - После успешной auth → redirect на `/homework`
   - Или показать «✅ Вы привязаны к репетитору {Имя}» с кнопкой «Перейти к домашним заданиям»

**Зависимости от Phase 2**: вызов `claim-invite` после auth. В Phase 1 можно реализовать сохранение `pending_invite_code` в localStorage — фактический claim произойдёт в Phase 3.

**Props / imports:**
```typescript
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useParams, useNavigate } from 'react-router-dom';
// Telegram: переиспользовать getTutorInviteTelegramLink из utils
import { getTutorInviteTelegramLink } from '@/utils/telegramLinks';
```

**Acceptance criteria:**
- [x] Страница показывает «Вас пригласил репетитор {Имя}» (данные из `tutors` по `invite_code`)
- [x] Основной CTA — форма email-регистрации (имя + email + пароль)
- [x] Переключатель «Уже есть аккаунт? / Нет аккаунта?» между login и signup
- [x] При регистрации: `signUp()` без email-верификации
- [x] При входе: `signInWithPassword()`
- [x] Валидация пароля: min 8 chars, 1 uppercase, 1 digit
- [x] Telegram-секция collapsed внизу с пометкой «нужен VPN»
- [x] `invite_code` сохраняется в `localStorage('pending_invite_code')` после auth
- [x] Mobile-first: `font-size ≥ 16px` на всех input (iOS zoom prevention)
- [x] `touch-action: manipulation` на кнопках
- [x] Error states: невалидный invite_code, email уже занят, неверный пароль
- [x] Loading state на кнопках при submit
- [x] Невалидный/несуществующий invite_code → «Ссылка недействительна»

**Не делать:**
- Не менять `TelegramLoginButton.tsx` — переиспользовать as-is в collapsed секции (или вовсе не включать)
- Не менять Telegram-бота
- Не добавлять email-верификацию
- Не добавлять npm-зависимости (zod уже есть в проекте)
- Не использовать `sessionStorage` (очищается на iOS при переключении табов)

---

### Задача 1.3: Обновить router (App.tsx)

**Файл:** `src/App.tsx` (или файл с routes)

**Что сделать:**
1. Заменить import `InviteToTelegram` → `InvitePage`
2. Route `/invite/:code` → `<InvitePage />` (lazy load)
3. Убрать старый import если файл переименован

```typescript
// Before
const InviteToTelegram = React.lazy(() => import('./pages/InviteToTelegram'));
// <Route path="/invite/:code" element={<InviteToTelegram />} />

// After
const InvitePage = React.lazy(() => import('./pages/InvitePage'));
// <Route path="/invite/:code" element={<InvitePage />} />
```

**Acceptance criteria:**
- [x] Route `/invite/:code` рендерит `InvitePage`
- [x] Lazy loading с `Suspense` сохранён
- [x] Старый файл `InviteToTelegram.tsx` удалён (или переименован)
- [x] Нет broken imports

---

## Phase 2: Edge function `claim-invite`

**Статус:** ✅ Phase 2 реализована (2026-03-26)

### Задача 2.1: Создать Edge function `claim-invite`

**Файл:** `supabase/functions/claim-invite/index.ts` (новый)

**Endpoint:** `POST /functions/v1/claim-invite`

**Request:**
```typescript
{
  invite_code: string  // 8-char invite code из URL
}
```

**Auth:** `verify_jwt: true` — user_id берётся из JWT

**Логика:**
```typescript
// 1. Получить user_id из JWT
const { data: { user } } = await supabaseClient.auth.getUser();

// 2. Найти репетитора по invite_code
const { data: tutor } = await supabase
  .from('tutors')
  .select('id, user_id, name')
  .eq('invite_code', invite_code)
  .maybeSingle();

if (!tutor) {
  return new Response(JSON.stringify({ error: 'Invite code not found' }), { status: 404 });
}

if (tutor.user_id === user.id) {
  return new Response(JSON.stringify({ error: 'Cannot link to yourself' }), { status: 400 });
}

// 3. Проверить: ученик уже привязан?
const { data: existing } = await supabase
  .from('tutor_students')
  .select('id')
  .eq('tutor_id', tutor.id)
  .eq('student_id', user.id)
  .maybeSingle();

if (existing) {
  // Идемпотентность — вернуть success
  return new Response(JSON.stringify({
    status: 'already_linked',
    tutor_name: tutor.name
  }), { status: 200 });
}

// 4. Создать связь
const { error } = await supabase
  .from('tutor_students')
  .insert({
    tutor_id: tutor.id,
    student_id: user.id,
    status: 'active'
  });

// 5. Записать в profiles.registration_source = 'invite_web' (если ещё не записан)
// Ошибка этого шага не должна блокировать основной linking flow
await supabase
  .from('profiles')
  .update({ registration_source: 'invite_web' })
  .eq('id', user.id)
  .is('registration_source', null);

// 6. Вернуть success
return new Response(JSON.stringify({
  status: 'linked',
  tutor_name: tutor.name
}), { status: 200 });
```

**Error responses:**
- `400` — `invite_code` не передан
- `400` — self-linking attempt (`tutor.user_id === user.id`)
- `404` — invite_code не найден (невалидный)
- `401` — нет JWT / невалидный токен
- `500` — ошибка БД

**Acceptance criteria:**
- [x] `POST /claim-invite` с валидным JWT + invite_code → создаёт `tutor_students` link
- [x] Идемпотентность: повторный вызов → `already_linked` (200), не дубликат
- [x] Невалидный invite_code → 404
- [x] Без JWT → 401
- [x] `registration_source` обновляется на `'invite_web'` (если был null)
- [x] CORS headers для фронтенда (стандартные Supabase Edge Function CORS)
- [x] Self-linking blocked → `400`

**Не делать:**
- Не добавлять email-рассылку (Phase 1 PRD)
- Не менять `generate_invite_code()` — коды остаются reusable
- Не менять RLS на `tutor_students`

---

### Задача 2.2: Client-side helper для claim-invite

**Файл:** `src/lib/inviteApi.ts` (новый)

```typescript
import { supabase } from '@/lib/supabaseClient';

export async function claimInvite(inviteCode: string): Promise<{
  status: 'linked' | 'already_linked';
  tutor_name: string;
}> {
  const { data, error } = await supabase.functions.invoke('claim-invite', {
    body: { invite_code: inviteCode }
  });

  if (error) throw error;
  return data;
}

/**
 * Проверяет localStorage на pending invite и выполняет claim.
 * Вызывать после успешной auth (login/signup).
 */
export async function claimPendingInvite(): Promise<{
  status: 'linked' | 'already_linked' | 'no_pending';
  tutor_name?: string;
}> {
  const inviteCode = localStorage.getItem('pending_invite_code');
  if (!inviteCode) return { status: 'no_pending' };

  try {
    const result = await claimInvite(inviteCode);
    localStorage.removeItem('pending_invite_code');
    return result;
  } catch (err) {
    // Не удалять invite_code при ошибке — retry при следующем входе
    console.error('Failed to claim invite:', err);
    throw err;
  }
}
```

**Acceptance criteria:**
- [x] `claimInvite(code)` вызывает edge function и возвращает результат
- [x] `claimPendingInvite()` читает из localStorage, вызывает claim, чистит при успехе
- [x] При ошибке — НЕ чистит localStorage (retry при следующем входе)
- [x] Типизация: TypeScript, без `any`

---

## Phase 3: Интеграция invite-страницы + claim-invite

### Задача 3.1: Вызов claim-invite после auth на invite-странице

**Файл:** `src/pages/InvitePage.tsx` (из Phase 1)

**Что сделать:** После успешного `signUp` или `signInWithPassword` — сразу вызвать `claimInvite`:

```typescript
import { claimInvite } from '@/lib/inviteApi';

// После успешной auth:
const handleAuthSuccess = async () => {
  try {
    const result = await claimInvite(inviteCode);
    // Показать success: «Вы привязаны к репетитору {result.tutor_name}»
    // Redirect → /homework через 1-2 секунды (или сразу с кнопкой)
  } catch (err) {
    // Сохранить в localStorage как fallback
    localStorage.setItem('pending_invite_code', inviteCode);
    // Redirect → /homework (claim произойдёт при следующем входе)
  }
};
```

**Acceptance criteria:**
- [ ] Регистрация через invite → ученик автоматически привязан к репетитору
- [ ] Вход через invite → ученик автоматически привязан (если не был)
- [ ] Success state: «✅ Вы привязаны к репетитору {Имя}» + кнопка «Перейти к ДЗ»
- [ ] При ошибке claim — localStorage fallback, redirect на /homework
- [ ] Нет двойного claim (идемпотентность backend)

---

### Задача 3.2: Claim pending invite при входе через Login/SignUp

**Файл:** `src/pages/Login.tsx` и `src/pages/SignUp.tsx`

**Что сделать:** После успешной auth (login или signup) — проверить `pending_invite_code` и вызвать claim:

```typescript
import { claimPendingInvite } from '@/lib/inviteApi';

// В onSubmit / handleTelegramSuccess, после успешной auth:
try {
  await claimPendingInvite();
  // Если был pending invite — ученик привязан
} catch {
  // Ошибка claim не блокирует вход — просто логируем
}
// Продолжить обычный redirect
```

**Acceptance criteria:**
- [ ] Login через `/login` с `pending_invite_code` в localStorage → claim выполняется
- [ ] SignUp через `/signup` с `pending_invite_code` в localStorage → claim выполняется
- [ ] Если нет `pending_invite_code` → ничего не происходит (no-op)
- [ ] Ошибка claim не блокирует вход (non-blocking try/catch)
- [ ] После успешного claim — `pending_invite_code` удалён из localStorage

**Не делать:**
- Не менять redirect-логику (tutor vs student routing)
- Не менять Telegram auth flow
- Не менять UI Login.tsx (это Phase 4)

---

## Phase 4: Login.tsx — email primary

### Задача 4.1: Переставить email и Telegram местами

**Файл:** `src/pages/Login.tsx`

**Текущее состояние (before):**
```
┌──────────────────────────────┐
│  [Telegram] ← «Рекомендуем» │
│                              │
│  ─── или ───                 │
│                              │
│  Email + пароль (secondary)  │
│  [Войти]                     │
└──────────────────────────────┘
```

**Target состояние (after):**
```
┌──────────────────────────────┐
│  Email + пароль (primary)    │
│  [Войти]                     │
│                              │
│  ─── или ───                 │
│                              │
│  [Telegram] ← «нужен VPN»   │
│  (30с timeout → hint)        │
└──────────────────────────────┘
```

**Детали:**

1. **Email форма** — переместить вверх (перед separator «или»)
2. **Telegram кнопка** — переместить вниз (после separator)
3. **Убрать** текст «Рекомендуем — не нужен пароль» у Telegram
4. **Добавить** к Telegram-кнопке мелкий текст: `text-xs text-muted-foreground` «Или войдите через Telegram (нужен VPN)»
5. **Telegram timeout hint**: если polling > 30 секунд → показать:
   ```
   «Telegram может быть недоступен. Попробуйте войти по email ↑»
   ```
   Реализация: `setTimeout(30000)` после нажатия на Telegram-кнопку → state `showTelegramHint`

**Acceptance criteria:**
- [ ] Email-форма показана **первой** (сверху)
- [ ] Telegram-кнопка показана **после** email-формы
- [ ] Текст «Рекомендуем — не нужен пароль» убран
- [ ] Добавлен текст «нужен VPN» рядом с Telegram
- [ ] 30с timeout → hint «Telegram может быть недоступен»
- [ ] Telegram auth flow не сломан (TelegramLoginButton без изменений внутри)
- [ ] Ссылка «Регистрация» → `/signup` (без изменений)
- [ ] Redirect-логика (tutor vs student) без изменений

**Не делать:**
- Не менять `TelegramLoginButton.tsx`
- Не менять redirect-логику
- Не менять Supabase auth calls

---

### Задача 4.2: Обновить SignUp.tsx — email primary

**Файл:** `src/pages/SignUp.tsx`

**Аналогично Login.tsx:**
1. Email-форма сверху (уже так? проверить)
2. Telegram-кнопка снизу с пометкой «нужен VPN»
3. Убрать акцент на Telegram если есть

**Acceptance criteria:**
- [ ] Email-регистрация — primary CTA
- [ ] Telegram — secondary с «нужен VPN»
- [ ] Валидация пароля как в PRD (min 8, 1 upper, 1 digit)
- [ ] Нет broken imports

---

## Phase 5: AddStudentDialog — email поле

### Задача 5.1: Добавить email поле в AddStudentDialog

**Файл:** `src/components/tutor/AddStudentDialog.tsx`

**Текущая вкладка «Добавить вручную» (before):**
```
Имя ученика*     [____________]
Telegram          [____________]  ← обязательное
Цель обучения     [▾ dropdown  ]
```

**Target (after):**
```
Имя ученика*      [____________]
Email             [____________]  ← новое, опциональное
Telegram          [____________]  ← теперь опциональное
Цель обучения     [▾ dropdown  ]

* Заполните email или Telegram (или оба)
```

**Детали:**

1. **Новое поле `email`**: `<Input type="email" />`, опциональное
2. **`telegram_username`**: стало опциональным (было обязательное)
3. **Валидация**: хотя бы одно из `email` / `telegram_username` заполнено
   ```typescript
   if (!email && !telegramUsername) {
     setError('Укажите email или Telegram ученика');
     return;
   }
   ```
4. **Email validation**: стандартный regex или zod `z.string().email()`
5. **Подсказка** под полями: `text-xs text-muted-foreground` «Рекомендуем указать email — Telegram может быть недоступен»

**Acceptance criteria:**
- [ ] Поле email добавлено на вкладку «Добавить вручную»
- [ ] `telegram_username` стало опциональным
- [ ] Валидация: хотя бы одно из email/telegram заполнено
- [ ] Подсказка «Рекомендуем email» видна
- [ ] `font-size ≥ 16px` на input (iOS)
- [ ] При submit: передаём email в `manualAddTutorStudent()`

---

### Задача 5.2: Обновить Edge function tutor-manual-add-student

**Файл:** `supabase/functions/tutor-manual-add-student/index.ts`

**Что сделать:**

1. **Принять `email`** в request body (optional string)
2. **Валидация**: хотя бы `email` или `telegram_username` предоставлен
3. **Логика по email**:
   ```typescript
   if (email) {
     // Поиск существующего профиля по email
     const { data: existingProfile } = await supabase
       .from('profiles')
       .select('id')
       .eq('email', email)
       .maybeSingle();

     if (existingProfile) {
       studentId = existingProfile.id;
     } else {
       // Создать placeholder-запись (без auth.users)
       // Или создать auth user через admin API?
       // Рекомендация: создать профиль с registration_source = 'manual'
       // Когда ученик зарегистрируется сам — profiles merge по email
     }
   }
   ```
4. **Создать `tutor_students` link** (как сейчас, с `student_id`)

**Design decision: placeholder profile**

Когда репетитор добавляет ученика по email, а ученик ещё не зарегистрирован:
- Создаём запись в `profiles` с `email`, `full_name`, `registration_source = 'manual_tutor'`
- НЕ создаём `auth.users` — ученик сам зарегистрируется
- При регистрации ученика — Supabase auth trigger должен найти placeholder по email и обновить `id`
- **Или** — проще: создать `auth.users` через `supabase.auth.admin.createUser()` с `email_confirm: true` (auto-confirmed) и случайным паролем. Ученик потом сделает reset password через invite-ссылку.

**Рекомендация:** вариант с `admin.createUser()` проще — не нужен merge-логика. Ученик получит email «Вас добавил репетитор» со ссылкой на reset password.

**Acceptance criteria:**
- [ ] Принимает `email` в body (optional)
- [ ] Валидация: `email` или `telegram_username` обязателен
- [ ] Если email → ищет существующий профиль, не дублирует
- [ ] Если профиль не найден → создаёт placeholder (или admin.createUser)
- [ ] Создаёт `tutor_students` link с правильным `student_id`
- [ ] Email-формат валидируется на бэкенде
- [ ] Backward compatible: существующие вызовы без email продолжают работать

---

### Задача 5.3: Обновить типы и API-клиент

**Файлы:**
- `src/types/tutor.ts` — добавить `email?: string` в `ManualAddTutorStudentInput`
- `src/lib/tutors.ts` — обновить `manualAddTutorStudent()` для передачи email

```typescript
// types/tutor.ts
interface ManualAddTutorStudentInput {
  name: string;
  telegram_username?: string;  // было обязательное, стало optional
  email?: string;              // НОВОЕ
  learning_goal?: string;
  grade?: string;
  exam_type?: string;
  subject?: string;
  start_score?: number;
}
```

**Acceptance criteria:**
- [ ] `ManualAddTutorStudentInput.telegram_username` — optional
- [ ] `ManualAddTutorStudentInput.email` — новое optional поле
- [ ] `manualAddTutorStudent()` передаёт email в edge function
- [ ] TypeScript компилируется без ошибок

---

## Phase 6: QA — кросс-браузерная проверка

### Задача 6.1: E2E flow checklist

**Flow 1: Новый ученик через invite (основной)**
- [ ] Репетитор копирует invite-ссылку из кабинета
- [ ] Ученик открывает ссылку → видит «Вас пригласил {Имя}»
- [ ] Ученик заполняет имя + email + пароль → «Зарегистрироваться»
- [ ] Ученик автоматически привязан к репетитору
- [ ] Redirect на `/homework`
- [ ] В кабинете репетитора — ученик появился в списке

**Flow 2: Существующий ученик через invite**
- [ ] Ученик уже зарегистрирован по email
- [ ] Открывает invite-ссылку → переключается на «Войти»
- [ ] Вводит email + пароль → привязывается к новому репетитору
- [ ] Redirect на `/homework`

**Flow 3: Вход через Login.tsx**
- [ ] Email-форма сверху, Telegram снизу
- [ ] Email login работает
- [ ] Telegram login работает (с VPN)
- [ ] 30с timeout → hint про Telegram

**Flow 4: Добавление ученика репетитором**
- [ ] Вкладка «Добавить вручную» → email поле
- [ ] Ввод email без Telegram → ученик добавлен
- [ ] Ввод Telegram без email → ученик добавлен (backward compat)
- [ ] Оба пустые → ошибка валидации

**Flow 5: OG-теги**
- [ ] Вставить `https://sokratai.ru` в Telegram → preview показывает «Сократ — AI-помощник для подготовки к ЕГЭ и ОГЭ»
- [ ] Вставить `https://sokratai.ru/invite/XXXXX` → корректный preview

### Задача 6.2: Кросс-браузерная проверка

**Браузеры:**
- [ ] Chrome desktop (Windows)
- [ ] Chrome mobile (Android)
- [ ] Safari desktop (macOS)
- [ ] Safari mobile (iPhone)

**Проверки:**
- [ ] `font-size ≥ 16px` на всех input (iOS zoom prevention)
- [ ] `touch-action: manipulation` на кнопках
- [ ] Пароль `type="password"` — автозаполнение работает
- [ ] `localStorage` — записывается и читается корректно (не sessionStorage!)
- [ ] Формы не зумятся на iOS Safari
- [ ] Email keyboard type показывается на mobile (`type="email"`)
- [ ] Нет 300ms tap delay на кнопках

---

## Summary: что меняется, а что нет

| Компонент | Меняется? | Детали |
|-----------|-----------|--------|
| `index.html` | **ДА** | OG-теги, title, description |
| `InviteToTelegram.tsx` → `InvitePage.tsx` | **REWRITE** | Email-регистрация primary, Telegram collapsed |
| `App.tsx` (routes) | **Минимально** | Rename import |
| `claim-invite/index.ts` | **НОВЫЙ** | Edge function для web-linking |
| `src/lib/inviteApi.ts` | **НОВЫЙ** | Client-side claim helpers |
| `Login.tsx` | **ДА** | Email primary, Telegram secondary + timeout hint |
| `SignUp.tsx` | **Минимально** | Telegram secondary + VPN label |
| `AddStudentDialog.tsx` | **ДА** | Email поле, telegram optional |
| `tutor-manual-add-student/index.ts` | **ДА** | Принять email, создать профиль |
| `src/types/tutor.ts` | **ДА** | email в ManualAddTutorStudentInput |
| `src/lib/tutors.ts` | **Минимально** | Передать email в edge function |
| `TelegramLoginButton.tsx` | Нет | Без изменений |
| `telegram-bot/index.ts` | Нет | Без изменений |
| `AuthGuard.tsx` | Нет | Без изменений |
| Backend homework-api | Нет | Без изменений |

**Estimated total effort:** 4-5 дней (1 разработчик)
- Phase 1 (OG + invite page): 1.5 дня
- Phase 2 (claim-invite): 0.5 дня
- Phase 3 (интеграция): 0.5 дня
- Phase 4 (login/signup): 0.5 дня
- Phase 5 (AddStudent + edge fn): 1 день
- Phase 6 (QA): 0.5 дня
