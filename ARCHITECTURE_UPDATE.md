# Architecture Update: General-Purpose Bot

## Changes Made

The bot has been updated from a single-workspace, founder-specific tool to a **general-purpose Slack bot** that anyone can install and use.

## What Changed

### ❌ Removed Requirements

1. **OPTED_IN_CHANNELS** - No longer needed
   - Bot now works in ANY channel it's invited to
   - Users control access by inviting/removing the bot

2. **FOUNDER_USER_IDS** - No longer needed
   - Notifications post directly in the channel where the conversation happened
   - No need to configure specific users to notify

### ✅ New Behavior

**Before:**
- Admin must configure specific channels in `.env`
- Bot only works in those pre-defined channels
- Notifications sent as DMs to specific founder user IDs
- High friction to add new channels

**After:**
- Bot works in ANY channel it's invited to
- Users simply use `/invite @Post Suggestion Bot` in any channel
- Notifications post directly in the conversation (channel or thread)
- Zero configuration needed after initial setup

## How It Works Now

### 1. Installation
```bash
# Only need these in .env:
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
```

That's it! No channel IDs or user IDs needed.

### 2. Usage

**For any user in any workspace:**

1. Install the bot to their Slack workspace
2. Invite it to a channel: `/invite @Post Suggestion Bot`
3. Have conversations (8+ messages, 2+ people)
4. Bot posts notification right in that channel when it detects a post-worthy insight

### 3. Notification Example

**In #product-team channel:**
```
User A: We should change our onboarding flow
User B: Yeah, users are dropping off at step 3
... (conversation continues) ...

[Bot automatically posts when it detects insight:]

🎯 Post Idea Detected

📝 Core Insight:
Removing required email verification reduced signup drop-off from 35% to 12%

💡 Suggested Angle:
Most founders over-optimize for fraud prevention and under-optimize
for conversion. We took a calculated risk: made email verification
optional, monitored spam closely, and saw a 23-point improvement.

📊 Confidence: 85%

This conversation has strong potential for a public post. Consider
sharing this insight on LinkedIn or X.
```

## Benefits

### For Users
- ✅ Zero configuration (just invite to channels)
- ✅ Works in private channels too
- ✅ Notifications stay in context (same channel)
- ✅ Easy to try out (invite/remove anytime)
- ✅ Works for any team size

### For Administrators
- ✅ One-time setup (Slack app + Supabase + Gemini)
- ✅ Deploy once, works for unlimited channels
- ✅ No per-channel configuration
- ✅ Scales automatically

## Privacy & Control

**Users control access:**
- Bot only sees messages in channels it's invited to
- Remove bot from channel = it stops monitoring
- No manual opt-in/opt-out needed

**What bot stores:**
- Rolling summaries (NOT raw messages)
- Conversation metadata (count, participants, timestamps)
- Insights detected
- Notification history

**What bot NEVER stores:**
- Raw message text
- User names (only anonymous user IDs)
- Sensitive information

## Migration Path

If you had the old version:

1. **Remove from .env:**
   ```bash
   # DELETE these lines:
   FOUNDER_USER_IDS=...
   OPTED_IN_CHANNELS=...
   ```

2. **Update notification method:**
   ```bash
   NOTIFICATION_METHOD=channel  # was 'dm' before
   ```

3. **That's it!** Bot will now work in all channels.

## Technical Changes

### Code Changes

**src/config/config.js**
- Removed `optedInChannels` from slack config
- Removed `founderUserIds` from notification config
- Removed validation requiring these fields

**src/slack/eventHandler.js**
- Removed `isChannelOptedIn()` check
- Bot processes messages from any channel

**src/slack/notifier.js**
- Changed from DM-based to channel-based notifications
- Posts in same channel where conversation happened
- If thread conversation, posts in thread

### Database Schema
No changes needed - same tables work for both approaches.

## Configuration Reference

### Required (Minimal Setup)
```bash
SLACK_BOT_TOKEN=xoxb-...        # From Slack app
SLACK_APP_TOKEN=xapp-...        # From Slack app
SUPABASE_URL=https://...        # From Supabase
SUPABASE_SERVICE_ROLE_KEY=...   # From Supabase
GEMINI_API_KEY=...              # From Google AI Studio
```

### Optional (Tuning)
```bash
# Signal Gate
MIN_MESSAGES=8                  # Minimum messages to analyze
MIN_PARTICIPANTS=2              # Minimum unique participants
INSIGHT_CONFIDENCE=0.7          # 0.0-1.0, higher = more conservative

# Features
DRY_RUN_MODE=false             # Set true to test without posting
NOTIFICATION_METHOD=channel     # Always 'channel' now
```

## What Stayed The Same

✅ Privacy-first (no raw message storage)
✅ Signal gate filtering (70-80% conversations filtered)
✅ Rolling summaries with Gemini
✅ Once-only notifications per conversation
✅ All tunable thresholds
✅ Rate limiting
✅ Health checks and metrics
✅ Lifecycle management

## Summary

The bot is now a **true general-purpose Slack app** that:
- Works out-of-the-box in any workspace
- Requires minimal configuration
- Scales to unlimited channels
- Gives users full control via invite/remove
- Posts notifications in context

**No more manual channel management or user ID configuration!** 🎉
