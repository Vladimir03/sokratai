-- Mock Exams v1 — Тренировочный вариант 5 от Егора Блинова (физика ЕГЭ-2026)
-- ----------------------------------------------------------------------
-- Этот файл сгенерирован скриптом scripts/build-mock-exam-seed.py из
-- tasks.json. НЕ редактировать вручную — править tasks.json и пересобирать.
--
-- Provenance:
--   source docx: 'Тр_вариант 5.docx' от Егора Блинова, 2026-05-07
--   parser: scripts/parse-mock-exam-docx.py
--   render+transcribe: docx → PDF (LibreOffice) → постранично выверено
--   generator: scripts/build-mock-exam-seed.py
--   review file: docs/delivery/features/mock-exams-v1/source/variant5-review.md
--
-- UUIDs derived deterministically via uuid5(ns=00000000-0000-0000-0000-000000005ec0).
-- Re-running generator with same tasks.json produces identical UUIDs.
--
-- Storage refs:
--   storage://mock-exam-variant-tasks/variant5/<filename>
-- Vladimir загружает картинки в Lovable Cloud Studio (bucket mock-exam-variant-tasks,
-- папка variant5/). WMF/EMF ДОЛЖНЫ быть конвертированы в PNG до загрузки —
-- браузеры не рендерят WMF/EMF. Список файлов: docs/delivery/features/mock-exams-v1/source/storage-upload-checklist-v5.md
--
-- Применяется через Lovable Cloud auto-deploy после push в main (как миграция).
-- AC-3 (deterministic checker): ответы Части 1 пред-вычислены и видны
-- в `correct_answer` ниже. После seed применения — `SELECT COUNT(*) FROM
-- mock_exam_variant_tasks WHERE variant_id = '03660fb4-5247-5376-a0e9-2eb5faae844e';' = 26.

BEGIN;

-- =====================================================================
-- 1. Вариант — мета-данные
-- =====================================================================

INSERT INTO public.mock_exam_variants (
  id, title, exam_type, source, source_attribution,
  duration_minutes, total_max_score, part1_max, part2_max, task_count,
  created_by
) VALUES (
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  'Тренировочный вариант 5 (физика ЕГЭ-2026)',
  'ege_physics',
  'tutor',
  'Источник: репетитор Егор Блинов',  -- displayed source attribution; docx author signature
  235,  -- 3ч 55мин
  45,   -- 28 (Часть 1) + 17 (Часть 2), verified against source docx criteria
  28,
  17,
  26,
  -- Egor Blinov (egor.o.blinov@gmail.com) — pilot tutor, owner of variant 1.
  -- UUID resolved 2026-05-08 via SQL JOIN auth.users × public.tutors.
  'a7212758-8cdd-4d7c-8608-4fedcb34d74c'::uuid
) ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- 2. Задачи варианта (26 шт)
-- =====================================================================

-- --- Задание 1 (part 1, kim=1, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'ec84d30a-5903-577e-9736-b31a9ae2b509'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  1, 1, 1,
  'На рисунке показан график зависимости проекции $v_x$ скорости тела от времени t. Какова проекция $a_x$ ускорения этого тела в момент времени 2 с?

Ответ дайте в м/с².',
  'storage://mock-exam-variant-tasks/variant5/image1.png',
  '0',
  'strict',
  1,
  NULL,
  'Кинематика — ускорение по графику v(t)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 2 (part 1, kim=2, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'f946c6ec-9c3a-5d43-8c39-c88e81cfce13'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  2, 1, 2,
  'При исследовании зависимости модуля силы упругости $F_{упр}$ от удлинения пружины были получены следующие данные:

| $F_{упр}$, Н | 2,5 | 5,0 | 10,0 | 12,5 |
|---|---|---|---|---|
| Δx, м | 0,01 | 0,02 | 0,04 | 0,05 |

Определите по результатам исследования жёсткость пружины.

Ответ дайте в Н/м.',
  NULL,
  '250',
  'strict',
  1,
  NULL,
  'Динамика — жёсткость пружины из таблицы'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 3 (part 1, kim=3, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '98b812a1-4636-5e6d-9f8c-88d998bcac87'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  3, 1, 3,
  'Тело движется в инерциальной системе отсчёта по прямой. Под действием постоянной силы величиной 9 Н, направленной вдоль этой прямой, за 2 с импульс тела увеличился и стал равен 48 кг·м/с. Определите начальный импульс тела.

Ответ дайте в кг·м/с.',
  NULL,
  '30',
  'strict',
  1,
  NULL,
  'Динамика — теорема об изменении импульса'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 4 (part 1, kim=4, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '434cd2f2-a8f9-550a-babd-45bf43e4114f'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  4, 1, 4,
  'В сосуд глубиной 20 см налита вода, уровень которой ниже края сосуда на 2 см. Чему равно дополнительное к атмосферному давление столба воды на плоское дно сосуда?

Ответ дайте в кПа.',
  NULL,
  '1,8',
  'strict',
  1,
  NULL,
  'Гидростатика — давление столба жидкости'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 5 (part 1, kim=5, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '9d1b7c3b-afd6-57e5-a0a0-4ade663975df'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  5, 1, 5,
  'Небольшой груз, покоящийся на гладком горизонтальном столе, соединён пружиной со стенкой. Груз немного смещают от положения равновесия вдоль оси пружины и отпускают из состояния покоя, после чего он начинает совершать гармонические колебания, двигаясь вдоль оси пружины, вдоль которой направлена ось Ox. В таблице приведены значения координаты груза x в различные моменты времени t.

| t, с | 0,0 | 0,2 | 0,4 | 0,6 | 0,8 | 1,0 | 1,2 | 1,4 | 1,6 |
|---|---|---|---|---|---|---|---|---|---|
| x, см | 2,0 | 1,4 | 0,0 | −1,4 | −2,0 | −1,4 | 0,0 | 1,4 | 2,0 |

Выберите верные утверждения о результатах этого опыта на основании данных, содержащихся в таблице.

1) Период колебаний груза равен 1,6 с.

2) Частота колебаний груза равна 0,25 Гц.

3) В момент времени 1,2 с модуль ускорения груза минимален.

4) В момент времени 0,6 с модуль силы, с которой пружина действует на груз, максимален.

5) В момент времени 1,6 с кинетическая энергия груза минимальна.',
  NULL,
  '135',
  'multi_choice',
  2,
  NULL,
  'Колебания — гармонические колебания груза на пружине'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 6 (part 1, kim=6, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '5b40b1bf-8238-5e01-b094-de0ab7d96d42'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  6, 1, 6,
  'В момент t = 0 камень бросают с начальной скоростью $v_0$ под углом α к горизонту с некоторой высоты h (см. рисунок). Графики А и Б представляют собой зависимости физических величин, характеризующих движение камня в процессе полёта, от времени t. Установите соответствие между графиками и физическими величинами, зависимость которых от времени эти графики могут представлять. (Сопротивлением воздуха пренебречь. Потенциальная энергия камня отсчитывается от уровня $y = 0$.)

К каждой позиции первого столбца подберите соответствующую позицию из второго и запишите в таблицу выбранные цифры под соответствующими буквами.

| ГРАФИКИ | ФИЗИЧЕСКИЕ ВЕЛИЧИНЫ |
|---|---|
| А) (см. рисунок) | 1) потенциальная энергия камня |
| Б) (см. рисунок) | 2) проекция импульса камня на ось y |
|  | 3) проекция ускорения камня на ось y |
|  | 4) кинетическая энергия камня |

Запишите в ответ выбранные цифры в порядке А, Б.',
  '["storage://mock-exam-variant-tasks/variant5/image6_situation.png", "storage://mock-exam-variant-tasks/variant5/image6_a.png", "storage://mock-exam-variant-tasks/variant5/image6_b.png"]',
  '43',
  'ordered',
  2,
  NULL,
  'Кинематика — соответствие графиков физическим величинам'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 7 (part 1, kim=7, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '8f7dd680-60ee-5426-ae80-715c1b2f312a'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  7, 1, 7,
  'Абсолютная температура гелия увеличилась со 150 К до 600 К. Во сколько раз увеличилась средняя кинетическая энергия теплового движения его молекул?

Ответ дайте в раз(ах).',
  NULL,
  '4',
  'strict',
  1,
  NULL,
  'МКТ — средняя кинетическая энергия молекул'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 8 (part 1, kim=8, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '3d8f1a82-531c-5ffd-96d6-8b442a6924fa'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  8, 1, 8,
  'На рисунке показана последовательность процессов изменения состояния идеального газа. В каком из процессов (1, 2, 3 или 4) газ совершает наибольшую по модулю работу?

Ответ дайте номером процесса.',
  'storage://mock-exam-variant-tasks/variant5/image8.png',
  '2',
  'strict',
  1,
  NULL,
  'Термодинамика — работа газа по p–V диаграмме'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 9 (part 1, kim=9, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'ee3e13b3-4d96-52f9-9baa-5bdbc7e70e9a'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  9, 1, 9,
  'В двух сосудах одинакового объёма находятся разреженные газы. В первом сосуде находится 2 моль гелия при температуре 127 °C, во втором сосуде находится 1 моль аргона при температуре 300 К. Выберите все верные утверждения о параметрах состояния указанных газов.

1) Абсолютная температура газа во втором сосуде выше, чем в первом.

2) Давления газов в сосудах одинаковы.

3) Среднеквадратичная скорость молекул газа в первом сосуде больше, чем во втором.

4) Концентрация газа в первом сосуде в два раза меньше, чем во втором.

5) Отношение средней кинетической энергии теплового движения молекул аргона к средней кинетической энергии теплового движения молекул гелия равно 0,75.',
  NULL,
  '35',
  'multi_choice',
  2,
  NULL,
  'МКТ — сравнение параметров двух газов'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 10 (part 1, kim=10, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'a1187403-6ba8-55b0-96c5-d1f2e7b081cd'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  10, 1, 10,
  'Тепловая машина работает по циклу Карно. Температуру нагревателя тепловой машины понизили, оставив температуру холодильника прежней. Количество теплоты, отданное газом холодильнику за цикл, не изменилось. Как изменился при этом КПД тепловой машины и работа газа за цикл?

Для каждой величины определите соответствующий характер её изменения:

| Физические величины | Их изменения |
|---|---|
| А) КПД тепловой машины | 1) увеличилась |
| Б) Работа газа за цикл | 2) уменьшилась |
|  | 3) не изменилась |

Запишите в ответ выбранные цифры в порядке А, Б. Цифры в ответе могут повторяться.',
  NULL,
  '22',
  'ordered',
  2,
  NULL,
  'Термодинамика — изменение КПД цикла Карно'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 11 (part 1, kim=11, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '8de5ce07-d419-55f2-9e0c-023dd4da9ca7'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  11, 1, 11,
  'На рисунке показан график зависимости силы тока в проводнике от напряжения между его концами. Чему равно сопротивление проводника?

Ответ дайте в омах.',
  'storage://mock-exam-variant-tasks/variant5/image11.png',
  '3',
  'strict',
  1,
  NULL,
  'Электричество — закон Ома по графику I(U)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 12 (part 1, kim=12, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'a207dd7c-92d0-5ca3-b8a7-1fb80f38d31b'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  12, 1, 12,
  'Прямолинейный проводник длиной L, по которому протекает ток I, помещён в однородное магнитное поле перпендикулярно линиям индукции $\vec{B}$. Во сколько раз изменится сила Ампера, действующая на проводник, если его длину увеличить в 4 раза, а индукцию магнитного поля уменьшить в 2 раза? (Сила тока, взаимное расположение проводника с током и линий индукции магнитного поля остаются неизменными.)

Ответ дайте в раз(ах).',
  NULL,
  '2',
  'strict',
  1,
  NULL,
  'Магнетизм — сила Ампера'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 13 (part 1, kim=13, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '554fb279-4dcb-593e-8dbf-50e09f9899f7'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  13, 1, 13,
  'При переводе ключа К из положения 1 в положение 2 (см. рисунок) период собственных электромагнитных колебаний в идеальном колебательном контуре увеличился в 1,5 раза. Во сколько раз индуктивность $L_x$ катушки в колебательном контуре больше L?

Ответ дайте в раз(ах).',
  'storage://mock-exam-variant-tasks/variant5/image13.png',
  '2,25',
  'strict',
  1,
  NULL,
  'Колебательный контур — связь периода и индуктивности'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 14 (part 1, kim=14, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'd5b8b490-4d9c-583d-bb54-84cbe4446343'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  14, 1, 14,
  'На рисунке изображены линии напряжённости однородного электростатического поля, созданного равномерно заряженной протяжённой горизонтальной пластиной. Из приведённого ниже списка выберите все верные утверждения относительно ситуации, показанной на рисунке.

1) Работа электростатического поля по перемещению точечного положительного заряда из точки А в точку В положительна.

2) Если в точку В поместить точечный отрицательный заряд, то на него со стороны пластины будет действовать сила, направленная вертикально вверх.

3) Напряжённость электростатического поля в точке А меньше, чем в точке С.

4) Потенциал электростатического поля в точке В выше, чем в точке С.

5) Заряд пластины положительный.',
  'storage://mock-exam-variant-tasks/variant5/image14.png',
  '45',
  'multi_choice',
  2,
  NULL,
  'Электростатика — однородное поле заряженной пластины'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 15 (part 1, kim=15, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'c9a76510-0f16-5361-9c53-58e81e6e52db'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  15, 1, 15,
  'Положительно заряженный ион движется по окружности в однородном магнитном поле. Как изменятся модуль центростремительного ускорения иона и частота его обращения, если ион будет двигаться по окружности в том же магнитном поле, имея меньшую кинетическую энергию?

Для каждой величины определите соответствующий характер изменения:

| Физические величины | Их изменения |
|---|---|
| А) Модуль центростремительного ускорения иона | 1) увеличится |
| Б) Частота обращения иона | 2) уменьшится |
|  | 3) не изменится |

Запишите в ответ выбранные цифры в порядке А, Б. Цифры в ответе могут повторяться.',
  NULL,
  '23',
  'ordered',
  2,
  NULL,
  'Магнетизм — движение иона по окружности'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 16 (part 1, kim=16, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '8d89bc53-0b87-587d-a910-6bb0648179b0'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  16, 1, 16,
  'На рисунке представлен фрагмент Периодической системы элементов Д.И. Менделеева. Под названием каждого элемента приведены массовые числа его основных стабильных изотопов. При этом нижний индекс около массового числа указывает (в процентах) распространённость изотопа в природе.

Запишите число протонов в ядре наименее распространённого стабильного изотопа меди.',
  'storage://mock-exam-variant-tasks/variant5/image16.png',
  '29',
  'strict',
  1,
  NULL,
  'Ядерная физика — число протонов в изотопе'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 17 (part 1, kim=17, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '4b23d35c-7c89-5557-8c0f-9a80c43ed67e'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  17, 1, 17,
  'На рисунке изображена упрощённая диаграмма нижних энергетических уровней атома. Стрелками отмечены некоторые возможные переходы атома между этими уровнями. Установите соответствие между процессами поглощения фотона наименьшей длины волны и излучения фотона наименьшей частоты и энергией соответствующего фотона. К каждой позиции первого столбца подберите соответствующую позицию из второго и запишите в таблицу выбранные цифры под соответствующими буквами.

| ПРОЦЕСС | ЭНЕРГИЯ ФОТОНА |
|---|---|
| А) Поглощение фотона наименьшей длины волны | 1) $E_1 - E_0$ |
| Б) Излучение фотона наименьшей частоты | 2) $E_2 - E_0$ |
|  | 3) $E_3 - E_0$ |
|  | 4) $E_4 - E_0$ |

Запишите в ответ выбранные цифры в порядке А, Б.',
  'storage://mock-exam-variant-tasks/variant5/image17.png',
  '31',
  'ordered',
  2,
  NULL,
  'Квантовая физика — энергетические уровни атома'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 18 (part 1, kim=18, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '8534ab7c-fd8c-589d-8b32-9f43177add8c'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  18, 1, 18,
  'Выберите все верные утверждения о физических явлениях, величинах и закономерностях. Запишите цифры, под которыми они указаны.

1) Период гармонических колебаний колебательной системы обратно пропорционален частоте её колебаний.

2) Внутренняя энергия постоянной массы идеального газа увеличивается при понижении абсолютной температуры газа.

3) Изначально незаряженные тела в процессе электризации трением приобретают равные по модулю и одинаковые по знаку заряды.

4) Индукционный ток возникает в замкнутом проводящем контуре при изменении магнитного потока, пронизывающего площадку, ограниченную контуром.

5) В планетарной модели атома число протонов в ядре равно числу электронов в электронной оболочке нейтрального атома.',
  NULL,
  '145',
  'multi_choice',
  2,
  NULL,
  'Общие закономерности (множественный выбор)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 19 (part 1, kim=19, max_score=1, check_mode=pair) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '17dcec3b-0753-535f-bd04-576e3dfceed5'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  19, 1, 19,
  'Запишите показания вольтметра с учётом абсолютной погрешности измерений. Абсолютная погрешность прямого измерения напряжения равна цене деления вольтметра.

Ответ запишите в виде (значение ± погрешность) в В. В поле ответа перенесите только числа, не разделяя их пробелом или другим знаком.',
  'storage://mock-exam-variant-tasks/variant5/image19.jpeg',
  '3,00,2',
  'pair',
  1,
  NULL,
  'Измерения — вольтметр с погрешностью'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 20 (part 1, kim=20, max_score=1, check_mode=task20) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '3536fd28-f472-53dc-94c7-9bc9578720d6'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  20, 1, 20,
  'Ученику необходимо на опыте выяснить, зависит ли частота свободных колебаний пружинного маятника от объёма груза. У него имеется пять пружинных маятников, характеристики которых приведены в таблице. Какие два маятника необходимо взять ученику, чтобы провести данное исследование?

| № маятника | Жёсткость пружины, Н/м | Объём груза, см³ | Масса груза, г |
|---|---|---|---|
| 1 | 40 | 30 | 100 |
| 2 | 60 | 60 | 200 |
| 3 | 60 | 30 | 100 |
| 4 | 80 | 30 | 100 |
| 5 | 60 | 80 | 200 |

Запишите в ответе номера выбранных маятников.',
  NULL,
  '25',
  'task20',
  1,
  NULL,
  'Эксперимент — выбор маятников'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 21 (part 2, kim=21, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'cf09af0f-e797-5516-9237-3e5c0ba09285'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  21, 2, 21,
  'Один моль гелия участвует в циклическом процессе 1–2–3–4–1, график которого изображён на рисунке в координатах p–T, где p – давление газа, T – абсолютная температура. Опираясь на законы молекулярной физики и термодинамики, сравните модуль работы газа в процессах 2–3 и 3–4. Постройте график цикла в координатах p–V, где p – давление газа, V – объём газа.',
  'storage://mock-exam-variant-tasks/variant5/image21.png',
  NULL,
  'manual',
  3,
  '1. Модуль работы газа в процессе 2–3 меньше работы в процессе 3–4: $A_{23} < A_{34}$.

2. Поскольку работа газа в термодинамике численно равна площади фигуры под графиком в координатах p–V, перестроим график цикла в этих координатах. Процесс 1–2 является изохорным (V = const, $\frac{p}{T}=$ const): согласно графику, абсолютная температура увеличивается в 3 раза. Процесс 2–3 изобарный, в координатах p–V его графиком является горизонтальная прямая; по закону Гей-Люссака ($\frac{V}{T}=$ const) увеличение температуры в 2 раза увеличивает объём в 2 раза. Процесс 3–4 изотермический, в координатах p–V — гипербола; по закону Бойля–Мариотта ($pV=$ const) уменьшение давления в 3 раза увеличивает объём в 3 раза. В процессе 4–1 газ изобарно вернулся в исходное состояние.

3. Из графика: работа газа в процессе 2–3 равна $A_{23}=3p_0(2V_0-V_0)=3p_0V_0$, а работа в процессе 3–4 численно равна площади под гиперболой и $A_{34}>p_0(6V_0-2V_0)=4p_0V_0$.

Таким образом, $A_{23} < A_{34}$.',
  'МКТ/Термодинамика — сравнение работы в цикле (объяснение + p–V график)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 22 (part 2, kim=22, max_score=2, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '0fb4c745-0627-542d-9bed-dfa9ae12fe8e'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  22, 2, 22,
  'В стакан налита вода, а поверх неё – керосин. Однородный шар плавает, погружённый в обе жидкости. При этом четверть объёма шара находится в воде. Найдите плотность материала шара.',
  'storage://mock-exam-variant-tasks/variant5/image22.png',
  NULL,
  'manual',
  2,
  '1. На шар действуют сила Архимеда в виде двух слагаемых ($F_{A1}$ за счёт керосина и $F_{A2}$ за счёт воды) и сила тяжести: $F_{A1}+F_{A2}=mg$.

2. Так как шар находится в равновесии:

$\rho_{к} g \frac{3}{4}V + \rho_{в} g \frac{1}{4}V = mg$,   (1)

$m = \rho V$.   (2)

3. Объединив уравнения (1) и (2), получим:

$\rho = \frac{3}{4}\rho_{к} + \frac{1}{4}\rho_{в} = \frac{3}{4}\cdot 800 + \frac{1}{4}\cdot 1000 = 850$ кг/м³.

Ответ: $\rho = 850$ кг/м³.',
  'Гидростатика — плавание тела в двух жидкостях (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 23 (part 2, kim=23, max_score=2, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'b1d54c12-5bd5-5f7c-bd38-d9c37e123330'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  23, 2, 23,
  'Два одинаковых по модулю разноимённых неподвижных точечных заряда $q_1 = -2{,}5$ нКл и $q_2 = 2{,}5$ нКл находятся на расстоянии a = 80 см друг от друга в вакууме. Определите напряжённость электрического поля этих зарядов в точке, находящейся на расстоянии r = 50 см от каждого заряда.',
  NULL,
  NULL,
  'manual',
  2,
  '1. В соответствии с принципом суперпозиции напряжённость электрического поля в данной точке определяется соотношением $\vec{E} = \vec{E}_1 + \vec{E}_2$. Точка лежит на серединном перпендикуляре к отрезку между зарядами и удалена от каждого заряда на r.

2. Модуль напряжённости поля каждого точечного заряда: $E_1 = E_2 = k\frac{|q|}{r^2}$.

3. Так как модули зарядов одинаковы, модуль результирующей напряжённости (учитывая геометрию равнобедренного треугольника со стороной r и основанием a):

$E = 2E_1\cos\alpha = k\frac{|q|}{r^2}\cdot\frac{a}{r} = k\frac{|q|\,a}{r^3}$.

Подставляя значения:

$E = 9\cdot10^{9}\cdot\frac{2{,}5\cdot10^{-9}\cdot 0{,}8}{0{,}5^{3}} = 144$ В/м.

Ответ: $E = 144$ В/м.',
  'Электростатика — напряжённость поля двух точечных зарядов (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 24 (part 2, kim=24, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'a5ac2bb1-db45-5e26-9330-f4eeb0f29b86'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  24, 2, 24,
  'В качестве рабочего тела в тепловой машине используется идеальный одноатомный газ, который совершает циклический процесс, состоящий из изобарного нагревания (1→2), изохорного охлаждения (2→3) и адиабатного сжатия (3→1). КПД этой тепловой машины $\eta = 20\%$. Найдите отношение работы $A_{12}$, совершённой газом в изобарном процессе, к работе $A''_{31}$, совершённой над газом при адиабатном сжатии.',
  'storage://mock-exam-variant-tasks/variant5/image24.png',
  NULL,
  'manual',
  3,
  '1. На участке 1–2 (изобара) рабочее тело получает положительное количество теплоты от нагревателя: $Q_{нагр}=Q_{12}=|U_2-U_1|+A_{12}$. На участке 2–3 (изохора) газ отдаёт холодильнику положительное количество теплоты. На участке 3–1 (адиабата) внешние силы сжимают газ, совершая работу $A''_{31}=-A_{31}$.

2. КПД тепловой машины: $\eta = \frac{A}{Q_{нагр}} = \frac{A_{12}-A''_{31}}{Q_{12}}$, где A — работа газа за цикл.

3. Используя формулу для внутренней энергии идеального газа $U=\frac{3}{2}\nu RT=\frac{3}{2}pV$ и $A_{12}=p_1(V_2-V_1)$:

$Q_{12}=\frac{3}{2}\nu R(T_2-T_1)+p_1(V_2-V_1)=\frac{5}{2}A_{12}$.

Тогда $A''_{31}=A_{12}-\eta Q_{12}=A_{12}\left(1-\frac{5}{2}\eta\right)$.

4. Отсюда: $\frac{A_{12}}{A''_{31}}=\frac{2}{2-5\eta}=\frac{2}{2-5\cdot0{,}2}=2$.

Ответ: $\frac{A_{12}}{A''_{31}}=2$.',
  'Термодинамика — КПД цикла, отношение работ (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 25 (part 2, kim=25, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '788566ee-b291-5643-af38-b2e5dc857e5e'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  25, 2, 25,
  'На двойном фокусном расстоянии от рассеивающей линзы с оптической силой $-10$ дптр на её главной оптической оси расположен точечный источник света. Линза вставлена в непрозрачную оправу радиусом 5 см. Каков диаметр светлого пятна на экране, расположенном по другую сторону линзы на расстоянии 20 см от неё? Сделайте рисунок с указанием хода лучей.',
  NULL,
  NULL,
  'manual',
  3,
  'Найдём фокусное расстояние линзы:

$F = \frac{1}{D_0} = \frac{1}{-10\;\text{дптр}} = -10$ см,

где $D_0$ — оптическая сила линзы.

Для нахождения диаметра светлого пятна надо пустить луч от источника $S$ через край оправы — луч $SA$. Далее пустим луч $KO$ через центр линзы параллельно лучу $SA$ и найдём побочный фокус $M$ — при преломлении луча $SA$ его продолжение пройдёт через точку $M$, а искомый диаметр равен $2BC$.

При этом точка $E$ является мнимым изображением $S$. По формуле тонкой линзы:

$-\frac{1}{|F|} = -\frac{1}{OE} + \frac{1}{SO} = -\frac{1}{OE} + \frac{1}{|2F|}$.

Отсюда $OE = \frac{2|F|}{3}$ (знак «−» так как изображение мнимое).

Рассмотрим треугольники $EAO$ и $EBC$ — они подобны, так как $BC$ и $AO$ параллельны (по трём углам). Тогда

$\frac{EO}{EC} = \frac{AO}{BC} \;\Leftrightarrow\; \frac{2|F|/3}{L + 2|F|/3} = \frac{r}{D/2}$.

Здесь $L = 2|F|$ — расстояние от линзы до экрана. Тогда:

$D = \frac{r(3L + 2|F|)}{|F|} = \frac{5\;\text{см}\cdot(3\cdot 20\;\text{см} + 2\cdot 10\;\text{см})}{10\;\text{см}} = 40$ см.

Ответ: $D = 40$ см.',
  'Оптика — рассеивающая линза, диафрагма (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 26 (part 2, kim=26, max_score=4, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '84e6761c-f24e-5044-b558-8f73aedc7087'::uuid,
  '03660fb4-5247-5376-a0e9-2eb5faae844e'::uuid,
  26, 2, 26,
  'На столе лежит доска массой M = 6 кг, на которой покоится брусок массой m = 2 кг. Доску начинают тянуть влево с постоянной горизонтальной силой F = 48 Н. При каком минимальном коэффициенте трения между бруском и доской $\mu_1$ груз будет оставаться неподвижным относительно доски? Коэффициент трения между доской и столом $\mu_2 = 0{,}2$. Сделайте схематичные рисунки с указанием сил, действующих на доску и на брусок.

Обоснуйте применимость законов, используемых для решения задачи.',
  NULL,
  NULL,
  'manual',
  4,
  'Обоснование

1. Рассмотрим задачу в ИСО «Стол». Доска M и брусок m — материальные точки. По третьему закону Ньютона $F_{\text{тр}1}=F_{\text{тр}2}$.

2. Так как $\mu_1$ — минимальный, силы трения $F_{\text{тр}1}$ и $F_{\text{тр}2}$ — максимальные силы трения покоя: $F_{\text{тр}1}=F_{\text{тр}2}=\mu_1 N$. Брусок покоится относительно доски, поэтому $a_1=a_2=a$. По третьему закону Ньютона $N_1=P$.

Решение

1. На брусок действуют сила тяжести $m\vec g$, нормальная составляющая силы реакции $\vec N_1$ и сила трения $\vec F_{\text{тр}1}$.

2. На доску действуют сила тяжести $M\vec g$, $\vec N_2$, силы трения $\vec F_{\text{тр}2}$ и $\vec F_{\text{тр}3}$, нормальная составляющая силы со стороны бруска $\vec P$ и сила тяги $\vec F$.

3. Второй закон Ньютона для бруска в проекциях: $ma=F_{\text{тр}1}$, $0=N_1-mg$. Для доски: $Ma=F-F_{\text{тр}2}-F_{\text{тр}3}$, $0=N_2-Mg-P$.

4. Модули сил трения: $F_{\text{тр}1}=\mu_1 N_1$, $F_{\text{тр}3}=\mu_2 N_2$.

5. Учитывая $a_1=a_2=a$, $F_{\text{тр}1}=F_{\text{тр}2}$, $N_1=P$, найдём $\mu_1$:

$\mu_1=\frac{F}{(M+m)g}-\mu_2=\frac{48}{(6+2)\cdot 10}-0{,}2=0{,}4$.

Ответ: $\mu_1=0{,}4$.',
  'Динамика — доска с бруском, трение (расчёт)'
) ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Validation:
-- SELECT COUNT(*) FROM public.mock_exam_variant_tasks WHERE variant_id = '03660fb4-5247-5376-a0e9-2eb5faae844e';
-- Expected: 26
-- SELECT kim_number, part, check_mode, max_score, correct_answer FROM public.mock_exam_variant_tasks WHERE variant_id = '03660fb4-5247-5376-a0e9-2eb5faae844e' ORDER BY kim_number;
