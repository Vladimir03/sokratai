-- =============================================================================
-- Архивирование ученика (запрос Елены Ивановой): «заархивировать ученика — сейчас
-- прекратила заниматься, но позже он, возможно, вернётся».
--
-- Ортогонально к status (active/paused/completed = прогрессия): archived_at —
-- флаг видимости. NULL = активный (в списках/пикерах), NOT NULL = в архиве
-- (скрыт из активных поверхностей, история сохранена, обратимо).
--
-- Почему НЕ status='archived': get_subscription_status RPC джойнит status='active'
-- (AI-квота платного репетитора). Отдельная колонка не трогает эту логику —
-- archived ученик остаётся status='active', просто скрыт из UI.
--
-- Additive only: новая nullable-колонка + partial index. tutor_students использует
-- table-level GRANT (не column-whitelist) → новая колонка покрыта, отдельный GRANT
-- не нужен. RLS (tutor владеет своими строками) уже разрешает SELECT/UPDATE.
-- =============================================================================

ALTER TABLE public.tutor_students
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

-- Partial index под частый запрос активного списка (archived_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_tutor_students_tutor_active
  ON public.tutor_students(tutor_id)
  WHERE archived_at IS NULL;
