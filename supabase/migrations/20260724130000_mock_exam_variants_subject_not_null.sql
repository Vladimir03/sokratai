-- Ревью 5.6 P2 #5 (2026-07-24): `mock_exam_variants.subject` обязателен.
--
-- Колонка добавлена 20260720170000 с backfill 'physics'; прод-проверка на дату
-- миграции — 0 NULL из 9 вариантов. Ставим DEFAULT 'physics' (легаси-предмет,
-- симметрично exam_type DEFAULT 'ege_physics') + NOT NULL, чтобы будущий INSERT
-- мимо edge не оставил вариант без предмета (грейдер/студенческая поверхность/
-- аналитика тогда молча трактуют его физикой).
--
-- Клиентский `?? 'physics'` в читателях (StudentMockExam, PublicMockInvite,
-- mockExamPublicApi, student-progress-build) СОХРАНЯЕТСЯ намеренно — он защищает
-- от deploy-skew: старый edge-бандл может не отдать поле `subject` в payload
-- даже когда колонка NOT NULL (состав payload определяет версия edge, а не
-- схема). Это НЕ дубль защиты, а разные слои.
--
-- Идемпотентно: SET DEFAULT перезаписывает, SET NOT NULL на колонке без NULL —
-- быстрый ACCESS EXCLUSIVE lock (только проверка существующих строк).

alter table public.mock_exam_variants
  alter column subject set default 'physics';

alter table public.mock_exam_variants
  alter column subject set not null;
