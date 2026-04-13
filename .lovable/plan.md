

## Plan: Fix student-account edge function — email update error

### Problem
`supabaseAdmin.auth.admin.getUserByEmail()` does not exist in supabase-js v2. Logs confirm: `TypeError: supabaseAdmin.auth.admin.getUserByEmail is not a function`.

### Changes

#### 1. Fix `supabase/functions/student-account/index.ts`

Replace the broken `getUserByEmail` call (lines 71-77) with `listUsers` which is available in the SDK:

```typescript
const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
  page: 1,
  perPage: 1,
});
```

Actually, `listUsers` doesn't filter by email. The correct approach: skip the duplicate check entirely and let `updateUserById` handle it — Supabase Auth will return an error if the email is already taken by another user. This simplifies the code and eliminates the broken call.

Remove lines 71-81 (the entire `getUserByEmail` block). The `updateUserById` call on line 83 will naturally fail with a descriptive error if the email is already in use.

Also fix line 107: change password min length message from "4 символа" to "6 символов" and the check from `< 4` to `< 6`.

#### 2. Redeploy `student-account`

### Also: fix `get_students_contact_info` type mismatch (console error)

The console logs show: `Returned type character varying(255) does not match expected type text in column 2`. The function returns `au.email` (which is `varchar(255)` in auth.users) but declares return type `text`. Fix with a migration:

```sql
CREATE OR REPLACE FUNCTION public.get_students_contact_info(student_ids uuid[])
RETURNS TABLE(student_id uuid, login_email text, has_real_email boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  RETURN QUERY
  SELECT au.id, au.email::text, (au.email IS NOT NULL AND au.email NOT LIKE '%@temp.sokratai.ru')
  FROM auth.users au WHERE au.id = ANY(student_ids);
END;
$$;
```

Add `::text` cast to `au.email`.

