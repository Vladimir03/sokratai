# Tasks: Tutor Profile (Аватар, Имя, Предметы) + Telegram-style Identity в Guided Chat

**Spec:** [spec.md](./spec.md)
**Дата нарезки:** 2026-04-15
**Автор:** Vladimir Kamchatkin × Claude

---

## Карта задач по фазам

```
Phase 1 (P0): Foundation + Identity + Chat render
├── TASK-1  Миграция infrastructure              [Claude Code]
├── TASK-2  tutorProfileApi + hook               [Claude Code]       deps: TASK-1
├── TASK-3  UserAvatar + SVG placeholders        [Claude Code]       (параллельно с TASK-2)
├── TASK-4  AvatarUpload с canvas-compression    [Claude Code]       deps: TASK-2, TASK-3
├── TASK-5  TutorProfile page + Identity + route [Claude Code]       deps: TASK-2, TASK-4
├── TASK-6  Navigation avatar                    [Claude Code]       deps: TASK-3, TASK-5
├── TASK-7  Backend handleGetThread резолв       [Claude Code]       deps: TASK-1
├── TASK-8  studentHomeworkApi + types           [Claude Code]       deps: TASK-7
├── TASK-9  GuidedChatMessage render             [Claude Code]       deps: TASK-3, TASK-8
└── TASK-10 GuidedHomeworkWorkspace plumbing     [Claude Code]       deps: TASK-9

Phase 2 (P1): Security + Subjects
├── TASK-11 Edge function tutor-account          [Claude Code]       deps: Phase 1
├── TASK-12 SecuritySection (email + password)   [Claude Code]       deps: TASK-11
└── TASK-13 SubjectsMultiSelect + integration    [Claude Code]       deps: TASK-2, TASK-5

Phase 3 (P1): Telegram photo auto-prefill
├── TASK-14 Edge fn tutor-telegram-avatar-prefill [Claude Code]      deps: Phase 1
└── TASK-15 TelegramLoginButton integration       [Claude Code]      deps: TASK-14
```

Codex review после каждой фазы (`npm run lint && npm run build && npm run smoke-check` предварительно зелёный).

---

## Phase 1 (P0)

### TASK-1: Миграция infrastructure

**Job:** P1.3 (инфраструктура для редактирования профиля)
**Agent:** Claude Code
**Files:** `supabase/migrations/YYYYMMDDHHMMSS_tutor_profile_infrastructure.sql`
**AC:** AC-1 (сохранение упсёрта), AC-5 (nullable gender в tutors), AC-6 (колонка gender)

**Что делает:**
- Создаёт storage bucket `avatars` (`public=true`, `file_size_limit=2097152`, mime: `image/jpeg`, `image/png`, `image/webp`).
- Storage policies: `authenticated` может INSERT/UPDATE/DELETE **только в свою папку** (`(storage.foldername(name))[1] = auth.uid()::text`). SELECT — public (bucket уже public).
- `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT`, `gender TEXT CHECK (gender IN ('male','female'))`.
- `ALTER TABLE tutors ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male','female'))`.
- RLS на `tutors`: `SELECT` для `authenticated` (all rows — нужно для рендера аватара ученику), `INSERT` и `UPDATE` только `user_id = auth.uid()`. Предварительно проверить текущие policies — если уже есть, не дублировать, а дополнить.

**Guardrails:**
- Перед ALTER TABLE проверить что колонок нет (`IF NOT EXISTS`).
- Проверить что текущий код не читает `tutors` под `anon` — grep перед миграцией.
- Не трогать existing policies на `profiles` и `homework_tutor_*`.

---

### TASK-2: tutorProfileApi + useTutorProfile hook

**Job:** P1.3
**Agent:** Claude Code
**Files:** `src/lib/tutorProfileApi.ts` (новый), `src/hooks/useTutorProfile.ts` (новый)
**AC:** AC-1, AC-6

**Что делает:**
- `tutorProfileApi.getTutorProfile()` — `SELECT id, user_id, name, avatar_url, subjects, gender FROM tutors WHERE user_id = auth.uid()`. Если ряда нет — возвращает `null` (не бросать, тк профиль создаётся lazy).
- `upsertTutorProfile({ name, subjects, gender })` — `UPSERT ON CONFLICT (user_id) DO UPDATE`. Возвращает обновлённый ряд.
- `uploadAvatar(file)` — принимает уже сжатый Blob (512×512 JPEG ≤ 2 МБ). Путь: `avatars/<user_id>/<uuid>.jpg`. После upload — `UPDATE tutors.avatar_url`. Если старый avatar_url существовал в нашем bucket — удалить после success update (non-blocking).
- `removeAvatar()` — удалить файл из storage + `UPDATE tutors.avatar_url = null`.
- `useTutorProfile()` — React Query hook с ключом `['tutor','profile']` + `useUpsertTutorProfile` / `useUploadAvatar` / `useRemoveAvatar` мутации, invalidate на success.

**Guardrails:**
- Query key — строго `['tutor','profile']` (performance.md).
- `crypto.randomUUID()` доступен на HTTPS + Safari 15.4+. Fallback `Date.now()-Math.random()` — см. existing pattern в `studentHomeworkApi.ts`.
- НЕ использовать `getUser()` — только `getSession()` для получения `user.id` (performance.md §2a).
- Не добавлять Zod/Yup валидацию — минимум внешних зависимостей.

---

### TASK-3: UserAvatar reusable component + SVG placeholders

**Job:** P2.2
**Agent:** Claude Code
**Files:** `src/components/common/UserAvatar.tsx` (новый), `public/avatar-placeholder-male.svg`, `public/avatar-placeholder-female.svg`
**AC:** AC-6

**Что делает:**
- `UserAvatar` props: `{ name?: string; avatarUrl?: string | null; gender?: 'male' | 'female' | null; size?: 'sm' | 'md' | 'lg'; className?: string }`. Размеры: `sm=32px`, `md=48px`, `lg=120px`.
- Логика fallback: `avatarUrl` → `<img>`; иначе `gender` → gender SVG; иначе инициалы (первые 2 слова имени → первые буквы) на `bg-accent text-white`.
- Построен на Radix Avatar primitive (`src/components/ui/avatar.tsx`).
- `loading="lazy"` на `<img>` (performance.md).
- SVG — круглые 512×512 силуэты на бежевом фоне (socrat-surface `#F7F6F3`), серый силуэт `#64748B`. Делает минималистично, в стиле design system. НЕ копировать стоковые — сделать как Lucide-style линейные силуэты (голова + плечи).

**Guardrails:**
- Без emoji в fallback.
- Initials: `String.fromCodePoint` для совместимости с кириллицей.
- Убедись что SVG файлы добавляются в `public/` (Vite будет их подхватывать по абсолютному пути `/avatar-placeholder-male.svg`).

---

### TASK-4: AvatarUpload с canvas-compression

**Job:** P2.2
**Agent:** Claude Code
**Files:** `src/components/tutor/profile/AvatarUpload.tsx` (новый)
**AC:** AC-1 (compression to ≤ 2 МБ), AC-9 (iOS)

**Что делает:**
- Принимает файл через hidden `<input type="file" accept="image/jpeg,image/png,image/webp">`.
- Валидация: тип, размер (≤ 10 МБ input, ≤ 2 МБ output), есть ли файл вообще.
- Preview через `URL.createObjectURL` (cleanup в useEffect / при remove).
- Canvas compression pipeline:
  1. Load file в `<img>` через FileReader DataURL
  2. `<canvas>` размер `min(width, height)` — центрированный квадрат (crop).
  3. Scale до 512×512
  4. `canvas.toBlob('image/jpeg', 0.9)` → если `size > 2*1024*1024` → retry `0.7` → `0.5` → error toast.
- После compression вызывает `onUpload(blob)` prop.
- Loading state во время upload (spinner).
- Кнопка «Удалить» (через prop `onRemove`).

**Guardrails:**
- Canvas toBlob — стандартный API, Safari 15+ OK (см. `.claude/rules/80-cross-browser.md`).
- НЕ использовать библиотеки (`react-easy-crop`, `browser-image-compression`) — scope OUT.
- `revokeObjectURL` обязателен в cleanup.

---

### TASK-5: TutorProfile page + Identity section + route

**Job:** P1.3
**Agent:** Claude Code
**Files:** `src/pages/tutor/TutorProfile.tsx` (новый), `src/components/tutor/profile/TutorIdentitySection.tsx` (новый), `src/App.tsx` (модифицировать)
**AC:** AC-1, AC-8

**Что делает:**
- Route `/tutor/profile` под `TutorGuard` в `App.tsx` (lazy load).
- `TutorProfile.tsx` — страница с `max-w-2xl mx-auto py-8 px-4`. Секции: **Identity** (TASK-5) + TODO slots для Security (TASK-12) и Subjects (TASK-13).
- `TutorIdentitySection.tsx`:
  - Левая колонка (desktop) / top (mobile): `UserAvatar size="lg"` + кнопки «Загрузить фото» (primary, вызывает input) и «Удалить» (ghost, показывается только если avatarUrl есть).
  - Правая колонка: Input «Имя» (16px, required, minLength=2) + RadioGroup «Пол» (мужской / женский / не указано).
  - Кнопка «Сохранить» (sticky bottom на mobile, inline на desktop, `min-h-[44px]`, `bg-accent`).
- Dirty-state tracking (сравнение с initial). Сохраняется только если есть изменения.
- Показывает toast success/error через существующий sonner.
- При пустом `tutors` ряде — форма пре-заполняется пустыми значениями, save делает UPSERT.

**Guardrails:**
- `text-base` (16px) на всех input — iOS Safari guard.
- Touch targets ≥ 44px.
- Никаких emoji, Lucide icons везде.
- Форма не ломается если profile === null (first visit flow).
- При смене аватара — optimistic update (avatarUrl в query cache обновляется сразу, rollback при error).

---

### TASK-6: Navigation avatar

**Job:** P1.3
**Agent:** Claude Code
**Files:** `src/components/Navigation.tsx` (модифицировать)
**AC:** AC-1

**Что делает:**
- Справа, **перед** существующей кнопкой LogOut, добавить clickable `UserAvatar size="sm"` для tutors.
- Условие рендера: `useTutorAccess` возвращает `isTutor === true`.
- onClick → `navigate('/tutor/profile')`.
- `aria-label="Открыть профиль"` + `title="Профиль"`.
- Данные — `useTutorProfile` (query key `['tutor','profile']`).
- Если query pending — placeholder пустой круг `bg-slate-100` (без skeleton-bounce, per design system — no framer-motion).
- Если `profile === null` — fallback по `gender=null` → инициалы `username` из `profiles`.

**Guardrails:**
- Не ломать existing layout (логотип + tabs + logout в одну строку h-14).
- НЕ рендерить для student (сохранить student-only экспериенс чистым).
- Не перекидывать avatar в dropdown-menu (scope OUT).

---

### TASK-7: Backend handleGetThread — резолв tutor_profile

**Job:** P2.2
**Agent:** Claude Code
**Files:** `supabase/functions/homework-api/index.ts` (модифицировать)
**AC:** AC-4, AC-5

**Что делает:**
- В `handleGetThread` (student variant) — после основного SELECT тред:
  1. `SELECT tutor_user_id FROM homework_tutor_assignments WHERE id = <assignment_id>`.
  2. `SELECT name, avatar_url, gender FROM tutors WHERE user_id = <tutor_user_id>`.
  3. Собрать `tutor_profile: { display_name, avatar_url, gender }`.
  4. Fallback: если ряда в `tutors` нет → `display_name = profiles.username` (существующий резолвер), `avatar_url = null`, `gender = null`.
- Расширить response JSON: верхнеуровневое поле `tutor_profile`.
- Не менять per-message контракт — только thread-level.

**Guardrails:**
- Использовать service_role (уже есть в handler).
- Не делать N+1: один SELECT на весь запрос.
- Не ломать существующие consumers: поле `tutor_profile` — optional, все старые поля остаются без изменений.
- Graceful на случай если `tutors` таблица пустая (ownership legacy).

---

### TASK-8: studentHomeworkApi + types

**Job:** P2.2
**Agent:** Claude Code
**Files:** `src/lib/studentHomeworkApi.ts` (модифицировать), `src/types/homework.ts` (модифицировать)
**AC:** AC-4, AC-5

**Что делает:**
- Расширить тип `StudentThreadResponse` (или как он назван): добавить `tutor_profile?: { display_name: string; avatar_url: string | null; gender: 'male' | 'female' | null } | null`.
- В `getThread` (и связанных хуках): прокинуть новое поле как есть из response.
- Добавить `author_user_id` в SELECT строки 486-491 (сейчас его нет — backend присылает, но клиент не достаёт).
- Если backend вернул legacy-формат без `tutor_profile` — значение `null`, UI не падает.

**Guardrails:**
- Не менять существующие поля.
- React Query key консистентный, invalidate не ломать.

---

### TASK-9: GuidedChatMessage — render avatar + name

**Job:** P2.2
**Agent:** Claude Code
**Files:** `src/components/homework/GuidedChatMessage.tsx` (модифицировать)
**AC:** AC-4, AC-6

**Что делает:**
- Добавить optional props: `tutorDisplayName?: string; tutorAvatarUrl?: string | null; tutorGender?: 'male' | 'female' | null`.
- В ветке `isTutor` (строки 157-189): слева от bubble — `UserAvatar size="sm"` (32×32).
- Над bubble — имя: `text-xs font-semibold text-slate-700 truncate max-w-[200px]`. Если имя пустое → fallback «Репетитор».
- Layout: `flex items-start gap-2 justify-start` wrapper; bubble прежний.
- Если `tutorDisplayName === undefined && tutorAvatarUrl === undefined` (legacy callsite без новых props) — fallback на текущий рендер «Репетитор» без аватара. Никаких падений.

**Guardrails:**
- Не сломать остальные ветки (`assistant`, `user`, `system`).
- `max-w-[200px]` на имени — truncate в 1 строку.
- Avatar `loading="lazy"`.
- Никаких framer-motion (performance.md).

---

### TASK-10: GuidedHomeworkWorkspace — plumbing

**Job:** P2.2
**Agent:** Claude Code
**Files:** `src/components/homework/GuidedHomeworkWorkspace.tsx` (модифицировать)
**AC:** AC-4, AC-10

**Что делает:**
- Взять `thread.tutor_profile` из response (из TASK-8).
- При рендере `GuidedChatMessage` для каждого сообщения пробрасывать:
  - `tutorDisplayName={thread.tutor_profile?.display_name}`
  - `tutorAvatarUrl={thread.tutor_profile?.avatar_url}`
  - `tutorGender={thread.tutor_profile?.gender}`
- Убедиться, что при обновлении треда (refetch / realtime) ссылка на `tutor_profile` стабильна (нет flicker в чате AC-10). Если нестабильна — обернуть значения в `useMemo` по `thread.tutor_profile?.display_name + avatar_url + gender`.

**Guardrails:**
- Не менять логику задач / нумерации / AI calls.
- Не трогать existing streaming / realtime.

---

## Phase 2 (P1)

### TASK-11: Edge function tutor-account

**Job:** P1.3
**Agent:** Claude Code
**Files:** `supabase/functions/tutor-account/index.ts` (новый)
**AC:** AC-2, AC-3

**Что делает:** зеркалит `supabase/functions/student-account/index.ts`. Actions:
- `update-email` — `supabaseAdmin.auth.admin.updateUserById(user.id, { email, email_confirm: true })`.
- `update-password` — `supabaseAdmin.auth.admin.updateUserById(user.id, { password })`.
- Проверка роли: `has_role(auth.uid(), 'tutor')` — если false → 403.

**Guardrails:**
- Не объединять с student-account (CLAUDE.md: Student/Tutor изоляция).
- Не логировать пароли / email в console.
- CORS headers согласно существующему паттерну edge functions.

---

### TASK-12: SecuritySection (email + password)

**Job:** P1.3
**Agent:** Claude Code
**Files:** `src/components/tutor/profile/SecuritySection.tsx` (новый), `src/pages/tutor/TutorProfile.tsx` (модифицировать — подключить секцию)
**AC:** AC-2, AC-3

**Что делает:**
- Email: current из `session.user.email` (read-only) + кнопка «Изменить» → inline form с Input (type=email) + Сохранить. Submit через `supabase.functions.invoke('tutor-account', { body: { action: 'update-email', email } })`.
- Password: кнопка «Изменить пароль» → collapse с 2 полями (new + confirm) + Сохранить. Min length 8, confirm === new. Submit через edge function.
- Telegram: read-only (статус + @username из profiles). Без кнопки смены.
- Toast на success/error.

**Guardrails:**
- Password ≥ 8 символов.
- Не логировать.
- `text-base` на input.
- После update-email обновить session через `supabase.auth.refreshSession()` (или показать toast «Выйди и войди снова» — проверить что лучше).

---

### TASK-13: SubjectsMultiSelect + integration

**Job:** P1.3
**Agent:** Claude Code
**Files:** `src/components/tutor/profile/SubjectsMultiSelect.tsx` (новый), `src/pages/tutor/TutorProfile.tsx` (модифицировать)
**AC:** —

**Что делает:**
- Компонент: label «Предметы, которые я преподаю» + ряд чипов из `SUBJECTS` (из `src/types/homework.ts`).
- Клик по чипу toggle'ит id в `string[]`. Выбранный — `bg-accent text-white`, невыбранный — `bg-white border border-slate-200 text-slate-700`.
- `role="button" aria-pressed` + keyboard Space/Enter.
- Интегрировать в `TutorProfile.tsx` отдельной секцией. Сохранение через тот же `upsertTutorProfile`.

**Guardrails:**
- Импортировать `SUBJECTS` из `src/types/homework.ts` (не хардкодить).
- Показывать `name` из SUBJECTS, не `id`.
- Touch target ≥ 44px.

---

## Phase 3 (P1)

### TASK-14: Edge function tutor-telegram-avatar-prefill

**Job:** P1.3, P2.2
**Agent:** Claude Code
**Files:** `supabase/functions/tutor-telegram-avatar-prefill/index.ts` (новый)
**AC:** AC-7

**Что делает:**
- `POST` body `{ telegram_photo_url: string }`.
- Проверки:
  1. Tutor role (`has_role`).
  2. `SELECT avatar_url FROM tutors WHERE user_id = auth.uid()` — если не NULL → return 200 `{ skipped: true }` (идемпотентность).
- Flow:
  1. `fetch(telegram_photo_url)` с таймаутом 10 сек.
  2. Если 4xx/5xx или timeout → return 200 `{ skipped: true, reason: 'tg_fetch_failed' }` (не fail'ить login).
  3. Конвертировать в JPEG через `Deno.build.os` + sharp / Image API (или переиспользовать canvas-compatible wasm-библиотеку уже в проекте). Если нет — просто сохранить как есть (TG обычно даёт JPEG).
  4. Size check: ≤ 2 МБ. Иначе downscale (если нет compression возможности — save as-is, наш `public` bucket примет до 2 МБ).
  5. Upload в `avatars/<user_id>/<uuid>.jpg` через service role.
  6. `UPDATE tutors.avatar_url = <path>`.

**Guardrails:**
- НИКОГДА не сохранять Telegram URL напрямую — только наш storage path.
- Graceful на любой фейл (не ломать логин).
- Не логировать `telegram_photo_url` в console (privacy).
- Timeout на fetch обязателен.

---

### TASK-15: TelegramLoginButton integration + toast consent

**Job:** P1.3, P2.2
**Agent:** Claude Code
**Files:** `src/components/TelegramLoginButton.tsx` (модифицировать)
**AC:** AC-7

**Что делает:**
- После успешного login + `is_tutor === true`:
  1. Проверить `tutors.avatar_url` (через getSession + select).
  2. Если NULL и TG widget вернул `photo_url` → invoke `tutor-telegram-avatar-prefill`.
  3. Если response `skipped === false && success === true` → показать toast: «Твоё фото из Telegram использовано как аватар. Изменить в профиле → `/tutor/profile`».
- НЕ блокировать redirect на tutor dashboard ожиданием prefill — запускать async с `.catch(() => {})`.

**Guardrails:**
- `TelegramLoginButton.tsx` помечен как high-risk в CLAUDE.md — scope минимален, только добавить async call после существующей логики, ничего не удалять.
- Если `photo_url` отсутствует — просто skip, без ошибки.
- Тост показывать ровно один раз (не при каждом логине).

---

## Validation (после каждой задачи)

```bash
npm run lint && npm run build && npm run smoke-check
```

После Phase 1 — manual smoke:
- Windows + Chrome: `/tutor/profile` → upload 3 МБ JPEG → compress до ≤ 2 МБ → показывается в nav и в чате ДЗ.
- iPhone + Safari: тот же flow, не должно быть auto-zoom.
- Student-acc: открыть guided-homework-чат → увидеть аватар + имя репетитора слева от сообщений.

---

## Copy-paste промпты для агентов

> Plain-text fenced blocks. Каждый блок самодостаточен: роль, контекст, canonical docs, scope файлов, AC, guardrails, validation, self-check.

### Prompt TASK-1: Миграция infrastructure

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: SokratAI — AI-платформа для репетиторов физики ЕГЭ/ОГЭ. Wedge — "ДЗ за 5-10 минут". AI = draft + action, не chat-only.

Прочитай перед началом:
- docs/delivery/features/tutor-profile/spec.md (полностью)
- CLAUDE.md (секции "КРИТИЧЕСКИЕ ПРАВИЛА" и "Security Rules")
- .claude/rules/50-kb-module.md (паттерн RLS)
- Существующие миграции: supabase/migrations/20260117213552_fafe09b7-d4ee-4400-bcb6-ce032347bb89.sql (tutors), 20260225201926_*.sql (homework-materials bucket как образец RLS)

Задача: создать миграцию `supabase/migrations/YYYYMMDDHHMMSS_tutor_profile_infrastructure.sql`, где YYYYMMDDHHMMSS — текущая дата/время.

Что должно быть в миграции:
1. INSERT в storage.buckets: id='avatars', name='avatars', public=true, file_size_limit=2097152, allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp']. Использовать ON CONFLICT DO NOTHING.
2. Storage policies на bucket 'avatars': INSERT/UPDATE/DELETE только если (storage.foldername(name))[1] = auth.uid()::text. SELECT не нужен (bucket public).
3. ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT; ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male','female'));
4. ALTER TABLE tutors ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male','female'));
5. RLS policies на tutors:
   - SELECT для authenticated — USING (true). Цель: ученик должен видеть аватар репетитора через edge function и напрямую при необходимости.
   - INSERT — WITH CHECK (user_id = auth.uid()).
   - UPDATE — USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid()).
   Перед созданием: проверить в pg_policies что такие уже не существуют. Если существует — DROP POLICY IF EXISTS перед CREATE.

Acceptance Criteria из spec.md:
- AC-1: tutors UPSERT возвращает 200 для аутентифицированного tutor.
- AC-5: поле gender nullable.
- AC-6: gender='female' без avatar даёт placeholder женский SVG (проверяется позже, но колонка должна быть).

Guardrails:
- НЕ дропать существующие policies на tutors без IF EXISTS.
- НЕ менять RLS на profiles или homework_tutor_*.
- НЕ удалять storage bucket если он уже есть.
- Использовать IF NOT EXISTS везде, где применимо.

Validation:
- npx supabase db diff (локально, если доступно) — показывает ровно эту миграцию.
- npm run build (не должен упасть, но миграции не билдятся — просто проверка regress).

В конце ответа напиши:
- Changed files (полный список)
- Краткое summary (2-3 предложения)
- Self-check: нарушает ли миграция Student/Tutor изоляцию? Затрагивает ли high-risk файлы (AuthGuard/TutorGuard)?
```

### Prompt TASK-2: tutorProfileApi + hook

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: пользователь (репетитор физики) должен отредактировать профиль — имя, фото, пол, предметы. Wedge: "ДЗ за 5-10 минут" не пострадает, но без профиля нет identity для P2.2.

Прочитай:
- docs/delivery/features/tutor-profile/spec.md (секции 5 Technical Design и 9 Tasks)
- CLAUDE.md (performance.md секции 2a, 2b, 2c про query keys и getSession)
- src/lib/studentHomeworkApi.ts (образец структуры API-клиента)
- src/hooks/useStudentHomework.ts (образец React Query hooks)

Задача: создать `src/lib/tutorProfileApi.ts` и `src/hooks/useTutorProfile.ts`.

tutorProfileApi.ts экспортирует:
- TutorProfile тип: { id, user_id, name, avatar_url, subjects, gender, created_at, updated_at } — подстроить под реальную схему tutors table.
- getTutorProfile(): Promise<TutorProfile | null> — через supabase.from('tutors').select(...).eq('user_id', userId). userId получать через supabase.auth.getSession() (НЕ getUser()!).
- upsertTutorProfile(input: { name: string; subjects: string[]; gender: 'male' | 'female' | null }): Promise<TutorProfile> — UPSERT ON CONFLICT (user_id).
- uploadAvatar(file: Blob): Promise<string> — path avatars/<user_id>/<uuid>.jpg. Возвращает avatar_url (public URL через supabase.storage.from('avatars').getPublicUrl()). После upload вызвать UPDATE tutors.avatar_url. Если у tutors был старый avatar_url в нашем bucket — удалить старый файл после успешного UPDATE (non-blocking, try-catch без ре-throw).
- removeAvatar(): Promise<void> — удалить файл + UPDATE avatar_url=null.

useTutorProfile.ts экспортирует:
- useTutorProfile() — useQuery с key ['tutor','profile'], queryFn: getTutorProfile. staleTime 5 минут.
- useUpsertTutorProfile() — useMutation с invalidate ['tutor','profile'] на success.
- useUploadAvatar() — mutation, invalidate ['tutor','profile'].
- useRemoveAvatar() — то же.

Acceptance Criteria: AC-1, AC-6.

Guardrails:
- Строго query key ['tutor','profile'] (performance.md §2c).
- getSession() а не getUser() (performance.md §2a).
- crypto.randomUUID() — fallback `${Date.now()}-${Math.random().toString(36).slice(2)}` для Safari < 15.4.
- Не добавлять Zod/Yup — используй TS-интерфейсы.
- Не логировать sensitive data (токены, URLs файлов).

Validation:
- npm run lint
- npm run build
- Import в пустом компоненте и проверь autocomplete в IDE.

Mandatory end block:
- Changed files
- Summary (3 предложения)
- Validation output
- Docs-to-update: CLAUDE.md §2c уже покрывает convention
- Self-check: не нарушены ли правила student/tutor изоляции, performance и cross-browser
```

### Prompt TASK-3: UserAvatar + SVG placeholders

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- docs/delivery/features/tutor-profile/spec.md (секция 6 UX/UI)
- .claude/rules/90-design-system.md (Цветовая палитра, Иконки — Lucide, не emoji)
- .claude/rules/performance.md (lazy loading images)
- src/components/ui/avatar.tsx (Radix Avatar primitive — использовать!)

Задача: создать
- src/components/common/UserAvatar.tsx
- public/avatar-placeholder-male.svg
- public/avatar-placeholder-female.svg

UserAvatar props:
{ name?: string; avatarUrl?: string | null; gender?: 'male' | 'female' | null; size?: 'sm' | 'md' | 'lg'; className?: string }

Размеры: sm=32px (w-8 h-8), md=48px (w-12 h-12), lg=120px (w-30 h-30 или w-[120px] h-[120px]).

Fallback chain:
1. avatarUrl есть → <img src loading="lazy"> через Radix AvatarImage.
2. avatarUrl пустой + gender === 'male' → <img src="/avatar-placeholder-male.svg">.
3. avatarUrl пустой + gender === 'female' → <img src="/avatar-placeholder-female.svg">.
4. Всё пустое → инициалы имени (до 2 символов заглавными кириллицей) на фоне bg-accent text-white через Radix AvatarFallback.

SVG создать:
- 512×512 viewBox.
- Круглый фон color #F7F6F3 (socrat-surface).
- Силуэт голова + плечи, цвет stroke #64748B (slate-500), fill #E2E8F0 (slate-200).
- Мужской: более угловатые плечи.
- Женский: более покатые плечи + лёгкий намёк на волосы (без излишней стилизации, абстрактный).
- Минималистично, в духе Lucide.
- Никаких реалистичных лиц, глаз — только силуэт.

Acceptance Criteria: AC-6.

Guardrails:
- loading="lazy" на <img> (performance.md).
- className forwarded к root (cn() utility).
- Никаких emoji.
- Radix Avatar primitive обязателен (не <img> напрямую, чтобы fallback работал на broken URL).

Validation:
- npm run lint
- npm run build
- Вставить `<UserAvatar name="Вадим Коршунов" size="md" />` в любой компонент — инициалы "ВК".
- Проверить все 4 fallback ветки в Storybook/ручном тесте.

End block: Changed files + Summary + Validation + self-check design-system и performance правил.
```

### Prompt TASK-4: AvatarUpload с canvas-compression

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- docs/delivery/features/tutor-profile/spec.md (Q1 Telegram risks + секция 5 Technical Design)
- .claude/rules/80-cross-browser.md (canvas, toBlob, Safari limits)
- .claude/rules/90-design-system.md (кнопки, spacing)
- TASK-3 output (UserAvatar, который мы будем использовать для preview) — НЕ дублируй компонент

Задача: создать src/components/tutor/profile/AvatarUpload.tsx.

Props:
{ currentAvatarUrl: string | null; onUpload: (blob: Blob) => Promise<void>; onRemove: () => Promise<void>; isLoading?: boolean; gender?: 'male' | 'female' | null; name?: string; }

UI:
- UserAvatar size="lg" (из TASK-3) показывает текущий avatar (или placeholder).
- Под ним: кнопка "Загрузить фото" (bg-accent, min-h-[44px], min-w-[160px]) + кнопка "Удалить" (ghost, показывается только если currentAvatarUrl) — рядом.
- Hidden <input type="file" accept="image/jpeg,image/png,image/webp" /> — кнопка триггерит click().

Compression pipeline:
1. Прочитать file. Если > 10 МБ → toast "Файл слишком большой (до 10 МБ)", return.
2. Создать <img>, дождаться load через Promise.
3. <canvas> width=512 height=512. Вычислить центрированный квадрат из img (crop center). ctx.drawImage с правильными параметрами чтобы получить квадратный 512x512 от исходника без искажений.
4. canvas.toBlob с типом 'image/jpeg' и quality 0.9. Если blob.size > 2*1024*1024 → retry с 0.7, затем 0.5.
5. Если всё ещё > 2 МБ → toast "Не удалось сжать фото до 2 МБ. Попробуй другое изображение.", return.
6. Вызвать onUpload(blob).

Cleanup:
- createObjectURL для preview → revokeObjectURL в useEffect cleanup.
- Reset input.value после обработки (чтобы можно было загрузить тот же файл ещё раз).

Error handling:
- try/catch вокруг canvas ops (Safari может throw при неверном ориентировании EXIF — принимаем, toast).
- При onUpload throw → toast error.

Acceptance Criteria: AC-1 (compression), AC-9 (iOS).

Guardrails:
- НЕ использовать react-easy-crop, browser-image-compression, sharp etc. (scope OUT).
- НЕ EXIF-ориентацию фиксим (parking lot).
- canvas.toBlob — используй стандартный API, НЕ toDataURL + fetch (медленнее).

Validation:
- npm run lint && npm run build.
- Ручной тест на JPG 3 МБ, PNG 5 МБ, HEIC (не поддерживается — должен дать ошибку).
- iOS Safari симулятор или BrowserStack — проверить что компрессия работает.

End block как обычно.
```

### Prompt TASK-5: TutorProfile page + Identity section + route

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- docs/delivery/features/tutor-profile/spec.md (особенно секция 4 User Stories + 6 UX/UI)
- .claude/rules/10-safe-change-policy.md (edits minimal)
- .claude/rules/90-design-system.md (spacing, typography)
- src/App.tsx — найди паттерн lazy + TutorGuard для других tutor-страниц (например TutorHomework).
- TASK-2 output (hooks useTutorProfile etc.) — используй.
- TASK-4 output (AvatarUpload) — используй.

Задача:
1. Создать src/pages/tutor/TutorProfile.tsx.
2. Создать src/components/tutor/profile/TutorIdentitySection.tsx.
3. Зарегистрировать route /tutor/profile в src/App.tsx под TutorGuard с React.lazy + Suspense.

TutorProfile.tsx:
- max-w-2xl mx-auto py-8 px-4
- <h1 className="text-2xl font-semibold mb-6">Профиль</h1>
- Секции в порядке:
  - <TutorIdentitySection />
  - TODO placeholder комментарий для <SubjectsMultiSelect /> (TASK-13)
  - TODO placeholder для <SecuritySection /> (TASK-12)
- useTutorProfile() hook, обработать isLoading (skeleton или простой "Загрузка…" без bounce), error state.

TutorIdentitySection.tsx:
- Принимает профиль из пропа (или из useTutorProfile внутри — решить).
- Layout: на md+ — grid-cols-[auto,1fr] gap-6; на mobile — stacked.
- Левая колонка: <AvatarUpload currentAvatarUrl=... onUpload=... onRemove=... gender=... name=... />.
- Правая колонка:
  - Input "Имя" с label, placeholder "Например, Вадим Коршунов", text-base (16px), required, minLength=2.
  - RadioGroup "Пол" (Radix RadioGroup из src/components/ui/radio-group.tsx если есть, иначе простые <input type="radio">): "Мужской" / "Женский" / "Не указано". Value — 'male' | 'female' | ''.
- Dirty tracking: сохранять только если форма изменена. useState({name, gender}) vs initial из profile.
- Кнопка "Сохранить" — bg-accent, min-h-[44px], disabled при !dirty || isSaving. На mobile — sticky bottom, на desktop — inline.
- useUpsertTutorProfile mutation + toast success/error (sonner).
- subjects передаём из существующего profile (не меняется в этой секции).

App.tsx:
- const TutorProfile = React.lazy(() => import('@/pages/tutor/TutorProfile'));
- В JSX: <Route path="/tutor/profile" element={<TutorGuard><Suspense fallback={...}><TutorProfile /></Suspense></TutorGuard>} />
- НЕ трогать другие роуты.

Acceptance Criteria: AC-1, AC-8.

Guardrails:
- text-base (16px) на всех <input> (iOS Safari).
- min-h-[44px] на кнопках, chip, radio.
- Никаких emoji — Lucide (Camera, Trash2, User).
- Нет framer-motion. CSS transitions из tailwindcss-animate разрешены.
- AuthGuard/TutorGuard не модифицируй (high-risk).

Validation:
- npm run lint && npm run build.
- Dev-server: /tutor/profile доступен залогиненному tutor, не доступен students.
- Upload → имя отображается в nav (после TASK-6).

End block.
```

### Prompt TASK-6: Navigation avatar

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- src/components/Navigation.tsx (полностью, 80 строк)
- src/hooks/useTutorAccess.ts
- TASK-3 output (UserAvatar)
- TASK-2 output (useTutorProfile)
- .claude/rules/10-safe-change-policy.md (High-risk files — Navigation точно один ряд)

Задача: модифицировать src/components/Navigation.tsx.

В правой части навбара (перед существующей LogOut-кнопкой):
- Если useTutorAccess isTutor === true → рендерить <button aria-label="Открыть профиль" title="Профиль" onClick={() => navigate('/tutor/profile')} className="...focus-visible:ring-2 ring-accent/30 rounded-full"> с <UserAvatar size="sm" avatarUrl={profile?.avatar_url} gender={profile?.gender} name={profile?.name ?? user?.username} /> внутри.
- Данные профиля из useTutorProfile().
- Если isLoading (нет profile ещё) → UserAvatar с пустыми значениями (покажет инициалы из username если есть, иначе placeholder).
- min-h-[44px] min-w-[44px] touch target на mobile.

Для student — ничего не меняется.

Acceptance Criteria: AC-1 (после save аватар виден в nav).

Guardrails:
- НЕ разносить nav на 2 ряда (правило design system).
- НЕ добавлять dropdown (scope OUT).
- НЕ трогать existing logic logout.
- gap между avatar и logout — gap-2 или gap-3 консистентно с текущим.

Validation:
- npm run lint && npm run build.
- Открыть как tutor — avatar в углу. Кликнуть → /tutor/profile.
- Открыть как student — avatar отсутствует (только logout).

End block + self-check: не сломана ли student-навигация.
```

### Prompt TASK-7: Backend handleGetThread tutor_profile

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- docs/delivery/features/tutor-profile/spec.md (секции 5 + AC-4, AC-5)
- supabase/functions/homework-api/index.ts — найди handleGetThread (student variant), изучи как он сейчас читает thread + messages (строки около 3931-3980 и THREAD_SELECT около 4382).
- CLAUDE.md §8 ("Имя ученика в AI-промпте") — как работает resolveStudentDisplayName, НЕ дублируй, но рядом.

Задача: расширить response handleGetThread (student variant) полем tutor_profile.

Реализация:
1. После основного SELECT thread + messages — получить assignment_id (он уже известен из запроса).
2. SELECT tutor_user_id FROM homework_tutor_assignments WHERE id = <assignment_id>. (если уже тянется с тредом — не делать повторный запрос).
3. SELECT name, avatar_url, gender FROM tutors WHERE user_id = <tutor_user_id> (service role).
4. Собрать tutor_profile: {
     display_name: tutors.name || fallback-from-profiles-username || null,
     avatar_url: tutors.avatar_url || null,
     gender: tutors.gender || null
   }
   Если display_name резолвится в null и username тоже null → tutor_profile = null.
5. Добавить в top-level response: { ...existing, tutor_profile }.

Fallback для display_name: если tutors ряда нет → SELECT username FROM profiles WHERE id = tutor_user_id.

Acceptance Criteria: AC-4, AC-5.

Guardrails:
- service_role обязательна (уже в handler).
- Не делать N+1 — один SELECT на всю операцию.
- tutor_profile — optional для client, legacy треды без него не должны ломать старые клиенты (они просто не читают это поле).
- НЕ менять per-message контракт.
- НЕ логировать emails.

Validation:
- supabase functions deploy homework-api (локально, если есть).
- curl GET endpoint — response содержит tutor_profile field.
- npm run lint && npm run build.

End block.
```

### Prompt TASK-8: studentHomeworkApi + types

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- src/lib/studentHomeworkApi.ts (строки 486-491 — SELECT)
- src/types/homework.ts (найти тип StudentThreadResponse или аналог)
- TASK-7 output (backend контракт)

Задача:
1. Расширить тип thread response в src/types/homework.ts (добавить поле tutor_profile: { display_name: string; avatar_url: string | null; gender: 'male' | 'female' | null } | null).
2. В src/lib/studentHomeworkApi.ts функция getThread — type-safe прокидывает новое поле.
3. В SELECT messages (строки ~489) добавить author_user_id в список колонок — он уже в БД, клиент его пока не получает.
4. Если getThread возвращает thread без tutor_profile в response (backend legacy) — значение undefined/null, не throw.

Acceptance Criteria: AC-4, AC-5.

Guardrails:
- React Query keys не менять.
- Не трогать existing fields.
- Typescript strict — всё должно быть осведомлено об optional nature tutor_profile.

Validation: npm run lint && npm run build. Ручная проверка: тип подсказывает tutor_profile в IDE.

End block.
```

### Prompt TASK-9: GuidedChatMessage render

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- src/components/homework/GuidedChatMessage.tsx (полностью, особенно строки 157-189 — ветка isTutor)
- .claude/rules/90-design-system.md
- .claude/rules/performance.md
- TASK-3 output (UserAvatar)

Задача: модифицировать GuidedChatMessage.tsx.

Изменения в props:
- Добавить optional: tutorDisplayName?: string; tutorAvatarUrl?: string | null; tutorGender?: 'male' | 'female' | null.

Изменения в рендере для isTutor ветки (~строки 157-189):
- Заменить текущий hardcoded "Репетитор" label:
  - wrapper: flex items-start gap-2 justify-start
  - Слева: <UserAvatar size="sm" avatarUrl={tutorAvatarUrl} gender={tutorGender} name={tutorDisplayName} />
  - Справа: column с:
    - <div className="text-xs font-semibold text-slate-700 truncate max-w-[200px]">{tutorDisplayName || 'Репетитор'}</div>
    - существующий bubble

Fallback: если tutorDisplayName и tutorAvatarUrl undefined (legacy callsite) → рендер как раньше, просто "Репетитор" без аватара.

Acceptance Criteria: AC-4, AC-6, AC-10.

Guardrails:
- НЕ трогать ветки assistant/user/system.
- НЕ ломать timestamp (строка 182).
- max-w-[200px] truncate на имени — без word-break.
- Никакой framer-motion.
- loading="lazy" на аватаре (уже внутри UserAvatar).

Validation:
- npm run lint && npm run build.
- Dev: открыть guided homework как ученик — сообщения репетитора с аватаром и именем.

End block.
```

### Prompt TASK-10: GuidedHomeworkWorkspace plumbing

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- src/components/homework/GuidedHomeworkWorkspace.tsx (секция где рендерятся GuidedChatMessage, строки ~1700)
- TASK-8 output (tutor_profile в getThread response)
- TASK-9 output (GuidedChatMessage новые props)

Задача: модифицировать GuidedHomeworkWorkspace.tsx.

Изменения:
1. Достать thread.tutor_profile из uthread query data.
2. При map-е messages → <GuidedChatMessage> пробрасывать:
   - tutorDisplayName={thread.tutor_profile?.display_name}
   - tutorAvatarUrl={thread.tutor_profile?.avatar_url}
   - tutorGender={thread.tutor_profile?.gender}
3. Убедиться что props стабильны между рендерами (useMemo по display_name+avatar+gender если React Query возвращает новую ссылку каждый раз).

Acceptance Criteria: AC-4, AC-10.

Guardrails:
- НЕ трогать streaming/realtime/check-answer/hint логику.
- НЕ трогать switchToTask/celebration/init-once навигацию.
- Высокорисковый компонент — минимальные изменения.

Validation:
- npm run lint && npm run build.
- Dev: тред с 5+ сообщениями ученика+репетитора, scroll — аватар не flicker'ит.

End block + self-check: не регрессировал ли check-answer/hint flow.
```

### Prompt TASK-11: Edge function tutor-account

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- supabase/functions/student-account/index.ts (полностью — образец)
- docs/delivery/features/tutor-profile/spec.md (секция 5 API + Risks)

Задача: создать supabase/functions/tutor-account/index.ts — зеркалит student-account, но с проверкой tutor role.

Endpoints (один POST, action в body):
- action='update-email', body { email: string } → supabaseAdmin.auth.admin.updateUserById(user.id, { email, email_confirm: true }). Валидация формата email.
- action='update-password', body { password: string } → supabaseAdmin.auth.admin.updateUserById(user.id, { password }). Валидация min 8 symbols.

Role check:
- После получения user.id — вызов RPC is_tutor(_user_id). Если false → 403 "Tutors only".

CORS headers — copy-paste из student-account.

Acceptance Criteria: AC-2, AC-3.

Guardrails:
- НЕ объединять с student-account (CLAUDE.md Student/Tutor изоляция).
- НЕ логировать email/password (только user.id в errors).
- Email валидация regex или встроенная — строгая.

Validation:
- supabase functions deploy tutor-account (если доступно).
- npm run lint && npm run build.

End block.
```

### Prompt TASK-12: SecuritySection

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- docs/delivery/features/tutor-profile/spec.md (секция 6 UX/UI)
- src/pages/Profile.tsx (student-вариант — UX паттерн для email/password forms)
- TASK-11 output (tutor-account endpoint)

Задача: создать src/components/tutor/profile/SecuritySection.tsx и подключить в TutorProfile.tsx.

UI:
- Email row: "Email" label + current email (read-only) + "Изменить" (ghost button).
  - Click → inline form: Input type=email + Сохранить + Отмена. text-base (16px).
  - Submit → supabase.functions.invoke('tutor-account', { body: { action: 'update-email', email } }).
  - На success → toast + supabase.auth.refreshSession() + collapse form.
- Password row: "Изменить пароль" (ghost button).
  - Click → collapse с 2 Input type=password (новый + подтвердить) + Сохранить + Отмена.
  - Валидация: ≥ 8 символов, confirm === new.
  - Submit → invoke('tutor-account', { body: { action: 'update-password', password } }).
  - На success → toast + collapse.
- Telegram row: "Telegram" + @username из profiles (read-only, без кнопки).

Acceptance Criteria: AC-2, AC-3.

Guardrails:
- text-base на всех input.
- min-h-[44px].
- Не логировать password.
- password input — autoComplete="new-password".
- НЕ показывать current email в URL/query.

Validation:
- npm run lint && npm run build.
- Dev: изменить email, logout, login с новым email — работает. Изменить password, login со старым — 401.

End block.
```

### Prompt TASK-13: SubjectsMultiSelect

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- src/types/homework.ts (SUBJECTS export, строки 9-31)
- docs/delivery/features/tutor-profile/spec.md (секция 6 UX/UI)

Задача:
1. Создать src/components/tutor/profile/SubjectsMultiSelect.tsx.
2. Подключить в TutorProfile.tsx отдельной секцией между Identity и Security.

Component:
- Props: { value: string[]; onChange: (subjects: string[]) => void; }
- Рендер: label "Предметы, которые я преподаю" + flex flex-wrap gap-2.
- Каждый SUBJECTS[i] → button role="button" aria-pressed={isSelected}:
  - Selected: bg-accent text-white.
  - Not selected: bg-white border border-slate-200 text-slate-700.
  - Текст: {subject.name}.
  - min-h-[44px] px-4 rounded-full.
- Click toggle id в value.
- Space/Enter keyboard support.

Интеграция в TutorProfile.tsx:
- Local state subjects (from profile.subjects).
- Dirty tracking: isDirty если subjects меняются.
- Кнопка сохранения — переиспользовать из Identity section (один Save для обоих, или локальная per-секция — выбери).

Acceptance Criteria: — (P1, не в обязательных AC, но важно для P1.3 Job).

Guardrails:
- Импортировать SUBJECTS из @/types/homework (не захардкодить).
- Показывать subject.name, не subject.id.
- Никаких emoji.
- Touch target ≥ 44px.

Validation:
- npm run lint && npm run build.
- Dev: выбрать "Физика" + "Математика" → save → refresh → чипы активны.

End block.
```

### Prompt TASK-14: Edge function tutor-telegram-avatar-prefill

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- docs/delivery/features/tutor-profile/spec.md (секция 8 Risks — Telegram URL риски!)
- supabase/functions/tutor-account/index.ts (TASK-11 — паттерн)
- supabase/functions/telegram-bot/index.ts (паттерн fetch Telegram файлов через bot API)

Задача: создать supabase/functions/tutor-telegram-avatar-prefill/index.ts.

Flow (все через service role):
1. Auth check: user.id из JWT. Если не tutor (is_tutor RPC) → 403.
2. Body validation: { telegram_photo_url: string } — должен быть https, hostname t.me или telegram.org (whitelist).
3. SELECT avatar_url FROM tutors WHERE user_id = auth.uid(). Если NOT NULL → return 200 { skipped: true, reason: 'already_set' }.
4. Fetch telegram_photo_url с AbortController timeout 10 сек.
   - НЕ сохранять URL ни в каком виде, кроме временной переменной.
   - На ошибку (4xx/5xx/timeout) → return 200 { skipped: true, reason: 'tg_fetch_failed' } (не 500 — не ломаем login).
5. Получить ArrayBuffer, contentType. Если contentType не image/* → skip.
6. Size check: если > 2 МБ → skip (compression в Deno без sharp сложна — принимаем как parking lot).
7. Generate path: avatars/<user_id>/<uuid>.jpg (suffix из contentType если не jpeg).
8. storage.from('avatars').upload(path, blob, { contentType, upsert: false }).
9. Получить public URL.
10. UPDATE tutors SET avatar_url = <public_url> WHERE user_id = auth.uid() AND avatar_url IS NULL (race-safe WHERE).
11. Return 200 { success: true, avatar_url }.

Acceptance Criteria: AC-7.

Guardrails:
- НИКОГДА не сохранять telegram_photo_url в БД.
- Timeout на fetch обязательно.
- НЕ логировать telegram_photo_url.
- Whitelist hostname — защита от SSRF.
- Не ломать login flow ни на какой ошибке.

Validation:
- supabase functions deploy tutor-telegram-avatar-prefill.
- curl --data '{"telegram_photo_url":"https://t.me/..."}' — пройти авторизацию и убедиться в UPDATE.

End block.
```

### Prompt TASK-15: TelegramLoginButton integration + toast consent

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

ВНИМАНИЕ: TelegramLoginButton.tsx — high-risk file (CLAUDE.md). Минимальные изменения.

Прочитай:
- src/components/TelegramLoginButton.tsx (полностью)
- TASK-14 output (tutor-telegram-avatar-prefill endpoint)
- docs/delivery/features/tutor-profile/spec.md (секция 8 Risks — privacy toast)

Задача: добавить async вызов tutor-telegram-avatar-prefill после успешного login если user — tutor и у него нет avatar.

Изменения:
1. После существующего `is_tutor === true` флоу (который redirect'ит на tutor dashboard):
   - Если TG widget вернул photo_url И user — tutor:
     - async fetch('/functions/v1/tutor-telegram-avatar-prefill', { method: 'POST', body: JSON.stringify({ telegram_photo_url: photo_url }), headers: { authorization } }).
     - .then(res => res.ok && res.json())
     - Если response.success === true → toast.info('Твоё фото из Telegram использовано как аватар. Изменить можно в профиле.', { action: { label: 'Профиль', onClick: () => navigate('/tutor/profile') } }).
     - На ошибку или skipped — ничего (silent).
   - Вызов НЕ БЛОКИРУЕТ redirect — параллельно.

2. Использовать try-catch с .catch(() => {}) — никакая ошибка не должна сломать login.

Acceptance Criteria: AC-7.

Guardrails:
- НЕ трогать existing login logic (только добавить блок).
- НЕ await выполнения prefill перед redirect.
- Toast показывать только на success (не на skipped/error).
- photo_url НЕ логировать.

Validation:
- npm run lint && npm run build.
- Dev: залогиниться как новый tutor через Telegram → avatar появляется в профиле + toast.
- Повторный login того же tutor → toast НЕ показывается (skipped: already_set).

End block + self-check: не сломан ли student-login flow, не сломан ли логин tutor без photo_url.
```

---

## Definition of Done (для всей фичи Phase 1-3)

1. ✅ Все TASK-1 .. TASK-15 выполнены
2. ✅ Все 10 AC из spec.md проходят
3. ✅ `npm run lint && npm run build && npm run smoke-check` зелёные после каждой задачи
4. ✅ Codex review каждой фазы (separate session, read spec + AC + git diff) → PASS / CONDITIONAL PASS
5. ✅ Manual smoke: Windows+Chrome, iPhone+Safari, macOS+Safari
6. ✅ Egor pilot feedback после Phase 1 (неделя 1 after deploy)
7. ✅ CLAUDE.md обновлён с правилами для будущих агентов (ключевой рецепт для tutor profile)

---

## Post-implementation updates

После merge каждой фазы:

- **Phase 1:** добавить секцию в CLAUDE.md "Tutor Profile — identity, аватары, storage" (как работают placeholders, RLS, query key).
- **Phase 2:** добавить краткое упоминание tutor-account в секции "Edge functions".
- **Phase 3:** упомянуть Telegram auto-prefill flow + риск ротации TG URL в CLAUDE.md.
