-- Доска, фикс-пасс по ревью guest-sheets (P1 №1): конкурентный двойной вход
-- одной личности создавал ДВУХ активных гостей и два листа (join неатомарен:
-- оба читали пустой priorGuests). Уникальность активной личности на ссылке
-- закрывается на уровне БД; edge при 23505 повторяет join-цикл один раз —
-- второй заход видит первого в priorGuests и корректно ревокает/перепривязывает.
-- Идемпотентна.

-- ─── 0. Cleanup существующих дублей (тесты 30–31.07: «Владимир, Владимир») ────
-- Выживает самый свежий вход каждой личности; листы дублей переезжают к нему.

WITH ranked AS (
  SELECT
    id,
    share_link_id,
    COALESCE(tutor_student_id::text, lower(btrim(display_name))) AS identity_key,
    ROW_NUMBER() OVER (
      PARTITION BY share_link_id,
        COALESCE(tutor_student_id::text, lower(btrim(display_name)))
      ORDER BY created_at DESC
    ) AS rn
  FROM public.board_guests
  WHERE revoked_at IS NULL
),
survivors AS (
  SELECT share_link_id, identity_key, id AS survivor_id FROM ranked WHERE rn = 1
),
dupes AS (
  SELECT r.id, s.survivor_id
  FROM ranked r
  JOIN survivors s
    ON s.share_link_id = r.share_link_id AND s.identity_key = r.identity_key
  WHERE r.rn > 1
),
rebound AS (
  UPDATE public.board_pages p
  SET zone_guest_id = d.survivor_id
  FROM dupes d
  WHERE p.zone_guest_id = d.id
  RETURNING p.id
)
UPDATE public.board_guests g
SET revoked_at = now()
FROM dupes d
WHERE g.id = d.id;

-- ─── 1. Уникальность активной личности на ссылке ──────────────────────────────

-- Ученик CRM: одна активная запись на (ссылка, tutor_student_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_board_guests_active_member
  ON public.board_guests (share_link_id, tutor_student_id)
  WHERE revoked_at IS NULL AND tutor_student_id IS NOT NULL;

-- Свободное имя: одна активная запись на (ссылка, нормализованное имя).
CREATE UNIQUE INDEX IF NOT EXISTS uq_board_guests_active_free_name
  ON public.board_guests (share_link_id, lower(btrim(display_name)))
  WHERE revoked_at IS NULL AND tutor_student_id IS NULL;
