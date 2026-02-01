require('dotenv').config();

const config = {
  // Signal gate thresholds
  signalGate: {
    volume: {
      minMessages: parseInt(process.env.MIN_MESSAGES) || 8,
      minParticipants: parseInt(process.env.MIN_PARTICIPANTS) || 2,
      minAvgWords: parseInt(process.env.MIN_AVG_WORDS) || 15,
      minTotalWords: parseInt(process.env.MIN_TOTAL_WORDS) || 120,
    },
    temporal: {
      minDurationMinutes: parseInt(process.env.MIN_DURATION_MIN) || 5,
      maxDurationHours: parseInt(process.env.MAX_DURATION_HOURS) || 6,
      minVelocityMsgPerHour: parseFloat(process.env.MIN_VELOCITY) || 1,
      maxVelocityMsgPerHour: parseFloat(process.env.MAX_VELOCITY) || 10,
      minAgeMinutes: parseInt(process.env.MIN_AGE_MIN) || 5,
    },
    engagement: {
      minBackAndForthRatio: parseFloat(process.env.MIN_ENGAGEMENT) || 0.25,
    },
    quality: {
      requiresQuestion: process.env.REQUIRE_QUESTION !== 'false',
      minUniquenessRatio: parseFloat(process.env.MIN_UNIQUENESS) || 0.4,
    },
  },

  // Summary compression
  summaryCompression: {
    triggerMessageCount: parseInt(process.env.COMPRESS_MSG_COUNT) || 5,
    triggerWordCount: parseInt(process.env.COMPRESS_WORD_COUNT) || 300,
    triggerMinutesSinceLastCompress: parseInt(process.env.COMPRESS_MINUTES) || 15,
    maxSummaryWords: parseInt(process.env.MAX_SUMMARY_WORDS) || 250,
    maxRetries: parseInt(process.env.COMPRESS_MAX_RETRIES) || 3,
  },

  // Insight detection
  insightDetection: {
    confidenceThreshold: parseFloat(process.env.INSIGHT_CONFIDENCE) || 0.7,
    cooldownMinutes: parseInt(process.env.INSIGHT_COOLDOWN_MIN) || 60,
  },

  // Gemini rate limiting
  gemini: {
    maxRequestsPerMinute: parseInt(process.env.GEMINI_RPM) || 15,
    maxRequestsPerDay: parseInt(process.env.GEMINI_RPD) || 1000,
    timeoutMs: parseInt(process.env.GEMINI_TIMEOUT) || 30000,
  },

  // Conversation lifecycle
  conversationTTL: {
    inactivityHours: parseInt(process.env.CONVERSATION_TTL_HOURS) || 6,
    cleanupIntervalHours: parseInt(process.env.CLEANUP_INTERVAL_HOURS) || 12,
  },

  // Notification
  notification: {
    deliveryMethod: process.env.NOTIFICATION_METHOD || 'channel', // 'channel' posts in same channel, 'dm' to admins
    notifyChannelAdmins: process.env.NOTIFY_CHANNEL_ADMINS === 'true', // Optional: also DM channel admins
    founderUserIds: process.env.FOUNDER_USER_IDS
      ? process.env.FOUNDER_USER_IDS.split(',').map(id => id.trim())
      : [],
  },

  // Feature flags
  features: {
    enableInsightDetection: process.env.ENABLE_INSIGHT_DETECTION !== 'false',
    enableSummaryCompression: process.env.ENABLE_SUMMARY_COMPRESSION !== 'false',
    enablePostGeneration: process.env.ENABLE_POST_GENERATION !== 'false',
    enableImageGeneration: process.env.ENABLE_IMAGE_GENERATION === 'true' || !!process.env.LEONARDO_API_KEY,
    dryRunMode: process.env.DRY_RUN_MODE === 'true',
    // Use simple sliding window approach instead of complex signal gates
    useSimpleAnalyzer: process.env.USE_SIMPLE_ANALYZER !== 'false',  // Default: true (simpler is better!)
  },

  // Hybrid Buffer System config (event-driven approach)
  hybridBuffer: {
    maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE) || 100,       // Volume trigger: process at 100 messages
    silenceTimeoutSeconds: parseInt(process.env.SILENCE_TIMEOUT) || 180, // Silence trigger: 3 minutes
    overlapSize: parseInt(process.env.OVERLAP_SIZE) || 20,           // Keep last 20 messages for context
  },

  // Image generation (Leonardo AI)
  imageGeneration: {
    leonardoApiKey: process.env.LEONARDO_API_KEY,
    defaultWidth: parseInt(process.env.IMAGE_WIDTH) || 1024,
    defaultHeight: parseInt(process.env.IMAGE_HEIGHT) || 1024,
    maxRetries: parseInt(process.env.IMAGE_MAX_RETRIES) || 2,
  },

  // Slack
  slack: {
    workspaceId: process.env.SLACK_WORKSPACE_ID || 'default',  // Default for single-workspace setup
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    optedInChannels: process.env.OPTED_IN_CHANNELS
      ? process.env.OPTED_IN_CHANNELS.split(',').map(c => c.trim())
      : [],
  },

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  // LLM
  llm: {
    geminiApiKey: process.env.GEMINI_API_KEY,
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    pretty: process.env.LOG_PRETTY === 'true',
  },
};

function validateConfig() {
  const errors = [];

  if (!config.slack.botToken) {
    errors.push('SLACK_BOT_TOKEN is required');
  }

  // SLACK_APP_TOKEN only required for Socket Mode (optional now)
  // SLACK_SIGNING_SECRET required for HTTP mode
  if (!config.slack.appToken && !config.slack.signingSecret) {
    errors.push('Either SLACK_APP_TOKEN (Socket Mode) or SLACK_SIGNING_SECRET (HTTP Mode) is required');
  }

  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    errors.push('Supabase credentials (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are required');
  }

  if (!config.llm.geminiApiKey) {
    errors.push('GEMINI_API_KEY is required');
  }

  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
}

validateConfig();

module.exports = config;
