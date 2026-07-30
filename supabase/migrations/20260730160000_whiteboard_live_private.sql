-- Доска, Этап 4 (ревью этапов 3–4, P0): live-топик становится ПРИВАТНЫМ.
-- Раньше broadcast-канал board-live-<boardId> был публичным: любой, знающий
-- boardId (он виден каждому участнику), мог подключиться с anon-ключом,
-- подделать роль «Репетитор» и слать bring/follow/курсоры.
--
-- Realtime authorization: клиент подписывается с config.private=true, и Realtime
-- проверяет политики на realtime.messages (SELECT = получать, INSERT = слать).
-- Публичные каналы других фич (typing-канал чата) эти политики НЕ задевают —
-- authorization применяется только к private-каналам.
--
-- Остаточный риск (принят, задокументирован): АУТЕНТИФИЦИРОВАННЫЙ участник
-- доски по-прежнему может подделать meta (имя/роль) внутри канала — полная
-- серверная подпись отправителя потребовала бы релей; вне скоупа v1.
-- Идемпотентна.

DROP POLICY IF EXISTS board_live_recv ON realtime.messages;
CREATE POLICY board_live_recv ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.topic() LIKE 'board-live-%'
    AND substring(realtime.topic() FROM 12) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.is_board_participant((substring(realtime.topic() FROM 12))::uuid)
  );

DROP POLICY IF EXISTS board_live_send ON realtime.messages;
CREATE POLICY board_live_send ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.topic() LIKE 'board-live-%'
    AND substring(realtime.topic() FROM 12) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.is_board_participant((substring(realtime.topic() FROM 12))::uuid)
  );
