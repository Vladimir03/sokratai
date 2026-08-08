DELETE FROM public.kb_subtopics s
 USING public.kb_topics t
 WHERE s.topic_id = t.id
   AND t.subject = 'social' AND t.exam = 'oge'::exam_type
   AND NOT EXISTS (SELECT 1 FROM public.kb_tasks k WHERE k.subtopic_id = s.id);

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

UPDATE public.kb_topics
   SET name = 'Степени и корни'
 WHERE subject = 'maths' AND exam = 'oge'::exam_type AND name = 'Вычисления'
   AND kim_numbers = ARRAY[8];

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

DELETE FROM public.kb_subtopics s
 USING public.kb_topics t
 WHERE s.topic_id = t.id
   AND t.subject = 'maths' AND t.exam = 'oge'::exam_type
   AND t.name = 'Графики функций' AND s.name = 'Растяжения и сдвиги'
   AND NOT EXISTS (SELECT 1 FROM public.kb_tasks k WHERE k.subtopic_id = s.id);

DELETE FROM public.kb_subtopics s
 USING public.kb_topics t
 WHERE s.topic_id = t.id
   AND t.subject = 'maths' AND t.exam = 'oge'::exam_type
   AND t.name = 'Расчёты по формулам' AND s.name = 'Линейные уравнения'
   AND NOT EXISTS (SELECT 1 FROM public.kb_tasks k WHERE k.subtopic_id = s.id);