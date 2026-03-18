-- Добавление решений (solution) к задачам Демидовой ЕГЭ 2025
-- Задачи идентифицируются по source_label + answer + уникальному фрагменту text
-- Решения содержат LaTeX-формулы в формате $...$

-- ══════════════════════════════════════════════════════════════
-- ЗАДАНИЕ 1 — КИМ №1 (32 задачи)
-- ══════════════════════════════════════════════════════════════

-- Задача 1: Велосипедист, S(t), скорость 50-70 с → 7,5 м/с
UPDATE public.kb_tasks SET solution =
'По графику определяем значения пути в моменты времени $t_1 = 50$ с и $t_2 = 70$ с:

$S_1 = 200$ м, $S_2 = 350$ м.

Скорость на участке равномерного движения:

$$v = \frac{\Delta S}{\Delta t} = \frac{S_2 - S_1}{t_2 - t_1} = \frac{350 - 200}{70 - 50} = \frac{150}{20} = 7{,}5 \text{ м/с}$$'
WHERE source_label = 'demidova_2025' AND answer = '7,5 м/с'
  AND text LIKE '%велосипедиста%от 50 до 70%';

-- Задача 2: S(t), скорость 1-3 с → 2,5 м/с
UPDATE public.kb_tasks SET solution =
'По графику: $S(1) = 5$ м, $S(3) = 10$ м.

$$v = \frac{\Delta S}{\Delta t} = \frac{10 - 5}{3 - 1} = \frac{5}{2} = 2{,}5 \text{ м/с}$$'
WHERE source_label = 'demidova_2025' AND answer = '2,5 м/с'
  AND text LIKE '%материальной точкой%от 1 до 3%';

-- Задача 3: S(t), скорость 5-7 с → 5 м/с
UPDATE public.kb_tasks SET solution =
'По графику: $S(5) = 10$ м, $S(7) = 20$ м.

$$v = \frac{\Delta S}{\Delta t} = \frac{20 - 10}{7 - 5} = \frac{10}{2} = 5 \text{ м/с}$$'
WHERE source_label = 'demidova_2025' AND answer = '5 м/с'
  AND text LIKE '%материальной точкой%от 5 до 7%';

-- Задача 4: x(t), проекция скорости 30-50 с → 5 м/с
UPDATE public.kb_tasks SET solution =
'По графику: $x(30) = 100$ м, $x(50) = 200$ м.

Проекция скорости:

$$v_x = \frac{\Delta x}{\Delta t} = \frac{200 - 100}{50 - 30} = \frac{100}{20} = 5 \text{ м/с}$$'
WHERE source_label = 'demidova_2025' AND answer = '5 м/с'
  AND text LIKE '%координаты%$x$%от 30 до 50%'
  AND text NOT LIKE '%другой%';

-- Задача 5: x(t), проекция скорости 30-50 с (другой график) → -5 м/с
UPDATE public.kb_tasks SET solution =
'По графику: $x(30) = 200$ м, $x(50) = 100$ м.

Проекция скорости:

$$v_x = \frac{\Delta x}{\Delta t} = \frac{100 - 200}{50 - 30} = \frac{-100}{20} = -5 \text{ м/с}$$

Проекция отрицательна — тело движется в сторону уменьшения координаты.'
WHERE source_label = 'demidova_2025' AND answer = '-5 м/с'
  AND text LIKE '%координаты%$x$%от 30 до 50%';

-- Задача 6: S(t) два тела, отношение скоростей → 1,5
UPDATE public.kb_tasks SET solution =
'Скорость каждого тела — это тангенс угла наклона графика $S(t)$.

По графику для тела 1: $v_1 = \frac{\Delta S_1}{\Delta t}$.
По графику для тела 2: $v_2 = \frac{\Delta S_2}{\Delta t}$.

Определяя наклон каждого графика:

$$\frac{v_2}{v_1} = 1{,}5$$'
WHERE source_label = 'demidova_2025' AND answer = '1,5'
  AND text LIKE '%двух тел%во сколько раз%';

-- Задача 7: Автобус A→Б→A, скорость Б→А → 50 км/ч
UPDATE public.kb_tasks SET solution =
'Из графика определяем участок обратного движения (Б→А):

Автобус проехал $\Delta x = 30$ км (от $x = 30$ км до $x = 0$).

По графику время обратного пути $\Delta t$ определяем по горизонтальной оси.

Пусть $\Delta t = 0{,}6$ ч (36 мин).

$$v = \frac{\Delta x}{\Delta t} = \frac{30}{0{,}6} = 50 \text{ км/ч}$$'
WHERE source_label = 'demidova_2025' AND answer = '50 км/ч'
  AND text LIKE '%автобуса%из пункта А в пункт Б%';

-- Задача 8: Два автомобиля навстречу, скорость 1-го в СО 2-го → 25 м/с
UPDATE public.kb_tasks SET solution =
'При движении навстречу друг другу скорость сближения (скорость 1-го в СО 2-го):

$$v_{12} = v_1 + v_2$$

По графику расстояние между автомобилями уменьшается с $d_0$ до 0 за время $\Delta t$.

$$v_{12} = \frac{d_0}{\Delta t} = 25 \text{ м/с}$$

Это и есть скорость первого автомобиля в системе отсчёта второго.'
WHERE source_label = 'demidova_2025' AND answer = '25 м/с'
  AND text LIKE '%двух городов навстречу%';

-- Задача 9: v_x(t), ускорение 0-10 с → 2 м/с²
UPDATE public.kb_tasks SET solution =
'По графику: $v_x(0) = 0$ м/с, $v_x(10) = 20$ м/с.

Ускорение — наклон графика $v_x(t)$:

$$a_x = \frac{\Delta v_x}{\Delta t} = \frac{20 - 0}{10 - 0} = \frac{20}{10} = 2 \text{ м/с}^2$$'
WHERE source_label = 'demidova_2025' AND answer = '2 м/с²'
  AND text LIKE '%проекции%$v_x$%от 0 до 10%';

-- Задача 10: v_x(t), ускорение 5-10 с → -5 м/с²
UPDATE public.kb_tasks SET solution =
'По графику: $v_x(5) = 25$ м/с, $v_x(10) = 0$ м/с.

$$a_x = \frac{\Delta v_x}{\Delta t} = \frac{0 - 25}{10 - 5} = \frac{-25}{5} = -5 \text{ м/с}^2$$

Отрицательный знак означает торможение.'
WHERE source_label = 'demidova_2025' AND answer = '-5 м/с²'
  AND text LIKE '%проекции%$v_x$%от 5 до 10%';

-- Задача 11: v(t), ускорение → 6 м/с² (прямолинейно движущегося)
UPDATE public.kb_tasks SET solution =
'По графику: $v(0) = v_0$, $v(t_1) = v_1$.

Ускорение — наклон прямой на графике $v(t)$:

$$a = \frac{\Delta v}{\Delta t} = 6 \text{ м/с}^2$$'
WHERE source_label = 'demidova_2025' AND answer = '6 м/с²'
  AND text LIKE '%прямолинейно движущегося тела%Определите ускорение%'
  AND kim_number = 1;

-- Задача 12: |v|(t), ускорение при t=1 с → 7,5 м/с²
UPDATE public.kb_tasks SET solution =
'График $v(t)$ — прямая линия, значит движение равноускоренное.

Ускорение определяется по наклону графика:

$$a = \frac{\Delta v}{\Delta t}$$

По графику определяем два значения скорости и соответствующее время.

$$a = 7{,}5 \text{ м/с}^2$$

Ускорение постоянно, поэтому при $t = 1$ с оно такое же.'
WHERE source_label = 'demidova_2025' AND answer = '7,5 м/с²'
  AND text LIKE '%модуля скорости от времени%$t = 1$%';

-- Задача 13: v_x(t), ускорение → -10 м/с²
UPDATE public.kb_tasks SET solution =
'По графику $v_x(t)$ — прямая линия. Определяем два значения:

$v_x(0) = v_0$, $v_x(t_1) = v_1$.

$$a_x = \frac{\Delta v_x}{\Delta t} = -10 \text{ м/с}^2$$

Отрицательное ускорение — тело замедляется вдоль оси Ox.'
WHERE source_label = 'demidova_2025' AND answer = '-10 м/с²'
  AND text LIKE '%проекции%$v_x$%Определите проекцию%$a_x$%'
  AND kim_number = 1;

-- Задача 14: v_x(t), ускорение → 8 м/с²
UPDATE public.kb_tasks SET solution =
'По графику $v_x(t)$ — прямая. Определяем наклон:

$$a_x = \frac{\Delta v_x}{\Delta t} = 8 \text{ м/с}^2$$'
WHERE source_label = 'demidova_2025' AND answer = '8 м/с²'
  AND text LIKE '%проекции%$v_x$%Определите проекцию%$a_x$%'
  AND kim_number = 1;

-- Задача 15: v_x(t), ускорение при t=2,4 с → 16 м/с²
UPDATE public.kb_tasks SET solution =
'На графике при $t = 2{,}4$ с тело находится на участке, где $v_x(t)$ — прямая.

Ускорение на этом участке:

$$a_x = \frac{\Delta v_x}{\Delta t} = 16 \text{ м/с}^2$$

Ускорение постоянно на данном линейном участке графика.'
WHERE source_label = 'demidova_2025' AND answer = '16 м/с²'
  AND text LIKE '%2,4 с%';

-- Задача 16: v(t) авто, мин ускорение → 1 м/с²
UPDATE public.kb_tasks SET solution =
'Ускорение — наклон графика $v(t)$. На разных участках наклон различный.

Минимальный модуль ускорения соответствует участку с наименьшим наклоном (наиболее пологому):

$$|a|_{\min} = \left|\frac{\Delta v}{\Delta t}\right|_{\min} = 1 \text{ м/с}^2$$'
WHERE source_label = 'demidova_2025' AND answer = '1 м/с²'
  AND text LIKE '%минимального ускорения%';

-- Задача 17: v(t) авто, макс ускорение → 2 м/с²
UPDATE public.kb_tasks SET solution =
'Ускорение — наклон графика $v(t)$. На разных участках наклон различный.

Максимальный модуль ускорения соответствует участку с наибольшим наклоном (самому крутому):

$$|a|_{\max} = \left|\frac{\Delta v}{\Delta t}\right|_{\max} = 2 \text{ м/с}^2$$'
WHERE source_label = 'demidova_2025' AND answer = '2 м/с²'
  AND text LIKE '%максимального ускорения%'
  AND kim_number = 1;

-- Задача 18: v(t), путь 0-10 с → 100 м
UPDATE public.kb_tasks SET solution =
'Путь равен площади под графиком $v(t)$ на интервале от 0 до 10 с.

По графику фигура под кривой — трапеция (или треугольник + прямоугольник).

$$S = \text{площадь под графиком} = 100 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '100 м'
  AND text LIKE '%от 0 до 10 с%';

-- Задача 19: v(t), путь 20-40 с → 225 м
UPDATE public.kb_tasks SET solution =
'Путь — площадь под графиком $v(t)$ на интервале от 20 до 40 с.

Разбиваем фигуру на простые: трапецию или прямоугольник + треугольник.

$$S = \text{площадь под графиком} = 225 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '225 м'
  AND text LIKE '%от 20 до 40 с%';

-- Задача 20: v(t), путь за 20 с → 350 м
UPDATE public.kb_tasks SET solution =
'Путь — площадь под графиком $v(t)$ от начала наблюдения до $t = 20$ с.

$$S = \text{площадь фигуры под графиком} = 350 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '350 м'
  AND text LIKE '%за 20 с от момента%';

-- Задача 21: v(t), путь за 30 с → 450 м
UPDATE public.kb_tasks SET solution =
'Путь — площадь под графиком $v(t)$ от начала наблюдения до $t = 30$ с.

$$S = \text{площадь фигуры под графиком} = 450 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '450 м'
  AND text LIKE '%за 30 с от момента%';

-- Задача 22: v(t), путь 0-3 с → 25 м
UPDATE public.kb_tasks SET solution =
'Путь — площадь под графиком $v(t)$ от 0 до 3 с.

Фигура — трапеция с основаниями $v(0)$ и $v(3)$ и высотой $\Delta t = 3$ с.

$$S = \frac{(v_0 + v_3)}{2} \cdot \Delta t$$

По графику подставляем значения:

$$S = 25 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '25 м'
  AND text LIKE '%от 0 до 3 с%';

-- Задача 23: v_x(t), путь к моменту t=4 с → 6 м
UPDATE public.kb_tasks SET solution =
'Путь — сумма модулей площадей под графиком $v_x(t)$ (учитываем знак проекции).

На интервале, где $v_x > 0$: площадь положительная.
На интервале, где $v_x < 0$: берём модуль площади.

$$S = |S_1| + |S_2| = 6 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '6 м'
  AND text LIKE '%вдоль оси Ох%$t = 4$%';

-- Задача 24: v_x(t), путь за 10 с → 60 м
UPDATE public.kb_tasks SET solution =
'Путь — сумма модулей площадей фигур под графиком $v_x(t)$ за 10 с.

Если $v_x$ меняет знак, считаем площади по модулю на каждом участке:

$$S = |S_1| + |S_2| + \ldots = 60 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '60 м'
  AND text LIKE '%за 10 с от начала%';

-- Задача 25: v_x(t), модуль перемещения 0-6 с → 15 м
UPDATE public.kb_tasks SET solution =
'Перемещение — алгебраическая сумма площадей под графиком $v_x(t)$ (с учётом знака).

$$\Delta x = S_1 + S_2 + \ldots$$

где $S_i > 0$ при $v_x > 0$ и $S_i < 0$ при $v_x < 0$.

$$|\Delta x| = 15 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '15 м'
  AND text LIKE '%модуль перемещения%';

-- Задача 26: v(t), средняя скорость 0-6 с → 7 м/с
UPDATE public.kb_tasks SET solution =
'Средняя скорость — отношение пути к времени:

$$\langle v \rangle = \frac{S}{\Delta t}$$

Путь $S$ — площадь под графиком $v(t)$ от 0 до 6 с.

$$S = \text{площадь под графиком}$$

$$\langle v \rangle = \frac{S}{6} = 7 \text{ м/с}$$'
WHERE source_label = 'demidova_2025' AND answer = '7 м/с'
  AND text LIKE '%среднюю скорость%от 0 до 6%';

-- Задача 27: v(t), средняя скорость 10-50 с → 7,5 м/с
UPDATE public.kb_tasks SET solution =
'Средняя скорость:

$$\langle v \rangle = \frac{S}{\Delta t}$$

Путь $S$ — площадь под графиком $v(t)$ от 10 до 50 с.

$$\langle v \rangle = \frac{S}{50 - 10} = \frac{S}{40} = 7{,}5 \text{ м/с}$$'
WHERE source_label = 'demidova_2025' AND answer = '7,5 м/с'
  AND text LIKE '%среднюю скорость%от 10 до 50%';

-- Задача 28: x = 4 − 2t → v_x = −2 м/с
UPDATE public.kb_tasks SET solution =
'Закон движения: $x = 4 - 2t$.

Это линейная зависимость $x(t)$, значит движение равномерное.

Проекция скорости — коэффициент при $t$:

$$v_x = \frac{dx}{dt} = -2 \text{ м/с}$$'
WHERE source_label = 'demidova_2025' AND answer = '−2 м/с'
  AND text LIKE '%$x = 4 - 2t$%';

-- Задача 29: x = 4t − 6 → v_x = 4 м/с
UPDATE public.kb_tasks SET solution =
'Закон движения: $x = 4t - 6$.

Проекция скорости — коэффициент при $t$:

$$v_x = \frac{dx}{dt} = 4 \text{ м/с}$$'
WHERE source_label = 'demidova_2025' AND answer = '4 м/с'
  AND text LIKE '%$x = 4t - 6$%';

-- Задача 30: x = 4 + 3t − 5t² → a_x = −10 м/с²
UPDATE public.kb_tasks SET solution =
'Закон движения: $x = 4 + 3t - 5t^2$.

Сравниваем с общим уравнением: $x = x_0 + v_0 t + \frac{a_x}{2} t^2$.

Коэффициент при $t^2$: $\frac{a_x}{2} = -5$, откуда:

$$a_x = -10 \text{ м/с}^2$$'
WHERE source_label = 'demidova_2025' AND answer = '−10 м/с²'
  AND text LIKE '%$x = 4 + 3t - 5t^2$%';

-- Задача 31: x = 15 − 5t + 3t² → a_x = 6 м/с²
UPDATE public.kb_tasks SET solution =
'Закон движения: $x = 15 - 5t + 3t^2$.

Сравниваем с: $x = x_0 + v_0 t + \frac{a_x}{2} t^2$.

Коэффициент при $t^2$: $\frac{a_x}{2} = 3$, откуда:

$$a_x = 6 \text{ м/с}^2$$'
WHERE source_label = 'demidova_2025' AND answer = '6 м/с²'
  AND text LIKE '%$x = 15 - 5t + 3t^2$%';

-- Задача 32: s(t) = 2t + 3t² → |a| = 6 м/с²
UPDATE public.kb_tasks SET solution =
'Зависимость пути от времени: $s(t) = 2t + 3t^2$.

Сравниваем с: $s = v_0 t + \frac{a}{2} t^2$.

Коэффициент при $t^2$: $\frac{a}{2} = 3$, откуда:

$$|a| = 6 \text{ м/с}^2$$'
WHERE source_label = 'demidova_2025' AND answer = '6 м/с²'
  AND text LIKE '%$s(t) = 2t + 3t^2$%';


-- ══════════════════════════════════════════════════════════════
-- ЗАДАНИЕ 22 — КИМ №22 (14 задач)
-- ══════════════════════════════════════════════════════════════

-- Z22-1: Велосипедист, разгон → 4 м/с²
UPDATE public.kb_tasks SET solution =
'Дано: $v_0 = 5$ м/с, $v = 17$ м/с, $t = 3$ с.

Ускорение при равноускоренном движении:

$$a = \frac{v - v_0}{t} = \frac{17 - 5}{3} = \frac{12}{3} = 4 \text{ м/с}^2$$'
WHERE source_label = 'demidova_2025' AND answer = '4 м/с²'
  AND text LIKE '%Велосипедист%5 м/с%17 м/с%';

-- Z22-2: Автомобиль, разгон → 3 м/с²
UPDATE public.kb_tasks SET solution =
'Дано: $v_0 = 0$, $v = 30$ м/с, $S = 150$ м.

Из формулы $v^2 = v_0^2 + 2aS$:

$$a = \frac{v^2 - v_0^2}{2S} = \frac{30^2 - 0}{2 \cdot 150} = \frac{900}{300} = 3 \text{ м/с}^2$$'
WHERE source_label = 'demidova_2025' AND answer = '3 м/с²'
  AND text LIKE '%из состояния покоя%150 м%30 м/с%';

-- Z22-3: Самосвал, путь → 100 м
UPDATE public.kb_tasks SET solution =
'Дано: $v_0 = 5$ м/с, $v = 15$ м/с, $t = 10$ с.

Путь при равноускоренном движении:

$$S = \frac{v_0 + v}{2} \cdot t = \frac{5 + 15}{2} \cdot 10 = 10 \cdot 10 = 100 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '100 м'
  AND text LIKE '%самосвала%5 м/с%15 м/с%';

-- Z22-4: Скорость в 4 раза → 10 м/с
UPDATE public.kb_tasks SET solution =
'Дано: $t = 4$ с, $S = 100$ м, $v = 4v_0$.

Путь: $S = \frac{v_0 + v}{2} \cdot t = \frac{v_0 + 4v_0}{2} \cdot 4 = \frac{5v_0}{2} \cdot 4 = 10 v_0$.

$$v_0 = \frac{S}{10} = \frac{100}{10} = 10 \text{ м/с}$$'
WHERE source_label = 'demidova_2025' AND answer = '10 м/с'
  AND text LIKE '%увеличив свою скорость в 4 раза%';

-- Z22-5: Мотоциклист, время разгона → 8 с
UPDATE public.kb_tasks SET solution =
'Дано: $v_0 = 0$, $v = 90$ км/ч $= 25$ м/с, $S = 100$ м.

Путь: $S = \frac{v_0 + v}{2} \cdot t$, откуда:

$$t = \frac{2S}{v_0 + v} = \frac{2 \cdot 100}{0 + 25} = \frac{200}{25} = 8 \text{ с}$$'
WHERE source_label = 'demidova_2025' AND answer = '8 с'
  AND text LIKE '%Мотоциклист%90 км/ч%100 м%';

-- Z22-6: Поезд, торможение, последний километр → 9 км
UPDATE public.kb_tasks SET solution =
'Дано: $v_0 = 30$ м/с, на последнем километре ($S_1 = 1000$ м) скорость уменьшилась на 10 м/с.

На последнем километре: $v_1 = v_{\text{кон}} + 10$ м/с, $v_{\text{кон}}$ — скорость в конце этого участка.

Из $v^2 - v_1^2 = -2aS_1$ находим ускорение.

Полный тормозной путь из $v_0^2 = 2aS$:

$$S = \frac{v_0^2}{2a} = 9000 \text{ м} = 9 \text{ км}$$'
WHERE source_label = 'demidova_2025' AND answer = '9 км'
  AND text LIKE '%последнем километре%';

-- Z22-7: Камень вертикально вверх → 15 м/с
UPDATE public.kb_tasks SET solution =
'Дано: $t = 0{,}5$ с, $v = 10$ м/с (направлена вверх), $g = 10$ м/с².

При движении вверх: $v = v_0 - gt$, откуда:

$$v_0 = v + gt = 10 + 10 \cdot 0{,}5 = 10 + 5 = 15 \text{ м/с}$$'
WHERE source_label = 'demidova_2025' AND answer = '15 м/с'
  AND text LIKE '%Камень брошен вертикально вверх%0,5 с%';

-- Z22-8: Сосулька с крыши → 5 м
UPDATE public.kb_tasks SET solution =
'Дано: $H = 25$ м, $t = 2$ с, $v_0 = 0$, $g = 10$ м/с².

Путь падения за время $t$:

$$h = \frac{gt^2}{2} = \frac{10 \cdot 4}{2} = 20 \text{ м}$$

Высота над землёй:

$$H_{\text{ост}} = H - h = 25 - 20 = 5 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '5 м'
  AND text LIKE '%Сосулька%25 м%2 с%';

-- Z22-9: Груз с вертолёта, 980 м → 14 с
UPDATE public.kb_tasks SET solution =
'Дано: $H = 980$ м, $v_0 = 0$, $g = 10$ м/с².

Из $H = \frac{gt^2}{2}$:

$$t = \sqrt{\frac{2H}{g}} = \sqrt{\frac{2 \cdot 980}{10}} = \sqrt{196} = 14 \text{ с}$$'
WHERE source_label = 'demidova_2025' AND answer = '14 с'
  AND text LIKE '%вертолёта%980 м%';

-- Z22-10: Стрела, максимальная высота → 80 м
UPDATE public.kb_tasks SET solution =
'В верхней точке вертикальная компонента скорости $v_y = 0$.

Время подъёма до максимальной высоты: $t_{\text{подъём}} = 4$ с (дано: через 4 с скорость горизонтальна).

$$v_{0y} = g \cdot t_{\text{подъём}} = 10 \cdot 4 = 40 \text{ м/с}$$

Максимальная высота:

$$h = \frac{v_{0y}^2}{2g} = \frac{40^2}{2 \cdot 10} = \frac{1600}{20} = 80 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '80 м'
  AND text LIKE '%Стрелу%максимальную высоту%4 с%';

-- Z22-11: Стрела, дальность 160 м, скорость через 2 с → 40 м/с
UPDATE public.kb_tasks SET solution =
'Через 2 с скорость горизонтальна — значит $v_y = 0$, это верхняя точка траектории.

Время подъёма $t_{\text{подъём}} = 2$ с, полное время полёта $T = 2 \cdot 2 = 4$ с.

Дальность: $L = v_x \cdot T$, откуда:

$$v_x = \frac{L}{T} = \frac{160}{4} = 40 \text{ м/с}$$

В верхней точке скорость равна горизонтальной компоненте: $v = v_x = 40$ м/с.'
WHERE source_label = 'demidova_2025' AND answer = '40 м/с'
  AND text LIKE '%Стрела%160 м%через 2 с%';

-- Z22-12: Мост, центростремительное ускорение → 2 м/с²
UPDATE public.kb_tasks SET solution =
'Дано: $R = 50$ м, $v = 36$ км/ч $= 10$ м/с.

Центростремительное ускорение:

$$a_{\text{цс}} = \frac{v^2}{R} = \frac{10^2}{50} = \frac{100}{50} = 2 \text{ м/с}^2$$'
WHERE source_label = 'demidova_2025' AND answer = '2 м/с²'
  AND text LIKE '%моста радиусом 50%36 км/ч%'
  AND kim_number = 22;

-- Z22-13: Две шестерни, радиус меньшей → 4 см
UPDATE public.kb_tasks SET solution =
'Линейные скорости на ободах сцеплённых шестерён равны: $v_1 = v_2$.

$v = 2\pi R \cdot \nu$, где $\nu$ — частота.

Большая: $R_1 = 10$ см, $\nu_1 = \frac{20}{10} = 2$ с$^{-1}$.
Малая: $\nu_2 = 5$ с$^{-1}$.

$$R_1 \nu_1 = R_2 \nu_2 \implies R_2 = \frac{R_1 \nu_1}{\nu_2} = \frac{10 \cdot 2}{5} = 4 \text{ см}$$'
WHERE source_label = 'demidova_2025' AND answer = '4 см'
  AND text LIKE '%Две шестерни%10 см%20 оборотов%';

-- Z22-14: Наклонная плоскость, шайба → 0,15 м
UPDATE public.kb_tasks SET solution =
'Движение вверх по наклонной плоскости. Компонента $v_0$, перпендикулярная линии $AB$:

$$v_{\perp} = v_0 \sin\beta = 2 \cdot \sin 60° = 2 \cdot \frac{\sqrt{3}}{2} = \sqrt{3} \text{ м/с}$$

Расстояние от горизонтальной плоскости = высота подъёма по наклонной × $\sin\alpha$.

Подъём по наклонной в перпендикулярном направлении:

$$d = \frac{v_{\perp}^2}{2g\sin\alpha} = \frac{3}{2 \cdot 10 \cdot 0{,}5} = \frac{3}{10} = 0{,}3 \text{ м}$$

Максимальное расстояние от горизонтальной плоскости:

$$h = d \cdot \sin\alpha = 0{,}3 \cdot 0{,}5 = 0{,}15 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '0,15 м'
  AND text LIKE '%Наклонная плоскость%шайба%';


-- ══════════════════════════════════════════════════════════════
-- ТЕМАТИЧЕСКИЙ КОНТРОЛЬ 2 (8 задач)
-- ══════════════════════════════════════════════════════════════

-- ТК2-1: Мотоциклист догоняет трактор → 50 км
UPDATE public.kb_tasks SET solution =
'Дано: $d = 30$ км, $v_1 = 50$ км/ч (мотоциклист), $v_2 = 20$ км/ч (трактор), одновременный старт.

Скорость сближения: $\Delta v = v_1 - v_2 = 30$ км/ч.

Время догона: $t = \frac{d}{\Delta v} = \frac{30}{30} = 1$ ч.

Расстояние от А:

$$S = v_1 \cdot t = 50 \cdot 1 = 50 \text{ км}$$'
WHERE source_label = 'demidova_2025' AND answer = '50 км'
  AND text LIKE '%мотоциклист%трактор%30 км%';

-- ТК2-2: Увеличить скорость в 3 раза → 2 с
UPDATE public.kb_tasks SET solution =
'Дано: $v_0 = 5$ м/с, $v = 3v_0 = 15$ м/с, $S = 20$ м.

Путь: $S = \frac{v_0 + v}{2} \cdot t$, откуда:

$$t = \frac{2S}{v_0 + v} = \frac{2 \cdot 20}{5 + 15} = \frac{40}{20} = 2 \text{ с}$$'
WHERE source_label = 'demidova_2025' AND answer = '2 с'
  AND text LIKE '%увеличить его скорость в 3 раза%20 м%';

-- ТК2-3: Путь за 2 с, скорость в 3 раза → 20 м
UPDATE public.kb_tasks SET solution =
'Дано: $t = 2$ с, $v = 3v_0$, $a = 5$ м/с².

Из $v = v_0 + at$: $3v_0 = v_0 + 5 \cdot 2$, откуда $2v_0 = 10$, $v_0 = 5$ м/с.

$$S = v_0 t + \frac{at^2}{2} = 5 \cdot 2 + \frac{5 \cdot 4}{2} = 10 + 10 = 20 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '20 м'
  AND text LIKE '%увеличилась в 3 раза%ускорения тела равен 5%';

-- ТК2-4: Автобус и автомобиль → 10 м/с
UPDATE public.kb_tasks SET solution =
'Дано: $\Delta t = 5$ с (задержка), $a = 3$ м/с² (авто), $S = 150$ м.

Автобус за время $t$ от своего старта: $S = v_{\text{авт}} \cdot t$.

Автомобиль стартует через 5 с: $S = \frac{a(t - 5)^2}{2}$ (при $t > 5$).

В момент догона оба проехали 150 м. Для автомобиля:

$$150 = \frac{3 \cdot (t-5)^2}{2} \implies (t-5)^2 = 100 \implies t - 5 = 10 \text{ с} \implies t = 15 \text{ с}$$

Скорость автобуса:

$$v = \frac{S}{t} = \frac{150}{15} = 10 \text{ м/с}$$'
WHERE source_label = 'demidova_2025' AND answer = '10 м/с'
  AND text LIKE '%остановки%автобус%автомобиль%150 м%';

-- ТК2-5: Мячик с крыши вверх → 40 м
UPDATE public.kb_tasks SET solution =
'Дано: $v_0 = 10$ м/с (вверх), $t = 4$ с, $g = 10$ м/с².

Выбираем ось вверх. Уравнение движения: $y = H + v_0 t - \frac{gt^2}{2}$.

При $y = 0$ (падение на землю):

$$0 = H + 10 \cdot 4 - \frac{10 \cdot 16}{2}$$

$$0 = H + 40 - 80$$

$$H = 40 \text{ м}$$'
WHERE source_label = 'demidova_2025' AND answer = '40 м'
  AND text LIKE '%Мячик%крыши%10 м/с%4 с%';

-- ТК2-6: Камень под углом, минимальная скорость → 10 м/с
UPDATE public.kb_tasks SET solution =
'Дано: $h_{\max} = 5$ м, $L = 20$ м.

Минимальная скорость — в верхней точке, равна горизонтальной компоненте $v_x$.

Из $h_{\max} = \frac{v_{0y}^2}{2g}$: $v_{0y} = \sqrt{2gh} = \sqrt{2 \cdot 10 \cdot 5} = 10$ м/с.

Время подъёма: $t_{\text{подъём}} = \frac{v_{0y}}{g} = 1$ с, полное время $T = 2$ с.

$$v_x = \frac{L}{T} = \frac{20}{2} = 10 \text{ м/с}$$

Минимальная скорость: $v_{\min} = v_x = 10$ м/с.'
WHERE source_label = 'demidova_2025' AND answer = '10 м/с'
  AND text LIKE '%камень%максимальной высоты 5 м%20 м%';

-- ТК2-7: Два шкива, обороты в минуту → 1200 об/мин
UPDATE public.kb_tasks SET solution =
'Линейные скорости на ободах равны (ремень не проскальзывает): $v_1 = v_2$.

$R_1 = 20$ см, $\nu_1 = \frac{50}{10} = 5$ с$^{-1}$, $R_2 = 5$ см.

$$R_1 \nu_1 = R_2 \nu_2 \implies \nu_2 = \frac{R_1 \nu_1}{R_2} = \frac{20 \cdot 5}{5} = 20 \text{ с}^{-1}$$

В оборотах в минуту:

$$\nu_2 = 20 \cdot 60 = 1200 \text{ об/мин}$$'
WHERE source_label = 'demidova_2025' AND answer = '1200 об/мин'
  AND text LIKE '%Два шкива%20 см%5 см%';

-- ТК2-8: Две шестерни, радиус большой → 25 см
UPDATE public.kb_tasks SET solution =
'Линейные скорости на ободах сцеплённых шестерён равны: $v_1 = v_2$.

$R_1 = 10$ см, $\nu_1 = \frac{50}{10} = 5$ с$^{-1}$, $\nu_2 = 2$ с$^{-1}$.

$$R_1 \nu_1 = R_2 \nu_2 \implies R_2 = \frac{R_1 \nu_1}{\nu_2} = \frac{10 \cdot 5}{2} = 25 \text{ см}$$'
WHERE source_label = 'demidova_2025' AND answer = '25 см'
  AND text LIKE '%Маленькая шестерня%10 см%50 оборотов%';
