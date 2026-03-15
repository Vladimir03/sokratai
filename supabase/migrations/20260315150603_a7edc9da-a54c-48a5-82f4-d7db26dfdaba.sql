DO $$
DECLARE
  _vlajnost_id UUID;
  _photons_id  UUID;
  _bohr_id     UUID;
  _nuclear_id  UUID;
  _decay_id    UUID;
BEGIN

  -- ══════════════════════════════════════════════════════════════════════════
  -- МКТ И ТЕРМОДИНАМИКА
  -- ══════════════════════════════════════════════════════════════════════════

  -- ── Молекулярная физика (d1000001-...0006) ───────────────────────────────
  UPDATE kb_topics
  SET kim_numbers = ARRAY[7,9,10,21,23,24],
      section     = 'МКТ и термодинамика',
      sort_order  = 60
  WHERE id = 'd1000001-0001-4000-a000-000000000006';

  DELETE FROM kb_subtopics WHERE topic_id = 'd1000001-0001-4000-a000-000000000006';

  INSERT INTO kb_subtopics (topic_id, name, sort_order) VALUES
    ('d1000001-0001-4000-a000-000000000006', 'Основное уравнение МКТ',            1),
    ('d1000001-0001-4000-a000-000000000006', 'Уравнение Менделеева-Клапейрона',   2),
    ('d1000001-0001-4000-a000-000000000006', 'Закон Дальтона',                    3),
    ('d1000001-0001-4000-a000-000000000006', 'Средняя квадратичная скорость',     4);

  -- ── Влажность (NEW topic) ────────────────────────────────────────────────
  INSERT INTO kb_topics (name, section, exam, kim_numbers, sort_order)
  VALUES ('Влажность', 'МКТ и термодинамика', 'ege', ARRAY[7,9,10,21,23,24], 70)
  RETURNING id INTO _vlajnost_id;

  INSERT INTO kb_subtopics (topic_id, name, sort_order) VALUES
    (_vlajnost_id, 'Давление насыщенных паров', 1),
    (_vlajnost_id, 'Плотность насыщенных паров', 2),
    (_vlajnost_id, 'Изотерма водяного пара',     3),
    (_vlajnost_id, 'Влажный воздух',             4);

  -- ── Термодинамика (d1000001-...0007) ────────────────────────────────────
  UPDATE kb_topics
  SET kim_numbers = ARRAY[8,9,10,21,23,24],
      section     = 'МКТ и термодинамика',
      sort_order  = 80
  WHERE id = 'd1000001-0001-4000-a000-000000000007';

  DELETE FROM kb_subtopics WHERE topic_id = 'd1000001-0001-4000-a000-000000000007';

  INSERT INTO kb_subtopics (topic_id, name, sort_order) VALUES
    ('d1000001-0001-4000-a000-000000000007', 'Внутренняя энергия',           1),
    ('d1000001-0001-4000-a000-000000000007', 'Работа газа',                  2),
    ('d1000001-0001-4000-a000-000000000007', 'Первое начало термодинамики',  3),
    ('d1000001-0001-4000-a000-000000000007', 'Тепловые машины',              4),
    ('d1000001-0001-4000-a000-000000000007', 'Тепловые явления',             5);


  -- ══════════════════════════════════════════════════════════════════════════
  -- ЭЛЕКТРОДИНАМИКА
  -- ══════════════════════════════════════════════════════════════════════════

  -- ── Электростатика (d1000001-...0008) ───────────────────────────────────
  UPDATE kb_topics
  SET kim_numbers = ARRAY[11,14,15,21,23,25],
      section     = 'Электродинамика',
      sort_order  = 90
  WHERE id = 'd1000001-0001-4000-a000-000000000008';

  DELETE FROM kb_subtopics WHERE topic_id = 'd1000001-0001-4000-a000-000000000008';

  INSERT INTO kb_subtopics (topic_id, name, sort_order) VALUES
    ('d1000001-0001-4000-a000-000000000008', 'Взаимодействие зарядов', 1),
    ('d1000001-0001-4000-a000-000000000008', 'Напряженность',          2),
    ('d1000001-0001-4000-a000-000000000008', 'Потенциал',              3),
    ('d1000001-0001-4000-a000-000000000008', 'Конденсаторы',           4);

  -- ── Постоянный ток (d1000001-...0009) ───────────────────────────────────
  UPDATE kb_topics
  SET kim_numbers = ARRAY[11,14,15,21,23,25],
      section     = 'Электродинамика',
      sort_order  = 100
  WHERE id = 'd1000001-0001-4000-a000-000000000009';

  DELETE FROM kb_subtopics WHERE topic_id = 'd1000001-0001-4000-a000-000000000009';

  INSERT INTO kb_subtopics (topic_id, name, sort_order) VALUES
    ('d1000001-0001-4000-a000-000000000009', 'Закон Ома для участка цепи',  1),
    ('d1000001-0001-4000-a000-000000000009', 'Закон Ома для полной цепи',   2),
    ('d1000001-0001-4000-a000-000000000009', 'Мощность электрического тока', 3);

  -- ── Магнетизм (d1000001-...000a) ────────────────────────────────────────
  UPDATE kb_topics
  SET kim_numbers = ARRAY[12,14,15,21,23,25],
      section     = 'Электродинамика',
      sort_order  = 110
  WHERE id = 'd1000001-0001-4000-a000-00000000000a';

  DELETE FROM kb_subtopics WHERE topic_id = 'd1000001-0001-4000-a000-00000000000a';

  INSERT INTO kb_subtopics (topic_id, name, sort_order) VALUES
    ('d1000001-0001-4000-a000-00000000000a', 'Магнитное поле',              1),
    ('d1000001-0001-4000-a000-00000000000a', 'Сила Ампера',                 2),
    ('d1000001-0001-4000-a000-00000000000a', 'Сила Лоренца',                3),
    ('d1000001-0001-4000-a000-00000000000a', 'Электромагнитная индукция',   4),
    ('d1000001-0001-4000-a000-00000000000a', 'Самоиндукция',                5);

  -- ── Смешанные цепи (repurpose d1000001-...000b)
  UPDATE kb_topics
  SET name        = 'Смешанные цепи',
      section     = 'Электродинамика',
      kim_numbers = ARRAY[14,21,23,25],
      sort_order  = 120
  WHERE id = 'd1000001-0001-4000-a000-00000000000b';

  DELETE FROM kb_subtopics WHERE topic_id = 'd1000001-0001-4000-a000-00000000000b';

  INSERT INTO kb_subtopics (topic_id, name, sort_order) VALUES
    ('d1000001-0001-4000-a000-00000000000b', 'Цепи с конденсаторами и резисторами', 1),
    ('d1000001-0001-4000-a000-00000000000b', 'Цепи с катушками и резисторами',      2);

  -- ── Электромагнитные колебания (d1000001-...000c) ────────────────────────
  UPDATE kb_topics
  SET kim_numbers = ARRAY[13,14,15,21,23,25],
      section     = 'Электродинамика',
      sort_order  = 130
  WHERE id = 'd1000001-0001-4000-a000-00000000000c';

  DELETE FROM kb_subtopics WHERE topic_id = 'd1000001-0001-4000-a000-00000000000c';

  INSERT INTO kb_subtopics (topic_id, name, sort_order) VALUES
    ('d1000001-0001-4000-a000-00000000000c', 'Энергия ЭМ колебаний',    1),
    ('d1000001-0001-4000-a000-00000000000c', 'Уравнение ЭМ колебаний',  2),
    ('d1000001-0001-4000-a000-00000000000c', 'ЭМ волны',                3);

  -- ── Оптика (merge 000e into 000d, delete 000e)
  UPDATE kb_tasks
  SET topic_id   = 'd1000001-0001-4000-a000-00000000000d',
      subtopic_id = NULL
  WHERE topic_id = 'd1000001-0001-4000-a000-00000000000e';

  UPDATE kb_materials
  SET topic_id = 'd1000001-0001-4000-a000-00000000000d'
  WHERE topic_id = 'd1000001-0001-4000-a000-00000000000e';

  DELETE FROM kb_subtopics WHERE topic_id = 'd1000001-0001-4000-a000-00000000000e';
  DELETE FROM kb_topics    WHERE id       = 'd1000001-0001-4000-a000-00000000000e';

  UPDATE kb_topics
  SET name        = 'Оптика',
      section     = 'Электродинамика',
      kim_numbers = ARRAY[13,14,15,21,23,25],
      sort_order  = 140
  WHERE id = 'd1000001-0001-4000-a000-00000000000d';

  DELETE FROM kb_subtopics WHERE topic_id = 'd1000001-0001-4000-a000-00000000000d';

  INSERT INTO kb_subtopics (topic_id, name, sort_order) VALUES
    ('d1000001-0001-4000-a000-00000000000d', 'Отражение света',  1),
    ('d1000001-0001-4000-a000-00000000000d', 'Преломление света', 2),
    ('d1000001-0001-4000-a000-00000000000d', 'Линзы',            3),
    ('d1000001-0001-4000-a000-00000000000d', 'Интерференция',    4),
    ('d1000001-0001-4000-a000-00000000000d', 'Дифракция',        5);


  -- ══════════════════════════════════════════════════════════════════════════
  -- КВАНТОВАЯ ФИЗИКА
  -- ══════════════════════════════════════════════════════════════════════════

  INSERT INTO kb_topics (name, section, exam, kim_numbers, sort_order)
  VALUES ('Фотоны', 'Квантовая физика', 'ege', ARRAY[16,17], 150)
  RETURNING id INTO _photons_id;

  UPDATE kb_topics
  SET section     = 'Квантовая физика',
      kim_numbers = ARRAY[16,17],
      sort_order  = 160
  WHERE id = 'd1000001-0001-4000-a000-00000000000f';

  DELETE FROM kb_subtopics WHERE topic_id = 'd1000001-0001-4000-a000-00000000000f';


  -- ══════════════════════════════════════════════════════════════════════════
  -- АТОМНАЯ ФИЗИКА
  -- ══════════════════════════════════════════════════════════════════════════

  UPDATE kb_topics
  SET name        = 'Модель атома и атомного ядра',
      section     = 'Атомная физика',
      kim_numbers = ARRAY[16,17],
      sort_order  = 170
  WHERE id = 'd1000001-0001-4000-a000-000000000010';

  DELETE FROM kb_subtopics WHERE topic_id = 'd1000001-0001-4000-a000-000000000010';

  INSERT INTO kb_topics (name, section, exam, kim_numbers, sort_order)
  VALUES ('Постулаты Бора', 'Атомная физика', 'ege', ARRAY[16,17], 180)
  RETURNING id INTO _bohr_id;

  INSERT INTO kb_topics (name, section, exam, kim_numbers, sort_order)
  VALUES ('Ядерные реакции', 'Атомная физика', 'ege', ARRAY[16,17], 190)
  RETURNING id INTO _nuclear_id;

  INSERT INTO kb_topics (name, section, exam, kim_numbers, sort_order)
  VALUES ('Закон радиоактивного распада', 'Атомная физика', 'ege', ARRAY[16,17], 200)
  RETURNING id INTO _decay_id;


  -- ══════════════════════════════════════════════════════════════════════════
  -- Bump Специальные форматы КИМ sort_order
  -- ══════════════════════════════════════════════════════════════════════════
  UPDATE kb_topics SET sort_order = 210 WHERE id = 'd1000001-0001-4000-a000-000000000011';
  UPDATE kb_topics SET sort_order = 220 WHERE id = 'd1000001-0001-4000-a000-000000000012';
  UPDATE kb_topics SET sort_order = 230 WHERE id = 'd1000001-0001-4000-a000-000000000013';

END $$;