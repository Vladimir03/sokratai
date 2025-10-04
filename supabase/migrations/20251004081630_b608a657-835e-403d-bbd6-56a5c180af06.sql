-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  streak INTEGER DEFAULT 0,
  last_activity TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Create problems table
CREATE TABLE public.problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  problem_number INTEGER NOT NULL CHECK (problem_number BETWEEN 1 AND 19),
  answer TEXT,
  explanation TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for problems
ALTER TABLE public.problems ENABLE ROW LEVEL SECURITY;

-- Anyone can read problems
CREATE POLICY "Anyone can view problems"
  ON public.problems FOR SELECT
  USING (true);

-- Create user_solutions table
CREATE TABLE public.user_solutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES public.problems(id) ON DELETE CASCADE,
  is_correct BOOLEAN NOT NULL,
  user_answer TEXT,
  solved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, problem_id)
);

-- Enable RLS
ALTER TABLE public.user_solutions ENABLE ROW LEVEL SECURITY;

-- User solutions policies
CREATE POLICY "Users can view their own solutions"
  ON public.user_solutions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own solutions"
  ON public.user_solutions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own solutions"
  ON public.user_solutions FOR UPDATE
  USING (auth.uid() = user_id);

-- Create chat_messages table
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Chat messages policies
CREATE POLICY "Users can view their own messages"
  ON public.chat_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own messages"
  ON public.chat_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Insert sample problems
INSERT INTO public.problems (title, description, category, difficulty, problem_number, answer, explanation) VALUES
  ('Простейшее уравнение', 'Решите уравнение: $2x + 5 = 13$', 'Алгебра', 'easy', 1, '4', 'Вычтем 5 из обеих частей: $2x = 8$, затем разделим на 2: $x = 4$'),
  ('Квадратное уравнение', 'Решите уравнение: $x^2 - 5x + 6 = 0$', 'Алгебра', 'medium', 5, '2; 3', 'Используем теорему Виета или формулу корней: $x_1 = 2$, $x_2 = 3$'),
  ('Площадь треугольника', 'Найдите площадь треугольника со сторонами 3, 4 и 5', 'Геометрия', 'easy', 3, '6', 'Это прямоугольный треугольник, $S = \\frac{1}{2} \\cdot 3 \\cdot 4 = 6$'),
  ('Логарифмическое уравнение', 'Решите уравнение: $\\log_2(x) = 3$', 'Алгебра', 'medium', 7, '8', 'По определению логарифма: $x = 2^3 = 8$'),
  ('Тригонометрия', 'Найдите $\\sin(30°)$', 'Тригонометрия', 'easy', 2, '0.5', '$\\sin(30°) = \\frac{1}{2} = 0.5$');

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;

-- Trigger for new user
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();