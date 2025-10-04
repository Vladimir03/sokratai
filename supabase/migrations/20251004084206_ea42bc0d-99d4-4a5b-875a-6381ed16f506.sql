-- Update problems table structure
ALTER TABLE public.problems RENAME COLUMN category TO topic;
ALTER TABLE public.problems RENAME COLUMN difficulty TO level;
ALTER TABLE public.problems RENAME COLUMN description TO question;
ALTER TABLE public.problems RENAME COLUMN explanation TO solution;

-- Drop unnecessary columns
ALTER TABLE public.problems DROP COLUMN IF EXISTS title;
ALTER TABLE public.problems DROP COLUMN IF EXISTS problem_number;

-- Update check constraint
ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_difficulty_check;
ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_problem_number_check;
ALTER TABLE public.problems ADD CONSTRAINT problems_level_check CHECK (level IN ('easy', 'medium', 'hard'));

-- Insert sample problems
INSERT INTO public.problems (topic, level, question, answer, solution) VALUES
-- Алгебра (Easy)
('Алгебра', 'easy', 'Решите уравнение: $2x + 5 = 13$', '4', '1) $2x = 13 - 5$\n2) $2x = 8$\n3) $x = 4$'),
('Алгебра', 'easy', 'Найдите значение выражения: $(3 + 5) \cdot 2$', '16', '1) Сначала скобки: $3 + 5 = 8$\n2) Умножение: $8 \cdot 2 = 16$'),
('Алгебра', 'easy', 'Решите уравнение: $x - 7 = 15$', '22', '1) $x = 15 + 7$\n2) $x = 22$'),
('Алгебра', 'easy', 'Упростите выражение: $5x + 3x$', '8x', '1) Приводим подобные слагаемые\n2) $5x + 3x = 8x$'),
('Алгебра', 'easy', 'Найдите $x$: $\frac{x}{3} = 6$', '18', '1) Умножаем обе части на 3\n2) $x = 6 \cdot 3 = 18$'),

-- Алгебра (Medium)
('Алгебра', 'medium', 'Решите уравнение: $x^2 - 5x + 6 = 0$', '2; 3', '1) Разложим на множители: $(x-2)(x-3) = 0$\n2) $x - 2 = 0$ или $x - 3 = 0$\n3) $x_1 = 2$, $x_2 = 3$'),
('Алгебра', 'medium', 'Упростите: $\frac{x^2 - 9}{x - 3}$ при $x \neq 3$', 'x + 3', '1) Разность квадратов: $x^2 - 9 = (x-3)(x+3)$\n2) $\frac{(x-3)(x+3)}{x-3} = x + 3$'),
('Алгебра', 'medium', 'Решите систему: $\begin{cases} x + y = 5 \\ x - y = 1 \end{cases}$', 'x=3, y=2', '1) Сложим уравнения: $2x = 6$, $x = 3$\n2) Подставим: $3 + y = 5$, $y = 2$'),
('Алгебра', 'medium', 'Найдите корни: $2x^2 + 3x - 2 = 0$', 'x=0.5; x=-2', '1) По формуле: $D = 9 + 16 = 25$\n2) $x = \frac{-3 \pm 5}{4}$\n3) $x_1 = 0.5$, $x_2 = -2$'),

-- Алгебра (Hard)
('Алгебра', 'hard', 'Решите неравенство: $\frac{x+1}{x-2} > 0$', '(-∞;-1)∪(2;+∞)', '1) Нули числителя: $x = -1$\n2) Нули знаменателя: $x = 2$\n3) Методом интервалов: $x \in (-\infty; -1) \cup (2; +\infty)$'),
('Алгебра', 'hard', 'Найдите все значения $a$, при которых уравнение $x^2 + ax + 4 = 0$ имеет два различных корня', 'a<-4 или a>4', '1) Условие: $D > 0$\n2) $a^2 - 16 > 0$\n3) $(a-4)(a+4) > 0$\n4) $a \in (-\infty; -4) \cup (4; +\infty)$'),

-- Тригонометрия (Easy)
('Тригонометрия', 'easy', 'Найдите $\sin 30°$', '0.5', '1) Табличное значение\n2) $\sin 30° = \frac{1}{2} = 0.5$'),
('Тригонометрия', 'easy', 'Найдите $\cos 0°$', '1', '1) Табличное значение\n2) $\cos 0° = 1$'),
('Тригонометрия', 'easy', 'Вычислите: $\sin^2 30° + \cos^2 30°$', '1', '1) Основное тригонометрическое тождество\n2) $\sin^2 \alpha + \cos^2 \alpha = 1$ для любого $\alpha$'),

-- Тригонометрия (Medium)
('Тригонометрия', 'medium', 'Решите уравнение: $\sin x = \frac{1}{2}$', 'π/6+2πn; 5π/6+2πn', '1) $x = (-1)^n \arcsin \frac{1}{2} + \pi n$, $n \in \mathbb{Z}$\n2) $x = \frac{\pi}{6} + 2\pi n$ или $x = \frac{5\pi}{6} + 2\pi n$'),
('Тригонометрия', 'medium', 'Упростите: $\frac{\sin 2x}{2\sin x}$', 'cos x', '1) Формула двойного угла: $\sin 2x = 2\sin x \cos x$\n2) $\frac{2\sin x \cos x}{2\sin x} = \cos x$'),
('Тригонометрия', 'medium', 'Найдите $\tan 45°$', '1', '1) Табличное значение\n2) $\tan 45° = \frac{\sin 45°}{\cos 45°} = \frac{\frac{\sqrt{2}}{2}}{\frac{\sqrt{2}}{2}} = 1$'),

-- Тригонометрия (Hard)
('Тригонометрия', 'hard', 'Решите уравнение: $2\sin^2 x - 3\sin x + 1 = 0$', 'π/6+2πn; 5π/6+2πn; π/2+2πn', '1) Замена $t = \sin x$: $2t^2 - 3t + 1 = 0$\n2) $t_1 = 1$, $t_2 = \frac{1}{2}$\n3) $x = \frac{\pi}{2} + 2\pi n$ или $x = \frac{\pi}{6} + 2\pi n$ или $x = \frac{5\pi}{6} + 2\pi n$'),

-- Геометрия (Easy)
('Геометрия', 'easy', 'Найдите площадь прямоугольника со сторонами 5 и 8', '40', '1) Формула площади: $S = a \cdot b$\n2) $S = 5 \cdot 8 = 40$'),
('Геометрия', 'easy', 'Периметр квадрата равен 20. Найдите его сторону', '5', '1) Формула периметра: $P = 4a$\n2) $20 = 4a$\n3) $a = 5$'),
('Геометрия', 'easy', 'Найдите площадь треугольника с основанием 6 и высотой 4', '12', '1) Формула: $S = \frac{1}{2} \cdot a \cdot h$\n2) $S = \frac{1}{2} \cdot 6 \cdot 4 = 12$'),

-- Геометрия (Medium)
('Геометрия', 'medium', 'В прямоугольном треугольнике катеты равны 3 и 4. Найдите гипотенузу', '5', '1) Теорема Пифагора: $c^2 = a^2 + b^2$\n2) $c^2 = 9 + 16 = 25$\n3) $c = 5$'),
('Геометрия', 'medium', 'Найдите площадь круга радиусом 3', '9π', '1) Формула: $S = \pi r^2$\n2) $S = \pi \cdot 3^2 = 9\pi$'),
('Геометрия', 'medium', 'Диагональ квадрата равна $4\sqrt{2}$. Найдите его сторону', '4', '1) Формула диагонали: $d = a\sqrt{2}$\n2) $4\sqrt{2} = a\sqrt{2}$\n3) $a = 4$'),

-- Геометрия (Hard)
('Геометрия', 'hard', 'В треугольнике ABC угол C = 90°, $\sin A = 0.6$. Найдите $\cos B$', '0.6', '1) В прямоугольном треугольнике $A + B = 90°$\n2) $\cos B = \cos(90° - A) = \sin A$\n3) $\cos B = 0.6$'),
('Геометрия', 'hard', 'Найдите объем цилиндра с радиусом основания 2 и высотой 5', '20π', '1) Формула: $V = \pi r^2 h$\n2) $V = \pi \cdot 2^2 \cdot 5$\n3) $V = 20\pi$');