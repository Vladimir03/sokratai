-- Remove old gamification columns from profiles table
ALTER TABLE public.profiles 
  DROP COLUMN IF EXISTS xp,
  DROP COLUMN IF EXISTS level,
  DROP COLUMN IF EXISTS streak,
  DROP COLUMN IF EXISTS last_activity;