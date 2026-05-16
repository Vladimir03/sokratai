-- TASK-16 + R2 + R3 mock-exams pilot polish: apply 3 pending migrations in timestamp order.

-- ============================================================================
-- Migration 1: 20260516120000_resync_variant_1_kim_25_26_solution_text.sql
-- ============================================================================
BEGIN;

UPDATE public.mock_exam_variant_tasks
SET solution_text = '1. Так как источники находятся с разных сторон от линзы, то для одного из них изображение должно быть действительным, а для другого – мнимым. Сделай два отдельных схематичных рисунка хода лучей.

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

Ответ: L = 1,8 м'
WHERE id = 'e9fd88a9-0969-5419-a9c5-012e506682e2'::uuid;

UPDATE public.mock_exam_variant_tasks
SET solution_text = 'Обоснование

1. Рассмотрим задачу в инерциальной системе отсчёта (ИСО) «Стол».

2. Доска M и брусок m движутся в выбранной ИСО поступательно, поэтому описываем их моделью материальной точки. Тогда к описанию их движения можно применить второй закон Ньютона, справедливый для материальных точек в ИСО.

3. Для сил $\vec F_{\text{тр}1}$ и $\vec F_{\text{тр}2}$ из третьего закона Ньютона следует: $F_{\text{тр}1}=F_{\text{тр}2}$.

4. Так как коэффициент трения между грузом и доской $\mu_1$ минимальный, силы трения $F_{\text{тр}1}$ и $F_{\text{тр}2}$, действующие соответственно на груз и доску, – максимальные силы трения покоя, равные по модулю: $F_{\text{тр}1}=F_{\text{тр}2}=\mu_1N$.

5. Так как брусок покоится относительно доски, то $a_1=a_2=a$.

6. Для сил $N_1$ и P из третьего закона Ньютона следует: $N_1=P$.

Решение

1. На брусок, движущийся вместе с доской с ускорением $\vec a_1$, действуют сила тяжести $m\vec g$, нормальная составляющая силы реакции опоры $\vec N_1$ и сила трения $\vec F_{\text{тр}1}$ (сделай схематичный рисунок с указанием сил, действующих на брусок).

2. На доску, движущуюся по поверхности стола с ускорением $\vec a_2$, действуют сила тяжести $M\vec g$, нормальная составляющая силы реакции опоры $\vec N_2$, силы трения $\vec F_{\text{тр}2}$ и $\vec F_{\text{тр}3}$, а также нормальная составляющая силы со стороны бруска $\vec P$ и сила тяги $\vec F$.

3. Запишем второй закон Ньютона для бруска: $m\vec a_1=\vec F_{\text{тр}1}+m\vec g+\vec N_1$, или в проекциях на оси:

$ma=F_{\text{тр}1}$,   $0=N_1-mg$.

И для доски: $M\vec a_2=\vec F+M\vec g+\vec N_2+\vec F_{\text{тр}2}+\vec F_{\text{тр}3}+\vec P$, или в проекциях на оси:

$Ma=F-F_{\text{тр}2}-F_{\text{тр}3}$,   $0=N_2-Mg-P$.

4. Модули сил трения, действующих на доску со стороны стола и на груз, определяются выражениями:

$F_{\text{тр}1}=\mu_1N_1$,   $F_{\text{тр}3}=\mu_2N_2$.

5. Из формул, учитывая, что $a_1=a_2=a$, по третьему закону Ньютона $F_{\text{тр}1}=F_{\text{тр}2}$, а $N_1=P$, найдём коэффициент трения $\mu_1$:

$\mu_1=\frac{F}{(M+m)g}-\mu_2=\frac{48}{(6+2)\cdot10}-0{,}2=0{,}4$.

Ответ: $\mu_1=0{,}4$'
WHERE id = '6f2508b7-6902-567c-9b0f-2afe0b0ea796'::uuid;

COMMIT;

-- ============================================================================
-- Migration 2: 20260516130000_part1_answers_score_source.sql
-- ============================================================================
BEGIN;

ALTER TABLE public.mock_exam_attempt_part1_answers
  ADD COLUMN IF NOT EXISTS score_source TEXT NOT NULL DEFAULT 'ocr'
  CHECK (score_source IN ('ocr', 'tutor', 'finalize_default', 'student_form'));

UPDATE public.mock_exam_attempt_part1_answers
SET score_source = 'tutor'
WHERE score_source = 'ocr';

COMMENT ON COLUMN public.mock_exam_attempt_part1_answers.score_source IS
  'Source of earned_score value. ocr = runPart1OCR; tutor = handlePart1ManualScore; finalize_default = handlePart1Finalize INSERT-on-missing; student_form = form-mode auto-check on submit. Используется в runPart1OCR для skip-condition: только score_source=tutor preserved при retry.';

COMMIT;

-- ============================================================================
-- Migration 3: 20260516140000_part1_answers_rls_hardening.sql
-- ============================================================================
BEGIN;

DROP POLICY IF EXISTS "Mock part1 student insert own in progress"
  ON public.mock_exam_attempt_part1_answers;

CREATE POLICY "Mock part1 student insert own in progress"
  ON public.mock_exam_attempt_part1_answers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
    AND earned_score IS NULL
    AND score_source = 'student_form'
  );

DROP POLICY IF EXISTS "Mock part1 student update own in progress"
  ON public.mock_exam_attempt_part1_answers;

CREATE POLICY "Mock part1 student update own in progress"
  ON public.mock_exam_attempt_part1_answers
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.mock_exam_attempts a
      WHERE a.id = mock_exam_attempt_part1_answers.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'in_progress'
    )
    AND earned_score IS NULL
    AND score_source = 'student_form'
  );

COMMIT;