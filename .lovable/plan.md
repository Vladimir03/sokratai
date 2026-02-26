

## Root Cause

The `get_tutor_pending_payments_by_telegram` RPC function has a **type mismatch bug**. It declares `amount INTEGER` in its return signature, but `tutor_payments.amount` is actually `NUMERIC`. This causes a Postgres error at runtime:

```
structure of query does not match function result type
Returned type numeric does not match expected type integer in column 4
```

The bot catches this error silently and returns an empty array, showing "Нет должников".

## Fix

One database migration to recreate the function with `amount NUMERIC` instead of `amount INTEGER`:

```sql
CREATE OR REPLACE FUNCTION public.get_tutor_pending_payments_by_telegram(
  _telegram_id TEXT
)
RETURNS TABLE (
  payment_id        UUID,
  tutor_student_id  UUID,
  student_name      TEXT,
  amount            NUMERIC,   -- was INTEGER, must match tutor_payments.amount
  period            TEXT,
  due_date          DATE
)
...
```

No frontend changes needed. No edge function redeployment needed -- the fix is purely in the database function.

### Files changed

| File | Change |
|------|--------|
| New migration SQL | Fix return type `amount INTEGER` → `amount NUMERIC` |

