# PostSuggestionBot for Slack

**An AI-powered Slack bot that transforms team conversations into viral LinkedIn content.**

Built with event-driven architecture, hybrid buffer processing, and production-grade AI pipelines.

---

## 🎯 What It Does

PostSuggestionBot listens to your Slack workspace conversations and automatically:

1. **Detects** post-worthy insights from team discussions
2. **Generates** viral LinkedIn posts using AI (Gemini 2.0 Flash + Pro)
3. **Creates** visual assets via Leonardo AI (DreamShaper v7)
4. **Responds** to direct messages with context-aware answers

**No manual work. No context switching. Just high-signal content, automatically.**

---

## 🏗️ Architecture

### Hybrid Buffer System (Event-Driven)

```
Slack Messages → Redis Buffer → Triggers → AI Pipeline → Supabase → Notification
                     ↓
              [Silence: 3min]
              [Volume: 100 msgs]
              [Overlap: 20 msgs]
```

**Two-Phase AI Pipeline:**
- **Scout (Gemini Flash)**: Fast filter for post-worthy content
- **Author (Gemini Pro)**: Viral post generation with influencer-style prompts

### Database Schema (Normalized)

```
conversations (parent)
    └── insights (child)
            └── generated_posts (grandchild)
                    └── notifications (great-grandchild)
```

**Cascade deletes** ensure clean data lifecycle management.

---

## 🚀 Features

| Feature | Description |
|---------|-------------|
| **Auto-Detection** | Analyzes conversations in real-time, triggers on silence (3min) or volume (100 msgs) |
| **Viral Post Generation** | Writes like Justin Welsh, Sahil Bloom, Shaan Puri - scroll-stopping hooks |
| **Image Generation** | Creates visuals with Leonardo AI (DreamShaper v7) |
| **Context-Aware DMs** | Chat directly with the bot - it remembers your last 5 posts |
| **Channel Mentions** | `@PostSuggestionBot generate image` - instant visual creation |
| **Production-Ready** | Redis TTL cleanup, Supabase cascade deletes, structured logging |

---

## 📦 Tech Stack

- **Runtime**: Node.js 18+
- **Slack SDK**: @slack/bolt
- **AI**: Google Gemini 2.0 (Flash + Pro)
- **Image Gen**: Leonardo AI
- **Database**: Supabase (PostgreSQL)
- **Cache**: Redis (Upstash via ioredis)
- **Logging**: Pino

---

## 🔧 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/postSuggestionBot-Slack.git
cd postSuggestionBot-Slack
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
SLACK_WORKSPACE_ID=T0ABC...

# AI
GEMINI_API_KEY=...
LEONARDO_API_KEY=...

# Database
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...

# Redis
REDIS_URL=redis://...
```

### 3. Database Setup

Run the migration:

```bash
psql -h <supabase-host> -U postgres -d postgres -f migrations/databaseschema.sql
```

### 4. Run

```bash
npm start
```

---

## 🌐 Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com)

1. Push to GitHub
2. Connect to Render
3. Use `render.yaml` (included)
4. Add environment variables in Render dashboard
5. Deploy

**Cost**: Free tier works, Starter ($7/mo) recommended for production.

---

## 💬 Usage

### In Channels

The bot listens passively. When it detects a post-worthy conversation:

```
PostSuggestionBot [APP]
🎯 Post Idea Detected!

📌 Topic: Shifting from features to user acquisition

📝 Suggested Post:
Stop shipping features.

We just went through this...
[viral post content]

---
Reply with @PostSuggestionBot generate image to create a visual.
```

### Mentions

```
@PostSuggestionBot generate image
```

Bot creates a visual for the most recent post using Leonardo AI.

### Direct Messages

Open a DM with the bot:

```
You: hey, list my recent ideas
Bot: Here are your last 5 posts...

You: generate image for the last one
Bot: 🎨 Generating... [creates visual]
```

---

## 🧠 How It Works

### 1. Message Buffering (Redis)

- Messages accumulate in Redis per channel
- **Silence Trigger**: 3 minutes of inactivity → process buffer, clear
- **Volume Trigger**: 100 messages → process batch, keep last 20 for overlap

### 2. AI Pipeline

**Scout (Gemini Flash)**:
```javascript
Input: 20-100 messages
Output: { worthy: true/false, topic: "...", summary: "..." }
```

**Author (Gemini Pro)** (only if worthy):
```javascript
Input: topic, summary, raw conversation
Output: Viral LinkedIn post (80-150 words, hook-driven)
```

### 3. Database Storage

Chained inserts:
```javascript
conversation → insight → generated_post
```

All relationships use `ON DELETE CASCADE`.

### 4. Notification

Post sent to Slack channel with:
- Topic
- Generated content
- Platform (LinkedIn)
- Instructions for image generation

---

## 🎨 Viral Post Formula

The Author AI uses techniques from top LinkedIn creators:

**Hook Patterns:**
- Contrarian: "Everyone obsesses about X. The best founders focus on Y."
- Confession: "Unpopular opinion: [bold take]"
- Curiosity gap: "This one mistake cost me 6 months."
- Numbers: "I spent 2 years learning this in 2 minutes."

**Body:**
- One idea per line
- Short sentences
- White space
- "You" > "I"

**Closer:**
- Specific question (not "What do you think?")
- Reframe that sticks

---

## 📊 Configuration

Edit `src/config/config.js`:

```javascript
hybridBuffer: {
  maxBatchSize: 100,        // Volume trigger
  silenceTimeoutSeconds: 180, // 3 minutes
  overlapSize: 20,          // Context preservation
}
```

---

## 🔒 Security

- Service role keys stored in environment variables
- Supabase RLS policies recommended
- Redis connection via TLS (rediss://)
- Slack signing secret verification

---

## 📈 Monitoring

Logs are structured (Pino):

```
[2026-01-31 20:51:15] INFO: ✅ Bot is running!
[2026-01-31 20:51:15] INFO: Features: Image Generation=true
```

Use Render's log aggregation or pipe to external services.

---

## 🤝 Contributing

This is a production-ready template. Fork it, customize it, ship it.

**Key files:**
- `src/services/simpleConversationAnalyzer.js` - Hybrid buffer logic
- `src/llm/geminiClient.js` - AI prompts (Scout + Author)
- `src/database/dbHandler.js` - Supabase chained inserts
- `src/slack/eventHandler.js` - Message routing + DM handling

---

## 📝 License

ISC

---

## 🎓 Built By

**Rahul Yadav** - Full-stack engineer specializing in AI-powered automation and event-driven systems.

*Inspired by the need to turn high-signal Slack conversations into distribution leverage.*

---

**Questions?** Open an issue or DM me on [LinkedIn](https://linkedin.com/in/yourprofile).
