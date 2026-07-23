-- ============================================================================
-- Нормализация legacy-id в profiles.subjects (ревью 5.6 P2 №9, 2026-07-23)
-- ============================================================================
-- Backfill 20260723140000 копировал difficult_subject в массив ВЕРБАТИМ —
-- включая legacy-id студенческого онбординга (math/rus/cs и школьные
-- algebra/geometry). Читатели (normalizeStudentSubjects) нормализуют на чтении
-- (belt-and-suspenders), но данные чиним и в БД: иначе каждый новый читатель
-- обязан помнить про нормализацию, а чипы «Мои предметы» без неё не
-- подсвечивались бы.
--
-- Идемпотентно: трогает только строки, где массив пересекается со словарём
-- legacy-id. Сохраняет порядок первого вхождения + дедуп после маппинга
-- (['math','maths'] → ['maths']). difficult_subject НЕ трогаем (compat-колонка,
-- читатели предпочитают массив).

with mapped as (
  select
    p.id,
    (
      select array_agg(m.new_id order by m.first_ord)
      from (
        select x.new_id, min(x.ord) as first_ord
        from (
          select
            case u.s
              when 'math' then 'maths'
              when 'algebra' then 'maths'
              when 'geometry' then 'maths'
              when 'rus' then 'russian'
              when 'cs' then 'informatics'
              else u.s
            end as new_id,
            u.ord
          from unnest(p.subjects) with ordinality as u(s, ord)
        ) x
        group by x.new_id
      ) m
    ) as new_subjects
  from public.profiles p
  where p.subjects && array['math', 'algebra', 'geometry', 'rus', 'cs']
)
update public.profiles p
set subjects = mapped.new_subjects
from mapped
where p.id = mapped.id;
