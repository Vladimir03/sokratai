-- ВОЛНА 6 hardening: снять EXECUTE у роли `anon` со ВСЕГО семейства
-- модераторских RPC каталога (kb_mod_*) + гейт-хелперов kb_require_moderator*.
--
-- Почему: Supabase default privileges схемы public грантят EXECUTE роли `anon`
-- НАПРЯМУЮ, поэтому `REVOKE ... FROM PUBLIC` (как в 20260722120000 и во всех
-- более ранних kb_mod_*-миграциях) её НЕ снимает — тот же класс, что инцидент
-- `yookassa_record_refund` (rule 99, фикс 20260715150000). Проверка в проде
-- 2026-07-22 показала anon_exec = true у ВСЕХ kb_mod_* (не регресс ВОЛНЫ 6 —
-- пред-существующий baseline семейства).
--
-- Эксплуатируемости НЕТ (defense-in-depth): каждая из этих функций первым
-- действием зовёт kb_require_moderator()/kb_require_moderator_subject(), а те
-- начинаются с `auth.uid()` → у anon NULL → RAISE «Требуется вход в систему».
-- Т.е. anon и сейчас получает исключение и нулевой эффект. Эта миграция лишь
-- приводит гранты в соответствие с инвариантом rule 99.
--
-- Аддитивно и идемпотентно: только REVOKE/GRANT, ни одна функция не меняется.
-- authenticated ЯВНО грантится заново (belt-and-suspenders): у части старых
-- функций доступ мог держаться на PUBLIC-гранте, и мы его не трогаем, но явный
-- GRANT гарантирует, что репетиторы-модераторы ничего не теряют.

DO $$
DECLARE _f RECORD;
BEGIN
  -- 1) Публичные модераторские RPC: anon — нет, authenticated — да.
  --    `starts_with(proname,'kb_mod_')` намеренно НЕ ловит приватные примитивы
  --    `_kb_mod_*` (те и так закрыты от anon+authenticated в 20260722120000).
  --
  --    ПОРЯДОК ВАЖЕН: сначала явный GRANT authenticated, потом REVOKE PUBLIC.
  --    `kb_mod_reassign` / `kb_mod_unpublish` (moderation V2) PUBLIC-грант так и
  --    держали, а `has_function_privilege('anon', …)` истинна и через PUBLIC —
  --    поэтому одного `REVOKE FROM anon` им мало. Снимать PUBLIC безопасно
  --    ТОЛЬКО после прямого гранта authenticated (иначе отняли бы доступ у
  --    модераторов, у которых он держался на PUBLIC).
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

  -- 2) Гейт-хелперы: снять anon + PUBLIC. Их вызывают SECURITY DEFINER-функции
  --    внутри себя (грант вызывающего не требуется), поэтому authenticated им
  --    заново не грантим — только закрываем anon-путь.
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
