-- ============================================================================
-- Правки таксономии по фидбэку репетиторов (2026-08-07)
--
-- ИСТОЧНИК: Милада (обществознание) и Ксения (математика) — ответы на документы
-- согласования. Все затронутые темы созданы сегодня и содержат 0 задач
-- (проверено запросом перед написанием), поэтому переименования и удаления
-- ничего не теряют.
--
-- ⚠️ ЧЕГО ЗДЕСЬ НЕТ. Предложения Ксении по ЕГЭ профиль НЕ применяются: у неё
-- «Планиметрия» стоит и на №1, и на №17, «Стереометрия» — на №3 и №14. Тема
-- матчится ТОЧНЫМ именем (rule 50), поэтому два одинаковых имени сломали бы
-- автоподстановку. Вынесено на уточнение; ЕГЭ в базу пока не заводится.
--
-- Идемпотентно: все UPDATE/DELETE самоотменяются на повторном прогоне,
-- удаления дополнительно защищены проверкой «на теме/подтеме нет задач».
-- ============================================================================

-- ─── 1. ОБЩЕСТВОЗНАНИЕ: убрать подтемы целиком (решение Милады) ─────────────
-- «Я бы вообще пока убрала подтемы, а то их там будет больше и это надо делить,
-- пусть пока не будет подтем». Удаляем только те, на которые никто не ссылается.
DELETE FROM public.kb_subtopics s
 USING public.kb_topics t
 WHERE s.topic_id = t.id
   AND t.subject = 'social' AND t.exam = 'oge'::exam_type
   AND NOT EXISTS (SELECT 1 FROM public.kb_tasks k WHERE k.subtopic_id = s.id);

-- ─── 2. ОБЩЕСТВОЗНАНИЕ: слияние «Право» (16+17) и «Экономика» (7+8) ─────────
-- Милада: «в 17 задании тема "Право"», «8 задание оставим "Экономика"».
-- Буквально это дало бы ДВА «Право» и ДВА «Экономика» (16 и 7 уже так
-- называются) — недопустимо при матчинге по имени. Единственное прочтение,
-- которое работает: одна тема на оба задания, номера — в `kim_numbers`
-- (ровно так устроена физика: «Кинематика» = [1,5,6,21,22,26]).
UPDATE public.kb_topics
   SET kim_numbers = ARRAY[16,17]
 WHERE subject = 'social' AND exam = 'oge'::exam_type AND name = 'Право'
   AND kim_numbers <> ARRAY[16,17];

DELETE FROM public.kb_topics t
 WHERE t.subject = 'social' AND t.exam = 'oge'::exam_type AND t.name = 'Правоотношения'
   AND NOT EXISTS (SELECT 1 FROM public.kb_tasks k WHERE k.topic_id = t.id);

UPDATE public.kb_topics
   SET kim_numbers = ARRAY[7,8]
 WHERE subject = 'social' AND exam = 'oge'::exam_type AND name = 'Экономика'
   AND kim_numbers <> ARRAY[7,8];

DELETE FROM public.kb_topics t
 WHERE t.subject = 'social' AND t.exam = 'oge'::exam_type AND t.name = 'Экономическая задача'
   AND NOT EXISTS (SELECT 1 FROM public.kb_tasks k WHERE k.topic_id = t.id);

-- ─── 3. МАТЕМАТИКА ОГЭ, № 8: «Вычисления» → «Степени и корни» ──────────────
-- Ксения: «Да, 8 — Степени и корни лучше». Совпало с нашим же замечанием:
-- «Вычисления» (№8) и «Числа и вычисления» (№6) стояли рядом и путались.
UPDATE public.kb_topics
   SET name = 'Степени и корни'
 WHERE subject = 'maths' AND exam = 'oge'::exam_type AND name = 'Вычисления'
   AND kim_numbers = ARRAY[8];

-- ─── 4. МАТЕМАТИКА ОГЭ, № 1–5: семь реальных сюжетов вместо трёх корзин ────
-- Ксения: «В задании 1-5 семь видов задач: Баня, Дорога, Участок, Квартира,
-- Шины, Тарифы, Листы бумаги». У РЕШУ это были три укрупнённые корзины
-- («Путешествия», «Квартиры и садовые участки», «Связь, шины, печки») —
-- репетитор режет по реальным сюжетам, это точнее.
DELETE FROM public.kb_subtopics s
 USING public.kb_topics t
 WHERE s.topic_id = t.id
   AND t.subject = 'maths' AND t.exam = 'oge'::exam_type
   AND t.name = 'Задачи с практическим содержанием'
   AND s.name IN ('Путешествия', 'Квартиры и садовые участки', 'Связь, шины, печки')
   AND NOT EXISTS (SELECT 1 FROM public.kb_tasks k WHERE k.subtopic_id = s.id);

INSERT INTO public.kb_subtopics (topic_id, name, sort_order)
SELECT t.id, v.name, v.sort_order
FROM (VALUES
  ('Баня', 10), ('Дорога', 20), ('Участок', 30), ('Квартира', 40),
  ('Шины', 50), ('Тарифы', 60), ('Листы бумаги', 70)
) AS v(name, sort_order)
JOIN public.kb_topics t
  ON t.subject = 'maths' AND t.exam = 'oge'::exam_type
 AND t.name = 'Задачи с практическим содержанием'
WHERE NOT EXISTS (
  SELECT 1 FROM public.kb_subtopics x WHERE x.topic_id = t.id AND x.name = v.name
);

-- ─── 5. МАТЕМАТИКА ОГЭ, № 11: убрать «Растяжения и сдвиги» ─────────────────
-- Ксения: «В задании 11 нет никакого растяжения и сжатия. Там просто виды
-- графиков функций». Подтему удаляем; новую не выдумываем — ждём ответа,
-- нужны ли «Линейная функция / Парабола / Гипербола».
DELETE FROM public.kb_subtopics s
 USING public.kb_topics t
 WHERE s.topic_id = t.id
   AND t.subject = 'maths' AND t.exam = 'oge'::exam_type
   AND t.name = 'Графики функций' AND s.name = 'Растяжения и сдвиги'
   AND NOT EXISTS (SELECT 1 FROM public.kb_tasks k WHERE k.subtopic_id = s.id);

-- ─── 6. МАТЕМАТИКА ОГЭ, № 12: убрать «Линейные уравнения» ──────────────────
-- Ксения: «Задание 12 — просто вычисления по формулам. Отдельно линейных
-- уравнений нет. Там дана физическая задача и формула для её решения».
DELETE FROM public.kb_subtopics s
 USING public.kb_topics t
 WHERE s.topic_id = t.id
   AND t.subject = 'maths' AND t.exam = 'oge'::exam_type
   AND t.name = 'Расчёты по формулам' AND s.name = 'Линейные уравнения'
   AND NOT EXISTS (SELECT 1 FROM public.kb_tasks k WHERE k.subtopic_id = s.id);
