-- Mock Exams v1 — Тренировочный вариант 1 от Егора Иванова (физика ЕГЭ-2026)
-- ----------------------------------------------------------------------
-- Этот файл сгенерирован скриптом scripts/build-mock-exam-seed.py из
-- tasks.json. НЕ редактировать вручную — править tasks.json и пересобирать.
--
-- Provenance:
--   source docx: 'Тр_вариант 1.docx' от Егора Иванова, 2026-05-07
--   parser: scripts/parse-mock-exam-docx.py
--   structurer: scripts/structure-mock-exam.py
--   generator: scripts/build-mock-exam-seed.py
--   review file: docs/delivery/features/mock-exams-v1/source/variant1-review.md
--
-- UUIDs derived deterministically via uuid5(ns=00000000-0000-0000-0000-000000005ec0).
-- Re-running generator with same tasks.json produces identical UUIDs.
--
-- Storage refs:
--   storage://mock-exam-variant-tasks/variant1/<filename>
-- Vladimir загружает картинки в Lovable Cloud Studio (bucket mock-exam-variant-tasks,
-- папка variant1/). WMF/EMF ДОЛЖНЫ быть конвертированы в PNG до загрузки —
-- браузеры не рендерят WMF/EMF. Список файлов: docs/delivery/features/mock-exams-v1/source/storage-upload-checklist.md
--
-- Применяется через Lovable Cloud auto-deploy после push в main.
-- AC-3 (deterministic checker): ответы Части 1 пред-вычислены и видны
-- в `correct_answer` ниже. После seed применения — `SELECT COUNT(*) FROM
-- mock_exam_variant_tasks WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131';' = 26.

BEGIN;

-- =====================================================================
-- 1. Вариант — мета-данные
-- =====================================================================

INSERT INTO public.mock_exam_variants (
  id, title, exam_type, source, source_attribution,
  duration_minutes, total_max_score, part1_max, part2_max, task_count,
  created_by
) VALUES (
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  'Тренировочный вариант 1 (физика ЕГЭ-2026)',
  'ege_physics',
  'tutor',
  'Источник: репетитор Егор Иванов',  -- displayed source attribution; docx author signature
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
  'f004fdf0-ea4e-5bba-9716-2fb2746ebcea'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  1, 1, 1,
  'Тело движется вдоль оси Ox. На рисунке приведён график зависимости проекции $v_x$ скорости тела от времени t.

Определите путь, пройденный телом в интервале времени от 0 до 20 с.

Ответ дайте в метрах.',
  'storage://mock-exam-variant-tasks/variant1/image6.png',
  '225',
  'strict',
  1,
  NULL,
  'Кинематика — графики движения'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 2 (part 1, kim=2, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '1a446c98-a7c9-509a-9a1e-252d777d03d1'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  2, 1, 2,
  'В инерциальной системе отсчёта сила величиной 70 Н сообщает телу массой 10 кг некоторое ускорение. Сила какой величины сообщит телу массой 9 кг в этой же системе отсчёта такое же ускорение?

Ответ дайте в ньютонах.',
  NULL,
  '63',
  'strict',
  1,
  NULL,
  'Динамика — 2-й закон Ньютона'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 3 (part 1, kim=3, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '3b48e80d-d870-5ee5-9b86-772d1d02d338'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  3, 1, 3,
  'Тело массой 200 г, брошенное вертикально вверх с поверхности Земли, 
в момент броска обладало кинетической энергией, равной 20 Дж. На какую максимальную высоту поднялось тело? Сопротивлением воздуха пренебречь.

Ответ дайте в метрах.',
  NULL,
  '10',
  'strict',
  1,
  NULL,
  'Энергия — кинетическая, потенциальная'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 4 (part 1, kim=4, max_score=1, check_mode=strict) ---
-- ⚠️ layout anomaly в docx: маркер kim=4 стоял ПОСЛЕ тела задачи.
--    structurer перенёс body+images назад. Проверить визуально перед commit.
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'db730331-0514-52d9-aedd-7cf052d05d6f'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  4, 1, 4,
  'Груз, подвешенный на лёгкой пружине жёсткостью 50 Н/м, совершает свободные вертикальные гармонические колебания. Пружину какой жёсткости надо взять вместо этой пружины, чтобы период свободных вертикальных колебаний этого груза стал в 2 раза меньше?

Ответ дайте в ньютонах на метр.',
  NULL,
  '200',
  'strict',
  1,
  NULL,
  'Колебания — пружинный маятник'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 5 (part 1, kim=5, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'ad9d1ffa-a314-5e3b-ab21-a1bb25acc420'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  5, 1, 5,
  'На рисунке показан график зависимости координаты х тела, движущегося вдоль оси Ох, от времени t. Из приведённого ниже списка выберите все верные утверждения.

1)

В точке A скорость тела равна нулю.

2)

В точке B проекция ускорения тела на ось Ox отрицательна.

3)

Проекция перемещения тела на ось Ox при переходе из точки B в точку C положительна.

4)

В точке D проекция скорости тела на ось Ox положительна.

5)

На участке CD модуль скорости тела уменьшается.',
  'storage://mock-exam-variant-tasks/variant1/image7.png',
  '123',
  'multi_choice',
  2,
  NULL,
  'Кинематика — анализ графика x(t)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 6 (part 1, kim=6, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '93a586d8-bd20-5ea3-bdb6-32db9375fd5a'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  6, 1, 6,
  'Камень брошен вверх под углом к горизонту. Сопротивление воздуха пренебрежимо малó. Как меняются модуль ускорения камня и его кинетическая энергия в поле тяжести при движении камня вверх?

Для каждой величины определите соответствующий характер изменения:

| Физические величины | Их изменения |
|---|---|
| А) Модуль ускорения камня | 1) увеличивается |
| Б) Кинетическая энергия камня | 2) уменьшается |
|  | 3) не изменяется |

Запишите в ответ выбранные цифры для каждой физической величины слитно цифрами в порядке А, Б: например 12. Цифры в ответе могут повторяться.',
  NULL,
  '32',
  'ordered',
  2,
  NULL,
  'Динамика — броски, кинематика и энергия'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 7 (part 1, kim=7, max_score=1, check_mode=strict) ---
-- ⚠️ layout anomaly в docx: маркер kim=7 стоял ПОСЛЕ тела задачи.
--    structurer перенёс body+images назад. Проверить визуально перед commit.
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '9b0d3dc8-67c1-5e4e-8129-78761190dfad'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  7, 1, 7,
  'На рисунке приведён график процесса 1–2, в котором участвует аргон. Объём, занимаемый газом в состоянии 1, равен 15 л. Определите объём аргона в состоянии 2.

Ответ дайте в литрах.',
  'storage://mock-exam-variant-tasks/variant1/image8.png',
  '3',
  'strict',
  1,
  NULL,
  'МКТ — изопроцессы'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 8 (part 1, kim=8, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '5f44fbb4-3735-53b5-91c1-aaa853bf9527'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  8, 1, 8,
  'Газ в сосуде сжали, совершив работу, равную 500 Дж. Внутренняя энергия газа при этом увеличилась на 350 Дж. Какое количество теплоты отдал газ окружающей среде?

Ответ дайте в джоулях.',
  NULL,
  '150',
  'strict',
  1,
  NULL,
  'Термодинамика — 1-е начало'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 9 (part 1, kim=9, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '252ee894-9616-5cf1-abc9-98c22b342907'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  9, 1, 9,
  'Идеальный газ переводят из состояния 1 в состояние 3 так, как показано на графике зависимости давления р газа от объёма V. Масса газа в процессе остаётся постоянной.

Из приведённого ниже списка выберите все верные утверждения, характеризующие процессы на графике.

1)

Абсолютная температура газа минимальна в состоянии 2.

2)

В процессе 1–2 абсолютная температура газа изобарно увеличилась 
в 2 раза.

3)

В процессе 2–3 абсолютная температура газа изохорно уменьшилась 
в 2 раза.

4)

Концентрация газа минимальна в состоянии 1.

5)

В ходе процесса 1–2–3 среднеквадратичная скорость теплового движения молекул газа уменьшается в 4 раза.',
  'storage://mock-exam-variant-tasks/variant1/image9.png',
  '34',
  'multi_choice',
  2,
  NULL,
  'МКТ — диаграмма p-V'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 10 (part 1, kim=10, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'e6003bcf-082c-5f84-b156-09948da93a44'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  10, 1, 10,
  'В сосуде неизменного объёма находилась при комнатной температуре смесь двух идеальных газов, по 2 моль каждого. Половину содержимого сосуда выпустили, а затем добавили в сосуд 1 моль первого газа. Температура в сосуде поддерживалась неизменной. Как изменились в результате проведённых экспериментов парциальное давление первого газа и давление смеси газов?

Для каждой величины определите соответствующий характер изменения:

| Физические величины | Их изменения |
|---|---|
| А) Парциальное давление первого газа | 1) увеличилась |
| Б) Давление смеси газов | 2) уменьшилась |
|  | 3) не изменилась |

Запишите в ответ выбранные цифры для каждой физической величины слитно цифрами в порядке А, Б: например 12. Цифры в ответе могут повторяться.',
  NULL,
  '32',
  'ordered',
  2,
  NULL,
  'МКТ — смесь газов'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 11 (part 1, kim=11, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '4868c950-a3ad-58a6-b973-5d6a40e49799'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  11, 1, 11,
  'По проводнику течёт постоянный электрический ток. Заряд, прошедший через поперечное сечение проводника, растёт с течением времени согласно представленному графику (см. рисунок).

Определите силу тока в проводнике.

Ответ дайте в амперах.',
  'storage://mock-exam-variant-tasks/variant1/image10.png',
  '1',
  'strict',
  1,
  NULL,
  'Электричество — постоянный ток, q(t)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 12 (part 1, kim=12, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'c450bd77-11c5-5ec5-96fb-85a731843369'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  12, 1, 12,
  'Определите энергию магнитного поля катушки индуктивностью $3\cdot10^{-4}$ Гн, если сила тока в ней равна 1 А.

Ответ дайте в миллиджоулях.',
  NULL,
  '0,15',
  'strict',
  1,
  NULL,
  'Магнетизм — энергия катушки'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 13 (part 1, kim=13, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '600e82ad-b881-522b-8146-93218d999e2c'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  13, 1, 13,
  'На рисунке приведён график зависимости силы тока I от времени t при свободных электромагнитных колебаниях в идеальном колебательном контуре. Каким станет период свободных электромагнитных колебаний в контуре, если конденсатор в нём заменить на другой конденсатор, ёмкость которого в 4 раза меньше?

Ответ дайте в микросекундах.',
  'storage://mock-exam-variant-tasks/variant1/image11.png',
  '2',
  'strict',
  1,
  NULL,
  'Колебательный контур — период'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 14 (part 1, kim=14, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '8b0f039a-8e50-5e3a-809d-abcc856f18bf'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  14, 1, 14,
  'В идеальном колебательном контуре, состоящем из конденсатора и катушки индуктивности, происходят свободные электромагнитные колебания. Изменение заряда конденсатора в колебательном контуре с течением времени показано в таблице.

$t, 10^{-6}$ c: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9

$q, 10^{-9}$ Кл: 1, 0,71, 0, –0,71, –1, –0,71, 0, 0,71, 1, 0,71

Выберите все верные утверждения о процессах, происходящих в контуре.

1)

Период колебаний равен $8\cdot10^{-6}$ с.

2)

Частота колебаний равна 250 кГц.

3)

В момент времени $t=2\cdot10^{-6}$ с модуль силы тока в контуре максимален.

4)

В момент времени $t=8\cdot10^{-6}$ с энергия магнитного поля катушки индуктивности максимальна.

5)

В момент времени $t=4\cdot10^{-6}$ с энергия электрического поля конденсатора минимальна.',
  NULL,
  '13',
  'multi_choice',
  2,
  NULL,
  'Колебательный контур — динамика q(t)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 15 (part 1, kim=15, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'c7c31277-8e6e-5990-89b2-59da75f97228'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  15, 1, 15,
  'При настройке колебательного контура радиопередатчика увеличивают электроёмкость его конденсатора. Как при этом изменяются частота колебаний силы тока в контуре и длина волны излучения передатчика?

Для каждой величины определите соответствующий характер изменения:

| Физические величины | Их изменения |
|---|---|
| А) Частота колебаний силы тока | 1) увеличивается |
| Б) Длина волны излучения | 2) уменьшается |
|  | 3) не меняется |

Запишите в ответ выбранные цифры для каждой физической величины слитно цифрами в порядке А, Б: например 12. Цифры в ответе могут повторяться.',
  NULL,
  '21',
  'ordered',
  2,
  NULL,
  'Радиосвязь — частота колебаний'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 16 (part 1, kim=16, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'de3406a5-4290-595e-b739-8fc23b3fc673'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  16, 1, 16,
  'Ядро изотопа тория $^{234}_{90}\mathrm{Th}$ испытывает электронный $\beta^-$-распад, при этом образуется ядро элемента $^{A}_{Z}X$. Каков заряд Z образовавшегося ядра X (в единицах элементарного заряда)?',
  NULL,
  '91',
  'strict',
  1,
  NULL,
  'Ядерная физика — β⁻-распад'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 17 (part 1, kim=17, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '77bffdcf-04fe-58c1-89f6-79766dcc2ba4'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  17, 1, 17,
  'Как изменятся при $\alpha$-распаде радиоактивного изотопа висмута $^{212}_{83}\mathrm{Bi}$ массовое число ядра и число протонов в ядре?

Для каждой величины определите соответствующий характер изменения:

| Физические величины | Их изменения |
|---|---|
| А) Массовое число ядра | 1) увеличится |
| Б) Число протонов в ядре | 2) уменьшится |
|  | 3) не изменится |

Запишите в ответ выбранные цифры для каждой физической величины слитно цифрами в порядке А, Б: например 12. Цифры в ответе могут повторяться.',
  NULL,
  '22',
  'ordered',
  2,
  NULL,
  'Ядерная физика — α-распад изотопа'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 18 (part 1, kim=18, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '481910e5-3709-5bae-b2a0-a8400b898fe6'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  18, 1, 18,
  'Выберите все верные утверждения о физических явлениях, величинах и закономерностях. Запишите цифры, под которыми они указаны.

1)

Импульсом силы называется величина, равная произведению массы тела на его ускорение.

2)

В изотермическом процессе для постоянной массы газа отношение объёма газа к его давлению остаётся постоянным.

3)

Модуль сил взаимодействия двух точечных неподвижных заряженных тел обратно пропорционален квадрату расстояния между ними.

4)

Период свободных электромагнитных колебаний в идеальном колебательном контуре увеличивается прямо пропорционально увеличению электроёмкости конденсатора.

5)

В планетарной модели атома число протонов в ядре равно числу электронов в электронной оболочке нейтрального атома.',
  NULL,
  '35',
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
  'b5d4f449-2826-512e-a3f3-af83f63fb4c9'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  19, 1, 19,
  'Запишите показания динамометра с учётом абсолютной погрешности измерений. Абсолютная погрешность прямого измерения равна цене деления динамометра. Шкала проградуирована в ньютонах (Н).',
  'storage://mock-exam-variant-tasks/variant1/image15.png',
  '2,70,1',
  'pair',
  1,
  NULL,
  'Измерения — динамометр с погрешностью'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 20 (part 1, kim=20, max_score=1, check_mode=task20) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '7c5fd36e-dd0b-5415-8d9c-51889a259eee'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  20, 1, 20,
  'Необходимо экспериментально обнаружить зависимость силы тока, протекающего в цепи, от внутреннего сопротивления источника тока. 
Какие две схемы следует использовать для проведения такого исследования?

1)

4)

2)

5)

3)

Запишите в ответ номера выбранных схем.',
  '["storage://mock-exam-variant-tasks/variant1/image16.png", "storage://mock-exam-variant-tasks/variant1/image17.png", "storage://mock-exam-variant-tasks/variant1/image18.png", "storage://mock-exam-variant-tasks/variant1/image19.png", "storage://mock-exam-variant-tasks/variant1/image20.png"]',
  '14',
  'task20',
  1,
  NULL,
  'Эксперимент — выбор схем'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 21 (part 2, kim=21, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '6f49dbbb-5243-56ed-8619-900416792a26'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  21, 2, 21,
  'Постоянная масса разреженного азота участвует в процессах 1–2–3, график которого изображён на рисунке в координатах p–n, где p – давление газа, n – концентрация молекул газа. Опираясь на законы молекулярной физики, объясните, как изменяются в ходе процессов 1–2–3 абсолютная температура газа T и плотность газа $\rho$.',
  'storage://mock-exam-variant-tasks/variant1/image22.png',
  NULL,
  'manual',
  3,
  '1. Концентрация газа определяется соотношением $n=\frac{N}{V}$, где N – число молекул газа, V – занимаемый газом объём. Плотность газа определяется соотношением $\rho=\frac{m}{V}=\frac{m_0N}{V}=m_0n$, где $m_0$ – масса одной молекулы газа. Таким образом, плотность газа прямо пропорциональна концентрации его молекул.

2. Согласно графику, в процессе 1–2 концентрация молекул газа остаётся постоянной, а в процессе 2–3 увеличивается. Следовательно, и плотность газа в процессе 1–2 остаётся постоянной, а в процессе 2–3 увеличивается.

3. Давление газа связано с его абсолютной температурой и концентрацией его молекул уравнением $p=nkT$. В процессе 1–2 концентрация молекул газа остаётся постоянной при возрастающем давлении газа, следовательно, абсолютная температура газа будет увеличиваться. В процессе 2–3 концентрация молекул газа увеличивается при постоянном давлении, следовательно, абсолютная температура газа будет уменьшаться.

4. Таким образом, плотность газа в процессе 1–2 остаётся постоянной, в процессе 2–3 увеличивается; абсолютная температура газа в процессе 1–2 увеличивается, а в процессе 2–3 уменьшается.',
  'МКТ — концентрация и плотность газа (объяснение)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 22 (part 2, kim=22, max_score=2, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '4d55b92e-040f-5686-bc8d-71c320f7ba8d'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  22, 2, 22,
  'В процессе прямолинейного равноускоренного движения тело за 2 с
увеличило свою скорость в 4 раза. Какой путь прошло тело за это время, если его начальная скорость была равна 3 м/с?',
  NULL,
  NULL,
  'manual',
  2,
  '1. Согласно законам равноускоренного прямолинейного движения:

$s=v_0t+\frac{at^2}{2}$,   $4v_0=v_0+at$,

где $v_0$ – начальная скорость тела, a – модуль ускорения тела, s – путь, пройденный телом за время t.

2. Решая уравнения, получим выражение для ускорения тела: $a=\frac{3v_0}{t}$ и для пути, пройденного телом за время t:

$s=\frac{5v_0t}{2}=\frac{5\cdot3\cdot2}{2}=15$ м.

Ответ: 15 м',
  'Кинематика — равноускоренное движение (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 23 (part 2, kim=23, max_score=2, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '11418d43-f243-5d2d-be52-463677024566'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  23, 2, 23,
  'К аккумулятору с ЭДС $\mathcal{E}=15$ В подключили лампочку сопротивлением $R=8$ Ом. Определите внутреннее сопротивление аккумулятора, если на лампочке выделяется мощность, равная 18 Вт.',
  NULL,
  NULL,
  'manual',
  2,
  '1. В соответствии с законом Ома для полной цепи $\mathcal{E}=I(R+r)$ имеем:

$r=\frac{\mathcal{E}}{I}-R$,

где I – сила тока, r – внутреннее сопротивление аккумулятора.

2. Мощность, потребляемая лампочкой, определяется формулой $P=I^2R$, откуда

$I=\sqrt{\frac{P}{R}}$.

3. В итоге получим:

$r=\mathcal{E}\sqrt{\frac{R}{P}}-R=15\sqrt{\frac{8}{18}}-8=2$ Ом.

Ответ: 2 Ом',
  'Электричество — внутреннее сопротивление (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 24 (part 2, kim=24, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '9d1827fb-888e-5edc-8ffc-321f06098b7a'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  24, 2, 24,
  'В комнате размерами 6 м × 5 м × 3 м, в которой воздух имеет температуру 25 °C и относительную влажность 20%, включили увлажнитель воздуха производительностью 0,2 л/ч. Чему станет равна относительная влажность воздуха в комнате через 2 ч? Давление насыщенного водяного пара при температуре 25 °C равно 3,17 кПа. Комнату считать герметичным сосудом.',
  NULL,
  NULL,
  'manual',
  3,
  'Относительная влажность определяется парциальным давлением водяного пара p и давлением $p_{\text{нас}}$ насыщенного пара при той же температуре:

$\varphi=\frac{p}{p_{\text{нас}}}$.

За время $\tau$ работы увлажнителя с производительностью I испаряется масса воды $m=\rho I\tau$ плотностью $\rho$.

В результате исходная влажность в комнате $\varphi_1=\frac{p_1}{p_{\text{нас}}}$ возрастает до значения

$\varphi_2=\frac{p_2}{p_{\text{нас}}}=\frac{p_1+\Delta p}{p_{\text{нас}}}=\varphi_1+\frac{\Delta p}{p_{\text{нас}}}$.

Водяной пар в комнате объёмом V является разреженным газом, который подчиняется уравнению Менделеева – Клапейрона:

$pV=\frac{M}{\mu}RT$,

где M – масса водяного пара, p – парциальное давление, $\mu$ – его молярная масса. Увеличение массы пара в комнате на m (от $m_1$ до $m_2=m_1+m$) приводит к увеличению парциального давления на величину, пропорциональную испарившейся массе:

$\Delta p=\frac{mRT}{\mu V}=\frac{\rho I\tau RT}{\mu V}$.

Отсюда:

$\varphi_2=\varphi_1+\frac{\Delta p}{p_{\text{нас}}}=\varphi_1+\frac{\rho I\tau RT}{\mu p_{\text{нас}}V}$.

Подставляя значения физических величин, получим:

$\varphi_2=0{,}2+\frac{10^3\cdot0{,}2\cdot10^{-3}\cdot2}{18\cdot10^{-3}}\cdot\frac{8{,}31\cdot298}{3{,}17\cdot10^3\cdot6\cdot5\cdot3}\approx0{,}39=39\%$.

Ответ: $\varphi_2\approx39\%$',
  'МКТ — увлажнитель воздуха (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 25 (part 2, kim=25, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'e9fd88a9-0969-5419-a9c5-012e506682e2'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  25, 2, 25,
  'Два точечных источника света находятся на главной оптической оси тонкой собирающей линзы с оптической силой 2 дптр на некотором расстоянии L друг от друга. Линза находится между ними. Расстояние от линзы до одного из источников x = 30 см. Изображения обоих источников получились в одной точке. Найдите расстояние L. Постройте на отдельных рисунках изображения двух источников в линзе, указав ход лучей.',
  NULL,
  NULL,
  'manual',
  3,
  '1. Так как источники находятся с разных сторон от линзы, то для одного из них изображение должно быть действительным, а для другого – мнимым (см. рисунки в исходном docx: image55.emf, image56.emf).

2. Мнимое изображение даёт источник, который находится на расстоянии x = 30 см от линзы, так как $x<F=\frac{1}{D}=0{,}5$ м.

3. Формулы тонкой линзы для двух источников имеют вид:

$\frac{1}{x}-\frac{1}{f}=\frac{1}{F}$,   (1)

минус перед $f>0$, как на рисунке, так как изображение мнимое,

$\frac{1}{L-x}+\frac{1}{f}=\frac{1}{F}$,   (2)

где F – фокусное расстояние линзы, f – расстояние от линзы до точки, в которой находятся оба изображения.

4. Решая систему уравнений (1)–(2), получим:

$F=\frac{2x(L-x)}{L}$.

5. Так как оптическая сила линзы $D=\frac{1}{F}$, тогда получим:

$D=\frac{L}{2x(L-x)}$.

Окончательно $L=\frac{2Dx^2}{2Dx-1}=\frac{2\cdot2\cdot0{,}3^2}{2\cdot2\cdot0{,}3-1}=1{,}8$ м.

Ответ: L = 1,8 м',
  'Оптика — линза и источники (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 26 (part 2, kim=26, max_score=4, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '6f2508b7-6902-567c-9b0f-2afe0b0ea796'::uuid,
  '36cebc45-e2e8-5603-a753-01c818bba131'::uuid,
  26, 2, 26,
  'На столе лежит доска массой M = 6 кг, на которой покоится брусок массой m = 2 кг. Доску начинают тянуть влево с постоянной горизонтальной силой F = 48 Н. При каком минимальном коэффициенте трения между бруском 
и доской μ1 груз будет оставаться неподвижным относительно доски? Коэффициент трения между доской и столом μ2 = 0,2. Сделайте схематичные рисунки с указанием сил, действующих на доску и на брусок.

Обоснуйте применимость законов, используемых для решения задачи.',
  NULL,
  NULL,
  'manual',
  4,
  'Обоснование

1. Рассмотрим задачу в инерциальной системе отсчёта (ИСО) «Стол».

2. Доска M и брусок m движутся в выбранной ИСО поступательно, поэтому описываем их моделью материальной точки. Тогда к описанию их движения можно применить второй закон Ньютона, справедливый для материальных точек в ИСО.

3. Для сил $\vec F_{\text{тр}1}$ и $\vec F_{\text{тр}2}$ из третьего закона Ньютона следует: $F_{\text{тр}1}=F_{\text{тр}2}$.

4. Так как коэффициент трения между грузом и доской $\mu_1$ минимальный, силы трения $F_{\text{тр}1}$ и $F_{\text{тр}2}$, действующие соответственно на груз и доску, – максимальные силы трения покоя, равные по модулю: $F_{\text{тр}1}=F_{\text{тр}2}=\mu_1N$.

5. Так как брусок покоится относительно доски, то $a_1=a_2=a$.

6. Для сил $N_1$ и P из третьего закона Ньютона следует: $N_1=P$.

Решение

1. На брусок, движущийся вместе с доской с ускорением $\vec a_1$, действуют сила тяжести $m\vec g$, нормальная составляющая силы реакции опоры $\vec N_1$ и сила трения $\vec F_{\text{тр}1}$ (см. рисунок в исходном docx: image70.emf).

2. На доску, движущуюся по поверхности стола с ускорением $\vec a_2$, действуют сила тяжести $M\vec g$, нормальная составляющая силы реакции опоры $\vec N_2$, силы трения $\vec F_{\text{тр}2}$ и $\vec F_{\text{тр}3}$, а также нормальная составляющая силы со стороны бруска $\vec P$ и сила тяги $\vec F$.

3. Запишем второй закон Ньютона для бруска: $m\vec a_1=\vec F_{\text{тр}1}+m\vec g+\vec N_1$, или в проекциях на оси:

$ma=F_{\text{тр}1}$,   $0=N_1-mg$.

И для доски: $M\vec a_2=\vec F+M\vec g+\vec N_2+\vec F_{\text{тр}2}+\vec F_{\text{тр}3}+\vec P$, или в проекциях на оси:

$Ma=F-F_{\text{тр}2}-F_{\text{тр}3}$,   $0=N_2-Mg-P$.

4. Модули сил трения, действующих на доску со стороны стола и на груз, определяются выражениями:

$F_{\text{тр}1}=\mu_1N_1$,   $F_{\text{тр}3}=\mu_2N_2$.

5. Из формул, учитывая, что $a_1=a_2=a$, по третьему закону Ньютона $F_{\text{тр}1}=F_{\text{тр}2}$, а $N_1=P$, найдём коэффициент трения $\mu_1$:

$\mu_1=\frac{F}{(M+m)g}-\mu_2=\frac{48}{(6+2)\cdot10}-0{,}2=0{,}4$.

Ответ: $\mu_1=0{,}4$',
  'Динамика — доска с бруском, трение (расчёт)'
) ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Validation:
-- SELECT COUNT(*) FROM public.mock_exam_variant_tasks WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131';
-- Expected: 26
-- SELECT kim_number, part, check_mode, max_score, correct_answer FROM public.mock_exam_variant_tasks WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131' ORDER BY kim_number;
