-- =============================================
-- Мини-группы по умолчанию ВКЛ для всех репетиторов.
--
-- Решение Vladimir (2026-06-07): репетиторы (Егор, Елена) просили, чтобы группы
-- работали по умолчанию без поиска тумблера. Выбор «Только индивидуальные /
-- Индивидуальные + мини-группы» переезжает в профиль; шапочный тумблер удаляется.
-- Колонка остаётся той же (без enum-churn), меняется только дефолт + backfill.
--
-- mini_groups_enabled — BOOLEAN NOT NULL DEFAULT false (миграции 20260223*).
-- Тутор, которому нужен только индивидуальный режим, выключает это в профиле.
-- =============================================

-- 1. Новый дефолт для будущих репетиторов.
ALTER TABLE public.tutors
  ALTER COLUMN mini_groups_enabled SET DEFAULT true;

-- 2. Backfill существующих (false → true; колонка NOT NULL, NULL быть не должно,
--    IS DISTINCT FROM — защитно).
UPDATE public.tutors
  SET mini_groups_enabled = true
  WHERE mini_groups_enabled IS DISTINCT FROM true;
