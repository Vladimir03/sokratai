-- Доска, «Лист — каждому вошедшему» (фаза 1, дискавери 31.07):
-- 1) вторая привязка листа — к ГОСТЮ (ученик не из CRM получает свой лист);
-- 2) бэкфил имён самопривязавшихся учеников (источник «Ученик ×N» в пикерах:
--    claim-invite и telegram-bot создавали связку без display_name).
-- Идемпотентна.

-- ─── 1. Лист гостя ────────────────────────────────────────────────────────────

ALTER TABLE public.board_pages
  ADD COLUMN IF NOT EXISTS zone_guest_id uuid NULL
    REFERENCES public.board_guests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_board_pages_zone_guest
  ON public.board_pages(zone_guest_id) WHERE zone_guest_id IS NOT NULL;

-- Лист принадлежит ЛИБО ученику CRM, ЛИБО гостю — не обоим (писатели обязаны
-- занулять вторую привязку в том же UPDATE).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_board_pages_single_zone'
  ) THEN
    ALTER TABLE public.board_pages
      ADD CONSTRAINT chk_board_pages_single_zone
      CHECK (NOT (zone_tutor_student_id IS NOT NULL AND zone_guest_id IS NOT NULL));
  END IF;
END $$;

-- Участникам (ученикам с аккаунтом) колонка видна: это НЕ bearer (bearer —
-- guest_token), а маркер принадлежности листа — нужен для консистентного
-- рендера рамок. RLS фильтрует строки, GRANT — колонки (rule 40).
GRANT SELECT (zone_guest_id) ON public.board_pages TO authenticated;

COMMENT ON COLUMN public.board_pages.zone_guest_id IS
  'Лист гостя без аккаунта (board_guests.id). Взаимоисключим с zone_tutor_student_id. Пишет только edge.';

-- ─── 2. Бэкфил имён самопривязавшихся учеников ────────────────────────────────
-- claim-invite / telegram-bot создавали tutor_students без display_name —
-- в пикерах доски, чатах и аналитике такие ученики показывались как «Ученик».
-- Имя берём из профиля ученика (profiles.username).

UPDATE public.tutor_students ts
SET display_name = btrim(p.username)
FROM public.profiles p
WHERE p.id = ts.student_id
  AND (ts.display_name IS NULL OR btrim(ts.display_name) = '')
  AND p.username IS NOT NULL
  AND btrim(p.username) <> '';
