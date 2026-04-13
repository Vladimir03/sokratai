# Feature Spec: Registration & Onboarding Redesign

**Версия:** v0.3
**Дата:** 2026-04-13
**Автор:** Vladimir + Claude
**Статус:** implemented (Sprint 1)

---

## 0. Job Context (обязательная секция)

> Регистрация и онбординг — не самостоятельная фича, а enabler для всех Core Jobs. Без работающего входа ученик не может выполнить ДЗ, репетитор не может отследить прогресс.

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на Граф |
|---|---|---|---|
| Репетитор (B2B) | R4: Масштабировать практику без потери качества | R4-1: Быстро добавить нового ученика и дать ему доступ к платформе | job-graph.md#R4 |
| Репетитор (B2B) | R1: Собрать ДЗ за 5-10 мин и отправить ученикам | R1-3: Убедиться что ученик получил ДЗ и может его открыть | job-graph.md#R1 |
| Школьник (B2C) | S1: Получить и выполнить ДЗ | S1-0: Войти в систему и увидеть свои задания | job-graph.md#S1 |
| Родитель (B2C) | P1: Контролировать прогресс ребёнка | P1-0: Понять что ребёнок подключён к платформе репетитора | job-graph.md#P1 |

### Wedge-связка

- **B2B-сегмент:** B2B-1 (Репетитор физики ЕГЭ/ОГЭ, 5-15 учеников, hourly rate 3000-4000₽)
- **B2C-сегмент:** B2C-1 (Школьник 16-18 лет, готовится к ЕГЭ/ОГЭ по физике)
- **Score матрицы:** Высокий — enabler для P0.1 wedge «Собрать ДЗ за 5-10 мин»

### Pilot impact

Без работающей регистрации ученик не может войти в систему → не может прорешать ДЗ → репетитор не видит результаты → wedge P0.1 не работает. Фича устраняет главный блокер пилота: сейчас после ручного добавления ученик получает UUID-пароль, которым невозможно войти.

---

## 1. Summary

Редизайн регистрации и онбординга для SokratAI по модели ProgressMe: репетитор добавляет ученика → система генерирует читаемый 4-значный пароль → репетитор видит модалку «Данные для входа» с кнопкой «Скопировать для отправки» → вставляет в Telegram ученику → ученик входит за 10 секунд.

Дополнительно: репетитор видит на карточке ученика статус активации (вошёл / не входил) и привязанные каналы связи (Telegram, Email), чтобы понимать кому нужно напомнить о регистрации и через какой канал доходят уведомления о ДЗ. После первого входа ученик может в своём профиле заменить временный email на реальный, подключить Telegram и сменить пароль, а кабинет репетитора подтягивает эти изменения из актуальных auth-данных.

---

## 2. Problem

### Текущее поведение

При ручном добавлении ученика в `AddStudentDialog` → вкладка «Вручную» → edge function `tutor-manual-add-student` создаёт auth user с:
- Email: `{sanitized_name}_{random}@temp.sokratai.ru` (если реальный email не указан)
- Пароль: `crypto.randomUUID()` — длинный UUID, который невозможно ввести

После добавления диалог закрывается. Репетитор не видит ни логин, ни пароль ученика. Ученик не может войти в систему.

### Боль

**Репетитор (R4-1):** «Я добавил ученика, но как ему войти? Что ему отправить?» — нет механизма передачи данных для входа. Это блокирует R1-3 (отправить ДЗ и убедиться, что ученик его получил).

**Ученик (S1-0):** Не может войти в систему → не видит ДЗ → не прорешивает → репетитор не видит результатов.

**Репетитор (visibility):** Не видит, кто из учеников уже активировал аккаунт, а кому нужно напомнить. Не видит, через какие каналы можно достучаться до ученика (Telegram привязан? Реальный email есть?).

### Текущие «нанятые» решения

Репетиторы пилота используют invite-ссылку (вкладка «По ссылке» в AddStudentDialog) и отправляют её в Telegram. Ученик переходит по ссылке, регистрируется сам. Это работает, но: требует от ученика 2-3 минуты самостоятельных действий (придумать пароль, ввести данные), часть учеников 16-18 лет «забивают» на регистрацию.

---

## 3. Solution

### Описание

Гибридная модель ProgressMe (primary) + invite link (secondary):

1. **Репетитор создаёт аккаунт ученика** через улучшенный `AddStudentDialog` → система генерирует 4-значный пароль → показывает модалку «Данные для входа» с кнопкой «Скопировать для отправки»
2. **Репетитор отправляет данные** ученику через Telegram (copy-paste) или показывает на уроке с экрана
3. **Ученик входит** на `sokratai.ru/login` с email + 4-значным паролем → видит свои ДЗ
4. **Invite-ссылка** остаётся как secondary path для случаев «не знаю email ученика»

### Ключевые решения

| Решение | Обоснование |
|---|---|
| 4-значный пароль (не 6, не UUID) | ProgressMe использует 4 цифры годами. Легко диктовать на уроке, копировать в Telegram. Rate limiting компенсирует низкую энтропию |
| Пароль показывается один раз при создании | Не хранится в plain-text. Для повторной отправки — «Сбросить пароль» (генерирует новый) |
| Без email confirmation | Репетитор верифицировал ученика лично. Лишний шаг = потеря конверсии (UX Principle 14) |
| Модалка после добавления (не auto-close) | Репетитор должен увидеть данные и скопировать их до закрытия диалога |
| `last_sign_in_at` через триггер в `profiles` | Проще для RLS и tutor-запросов, чем `auth.admin.getUserById` per student |

### Scope

**In scope (P0 — Sprint 1):**
- Генерация 4-значного пароля в `tutor-manual-add-student`
- Модалка `StudentCredentialsModal` с данными для входа
- Кнопка «Скопировать для отправки» (форматированный текст)
- Статус активации на карточке ученика (Вошёл / Не входил)
- Каналы связи на карточке (Telegram, Email) с состояниями
- Миграция `profiles.last_sign_in_at` + триггер на `auth.users`

**In scope (P1 — Sprint 2):**
- Google OAuth (вход через Google) для учеников и репетиторов
- Страница `/register-tutor` с мини-анкетой + auto-role assignment
- AddStudentDialog не закрывается после добавления (для последовательного добавления в группу)

**In scope (P2 — Sprint 3):**
- Welcome-экран при первом входе ученика
- Авто-email с данными для входа (кнопка «Отпр. на почту»)
- Кнопка «Сбросить пароль» в профиле ученика (tutor-side)
- Self-service управление входными данными ученика в `/profile`:
  - смена temp-email на реальный email
  - смена пароля
  - видимый статус привязанного Telegram

**Out of scope:**
- Batch-добавление учеников (batch form)
- Роль «Родитель»
- SSO / SAML
- Telegram OAuth восстановление (заблокирован в РФ)
- Email confirmation / double opt-in для учеников, добавленных репетитором

---

## 4. User Stories

### Репетитор

> Когда я добавляю нового ученика перед уроком, я хочу сразу увидеть данные для входа и скопировать их одной кнопкой, чтобы отправить ученику в Telegram за 30 секунд.

> Когда я открываю список учеников, я хочу видеть кто уже вошёл в систему, а кто нет, чтобы напомнить нужным ученикам.

> Когда я вижу карточку ученика, я хочу понимать какие каналы связи у него привязаны (Telegram, Email), чтобы знать дойдут ли уведомления о ДЗ.

### Школьник

> Когда репетитор прислал мне данные для входа в Telegram, я хочу войти на сайт за 10 секунд (email + 4 цифры пароля), чтобы сразу увидеть ДЗ.

---

## 5. Technical Design

### Затрагиваемые файлы

**Backend (edge functions):**
- `supabase/functions/tutor-manual-add-student/index.ts` — генерация 4-значного пароля вместо UUID, возврат plain-text пароля в response
- Новая миграция — `profiles.last_sign_in_at` + триггер

**Frontend (tutor domain):**
- `src/components/tutor/AddStudentDialog.tsx` — показ `StudentCredentialsModal` после успешного добавления вместо auto-close
- Новый `src/components/tutor/StudentCredentialsModal.tsx` — модалка с данными для входа
- Карточка ученика (компонент в `/tutor/students`) — badge статуса активации + каналы связи
- `src/lib/tutors.ts` или `src/lib/tutorStudents.ts` — расширение `handleGetStudents` response

**Shared:**
- `src/types/` — расширение типов студента (activation status, channel flags)

### Data Model

**Новая колонка:**
```sql
ALTER TABLE profiles ADD COLUMN last_sign_in_at timestamptz DEFAULT NULL;
```

**Триггер на `auth.users`:**
```sql
CREATE OR REPLACE FUNCTION sync_last_sign_in()
RETURNS trigger AS $$
BEGIN
  IF NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at THEN
    UPDATE public.profiles
    SET last_sign_in_at = NEW.last_sign_in_at
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_sync_last_sign_in
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_last_sign_in();
```

**Данные каналов (уже есть в БД, нужно только вернуть в API):**
- `profiles.telegram_username` — введён репетитором при добавлении
- `profiles.telegram_user_id` — заполняется когда ученик пишет боту `/start`
- `auth.users.email` — проверка `NOT LIKE '%@temp.sokratai.ru'` для определения реального email

### API

**`tutor-manual-add-student` — изменения:**
- Генерация пароля: `Math.floor(1000 + Math.random() * 9000).toString()` (4 цифры, 1000-9999)
- Response body расширяется: `{ ...existing, plain_password: string, login_email: string }`
- `plain_password` возвращается ОДИН раз при создании, нигде не хранится
- Тот же endpoint поддерживает action `reset-student-password`: проверяет ownership через `tutor_students`, генерирует новый 4-значный пароль, вызывает `auth.admin.updateUserById(student_id, { password: newPassword })` и возвращает `{ login_email, plain_password }`

**`handleGetStudents` (или отдельный endpoint) — расширение response:**
- `last_sign_in_at: string | null` — из `profiles.last_sign_in_at`
- `login_email: string | null` — текущий `auth.users.email`
- `has_real_email: boolean` — `email NOT LIKE '%@temp.sokratai.ru'`
- `has_telegram_bot: boolean` — `profiles.telegram_user_id IS NOT NULL`
- `has_telegram_username: boolean` — `profiles.telegram_username IS NOT NULL AND != ''`

**Новый endpoint `student-account`:**
- `action: "update-email"` — меняет email текущего ученика через `auth.admin.updateUserById`, подтверждает его без email confirmation и возвращает `{ email, has_real_email }`
- `action: "update-password"` — меняет пароль текущего ученика и возвращает `{ success: true }`
- доступ только для аутентифицированного текущего пользователя (`verify_jwt = true`)

### Миграции

1. `YYYYMMDDHHMMSS_add_last_sign_in_to_profiles.sql` — колонка + триггер + backfill существующих из `auth.users`
2. `20260413170000_get_students_contact_info.sql` — SECURITY DEFINER RPC, который батчево читает `auth.users.email` для tutor-side карточек и профиля ученика

---

## 6. UX / UI

### Wireframe: Модалка «Данные для входа»

```
┌──────────────────────────────────────┐
│       Данные для входа ученика       │
│                                      │
│  Страница входа:                     │
│  sokratai.ru/login                   │
│                                      │
│  Почта:                              │
│  ivan@gmail.com                      │
│                                      │
│  Пароль:                             │
│  4827                                │
│                                      │
│  ┌──────────────────────────────┐    │
│  │  Скопировать для отправки    │    │  ← primary CTA (bg-accent)
│  └──────────────────────────────┘    │
│                                      │
│  [Закрыть]                           │  ← secondary
└──────────────────────────────────────┘
```

**«Скопировать для отправки»** копирует в буфер:
```
Страница входа в платформу:
https://sokratai.ru/login

Почта от аккаунта:
ivan@gmail.com

Пароль для входа:
4827
```

### Wireframe: Карточка ученика (расширенная)

```
┌─────────────────────────────────────────────┐
│  Иван Петров                  [Не входил]   │  ← серый badge + AlertCircle
│  ЕГЭ Физика · 10 класс                     │
│                                             │
│  Email  ivan@gmail.com            [CheckCircle зелёный]
│  Telegram  @ivan_petrov           [AlertTriangle жёлтый] ← username есть, бот не привязан
│                                             │
│  [Данные для входа]  [Напомнить]            │
└─────────────────────────────────────────────┘
```

**Состояния каналов (Lucide icons, не emoji):**
- Email: `CheckCircle` зелёный (реальный email) / `XCircle` серый (temp или нет)
- Telegram: `CheckCircle` зелёный (`telegram_user_id` есть) / `AlertTriangle` жёлтый (только `telegram_username`) / `XCircle` серый (ничего)
- Статус: `CheckCircle` зелёный «Активирован» / `AlertCircle` серый «Не входил»

### UX-принципы (из doc 16)

- **Принцип 14: First Value in 3 Minutes** — регистрация ученика должна занимать ≤30 секунд от нажатия «Добавить» до готовности ученика войти
- **Принцип 1: Репетитор — Primary Buyer** — UI оптимизирован под действия репетитора (добавить → скопировать → отправить), ученику достаточно получить данные и войти
- **Принцип 3: AI = Draft + Action** — не применяется напрямую, но модалка с данными = ready-to-use артефакт, не требующий дополнительных действий

### UI-паттерны (из doc 17)

- **One Screen = One Primary Job** — модалка «Данные для входа» = один primary CTA «Скопировать для отправки»
- **Карточка ученика** — белый фон, border slate-200, rounded-lg. Status badge: colored dot + text (не colored pill). Lucide icons для каналов
- **Формы** — inputs с `text-base` (16px) для iOS Safari, focus ring `ring-2 ring-accent/20`
- **Single primary CTA** — «Скопировать для отправки» = `bg-accent text-white`, «Закрыть» = secondary

---

## 7. Validation

### Acceptance Criteria (testable)

**AC-1: 4-значный пароль.** При ручном добавлении ученика backend возвращает `plain_password` — строку из 4 цифр (1000-9999). Auth user создаётся с этим паролем. Ученик может войти с этим паролем на `/login`.

**AC-2: Модалка «Данные для входа».** После успешного добавления ученика AddStudentDialog показывает `StudentCredentialsModal` с email, паролем и кнопкой «Скопировать для отправки». Диалог не закрывается автоматически.

**AC-3: Copy-to-clipboard.** Кнопка «Скопировать для отправки» копирует в буфер обмена форматированный текст (URL входа + email + пароль). Toast «Скопировано» подтверждает.

**AC-4: Статус активации.** На карточке ученика badge «Не входил» (серый) если `last_sign_in_at IS NULL`, «Активирован» (зелёный) если `IS NOT NULL`. Дата последнего входа мелким текстом.

**AC-5: Каналы связи.** На карточке ученика отображаются Email и Telegram с состояниями (привязан / частично / нет). Используются Lucide icons, не emoji.

**AC-6: Триггер `last_sign_in_at`.** При входе ученика через `supabase.auth.signInWithPassword()` триггер копирует `auth.users.last_sign_in_at` в `profiles.last_sign_in_at`. Backfill при миграции для существующих пользователей.

**AC-7: Сброс пароля с карточки ученика.** На каждой карточке есть secondary-кнопка «Данные для входа». Клик генерирует новый 4-значный пароль на backend, показывает `StudentCredentialsModal` с новым `login_email` и новым `plain_password`, а старый пароль не возвращается и не хранится.

### Как проверяем успех?

- **Конверсия регистрации:** % учеников, которые вошли в систему после добавления репетитором. Целевой порог: >80% (vs текущие ~30% через invite-ссылку)
- **Время от добавления до входа:** медиана <5 мин (репетитор скопировал → ученик вошёл)
- **Статус активации coverage:** 100% карточек учеников показывают корректный статус

### Связь с pilot KPI

Pilot KPI (doc 18): «Репетитор создаёт и отправляет ДЗ 3+ ученикам за первую неделю». Если ученики не могут войти — KPI недостижим. Фича устраняет блокер.

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

### Implementation status (2026-04-13)

- `build` — PASS
- `smoke-check` — PASS
- `lint` — FAIL по существующему repo-wide baseline; feature-specific issue в `getAuthErrorMessage()` исправлена, остальные ошибки не относятся к registration-onboarding flow

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| 4-значный пароль brute-force | Средняя | Rate limiting: 5 попыток → блокировка 15 мин. Аккаунт ученика не содержит платёжных данных. Google OAuth (P1) позволит отказаться от пароля |
| Репетитор закрыл модалку не скопировав | Низкая | Кнопка «Данные для входа» на карточке ученика (P0) → «Сбросить пароль» генерирует новый 4-значный |
| Триггер на `auth.users` может быть заблокирован Supabase | Низкая | Supabase позволяет триггеры на `auth.users` в managed instance. Альтернатива: webhook на auth event |
| `@temp.sokratai.ru` email confusion | Низкая | На карточке ученика показывать только если реальный email. Temp email → badge «Email не указан» |

### Открытые вопросы

Все вопросы решены (см. proposal doc section 11). Решения зафиксированы в секции «Ключевые решения» выше.

---

## 9. Implementation Tasks

> Переносятся в `registration-onboarding-tasks.md` после approve спека.

### Sprint 1: «Ученик может войти» (P0, ~4 дня)

- [x] TASK-1: Миграция `profiles.last_sign_in_at` + триггер + backfill
- [x] TASK-2: Генерация 4-значного пароля в `tutor-manual-add-student` + возврат в response
- [x] TASK-3: `StudentCredentialsModal` компонент (модалка + copy-to-clipboard)
- [x] TASK-4: Интеграция модалки в `AddStudentDialog` (показ после успеха вместо auto-close)
- [x] TASK-5: Расширение API students — `last_sign_in_at`, email/telegram флаги
- [x] TASK-6: UI статуса активации + каналов на карточке ученика
- [x] TASK-7: Кнопка «Данные для входа» на карточке → «Сбросить пароль» modal
- [x] TASK-8: Smoke test + Safari QA

### Sprint 2: «Без паролей» (P1, ~3-4 дня)

- [ ] TASK-9: Google OAuth provider в Supabase + кнопка на Login/TutorLogin
- [ ] TASK-10: Страница `/register-tutor` (мини-анкета + auto-role)
- [ ] TASK-11: AddStudentDialog — не закрывать после успеха (для групп)

### Sprint 3: «Полировка» (P2, ~2.5 дня)

- [ ] TASK-12: Welcome-экран при первом входе ученика
- [ ] TASK-13: Авто-email с данными для входа
- [ ] TASK-14: Кнопка «Сбросить пароль» в tutor-side профиле ученика

---

## Parking Lot

Элементы, вынесенные за scope текущей фичи:

- **Batch-добавление** (ввести 5 учеников за раз) — нужно только при >10 учеников, текущий сегмент 5-15
- **Роль «Родитель»** — отложена до валидации B2C-сегмента
- **Class code (Khan Academy модель)** — оверхед для 1:1/мини-группы, пересмотреть при масштабировании на школы
- **Telegram auth восстановление** — зависит от разблокировки Telegram в РФ
- **Password self-change** — ученик может сменить пароль; низкий приоритет при наличии Google OAuth

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0)
- [x] Привязка к Core Job из Графа работ (R4, R1, S1, P1)
- [x] Scope чётко определён (in/out)
- [x] UX-принципы из doc 16 учтены (Принцип 14: First Value in 3 Min)
- [x] UI-паттерны из doc 17 учтены (One Screen = One Primary Job, single CTA)
- [x] Pilot impact описан
- [x] Метрики успеха определены (>80% конверсия, <5 мин медиана)
- [x] High-risk файлы не затрагиваются без необходимости
- [x] Student/Tutor изоляция не нарушена
