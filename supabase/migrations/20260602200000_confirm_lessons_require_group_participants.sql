-- =============================================================================
-- schedule-bulk-complete — review fix #1 (defense-in-depth)
--
-- Раньше group-занятие без явных participants в payload (гонка: подтвердили до
-- загрузки участников на клиенте) проваливалось в complete и создавало оплаты из
-- СОХРАНЁННЫХ tutor_lesson_participants.payment_amount — без шанса снять no-show
-- (переплата). Frontend теперь блокирует CTA до загрузки; здесь — серверный бэкстоп:
-- group-item без непустого массива participants → skip('no_participants'), НЕ complete.
--
-- Individual-путь и `complete_lesson_and_create_payment` (+ 3-кнопочный flow) не меняются.
-- CREATE OR REPLACE (после 20260602150000 / 20260602191806).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tutor_confirm_lessons(p_lessons jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _item jsonb;
  _lesson_id uuid;
  _amount integer;
  _participant jsonb;
  _is_group boolean;
  _eligible boolean;
  _results jsonb := '[]'::jsonb;
  _confirmed int := 0;
  _skipped int := 0;
BEGIN
  IF p_lessons IS NULL OR jsonb_typeof(p_lessons) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD';
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(p_lessons)
  LOOP
    BEGIN
      _lesson_id := (_item->>'lesson_id')::uuid;

      SELECT true INTO _eligible
      FROM public.tutor_lessons l
      JOIN public.tutors t ON t.id = l.tutor_id
      WHERE l.id = _lesson_id
        AND t.user_id = auth.uid()
        AND l.status = 'booked'
        AND l.lesson_type = 'regular';

      IF _eligible IS NOT TRUE THEN
        _results := _results || jsonb_build_object('lesson_id', _lesson_id, 'status', 'skipped', 'reason', 'not_eligible');
        _skipped := _skipped + 1;
        CONTINUE;
      END IF;

      _is_group := EXISTS (SELECT 1 FROM public.tutor_lesson_participants WHERE lesson_id = _lesson_id);

      IF _is_group THEN
        -- review fix #1: групповое занятие подтверждаем ТОЛЬКО с явным непустым
        -- participants[] (клиент проверил посещаемость/суммы). Иначе skip — НЕ создаём
        -- оплаты из сохранённых сумм вслепую.
        IF NOT ((_item ? 'participants')
                AND jsonb_typeof(_item->'participants') = 'array'
                AND jsonb_array_length(_item->'participants') > 0) THEN
          _results := _results || jsonb_build_object('lesson_id', _lesson_id, 'status', 'skipped', 'reason', 'no_participants');
          _skipped := _skipped + 1;
          CONTINUE;
        END IF;

        FOR _participant IN SELECT * FROM jsonb_array_elements(_item->'participants')
        LOOP
          UPDATE public.tutor_lesson_participants
          SET payment_amount = GREATEST(0, COALESCE((_participant->>'amount')::integer, 0))
          WHERE lesson_id = _lesson_id
            AND tutor_student_id = (_participant->>'tutor_student_id')::uuid;
        END LOOP;
        PERFORM public.complete_lesson_and_create_payment(_lesson_id, 0, 'pending');
      ELSE
        _amount := GREATEST(0, COALESCE((_item->>'amount')::integer, 0));
        PERFORM public.complete_lesson_and_create_payment(_lesson_id, _amount, 'pending');
      END IF;

      _results := _results || jsonb_build_object('lesson_id', _lesson_id, 'status', 'ok');
      _confirmed := _confirmed + 1;
    EXCEPTION WHEN OTHERS THEN
      _results := _results || jsonb_build_object('lesson_id', _lesson_id, 'status', 'error', 'reason', SQLERRM);
      _skipped := _skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('confirmed', _confirmed, 'skipped', _skipped, 'results', _results);
END;
$$;

REVOKE ALL ON FUNCTION public.tutor_confirm_lessons(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutor_confirm_lessons(jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
