# Quick Start Guide

Get the Post Suggestion Bot running in 15 minutes.

## 1. Prerequisites Checklist

- [ ] Node.js 18+ installed (`node --version`)
- [ ] Slack workspace admin access
- [ ] Supabase account (sign up at [supabase.com](https://supabase.com))
- [ ] Gemini API key (get at [ai.google.dev](https://ai.google.dev))

## 2. Install Dependencies

```bash
git clone <your-repo>
cd postSuggestionBot-Slack
npm install
```

## 3. Create Slack App (5 minutes)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → "Create New App" → "From scratch"
2. Name: "Post Suggestion Bot", select your workspace

### Add Bot Scopes
Navigate to **OAuth & Permissions** → **Bot Token Scopes**, add:
- `channels:history`
- `channels:read`
- `chat:write`
- `im:write`
- `users:read`

### Enable Socket Mode
1. **Socket Mode** (sidebar) → Enable
2. Create app-level token with `connections:write`
3. Save the `xapp-...` token

### Subscribe to Events
**Event Subscriptions** → **Subscribe to bot events**:
- `message.channels`
- `message.groups`
- `message.im`

### Install to Workspace
1. **Install App** → "Install to Workspace"
2. Copy Bot OAuth Token (`xoxb-...`)

## 4. Setup Supabase (3 minutes)

1. Create new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor, paste and run:

```sql
create table conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  channel_id text not null,
  thread_ts text,
  rolling_summary text,
  message_count int default 0,
  participant_ids text[] default '{}',
  total_word_count int default 0,
  summary_version int default 1,
  signal_score float,
  notified boolean default false,
  gate_passed_at timestamptz,
  llm_last_called_at timestamptz,
  window_started_at timestamptz not null default now(),
  last_activity timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index conversations_unique_idx on conversations (workspace_id, channel_id, coalesce(thread_ts, ''));
create index conversations_channel_activity_idx on conversations (channel_id, last_activity desc);
create index conversations_notified_idx on conversations (notified) where notified = false;

create table insights (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  is_post_worthy boolean not null default false,
  confidence float,
  core_insight text not null,
  suggested_angle text not null,
  llm_model text,
  tokens_used int,
  evaluated_summary_version int,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  type text not null,
  delivered_at timestamptz not null default now()
);
```

3. Get credentials: **Settings** → **API**
   - Copy Project URL
   - Copy Service Role Key

## 5. Get Gemini API Key (1 minute)

1. Go to [ai.google.dev](https://ai.google.dev)
2. Click "Get API Key"
3. Create new key

## 6. Get Slack IDs (2 minutes)

### Your User ID:
1. Click your profile in Slack
2. **More** → **Copy member ID**

### Channel IDs:
1. Right-click channel → **Copy link**
2. Extract ID from URL (e.g., `C0123ABC456`)

## 7. Configure Environment (2 minutes)

Create `.env` file:

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-YOUR-TOKEN-HERE
SLACK_APP_TOKEN=xapp-YOUR-TOKEN-HERE
SLACK_WORKSPACE_ID=T0123ABC456

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR-KEY-HERE

# Gemini
GEMINI_API_KEY=YOUR-KEY-HERE

# Configuration
FOUNDER_USER_IDS=U0123ABC456
OPTED_IN_CHANNELS=C0123ABC456

# Logging
LOG_LEVEL=info
LOG_PRETTY=true
```

## 8. Run the Bot (1 minute)

```bash
npm run dev
```

You should see:
```
✅ Bot is running!
Supabase connection established
Opted-in channels: general
```

## 9. Test It

1. Invite bot to your opted-in channel:
   ```
   /invite @Post Suggestion Bot
   ```

2. Have a conversation (need at least 8 messages, 2+ people):
   ```
   Person A: We should change our onboarding flow
   Person B: Yeah, users are dropping off at step 3
   Person A: Maybe we make email verification optional?
   Person B: Good idea, let's A/B test it
   ... continue conversation ...
   ```

3. Watch the logs - you'll see:
   - Message processing
   - Signal gate evaluation
   - Summary compression
   - Insight detection
   - Notification sent!

4. Check your Slack DMs - you should receive a post suggestion!

## Troubleshooting

### "Configuration errors"
- Check all required env vars are set
- Verify no typos in variable names

### "Supabase connection failed"
- Verify URL starts with `https://`
- Check service role key is correct
- Ensure tables were created (run SQL again)

### "Bot not responding"
- Check Socket Mode is enabled in Slack app
- Verify bot is invited to channel
- Ensure channel ID is in `OPTED_IN_CHANNELS`

### "No notifications"
- Conversation needs to pass signal gate (8+ messages, 2+ people)
- Check logs for signal score
- Try `DRY_RUN_MODE=true` to test without sending

## Next Steps

Once working:
- Read [README.md](README.md) for full documentation
- See [DEPLOYMENT.md](DEPLOYMENT.md) for deploying to production
- Tune thresholds in `.env` to match your needs
- Add more channels to `OPTED_IN_CHANNELS`

## Common Configurations

**More aggressive (catch more posts):**
```bash
MIN_MESSAGES=5
INSIGHT_CONFIDENCE=0.6
```

**More conservative (fewer false positives):**
```bash
MIN_MESSAGES=12
MIN_PARTICIPANTS=3
INSIGHT_CONFIDENCE=0.8
```

**Test mode (no actual notifications):**
```bash
DRY_RUN_MODE=true
```

---

**Need help?** Check [README.md](README.md) or open an issue!
