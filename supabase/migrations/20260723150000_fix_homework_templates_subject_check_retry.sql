-- ══════════════════════════════════════════════════════════════════════════
-- Фикс «не сохраняется шаблон ДЗ» (репорт Ульяны Мухиной, химия, 2026-07-23)
-- ══════════════════════════════════════════════════════════════════════════
--
-- ЧАСТЬ 1 — ПОВТОРНОЕ применение 20260525120000_unify_homework_templates_subject_check.sql.
--
-- Тот файл лежит в репо с 2026-05-25, но в прод НИКОГДА не применялся: в
-- supabase_migrations.schema_migrations нет ни одной записи, трогающей
-- homework_tutor_templates_subject_check, а pg_constraint на 2026-07-23 отдавал
-- исходный легаси-список из 20260226100000_homework_20.sql:40 —
--   CHECK (subject = ANY (ARRAY['math','physics','history','social','english','cs']))
-- при том что homework_tutor_assignments_subject_check давно унифицирован
-- (20260414150000). Lovable молча пропустил файл при синке (соседние миграции
-- того дня применены под своими timestamp'ами).
--
-- Следствие: INSERT в homework_tutor_templates с subject вне легаси-списка
-- (chemistry / french / maths / russian / …) падал 23514 check_violation →
-- generic 500 DB_ERROR → тихий toast «Не удалось сохранить как шаблон».
-- На момент фикса заблокированы ВСЕ пути создания шаблона (чекбокс конструктора,
-- диалог «Сохранить как шаблон» на карточке ДЗ, форк из Банка) у 13 репетиторов:
-- french 22 ДЗ / 3 тьютора, chemistry 19/3, maths 14/7, russian 5/2.
--
-- Старый файл 20260525120000 НЕ трогаем (правка применённых/существующих
-- миграций запрещена, AGENTS.md → Database rules). Эта миграция идемпотентна —
-- повторное применение безопасно, как и одновременное существование обеих.
--
-- ИНВАРИАНТ (rule 40): при добавлении предмета в src/types/homework.ts SUBJECTS
-- обновлять ОБА CHECK одновременно. Паритет теперь автоматически проверяется
-- секцией «subject CHECK parity» в scripts/smoke-check.mjs (см. ЧАСТЬ 3).

ALTER TABLE public.homework_tutor_templates
  DROP CONSTRAINT IF EXISTS homework_tutor_templates_subject_check;

ALTER TABLE public.homework_tutor_templates
  ADD CONSTRAINT homework_tutor_templates_subject_check
  CHECK (subject IN (
    -- Canonical modern ids (src/types/homework.ts SUBJECTS + VALID_SUBJECTS_CREATE)
    'maths', 'physics', 'informatics',
    'russian', 'literature', 'history', 'social',
    'english', 'french', 'spanish',
    'chemistry', 'biology', 'geography',
    'other',
    -- Legacy ids preserved for backward compat с существующими шаблонами
    -- и с VALID_SUBJECTS_UPDATE в supabase/functions/homework-api/index.ts
    'math', 'cs', 'rus', 'algebra', 'geometry'
  ));

COMMENT ON CONSTRAINT homework_tutor_templates_subject_check ON public.homework_tutor_templates IS
  'Unified subject CHECK (re-applied 2026-07-23 после пропуска синка 20260525120000). Mirror homework_tutor_assignments_subject_check. Паритет проверяет smoke-check «subject CHECK parity» через hw_subject_check_defs().';

-- ══════════════════════════════════════════════════════════════════════════
-- ЧАСТЬ 2 — hw_template_task_counts: ВЛАДЕЛЕЦ ОПРЕДЕЛЕНИЯ — 20260723160000.
--
-- Изначально эта миграция сама делала CREATE OR REPLACE (junction + длина
-- legacy tasks_json СЛОЖЕНИЕМ), чтобы `handleListTemplates` перестал тянуть
-- весь `tasks_json` ради `.length`. Ревью 5.6 нашло, что сложение задваивает
-- счётчик в partial-state, и следующая миграция 20260723160000 заменила тело на
-- взаимоисключающий CASE.
--
-- Определение убрано ОТСЮДА намеренно (ревью 5.6 р.2, P2): миграции применяются
-- по timestamp, но повторное применение ОДНОЙ этой миграции после 160000
-- вернуло бы старое (сломанное) тело — реплей был бы не order-independent.
-- Теперь у функции ровно один владелец: 20260723160000.
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- ЧАСТЬ 3 — hw_subject_check_defs(): анти-дрейф гард для smoke-check.
--
-- Класс бага «миграция в репо ≠ применена в проде» уже кусал нас (rule 50/95) и
-- здесь стоил двух месяцев сломанных шаблонов у 13 репетиторов. Гард в
-- scripts/smoke-check.mjs сверяет два CHECK между собой и с SUBJECTS из
-- src/types/homework.ts — и падает, если очередная миграция снова не доедет.
--
-- Только определения констрейнтов (публичный DDL, не данные). GRANT'им
-- authenticated, чтобы smoke-check мог работать под publishable-ключом
-- (SUPABASE_SERVICE_ROLE_KEY в CI не задан — см. skip-ветку скрипта).
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.hw_subject_check_defs()
RETURNS TABLE (constraint_name TEXT, definition TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT con.conname::TEXT, pg_get_constraintdef(con.oid)::TEXT
  FROM pg_constraint con
  WHERE con.conname IN (
    'homework_tutor_templates_subject_check',
    'homework_tutor_assignments_subject_check',
    -- Варианты пробников тоже валидируются по единому реестру
    -- (mock-exam-tutor-api::VALID_VARIANT_SUBJECTS) → их CHECK обязан
    -- совпадать с каноническим набором (без легаси — их там не бывает).
    'mock_exam_variants_subject_check'
  );
$$;

REVOKE ALL ON FUNCTION public.hw_subject_check_defs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_subject_check_defs() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.hw_subject_check_defs() IS
  'Read-only DDL двух subject-CHECK для гарда «subject CHECK parity» в scripts/smoke-check.mjs. Ловит пропущенные миграции (инцидент 2026-07-23).';
