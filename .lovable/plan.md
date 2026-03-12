

## Diagnosis

All three KB tables (`kb_topics`, `kb_folders`, `kb_tasks`, etc.) and the `kb_topics_with_counts` view **do not exist** in the database. The migrations were written but never applied:

1. `20260312120000_kb_knowledge_base.sql` — creates 6 tables + RLS + grants
2. `20260312120001_kb_seed_physics.sql` — seeds ЕГЭ/ОГЭ physics topics
3. `20260312130000_kb_topics_with_counts_view.sql` — creates the view

This also explains the **build errors** in `useFolders.ts`: the auto-generated `types.ts` doesn't know about `kb_folders` or `kb_tasks` because they don't exist in the DB. The Supabase client's type system rejects `.from('kb_folders')`.

## Fix

### Step 1: Apply all 3 migrations via the migration tool (in order)

Run the SQL from each migration file sequentially:
1. `20260312120000_kb_knowledge_base.sql` — tables, RLS, grants
2. `20260312120001_kb_seed_physics.sql` — seed data
3. `20260312130000_kb_topics_with_counts_view.sql` — view

### Step 2: Add GRANT on the view

The view migration file is missing a `GRANT SELECT ON public.kb_topics_with_counts TO authenticated;`. Add this to the migration or run it separately.

### Step 3: Regenerate types

After the tables exist, the auto-generated `types.ts` will include `kb_folders`, `kb_tasks`, etc., which will resolve all build errors in `useFolders.ts` without any frontend code changes.

**No frontend changes needed.** All build errors stem from missing DB tables.

