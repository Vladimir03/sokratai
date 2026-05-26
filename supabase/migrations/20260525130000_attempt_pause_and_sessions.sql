-- AC-P10 (2026-05-25): Pause & Multi-Session Timer.
--
-- Pilot feedback от учеников (Володя 2026-05-25): «не могу найти 4 часа подряд».
-- Pilot adoption blocker — ученики 16-18 имеют фрагментированный график (школа,
-- репетиторы, тренировки) и не садятся за пробник на 4 часа сразу. Результат:
-- пробник не делается вообще.
--
-- Решение: 2 режима + pause/resume в режиме Тренировка.
--
-- ┌─────────────────────┬─────────────────────────────────────────────────────┐
-- │ exam_mode           │ Поведение                                           │
-- ├─────────────────────┼─────────────────────────────────────────────────────┤
-- │ 'simulation'        │ Wall-clock timer 235 мин. Pause недоступна.        │
-- │                     │ Закрыл tab → timer идёт. Как реальный ЕГЭ.         │
-- ├─────────────────────┼─────────────────────────────────────────────────────┤
-- │ 'training' (default)│ Active time only. Pause останавливает timer.        │
-- │                     │ Multi-session. Вернись через неделю — продолжишь.  │
-- └─────────────────────┴─────────────────────────────────────────────────────┘
--
-- Ученик при первом open пробника видит modal с pre-selected mode (tutor default)
-- + override.
--
-- Schema additions:
-- 1. `mock_exam_attempts.exam_mode` — immutable после start. Default 'training'.
-- 2. `mock_exam_attempts.sessions JSONB` — array of {started_at, ended_at}.
--    Latest session.ended_at = null ⟺ status='in_progress'.
--    При pause — закрываем session (ended_at = now). При resume — append новую.
-- 3. `mock_exam_attempts.total_active_ms` — кэш SUM(session.duration). Recompute
--    при pause/resume/submit для быстрых KPI запросов.
-- 4. `mock_exam_attempts.status` enum расширен: + 'paused'.
-- 5. `mock_exam_assignments.default_exam_mode` — tutor задаёт recommended mode
--    при создании. Ученик может override.
--
-- Backward compat:
-- - Existing rows получают exam_mode='training' (DEFAULT). Pilot Егор attempts
--   продолжают работать в training mode (pause доступен post-deploy).
-- - sessions = '[]'::jsonb для existing (нет history до миграции). Их total_active_ms
--   остаётся 0 — это OK, потому что у них есть total_time_minutes (legacy).
-- - assignment.default_exam_mode = 'training' default для existing assignments.
--
-- Cross-reference: CLAUDE.md §15 (mock-exams) после deploy добавится подсекция
-- «Pause & multi-session timer».

-- ─── 1. mock_exam_attempts: новые колонки ──────────────────────────────────

ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS exam_mode TEXT NOT NULL DEFAULT 'training'
    CHECK (exam_mode IN ('simulation', 'training'));

ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS sessions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.mock_exam_attempts
  ADD COLUMN IF NOT EXISTS total_active_ms BIGINT NOT NULL DEFAULT 0;

-- ─── 2. mock_exam_attempts.status enum: + 'paused' ──────────────────────────
-- Идемпотентно: дропаем существующий CHECK, переcreate с новым списком.

ALTER TABLE public.mock_exam_attempts
  DROP CONSTRAINT IF EXISTS mock_exam_attempts_status_check;

ALTER TABLE public.mock_exam_attempts
  ADD CONSTRAINT mock_exam_attempts_status_check CHECK (status IN (
    'in_progress',
    'paused',           -- NEW (AC-P10): pause доступна в exam_mode='training'
    'submitted',
    'ai_checking',
    'awaiting_review',
    'approved',
    'manually_entered'
  ));

-- ─── 3. mock_exam_assignments.default_exam_mode ─────────────────────────────

ALTER TABLE public.mock_exam_assignments
  ADD COLUMN IF NOT EXISTS default_exam_mode TEXT NOT NULL DEFAULT 'training'
    CHECK (default_exam_mode IN ('simulation', 'training'));

-- ─── 4. Comments ────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.mock_exam_attempts.exam_mode IS
  'AC-P10 (2026-05-25): immutable mode прохождения пробника. ''simulation'' = wall-clock 4ч без pause (real ЕГЭ); ''training'' = active time only + pause/resume доступна. Default ''training'' для adoption flexibility.';

COMMENT ON COLUMN public.mock_exam_attempts.sessions IS
  'AC-P10: array of {started_at: ISO, ended_at: ISO|null}. Latest session.ended_at=null ⟺ status=''in_progress''. При pause закрываем session. Используется для tutor visibility (Solo time + session breakdown).';

COMMENT ON COLUMN public.mock_exam_attempts.total_active_ms IS
  'AC-P10: кэш SUM(session.duration_ms) для быстрых KPI запросов. Recompute при pause/resume/submit. Для simulation mode = (submitted_at - started_at) wall-clock; для training = sum of active sessions.';

COMMENT ON COLUMN public.mock_exam_assignments.default_exam_mode IS
  'AC-P10: рекомендованный режим прохождения для учеников. Ученик видит pre-selected при start, может override. Tutor хочет ''simulation'' для финального assessment перед экзаменом, ''training'' для частых пробников.';
