-- Доска, фаза P0 Этап 4 (follow/bring): персистентный bring-сигнал для ГОСТЕЙ.
-- Ученики с аккаунтом получают «Привести ко мне» мгновенно по broadcast-каналу,
-- у гостя нет JWT → нет Realtime → он забирает последний bring поллингом
-- /signals (whiteboard-public). Идемпотентна.
--
-- Anti-leak: колонка НЕ добавляется в column-list GRANT SELECT для authenticated
-- (грант на boards перечисляет колонки явно, миграция 20260729120000) — клиенты
-- читают bring только через edge; ученикам он и не нужен (broadcast).

ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS live_bring jsonb NULL;

COMMENT ON COLUMN public.boards.live_bring IS
  '«Привести всех»: { seq, bounds{minX,minY,maxX,maxY}, at }. Пишет только edge whiteboard-api (репетитор); гость читает через whiteboard-public /signals. Клиент дедупит по seq и игнорирует старше 2 минут.';
