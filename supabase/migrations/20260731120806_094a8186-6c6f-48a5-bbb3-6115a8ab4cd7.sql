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

CREATE UNIQUE INDEX IF NOT EXISTS uq_board_guests_active_member
  ON public.board_guests (share_link_id, tutor_student_id)
  WHERE revoked_at IS NULL AND tutor_student_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_board_guests_active_free_name
  ON public.board_guests (share_link_id, lower(btrim(display_name)))
  WHERE revoked_at IS NULL AND tutor_student_id IS NULL;