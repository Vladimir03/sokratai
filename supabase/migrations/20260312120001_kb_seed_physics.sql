-- KB Seed: Physics taxonomy (ЕГЭ + ОГЭ) + sample tasks & materials for Кинематика ЕГЭ
-- Based on ФИПИ 2026 codifier. ЕГЭ and ОГЭ are SEPARATE exams with different КИМ numbering.

-- ══════════════════════════════════════════════════════════════
-- 1) ЕГЭ ФИЗИКА — Topics
-- ══════════════════════════════════════════════════════════════

-- Use DO block with variables to capture generated UUIDs for FK references
DO $seed$ DECLARE
  -- ЕГЭ topic IDs
  _ege_kinematics    UUID;
  _ege_dynamics      UUID;
  _ege_conservation  UUID;
  _ege_statics       UUID;
  _ege_molecular     UUID;
  _ege_thermo        UUID;
  _ege_electrostatics UUID;
  _ege_dc_current    UUID;
  _ege_magnetism     UUID;
  _ege_em_induction  UUID;
  _ege_mech_osc      UUID;
  _ege_em_osc        UUID;
  _ege_geo_optics    UUID;
  _ege_wave_optics   UUID;
  _ege_photoeffect   UUID;
  _ege_atom_nucleus  UUID;
  -- ОГЭ topic IDs
  _oge_kinematics    UUID;
  _oge_dynamics      UUID;
  _oge_conservation  UUID;
  _oge_thermal       UUID;
  _oge_electric      UUID;
  _oge_magnetism     UUID;
  _oge_optics        UUID;
  _oge_atom_nucleus  UUID;
BEGIN

-- ═══ ЕГЭ ФИЗИКА ═══

-- Механика (ЕГЭ)
INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Кинематика', 'Механика', 'ege', '{1,2,26}', 10)
RETURNING id INTO _ege_kinematics;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Динамика', 'Механика', 'ege', '{2,3,26}', 20)
RETURNING id INTO _ege_dynamics;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Законы сохранения', 'Механика', 'ege', '{3,4,27}', 30)
RETURNING id INTO _ege_conservation;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Статика', 'Механика', 'ege', '{3,26}', 40)
RETURNING id INTO _ege_statics;

-- МКТ и термодинамика (ЕГЭ)
INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Молекулярная физика', 'МКТ и термодинамика', 'ege', '{7,8,9}', 50)
RETURNING id INTO _ege_molecular;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Термодинамика', 'МКТ и термодинамика', 'ege', '{8,9,24}', 60)
RETURNING id INTO _ege_thermo;

-- Электродинамика (ЕГЭ)
INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Электростатика', 'Электродинамика', 'ege', '{10,11,25}', 70)
RETURNING id INTO _ege_electrostatics;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Постоянный ток', 'Электродинамика', 'ege', '{11,12,25}', 80)
RETURNING id INTO _ege_dc_current;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Магнетизм', 'Электродинамика', 'ege', '{12,13}', 90)
RETURNING id INTO _ege_magnetism;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Электромагнитная индукция', 'Электродинамика', 'ege', '{13,27}', 100)
RETURNING id INTO _ege_em_induction;

-- Колебания и волны (ЕГЭ)
INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Механические колебания', 'Колебания и волны', 'ege', '{5,6}', 110)
RETURNING id INTO _ege_mech_osc;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Электромагнитные колебания', 'Колебания и волны', 'ege', '{14}', 120)
RETURNING id INTO _ege_em_osc;

-- Оптика (ЕГЭ)
INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Геометрическая оптика', 'Оптика', 'ege', '{14,15,25}', 130)
RETURNING id INTO _ege_geo_optics;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Волновая оптика', 'Оптика', 'ege', '{15}', 140)
RETURNING id INTO _ege_wave_optics;

-- Квантовая физика (ЕГЭ)
INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Фотоэффект', 'Квантовая физика', 'ege', '{16,17}', 150)
RETURNING id INTO _ege_photoeffect;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Атом и ядро', 'Квантовая физика', 'ege', '{17,18}', 160)
RETURNING id INTO _ege_atom_nucleus;

-- ═══ ОГЭ ФИЗИКА ═══

-- Механика (ОГЭ)
INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Кинематика', 'Механика', 'oge', '{1,2}', 10)
RETURNING id INTO _oge_kinematics;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Динамика', 'Механика', 'oge', '{3,4}', 20)
RETURNING id INTO _oge_dynamics;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Законы сохранения', 'Механика', 'oge', '{4,5}', 30)
RETURNING id INTO _oge_conservation;

-- Тепловая физика (ОГЭ)
INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Тепловые явления', 'Тепловая физика', 'oge', '{7,8,9}', 40)
RETURNING id INTO _oge_thermal;

-- Электродинамика (ОГЭ)
INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Электрические явления', 'Электродинамика', 'oge', '{10,11,12}', 50)
RETURNING id INTO _oge_electric;

INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Магнетизм', 'Электродинамика', 'oge', '{12,13}', 60)
RETURNING id INTO _oge_magnetism;

-- Оптика (ОГЭ)
INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Оптика', 'Оптика', 'oge', '{13,14}', 70)
RETURNING id INTO _oge_optics;

-- Квантовая физика (ОГЭ)
INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
VALUES (gen_random_uuid(), 'Атом и ядро', 'Квантовая физика', 'oge', '{15,16}', 80)
RETURNING id INTO _oge_atom_nucleus;


-- ══════════════════════════════════════════════════════════════
-- 2) Subtopics (3–5 per topic)
-- ══════════════════════════════════════════════════════════════

-- ─── ЕГЭ subtopics ───

-- Кинематика ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_kinematics, 'Равномерное прямолинейное движение', 1),
  (_ege_kinematics, 'Равноускоренное прямолинейное движение', 2),
  (_ege_kinematics, 'Движение по окружности', 3),
  (_ege_kinematics, 'Свободное падение', 4),
  (_ege_kinematics, 'Движение тела, брошенного под углом', 5);

-- Динамика ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_dynamics, 'Законы Ньютона', 1),
  (_ege_dynamics, 'Силы в природе', 2),
  (_ege_dynamics, 'Движение по наклонной плоскости', 3),
  (_ege_dynamics, 'Движение связанных тел', 4);

-- Законы сохранения ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_conservation, 'Импульс тела и системы тел', 1),
  (_ege_conservation, 'Закон сохранения импульса', 2),
  (_ege_conservation, 'Работа и энергия', 3),
  (_ege_conservation, 'Закон сохранения энергии', 4);

-- Статика ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_statics, 'Условия равновесия', 1),
  (_ege_statics, 'Момент силы', 2),
  (_ege_statics, 'Центр масс', 3);

-- Молекулярная физика ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_molecular, 'Основные положения МКТ', 1),
  (_ege_molecular, 'Уравнение состояния идеального газа', 2),
  (_ege_molecular, 'Газовые законы (изопроцессы)', 3),
  (_ege_molecular, 'Насыщенный пар и влажность', 4);

-- Термодинамика ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_thermo, 'Первый закон термодинамики', 1),
  (_ege_thermo, 'Теплоёмкость и теплообмен', 2),
  (_ege_thermo, 'Тепловые двигатели и КПД', 3),
  (_ege_thermo, 'Фазовые переходы', 4);

-- Электростатика ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_electrostatics, 'Закон Кулона', 1),
  (_ege_electrostatics, 'Напряжённость электрического поля', 2),
  (_ege_electrostatics, 'Потенциал и работа поля', 3),
  (_ege_electrostatics, 'Конденсаторы', 4);

-- Постоянный ток ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_dc_current, 'Закон Ома для участка цепи', 1),
  (_ege_dc_current, 'Закон Ома для полной цепи', 2),
  (_ege_dc_current, 'Соединения проводников', 3),
  (_ege_dc_current, 'Мощность тока', 4);

-- Магнетизм ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_magnetism, 'Магнитное поле тока', 1),
  (_ege_magnetism, 'Сила Ампера', 2),
  (_ege_magnetism, 'Сила Лоренца', 3);

-- Электромагнитная индукция ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_em_induction, 'Закон электромагнитной индукции', 1),
  (_ege_em_induction, 'Правило Ленца', 2),
  (_ege_em_induction, 'Самоиндукция', 3),
  (_ege_em_induction, 'Энергия магнитного поля', 4);

-- Механические колебания ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_mech_osc, 'Математический маятник', 1),
  (_ege_mech_osc, 'Пружинный маятник', 2),
  (_ege_mech_osc, 'Гармонические колебания', 3),
  (_ege_mech_osc, 'Механические волны', 4);

-- Электромагнитные колебания ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_em_osc, 'Колебательный контур', 1),
  (_ege_em_osc, 'Переменный ток', 2),
  (_ege_em_osc, 'Электромагнитные волны', 3);

-- Геометрическая оптика ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_geo_optics, 'Закон отражения', 1),
  (_ege_geo_optics, 'Закон преломления', 2),
  (_ege_geo_optics, 'Линзы', 3),
  (_ege_geo_optics, 'Полное внутреннее отражение', 4);

-- Волновая оптика ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_wave_optics, 'Интерференция света', 1),
  (_ege_wave_optics, 'Дифракция света', 2),
  (_ege_wave_optics, 'Дисперсия света', 3);

-- Фотоэффект ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_photoeffect, 'Уравнение Эйнштейна для фотоэффекта', 1),
  (_ege_photoeffect, 'Красная граница фотоэффекта', 2),
  (_ege_photoeffect, 'Фотоны', 3);

-- Атом и ядро ЕГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_ege_atom_nucleus, 'Постулаты Бора', 1),
  (_ege_atom_nucleus, 'Радиоактивность', 2),
  (_ege_atom_nucleus, 'Ядерные реакции', 3),
  (_ege_atom_nucleus, 'Энергия связи ядра', 4);

-- ─── ОГЭ subtopics ───

-- Кинематика ОГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_oge_kinematics, 'Равномерное движение', 1),
  (_oge_kinematics, 'Равноускоренное движение', 2),
  (_oge_kinematics, 'Графики движения', 3);

-- Динамика ОГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_oge_dynamics, 'Законы Ньютона', 1),
  (_oge_dynamics, 'Силы трения и упругости', 2),
  (_oge_dynamics, 'Сила тяжести и вес тела', 3);

-- Законы сохранения ОГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_oge_conservation, 'Импульс', 1),
  (_oge_conservation, 'Механическая энергия', 2),
  (_oge_conservation, 'Работа и мощность', 3);

-- Тепловые явления ОГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_oge_thermal, 'Теплообмен и теплопередача', 1),
  (_oge_thermal, 'Удельная теплоёмкость', 2),
  (_oge_thermal, 'Плавление и кипение', 3),
  (_oge_thermal, 'Тепловой баланс', 4);

-- Электрические явления ОГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_oge_electric, 'Электрический ток', 1),
  (_oge_electric, 'Закон Ома', 2),
  (_oge_electric, 'Последовательное и параллельное соединение', 3),
  (_oge_electric, 'Работа и мощность тока', 4);

-- Магнетизм ОГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_oge_magnetism, 'Магнитное поле', 1),
  (_oge_magnetism, 'Электромагниты', 2),
  (_oge_magnetism, 'Электромагнитная индукция', 3);

-- Оптика ОГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_oge_optics, 'Отражение и преломление', 1),
  (_oge_optics, 'Линзы и построение изображений', 2),
  (_oge_optics, 'Оптические приборы', 3);

-- Атом и ядро ОГЭ
INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
  (_oge_atom_nucleus, 'Строение атома', 1),
  (_oge_atom_nucleus, 'Радиоактивность', 2),
  (_oge_atom_nucleus, 'Ядерные реакции', 3);


-- ══════════════════════════════════════════════════════════════
-- 3) Sample tasks — Кинематика ЕГЭ (15 tasks)
--    owner_id IS NULL → catalog (Сократ), read-only
--    Subtopic references use subqueries for the first subtopic match
-- ══════════════════════════════════════════════════════════════

INSERT INTO public.kb_tasks (topic_id, subtopic_id, owner_id, exam, kim_number, text, answer, solution, answer_format, source_label) VALUES

-- 1. Равномерное прямолинейное движение
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 1),
 NULL, 'ege', 1,
 'Автомобиль движется по прямой дороге со скоростью $$v = 72$$ км/ч. Определите, какое расстояние он проедет за $$t = 2{,}5$$ мин.',
 '3000 м',
 '$$v = 72 \text{ км/ч} = 20 \text{ м/с}$$. $$t = 2{,}5 \text{ мин} = 150 \text{ с}$$. $$s = vt = 20 \cdot 150 = 3000$$ м.',
 'число', 'socrat'),

-- 2. Равномерное прямолинейное движение (графики)
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 1),
 NULL, 'ege', 1,
 'Два пешехода вышли одновременно навстречу друг другу из пунктов А и Б, расстояние между которыми $$L = 3$$ км. Скорость первого $$v_1 = 4$$ км/ч, скорость второго $$v_2 = 2$$ км/ч. Через какое время они встретятся?',
 '0,5 ч',
 '$$v_{\text{сбл}} = v_1 + v_2 = 6$$ км/ч. $$t = \dfrac{L}{v_{\text{сбл}}} = \dfrac{3}{6} = 0{,}5$$ ч = 30 мин.',
 'число', 'socrat'),

-- 3. Равноускоренное прямолинейное движение
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 2),
 NULL, 'ege', 2,
 'Тело начинает двигаться из состояния покоя с ускорением $$a = 2$$ м/с². Какой путь оно пройдёт за пятую секунду движения?',
 '9 м',
 'Путь за $$n$$-ю секунду: $$s_n = \dfrac{a}{2}(2n - 1) = \dfrac{2}{2}(2 \cdot 5 - 1) = 9$$ м.',
 'число', 'socrat'),

-- 4. Равноускоренное движение (торможение)
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 2),
 NULL, 'ege', 2,
 'Поезд, двигаясь со скоростью $$v_0 = 36$$ км/ч, начинает тормозить с ускорением $$a = 0{,}5$$ м/с². Определите тормозной путь поезда.',
 '100 м',
 '$$v_0 = 36 \text{ км/ч} = 10 \text{ м/с}$$. При торможении до остановки: $$v^2 = v_0^2 - 2as$$. При $$v = 0$$: $$s = \dfrac{v_0^2}{2a} = \dfrac{100}{1} = 100$$ м.',
 'число', 'socrat'),

-- 5. Равноускоренное движение (два тела)
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 2),
 NULL, 'ege', 1,
 'Мотоциклист начинает движение из состояния покоя с ускорением $$a = 3$$ м/с². Одновременно мимо него проезжает автомобиль со скоростью $$v = 12$$ м/с. Через какое время мотоциклист догонит автомобиль?',
 '8 с',
 'Мотоциклист: $$s_1 = \dfrac{at^2}{2}$$. Автомобиль: $$s_2 = vt$$. При встрече $$s_1 = s_2$$: $$\dfrac{3t^2}{2} = 12t$$, $$t = 8$$ с ($$t = 0$$ — начальный момент).',
 'число', 'socrat'),

-- 6. Движение по окружности
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 3),
 NULL, 'ege', 1,
 'Точка движется по окружности радиусом $$R = 0{,}5$$ м с постоянной скоростью $$v = 2$$ м/с. Определите центростремительное ускорение точки.',
 '8 м/с²',
 '$$a_{\text{цс}} = \dfrac{v^2}{R} = \dfrac{4}{0{,}5} = 8$$ м/с².',
 'число', 'socrat'),

-- 7. Движение по окружности (период)
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 3),
 NULL, 'ege', 1,
 'Секундная стрелка часов имеет длину $$l = 10$$ см. Определите скорость движения конца стрелки.',
 '0,0105 м/с',
 '$$T = 60$$ с. $$v = \dfrac{2\pi R}{T} = \dfrac{2\pi \cdot 0{,}1}{60} \approx 0{,}0105$$ м/с $$\approx 1{,}05$$ см/с.',
 'число', 'socrat'),

-- 8. Свободное падение
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 4),
 NULL, 'ege', 2,
 'Камень свободно падает с высоты $$h = 80$$ м. Определите время падения и скорость в момент удара о землю. Принять $$g = 10$$ м/с².',
 '4 с; 40 м/с',
 '$$t = \sqrt{\dfrac{2h}{g}} = \sqrt{\dfrac{160}{10}} = 4$$ с. $$v = gt = 10 \cdot 4 = 40$$ м/с.',
 'число', 'socrat'),

-- 9. Свободное падение (мяч бросили вверх)
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 4),
 NULL, 'ege', 2,
 'Мяч бросили вертикально вверх со скоростью $$v_0 = 30$$ м/с. На какую максимальную высоту он поднимется? $$g = 10$$ м/с².',
 '45 м',
 'На максимальной высоте $$v = 0$$. $$h = \dfrac{v_0^2}{2g} = \dfrac{900}{20} = 45$$ м.',
 'число', 'socrat'),

-- 10. Тело, брошенное горизонтально
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 5),
 NULL, 'ege', 26,
 'Тело брошено горизонтально с высоты $$h = 20$$ м со скоростью $$v_0 = 15$$ м/с. Определите дальность полёта. $$g = 10$$ м/с².',
 '30 м',
 '$$t = \sqrt{\dfrac{2h}{g}} = \sqrt{4} = 2$$ с. $$L = v_0 t = 15 \cdot 2 = 30$$ м.',
 'число', 'socrat'),

-- 11. Тело, брошенное под углом
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 5),
 NULL, 'ege', 26,
 'Снаряд вылетает из орудия под углом $$\alpha = 30°$$ к горизонту со скоростью $$v_0 = 40$$ м/с. Определите максимальную высоту подъёма. $$g = 10$$ м/с².',
 '20 м',
 '$$v_{0y} = v_0 \sin\alpha = 40 \cdot 0{,}5 = 20$$ м/с. $$h_{\max} = \dfrac{v_{0y}^2}{2g} = \dfrac{400}{20} = 20$$ м.',
 'число', 'socrat'),

-- 12. Средняя скорость
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 1),
 NULL, 'ege', 1,
 'Велосипедист проехал первую половину пути со скоростью $$v_1 = 12$$ км/ч, а вторую — со скоростью $$v_2 = 20$$ км/ч. Определите среднюю скорость на всём пути.',
 '15 км/ч',
 '$$\langle v \rangle = \dfrac{2v_1 v_2}{v_1 + v_2} = \dfrac{2 \cdot 12 \cdot 20}{32} = 15$$ км/ч.',
 'число', 'socrat'),

-- 13. Относительное движение
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 1),
 NULL, 'ege', 1,
 'Два поезда движутся навстречу друг другу со скоростями $$v_1 = 60$$ км/ч и $$v_2 = 40$$ км/ч. Длина каждого поезда $$l = 200$$ м. За какое время поезда разъедутся (полностью минуют друг друга)?',
 '14,4 с',
 '$$v_{\text{отн}} = v_1 + v_2 = 100 \text{ км/ч} \approx 27{,}8 \text{ м/с}$$. Суммарная длина $$L = 400$$ м. $$t = \dfrac{L}{v_{\text{отн}}} = \dfrac{400}{27{,}8} \approx 14{,}4$$ с.',
 'число', 'socrat'),

-- 14. Равноускоренное движение (графическая задача)
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 2),
 NULL, 'ege', 2,
 'На графике зависимости скорости от времени прямая проходит через точки $$(0;\;2)$$ и $$(4;\;10)$$. Определите ускорение тела и путь, пройденный за 4 секунды.',
 '2 м/с²; 24 м',
 '$$a = \dfrac{\Delta v}{\Delta t} = \dfrac{10 - 2}{4} = 2$$ м/с². $$s = v_0 t + \dfrac{at^2}{2} = 2 \cdot 4 + \dfrac{2 \cdot 16}{2} = 8 + 16 = 24$$ м.',
 'число', 'socrat'),

-- 15. Комбинированная: свободное падение + горизонтальный бросок
(_ege_kinematics,
 (SELECT id FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND sort_order = 5),
 NULL, 'ege', 26,
 'С крыши здания высотой $$H = 45$$ м одновременно бросают два мяча: первый — вертикально вниз со скоростью $$v_1 = 10$$ м/с, второй — горизонтально со скоростью $$v_2 = 15$$ м/с. Какой мяч упадёт на землю раньше и на сколько секунд? $$g = 10$$ м/с².',
 'Первый раньше на 0,84 с',
 'Первый мяч: $$H = v_1 t_1 + \dfrac{g t_1^2}{2}$$, $$45 = 10t_1 + 5t_1^2$$, $$t_1^2 + 2t_1 - 9 = 0$$, $$t_1 = \dfrac{-2 + \sqrt{4 + 36}}{2} = \dfrac{-2 + \sqrt{40}}{2} \approx 2{,}16$$ с. Второй мяч (вертикальная составляющая — свободное падение): $$t_2 = \sqrt{\dfrac{2H}{g}} = \sqrt{9} = 3$$ с. $$\Delta t = 3 - 2{,}16 \approx 0{,}84$$ с.',
 'число', 'socrat');


-- ══════════════════════════════════════════════════════════════
-- 4) Sample materials — Кинематика ЕГЭ (4 materials)
-- ══════════════════════════════════════════════════════════════

INSERT INTO public.kb_materials (topic_id, owner_id, type, name, format, url, storage_key) VALUES
(_ege_kinematics, NULL, 'file',  'Кинематика — краткий справочник формул',   'PDF',     NULL, 'kb-attachments/catalog/kinematics-formulas.pdf'),
(_ege_kinematics, NULL, 'link',  'Видеоразбор: движение тела, брошенного под углом', 'YouTube', 'https://youtube.com/watch?v=example_kinematics', NULL),
(_ege_kinematics, NULL, 'file',  'Сборник задач: кинематика ЕГЭ (40 задач)', 'PDF',     NULL, 'kb-attachments/catalog/kinematics-40-problems.pdf'),
(_ege_kinematics, NULL, 'link',  'Открытый банк заданий ФИПИ — Механика',    'Web',     'https://fipi.ru/ege/otkrytyy-bank-zadaniy-ege', NULL);

END $seed$;
