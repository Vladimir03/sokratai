-- Seed Тренировочный вариант 2 (физика ЕГЭ-2026) как миграция.
-- Источник контента: supabase/seed/mock_exams_variant_2.sql (сгенерирован
-- scripts/build-mock-exam-seed.py из variant2-tasks.json). Эта миграция —
-- механизм авто-применения (Lovable Cloud применяет migrations/ при push).
-- Idempotent (ON CONFLICT DO NOTHING). variant_id b3d8a2f2-c831-5b85-976f-fe50ba64d393.
--
-- ВНИМАНИЕ: картинки задач (storage://mock-exam-variant-tasks/variant2/*) и
-- PDF (mock-exam-variant-pdfs/variant2-tasks.pdf) заливаются в Storage вручную —
-- см. docs/delivery/features/mock-exams-v1/source/storage-upload-checklist-v2.md

-- Mock Exams v1 — Тренировочный вариант 2 от Егора Блинова (физика ЕГЭ-2026)
-- ----------------------------------------------------------------------
-- Этот файл сгенерирован скриптом scripts/build-mock-exam-seed.py из
-- tasks.json. НЕ редактировать вручную — править tasks.json и пересобирать.
--
-- Provenance:
--   source docx: 'Тр_вариант 2.docx' от Егора Блинова, 2026-05-07
--   parser: scripts/parse-mock-exam-docx.py
--   render+transcribe: docx → PDF (LibreOffice) → постранично выверено
--   generator: scripts/build-mock-exam-seed.py
--   review file: docs/delivery/features/mock-exams-v1/source/variant2-review.md
--
-- UUIDs derived deterministically via uuid5(ns=00000000-0000-0000-0000-000000005ec0).
-- Re-running generator with same tasks.json produces identical UUIDs.
--
-- Storage refs:
--   storage://mock-exam-variant-tasks/variant2/<filename>
-- Vladimir загружает картинки в Lovable Cloud Studio (bucket mock-exam-variant-tasks,
-- папка variant2/). WMF/EMF ДОЛЖНЫ быть конвертированы в PNG до загрузки —
-- браузеры не рендерят WMF/EMF. Список файлов: docs/delivery/features/mock-exams-v1/source/storage-upload-checklist-v2.md
--
-- Применяется через Lovable Cloud auto-deploy после push в main (как миграция).
-- AC-3 (deterministic checker): ответы Части 1 пред-вычислены и видны
-- в `correct_answer` ниже. После seed применения — `SELECT COUNT(*) FROM
-- mock_exam_variant_tasks WHERE variant_id = 'b3d8a2f2-c831-5b85-976f-fe50ba64d393';' = 26.

BEGIN;

-- =====================================================================
-- 1. Вариант — мета-данные
-- =====================================================================

INSERT INTO public.mock_exam_variants (
  id, title, exam_type, source, source_attribution,
  duration_minutes, total_max_score, part1_max, part2_max, task_count,
  created_by
) VALUES (
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  'Тренировочный вариант 2 (физика ЕГЭ-2026)',
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
  '553c54a7-0bdb-5ad5-9ac1-d842c8c7f2a2'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  1, 1, 1,
  'На рисунке представлен график зависимости модуля скорости $v$ тела от времени t. Найдите путь, пройденный телом за время от 0 до 12 с.

Ответ дайте в метрах.',
  'storage://mock-exam-variant-tasks/variant2/image6.png',
  '150',
  'strict',
  1,
  NULL,
  'Кинематика — путь по графику v(t)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 2 (part 1, kim=2, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '3dfea9a5-42e2-5929-8533-955762b901cc'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  2, 1, 2,
  'Два маленьких однородных шарика массой m каждый притягиваются друг к другу с гравитационными силами, равными по модулю 4 пН. Расстояние между центрами шариков равно r. Каков модуль сил гравитационного притяжения друг к другу двух других маленьких однородных шариков, если масса каждого из них 2m, а расстояние между их центрами $\frac{r}{2}$?

Ответ дайте в пиконьютонах.',
  NULL,
  '64',
  'strict',
  1,
  NULL,
  'Динамика — закон всемирного тяготения'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 3 (part 1, kim=3, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '116979f3-85b7-513e-88a2-9009e93a7f1f'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  3, 1, 3,
  'У основания гладкой наклонной плоскости брусок обладает скоростью, модуль которой равен 2 м/с. Определите массу бруска, если максимальная потенциальная энергия, которую он приобретает при подъёме по плоскости относительно её основания, составляет 0,2 Дж. Сопротивлением воздуха пренебречь.

Ответ дайте в килограммах.',
  NULL,
  '0,1',
  'strict',
  1,
  NULL,
  'Энергия — закон сохранения, наклонная плоскость'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 4 (part 1, kim=4, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '78ac1811-bf03-51da-865f-f7748f8b94de'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  4, 1, 4,
  'Шар плотностью 3 г/см³ и объёмом 250 см³ целиком опущен в керосин. Определите архимедову силу, действующую на шар.

Ответ дайте в ньютонах.',
  NULL,
  '2',
  'strict',
  1,
  NULL,
  'Гидростатика — сила Архимеда'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 5 (part 1, kim=5, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'b3366cb8-43db-5af0-9732-1117f67fc77c'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  5, 1, 5,
  'На рисунке приведены графики зависимости координаты от времени для тел А и В, движущихся вдоль оси Ох. Выберите все верные утверждения о характере движения тел.

1) Скорость тела А в момент времени t = 2 с равна нулю.

2) Интервал времени между моментами прохождения телом В начала координат составляет 4 с.

3) В момент времени t = 3 с расстояние между телами А и В равно 15 м.

4) В момент времени t = 3 с скорость тела В обращается в нуль.

5) Тело А движется равномерно.',
  'storage://mock-exam-variant-tasks/variant2/image8.png',
  '245',
  'multi_choice',
  2,
  NULL,
  'Кинематика — анализ графиков x(t)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 6 (part 1, kim=6, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '57c91fcd-1128-5ab4-8a27-ef7edf78bef0'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  6, 1, 6,
  'Массивный груз, подвешенный к потолку на пружине, совершает вертикальные свободные колебания. Пружина всё время остаётся растянутой. Как ведёт себя потенциальная энергия пружины и кинетическая энергия груза, когда груз движется вверх от положения равновесия?

Для каждой величины определите соответствующий характер изменения:

| Физические величины | Их изменения |
|---|---|
| А) Потенциальная энергия пружины | 1) увеличивается |
| Б) Кинетическая энергия груза | 2) уменьшается |
|  | 3) не изменяется |

Запишите в ответ выбранные цифры для каждой физической величины слитно в порядке А, Б: например 12. Цифры в ответе могут повторяться.',
  NULL,
  '22',
  'ordered',
  2,
  NULL,
  'Колебания — энергия пружинного маятника'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 7 (part 1, kim=7, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'f8488705-1d52-57b0-8ace-9eacac18c65b'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  7, 1, 7,
  'В сосуде содержится разреженный аргон, абсолютная температура которого равна 150 К. Концентрацию аргона уменьшили в 2 раза, при этом его давление увеличилось в 3 раза. Определите абсолютную температуру газа в конечном равновесном состоянии.

Ответ дайте в кельвинах.',
  NULL,
  '900',
  'strict',
  1,
  NULL,
  'МКТ — уравнение состояния (p = nkT)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 8 (part 1, kim=8, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '32b48663-393a-5717-b6b7-82342175b14f'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  8, 1, 8,
  'У идеальной тепловой машины Карно температура холодильника равна 300 К. Какой должна быть температура её нагревателя, чтобы КПД машины был равен 40 %?

Ответ дайте в кельвинах.',
  NULL,
  '500',
  'strict',
  1,
  NULL,
  'Термодинамика — КПД цикла Карно'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 9 (part 1, kim=9, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'ceda3045-1310-59ab-8aab-c1b2cb32e57c'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  9, 1, 9,
  'На рисунке показан график циклического процесса, проведённого с одноатомным идеальным газом, в координатах V – T, где V – объём газа, T – абсолютная температура газа. Количество вещества газа постоянно.

Из приведённого ниже списка выберите все правильные утверждения, характеризующие отражённые на графике процессы.

1) Давление газа в процессе CD постоянно, при этом над газом совершается положительная работа.

2) В процессе DA давление газа увеличивается.

3) В процессе AB газ получает положительное количество теплоты.

4) В состоянии D концентрация атомов газа максимальна.

5) В процессе BC внутренняя энергия газа уменьшается.',
  'storage://mock-exam-variant-tasks/variant2/image9.png',
  '134',
  'multi_choice',
  2,
  NULL,
  'МКТ — циклический процесс V–T'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 10 (part 1, kim=10, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '2cc29e24-28ab-56eb-8327-89389d79ec33'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  10, 1, 10,
  'В цилиндрическом сосуде под поршнем находится газ. Поршень не закреплён и может перемещаться в сосуде без трения (см. рисунок). В сосуд закачивается ещё такое же количество газа при неизменной температуре. Как изменятся в результате этого давление газа и концентрация его молекул?

Для каждой величины определите соответствующий характер изменения:

| Физические величины | Их изменения |
|---|---|
| А) Давление газа | 1) увеличится |
| Б) Концентрация молекул газа | 2) уменьшится |
|  | 3) не изменится |

Запишите в ответ выбранные цифры для каждой физической величины слитно в порядке А, Б: например 12. Цифры в ответе могут повторяться.',
  'storage://mock-exam-variant-tasks/variant2/image10.png',
  '33',
  'ordered',
  2,
  NULL,
  'МКТ — газ под поршнем'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 11 (part 1, kim=11, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'efbb9b5b-2f80-5980-bcaf-80f8e872dbc2'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  11, 1, 11,
  'На фотографии изображена электрическая цепь. Показания вольтметра даны в вольтах, амперметра – в амперах. Чему равно сопротивление неизвестного резистора? Вольтметр и амперметр считать идеальными.

Ответ дайте в омах.',
  'storage://mock-exam-variant-tasks/variant2/image11.jpeg',
  '2',
  'strict',
  1,
  NULL,
  'Электричество — закон Ома, сопротивление'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 12 (part 1, kim=12, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'e2dc4e91-9a67-5211-8217-43895ac47967'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  12, 1, 12,
  'За время Δt = 2 с магнитный поток через площадку, ограниченную проволочной рамкой, равномерно уменьшается от значения 24 мВб до нуля. Определите модуль ЭДС, которая генерируется в рамке.

Ответ дайте в милливольтах.',
  NULL,
  '12',
  'strict',
  1,
  NULL,
  'Электромагнитная индукция — ЭДС'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 13 (part 1, kim=13, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '68086bdf-c80c-5743-adbc-84894c38f1eb'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  13, 1, 13,
  'Точечный источник света находится на расстоянии 1,6 м от плоского зеркала. Насколько увеличится расстояние между источником и его изображением, если, не поворачивая зеркала, отодвинуть его от источника на 0,2 м?

Ответ дайте в метрах.',
  NULL,
  '0,4',
  'strict',
  1,
  NULL,
  'Оптика — плоское зеркало'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 14 (part 1, kim=14, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '777df081-d61c-5f6f-8754-574da6527cee'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  14, 1, 14,
  'Катушка № 1 включена в электрическую цепь, состоящую из источника постоянного напряжения и реостата. Катушка № 2 помещена внутрь катушки № 1, и её обмотка замкнута. Вид схемы электрической цепи с торца катушек представлен на рисунке.

Из приведённого ниже списка выберите все верные утверждения, характеризующие процессы, которые происходят в цепи и катушках при перемещении ползунка реостата влево. ЭДС самоиндукции пренебречь.

1) Модуль вектора индукции магнитного поля, созданного катушкой № 1, увеличивается.

2) В катушке № 2 индукционный ток направлен по часовой стрелке.

3) Сила тока в катушке № 1 уменьшается.

4) Вектор индукции магнитного поля, созданного катушкой № 2 в её центре, направлен от наблюдателя.

5) Модуль магнитного потока, созданного катушкой № 1 и пронизывающего катушку № 2, увеличивается.',
  'storage://mock-exam-variant-tasks/variant2/image12.png',
  '15',
  'multi_choice',
  2,
  NULL,
  'Электромагнетизм — индукция в катушках'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 15 (part 1, kim=15, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '768afa13-de86-56dc-8215-8d6f0c19654f'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  15, 1, 15,
  'На рисунке показана цепь постоянного тока, содержащая источник тока с ЭДС $\mathcal{E}$, два резистора и реостат. Сопротивления резисторов $R_1$ и $R_2$ одинаковы и равны R. Сопротивление реостата $R_3$ можно менять. Как изменятся напряжение на резисторе $R_2$ и суммарная тепловая мощность, выделяемая во внешней цепи, если уменьшить сопротивление реостата от R до 0? Внутренним сопротивлением источника пренебречь.

Для каждой величины определите соответствующий характер изменения:

| Физические величины | Их изменения |
|---|---|
| А) Напряжение на резисторе $R_2$ | 1) увеличится |
| Б) Суммарная тепловая мощность, выделяемая во внешней цепи | 2) уменьшится |
|  | 3) не изменится |

Запишите в ответ выбранные цифры для каждой физической величины слитно в порядке А, Б: например 12. Цифры в ответе могут повторяться.',
  'storage://mock-exam-variant-tasks/variant2/image13.png',
  '21',
  'ordered',
  2,
  NULL,
  'Электричество — цепь с реостатом'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 16 (part 1, kim=16, max_score=1, check_mode=strict) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '0d9f184b-0056-5a95-8d55-6e2f89348ef9'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  16, 1, 16,
  'Сколько электронов содержится в электронной оболочке нейтрального атома изотопа тория $^{234}_{90}\mathrm{Th}$?',
  NULL,
  '90',
  'strict',
  1,
  NULL,
  'Ядерная физика — строение нейтрального атома'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 17 (part 1, kim=17, max_score=2, check_mode=ordered) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '51b2bf88-f80d-51c3-a07d-0673b9782d70'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  17, 1, 17,
  'В лабораторной работе ученик изучает зависимость максимальной кинетической энергии фотоэлектронов, вылетающих с фотокатода, от частоты падающего света. В опытах наблюдается явление фотоэффекта.

Частоту падающего света в опыте немного увеличивают. Как при этом изменяются максимальная кинетическая энергия фотоэлектронов и работа выхода фотоэлектронов из металла фотокатода?

Для каждой величины определите соответствующий характер изменения:

| Физические величины | Их изменения |
|---|---|
| А) Максимальная кинетическая энергия фотоэлектронов | 1) увеличивается |
| Б) Работа выхода фотоэлектронов | 2) уменьшается |
|  | 3) не изменяется |

Запишите в ответ выбранные цифры для каждой физической величины слитно в порядке А, Б: например 12. Цифры в ответе могут повторяться.',
  NULL,
  '13',
  'ordered',
  2,
  NULL,
  'Квантовая физика — фотоэффект'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 18 (part 1, kim=18, max_score=2, check_mode=multi_choice) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '18c66e78-a744-5400-b57f-44881a4f4bfe'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  18, 1, 18,
  'Выберите все верные утверждения о физических явлениях, величинах и закономерностях. Запишите цифры, под которыми они указаны.

1) Модуль сил гравитационного взаимодействия двух тел прямо пропорционален квадрату расстояния между этими телами.

2) Теплопередача путём конвекции происходит за счёт переноса энергии струями и потоками жидкости или газа.

3) Модуль сил взаимодействия двух неподвижных точечных заряженных тел не зависит от свойств среды между ними.

4) Период свободных колебаний в идеальном колебательном контуре увеличивается прямо пропорционально увеличению индуктивности катушки.

5) При α-распаде масса ядра уменьшается примерно на четыре атомные единицы массы.',
  NULL,
  '25',
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
  '810ed823-42a2-54bd-a22c-ed612e9e421b'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  19, 1, 19,
  'Запишите показания барометра с учётом абсолютной погрешности измерений. Верхняя шкала барометра проградуирована в кПа, нижняя – в мм рт. ст. Абсолютная погрешность прямого измерения барометра равна цене деления барометра.

Ответ запишите в виде (значение ± погрешность) в мм рт. ст. В поле ответа перенесите только числа, не разделяя их пробелом или другим знаком.',
  'storage://mock-exam-variant-tasks/variant2/image15.jpeg',
  '7551',
  'pair',
  1,
  NULL,
  'Измерения — барометр с погрешностью'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 20 (part 1, kim=20, max_score=1, check_mode=task20) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '268229d2-5566-59b1-bf1c-125109bb02aa'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  20, 1, 20,
  'Ученику необходимо на опыте обнаружить зависимость электроёмкости плоского конденсатора от площади его пластин. У него имеется пять конденсаторов, характеристики которых приведены в таблице. Какие два конденсатора необходимо взять ученику, чтобы провести этот опыт?

| № конденсатора | Расстояние между пластинами, мм | Площадь пластин, см² | Диэлектрик между пластинами |
|---|---|---|---|
| 1 | 0,5 | 20 | парафин |
| 2 | 0,4 | 30 | слюда |
| 3 | 0,4 | 20 | слюда |
| 4 | 0,6 | 10 | парафин |
| 5 | 0,6 | 10 | слюда |

Запишите в ответе номера выбранных конденсаторов.',
  NULL,
  '23',
  'task20',
  1,
  NULL,
  'Эксперимент — выбор конденсаторов'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 21 (part 2, kim=21, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '8c185248-179d-5e9a-8ce3-6f81b53465a7'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  21, 2, 21,
  'Один моль гелия участвует в циклическом процессе 1–2–3–4–1, график которого изображён на рисунке в координатах p–T, где p – давление газа, T – абсолютная температура. Опираясь на законы молекулярной физики и термодинамики, сравните модуль работы газа в процессах 2–3 и 3–4. Постройте график цикла в координатах p–V, где p – давление газа, V – объём газа.',
  'storage://mock-exam-variant-tasks/variant2/image17.png',
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
  '76eeeede-1fe8-5714-8ac6-8e483b7249c8'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  22, 2, 22,
  'В стакан налита вода, а поверх неё – керосин. Однородный шар плавает, погружённый в обе жидкости. При этом четверть объёма шара находится в воде. Найдите плотность материала шара.',
  'storage://mock-exam-variant-tasks/variant2/image18.png',
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
  'cb0d4ef5-2ac3-5d37-a805-589e92024d5b'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  23, 2, 23,
  'В однородное электрическое поле напряжённостью E = 100 В/м параллельно линиям напряжённости поля влетает протон со скоростью $v_0 = 200$ км/с. Через какое время протон, замедляясь, остановится?',
  NULL,
  NULL,
  'manual',
  2,
  '1. Полная остановка означает, что конечная скорость протона, движущегося против направления линий напряжённости поля, равна нулю ($v = 0$); при равноускоренном движении скорость меняется по формуле $v = v_0 - at$, где a — модуль ускорения торможения под действием силы Кулона, тогда $t = \frac{v_0}{a}$.

2. Модуль силы Кулона $F = qE$. По второму закону Ньютона $F = ma$, где q, m — заряд и масса протона соответственно, откуда $a = \frac{qE}{m}$.

3. В итоге получим:

$t = \frac{m v_0}{qE} = \frac{1{,}673\cdot10^{-27}\cdot 200\cdot10^{3}}{1{,}6\cdot10^{-19}\cdot 100} \approx 2{,}09\cdot10^{-5}$ с $\approx 21$ мкс.

Ответ: $t \approx 21$ мкс.',
  'Электродинамика — движение протона в поле (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 24 (part 2, kim=24, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '7445278f-6516-5f6b-9631-adab035389d9'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  24, 2, 24,
  'В качестве рабочего тела в тепловой машине используется идеальный одноатомный газ, который совершает циклический процесс, состоящий из изобарного нагревания (1→2), изохорного охлаждения (2→3) и адиабатного сжатия (3→1). КПД этой тепловой машины $\eta = 20\%$. Найдите отношение работы $A_{12}$, совершённой газом в изобарном процессе, к работе $A''_{31}$, совершённой над газом при адиабатном сжатии.',
  'storage://mock-exam-variant-tasks/variant2/image20.png',
  NULL,
  'manual',
  3,
  '1. На участке 1–2 (изобара) рабочее тело получает положительное количество теплоты от нагревателя: $Q_{нагр}=Q_{12}=|U_2-U_1|+A_{12}$. На участке 2–3 (изохора) газ отдаёт холодильнику положительное количество теплоты. На участке 3–1 (адиабата) внешние силы сжимают газ, совершая работу $A''_{31}=-A_{31}$.

2. КПД тепловой машины: $\eta = \frac{A}{Q_{нагр}} = \frac{A_{12}-A''_{31}}{Q_{12}}$, где A — работа газа за цикл.

3. Используя формулу для внутренней энергии идеального газа $U=\frac{3}{2}\nu RT=\frac{3}{2}pV$ и формулу для работы газа при изобарном процессе $A_{12}=p_1(V_2-V_1)$, найдём количество теплоты:

$Q_{12}=\frac{3}{2}\nu R(T_2-T_1)+p_1(V_2-V_1)=\frac{3}{2}(p_1V_2-p_1V_1)+p_1(V_2-V_1)=\frac{5}{2}(p_1V_2-p_1V_1)=\frac{5}{2}A_{12}$.

Тогда $A''_{31}=A_{12}-\eta Q_{12}=A_{12}\left(1-\frac{5}{2}\eta\right)$.

4. Объединив п. 1–3, получим:

$\frac{A_{12}}{A''_{31}}=\frac{2}{2-5\eta}=\frac{2}{2-5\cdot0{,}2}=2$.

Ответ: $\frac{A_{12}}{A''_{31}}=2$.',
  'Термодинамика — КПД цикла, отношение работ (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 25 (part 2, kim=25, max_score=3, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  '3d68759d-55ae-5ba2-95fa-3d85d03778e2'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  25, 2, 25,
  'Линза, фокусное расстояние которой 30 см, даёт на экране резкое изображение предмета с пятикратным увеличением. Экран пододвинули к линзе вдоль её главной оптической оси. Затем при неизменном положении линзы передвинули предмет на 3 см так, чтобы изображение снова стало резким. На какое расстояние сдвинули экран относительно его первоначального положения? Сделайте рисунок построения изображений в линзе с указанием хода лучей.',
  NULL,
  NULL,
  'manual',
  3,
  '1. В первом случае для фокусного расстояния и увеличения линзы можно записать: $\frac{1}{F}=\frac{1}{f}+\frac{1}{d}$, $\Gamma=\frac{f}{d}$, где d — расстояние от предмета до линзы, f — расстояние от линзы до изображения, $\Gamma$ — увеличение линзы (рис. a). Следовательно,

$d=\frac{F(\Gamma+1)}{\Gamma}=\frac{30\cdot 6}{5}=36$ см, а $f=\Gamma d=180$ см.

2. После того как экран и предмет передвинули, для нового положения предмета и изображения можно записать: $\frac{1}{F}=\frac{1}{d_1}+\frac{1}{f_1}$, $d_1=d+\Delta d=36+3=39$ см, $f_1=f-x$, где x — расстояние, на которое экран пододвинули к линзе (рис. б).

3. Тогда

$x=f-\frac{F d_1}{d_1-F}=180-\frac{30\cdot 39}{39-30}=180-130=50$ см.

Ответ: экран пододвинули на 50 см.',
  'Оптика — линза, увеличение, сдвиг экрана (расчёт)'
) ON CONFLICT (id) DO NOTHING;

-- --- Задание 26 (part 2, kim=26, max_score=4, check_mode=manual) ---
INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num,
  task_text, task_image_url, correct_answer, check_mode, max_score,
  solution_text, topic
) VALUES (
  'ce831cdb-fe13-5695-b129-6c98ad72f4d4'::uuid,
  'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
  26, 2, 26,
  'Снаряд, выпущенный из пушки с начальной скоростью $v_0 = 200$ м/с под углом α = 60° к горизонту, разрывается в верхней точке своей траектории на два осколка. Масса первого осколка $m_1 = 1{,}5$ кг. Его скорость $v_1$ сразу после взрыва направлена горизонтально в сторону первоначального полёта снаряда и равна 200 м/с. На каком расстоянии $s_2$ от точки на земле под местом взрыва упал на землю второй осколок, если его масса $m_2 = 1$ кг? Траектории снаряда и осколков лежат в одной вертикальной плоскости. Сопротивлением воздуха пренебречь. Обоснуйте применимость законов, используемых для решения задачи.',
  NULL,
  NULL,
  'manual',
  4,
  'Обоснование

1. Рассмотрим задачу в инерциальной системе отсчёта «Стрельбище».

2. Будем считать снаряд и осколки $m_1$ и $m_2$ материальными точками, так как их размеры много меньше максимальной высоты подъёма и дальности полёта.

3. Закон сохранения импульса в векторном виде можно применить к описанию разрыва снаряда на осколки, поскольку сопротивлением воздуха пренебрегаем, а изменение импульса системы тел «снаряд + осколки» под действием внешней силы тяжести за короткое время взрыва мало по сравнению с импульсом снаряда.

4. После взрыва осколки движутся равноускоренно под действием силы тяжести с вертикально направленным ускорением g.

Решение

1. При разрыве снаряда справедлив закон сохранения импульса; в проекции на горизонтальную ось OX:

$Mv = m_1 v_1 - m_2 v_2$,   (1)

где $v_1$ и $v_2$ — модули скоростей осколков непосредственно после взрыва, $M=m_1+m_2$ — масса неразорвавшегося снаряда.

2. Разрыв происходит в верхней точке траектории, где скорость снаряда горизонтальна: $v = v_0\cos\alpha$.   (2)

3. Из формул кинематики высота разрыва: из условия $0=v_0\sin\alpha-gt_1$ и $h=v_0 t_1\sin\alpha-\frac{g t_1^2}{2}$ получаем $h=\frac{v_0^2\sin^2\alpha}{2g}$.   (3)–(5)

4. В точке падения второго осколка $h=\frac{g t^2}{2}$ и $s_2=v_2 t$.   (6)–(7)

5. Решая систему уравнений (1), (2), (5)–(7), получим:

$s_2=\frac{\big(m_1 v_1-(m_1+m_2)v_0\cos\alpha\big)v_0\sin\alpha}{m_2 g}=\frac{\big(1{,}5\cdot200-(1+1{,}5)\cdot200\cdot\frac{1}{2}\big)\cdot200\cdot\frac{\sqrt{3}}{2}}{1\cdot10}\approx 870$ м.

Ответ: $s_2 \approx 870$ м.',
  'Механика — разрыв снаряда, сохранение импульса (расчёт)'
) ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Validation:
-- SELECT COUNT(*) FROM public.mock_exam_variant_tasks WHERE variant_id = 'b3d8a2f2-c831-5b85-976f-fe50ba64d393';
-- Expected: 26
-- SELECT kim_number, part, check_mode, max_score, correct_answer FROM public.mock_exam_variant_tasks WHERE variant_id = 'b3d8a2f2-c831-5b85-976f-fe50ba64d393' ORDER BY kim_number;

-- variant_pdf_url: храним ПРЯМОЙ supabase.co host (mock-exam-student-api
-- оборачивает в rewriteToProxy при отдаче клиенту, mirror Варианта 1).
UPDATE public.mock_exam_variants
SET variant_pdf_url = 'https://vrsseotrfmsxpbciyqzc.supabase.co/storage/v1/object/public/mock-exam-variant-pdfs/variant2-tasks.pdf'
WHERE id = 'b3d8a2f2-c831-5b85-976f-fe50ba64d393';
