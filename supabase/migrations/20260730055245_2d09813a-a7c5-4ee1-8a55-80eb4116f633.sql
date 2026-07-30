ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS live_bring jsonb NULL;

COMMENT ON COLUMN public.boards.live_bring IS
  '«Привести всех»: { seq, bounds{minX,minY,maxX,maxY}, at }. Пишет только edge whiteboard-api (репетитор); гость читает через whiteboard-public /signals. Клиент дедупит по seq и игнорирует старше 2 минут.';