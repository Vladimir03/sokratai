# Feature Spec: Tutor Profile (Аватар, Имя, Предметы) + Telegram-style Identity в Guided Chat

**Версия:** v0.1
**Дата:** 2026-04-15
**Автор:** Vladimir Kamchatkin
**Статус:** draft

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

Добавляем **страницу профиля репетитора** `/tutor/profile` (имя, email, пароль, Telegram, предметы, аватар) и интеграцию **аватара + имени репетитора** в сообщения репетитора внутри guided-homework-чата (student-side). Второй этап (аватар ученика в `GuidedThreadViewer`) вынесен в отдельную фазу/спеку.

Backend переиспользует существующую таблицу `tutors` (там уже есть `name`, `avatar_url`, `subjects TEXT[]`) и паттерн edge function `student-account`. Новый storage bucket `avatars` (public read) хранит круглые фото 512×512 JPEG ≤ 2 МБ.

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

2. **Entry point** — кликабельный круглый аватар в правой части `Navigation.tsx` (только для tutors, определяется через `useTutorAccess`). Fallback — гендерная заглушка или инициалы.

3. **Аватар + имя в student guided chat** — в `GuidedChatMessage.tsx` для сообщений с `role: 'tutor'` слева рендерится круглый аватар 32×32, сверху пузыря — имя (truncate в одну строку). Данные приходят thread-level полем `tutor_profile: { display_name, avatar_url, gender }` из `handleGetThread` (student variant).

4. **Telegram photo_url auto-prefill** — на первом логине репетитора через `TelegramLoginButton`, если Telegram присылает `photo_url` И `tutors.avatar_url IS NULL`, бэкенд **скачивает** фото в наш storage (не сохраняет TG-URL напрямую — см. Risks) и пишет путь. Happens once.

### Ключевые решения

- **Reuse table `tutors`** вместо новой — миграция `20260117213552` уже создала `tutors (user_id, name, avatar_url, subjects TEXT[], ...)`. Нам остаётся RLS + UPSERT-on-first-visit.
- **One row per tutor** — `tutors.user_id UNIQUE`. При первом заходе в профиль — `UPSERT ON CONFLICT (user_id)`.
- **Public storage bucket `avatars`** — чтобы ученик мог отображать аватар репетитора без signed URL round-trip (быстрее рендер чата). Имена файлов — UUID, неpredictable, без PII.
- **Thread-level `tutor_profile`** в response `handleGetThread`, **не per-message**: у assignment один репетитор (`homework_tutor_assignments.tutor_user_id`). Резолвим один раз в backend. Frontend применяет ко всем сообщениям с `role: 'tutor'`.
- **Edge function `tutor-account`** зеркалит `student-account` (update-email, update-password). Не сливаем в один generic `account-settings`, чтобы соблюсти CLAUDE.md правило «Student и Tutor модули изолированы».
- **Gender-based placeholder SVG** (мужской/женский силуэт на бежевом фоне) используется когда `avatar_url IS NULL`. Если `gender IS NULL` → инициалы имени в круге `bg-accent`. SVG-файлы статичны, в `/public/avatar-placeholder-male.svg` и `/public/avatar-placeholder-female.svg`.
- **Canvas compression client-side** — файл проходит `<canvas>` → quadratic crop center → 512×512 → `toBlob('image/jpeg', 0.9)`. Без внешних библиотек, без интерактивного crop (UX Q4 подтверждение).
- **Имя в чате — truncate в 1 строку** via `truncate` CSS (Tailwind) + `max-w-[200px]` — сохраняем полное имя, ограничиваем визуально (user Q3 подтверждение).

### Scope

**In scope (Phases 1–4 этой спеки):**
- Таблицы/RLS для `tutors` + миграция storage bucket `avatars`.
- Колонки `profiles.avatar_url` и `profiles.gender` добавляются **здесь же** (будут использоваться в Phase 5, но поля добавить сразу — упрощает миграцию).
- Колонка `tutors.gender` (`male` | `female` | NULL).
- Edge function `tutor-account` (update-email, update-password).
- API-клиент `tutorProfileApi` + React Query hook `useTutorProfile`.
- Страница `/tutor/profile` со всеми секциями.
- Компонент `AvatarUpload` (canvas compression, upload, remove).
- Компонент `SubjectsMultiSelect`.
- Клик-аватар в `Navigation.tsx` для tutors.
- Резолв `tutor_profile` в `handleGetThread` (student variant) + расширение student `getThread` SELECT + типов.
- Рендер аватара + имени в `GuidedChatMessage.tsx` (student-side).
- Telegram photo_url auto-prefill в `TelegramLoginButton` flow (при первом tutor-логине, если аватар пуст).

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
- Интеграция с Google/Apple sign-in аватаром.

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
- `supabase/functions/tutor-account/index.ts` — edge function (update-email, update-password)
- `src/lib/tutorProfileApi.ts` — API-клиент
- `src/hooks/useTutorProfile.ts` — React Query hook `['tutor','profile']`
- `src/pages/tutor/TutorProfile.tsx` — страница профиля
- `src/components/tutor/profile/AvatarUpload.tsx` — загрузка + canvas-compression
- `src/components/tutor/profile/SubjectsMultiSelect.tsx` — чипы из SUBJECTS
- `src/components/tutor/profile/TutorIdentitySection.tsx` — фото + имя + пол
- `src/components/tutor/profile/SecuritySection.tsx` — email + password
- `src/components/common/UserAvatar.tsx` — reusable avatar с fallback (image → gender placeholder → initials)
- `public/avatar-placeholder-male.svg`, `public/avatar-placeholder-female.svg` — статичные SVG

**Модифицируются:**
- `src/App.tsx` — route `/tutor/profile` под `TutorGuard`
- `src/components/Navigation.tsx` — clickable avatar справа (tutor-only)
- `src/components/homework/GuidedChatMessage.tsx` — добавить optional props `tutorDisplayName`, `tutorAvatarUrl`, `tutorGender`; рендер аватара + имени для `role: 'tutor'`
- `src/components/homework/GuidedHomeworkWorkspace.tsx` — пробросить `thread.tutor_profile` в каждый `GuidedChatMessage`
- `src/lib/studentHomeworkApi.ts` — `getThread` возвращает `tutor_profile`; добавить `author_user_id` в SELECT messages
- `src/types/homework.ts` — тип `ThreadResponse` расширяется полем `tutor_profile?: { display_name: string; avatar_url: string | null; gender: 'male' | 'female' | null }`
- `supabase/functions/homework-api/index.ts` — `handleGetThread` (student variant) резолвит tutor profile, добавляет в response
- `src/components/TelegramLoginButton.tsx` — на первом tutor-логине вызывает новую edge function `tutor-telegram-avatar-prefill` (если пользователь — tutor и `avatar_url IS NULL` и Telegram прислал `photo_url`)
- `supabase/functions/tutor-telegram-avatar-prefill/index.ts` — новый endpoint: скачивает TG photo, конвертирует в JPEG 512×512, заливает в bucket, пишет `tutors.avatar_url`

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
- Валидация: tutor role required (`has_role(auth.uid(), 'tutor')`).

**Edge function `tutor-telegram-avatar-prefill`**:
- `POST /functions/v1/tutor-telegram-avatar-prefill` body `{ telegram_photo_url: string }`
- Вызывается ровно один раз из `TelegramLoginButton` если `isTutor && !currentAvatarUrl && photo_url`.
- Скачивает, конвертирует, заливает, обновляет `tutors.avatar_url`. Идемпотентность: если `avatar_url` уже не NULL — ничего не делает.

**Изменение `handleGetThread` (student variant)** в `supabase/functions/homework-api/index.ts`:
- После основного SELECT треда — дополнительный SELECT `SELECT name, avatar_url, gender FROM tutors WHERE user_id = <assignment.tutor_user_id>`
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
3. **Email** — current email read-only + кнопка «Изменить» → inline form с input + «Сохранить».
4. **Password** — кнопка «Изменить пароль» → collapse с 2 полями (новый / подтвердить) + «Сохранить».
5. **Telegram** — read-only: статус привязки (`@username` если есть, иначе «Не привязан»). Без кнопки смены (пока).

Все кнопки — `min-h-[44px]`, все input — `text-base` (16px, iOS Safari guard).

**Navigation avatar** — круг 32×32 справа перед LogOut. При `avatar_url` — `<img>`, при пустом — placeholder (по `gender`) или инициалы `bg-accent`.

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

- **AC-1:** Репетитор, залогиненный впервые, переходит на `/tutor/profile`, видит форму с пустым именем и placeholder-аватаром. Сохраняет имя «Вадим Коршунов», выбирает 2 предмета (Физика + Математика), загружает файл JPEG 3 МБ. Файл сжимается клиентом до ≤ 2 МБ 512×512. `UPSERT tutors` возвращает 200. Аватар появляется в `Navigation.tsx` после refresh без дополнительных действий.
- **AC-2:** Репетитор меняет email с `old@example.com` на `new@example.com`. Edge function `tutor-account` action=`update-email` возвращает 200. В `auth.users` поле `email` обновлено. Новое письмо verification **не** отправляется (`email_confirm: true`, зеркалим student-account).
- **AC-3:** Репетитор меняет пароль на строку длиной 8+ символов. Логин с новым паролем работает, старый — возвращает 401.
- **AC-4:** Ученик, открывающий guided-homework-чат, видит сообщения с `role: 'tutor'` с аватаром и именем репетитора слева/сверху (как в Telegram на скрине в тикете). Для AI-сообщений аватара нет, label прежний. Для legacy-тредов без `tutor_profile` в response — fallback «Репетитор» без аватара, UI не падает.
- **AC-5:** `GET /assignments/:id/threads/...` (student variant) возвращает JSON с верхнеуровневым полем `tutor_profile: { display_name: string, avatar_url: string | null, gender: 'male'|'female'|null } | null`. Поле присутствует даже если у репетитора нет строки в `tutors` (значение `null`).
- **AC-6:** Репетитор **без аватара** с `gender: 'female'` отображается в student-чате как круглый SVG-женский силуэт (не инициалы). Репетитор **без аватара** и **без gender** — инициалы имени на `bg-accent`.
- **AC-7:** Репетитор заходит через `TelegramLoginButton`. Telegram возвращает `photo_url`. Если `tutors.avatar_url IS NULL`, бэкенд скачивает TG-фото, сохраняет в `avatars/<user_id>/<uuid>.jpg`, пишет ссылку в `tutors.avatar_url`. Повторный логин с уже заполненным `avatar_url` — **не переписывает** его.
- **AC-8:** `npm run lint && npm run build && npm run smoke-check` — зелёный pipeline. В console (DevTools) нет ошибок при открытии `/tutor/profile` и guided-чата.
- **AC-9:** На iOS Safari (протестировать на реальном устройстве или BrowserStack): загрузка аватара не приводит к auto-zoom на input; горизонтальный скролл guided-чата не блокируется.
- **AC-10:** Ученик, у которого тред с **двумя задачами и активным guided-чатом**, видит все сообщения репетитора с одним и тем же аватаром и именем (не flicker при прокрутке).

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

### Phase 4 — Parking Lot для Phase 5 (отдельная спека)

Перенос логики на ученика (`GuidedThreadViewer`) — отдельный spec-файл после feedback-цикла Phase 1–3.

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
- [ ] TASK-3: `UserAvatar` reusable component + SVG placeholders
- [ ] TASK-4: `AvatarUpload` с canvas compression
- [ ] TASK-5: `TutorProfile.tsx` page + Identity section + route
- [ ] TASK-6: Navigation avatar (tutor-only, clickable)
- [ ] TASK-7: Backend `handleGetThread` резолв `tutor_profile`
- [ ] TASK-8: Student `studentHomeworkApi.getThread` + types
- [ ] TASK-9: `GuidedChatMessage` render аватар + имя для `role: 'tutor'`
- [ ] TASK-10: `GuidedHomeworkWorkspace` plumbing

### Phase 2 (P1)

- [ ] TASK-11: Edge function `tutor-account`
- [ ] TASK-12: SecuritySection (email + password)
- [ ] TASK-13: SubjectsMultiSelect

### Phase 3 (P1)

- [ ] TASK-14: Edge function `tutor-telegram-avatar-prefill`
- [ ] TASK-15: Интеграция в `TelegramLoginButton` + toast consent

---

## Parking Lot

- **Phase 5: Avatar + display_name ученика в `GuidedThreadViewer`** — контекст: user запросил разбить на отдельную итерацию после P1–P4. Revisit: после деплоя Phase 1 и feedback от Егора (≥ 1 неделя).
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
- [x] Acceptance Criteria testable (≥ 3, всего 10)
- [x] P0/P1 приоритеты расставлены
- [x] Parking Lot заполнен
- [x] Risks перечислены с митигацией (13 рисков)
- [x] Открытые вопросы расставлены (blocking / non-blocking)
