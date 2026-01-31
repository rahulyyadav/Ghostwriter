# Post Suggestion Bot for Slack

A production-grade Slack bot that automatically detects high-signal conversations in opted-in channels and notifies founders when a discussion is a strong candidate for a LinkedIn/X post.

## Features

- **Privacy-first**: No raw message storage, only rolling summaries
- **Signal over noise**: Deterministic gate filters 70-80% of conversations before LLM analysis
- **Cost-efficient**: Uses Gemini free tier with rate limiting
- **Once-only notifications**: Never spam founders with duplicate alerts
- **Production-ready**: Structured logging, metrics tracking, health checks, and lifecycle management

## Architecture

```
Slack Events → Message Parser → Conversation Manager → Signal Gate
                                        ↓
                                 Summary Compressor (Gemini)
                                        ↓
                                 Insight Detector (Gemini)
                                        ↓
                                 Notification Manager → Founder DMs
```

## Prerequisites

- Node.js 18+
- Slack workspace with admin access
- Supabase account (free tier)
- Gemini API key (free tier)

## Setup

### 1. Clone and Install Dependencies

```bash
git clone <your-repo>
cd postSuggestionBot-Slack
npm install
```

### 2. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name it "Post Suggestion Bot"
4. Select your workspace

#### Configure OAuth & Permissions

Add these Bot Token Scopes:
- `channels:history`
- `channels:read`
- `chat:write`
- `im:write`
- `users:read`

#### Enable Socket Mode

1. Go to "Socket Mode" in sidebar
2. Enable Socket Mode
3. Create an app-level token with `connections:write` scope
4. Save the `xapp-` token

#### Subscribe to Events

1. Go to "Event Subscriptions"
2. Subscribe to bot events:
   - `message.channels`
   - `message.groups`
   - `message.im`

#### Install App

1. Go to "Install App"
2. Click "Install to Workspace"
3. Copy the Bot User OAuth Token (`xoxb-...`)

### 3. Setup Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the SQL migration:

```sql
-- Create conversations table
create table conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  channel_id text not null,
  thread_ts text,
  rolling_summary text,
  message_count int default 0,
  signal_score float,
  notified boolean default false,
  last_activity timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  participant_ids text[] default '{}',
  total_word_count int default 0,
  summary_version int default 1,
  gate_passed_at timestamptz,
  llm_last_called_at timestamptz,
  window_started_at timestamptz not null default now()
);

-- Create unique index
create unique index conversations_unique_idx
  on conversations (workspace_id, channel_id, coalesce(thread_ts, ''));

-- Create indexes
create index conversations_channel_activity_idx
  on conversations (channel_id, last_activity desc);

create index conversations_notified_idx
  on conversations (notified) where notified = false;

-- Create insights table
create table insights (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  core_insight text not null,
  suggested_angle text not null,
  llm_model text,
  confidence float,
  created_at timestamptz not null default now(),
  is_post_worthy boolean not null default false,
  tokens_used int,
  evaluated_summary_version int
);

-- Create notifications table
create table notifications (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  type text not null,
  delivered_at timestamptz not null default now()
);
```

3. Get your Supabase URL and Service Role Key from Settings → API

### 4. Get Gemini API Key

1. Go to [ai.google.dev](https://ai.google.dev)
2. Click "Get API Key"
3. Create a new API key

### 5. Configure Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_WORKSPACE_ID=T123ABC
SLACK_SIGNING_SECRET=

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Gemini
GEMINI_API_KEY=your-gemini-api-key

# Bot Configuration (REQUIRED)
FOUNDER_USER_IDS=U123ABC,U456DEF  # Comma-separated Slack user IDs
OPTED_IN_CHANNELS=C123ABC,C456DEF  # Comma-separated channel IDs

# Logging
LOG_LEVEL=info
LOG_PRETTY=true
```

#### How to Find Slack IDs

**User IDs:**
1. Click on a user's profile in Slack
2. Click "More" → "Copy member ID"

**Channel IDs:**
1. Right-click on a channel
2. Click "Copy link"
3. Extract the ID from the URL (e.g., `C123ABC`)

### 6. Run the Bot

Development mode with pretty logging:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## Configuration

All thresholds are tunable via environment variables. See [.env.example](.env.example) for full list.

### Key Configurations

**Signal Gate Thresholds:**
- `MIN_MESSAGES=8` - Minimum messages before LLM analysis
- `MIN_PARTICIPANTS=2` - Minimum unique participants
- `MIN_AVG_WORDS=15` - Average words per message
- `MIN_TOTAL_WORDS=120` - Total word count threshold

**Summary Compression:**
- `COMPRESS_MSG_COUNT=5` - Messages before compression
- `MAX_SUMMARY_WORDS=250` - Maximum summary length

**Insight Detection:**
- `INSIGHT_CONFIDENCE=0.7` - Confidence threshold (0.0-1.0)

**Feature Flags:**
- `DRY_RUN_MODE=false` - Test without sending notifications
- `ENABLE_INSIGHT_DETECTION=true`
- `ENABLE_SUMMARY_COMPRESSION=true`

## Usage

1. **Add Bot to Channels**
   - Invite the bot to opted-in channels: `/invite @Post Suggestion Bot`

2. **Start Conversations**
   - Bot monitors all messages in opted-in channels
   - Conversations are analyzed automatically

3. **Receive Notifications**
   - Founders get DMs when post-worthy insights are detected
   - Each conversation triggers only one notification

## Monitoring

### Logs

The bot uses structured JSON logging. Key events:
- Message processing
- Compression triggers
- Insight detection
- Notification delivery
- Errors

### Health Checks

Health reports are logged hourly with:
- Database connectivity
- Gemini rate limit status
- Metrics summary

### Metrics

Tracked metrics:
- `messages.total` - Total messages received
- `messages.processed` - Messages after filtering
- `compression.attempts` - Compression runs
- `insights.post_worthy` - Post-worthy insights found
- `notifications.sent` - Notifications delivered
- `llm.calls` - Total LLM API calls
- `errors.total` - Error count

## Troubleshooting

### Bot Not Responding

1. Check Slack app is installed: Slack → Apps → Manage → Your Apps
2. Verify Socket Mode is enabled
3. Check logs for connection errors
4. Ensure `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN` are correct

### Database Errors

1. Verify Supabase credentials in `.env`
2. Check tables exist (run SQL migration)
3. Verify service role key has correct permissions

### No Notifications

1. Check `FOUNDER_USER_IDS` are correct Slack user IDs
2. Verify conversation passes signal gate (check logs for `signalScore`)
3. Ensure `DRY_RUN_MODE=false`
4. Check Gemini API key is valid

### Rate Limit Errors

- Gemini free tier: 15 requests/minute, 1M tokens/day
- Bot implements rate limiting automatically
- Check logs for `Rate limit hit` warnings
- Errors will retry with exponential backoff

## Deployment

### Railway

1. Install Railway CLI: `npm install -g @railway/cli`
2. Login: `railway login`
3. Create project: `railway init`
4. Add environment variables: `railway variables`
5. Deploy: `railway up`

### Render

1. Go to [render.com](https://render.com)
2. New → Web Service
3. Connect your Git repository
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Add environment variables in dashboard

### Fly.io

1. Install Flyctl: `brew install flyctl`
2. Login: `fly auth login`
3. Launch: `fly launch`
4. Set secrets: `fly secrets set KEY=value`
5. Deploy: `fly deploy`

## Development

### Project Structure

```
src/
├── config/          # Configuration management
├── core/            # Type definitions
├── database/        # Supabase repositories
├── llm/             # Gemini client, prompts, rate limiting
├── services/        # Business logic
│   ├── conversationManager.js
│   ├── signalGate.js
│   ├── summaryCompressor.js
│   ├── insightDetector.js
│   └── lifecycleManager.js
├── slack/           # Slack integration
│   ├── eventHandler.js
│   └── notifier.js
└── utils/           # Logging, errors, metrics, health
```

### Adding New Channels

Update `OPTED_IN_CHANNELS` in `.env`:
```bash
OPTED_IN_CHANNELS=C123ABC,C456DEF,C789GHI
```

Restart the bot for changes to take effect.

## License

ISC

## Support

For issues or questions, create an issue in the repository.
