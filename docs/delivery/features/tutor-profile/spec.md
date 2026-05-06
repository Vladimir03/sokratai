# Feature Spec: Tutor Profile (Аватар, Имя, Предметы) + Telegram-style Identity в Guided Chat

**Версия:** v0.3
**Дата:** 2026-04-15 · обновлено 2026-05-05 (Phase 1 review fix)
**Автор:** Vladimir Kamchatkin
**Статус:** draft

## Changelog

- **v0.3.1 (2026-05-06, post Phase 2 review)** — AC-1b clarification после ChatGPT-5.5 review TASK-11..13: canonical subject id для математики — `maths` (не `math`); save-order теперь явно canonical-по-SUBJECTS-каталогу (не toggle-history). Соответствует `SubjectsMultiSelect.toggleSubject` + `serializeSubjects` в `TutorProfile.tsx`. Добавлен `tutor-account` в `supabase/config.toml` (`verify_jwt = true`) и в GitHub deploy workflow. Добавлен wrapped-error guard (`data?.error`) на оба submit'а в `SecuritySection`.
- **v0.3 (2026-05-05, post Phase 1 review)** — три fix'а после ChatGPT-5.5 review:
  1. **AC-1 split:** AC-1a (Phase 1: имя + gender + аватар + UPSERT 200 + аватар в tutor chrome) и AC-1b (Phase 2: + multi-select предметов в той же форме). Subjects больше не часть Phase 1 minimum.
  2. **Avatar entry point:** канонически живёт в AppFrame chrome (`SideNav` desktop + `MobileTopBar` mobile), не в `Navigation.tsx` (это student chrome — невидим внутри `/tutor/*` AppFrame). Обновлён §6 + mockup S1.
  3. **Thread fetch security:** студенческий thread routed через новый edge function endpoint `GET /assignments/:id/thread` (resolves SA + lazy-provisions + attaches `tutor_profile`). Broad RLS `USING (true)` на `tutors` откачена миграцией `20260506180000_revert_tutors_broad_select.sql`. Все student reads на `tutors` теперь только через service_role с column-whitelist (Option C из review). Удалён dead code `isMissingThreadMessageKindColumnError`.
- **v0.2 (2026-05-05)** — Google OAuth перенесён из Out of scope → In scope как Phase 4. Секция «Безопасность» расширена в 3 состояния (email-only / google-only / mixed). Добавлены AC-11..13, риски OAuth, файлы интеграции (`GoogleSignInButton`, `useUserIdentities`, расширения `tutor-account`).
- **v0.1 (2026-04-15)** — initial draft (Phases 1–3).

---

## 0. Job Context (обязательная секция)

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Репетитор (B2B) | P2.2 — Коммуницировать системность и прогресс ученику/родителю | Выделять голос репетитора как человека (а не безликий AI) в переписке по ДЗ | `15-backlog-of-jtbd-scenarios-sokrat.md#P22` |
| Репетитор (B2B) | P1.3 — Работать из одной темы, а не переключаться между инструментами | Закрыть базовый сценарий «где отредактировать профиль» — сейчас эта функция отсутствует и репетиторы уходят писать Vladimir'у в Telegram | `15-backlog-of-jtbd-scenarios-sokrat.md#P13` |
| Школьник (B2C) | Косвенно: узнаваемость и доверие к репетитору в чате ДЗ | Ученик видит лицо и имя своего репетитора рядом с его сообщениями (как в мессенджере) — воспринимает платформу не как абстрактного бота, а как канал связи с конкретным человеком | — |

### Wedge-связка

- **B2B-сегмент:** B2B-1 (репетиторы физики ЕГЭ/ОГЭ, hourly rate 3000–4000 ₽)
- **B2C-сегмент:** B2C-2 (школьник 16–18 лет, mobile-first, ЕГЭ)
- **Wedge alignment:** Да — инфраструктурная фича, которая делает workflow «ДЗ за 5–10 минут» ощущаемым как **работа конкретного репетитора**, а не анонимный чат. Особенно важно при масштабировании на 5+ учеников (P2.2): ученик должен мгновенно отличать сообщение «своего» Вадима от сгенерированного AI или от другого репетитора в семье.

### Pilot impact

- Убирает trust-блокер: ученики в ранних discovery-интервью путали AI и репетитора («кто мне это написал?»).
- Убирает repetitive support-запрос от Егора («где поменять имя / email / предмет»): сейчас решается в личке, что снижает perceived professionalism продукта.
- Готовит surface к будущему мульти-репетиторскому варианту (Phase 5+): если аватары есть, тред с двумя преподавателями сразу читается как групповой чат.

---

## 1. Summary

Добавляем **страницу профиля репетитора** `/tutor/profile` (имя, email, пароль, Telegram, **Google**, предметы, аватар) и интеграцию **аватара + имени репетитора** в сообщения репетитора внутри guided-homework-чата (student-side). Второй этап (аватар ученика в `GuidedThreadViewer`) вынесен в отдельную фазу/спеку.

Backend переиспользует существующую таблицу `tutors` (там уже есть `name`, `avatar_url`, `subjects TEXT[]`) и паттерн edge function `student-account`. Новый storage bucket `avatars` (public read) хранит круглые фото 512×512 JPEG ≤ 2 МБ.

**Google OAuth** (Phase 4, добавлено v0.2) — sign-in / sign-up через Google как альтернатива email+password, с возможностью линковать/отвязывать Google identity из профиля. Секция «Безопасность» рендерится в одном из 3 состояний на основе `auth.identities`: A — email/password, B — google-only (без пароля, soft-CTA «Установить пароль»), C — mixed (оба способа).

---

## 2. Problem

### Текущее поведение

- Нет UI редактирования профиля репетитора. Репетитор в Telegram спрашивает Vladimir'а лично: «где я могу отредактировать свой профиль? имя, email, пароль ещё что-то?» (скриншот от 2026-04-14).
- В ДЗ-чате у ученика сообщения от репетитора подписаны обезличенным словом **«Репетитор»** (жёстко захардкожено в `GuidedChatMessage.tsx:162`). Ни имени, ни фото. Ученик не отличает голос репетитора от AI-комментариев по тональности.
- У репетитора нет поля «предметы» в UI, хотя колонка `tutors.subjects TEXT[]` существует и могла бы использоваться для дефолта предмета в конструкторе ДЗ.

### Боль

- **Репетитор** (P1.3): продукт не ощущается как «его рабочее место» — базовый акт идентичности (фото + имя) невозможен. Это же блокирует wedge (P2.2): репетитор хочет быть видим для ученика, а платформа делает его невидимкой.
- **Ученик**: в guided-чате до 5+ разных голосов (AI-введение, AI-подсказка, AI-проверка, репетитор, system-transition). Без визуального якоря «это мой Вадим» — когнитивная нагрузка растёт, доверие к сообщениям падает.
- **Vladimir** (founder): мануальные support-запросы на «поменяй мне имя/email» = trickle cost, не масштабируется.

### Текущие «нанятые» решения

- Репетитор пишет Vladimir'у в Telegram → Vladimir через SQL/Supabase Studio меняет поля.
- Ученик узнаёт репетитора по стилю текста или ждёт голосовую в Telegram-боте.

---

## 3. Solution

### Описание

1. **Страница `/tutor/profile`** — отдельная страница под `TutorGuard` с секциями:
   - Фото + имя (обязательно)
   - Предметы (multi-select из `SUBJECTS`)
   - Email (с подтверждением через edge function)
   - Пароль (смена через edge function)
   - Telegram (read-only, статус привязки + username; без возможности сменить — это делается через `TelegramLoginButton` в другом месте)
   - Пол — `male` / `female` / не указан (нужен для гендерной плейсхолдер-аватарки)

2. **Entry point** — кликабельный круглый аватар внутри tutor AppFrame: `SideNav.tsx::ProfileNavItem` в footer над «Выйти» (desktop) + Avatar Link в `MobileTopBar.tsx` между brand и logout (mobile). `useTutorProfile()` вызывается только внутри AppFrame, поэтому query никогда не fire'ит для не-tutor (v0.3 fix — изначальная спека ошибочно указывала `Navigation.tsx` student chrome). Fallback — гендерная заглушка или инициалы.

3. **Аватар + имя в student guided chat** — в `GuidedChatMessage.tsx` для сообщений с `role: 'tutor'` слева рендерится круглый аватар 32×32, сверху пузыря — имя (truncate в одну строку). Данные приходят thread-level полем `tutor_profile: { display_name, avatar_url, gender }` из `handleGetThread` (student variant).

4. **Telegram photo_url auto-prefill** — на первом логине репетитора через `TelegramLoginButton`, если Telegram присылает `photo_url` И `tutors.avatar_url IS NULL`, бэкенд **скачивает** фото в наш storage (не сохраняет TG-URL напрямую — см. Risks) и пишет путь. Happens once.

5. **Google OAuth (Phase 4)** — кнопка «Войти через Google» на `/login` и `/signup`. Использует встроенный Supabase Auth (`signInWithOAuth({ provider: 'google' })`). Уже залогиненный user может **привязать** Google identity из профиля (`linkIdentity`) или **отвязать** (`unlinkIdentity`) при условии что у него остаётся ≥ 1 другой способ входа (email+password ИЛИ Telegram). Секция «Безопасность» рендерит одно из 3 состояний:
   - **A · Email + Password** — классика, пароль editable.
   - **B · Только Google** — пароль не задан; soft-CTA «Установить пароль» через `auth.updateUser({ password })`. Email read-only с badge «управляется Google». Кнопка «Отвязать Google» **disabled** пока нет другого способа входа.
   - **C · Mixed** — оба способа доступны, любой можно отвязать.

### Ключевые решения

- **Reuse table `tutors`** вместо новой — миграция `20260117213552` уже создала `tutors (user_id, name, avatar_url, subjects TEXT[], ...)`. Нам остаётся RLS + UPSERT-on-first-visit.
- **One row per tutor** — `tutors.user_id UNIQUE`. При первом заходе в профиль — `UPSERT ON CONFLICT (user_id)`.
- **Public storage bucket `avatars`** — чтобы ученик мог отображать аватар репетитора без signed URL round-trip (быстрее рендер чата). Имена файлов — UUID, неpredictable, без PII.
- **Thread-level `tutor_profile`** в response `handleGetThread`, **не per-message**: у assignment один репетитор (`homework_tutor_assignments.tutor_id`, в этой таблице это `auth.users.id`; профиль репетитора читается через `tutors.user_id`). Резолвим один раз в backend. Frontend применяет ко всем сообщениям с `role: 'tutor'`.
- **Edge function `tutor-account`** зеркалит `student-account` (update-email, update-password). Не сливаем в один generic `account-settings`, чтобы соблюсти CLAUDE.md правило «Student и Tutor модули изолированы».
- **Gender-based placeholder SVG** (мужской/женский силуэт на бежевом фоне) используется когда `avatar_url IS NULL`. Если `gender IS NULL` → инициалы имени в круге `bg-accent`. SVG-файлы статичны, в `/public/avatar-placeholder-male.svg` и `/public/avatar-placeholder-female.svg`.
- **Canvas compression client-side** — файл проходит `<canvas>` → quadratic crop center → 512×512 → `toBlob('image/jpeg', 0.9)`. Без внешних библиотек, без интерактивного crop (UX Q4 подтверждение).
- **Имя в чате — truncate в 1 строку** via `truncate` CSS (Tailwind) + `max-w-[200px]` — сохраняем полное имя, ограничиваем визуально (user Q3 подтверждение).
- **Google identity — без новой DB-таблицы.** Источник истины — встроенная `auth.identities` Supabase. Никакого `tutors.google_email` или зеркальной колонки. UI читает `supabase.auth.getUserIdentities()` и матчит на провайдеров. Это исключает desync между нашей таблицей и провайдером.
- **Last-identity guard на стороне клиента + edge function.** Перед вызовом `unlinkIdentity` проверяется: `identities.length >= 2 OR userHasPassword`. Двойная защита — UI дизейблит кнопку, edge function отвечает 400 если пытаются обойти. Без этого пользователь может остаться без способа войти.
- **Email — source of truth = первый identity.** Если у user есть Google identity, его email управляется Google (read-only в нашем UI). Если только email/password — email editable через `tutor-account` action `update-email` как раньше. Mixed — editable, но мы предупреждаем о возможном расхождении.

### Scope

**In scope (Phases 1–4 этой спеки):**
- Таблицы/RLS для `tutors` + миграция storage bucket `avatars`.
- Колонки `profiles.avatar_url` и `profiles.gender` добавляются **здесь же** (будут использоваться в Phase 5, но поля добавить сразу — упрощает миграцию).
- Колонка `tutors.gender` (`male` | `female` | NULL).
- Edge function `tutor-account` (update-email, update-password, **set-password-google-only**, **unlink-identity** — Phase 4).
- API-клиент `tutorProfileApi` + React Query hook `useTutorProfile`.
- Страница `/tutor/profile` со всеми секциями.
- Компонент `AvatarUpload` (canvas compression, upload, remove).
- Компонент `SubjectsMultiSelect`.
- Клик-аватар в tutor AppFrame chrome (`SideNav.tsx::ProfileNavItem` desktop + `MobileTopBar.tsx` mobile) — v0.3 fix.
- Резолв `tutor_profile` в `handleGetThread` (student variant) + расширение student `getThread` SELECT + типов.
- Рендер аватара + имени в `GuidedChatMessage.tsx` (student-side).
- Telegram photo_url auto-prefill в `TelegramLoginButton` flow (при первом tutor-логине, если аватар пуст).
- **Google OAuth (Phase 4):** провайдер настроен в Supabase Dashboard; `GoogleSignInButton` на `/login` и `/signup`; `useUserIdentities` хук; `SecuritySection` рендерит 3 состояния (A/B/C); link/unlink Google identity из профиля; «Установить пароль» CTA для Google-only.

**Out of scope (Phase 5 — отдельная спека):**
- Аватар + display_name ученика в `GuidedThreadViewer.tsx` (tutor-side).
- UI выбора гендера в профиле ученика (ученики пока не заполняют).
- Студенческий onboarding c prefil'ом гендера по имени (эвристика).

**Out of scope (явно не делаем):**
- Интерактивный crop-dialog (react-easy-crop и аналоги) — только auto-crop center.
- Отдельная Avatar Dropdown с меню (logout, settings и т.п.) в nav — пока просто клик по аватару ведёт на `/tutor/profile`.
- Множественный upload / многолетняя история аватаров.
- Webhook-верификация нового email (зеркалим student-account: `email_confirm: true`, instant).
- Подсказки по имени (автогенерация, определение гендера по имени).
- **Apple sign-in** — отложен. Только Google в Phase 4.
- **Импорт Google аватара** в `tutors.avatar_url` при первом OAuth-логине — отложен (parking lot, аналог TG photo prefill из Phase 3, но user может сам загрузить).
- Multi-account merge UI (если по ошибке создал второй аккаунт через Google) — manual support через Vladimir.

---

## 4. User Stories

### Репетитор

> Когда я впервые зашёл в кабинет репетитора и понял, что моё имя обезличено в переписке с учениками, я хочу зайти в свой профиль, загрузить фото, указать имя и предметы за 2 минуты — чтобы ученики сразу видели меня, а я перестал писать основателю «поменяй мне имя».

### Школьник

> Когда репетитор пишет мне в переписке по ДЗ, я хочу видеть его фото и имя слева от сообщения (как в Telegram) — чтобы мгновенно отличать его сообщения от AI-подсказок и не перечитывать каждый раз «это от кого».

### Родитель

Не применимо в рамках этой фичи.

---

## 5. Technical Design

### Затрагиваемые файлы

**Новые:**
- `supabase/migrations/YYYYMMDDHHMMSS_tutor_profile_infrastructure.sql` — bucket `avatars`, RLS на `tutors`, колонки `profiles.avatar_url`, `profiles.gender`, `tutors.gender`, storage policies
- `supabase/functions/tutor-account/index.ts` — edge function (update-email, update-password, set-password-google-only, unlink-identity)
- `src/lib/tutorProfileApi.ts` — API-клиент
- `src/hooks/useTutorProfile.ts` — React Query hook `['tutor','profile']`
- `src/hooks/useUserIdentities.ts` — Phase 4. Читает `auth.getUserIdentities()`, возвращает `{ hasEmailPassword, hasGoogle, hasTelegram, identities }`. Query key `['auth','identities']`.
- `src/pages/tutor/TutorProfile.tsx` — страница профиля
- `src/components/tutor/profile/AvatarUpload.tsx` — загрузка + canvas-compression
- `src/components/tutor/profile/SubjectsMultiSelect.tsx` — чипы из SUBJECTS
- `src/components/tutor/profile/TutorIdentitySection.tsx` — фото + имя + пол
- `src/components/tutor/profile/SecuritySection.tsx` — email + password (расширяется в Phase 4 на 3 состояния A/B/C по `useUserIdentities`)
- `src/components/tutor/profile/LoginProvidersSection.tsx` — Phase 4. Список провайдеров (Google + Telegram) с кнопками «Привязать» / «Отвязать». Last-identity guard.
- `src/components/auth/GoogleSignInButton.tsx` — Phase 4. Кнопка «Войти через Google» (Lucide иконка + Google brand colors), вызывает `signInWithOAuth({ provider: 'google', options: { redirectTo: '/auth/callback' } })`.
- `src/components/common/UserAvatar.tsx` — reusable avatar с fallback (image → gender placeholder → initials)
- `public/avatar-placeholder-male.svg`, `public/avatar-placeholder-female.svg` — статичные SVG

**Модифицируются:**
- `src/App.tsx` — route `/tutor/profile` child'ом существующей AppFrame `/tutor` группы (TutorGuard уже даётся AppFrame'ом — не дублируется)
- `src/components/tutor/chrome/SideNav.tsx` — `ProfileNavItem` в footer над «Выйти» (v0.3 — было ошибочно `Navigation.tsx`)
- `src/components/tutor/chrome/MobileTopBar.tsx` — Avatar Link между brand и logout (v0.3)
- `src/components/Navigation.tsx` — НЕ модифицирован этой фичей; только cosmetic `touch-pan-x` на overflow контейнере таб (v0.3, отдельный от feature scope iOS-fix)
- `src/components/homework/GuidedChatMessage.tsx` — добавить optional props `tutorDisplayName`, `tutorAvatarUrl`, `tutorGender`; рендер аватара + имени для `role: 'tutor'`
- `src/components/homework/GuidedHomeworkWorkspace.tsx` — пробросить `thread.tutor_profile` в каждый `GuidedChatMessage`
- `src/lib/studentHomeworkApi.ts` — `getThread`/student homework thread path возвращает optional `tutor_profile`; direct SELECT messages включает `author_user_id`
- `src/types/homework.ts` — тип `HomeworkThread` расширяется полем `tutor_profile?: { display_name: string; avatar_url: string | null; gender: 'male' | 'female' | null } | null`
- `supabase/functions/homework-api/index.ts` — `handleGetThread` (student variant) резолвит tutor profile, добавляет в response
- `src/components/TelegramLoginButton.tsx` — на первом tutor-логине вызывает новую edge function `tutor-telegram-avatar-prefill` (если пользователь — tutor и `avatar_url IS NULL` и Telegram прислал `photo_url`)
- `supabase/functions/tutor-telegram-avatar-prefill/index.ts` — новый endpoint: скачивает TG photo, конвертирует в JPEG 512×512, заливает в bucket, пишет `tutors.avatar_url`
- `src/pages/Login.tsx` (Phase 4) — добавить `<GoogleSignInButton />` рядом с email-формой и `<TelegramLoginButton />`
- `src/pages/SignUp.tsx` (Phase 4) — то же
- `src/pages/AuthCallback.tsx` (Phase 4) — обработка OAuth redirect (если ещё не существует — создать). Вызывает `claimPendingInvite()` для invite-flow совместимости

### Data Model

**Новые колонки:**
```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female'));

ALTER TABLE tutors
  ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female'));
```

**Storage bucket:**
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']);
```

**Path convention:** `avatars/{user_id}/{uuid}.jpg`. При upload нового аватара старый **удаляется** после успешного `UPDATE tutors.avatar_url`.

**RLS на `tutors`:**
```sql
-- SELECT: все authenticated (нужно для рендера аватара ученику в guided chat)
CREATE POLICY "tutors_select_authenticated" ON tutors
  FOR SELECT TO authenticated USING (true);

-- INSERT: только свой user_id
CREATE POLICY "tutors_insert_own" ON tutors
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- UPDATE: только свой user_id
CREATE POLICY "tutors_update_own" ON tutors
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

**RLS на `storage.objects` для bucket `avatars`:**
```sql
-- INSERT/UPDATE/DELETE: только свои файлы (path starts with own user_id)
CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated USING (...) WITH CHECK (...);

CREATE POLICY "avatars_delete_own" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- SELECT: public (bucket уже public=true, но полисы для явности)
```

### API

**Edge function `tutor-account`** (по образцу `student-account`):
- `POST /functions/v1/tutor-account` body `{ action: 'update-email', email: string }`
- `POST /functions/v1/tutor-account` body `{ action: 'update-password', password: string }`
- `POST /functions/v1/tutor-account` body `{ action: 'set-password-google-only', password: string }` (Phase 4) — для пользователей без email/password identity. По сути тот же `auth.admin.updateUserById({ password })`, но с дополнительной проверкой что у user нет password identity сейчас (защита от случайной перезаписи через wrong action).
- `POST /functions/v1/tutor-account` body `{ action: 'unlink-identity', provider: 'google' | 'telegram' }` (Phase 4) — last-identity guard на сервере: фетчим `user.identities`, если после unlink остаётся `< 1` identity ИЛИ user без password И провайдер был последним способом войти → 400 `LAST_IDENTITY`. Иначе вызываем `admin.deleteIdentity(identity_id)`.
- Валидация: tutor role required (`has_role(auth.uid(), 'tutor')`).

**Google OAuth flow (Phase 4):**
- Sign-in/sign-up: client-side `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <PUBLIC_APP_URL>/auth/callback } })`. Supabase сам редиректит на Google, дальше на `/auth/callback`.
- Linking из профиля: `supabase.auth.linkIdentity({ provider: 'google' })` (требует свежей сессии — Supabase сам подскажет re-auth при необходимости).
- Unlinking: проксируется через edge function `tutor-account` (см. выше) для last-identity guard. **НЕ вызывать `unlinkIdentity` напрямую с клиента** — клиентский guard может быть обойдён через DevTools.
- Provider config: в Supabase Dashboard → Authentication → Providers → Google. `client_id` + `client_secret` из Google Cloud Console (OAuth 2.0 credentials). Authorized redirect URI = `https://<project>.supabase.co/auth/v1/callback`. Не код-задача — task для Vladimir/devops перед merge Phase 4.

**Edge function `tutor-telegram-avatar-prefill`**:
- `POST /functions/v1/tutor-telegram-avatar-prefill` body `{ telegram_photo_url: string }`
- Вызывается ровно один раз из `TelegramLoginButton` если `isTutor && !currentAvatarUrl && photo_url`.
- Скачивает, конвертирует, заливает, обновляет `tutors.avatar_url`. Идемпотентность: если `avatar_url` уже не NULL — ничего не делает.

**Изменение `handleGetThread` (student variant)** в `supabase/functions/homework-api/index.ts`:
- После основного SELECT треда — получить `homework_tutor_assignments.tutor_id` по `assignment_id` (фактическая схема: это `auth.users.id` репетитора), затем `SELECT name, avatar_url, gender FROM tutors WHERE user_id = <assignment.tutor_id>`
- Ответ расширяется полем `tutor_profile: { display_name, avatar_url, gender } | null`
- Если `tutors` строки нет (легаси) — `display_name` резолвится через `profiles.username` fallback, `avatar_url = null`, `gender = null`.

**Supabase client direct calls** (через RLS, без edge function):
- `tutorProfileApi.getTutorProfile()` → `SELECT * FROM tutors WHERE user_id = auth.uid()`
- `tutorProfileApi.upsertTutorProfile({ name, subjects, gender })` → `UPSERT ON CONFLICT (user_id)`
- `tutorProfileApi.uploadAvatar(file)` → `storage.upload('avatars', path, file)` + `UPDATE tutors.avatar_url`
- `tutorProfileApi.removeAvatar()` → `storage.remove(path)` + `UPDATE tutors.avatar_url = null`

### Миграции

1. `YYYYMMDDHHMMSS_tutor_profile_infrastructure.sql`:
   - bucket `avatars`
   - storage RLS (insert/update/delete own)
   - `profiles.avatar_url`, `profiles.gender`
   - `tutors.gender`
   - RLS на `tutors` (select all authenticated, insert/update own)

---

## 6. UX / UI

### Wireframe описание

**`/tutor/profile`** — одна страница, секции сверху вниз в `max-w-2xl mx-auto`:

1. **Identity** — ряд из аватара (120×120, круг, слева) и справа: input «Имя» (16px), radio-group «Пол» (мужской / женский / не указано).
   - Под аватаром кнопки «Загрузить фото» (primary `bg-accent`) и «Удалить» (ghost).
2. **Subjects** — label «Предметы, которые я преподаю» + ряд чипов. Клик по чипу toggle'ит. Выбранные — `bg-accent text-white`, невыбранные — `bg-white border-slate-200`.
3. **Безопасность** — рендерится в одном из 3 состояний по результату `useUserIdentities()`:
   - **A (email/password identity есть, без Google):** email read-only + кнопка «Изменить» → inline form. Password — кнопка «Изменить пароль» → collapse с new/confirm + «Сохранить».
   - **B (только Google identity):** email read-only с badge «управляется Google» (без кнопки «Изменить»). Password секция заменена amber-полоской «Пароль не задан. Без него ты сможешь войти только через Google. → Установить пароль» (открывает inline form, submit через `set-password-google-only`).
   - **C (mixed: email/password + Google):** оба ряда editable как в A.
4. **Способы входа (Phase 4)** — отдельная карточка под «Безопасность». Список провайдеров: Google + Telegram. Каждая строка: иконка + label + статус. Кнопки:
   - Привязан + есть ≥ 1 другой identity → «Отвязать» (red ghost).
   - Привязан + last identity → «Отвязать» disabled с tooltip «Сначала привяжи другой способ или установи пароль».
   - Не привязан → «Привязать» (ghost, вызывает `linkIdentity`).
5. **Telegram** (legacy секция, теперь часть «Способы входа») — read-only: статус привязки (`@username` если есть, иначе «Не привязан»).

Все кнопки — `min-h-[44px]`, все input — `text-base` (16px, iOS Safari guard).

**Tutor chrome avatar entry point** (v0.3 fix — было ошибочно описано как `Navigation.tsx`):
- **Desktop:** в `SideNav.tsx::ProfileNavItem` — Link в `t-nav__footer` над «Выйти». Avatar 16×16 (slot-sized под Lucide иконки) + truncated `tutors.name`. Active при `pathname.startsWith('/tutor/profile')`.
- **Mobile:** в `MobileTopBar.tsx` — `<Link>` 44×44 между brand и logout. Avatar 32×32 центрирован в touch-target area.
- При `avatar_url` — `<img>`, иначе placeholder по `gender`, иначе инициалы из `displayName` (с фолбэком на «П»).
- `useTutorProfile()` mounted внутри AppFrame — query никогда не fire'ит для не-tutor.

**Student-side `Navigation.tsx`** не модифицирован для этой фичи: tutor его не видит (он за AuthGuard на `/chat`/`/homework`/`/progress`/`/profile`).

**Guided chat (student-side)** — в `GuidedChatMessage` для `role: 'tutor'`:
- Аватар 32×32 слева перед bubble (`self-end` wrapper сменяется на `self-start flex-row gap-2`).
- Имя `text-xs font-semibold text-slate-700 truncate max-w-[200px]` над bubble.
- Отсутствие аватара → placeholder по `gender`, отсутствие `gender` → инициалы имени.
- Если `tutor_profile` пуст целиком (легаси тред) → fallback «Репетитор» без аватара, как сейчас.

### UX-принципы (из doc 16)

- **AI = draft + action** — профиль не AI-фича, но укрепляет восприятие, что за AI стоит человек.
- **Tutor is the hero** — аватар в чате делает репетитора «видимым» в интерфейсе, соответствует принципу выделения голоса репетитора.
- **No friction для базовых задач** — профиль грузится при первом клике, UPSERT «on-first-visit» не требует от репетитора ручного «создать профиль».

### UI-паттерны (из doc 17)

- Radix Avatar primitive (`src/components/ui/avatar.tsx`) для круглых аватаров везде — единообразно.
- Цвет CTA — `bg-accent` (socrat green `#1B6B4A`), ни один emoji в chrome, Lucide icons (Camera, Trash2, LogOut).
- Spacing — 16px padding карточек, 8px gap между элементами.
- Шрифт — Golos Text (уже в проекте), 14px secondary, 16px body/input, 18px card titles, 20px section headers.

### Accessibility

- `<input type="file">` скрыт, кнопка «Загрузить фото» имеет `aria-label`.
- Avatar в nav — `<button aria-label="Открыть профиль">`.
- Chips в SubjectsMultiSelect — `role="button" aria-pressed` + keyboard Space/Enter.
- Focus-visible ring на всех interactive.

### Кросс-браузер (из `.claude/rules/80-cross-browser.md`)

- Все input — `text-base` (16px) — нет auto-zoom на iOS Safari.
- Canvas compression — стандартный API, Safari 15+ поддерживается.
- `createObjectURL` preview — `URL.revokeObjectURL` cleanup в unmount.
- `crypto.randomUUID()` — используем **только** в HTTPS (prod). Для dev fallback `Date.now() + Math.random()` (см. уже существующий паттерн в `studentHomeworkApi.ts` для upload file ID).

---

## Acceptance Criteria (testable)

- **AC-1a (Phase 1):** Репетитор, залогиненный впервые, переходит на `/tutor/profile`, видит форму с пустым именем и placeholder-аватаром. Сохраняет имя «Вадим Коршунов», задаёт пол (или оставляет «не указано»), загружает файл JPEG 3 МБ. Файл сжимается клиентом до ≤ 2 МБ 512×512. `UPSERT tutors` возвращает 200. Аватар появляется **в tutor chrome** (`SideNav` footer на desktop + `MobileTopBar` справа на mobile) после refetch — без дополнительных действий.
- **AC-1b (Phase 2):** В той же форме `/tutor/profile` доступна секция «Предметы, которые я преподаю» — multi-select из `SUBJECTS` через TASK-13 `SubjectsMultiSelect`. Репетитор toggle'ит «Физика» + «Математика» → save → `tutors.subjects = ['maths','physics']` (canonical-order по `SUBJECTS` списку: `maths` идёт первым в каталоге, не в порядке клика). Canonical id для математики — `maths`, не `math` (см. `src/types/homework.ts:11`); legacy `math` обрабатывается отдельно через `LEGACY_SUBJECT_LABELS`. Дефолтный предмет в `TutorHomeworkCreate` соответствует первому выбранному.
- **AC-2:** Репетитор меняет email с `old@example.com` на `new@example.com`. Edge function `tutor-account` action=`update-email` возвращает 200. В `auth.users` поле `email` обновлено. Новое письмо verification **не** отправляется (`email_confirm: true`, зеркалим student-account).
- **AC-3:** Репетитор меняет пароль на строку длиной 8+ символов. Логин с новым паролем работает, старый — возвращает 401.
- **AC-4:** Ученик, открывающий guided-homework-чат, видит сообщения с `role: 'tutor'` с аватаром и именем репетитора слева/сверху (как в Telegram на скрине в тикете). Для AI-сообщений аватара нет, label прежний. Для legacy-тредов без `tutor_profile` в response — fallback «Репетитор» без аватара, UI не падает.
- **AC-5:** `GET /assignments/:id/threads/...` (student variant) возвращает JSON с верхнеуровневым полем `tutor_profile: { display_name: string, avatar_url: string | null, gender: 'male'|'female'|null } | null`. Поле присутствует даже если у репетитора нет строки в `tutors` (значение `null`).
- **AC-6:** Репетитор **без аватара** с `gender: 'female'` отображается в student-чате как круглый SVG-женский силуэт (не инициалы). Репетитор **без аватара** и **без gender** — инициалы имени на `bg-accent`.
- **AC-7:** Репетитор заходит через `TelegramLoginButton`. Telegram возвращает `photo_url`. Если `tutors.avatar_url IS NULL`, бэкенд скачивает TG-фото, сохраняет в `avatars/<user_id>/<uuid>.jpg`, пишет ссылку в `tutors.avatar_url`. Повторный логин с уже заполненным `avatar_url` — **не переписывает** его.
- **AC-8:** `npm run lint && npm run build && npm run smoke-check` — зелёный pipeline. В console (DevTools) нет ошибок при открытии `/tutor/profile` и guided-чата.
- **AC-9:** На iOS Safari (протестировать на реальном устройстве или BrowserStack): загрузка аватара не приводит к auto-zoom на input; горизонтальный скролл guided-чата не блокируется.
- **AC-10:** Ученик, у которого тред с **двумя задачами и активным guided-чатом**, видит все сообщения репетитора с одним и тем же аватаром и именем (не flicker при прокрутке).
- **AC-11 (Phase 4):** Новый user нажимает «Войти через Google» на `/login`. Supabase редиректит на Google → согласие → `/auth/callback` → авторизованная сессия. `auth.identities` содержит ровно одну запись с `provider = 'google'`. Открывает `/tutor/profile` → секция «Безопасность» рендерит **состояние B**: email read-only с Google-badge, нет ряда «Пароль», есть amber-CTA «Установить пароль». В «Способах входа» Google = «Привязан», кнопка «Отвязать» **disabled** (нет другого способа войти).
- **AC-12 (Phase 4):** Существующий user (email/password) идёт в /tutor/profile → «Способы входа» → жмёт «Привязать» рядом с Google → OAuth-flow → возврат на профиль. Секция «Безопасность» теперь рендерит **состояние C** (mixed): оба ряда editable, кнопка «Отвязать» рядом с Google **активна** (есть password как fallback). Логин через Google или email одинаково работает.
- **AC-13 (Phase 4):** User в состоянии B (только Google) жмёт «Установить пароль» → вводит 8+ символов → submit. Edge function action=`set-password-google-only` отвечает 200. После refetch `useUserIdentities()` user перешёл в состояние C: ряд «Пароль» появился, кнопка «Отвязать Google» теперь **enabled**. Логин через email + новый пароль работает.

---

## Requirements с приоритетами (внутри scope IN)

### P0 (Must-Have — деплоится первым релизом)

- **P0-1** — Миграция infrastructure (bucket `avatars`, RLS на `tutors`, колонки `profiles.avatar_url/gender`, `tutors.gender`).
- **P0-2** — Страница `/tutor/profile` с формой Identity (имя, пол, аватар) + сохранением.
- **P0-3** — Canvas client-side compression (512×512, JPEG 0.9, ≤ 2 МБ).
- **P0-4** — Аватар + имя репетитора в `GuidedChatMessage.tsx` для student-side (главный wedge-эффект).
- **P0-5** — Резолв `tutor_profile` в `handleGetThread` (student variant).

### P1 (Nice-to-Have — fast-follow через 1–2 дня после P0)

- **P1-1** — Edge function `tutor-account` (email/password) + UI секции.
- **P1-2** — Subjects multi-select (без этого дефолт «физика» в TutorHomeworkCreate продолжает работать).
- **P1-3** — Clickable avatar в `Navigation.tsx` для tutor (can be сделано сразу в P0, если остаётся время).
- **P1-4** — Telegram photo_url auto-prefill при первом логине.
- **P1-5** — Gender placeholder SVG + выбор пола в UI.
- **P1-6 (Phase 4)** — Google OAuth: Supabase provider config + `GoogleSignInButton` на `/login`+`/signup` + `useUserIdentities` хук + 3-state `SecuritySection` + link/unlink через `tutor-account` (AC-11/12/13).

Жёсткость P0: 5 штук (укладывается в правило «2–4 P0 для типичной фичи, но допустимо 5 для инфраструктурной»). Можно снять P1-3 в P0 при малом effort.

---

## Phases

### Phase 1 — Tutor Profile Foundation (P0)

**Scope:** миграция + page `/tutor/profile` + Identity section (имя, gender, аватар с compression) + nav avatar + Chat rendering (AC-1, AC-4, AC-5, AC-6, AC-8).

**Условие старта:** спека approved.

**Условие завершения:** AC-1, AC-4, AC-5, AC-6 проходят; pilot-репетиторы (Егор) могут поставить имя и фото и видеть себя в ДЗ-чате.

### Phase 2 — Security & Subjects (P1)

**Scope:** edge function `tutor-account` + UI email/password secure + Subjects multi-select (AC-2, AC-3).

**Условие старта:** Phase 1 прошла внутренний smoke + feedback от Vladimir.

### Phase 3 — Telegram Photo Prefill (P1)

**Scope:** edge function `tutor-telegram-avatar-prefill` + интеграция в `TelegramLoginButton` (AC-7).

**Условие старта:** Phase 1 в prod, есть хотя бы 1 новый tutor-логин через Telegram за неделю (проверить можно до/после деплоя).

### Phase 4 — Google OAuth (P1, добавлено v0.2)

**Scope:** Google провайдер настроен в Supabase Dashboard + `GoogleSignInButton` на `/login` и `/signup` + `useUserIdentities` хук + расширенная `SecuritySection` (3 состояния A/B/C) + `LoginProvidersSection` (link/unlink) + расширения `tutor-account` (`set-password-google-only`, `unlink-identity`) (AC-11, AC-12, AC-13).

**Условие старта:** Phase 2 в prod (стандартный email/password flow стабилен). Google Cloud Console — OAuth 2.0 credentials выписаны (`client_id` + `client_secret`).

**Условие завершения:** AC-11/12/13 проходят; Vladimir может зайти через Google как тестовый tutor; pilot-репетиторы видят кнопку «Войти через Google» на `/login`.

### Phase 5 — Parking Lot (отдельная спека)

Перенос логики на ученика (`GuidedThreadViewer`) — отдельный spec-файл после feedback-цикла Phase 1–4.

---

## 7. Validation

### Как проверяем успех?

**Leading (3–7 дней):**
- ≥ 80 % активных tutor-аккаунтов имеют `tutors.name IS NOT NULL` (сейчас: ~0).
- ≥ 60 % активных tutor-аккаунтов имеют `tutors.avatar_url IS NOT NULL` (через upload или TG prefill).
- 0 support-запросов «где отредактировать имя/email» от репетиторов за 7 дней после деплоя.

**Lagging (2–4 недели):**
- Качественный сигнал от Егора: «ученики перестали путать, кто им написал» (через еженедельный созвон pilot).
- Retention репетиторов Week-2 не падает (контроль: не должно ухудшиться).

### Связь с pilot KPI

- Усиливает metric «Репетитор воспринимает Сократ как свой инструмент» (doc 18, week 3).
- Сокращает support-touches (out-of-band support в Telegram с founder'ом).

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

Manual smoke (обязательно):
- Windows + Chrome: профиль + upload + guided-чат с аватаром.
- iPhone + Safari: тот же сценарий.
- macOS + Safari: тот же сценарий.

---

## 8. Risks & Open Questions

| Риск | Вероятность | Impact | Митигация |
|---|---|---|---|
| **Telegram photo_url протухает** — TG ротирует file_id и URL возвращает 404 через сутки–неделю | Высокая | Сломанный аватар у репетиторов | НИКОГДА не сохранять TG URL напрямую. Скачиваем файл в наш `avatars` storage при первом auth и пишем наш путь. TG URL живёт только во время `fetch` в edge function |
| **Telegram photo_url отсутствует** — зависит от privacy-настроек профиля в Telegram | Средняя | Auto-prefill не сработает | Фича optional — fallback на gender placeholder. Не крэшим flow |
| **CORS при fetch TG photo из браузера** | Высокая | Нельзя скачать на фронте | Все скачивания — через edge function с service role (server-to-server, нет CORS) |
| **Приватность: пользователь не хотел, чтобы его TG photo использовалась** | Средняя | Жалоба | Показываем одноразовый toast после auto-prefill: «Твоё фото из Telegram использовано как аватар. Изменить в профиле.» Даём явную кнопку «Удалить» в профиле |
| **Неатомарность**: `avatars` upload → `tutors.avatar_url` UPDATE fail → orphan файл | Низкая | Мусор в storage | После UPDATE `tutors.avatar_url` SUCCESS удаляем старый файл (не fail'им фичу при ошибке удаления) |
| **iOS Safari: canvas toBlob JPEG quality** — различия в сжатии между платформами | Низкая | Фото > 2 МБ после compress | Если `blob.size > 2*1024*1024` → retry с quality 0.7, затем 0.5. Если всё ещё > 2 МБ — показать ошибку пользователю |
| **RLS `tutors SELECT to authenticated`** — любой залогиненный может запросить все имена/аватары репетиторов | Средняя | Privacy leak (имена публичные, не emails) | Приемлемо: имена и фото публичные по дизайну (видны ученикам). Email/gender **не** возвращаются в `tutor_profile` endpoint — только `display_name`, `avatar_url`, `gender` (если будем отдавать). Можно позже сузить до «только tutors, к которым я связан» через view с JOIN на tutor_students |
| **Email change без verification** (зеркалим student-account) — возможен hijacking через компрометацию сессии | Низкая | Accident | Соответствует текущему поведению student-account. Если критично — Phase follow-up с magic-link verification |
| **legacy тред без tutor_profile** — старые записи в `homework_tutor_threads` созданы до фичи | Высокая | UI не должен упасть | `tutor_profile: null` → fallback «Репетитор» без аватара. Покрыто AC-4/AC-5 |
| **Gender-based placeholder оскорбляет non-binary пользователей** | Низкая | Жалоба | `gender` опционален (NULL → инициалы). UI не форсирует выбор. Парковочно: в будущем добавить «neutral silhouette» |
| **tutor row не существует (не-onboarded tutor)** | Высокая | UPSERT + SELECT должны работать | UPSERT ON CONFLICT + fallback в `tutor_profile` резолвере (`profiles.username` если нет `tutors`) |
| **Конфликты RLS на `tutors` с существующими query** | Средняя | Регрессия на других tutor-экранах | Перед миграцией — grep `from('tutors')` и проверить все пути. Если какой-то код читает `tutors` под anon → сломается, нужен refactor |
| **Google OAuth: user остаётся без способа войти** при unlink last-identity | Средняя | Полная потеря аккаунта | Last-identity guard в **двух** местах: UI дизейблит кнопку «Отвязать», edge function `tutor-account` action=`unlink-identity` отвечает 400 `LAST_IDENTITY` если после unlink остаётся 0 identities ИЛИ password отсутствует И провайдер был последним способом войти |
| **Google email ≠ нашему email** (user сменил email в Google после первого OAuth-логина) | Низкая | Несовпадение email в UI vs Google | В состояниях B/C показывать email read-only с провенансом «Google» — не пытаться синкать. Если Google вернёт другой email при следующем sign-in, Supabase обновит `auth.users.email` сам — это OK |
| **Google sign-up создаёт второй аккаунт** для user, у которого уже есть email/password account с тем же email | Средняя | Two profiles, поддержка | Supabase auto-link идентичных email'ов **не делает по умолчанию** (security). Mitigation: документировать в onboarding «если уже регистрировался по email — войди через email, потом привяжи Google в профиле». Long-term: manual merge через support |
| **Google client_id/secret скомпрометированы** (хранятся в Supabase Dashboard) | Низкая | Нужна ротация | Стандартная процедура Google Cloud Console: revoke old credentials → выписать новые → обновить в Supabase Dashboard. Downtime для OAuth ~1 минута |
| **OAuth callback URL не зарегистрирован в Google Console** | Высокая на старте | OAuth fails | Чек-лист перед merge Phase 4: `https://<project>.supabase.co/auth/v1/callback` И `https://sokratai.ru/auth/callback` (если custom domain) добавлены в Authorized redirect URIs Google Cloud Console |

### Открытые вопросы

| Вопрос | Кто решает | Блокирует старт? |
|---|---|---|
| При смене email репетитора — инвалидировать ли текущую сессию (logout)? | product (Vladimir) | нет (по умолчанию — нет, зеркалим student-account) |
| Нужен ли rate-limit на upload (spam защита)? | engineering | нет (public bucket + RLS на own folder достаточно) |
| Показывать ли аватар репетитора в email-уведомлениях о новом ДЗ? | product | нет (parking lot) |
| Нужна ли возможность «сбросить» аватар обратно на Telegram photo? | product | нет (явная кнопка «Загрузить фото» покрывает) |
| Поведение если имя пустое, а ученик видит чат? | product | ✅ Решено: fallback «Репетитор» |

---

## 9. Implementation Tasks (краткий план)

> Переносятся в `tasks.md` после approve спека.

### Phase 1 (P0)

- [ ] TASK-1: Миграция infrastructure (bucket, RLS, колонки)
- [ ] TASK-2: `tutorProfileApi.ts` + `useTutorProfile` hook
- [x] TASK-3: `UserAvatar` reusable component + SVG placeholders
- [ ] TASK-4: `AvatarUpload` с canvas compression
- [ ] TASK-5: `TutorProfile.tsx` page + Identity section + route
- [ ] TASK-6: Navigation avatar (tutor-only, clickable)
- [x] TASK-7: Backend `handleGetThread` резолв `tutor_profile`
- [x] TASK-8: Student `studentHomeworkApi.getThread` + types
- [ ] TASK-9: `GuidedChatMessage` render аватар + имя для `role: 'tutor'`
- [ ] TASK-10: `GuidedHomeworkWorkspace` plumbing

### Phase 2 (P1)

- [ ] TASK-11: Edge function `tutor-account`
- [ ] TASK-12: SecuritySection (email + password)
- [ ] TASK-13: SubjectsMultiSelect

### Phase 3 (P1)

- [ ] TASK-14: Edge function `tutor-telegram-avatar-prefill`
- [ ] TASK-15: Интеграция в `TelegramLoginButton` + toast consent

### Phase 4 (P1) — Google OAuth (добавлено v0.2)

- [ ] TASK-16: Google провайдер в Supabase Dashboard (devops, не код) + Google Cloud Console OAuth credentials
- [ ] TASK-17: `GoogleSignInButton` компонент + интеграция в `Login.tsx` и `SignUp.tsx` + `AuthCallback.tsx`
- [ ] TASK-18: `useUserIdentities` хук + 3-state `SecuritySection` (A/B/C) + amber-CTA «Установить пароль»
- [ ] TASK-19: `LoginProvidersSection` + link/unlink (через `tutor-account` для last-identity guard) + расширение `tutor-account` (`set-password-google-only`, `unlink-identity` actions)

---

## Parking Lot

- **Phase 5: Avatar + display_name ученика в `GuidedThreadViewer`** — контекст: user запросил разбить на отдельную итерацию после P1–P4. Revisit: после деплоя Phase 1 и feedback от Егора (≥ 1 неделя).
- **Apple Sign-In** — родной паттерн для iOS, важен если процент iPhone-репетиторов вырастет. Revisit: когда Google запустится и появится ≥ 5 % activations через OAuth.
- **Google avatar auto-import** — при первом OAuth-логине забрать `picture` из Google ID-token и записать в `tutors.avatar_url` (как TG photo prefill в Phase 3). Revisit: после Phase 4, если в feedback'е репетиторы жалуются «снова надо загружать фото».
- **Manual account merge** (UI/admin tool) — для случая когда user случайно создал второй аккаунт через Google. Revisit: если support-кейсы превысят 1/неделю.
- **Avatar dropdown в Navigation** (logout / settings / theme) — контекст: пока просто клик → `/tutor/profile`. Revisit: когда появится 3+ пункта для меню.
- **Magic-link verification при смене email** — контекст: сейчас instant без подтверждения (зеркалим student-account). Revisit: если появится security-концерн или будут попытки account takeover.
- **Интерактивный crop (react-easy-crop)** — контекст: auto-crop center может отрезать лицо, если фото не квадратное. Revisit: если получим жалобы в pilot feedback.
- **Инициалы с цветовой палитрой по хэшу имени** — сейчас инициалы всегда на `bg-accent`. Можно сделать как в Google Contacts (hash→color). Revisit: nice-to-have.
- **Tutor bio / описание** (про себя, стаж, преподавание) — контекст: на маркетплейсовых платформах это стандарт. Revisit: когда Сократ выйдет за wedge в дистрибуцию/маркетплейс.
- **Выбор пола в student onboarding** — контекст: нужно для placeholder ученика в Phase 5. Revisit: вместе с Phase 5 spec.
- **Гендерно-нейтральный placeholder** — контекст: non-binary concern. Revisit: если появится сигнал.
- **Webhook при изменении `tutors.name`** → инвалидировать кешированный `tutor_profile` во всех открытых student-сессиях через Realtime. Revisit: если flicker/stale станет проблемой на практике.
- **Использовать аватар репетитора в email-уведомлениях о ДЗ** — контекст: усиливает identity в out-of-product канале. Revisit: Phase 4+.

---

## Anti-scope-creep правило (напоминание)

После approve этой спеки — scope фиксируется. Новый requirement = удалить существующий того же приоритета ИЛИ создать новую фазу / spec. «А ещё бы…» от Егора/Жени → Intake (backlog.md), не в текущую спеку.

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0) — привязка к P1.3, P2.2
- [x] Привязка к Core Job из Графа работ
- [x] Scope чётко определён (IN / OUT / LATER)
- [x] UX-принципы из doc 16 учтены (tutor is the hero, AI = draft + action)
- [x] UI-паттерны из doc 17 учтены (Radix Avatar, Lucide icons, Golos Text, accent color)
- [x] Pilot impact описан
- [x] Метрики успеха определены (leading + lagging)
- [x] High-risk файлы — `TelegramLoginButton.tsx` затрагивается **намеренно** для Phase 3 (Telegram auto-prefill), scope минимальный
- [x] Student/Tutor изоляция не нарушена (отдельный `tutor-account`, отдельный `tutorProfileApi`)
- [x] Acceptance Criteria testable (≥ 3, всего 13)
- [x] P0/P1 приоритеты расставлены
- [x] Parking Lot заполнен
- [x] Risks перечислены с митигацией (18 рисков)
- [x] Открытые вопросы расставлены (blocking / non-blocking)
- [x] **v0.2 (Phase 4 Google OAuth):** mockup S4 покрывает 3 состояния, AC-11..13 testable, edge function actions определены, last-identity guard в двух местах
