-- Phase 11 backfill (2026-05-31) — проставить cefr_level существующим French ДЗ
-- Эмилии, считав уровень из НАЗВАНИЯ ДЗ (он там подписан: «DELF A2 …», «… B1 …»),
-- и критерии того же уровня уже загружены тутором (подтвердил Vladimir 2026-05-31).
--
-- Context: до Phase 11 CEFR-селектор был per-task и не замечен («не видела опцию»)
-- → ВСЕ её French-задачи остались cefr_level NULL → AI молча грейдил по B1
-- (A2-работы проверялись по B1 + «160 слов» вместо 60-80). Phase 11 сделал
-- уровень обязательным для новых/редактируемых ДЗ; этот backfill чинит уже
-- существующие, чтобы тутору не пересохранять каждое вручную.
--
-- Алгоритм: парсим явный CEFR-токен из title (word-boundary, case-insensitive),
-- проставляем письменным/устным задачам. CASE-приоритет A2 → B1 → B2 → C1.
--
-- Safety:
--   • Только cefr_level IS NULL — НЕ перезаписываем явно заданный уровень.
--   • Только subject='french' (репортнутый кейс; другие языки — отдельно при нужде).
--   • Только письменные/устные (extended/proof/speaking) — numeric грамм-дриллам
--     CEFR не нужен.
--   • Только titles с явным маркером (A2|B1|B2|C1) — без маркера остаётся NULL,
--     tutor задаст вручную (Phase 11 required-валидация форсит при edit).
--   • Идемпотентно: повторный прогон не тронет уже проставленные (IS NULL фильтр).
--
-- `\y` = word boundary в Postgres POSIX (ARE); `~*` = case-insensitive match.
-- «DELF A2 TP PO Ex.2 Partie 2» → \yA2\y матчит «A2»; «Ex.2»/«Partie 2» не дают
-- ложного B2/C1 (там нет токенов «B2»/«C1»).

UPDATE public.homework_tutor_tasks t
SET cefr_level = CASE
  WHEN a.title ~* '\yA2\y' THEN 'A2'
  WHEN a.title ~* '\yB1\y' THEN 'B1'
  WHEN a.title ~* '\yB2\y' THEN 'B2'
  WHEN a.title ~* '\yC1\y' THEN 'C1'
  ELSE NULL
END
FROM public.homework_tutor_assignments a
WHERE t.assignment_id = a.id
  AND a.subject = 'french'
  AND t.cefr_level IS NULL
  AND t.task_kind IN ('extended', 'proof', 'speaking')
  AND a.title ~* '\y(A2|B1|B2|C1)\y';
