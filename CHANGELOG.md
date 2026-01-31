# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-01-28

### Added
- Initial release of Post Suggestion Bot
- Event ingestion layer with message parsing and noise filtering
- Conversation state manager with Supabase persistence
- Rolling summary compression using Gemini 1.5 Flash
- Deterministic signal gate to filter low-quality conversations
- LLM-based insight detection for post-worthy content
- Automatic DM notifications to founders
- Rate limiting for Gemini API (15 RPM, 1M tokens/day)
- Conversation lifecycle management with TTL-based cleanup
- Structured logging with Pino
- Metrics tracking (messages, compressions, insights, notifications, errors)
- Health checks for database and API status
- Configuration management via environment variables
- Feature flags for dry-run mode and selective feature enabling
- Comprehensive documentation (README, DEPLOYMENT guide)
- Production-ready error handling and retry logic
- Graceful shutdown handling

### Configuration Options
- Signal gate thresholds (message count, participants, word density)
- Summary compression triggers and limits
- Insight detection confidence threshold
- Conversation TTL and cleanup interval
- Opted-in channels management
- Founder user ID configuration

### Architecture Highlights
- **Privacy-first**: No raw message storage, only rolling summaries
- **Cost-efficient**: 70-80% of conversations filtered before LLM
- **Once-only notifications**: Each conversation notifies only once
- **Extensible**: Clean separation of concerns, easy to add features

## [Unreleased]

### Planned Features
- Interactive post drafting (reply "draft" in notification)
- Slack slash commands for admin management (/postbot-optin, /postbot-status)
- Support for multiple workspaces
- Advanced analytics dashboard
- Post iteration workflow (refine suggested posts)
- Webhook for external integrations
- Sentry integration for error tracking
- Custom signal gate rules per channel
- A/B testing for different prompts
- Export conversation insights to CSV

### Future Improvements
- Support for other LLM providers (OpenAI, Claude, etc.)
- Thread-level opt-in (instead of channel-level)
- Natural language configuration ("Make it more aggressive")
- Sentiment analysis for conversation tone
- Topic clustering and trending insights

## Version History

- **1.0.0** (2026-01-28): Initial production-ready release
