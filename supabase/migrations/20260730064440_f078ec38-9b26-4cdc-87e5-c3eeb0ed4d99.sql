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