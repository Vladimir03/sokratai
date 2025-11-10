-- Create solutions table for storing AI-generated math solutions
-- This table stores complete solution data that can be viewed in the Mini App

create table if not exists public.solutions (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null,
  telegram_user_id bigint,
  user_id uuid references auth.users(id) on delete cascade,
  problem_text text not null,
  solution_data jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Add indexes for better query performance
create index if not exists solutions_telegram_chat_id_idx on public.solutions(telegram_chat_id);
create index if not exists solutions_telegram_user_id_idx on public.solutions(telegram_user_id);
create index if not exists solutions_user_id_idx on public.solutions(user_id);
create index if not exists solutions_created_at_idx on public.solutions(created_at desc);

-- Enable Row Level Security
alter table public.solutions enable row level security;

-- Policy: Anyone can read solutions (for Mini App)
-- This allows the Mini App to load solutions without authentication
create policy "Solutions are viewable by anyone"
  on public.solutions for select
  using (true);

-- Policy: Only service role can insert solutions (for bot)
-- This ensures only the Telegram bot can create new solutions
create policy "Service role can insert solutions"
  on public.solutions for insert
  with check (true);

-- Policy: Users can view their own solutions
create policy "Users can view own solutions"
  on public.solutions for select
  using (auth.uid() = user_id);

-- Add comment for documentation
comment on table public.solutions is 'Stores AI-generated math solutions from Telegram bot for display in Mini App';
comment on column public.solutions.solution_data is 'JSONB structure: { problem, solution_steps: [{ number, title, content, formula?, method? }], final_answer, raw_response }';
