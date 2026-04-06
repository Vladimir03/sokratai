# PRD (по задачам) — AI‑проверка ДЗ в Telegram‑боте «Сократ»

Контекст: продукт «Сократ» уже имеет TG Bot на Supabase Edge Functions (TS/Deno), Gemini API интеграцию, Supabase Auth/БД, KaTeX, таблицу `solutions`, связку ученик↔репетитор, React кабинет (Lovable), Supabase Storage. Новая фича — режим «Домашка» с выдачей ДЗ репетитором, сдачей учеником (фото/текст), AI‑проверкой и режимом «разбор ошибок».

Технологии: TypeScript, Deno (Supabase Edge Functions), Supabase Postgres + RLS, Supabase Storage, Telegram Bot API, Gemini 2.5 Flash (vision + text).

Глобальные принципы:
- **Один бот**: все новые сценарии — внутри существующего @SocratBot.
- **IDLE не ломаем**: если пользователь в `IDLE`, работает прежний AI‑чат.
- **State machine**: весь UX бота управляется состояниями в БД `user_bot_state`.
- **Никаких готовых ответов** ученику в фидбеке: только намёк/наводящие вопросы (Сократический метод).
- **Без OCR‑сервиса**: используем vision‑модель для распознавания рукописного текста.

---

## Общие определения и доменная модель
**Роли**
- Tutor (репетитор): создаёт/назначает ДЗ, видит результаты, может корректировать AI.
- Student (ученик): видит назначенные ДЗ, сдаёт ответы, получает AI‑фидбек.

**Объекты**
- Assignment: домашка (заголовок, предмет, дедлайн, статусы).
- Task: задача внутри домашки.
- Submission: сдача домашки конкретным учеником.
- SubmissionItem: ответ по одной задаче (фото/текст, распознанный текст, AI‑оценка).

**Статусы**
- `homework_assignments.status`: `draft | active | closed`
- `homework_submissions.status`: `in_progress | submitted | ai_checked | tutor_reviewed`
- `user_bot_state.state`: `IDLE | HW_SELECTING | HW_SUBMITTING | HW_CONFIRMING | HW_REVIEW`

**Storage**
- bucket: `homework-images`
- path convention: `homework/{assignment_id}/{submission_id}/{task_id}/{uuid}.jpg`

---

# Спринт 1 — Ядро: БД + фото + AI‑проверка


---

# Общие DoD (Definition of Done) для любой задачи
- Есть код в указанном файле/папке.
- Есть минимальные тест‑кейсы (ручные сценарии или unit tests где уместно).
- Логи ошибок понятные.
- Не сломан существующий AI‑чат в `IDLE`.
- Контракты API/JSON стабильны и документированы.

# Быстрый шаблон «промпта для Codex/Claude» (копипаста)
Используй для любой задачи как preamble:
- Ты Senior Full‑Stack Engineer. Проект: TS/Deno + Supabase Edge Functions + Telegram Bot API.
- Не ломай существующий функционал.
- Пиши компактно, делай изменения минимально инвазивно.
- Добавляй типы TS, валидацию входа, и обработку ошибок.
- Результат: готовый код + комментарии, где что подключить.
