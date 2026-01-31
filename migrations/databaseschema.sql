-- 2. SETUP EXTENSIONS
create extension if not exists "pgcrypto";

-- 3. CREATE TABLES (Production Schema)

-- A. Conversations (The Burst Container)
create table public.conversations (
  id uuid not null default gen_random_uuid () primary key,
  workspace_id text not null,
  channel_id text not null,
  message_count integer default 0,
  rolling_summary text, 
  window_started_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

-- Index: Find recent chats in a channel fast
create index if not exists idx_conversations_channel on public.conversations (channel_id, created_at desc);

-- B. Insights (The Raw Idea)
create table public.insights (
  id uuid not null default gen_random_uuid () primary key,
  conversation_id uuid references public.conversations(id) on delete cascade,
  core_insight text not null,
  suggested_angle text,
  confidence double precision,
  is_post_worthy boolean default false,
  created_at timestamp with time zone default now()
);

-- C. Generated Posts (The Content & Media)
create table public.generated_posts (
  id uuid not null default gen_random_uuid () primary key,
  insight_id uuid references public.insights(id) on delete cascade,
  user_id text default 'system_bot', 
  platform text default 'linkedin',
  content text not null,
  image_prompt text,
  image_url text,
  status text default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamp with time zone default now()
);

-- Index: Find posts linked to an insight
create index if not exists idx_generated_posts_insight on public.generated_posts (insight_id);

-- D. Notifications (Delivery Log)
create table public.notifications (
  id uuid not null default gen_random_uuid () primary key,
  conversation_id uuid references public.conversations(id) on delete cascade,
  type text not null,
  delivered_at timestamp with time zone default now()
);

-- 4. CONFIRMATION
SELECT 'Database Reset and Rebuilt Successfully' as status;