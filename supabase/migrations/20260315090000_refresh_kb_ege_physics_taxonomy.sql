-- Refresh EGE physics taxonomy in KB catalog without touching OGE.
-- Preserves existing catalog tasks/materials where mappings are unambiguous.

CREATE TEMP TABLE tmp_kb_ege_task_subtopics
ON COMMIT DROP
AS
SELECT
  t.id AS task_id,
  t.subtopic_id AS old_subtopic_id
FROM public.kb_tasks t
JOIN public.kb_topics tp ON tp.id = t.topic_id
WHERE tp.exam = 'ege'
  AND t.subtopic_id IS NOT NULL;

CREATE TEMP TABLE tmp_kb_ege_subtopic_remap (
  old_subtopic_id UUID,
  new_topic_id UUID NOT NULL,
  new_subtopic_name TEXT NOT NULL
) ON COMMIT DROP;

DO $migration$
DECLARE
  _ege_kinematics UUID;
  _ege_dynamics UUID;
  _ege_conservation UUID;
  _ege_statics UUID;
  _ege_molecular UUID;
  _ege_thermo UUID;
  _ege_electrostatics UUID;
  _ege_dc_current UUID;
  _ege_magnetism UUID;
  _ege_em_induction UUID;
  _ege_mech_osc UUID;
  _ege_em_osc UUID;
  _ege_geo_optics UUID;
  _ege_wave_optics UUID;
  _ege_photoeffect UUID;
  _ege_atom_nucleus UUID;

  _topic_mixed_circuits UUID;
  _topic_humidity UUID;
  _topic_optics UUID;
  _topic_model_atom UUID;
  _topic_photons UUID;
  _topic_bohr UUID;
  _topic_nuclear_reactions UUID;
  _topic_decay_law UUID;
  _topic_special_theory UUID;
  _topic_special_instruments UUID;
  _topic_special_experiment UUID;

  _sub_old_kin_uniform UUID;
  _sub_old_kin_accel UUID;
  _sub_old_kin_circle UUID;
  _sub_old_kin_freefall UUID;
  _sub_old_dyn_newton UUID;
  _sub_old_cons_impulse_law UUID;
  _sub_old_cons_energy_law UUID;
  _sub_old_mech_waves UUID;
  _sub_old_molecular_clapeyron UUID;
  _sub_old_molecular_humidity UUID;
  _sub_old_thermo_first_law UUID;
  _sub_old_thermo_heat_engines UUID;
  _sub_old_electro_field UUID;
  _sub_old_electro_potential UUID;
  _sub_old_electro_caps UUID;
  _sub_old_dc_ohm_segment UUID;
  _sub_old_dc_ohm_full UUID;
  _sub_old_dc_power UUID;
  _sub_old_mag_field UUID;
  _sub_old_mag_ampere UUID;
  _sub_old_mag_lorentz UUID;
  _sub_old_induction_law UUID;
  _sub_old_induction_self UUID;
  _sub_old_em_waves UUID;
  _sub_old_optics_reflection UUID;
  _sub_old_optics_refraction UUID;
  _sub_old_optics_lenses UUID;
  _sub_old_wave_interference UUID;
  _sub_old_wave_diffraction UUID;
  _sub_old_photo_photons UUID;
  _sub_old_atom_bohr UUID;
  _sub_old_atom_nuclear UUID;
BEGIN
  SELECT id INTO _ege_kinematics
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Кинематика'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_dynamics
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Динамика'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_conservation
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Законы сохранения'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_statics
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Статика'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_molecular
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Молекулярная физика'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_thermo
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Термодинамика'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_electrostatics
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Электростатика'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_dc_current
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Постоянный ток'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_magnetism
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Магнетизм'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_em_induction
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Электромагнитная индукция'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_mech_osc
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Механические колебания'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_em_osc
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Электромагнитные колебания'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_geo_optics
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Геометрическая оптика'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_wave_optics
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Волновая оптика'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_photoeffect
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Фотоэффект'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO _ege_atom_nucleus
  FROM public.kb_topics
  WHERE exam = 'ege' AND name = 'Атом и ядро'
  ORDER BY created_at, id
  LIMIT 1;

  IF _ege_kinematics IS NULL
    OR _ege_dynamics IS NULL
    OR _ege_conservation IS NULL
    OR _ege_statics IS NULL
    OR _ege_molecular IS NULL
    OR _ege_thermo IS NULL
    OR _ege_electrostatics IS NULL
    OR _ege_dc_current IS NULL
    OR _ege_magnetism IS NULL
    OR _ege_em_induction IS NULL
    OR _ege_mech_osc IS NULL
    OR _ege_em_osc IS NULL
    OR _ege_geo_optics IS NULL
    OR _ege_wave_optics IS NULL
    OR _ege_photoeffect IS NULL
    OR _ege_atom_nucleus IS NULL THEN
    RAISE EXCEPTION 'Legacy EGE KB topics were not found; expected seed from 20260312120001_kb_seed_physics.sql';
  END IF;

  SELECT id INTO _sub_old_kin_uniform FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND name = 'Равномерное прямолинейное движение' LIMIT 1;
  SELECT id INTO _sub_old_kin_accel FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND name = 'Равноускоренное прямолинейное движение' LIMIT 1;
  SELECT id INTO _sub_old_kin_circle FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND name = 'Движение по окружности' LIMIT 1;
  SELECT id INTO _sub_old_kin_freefall FROM public.kb_subtopics WHERE topic_id = _ege_kinematics AND name = 'Свободное падение' LIMIT 1;

  SELECT id INTO _sub_old_dyn_newton FROM public.kb_subtopics WHERE topic_id = _ege_dynamics AND name = 'Законы Ньютона' LIMIT 1;

  SELECT id INTO _sub_old_cons_impulse_law FROM public.kb_subtopics WHERE topic_id = _ege_conservation AND name = 'Закон сохранения импульса' LIMIT 1;
  SELECT id INTO _sub_old_cons_energy_law FROM public.kb_subtopics WHERE topic_id = _ege_conservation AND name = 'Закон сохранения энергии' LIMIT 1;

  SELECT id INTO _sub_old_mech_waves FROM public.kb_subtopics WHERE topic_id = _ege_mech_osc AND name = 'Механические волны' LIMIT 1;

  SELECT id INTO _sub_old_molecular_clapeyron FROM public.kb_subtopics WHERE topic_id = _ege_molecular AND name = 'Уравнение состояния идеального газа' LIMIT 1;
  SELECT id INTO _sub_old_molecular_humidity FROM public.kb_subtopics WHERE topic_id = _ege_molecular AND name = 'Насыщенный пар и влажность' LIMIT 1;

  SELECT id INTO _sub_old_thermo_first_law FROM public.kb_subtopics WHERE topic_id = _ege_thermo AND name = 'Первый закон термодинамики' LIMIT 1;
  SELECT id INTO _sub_old_thermo_heat_engines FROM public.kb_subtopics WHERE topic_id = _ege_thermo AND name = 'Тепловые двигатели и КПД' LIMIT 1;

  SELECT id INTO _sub_old_electro_field FROM public.kb_subtopics WHERE topic_id = _ege_electrostatics AND name = 'Напряжённость электрического поля' LIMIT 1;
  SELECT id INTO _sub_old_electro_potential FROM public.kb_subtopics WHERE topic_id = _ege_electrostatics AND name = 'Потенциал и работа поля' LIMIT 1;
  SELECT id INTO _sub_old_electro_caps FROM public.kb_subtopics WHERE topic_id = _ege_electrostatics AND name = 'Конденсаторы' LIMIT 1;

  SELECT id INTO _sub_old_dc_ohm_segment FROM public.kb_subtopics WHERE topic_id = _ege_dc_current AND name = 'Закон Ома для участка цепи' LIMIT 1;
  SELECT id INTO _sub_old_dc_ohm_full FROM public.kb_subtopics WHERE topic_id = _ege_dc_current AND name = 'Закон Ома для полной цепи' LIMIT 1;
  SELECT id INTO _sub_old_dc_power FROM public.kb_subtopics WHERE topic_id = _ege_dc_current AND name = 'Мощность тока' LIMIT 1;

  SELECT id INTO _sub_old_mag_field FROM public.kb_subtopics WHERE topic_id = _ege_magnetism AND name = 'Магнитное поле тока' LIMIT 1;
  SELECT id INTO _sub_old_mag_ampere FROM public.kb_subtopics WHERE topic_id = _ege_magnetism AND name = 'Сила Ампера' LIMIT 1;
  SELECT id INTO _sub_old_mag_lorentz FROM public.kb_subtopics WHERE topic_id = _ege_magnetism AND name = 'Сила Лоренца' LIMIT 1;

  SELECT id INTO _sub_old_induction_law FROM public.kb_subtopics WHERE topic_id = _ege_em_induction AND name = 'Закон электромагнитной индукции' LIMIT 1;
  SELECT id INTO _sub_old_induction_self FROM public.kb_subtopics WHERE topic_id = _ege_em_induction AND name = 'Самоиндукция' LIMIT 1;

  SELECT id INTO _sub_old_em_waves FROM public.kb_subtopics WHERE topic_id = _ege_em_osc AND name = 'Электромагнитные волны' LIMIT 1;

  SELECT id INTO _sub_old_optics_reflection FROM public.kb_subtopics WHERE topic_id = _ege_geo_optics AND name = 'Закон отражения' LIMIT 1;
  SELECT id INTO _sub_old_optics_refraction FROM public.kb_subtopics WHERE topic_id = _ege_geo_optics AND name = 'Закон преломления' LIMIT 1;
  SELECT id INTO _sub_old_optics_lenses FROM public.kb_subtopics WHERE topic_id = _ege_geo_optics AND name = 'Линзы' LIMIT 1;

  SELECT id INTO _sub_old_wave_interference FROM public.kb_subtopics WHERE topic_id = _ege_wave_optics AND name = 'Интерференция света' LIMIT 1;
  SELECT id INTO _sub_old_wave_diffraction FROM public.kb_subtopics WHERE topic_id = _ege_wave_optics AND name = 'Дифракция света' LIMIT 1;

  SELECT id INTO _sub_old_photo_photons FROM public.kb_subtopics WHERE topic_id = _ege_photoeffect AND name = 'Фотоны' LIMIT 1;

  SELECT id INTO _sub_old_atom_bohr FROM public.kb_subtopics WHERE topic_id = _ege_atom_nucleus AND name = 'Постулаты Бора' LIMIT 1;
  SELECT id INTO _sub_old_atom_nuclear FROM public.kb_subtopics WHERE topic_id = _ege_atom_nucleus AND name = 'Ядерные реакции' LIMIT 1;

  -- Merge clear topic-level splits before rows are repurposed.
  UPDATE public.kb_tasks
  SET topic_id = _ege_magnetism
  WHERE topic_id = _ege_em_induction;

  UPDATE public.kb_materials
  SET topic_id = _ege_magnetism
  WHERE topic_id = _ege_em_induction;

  UPDATE public.kb_tasks
  SET topic_id = _ege_geo_optics
  WHERE topic_id = _ege_wave_optics;

  UPDATE public.kb_materials
  SET topic_id = _ege_geo_optics
  WHERE topic_id = _ege_wave_optics;

  -- Update retained rows in place.
  UPDATE public.kb_topics
  SET section = 'Механика',
      kim_numbers = ARRAY[1,5,6,21,22,26],
      sort_order = 10
  WHERE id = _ege_kinematics;

  UPDATE public.kb_topics
  SET section = 'Механика',
      kim_numbers = ARRAY[2,5,6,21,22,26],
      sort_order = 20
  WHERE id = _ege_dynamics;

  UPDATE public.kb_topics
  SET name = 'Статика и гидростатика',
      section = 'Механика',
      kim_numbers = ARRAY[4,5,6,21,22,26],
      sort_order = 30
  WHERE id = _ege_statics;

  UPDATE public.kb_topics
  SET section = 'Механика',
      kim_numbers = ARRAY[3,5,6,21,22,26],
      sort_order = 40
  WHERE id = _ege_conservation;

  UPDATE public.kb_topics
  SET name = 'Механические колебания и волны',
      section = 'Механика',
      kim_numbers = ARRAY[4,5,6,21,22,26],
      sort_order = 50
  WHERE id = _ege_mech_osc;

  UPDATE public.kb_topics
  SET section = 'МКТ и термодинамика',
      kim_numbers = ARRAY[7,9,10,21,23,24],
      sort_order = 60
  WHERE id = _ege_molecular;

  UPDATE public.kb_topics
  SET name = 'Влажность',
      section = 'МКТ и термодинамика',
      kim_numbers = ARRAY[7,9,10,21,23,24],
      sort_order = 70
  WHERE id = _ege_wave_optics;

  UPDATE public.kb_topics
  SET section = 'МКТ и термодинамика',
      kim_numbers = ARRAY[8,9,10,21,23,24],
      sort_order = 80
  WHERE id = _ege_thermo;

  UPDATE public.kb_topics
  SET section = 'Электродинамика',
      kim_numbers = ARRAY[11,14,15,21,23,25],
      sort_order = 90
  WHERE id = _ege_electrostatics;

  UPDATE public.kb_topics
  SET section = 'Электродинамика',
      kim_numbers = ARRAY[11,14,15,21,23,25],
      sort_order = 100
  WHERE id = _ege_dc_current;

  UPDATE public.kb_topics
  SET section = 'Электродинамика',
      kim_numbers = ARRAY[12,14,15,21,23,25],
      sort_order = 110
  WHERE id = _ege_magnetism;

  UPDATE public.kb_topics
  SET name = 'Смешанные цепи',
      section = 'Электродинамика',
      kim_numbers = ARRAY[14,21,23,25],
      sort_order = 120
  WHERE id = _ege_em_induction;

  UPDATE public.kb_topics
  SET section = 'Электродинамика',
      kim_numbers = ARRAY[13,14,15,21,23,25],
      sort_order = 130
  WHERE id = _ege_em_osc;

  UPDATE public.kb_topics
  SET name = 'Оптика',
      section = 'Электродинамика',
      kim_numbers = ARRAY[13,14,15,21,23,25],
      sort_order = 140
  WHERE id = _ege_geo_optics;

  UPDATE public.kb_topics
  SET section = 'Квантовая физика',
      kim_numbers = ARRAY[16,17],
      sort_order = 160
  WHERE id = _ege_photoeffect;

  UPDATE public.kb_topics
  SET name = 'Модель атома и атомного ядра',
      section = 'Атомная физика',
      kim_numbers = ARRAY[16,17],
      sort_order = 170
  WHERE id = _ege_atom_nucleus;

  _topic_mixed_circuits := _ege_em_induction;
  _topic_humidity := _ege_wave_optics;
  _topic_optics := _ege_geo_optics;
  _topic_model_atom := _ege_atom_nucleus;

  INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
  VALUES (gen_random_uuid(), 'Фотоны', 'Квантовая физика', 'ege', ARRAY[16,17], 150)
  RETURNING id INTO _topic_photons;

  INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
  VALUES (gen_random_uuid(), 'Постулаты Бора', 'Атомная физика', 'ege', ARRAY[16,17], 180)
  RETURNING id INTO _topic_bohr;

  INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
  VALUES (gen_random_uuid(), 'Ядерные реакции', 'Атомная физика', 'ege', ARRAY[16,17], 190)
  RETURNING id INTO _topic_nuclear_reactions;

  INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
  VALUES (gen_random_uuid(), 'Закон радиоактивного распада', 'Атомная физика', 'ege', ARRAY[16,17], 200)
  RETURNING id INTO _topic_decay_law;

  INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
  VALUES (gen_random_uuid(), 'Теоретические утверждения', 'Специальные форматы КИМ', 'ege', ARRAY[18], 210)
  RETURNING id INTO _topic_special_theory;

  INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
  VALUES (gen_random_uuid(), 'Определение показаний измерительных приборов', 'Специальные форматы КИМ', 'ege', ARRAY[19], 220)
  RETURNING id INTO _topic_special_instruments;

  INSERT INTO public.kb_topics (id, name, section, exam, kim_numbers, sort_order)
  VALUES (gen_random_uuid(), 'Планирование эксперимента', 'Специальные форматы КИМ', 'ege', ARRAY[20], 230)
  RETURNING id INTO _topic_special_experiment;

  -- Exact subtopic-driven topic splits.
  UPDATE public.kb_tasks
  SET topic_id = _topic_humidity
  WHERE subtopic_id = _sub_old_molecular_humidity;

  UPDATE public.kb_tasks
  SET topic_id = _topic_photons
  WHERE subtopic_id = _sub_old_photo_photons;

  UPDATE public.kb_tasks
  SET topic_id = _topic_bohr
  WHERE subtopic_id = _sub_old_atom_bohr;

  UPDATE public.kb_tasks
  SET topic_id = _topic_nuclear_reactions
  WHERE subtopic_id = _sub_old_atom_nuclear;

  INSERT INTO tmp_kb_ege_subtopic_remap (old_subtopic_id, new_topic_id, new_subtopic_name)
  SELECT *
  FROM (
    VALUES
      (_sub_old_kin_uniform, _ege_kinematics, 'Равномерное движение'),
      (_sub_old_kin_accel, _ege_kinematics, 'Равноускоренное движение'),
      (_sub_old_kin_circle, _ege_kinematics, 'Движение по окружности'),
      (_sub_old_kin_freefall, _ege_kinematics, 'Свободное падение'),
      (_sub_old_dyn_newton, _ege_dynamics, 'Законы Ньютона'),
      (_sub_old_cons_impulse_law, _ege_conservation, 'Сохранение импульса'),
      (_sub_old_cons_energy_law, _ege_conservation, 'Сохранение энергии'),
      (_sub_old_mech_waves, _ege_mech_osc, 'Механические волны'),
      (_sub_old_molecular_clapeyron, _ege_molecular, 'Уравнение Менделеева-Клапейрона'),
      (_sub_old_thermo_first_law, _ege_thermo, 'Первое начало термодинамики'),
      (_sub_old_thermo_heat_engines, _ege_thermo, 'Тепловые машины'),
      (_sub_old_electro_field, _ege_electrostatics, 'Напряженность'),
      (_sub_old_electro_potential, _ege_electrostatics, 'Потенциал'),
      (_sub_old_electro_caps, _ege_electrostatics, 'Конденсаторы'),
      (_sub_old_dc_ohm_segment, _ege_dc_current, 'Закон Ома для участка цепи'),
      (_sub_old_dc_ohm_full, _ege_dc_current, 'Закон Ома для полной цепи'),
      (_sub_old_dc_power, _ege_dc_current, 'Мощность электрического тока'),
      (_sub_old_mag_field, _ege_magnetism, 'Магнитное поле'),
      (_sub_old_mag_ampere, _ege_magnetism, 'Сила Ампера'),
      (_sub_old_mag_lorentz, _ege_magnetism, 'Сила Лоренца'),
      (_sub_old_induction_law, _ege_magnetism, 'Электромагнитная индукция'),
      (_sub_old_induction_self, _ege_magnetism, 'Самоиндукция'),
      (_sub_old_em_waves, _ege_em_osc, 'ЭМ волны'),
      (_sub_old_optics_reflection, _topic_optics, 'Отражение света'),
      (_sub_old_optics_refraction, _topic_optics, 'Преломление света'),
      (_sub_old_optics_lenses, _topic_optics, 'Линзы'),
      (_sub_old_wave_interference, _topic_optics, 'Интерференция'),
      (_sub_old_wave_diffraction, _topic_optics, 'Дифракция')
  ) AS remap(old_subtopic_id, new_topic_id, new_subtopic_name)
  WHERE old_subtopic_id IS NOT NULL;

  UPDATE public.kb_tasks
  SET subtopic_id = NULL
  WHERE id IN (SELECT task_id FROM tmp_kb_ege_task_subtopics);

  DELETE FROM public.kb_subtopics
  WHERE topic_id IN (
    SELECT id
    FROM public.kb_topics
    WHERE exam = 'ege'
  );

  INSERT INTO public.kb_subtopics (topic_id, name, sort_order) VALUES
    (_ege_kinematics, 'Закон сложения скоростей', 1),
    (_ege_kinematics, 'Равномерное движение', 2),
    (_ege_kinematics, 'Равноускоренное движение', 3),
    (_ege_kinematics, 'Движение по окружности', 4),
    (_ege_kinematics, 'Свободное падение', 5),

    (_ege_dynamics, 'Законы Ньютона', 1),
    (_ege_dynamics, 'Сила упругости', 2),
    (_ege_dynamics, 'Сила трения', 3),
    (_ege_dynamics, 'Блоки', 4),

    (_ege_statics, 'Уравнение моментов', 1),
    (_ege_statics, 'Давление столба жидкости', 2),
    (_ege_statics, 'Сила Архимеда', 3),

    (_ege_conservation, 'Сохранение импульса', 1),
    (_ege_conservation, 'Сохранение энергии', 2),
    (_ege_conservation, 'Упругие и неупругие столкновения', 3),

    (_ege_mech_osc, 'Графики колебаний', 1),
    (_ege_mech_osc, 'Уравнение колебаний', 2),
    (_ege_mech_osc, 'Механические волны', 3),

    (_ege_molecular, 'Основное уравнение МКТ', 1),
    (_ege_molecular, 'Уравнение Менделеева-Клапейрона', 2),
    (_ege_molecular, 'Закон Дальтона', 3),
    (_ege_molecular, 'Средняя квадратичная скорость', 4),

    (_topic_humidity, 'Давление насыщенных паров', 1),
    (_topic_humidity, 'Плотность насыщенных паров', 2),
    (_topic_humidity, 'Изотерма водяного пара', 3),
    (_topic_humidity, 'Влажный воздух', 4),

    (_ege_thermo, 'Внутренняя энергия', 1),
    (_ege_thermo, 'Работа газа', 2),
    (_ege_thermo, 'Первое начало термодинамики', 3),
    (_ege_thermo, 'Тепловые машины', 4),
    (_ege_thermo, 'Тепловые явления', 5),

    (_ege_electrostatics, 'Взаимодействие зарядов', 1),
    (_ege_electrostatics, 'Напряженность', 2),
    (_ege_electrostatics, 'Потенциал', 3),
    (_ege_electrostatics, 'Конденсаторы', 4),

    (_ege_dc_current, 'Закон Ома для участка цепи', 1),
    (_ege_dc_current, 'Закон Ома для полной цепи', 2),
    (_ege_dc_current, 'Мощность электрического тока', 3),

    (_ege_magnetism, 'Магнитное поле', 1),
    (_ege_magnetism, 'Сила Ампера', 2),
    (_ege_magnetism, 'Сила Лоренца', 3),
    (_ege_magnetism, 'Электромагнитная индукция', 4),
    (_ege_magnetism, 'Самоиндукция', 5),

    (_topic_mixed_circuits, 'Цепи с конденсаторами и резисторами', 1),
    (_topic_mixed_circuits, 'Цепи с катушками и резисторами', 2),

    (_ege_em_osc, 'Энергия ЭМ колебаний', 1),
    (_ege_em_osc, 'Уравнение ЭМ колебаний', 2),
    (_ege_em_osc, 'ЭМ волны', 3),

    (_topic_optics, 'Отражение света', 1),
    (_topic_optics, 'Преломление света', 2),
    (_topic_optics, 'Линзы', 3),
    (_topic_optics, 'Интерференция', 4),
    (_topic_optics, 'Дифракция', 5);

  UPDATE public.kb_tasks t
  SET subtopic_id = new_subtopic.id
  FROM tmp_kb_ege_task_subtopics snapshot
  JOIN tmp_kb_ege_subtopic_remap remap
    ON remap.old_subtopic_id = snapshot.old_subtopic_id
  JOIN public.kb_subtopics new_subtopic
    ON new_subtopic.topic_id = remap.new_topic_id
   AND new_subtopic.name = remap.new_subtopic_name
  WHERE t.id = snapshot.task_id;

  IF EXISTS (
    SELECT 1
    FROM public.kb_tasks t
    JOIN public.kb_topics tp ON tp.id = t.topic_id
    WHERE tp.exam = 'ege'
      AND t.subtopic_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.kb_subtopics s
        WHERE s.id = t.subtopic_id
      )
  ) THEN
    RAISE EXCEPTION 'EGE KB task subtopic remap left orphaned subtopic references';
  END IF;
END
$migration$;
