create table public.conversations (
  id uuid not null default gen_random_uuid (),
  workspace_id text not null,
  channel_id text not null,
  thread_ts text null,
  rolling_summary text null,
  message_count integer null default 0,
  signal_score double precision null,
  notified boolean null default false,
  last_activity timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  participant_ids text[] null default '{}'::text[],
  total_word_count integer null default 0,
  summary_version integer null default 1,
  gate_passed_at timestamp with time zone null,
  llm_last_called_at timestamp with time zone null,
  window_started_at timestamp with time zone not null default now(),
  constraint conversations_pkey primary key (id)
) TABLESPACE pg_default;

create unique INDEX IF not exists conversations_unique_idx on public.conversations using btree (
  workspace_id,
  channel_id,
  COALESCE(thread_ts, ''::text)
) TABLESPACE pg_default;

create index IF not exists conversations_channel_activity_idx on public.conversations using btree (channel_id, last_activity desc) TABLESPACE pg_default;

create index IF not exists conversations_notified_idx on public.conversations using btree (notified) TABLESPACE pg_default
where
  (notified = false);

create index IF not exists conversations_workspace_idx on public.conversations using btree (workspace_id) TABLESPACE pg_default;





create table public.generated_posts (
  id uuid not null default gen_random_uuid (),
  insight_id uuid null,
  user_id text not null,
  platform text not null,
  content text not null,
  image_url text null,
  image_prompt text null,
  status text null default 'draft'::text,
  version integer null default 1,
  generation_model text null default 'gemini-1.5-flash'::text,
  tokens_used integer null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  published_at timestamp with time zone null,
  constraint generated_posts_pkey primary key (id),
  constraint generated_posts_insight_id_fkey foreign KEY (insight_id) references insights (id) on delete CASCADE,
  constraint valid_platform check (
    (
      platform = any (array['twitter'::text, 'linkedin'::text])
    )
  ),
  constraint valid_status check (
    (
      status = any (
        array[
          'draft'::text,
          'published'::text,
          'archived'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_generated_posts_status on public.generated_posts using btree (status) TABLESPACE pg_default;

create index IF not exists idx_generated_posts_created on public.generated_posts using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_generated_posts_user on public.generated_posts using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_generated_posts_insight on public.generated_posts using btree (insight_id) TABLESPACE pg_default;




create table public.insights (
  id uuid not null default gen_random_uuid (),
  conversation_id uuid null,
  core_insight text not null,
  suggested_angle text not null,
  llm_model text null,
  confidence double precision null,
  created_at timestamp with time zone not null default now(),
  is_post_worthy boolean not null default false,
  tokens_used integer null,
  evaluated_summary_version integer null,
  constraint insights_pkey primary key (id),
  constraint insights_conversation_id_fkey foreign KEY (conversation_id) references conversations (id) on delete CASCADE
) TABLESPACE pg_default;




create table public.notifications (
  id uuid not null default gen_random_uuid (),
  conversation_id uuid null,
  type text not null,
  delivered_at timestamp with time zone not null default now(),
  message_ts text null,
  constraint notifications_pkey primary key (id),
  constraint notifications_conversation_id_fkey foreign KEY (conversation_id) references conversations (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_notifications_message_ts on public.notifications using btree (message_ts) TABLESPACE pg_default;