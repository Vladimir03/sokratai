# Tasks: Tutor Profile (Аватар, Имя, Предметы) + Telegram-style Identity в Guided Chat

**Spec:** [spec.md](./spec.md) (v0.2)
**Mockup:** [mockup.html](./mockup.html) (S1–S4)
**Дата нарезки:** 2026-04-15 · обновлено 2026-05-05 (Phase 4 Google OAuth)
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

Phase 3 (P1): Telegram avatar auto-prefill
├── TASK-14 Bot-side prefill in telegram-bot      [Claude Code]      deps: Phase 1
└── TASK-15 TelegramLoginButton no-op             [Claude Code]      deps: TASK-14

Phase 4 (P1): Google OAuth (added v0.2; v0.4 — aligned with shipped RU-bypass flow)
├── TASK-16 Google provider config (devops)         [Vladimir]   ✅ Done (custom RU-bypass)
├── TASK-17 GoogleAuthButton + Login/SignUp wire    [Claude]     ✅ Done (5 entry points)
├── TASK-18 useUserIdentities + 3-state Security    [Claude]     ✅ Done (incl. partial
│                                                                  TASK-19 backend:
│                                                                  set-password-google-only)
└── TASK-19 LoginProvidersSection + remaining actions [Claude]    pending (unlink-identity
        (unlink-identity, ⚠️ RU-bypass linkIdentity)                + LoginProvidersSection
                                                                    UI + RU-bypass link path)
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
**Status:** ✅ Done — `UserAvatar` создан на Radix Avatar, SVG placeholders добавлены в `public/`, `npm run build` проходит; `npm run lint` блокируется существующим repo-wide lint debt.

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

### TASK-6: Tutor chrome avatar (SideNav + MobileTopBar) [v0.3 fix]

**Job:** P1.3
**Agent:** Claude Code
**Files:** `src/components/tutor/chrome/SideNav.tsx` + `src/components/tutor/chrome/MobileTopBar.tsx` (модифицировать)
**AC:** AC-1a

**Что делает (после v0.3 review fix — было ошибочно `Navigation.tsx`):**

**SideNav.tsx (desktop chrome):**
- Memo'd `ProfileNavItem` компонент в том же файле.
- Использует `t-nav__item` класс (тот же что у NavItem).
- Avatar 16×16 (slot-sized под Lucide, через `inline-flex h-4 w-4` обёртку и `className="h-4 w-4 text-[8px]"` на UserAvatar).
- Рендерится в `t-nav__footer` **над** logout button.
- `useLocation` для active state (`pathname.startsWith('/tutor/profile')`).
- `useTutorProfile()` для name+avatar+gender.
- Tooltip `Профиль · {tutors.name}` если name есть, иначе просто «Профиль».

**MobileTopBar.tsx (mobile chrome):**
- `<Link to="/tutor/profile">` между brand и logout.
- 44×44 wrapper (`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full focus-visible:ring`) вокруг 32×32 UserAvatar (size="sm").
- `useTutorProfile()` тот же hook.
- aria-label «Открыть профиль» + tooltip с именем.

**Guardrails:**
- НЕ модифицировать `src/components/Navigation.tsx` для feature-scope (это student chrome, tutor его не видит внутри `/tutor/*` AppFrame).
- `useTutorProfile()` mounted внутри AppFrame, AppFrame уже TutorGuard'ed → хук не fire'ит для не-tutor.
- Не ломать existing layout (`t-nav__footer` order, `t-mobile-top` flex row).
- Не перекидывать avatar в dropdown-menu (scope OUT).
- НЕ создавать дублированный entry point — один компонент в каждом chrome (desktop + mobile).

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
**Status:** ✅ Done — `handleGetThread` возвращает top-level `tutor_profile`; per-message контракт не менялся. Local deploy/curl не выполнены: `supabase` CLI не установлен локально.

**Что делает:**
- В `handleGetThread` (student variant) — после основного SELECT тред:
  1. `SELECT tutor_id FROM homework_tutor_assignments WHERE id = <assignment_id>` (фактическая схема: `tutor_id` здесь = `auth.users.id`, не `tutors.id`).
  2. `SELECT name, avatar_url, gender FROM tutors WHERE user_id = <tutor_id>`.
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
**Status:** ✅ Done — `HomeworkThread` получил optional `tutor_profile`; `getThread`/student homework thread path type-safe прокидывает backend field, legacy response без поля не падает; direct SELECT messages теперь забирает `author_user_id`.

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
**Files:** `supabase/functions/tutor-account/index.ts` (новый), `supabase/config.toml` (добавлен `[functions.tutor-account] verify_jwt = true`), `.github/workflows/deploy-supabase-functions.yml` (добавлен `supabase functions deploy tutor-account`)
**AC:** AC-2, AC-3
**Status:** ✅ Done (2026-05-06) — `tutor-account` зеркалит `student-account`, добавлен role-check через RPC `is_tutor(_user_id)` после JWT auth (non-tutor → 403). `update-email` (regex strict, `email_confirm: true`) и `update-password` (min 8 chars). Не логирует email/password. Lint clean, build green. Code review (ChatGPT-5.5) пройден после фикса BLOCKER 2 (config.toml + workflow).

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
**Status:** ✅ Done (2026-05-06) — Email row (read-only display + inline form), Password row (collapsed → 2-input form, ≥ 8 chars + match), Telegram row read-only (`@username` из `profiles.telegram_username`). Wrapped-error guard (`data?.error`) добавлен в оба submit'а после code review (BLOCKER 1). `text-base` 16px на input, `min-h-[44px]` на всё, `autoComplete="new-password"` на password. После `update-email` — `await supabase.auth.refreshSession()` до toast.

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
**AC:** AC-1b
**Status:** ✅ Done (2026-05-06) — multi-select chips из `SUBJECTS`, `aria-pressed`, keyboard Enter/Space, `min-h-[44px]`. `toggleSubject` теперь канонизирует output по порядку `SUBJECTS` каталога (BLOCKER 3 фикс — save-order детерминированный, не toggle-history-зависимый). `serializeSubjects` в `TutorProfile.tsx` тоже sort'ит по canonical order для стабильного dirty-check. AC-1b в spec уточнён: canonical id для математики — `maths` (не `math`); save производит `['maths','physics']` regardless of click order.

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

### TASK-14: Bot-side Telegram avatar prefill

**Job:** P1.3, P2.2
**Agent:** Claude Code
**Files:** `supabase/functions/telegram-bot/index.ts` (high-risk, минимальный diff)
**AC:** AC-7
**Status:** Implemented 2026-05-06 via bot-side architecture review fix.

**Что делает:**
- Выполняется после успешного `handleWebLogin` для tutor.
- Проверяет `SELECT avatar_url FROM tutors WHERE user_id = <profile.id>` — если не NULL → skip (идемпотентность).
- Flow:
  1. `getUserProfilePhotos(user_id, limit=1)` через Bot API.
  2. `getFile(file_id)` через Bot API.
  3. `fetch https://api.telegram.org/file/bot<TOKEN>/<file_path>` server-side с таймаутом 10 сек.
  4. Если 4xx/5xx/timeout/no-photo/non-image/>2MB → silent skip (не fail'ить login).
  5. Upload в `avatars/<user_id>/<uuid>.<ext>` через service role.
  6. `UPDATE tutors SET avatar_url = <public_url> WHERE user_id = <profile.id> AND avatar_url IS NULL`.

**Guardrails:**
- НИКОГДА не сохранять Telegram URL / Bot API file URL напрямую — только наш storage URL.
- НЕ передавать Bot API file URL или bot token через browser/client.
- Graceful на любой фейл (не ломать login).
- Не логировать Telegram URL / file path / bot token.
- Timeout на fetch обязателен.

---

### TASK-15: TelegramLoginButton integration

**Job:** P1.3, P2.2
**Agent:** Claude Code
**Files:** `src/components/TelegramLoginButton.tsx` (модифицировать)
**AC:** AC-7
**Status:** Completed 2026-05-06 as no-op; client-side `photo_url` plumbing intentionally removed.

**Что делает:**
- No-op после architecture review: bot deep-link flow не имеет `photo_url` на клиенте.
- `TelegramLoginButton.tsx` не должен вызывать avatar prefill endpoint. Avatar prefill выполняется server-side в TASK-14.

**Guardrails:**
- `TelegramLoginButton.tsx` помечен как high-risk в CLAUDE.md — не трогать без отдельной необходимости.
- Student-login flow и tutor-login без Telegram фото не должны измениться.

---

## Phase 4 (P1) — Google OAuth (added v0.2)

### TASK-16: Google провайдер в Supabase Dashboard + Google Cloud Console

**Job:** P1.3
**Agent:** Vladimir (devops, не код)
**Files:** — (только конфигурация)
**AC:** AC-11 (prerequisite)
**Status:** ✅ Done (предшествовало этой спеке) — реализовано через **custom RU-bypass flow**, не через Supabase native `signInWithOAuth`. Authorized redirect URI в Google Cloud Console = `https://api.sokratai.ru/functions/v1/oauth-google-callback` (НЕ `vrsseotrfmsxpbciyqzc.supabase.co/auth/v1/callback`, который заблокирован в РФ). Supabase Dashboard → Authentication → Providers → Google остаётся **disabled** — мы его не используем; OAuth2 client_id/secret переданы непосредственно в edge function как secrets `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` + `OAUTH_STATE_SECRET`. См. документацию в шапке `src/components/GoogleAuthButton.tsx` (история v1→v2→v3).

**Что делает:**

1. **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com/)):
   - Создать проект «SokratAI» (или использовать существующий).
   - APIs & Services → OAuth consent screen → External, заполнить app name «Сократ AI», support email, logo (png 120×120 из `src/assets/sokrat-logo.png`).
   - Scopes: `email`, `profile`, `openid` (default OAuth scopes, ничего больше).
   - APIs & Services → Credentials → Create OAuth 2.0 Client ID → Web application.
   - Authorized JavaScript origins: `https://sokratai.ru`, `https://sokratai.lovable.app`, `http://localhost:8080` (dev).
   - Authorized redirect URIs: `https://vrsseotrfmsxpbciyqzc.supabase.co/auth/v1/callback` **обязательно** (Supabase auth-callback URL — не наш custom domain).
   - Сохранить `client_id` + `client_secret`.

2. **Supabase Dashboard** ([supabase.com](https://supabase.com/dashboard)):
   - Authentication → Providers → Google → Enable.
   - Вставить `client_id` + `client_secret`.
   - Сохранить.

3. **Документировать в CLAUDE.md** (отдельным PR после Phase 4 merge): секция «OAuth providers» — Google enabled, как ротировать credentials.

**Guardrails:**
- НЕ коммитить `client_id` / `client_secret` в репо.
- НЕ использовать одни и те же credentials для prod и dev — выпустить два отдельных OAuth client.
- Test scope = `openid email profile`. НЕ запрашивать calendar / drive / etc. — у нас нет use-case'а и это пугает на consent screen.

**Validation:**
- На `/login` после Phase 4 deploy — кнопка «Войти через Google» → click → redirect на `accounts.google.com` → success → возврат на `/auth/callback` → авторизованная сессия.
- В Supabase Dashboard → Authentication → Users — новый user с identity `provider = google`.

---

### TASK-17: GoogleAuthButton + интеграция в Login/SignUp/TutorLogin/TutorSignupTrial/RegisterTutor

**Job:** P1.3
**Agent:** Claude Code
**Files:** `src/components/GoogleAuthButton.tsx` (создан), `src/pages/Login.tsx`, `src/pages/SignUp.tsx`, `src/pages/TutorLogin.tsx`, `src/pages/TutorSignupTrial.tsx`, `src/pages/RegisterTutor.tsx` (все интегрированы)
**AC:** AC-11
**Status:** ✅ Done (предшествовало этой спеке) — реализовано как **`GoogleAuthButton.tsx`** (custom RU-bypass), а не как `GoogleSignInButton.tsx` с native `signInWithOAuth`, как было ошибочно описано в исходной формулировке таска. Реальная архитектура:

- **Кнопка:** `src/components/GoogleAuthButton.tsx`. Inline 4-цветный Google SVG, `min-h-[48px]` (`style={{minHeight:48}}`), `touch-action: manipulation`, props `redirectPath` (куда вернуться после OAuth) + `consentSource` (тэг для consent record) + `enabled` (gated by consent checkbox). НЕ использует `supabase.auth.signInWithOAuth` — вместо этого редиректит на `https://api.sokratai.ru/functions/v1/oauth-google-init?redirectTo=${origin}${redirectPath}`.
- **Edge functions:** `oauth-google-init` (302 на Google с `redirect_uri=api.sokratai.ru/.../oauth-google-callback`) и `oauth-google-callback` (server-side code→token exchange + magic-link verifyOtp + 302 обратно на `redirectPath` с access_token/refresh_token в URL hash). Обе зарегистрированы в `supabase/config.toml` и `.github/workflows/deploy-supabase-functions.yml`.
- **Никакого `/auth/callback` React-route не нужно** — `oauth-google-callback` возвращает токены прямо в hash целевой страницы, supabase-js auto-detects через `detectSessionInUrl: true`. Каждая landing page (`Login.tsx`, `SignUp.tsx` и т.д.) уже подписана на `onAuthStateChange("SIGNED_IN")` для consent apply + redirect.
- **Consent integration:** `stashPendingConsent(consentSource)` перед redirect; `applyPendingConsent(user.id)` в `onAuthStateChange("SIGNED_IN")` mount-effect каждой page.
- **Интеграции (все заработали):** Login (`/chat`), SignUp (`/chat`), TutorLogin (`/tutor/home`), TutorSignupTrial (`/tutor/home`), RegisterTutor.

**Почему отклонились от исходного описания:** native `supabase.auth.signInWithOAuth({ provider: 'google' })` форсит `redirect_uri = vrsseotrfmsxpbciyqzc.supabase.co/auth/v1/callback`, который заблокирован у RU-провайдеров (см. CLAUDE.md «Network & Infrastructure»). История переходов задокументирована в `GoogleAuthButton.tsx:11–35` (v1: `oauth.lovable.app` → 403 для RU; v2: native Supabase OAuth → RU-блок callback'а; v3: текущий custom flow).

**Validation выполнен:** работает в prod на `sokratai.ru` для всех 5 entry points; новые users видны в `auth.users` с identity `provider=google`.

---

### TASK-18: useUserIdentities hook + 3-state SecuritySection

**Job:** P1.3
**Agent:** Claude Code
**Files:** `src/hooks/useUserIdentities.ts` (новый), `src/components/tutor/profile/SecuritySection.tsx` (модифицировать), `supabase/functions/tutor-account/index.ts` (small TASK-19 bleed-in: добавлен action `set-password-google-only`)
**AC:** AC-11, AC-13
**Status:** ✅ Done (2026-05-06) — `useUserIdentities` (`['auth','identities']`, staleTime 60s) читает `supabase.auth.getUserIdentities()` и резолвит `hasEmailPassword/hasGoogle/hasTelegram`. `SecuritySection` теперь branch'ит на 3 state'а: A (email-only — прежний UI), B (google-only — Email row read-only с inline Google pill, password row **удалён из DOM**, amber CTA «Установить пароль» с inline 2-input form), C (mixed — как A + `window.confirm` warning перед email change что Google перепишет email обратно). Loading state — три серых блока `h-10` без animate. State B → C transition: `set-password-google-only` action в `tutor-account` валидирует ≥8 chars, проверяет что `email` identity ещё нет (иначе 400 `PASSWORD_ALREADY_SET`), вызывает `admin.updateUserById({password})`, что создаёт `email` identity server-side. После success — `invalidateQueries(['auth','identities'])` → секция перерисовывается в C. Telegram row не зависит от auth state (Telegram — кастомный flow, не Supabase identity, см. v0.4 §3 п.5).

**Что делает:**

- `useUserIdentities.ts`:
  - `useQuery` с key `['auth','identities']`, queryFn вызывает `supabase.auth.getUserIdentities()`.
  - Возвращает `{ identities: Identity[], hasEmailPassword: boolean, hasGoogle: boolean, hasTelegram: boolean, isLoading, error }`.
  - `hasEmailPassword` = `identities.some(i => i.provider === 'email')`.
  - `hasGoogle` = `identities.some(i => i.provider === 'google')`.
  - `hasTelegram` = `identities.some(i => i.provider === 'telegram')` (если Telegram вообще регистрируется как identity — иначе fallback на `profiles.telegram_user_id`).
  - staleTime 60 сек.

- `SecuritySection.tsx` (расширение из TASK-12):
  - Считать состояние: A = `hasEmailPassword && !hasGoogle`, B = `!hasEmailPassword && hasGoogle`, C = `hasEmailPassword && hasGoogle` (на практике редко, но возможен D = только Telegram — обрабатывать как A без password ряда).
  - **A:** прежний UI (email row editable + password row editable). Уже сделан в TASK-12.
  - **B:** email row read-only с pill «Google» (mockup S4-B). Заменить password row на amber-полоску с inline CTA «Установить пароль» → раскрывает new+confirm form → submit через `tutor-account` action `set-password-google-only` (TASK-19).
  - **C:** как A (оба ряда editable). Email editable, но email change приведёт к расхождению с Google — добавить confirm dialog «Email изменится на твой, но при следующем входе через Google он перепишется обратно. Точно изменить?».
  - Loading-state useUserIdentities → show skeleton всей секции «Безопасность».

**Guardrails:**
- НЕ дублировать логику резолва identities — только через hook.
- В состоянии B password ряд **полностью отсутствует** в DOM (не просто disabled) — иначе скринридер прочитает пустое поле.
- НЕ инвалидировать `['auth','identities']` после `setPassword` сам по себе — это не меняет identities в Supabase. Инвалидировать после `linkIdentity` / `unlinkIdentity` (TASK-19).

**Validation:**
- `npm run lint && npm run build`.
- Manual: создать user через Google → /tutor/profile → SecuritySection в состоянии B. Установить пароль → состояние C.
- Створки в DevTools: `await supabase.auth.getUserIdentities()` — увидеть массив.

---

### TASK-19: LoginProvidersSection + tutor-account новые actions (set-password-google-only, unlink-identity)

**Job:** P1.3
**Agent:** Claude Code
**Files:** `src/components/tutor/profile/LoginProvidersSection.tsx` (новый), `src/pages/tutor/TutorProfile.tsx` (модифицировать — подключить), `supabase/functions/tutor-account/index.ts` (модифицировать — добавить 2 actions)
**AC:** AC-12, AC-13

**Что делает:**

- `LoginProvidersSection.tsx`:
  - Использует `useUserIdentities` (TASK-18).
  - Список из 2 provider-row (mockup S4): Google + Telegram. Каждая row — иконка + label + статус («Привязан» badge ИЛИ кнопка «Привязать»).
  - **Привязан + есть ≥ 1 другой identity (или password) → кнопка «Отвязать»** (red ghost, btn--xs btn--unlink). Click → confirm dialog «Отвязать Google? Ты сможешь войти только через {другой способ}». Submit → `supabase.functions.invoke('tutor-account', { body: { action: 'unlink-identity', provider: 'google' } })` → invalidate `['auth','identities']`.
  - **Привязан + last identity → «Отвязать» disabled** с tooltip «Сначала установи пароль или привяжи другой способ входа». Без вызова сервера.
  - **Не привязан → кнопка «Привязать»**. ⚠️ **RU-bypass для link** (см. TASK-17 Status): `supabase.auth.linkIdentity({ provider: 'google' })` форсит native `<project>.supabase.co/auth/v1/callback` который заблокирован в РФ. Реализатору нужно расширить `oauth-google-init` принимать `mode=link&user_id=<auth.uid()>` (защищённый JWT-токеном), а `oauth-google-callback` — вместо magic-link verifyOtp вызывать `supabaseAdmin.auth.admin.updateUserById(user_id, { user_metadata: ... })` или эквивалент привязки идентичности. Иначе link/unlink будет ломаться у RU-репетиторов. Возврат на профиль через `redirectTo=/tutor/profile`, локальный invalidate `['auth','identities']` по `onAuthStateChange("SIGNED_IN")` или page-mount refetch.

- `tutor-account/index.ts`:
  - ✅ Action `set-password-google-only` — **уже добавлен в TASK-18** (валидация ≥ 8 chars + check что `email` identity отсутствует через `auth.admin.getUserById` → 400 `PASSWORD_ALREADY_SET` если есть, иначе `auth.admin.updateUserById({password})` создаёт identity server-side).
  - ⏳ Action `unlink-identity` — **остаётся для этого таска**: body `{ provider: 'google' | 'telegram' }`. Fetch user identities → если после удаления провайдера остаётся `identities.length === 0` ИЛИ (`hasOnlyEmail = identities.length === 1 && identities[0].provider === 'email'` И password не задан) → return 400 `LAST_IDENTITY` с message «Установи пароль или привяжи другой способ входа». Иначе `supabaseAdmin.auth.admin.deleteIdentity(targetIdentity.id)` (Supabase admin API).
  - Tutor role check (`is_tutor` RPC) уже встроен в edge function — наследуется обоими actions.

- `TutorProfile.tsx`:
  - Подключить `<LoginProvidersSection />` под `<SecuritySection />`.

**Guardrails:**
- **Двойной last-identity guard** обязателен: UI и server. Обход одного должен быть пойман другим.
- НЕ удалять identity напрямую с клиента — только через edge function.
- НЕ логировать `provider`-specific токены / refresh tokens.
- При `unlink-identity` success — toast «Google отвязан» + invalidate `['auth','identities']` чтобы UI обновился.
- `linkIdentity` для Google инициирует OAuth-redirect — пользователь уйдёт со страницы профиля. Сохранить return-path в localStorage чтобы вернуться после `/auth/callback`.

**Validation:**
- `npm run lint && npm run build`.
- Manual flow: A → user добавляет Google (Привязать) → C → user отвязывает Google (Отвязать) → A. Затем: A → user отвязывает Telegram (если был) → проверить что пытается отвязать password identity (если только она остаётся) → блокируется.
- Edge case: B (только Google) → попытка unlink Google через DevTools-fetch напрямую → 400 `LAST_IDENTITY` от server.

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
2. SELECT tutor_id FROM homework_tutor_assignments WHERE id = <assignment_id>. В текущей production-схеме `homework_tutor_assignments.tutor_id` хранит `auth.users.id` репетитора, не `tutors.id`. (Если уже тянется с тредом — не делать повторный запрос.)
3. SELECT name, avatar_url, gender FROM tutors WHERE user_id = <tutor_id> (service role).
4. Собрать tutor_profile: {
     display_name: tutors.name || fallback-from-profiles-username || null,
     avatar_url: tutors.avatar_url || null,
     gender: tutors.gender || null
   }
   Если display_name резолвится в null и username тоже null → tutor_profile = null.
5. Добавить в top-level response: { ...existing, tutor_profile }.

Fallback для display_name: если tutors ряда нет → SELECT username FROM profiles WHERE id = tutor_id.

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

### Prompt TASK-14: Bot-side Telegram avatar prefill

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Прочитай:
- docs/delivery/features/tutor-profile/spec.md (секция 8 Risks — Telegram URL риски!)
- supabase/functions/telegram-bot/index.ts (паттерн fetch Telegram файлов через bot API)

Задача: добавить bot-side auto-prefill аватара в supabase/functions/telegram-bot/index.ts::handleWebLogin.

Flow:
1. После успешного web-login token update и success-message вызвать helper `prefillTutorAvatarFromTelegram(telegramUserId, profile.id)`.
2. Helper через service role читает `SELECT avatar_url FROM tutors WHERE user_id = profile.id`. Если строки нет или avatar_url NOT NULL → silent skip.
3. Через Bot API:
   - `getUserProfilePhotos(user_id, limit=1)`.
   - выбрать крупнейший `PhotoSize` ≤ 2 МБ, если есть `file_size`.
   - `getFile(file_id)`.
4. Скачать `https://api.telegram.org/file/bot<TOKEN>/<file_path>` server-side с AbortController timeout 10 сек.
5. Если 4xx/5xx/timeout/non-image/>2MB → silent skip (не ломаем login).
6. Upload в bucket `avatars` path `<user_id>/<uuid>.<ext>` через service role.
7. Получить public URL, rewrite через `rewriteToProxy`.
8. `UPDATE tutors SET avatar_url = <public_url> WHERE user_id = profile.id AND avatar_url IS NULL` (race-safe WHERE).
9. На success отправить одноразовое Telegram message: `Твоё фото из Telegram использовано как аватар. Изменить или удалить можно в профиле: https://sokratai.ru/tutor/profile`.

Acceptance Criteria: AC-7.

Guardrails:
- НИКОГДА не сохранять Telegram URL / Bot API file URL в БД.
- НЕ передавать Bot API URL или bot token через browser/client.
- Timeout на fetch обязательно.
- НЕ логировать Telegram URL / file_path / bot token.
- Не ломать login flow ни на какой ошибке.

Validation:
- Deploy `telegram-bot`.
- Dev: залогиниться как новый tutor через Telegram → avatar появляется в профиле + bot-message.
- Повторный login того же tutor → avatar не переписывается, bot-message не повторяется.

End block.
```

### Prompt TASK-15: TelegramLoginButton no-op

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

ВНИМАНИЕ: TelegramLoginButton.tsx — high-risk file (CLAUDE.md). Минимальные изменения.

Прочитай:
- src/components/TelegramLoginButton.tsx (полностью)
- TASK-14 output (bot-side avatar prefill)
- docs/delivery/features/tutor-profile/spec.md (AC-7)

Задача: не добавлять client-side avatar prefill.

Reason:
- SokratAI использует bot deep-link login, не Telegram Login Widget.
- `photo_url` не существует в client response.
- Avatar prefill выполняется server-side в `telegram-bot::handleWebLogin`.

Acceptance Criteria: AC-7.

Guardrails:
- НЕ трогать existing login logic.
- НЕ добавлять `photo_url` plumbing.
- НЕ передавать Bot API URL/token в client.

Validation:
- npm run lint && npm run build.
- Self-check: student-login flow не сломан; tutor login без Telegram photo не сломан.

End block.
```

### Prompt TASK-17: GoogleSignInButton + Login/SignUp + AuthCallback

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: Phase 4 фичи tutor-profile добавляет Google OAuth как альтернативу email+password. Это P1 — не блокирует Phase 1-3.

Прочитай:
- docs/delivery/features/tutor-profile/spec.md (v0.2, особенно §3 п.5 про OAuth flow + §6 описание секций)
- docs/delivery/features/tutor-profile/mockup.html surface S4 (3 состояния «Безопасность»)
- src/pages/Login.tsx, src/pages/SignUp.tsx (полностью — понять как сейчас выглядит email-форма)
- src/components/TelegramLoginButton.tsx (полностью — подсмотреть паттерн post-login claim invite)
- src/lib/inviteApi.ts (claimPendingInvite — понадобится в AuthCallback)
- CLAUDE.md (секция «Web invite flow» — Telegram заблокирован в РФ, важно не сломать)
- .claude/rules/90-design-system.md (кнопки, spacing)

Задача:
1. Создать src/components/auth/GoogleSignInButton.tsx.
2. Подключить в src/pages/Login.tsx и src/pages/SignUp.tsx (под существующей email-формой).
3. Создать или модифицировать src/pages/AuthCallback.tsx для обработки OAuth redirect.

GoogleSignInButton.tsx:
- Inline Google brand SVG (4 цвета: #4285F4 / #34A853 / #FBBC05 / #EA4335) + label «Войти через Google».
- min-h-[44px], bg-white border border-slate-200, hover:bg-slate-50, text-slate-700 font-medium, w-full, rounded-md, gap-3, flex items-center justify-center.
- onClick → supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } }).
- Loading state — disabled + spinner справа от лейбла.
- Перед redirect сохранить window.location.pathname в localStorage 'oauth_return_to' (если ≠ /login и ≠ /signup) для возврата после callback.

Login.tsx / SignUp.tsx:
- Найти существующий submit-блок email-формы.
- ПОД ним добавить divider («или» с двумя hr) + <GoogleSignInButton /> + <TelegramLoginButton /> (если последний уже есть, не дублировать).
- НЕ менять существующую email-логику.
- Если Login.tsx помечен как high-risk в CLAUDE.md — touch минимально, только append блок.

AuthCallback.tsx:
- Если файл уже существует — добавить (если нет) claimPendingInvite() после getSession().
- Если нет — создать страницу + зарегистрировать route /auth/callback в App.tsx (без TutorGuard / AuthGuard, route публичный).
- Логика mount:
  1. Дождаться supabase.auth.getSession() (poll до 5 сек, потом fail).
  2. Если session.user → call claimPendingInvite() (best-effort, ignore error).
  3. Прочитать localStorage 'oauth_return_to' → удалить ключ.
  4. Если return-path есть и не пустой → navigate(return-path).
  5. Иначе useTutorAccess (или прямо select из profiles) → if isTutor → navigate('/tutor/home'), else navigate('/students').
- UI: централированный spinner + текст «Завершаем вход…».

Acceptance Criteria: AC-11.

Guardrails:
- НЕ показывать error_description от Google напрямую (может содержать sensitive). Generic toast «Не удалось войти через Google. Попробуй снова или выбери другой способ.».
- НЕ дублировать signInWithOAuth логику в нескольких местах — только в кнопке.
- НЕ ломать существующий Telegram flow (web-invite через РФ-bypass).
- redirectTo обязательно с window.location.origin (не hardcode prod-URL — иначе сломает dev и Lovable preview).
- AuthGuard / TutorGuard не модифицировать.

Validation:
- npm run lint && npm run build.
- Localhost dev: на /login появилась Google-кнопка (визуально соответствует mockup S4 login-strip).
- Прежде чем тестировать живой OAuth — убедиться что TASK-16 сделана Vladimir'ом (provider настроен в Supabase + Google Cloud Console authorized origin = localhost:8080).

End block: changed files, summary, validation output, self-check (Login/SignUp не сломаны, Telegram flow не задет, AuthGuard не тронут).
```

### Prompt TASK-18: useUserIdentities hook + 3-state SecuritySection

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: Phase 4 — расширяем существующую SecuritySection (TASK-12) на 3 состояния по типу identity. user без password (Google-only) видит другой UI.

Прочитай:
- docs/delivery/features/tutor-profile/spec.md v0.2 (§6 п.3 — 3 состояния A/B/C)
- docs/delivery/features/tutor-profile/mockup.html surface S4 (визуальный референс)
- src/components/tutor/profile/SecuritySection.tsx (существующая реализация TASK-12 — состояние A)
- src/lib/supabaseClient.ts (canonical client)
- TASK-17 output (Login flow с Google — context для understanding identities)
- CLAUDE.md performance.md §2c (query key конвенция)

Задача:
1. Создать src/hooks/useUserIdentities.ts.
2. Расширить src/components/tutor/profile/SecuritySection.tsx — добавить branch'и B и C.

useUserIdentities.ts:
- useQuery с key ['auth','identities'] (новый scope, не tutor — это auth-domain).
- queryFn: const { data, error } = await supabase.auth.getUserIdentities(); если error → throw; вернуть data.identities ?? [].
- Возвращает:
  {
    identities: UserIdentity[],
    hasEmailPassword: boolean,  // identities.some(i => i.provider === 'email')
    hasGoogle: boolean,
    hasTelegram: boolean,
    isLoading,
    error
  }
- staleTime: 60_000 (60 сек — identity редко меняется).

SecuritySection.tsx (расширение):
- В начале компонента: const { hasEmailPassword, hasGoogle, isLoading: identitiesLoading } = useUserIdentities();
- Loading-state — skeleton всей секции (простые серые блоки h-10 — без bounce, см. performance.md).
- Branch:
  - **A (hasEmailPassword && !hasGoogle):** прежний UI без изменений.
  - **B (!hasEmailPassword && hasGoogle):**
    - Email row: read-only с inline pill «Google» справа (mockup S4-B: pill-google class style). Без кнопки «Изменить».
    - НЕТ password row (полностью убрать из DOM, не рендерить).
    - Под email row: amber-полоска с Lucide AlertTriangle + текст «Пароль не задан. Без него ты сможешь войти только через Google.» + ссылка-cta «Установить пароль →» (open inline form).
    - Inline set-password form: 2 поля (new + confirm), validation length>=8 + match. Submit вызывает supabase.functions.invoke('tutor-account', { body: { action: 'set-password-google-only', password } }). На success → toast «Пароль установлен» + invalidate ['auth','identities'].
  - **C (hasEmailPassword && hasGoogle):**
    - Как A, оба ряда editable.
    - При submit email change в C — confirm dialog «Email изменится на твой, но при следующем входе через Google он перепишется обратно. Точно изменить?». На confirm — обычный update-email flow.

Acceptance Criteria: AC-11 (state B рендерится корректно), AC-13 (set-password перевод B→C).

Guardrails:
- НЕ дублировать identity-резолвинг — только через useUserIdentities.
- В B password ряд НЕ рендерится в DOM (не disabled, не hidden) — иначе AT прочитает пустое поле.
- Tutor role check уже встроен в tutor-account (TASK-11) — не дублировать на клиенте.
- НЕ инвалидировать ['auth','identities'] после простого setPassword (это не меняет identities). Инвалидировать после link/unlink (TASK-19).
- text-base (16px) на input — iOS Safari guard.
- Никаких emoji, Lucide icons (AlertTriangle, KeyRound, Mail).

Validation:
- npm run lint && npm run build.
- Manual flow:
  - Login через Google (TASK-17) → /tutor/profile → SecuritySection в state B (без password row, есть amber CTA).
  - Click «Установить пароль» → ввод 8+ симв → save → state переходит в C (password row появился, toast).
  - Logout → login через email + новый пароль → работает.
- DevTools console: await supabase.auth.getUserIdentities() — увидеть identities array.

End block.
```

### Prompt TASK-19: LoginProvidersSection + tutor-account новые actions

```
Твоя роль: senior product-minded full-stack engineer в проекте SokratAI.

Контекст: Phase 4 финальная задача — UI для link/unlink провайдеров + расширение edge function tutor-account. КРИТИЧНО: last-identity guard в двух местах (UI + server) чтобы пользователь не остался без способа войти.

Прочитай:
- docs/delivery/features/tutor-profile/spec.md v0.2 (§3 «Google identity — без новой DB-таблицы» + «Last-identity guard» + §6 п.4 + §8 риски OAuth)
- docs/delivery/features/tutor-profile/mockup.html surface S4 (LoginProviders ряды в каждой колонке + login-strip с правилом блокировки unlink)
- supabase/functions/tutor-account/index.ts (TASK-11 — текущая реализация, добавляем 2 новых action)
- src/components/tutor/profile/SecuritySection.tsx (TASK-18 — рядом с ним рендерится новая LoginProvidersSection)
- TASK-18 output (useUserIdentities)
- CLAUDE.md «Web invite flow» (Telegram identity — особый flow, не Supabase native OAuth)

Задача:
1. Создать src/components/tutor/profile/LoginProvidersSection.tsx.
2. Подключить в src/pages/tutor/TutorProfile.tsx под SecuritySection.
3. Расширить supabase/functions/tutor-account/index.ts — 2 новых action.

LoginProvidersSection.tsx:
- Использует useUserIdentities (TASK-18) + (опционально) запрос на profiles.telegram_user_id для Telegram-fallback (если Telegram не регистрируется как Supabase identity).
- Header: «Способы входа» (Lucide ShieldCheck иконка + 14px font-semibold).
- 2 row'а в порядке: Google, Telegram.
- Каждая row (использовать тот же sec-row CSS pattern что в mockup S4):
  - Иконка provider'а (Google brand SVG / Telegram blue).
  - Provider name + (если привязан) email/username справа.
  - **Привязан + (identities.length >= 2 OR hasEmailPassword)** → кнопка «Отвязать» (red ghost, btn--xs btn--unlink). Confirm dialog «Отвязать {Google|Telegram}? Ты сможешь войти только через {другой способ}». Submit → supabase.functions.invoke('tutor-account', { body: { action: 'unlink-identity', provider } }). На success → toast + invalidate ['auth','identities'].
  - **Привязан + last identity** → кнопка «Отвязать» disabled с tooltip «Сначала установи пароль или привяжи другой способ входа.». Без вызова сервера.
  - **Не привязан** → кнопка «Привязать» (ghost). Click для Google → supabase.auth.linkIdentity({ provider: 'google' }) → Supabase сам редиректит → /auth/callback → возврат и invalidate. Click для Telegram → TBD (Telegram link использует существующий TelegramLoginButton flow — оставить TODO с явным комментарием на спеку Phase 5).

tutor-account/index.ts (расширение):
- Action 'set-password-google-only':
  - Валидация: body.password.length >= 8.
  - Получить user через user-context client (не admin) — `supabase.auth.getUser()`.
  - Через supabaseAdmin: `auth.admin.getUserById(user.id)` → identities → если найдена identity с provider='email' → return 400 `{ error: 'PASSWORD_ALREADY_SET' }` (используй обычный update-password).
  - Иначе `supabaseAdmin.auth.admin.updateUserById(user.id, { password })`.
  - Return { success: true }.
- Action 'unlink-identity':
  - Body: { provider: 'google' | 'telegram' }.
  - Получить identities через admin.getUserById(user.id).
  - Найти target identity (по provider). Если нет → 404 `{ error: 'IDENTITY_NOT_FOUND' }`.
  - Считать `remaining = identities.filter(i => i.id !== target.id)`.
  - Если remaining.length === 0 → 400 `{ error: 'LAST_IDENTITY' }` с message «Установи пароль или привяжи другой способ входа».
  - Если remaining.length === 1 && remaining[0].provider === 'email' && password не задан (проверить через identities — у email identity должен быть identity_data.email_verified или просто наличие — Supabase создаёт email identity только при наличии password) → 400 `LAST_IDENTITY`.
  - Иначе `supabaseAdmin.auth.admin.deleteIdentity({ user_id, identity_id: target.id })` (точное имя метода — проверить в supabase-js docs, может потребоваться обертка через REST).
  - Return { success: true }.
- Tutor role check — сохранить (как в существующих actions).

TutorProfile.tsx:
- Импортировать LoginProvidersSection и подключить под <SecuritySection /> (внутри max-w-2xl контейнера).

Acceptance Criteria: AC-12, AC-13.

Guardrails:
- **Двойной last-identity guard обязателен**: UI кнопка disabled + server 400. Обход одного должен ловиться вторым. Test это явно.
- НЕ удалять identity напрямую через unlinkIdentity на клиенте — только через edge function (защита от обхода клиентского guard).
- НЕ логировать provider tokens, refresh tokens, identity IDs.
- При linkIdentity для Google — пользователь уйдёт со страницы. Сохранить '/tutor/profile' в localStorage 'oauth_return_to' (см. TASK-17 паттерн).
- На Telegram «Привязать» — TODO comment + ссылка на Phase 5 спеку для linking flow (вне scope этого TASK).
- Confirm dialogs — Radix Dialog (использовать существующий src/components/ui/dialog.tsx).

Validation:
- npm run lint && npm run build.
- Manual flows:
  - State A (only email/pwd) → Привязать Google → C → Отвязать Google → A.
  - State B (only Google) → попытка отвязать Google в UI → кнопка disabled, tooltip.
  - State B → попытка вызвать unlink-identity напрямую через DevTools fetch → 400 LAST_IDENTITY.
  - State C → отвязать Google → A.
- supabase functions deploy tutor-account (после изменений).

End block + self-check: двойной guard работает (UI + server), Telegram TODO явно отмечено.
```

---

## Definition of Done (для всей фичи Phase 1-4)

1. ✅ Все TASK-1 .. TASK-19 выполнены
2. ✅ Все 13 AC из spec.md (v0.2) проходят (AC-1..10 для Phase 1-3, AC-11..13 для Phase 4)
3. ✅ `npm run lint && npm run build && npm run smoke-check` зелёные после каждой задачи
4. ✅ Codex review каждой фазы (separate session, read spec + AC + git diff) → PASS / CONDITIONAL PASS
5. ✅ Manual smoke: Windows+Chrome, iPhone+Safari, macOS+Safari
6. ✅ Egor pilot feedback после Phase 1 (неделя 1 after deploy)
7. ✅ Phase 4 smoke: новый OAuth-tutor через Google login → видит SecuritySection state B → устанавливает пароль → переход в C → может отвязать Google и войти через email
8. ✅ CLAUDE.md обновлён с правилами для будущих агентов (ключевой рецепт для tutor profile + OAuth identity flow)

---

## Post-implementation updates

После merge каждой фазы:

- **Phase 1:** добавить секцию в CLAUDE.md "Tutor Profile — identity, аватары, storage" (как работают placeholders, RLS, query key).
- **Phase 2:** добавить краткое упоминание tutor-account в секции "Edge functions".
- **Phase 3:** упомянуть Telegram auto-prefill flow + риск ротации TG URL в CLAUDE.md.
- **Phase 4:** добавить секцию "OAuth identity flow" в CLAUDE.md: useUserIdentities hook (key `['auth','identities']`), 3 состояния SecuritySection (A/B/C), last-identity guard в двух местах (UI + edge function), процедура ротации Google client_secret. Также упомянуть `oauth_return_to` localStorage паттерн.
