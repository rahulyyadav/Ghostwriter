/**
 * HybridBufferAnalyzer - Event-driven conversation buffer system
 *
 * Architecture (The "Hybrid" Engine):
 * 1. Messages accumulate in Redis buffer per channel/thread
 * 2. Two triggers fire the AI analysis pipeline:
 *    - SILENCE TRIGGER: 3 minutes of no activity → process entire buffer, clear it
 *    - VOLUME TRIGGER: 100 messages hit → process batch, keep last 20 for overlap
 * 3. Scout AI (Gemini Flash) filters for worthy content
 * 4. Author AI (Gemini Pro) generates the post if worthy
 */
const geminiClient = require('../llm/geminiClient');
const dbHandler = require('../database/dbHandler');
const redisClient = require('../database/redisClient');
const notifier = require('../slack/notifier');
const config = require('../config/config');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

class HybridBufferAnalyzer {
  constructor() {
    // Configuration from config.js
    this.maxBatchSize = config.hybridBuffer.maxBatchSize;       // 100 messages
    this.silenceTimeoutMs = config.hybridBuffer.silenceTimeoutSeconds * 1000; // 3 min in ms
    this.overlapSize = config.hybridBuffer.overlapSize;         // 20 messages

    // In-memory fallback storage (if Redis unavailable)
    this.localBuffers = new Map();

    // Silence timers per conversation (stored in-memory, not Redis)
    this.silenceTimers = new Map();

    // Redis key prefix
    this.redisPrefix = 'buffer:';

    // Initialize Redis
    this.redis = redisClient.init();

    // Stats for monitoring
    this.stats = {
      messagesProcessed: 0,
      batchesProcessed: 0,
      silenceTriggers: 0,
      volumeTriggers: 0,
      insightsFound: 0,
    };

    console.log('\n========================================');
    console.log('🚀 HybridBufferAnalyzer INITIALIZED');
    console.log('========================================');
    console.log(`📊 Max Batch Size: ${this.maxBatchSize} messages`);
    console.log(`📊 Silence Timeout: ${config.hybridBuffer.silenceTimeoutSeconds}s`);
    console.log(`📊 Overlap Size: ${this.overlapSize} messages`);
    console.log(`📊 Storage: ${this.redis ? 'Redis (Upstash)' : 'In-Memory (fallback)'}`);
    console.log('========================================\n');

    logger.info('HybridBufferAnalyzer initialized', {
      maxBatchSize: this.maxBatchSize,
      silenceTimeoutMs: this.silenceTimeoutMs,
      overlapSize: this.overlapSize,
      usingRedis: !!this.redis,
    });
  }

  /**
   * Get buffer key for a channel/thread
   */
  getBufferKey(channelId, threadTs) {
    const key = threadTs ? `${channelId}:${threadTs}` : channelId;
    return this.redisPrefix + key;
  }

  /**
   * Get buffer from storage (Redis or local fallback)
   */
  async getBuffer(channelId, threadTs) {
    const key = this.getBufferKey(channelId, threadTs);

    if (this.redis) {
      try {
        const data = await this.redis.get(key);
        return data ? JSON.parse(data) : { messages: [], channelId, threadTs };
      } catch (error) {
        logger.error('Redis get failed, using local fallback', { error: error.message });
      }
    }

    // Fallback to local storage
    return this.localBuffers.get(key) || { messages: [], channelId, threadTs };
  }

  /**
   * Save buffer to storage (Redis or local fallback)
   */
  async saveBuffer(channelId, threadTs, buffer) {
    const key = this.getBufferKey(channelId, threadTs);

    if (this.redis) {
      try {
        // Set with 6 hour TTL for auto-cleanup (ioredis syntax: key, value, 'EX', seconds)
        await this.redis.set(key, JSON.stringify(buffer), 'EX', 6 * 60 * 60);
        return;
      } catch (error) {
        logger.error('Redis set failed, using local fallback', { error: error.message });
      }
    }

    // Fallback to local storage
    this.localBuffers.set(key, buffer);
  }

  /**
   * Clear buffer from storage
   */
  async clearBuffer(channelId, threadTs) {
    const key = this.getBufferKey(channelId, threadTs);

    if (this.redis) {
      try {
        await this.redis.del(key);
        return;
      } catch (error) {
        logger.error('Redis del failed', { error: error.message });
      }
    }

    this.localBuffers.delete(key);
  }

  /**
   * Main entry point: Process incoming Slack message
   * 
   * Flow:
   * 1. Add message to buffer
   * 2. Reset silence timer
   * 3. Check if volume trigger hit (100 messages)
   *    - Yes: Process immediately
   *    - No: Wait for silence trigger
   */
  async processMessage(message, client) {
    try {
      this.stats.messagesProcessed++;

      // Skip bot messages
      if (message.bot_id || message.subtype === 'bot_message') {
        return null;
      }

      const channelId = message.channel;
      const threadTs = message.thread_ts || null;
      const messageText = message.text || '';
      const timerKey = this.getBufferKey(channelId, threadTs);

      console.log(`\n📨 [MESSAGE] Received: "${messageText.substring(0, 50)}..."`);

      // 1. Add message to buffer
      const buffer = await this.getBuffer(channelId, threadTs);
      buffer.messages.push({
        userId: message.user,
        text: messageText,
        timestamp: message.ts,
      });
      await this.saveBuffer(channelId, threadTs, buffer);

      console.log(`📝 [BUFFER] ${timerKey} now has ${buffer.messages.length}/${this.maxBatchSize} messages`);

      // 2. Check Volume Trigger (100 messages)
      if (buffer.messages.length >= this.maxBatchSize) {
        console.log(`\n🚨 [TRIGGER] VOLUME: Hit ${this.maxBatchSize} messages!`);

        // Cancel existing timer
        if (this.silenceTimers.has(timerKey)) {
          clearTimeout(this.silenceTimers.get(timerKey));
          this.silenceTimers.delete(timerKey);
        }

        // Process immediately
        return await this.processBatch(channelId, threadTs, 'max_cap', client);
      }

      // 3. Reset Silence Timer (debounce)
      if (this.silenceTimers.has(timerKey)) {
        clearTimeout(this.silenceTimers.get(timerKey));
      }

      // Start new silence timer
      const timer = setTimeout(async () => {
        console.log(`\n🚨 [TRIGGER] SILENCE: No activity for ${config.hybridBuffer.silenceTimeoutSeconds}s`);
        this.silenceTimers.delete(timerKey);
        await this.processBatch(channelId, threadTs, 'silence', client);
      }, this.silenceTimeoutMs);

      this.silenceTimers.set(timerKey, timer);
      console.log(`⏱️ [TIMER] Silence timer reset (${config.hybridBuffer.silenceTimeoutSeconds}s)`);

      return null;

    } catch (error) {
      console.error(`💥 [ERROR] processMessage failed:`, error.message);
      logger.error('Error in processMessage', { error });
      return null;
    }
  }

  /**
   * Process a batch of messages through the AI pipeline
   * 
   * @param {string} channelId - Slack channel ID
   * @param {string|null} threadTs - Thread timestamp or null
   * @param {string} triggerType - 'max_cap' or 'silence'
   * @param {object} client - Slack client for notifications
   */
  async processBatch(channelId, threadTs, triggerType, client) {
    try {
      const buffer = await this.getBuffer(channelId, threadTs);
      const batchToAnalyze = [...buffer.messages];

      if (batchToAnalyze.length === 0) {
        console.log(`⏭️ [BATCH] Empty buffer, skipping`);
        return null;
      }

      console.log(`\n🔄 [BATCH] Processing ${batchToAnalyze.length} messages (trigger: ${triggerType})`);
      this.stats.batchesProcessed++;

      // --- THE OVERLAP LOGIC ---
      if (triggerType === 'max_cap') {
        this.stats.volumeTriggers++;
        console.log(`🔗 [OVERLAP] Keeping last ${this.overlapSize} messages for next batch`);

        // Keep last 20 messages as start of NEXT batch
        buffer.messages = batchToAnalyze.slice(-this.overlapSize);
        await this.saveBuffer(channelId, threadTs, buffer);

      } else if (triggerType === 'silence') {
        this.stats.silenceTriggers++;
        console.log(`🧹 [BUFFER] Conversation ended, clearing buffer`);

        // Natural end of conversation - clear completely
        await this.clearBuffer(channelId, threadTs);
      }

      // --- THE AI PIPELINE ---
      return await this.runAIPipeline(channelId, threadTs, batchToAnalyze, client);

    } catch (error) {
      console.error(`💥 [ERROR] processBatch failed:`, error.message);
      logger.error('Error in processBatch', { error, channelId, threadTs, triggerType });
      return null;
    }
  }

  /**
   * Run the Scout → Author AI pipeline
   * 
   * Step 1: Scout (Gemini Flash) - Filter noise, find value
   * Step 2: Author (Gemini Pro) - Write viral post (only if worthy)
   */
  async runAIPipeline(channelId, threadTs, messages, client) {
    try {
      // Build conversation text
      const conversationText = messages
        .map((msg, i) => `[${i + 1}] ${msg.text}`)
        .join('\n');

      console.log(`\n🔍 [SCOUT] Analyzing ${messages.length} messages (${conversationText.length} chars)`);

      // STEP 1: The Scout (Gemini Flash)
      const scoutResult = await geminiClient.scoutAnalyze(conversationText);

      console.log(`🔍 [SCOUT] Result: worthy=${scoutResult.worthy}, topic="${scoutResult.topic || 'none'}"`);

      if (!scoutResult.worthy) {
        console.log(`❌ [SCOUT] Not post-worthy, skipping Author`);
        return null;
      }

      // STEP 2: The Author (Gemini Pro) - only if worthy
      console.log(`\n✍️ [AUTHOR] Generating post for topic: "${scoutResult.topic}"`);

      const postContent = await geminiClient.authorGeneratePost(
        scoutResult.topic,
        scoutResult.summary,
        conversationText
      );

      if (!postContent) {
        console.log(`❌ [AUTHOR] Failed to generate post`);
        return null;
      }

      console.log(`✅ [AUTHOR] Post generated! (${postContent.length} chars)`);
      this.stats.insightsFound++;

      // Save to database using chained insert
      console.log(`💾 [DATABASE] Creating post chain...`);
      const { conversation, insight, post } = await dbHandler.createPostChain({
        workspaceId: config.slack.workspaceId,
        channelId: channelId,
        messageCount: messages.length,
        topic: scoutResult.topic,
        content: postContent,
        platform: 'linkedin',
        confidence: 0.9,
      });
      console.log(`✅ [DATABASE] Post chain created! Post ID: ${post?.id || 'unknown'}`);

      // Notify user
      if (!config.features.dryRunMode) {
        console.log(`📢 [NOTIFY] Sending notification...`);

        const notificationMessage = `🎯 *Post Idea Detected!*

📌 *Topic:* ${scoutResult.topic}

📝 *Suggested Post:*
${postContent}

📊 *Platform:* LinkedIn

---
_Reply with \`@PostSuggestionBot generate image\` to create a visual, or ask me to refine this post._`;

        await notifier.postInChannel(channelId, threadTs, notificationMessage);
        console.log(`✅ [NOTIFY] User notified!`);
        metrics.trackNotification(true, 1);

        // Log notification delivery
        await dbHandler.logNotification(conversation.id, 'post_detected');
      } else {
        console.log(`🔇 [DRY RUN] Would have sent notification`);
      }

      return { conversation, insight, post, topic: scoutResult.topic, postContent };

    } catch (error) {
      console.error(`💥 [ERROR] AI Pipeline failed:`, error.message);
      logger.error('Error in AI pipeline', { error, channelId, threadTs });
      return null;
    }
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    return {
      ...this.stats,
      activeBuffers: this.localBuffers.size,
      activeTimers: this.silenceTimers.size,
    };
  }

  /**
   * Clean up resources on shutdown
   */
  shutdown() {
    console.log(`\n🛑 [SHUTDOWN] Cleaning up HybridBufferAnalyzer...`);

    // Cancel all timers
    for (const timer of this.silenceTimers.values()) {
      clearTimeout(timer);
    }
    this.silenceTimers.clear();

    console.log(`✅ [SHUTDOWN] Cleanup complete`);
  }
}

module.exports = new HybridBufferAnalyzer();
