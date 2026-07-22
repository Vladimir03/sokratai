DO $$
DECLARE _f RECORD;
BEGIN
  FOR _f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND starts_with(p.proname, 'kb_mod_')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', _f.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', _f.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', _f.sig);
  END LOOP;

  FOR _f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('kb_require_moderator', 'kb_require_moderator_subject')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', _f.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', _f.sig);
  END LOOP;
END $$;