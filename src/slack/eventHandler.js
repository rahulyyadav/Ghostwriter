const MessageParser = require('../services/messageParser');
const conversationManager = require('../services/conversationManager');
const summaryCompressor = require('../services/summaryCompressor');
const insightDetector = require('../services/insightDetector');
const simpleAnalyzer = require('../services/simpleConversationAnalyzer');
const CommandDetector = require('../services/commandDetector');
const commandHandler = require('../services/commandHandler');
const dbHandler = require('../database/dbHandler');
const imageGenerator = require('../services/imageGenerator');
const geminiClient = require('../llm/geminiClient');
const notifier = require('./notifier');
const config = require('../config/config');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

/**
 * Slack event handler - entry point for all Slack events
 */
class EventHandler {
  constructor(app) {
    this.app = app;
    this.botUserId = null;
    this.setupHandlers();
    this.fetchBotUserId();
  }

  /**
   * Fetch the bot's user ID for mention detection
   */
  async fetchBotUserId() {
    try {
      const result = await this.app.client.auth.test();
      this.botUserId = result.user_id;
      logger.info('Bot user ID retrieved', { botUserId: this.botUserId });
    } catch (error) {
      logger.error('Failed to fetch bot user ID', { error });
    }
  }

  /**
   * Setup Slack event handlers
   */
  setupHandlers() {
    // Handle all messages
    // In HTTP mode, ack() must be called to acknowledge the event within 3 seconds
    this.app.message(async ({ message, client, ack }) => {
      try {
        // Acknowledge immediately for HTTP mode (prevents 3-second timeout)
        if (ack) await ack();

        await this.handleMessage(message, client);
      } catch (error) {
        logger.error('Error handling message event', { error, message });
      }
    });

    // Handle @mentions
    // In HTTP mode, ack() must be called to acknowledge the event within 3 seconds
    this.app.event('app_mention', async ({ event, client, ack }) => {
      try {
        // Acknowledge immediately for HTTP mode (prevents 3-second timeout)
        if (ack) await ack();

        await this.handleAppMention(event, client);
      } catch (error) {
        logger.error('Error handling app_mention event', { error, event });
      }
    });

    // Handle errors
    this.app.error(async (error) => {
      logger.error('Slack app error', { error });
    });
  }

  /**
   * Handle @PostSuggestionBot mentions AND Direct Messages
   * - Fetches last 3-5 posts for context
   * - Detects "generate image" intent
   * - Responds with context-aware answers
   */
  async handleAppMention(event, client) {
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const userMessage = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
    const userId = event.user;
    const isDM = event.isDM || false;

    if (isDM) {
      console.log(`\n💬 [DM] Handling direct message from ${userId}`);
    } else {
      console.log(`\n📢 [MENTION] @PostSuggestionBot mentioned by ${userId}`);
    }
    console.log(`📝 [MESSAGE] "${userMessage}"`);

    try {
      // Fetch recent posts for context
      // For DMs: fetch across all channels (user's recent ideas)
      // For mentions: fetch from specific channel
      let recentPosts;
      if (isDM) {
        recentPosts = await dbHandler.getRecentPosts(5); // All channels, last 5
        console.log(`📚 [CONTEXT] Found ${recentPosts.length} recent posts (all channels)`);
      } else {
        recentPosts = await dbHandler.getRecentPostsForChannel(channelId, 3);
        console.log(`📚 [CONTEXT] Found ${recentPosts.length} recent posts (this channel)`);
      }

      // Check if user wants to generate an image
      const wantsImage = /generate\s*image|create\s*image|make\s*image|image\s*for|visual/i.test(userMessage);

      if (wantsImage) {
        await this.handleImageGeneration(event, client, recentPosts);
        return;
      }

      // General query with context
      await this.handleContextualQuery(event, client, userMessage, recentPosts);

    } catch (error) {
      console.error(`💥 [${isDM ? 'DM' : 'MENTION'}] Error:`, error.message);
      logger.error('App mention/DM handling failed', { error, channelId, userId, isDM });

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `Sorry, I encountered an error. Please try again! 🙏`,
      });
    }
  }

  /**
   * Handle "generate image" requests
   */
  async handleImageGeneration(event, client, recentPosts) {
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const isDM = event.isDM || false;

    // Helper to build reply options (skip thread_ts for DMs)
    const replyOpts = (text) => ({
      channel: channelId,
      ...(isDM ? {} : { thread_ts: threadTs }),
      text,
    });

    if (recentPosts.length === 0) {
      await client.chat.postMessage(replyOpts(`I don't have any recent posts to generate an image for. Try chatting more so I can detect some ideas first! 💡`));
      return;
    }

    // Get the most recent post
    const latestPost = recentPosts[0];
    const postContent = latestPost.content;
    const postId = latestPost.id;
    const topic = latestPost.insight?.core_insight || 'Unknown topic';

    console.log(`🎨 [IMAGE] Generating image for post: ${topic}`);

    // Acknowledge request
    await client.chat.postMessage(replyOpts(`🎨 Generating an image for your post about *"${topic}"*... This may take 15-30 seconds.`));

    try {
      // Ask Gemini to create a visual prompt
      const imagePrompt = await geminiClient.generateImagePrompt(postContent, 'linkedin');
      console.log(`🎨 [IMAGE] Prompt: ${imagePrompt.substring(0, 100)}...`);

      // Generate image with Leonardo
      if (!imageGenerator.isAvailable()) {
        await client.chat.postMessage(replyOpts(`Image generation is not configured. Please add LEONARDO_API_KEY to your environment.`));
        return;
      }

      const imageResult = await imageGenerator.generateImage(imagePrompt, {
        width: 1024,
        height: 1024,
      });

      if (!imageResult.url) {
        throw new Error('No image URL returned');
      }

      // Update database with image
      await dbHandler.updatePostWithImage(postId, imageResult.url, imagePrompt);

      // Upload to Slack (use threadTs for channels, null for DMs)
      await imageGenerator.uploadToSlack(client, channelId, isDM ? null : threadTs, imageResult.url, 'post-image.png');

      await client.chat.postMessage(replyOpts(`✅ Here's your image! You can download it and use it with your LinkedIn post.`));

      console.log(`✅ [IMAGE] Generated and uploaded!`);

    } catch (error) {
      console.error(`💥 [IMAGE] Error:`, error.message);
      await client.chat.postMessage(replyOpts(`Sorry, I couldn't generate the image. ${error.message}`));
    }
  }

  /**
   * Handle general contextual queries
   */
  async handleContextualQuery(event, client, userMessage, recentPosts) {
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const isDM = event.isDM || false;

    // Build context from recent posts
    let contextText = '';
    if (recentPosts.length > 0) {
      contextText = recentPosts.map((post, i) => {
        const topic = post.insight?.core_insight || 'Unknown';
        return `POST ${i + 1}: Topic: "${topic}"\nContent: ${post.content.substring(0, 300)}...`;
      }).join('\n\n');
    }

    console.log(`💬 [QUERY] Processing contextual query...`);

    // Ask Gemini with context
    const result = await geminiClient.analyzeConversationAndRespond(contextText, userMessage);

    // Reply directly in DMs (no thread), or in thread for channels
    const replyOpts = {
      channel: channelId,
      ...(isDM ? {} : { thread_ts: threadTs }),
      text: result.response,
    };
    await client.chat.postMessage(replyOpts);

    console.log(`✅ [QUERY] Responded!`);
  }

  /**
   * Handle incoming message
   */
  async handleMessage(message, client) {
    // DEBUG: Log EVERY message that comes in
    console.log(`\n🔔 [EVENT] Raw message received:`, {
      text: (message.text || '').substring(0, 60),
      user: message.user,
      subtype: message.subtype,
      bot_id: message.bot_id,
    });

    // Handle messages that mention the bot directly (don't wait for app_mention event)
    if (this.botUserId && message.text && message.text.includes(`<@${this.botUserId}>`)) {
      console.log(`📢 [MENTION] Bot mentioned in message, handling directly`);

      // Convert message to event-like object for handleAppMention
      const mentionEvent = {
        channel: message.channel,
        ts: message.ts,
        thread_ts: message.thread_ts,
        text: message.text,
        user: message.user,
      };

      await this.handleAppMention(mentionEvent, client);
      return;
    }

    // Handle Direct Messages (DM channels start with 'D')
    const isDM = message.channel && message.channel.startsWith('D');
    if (isDM && message.user && !message.bot_id) {
      console.log(`💬 [DM] Direct message received from ${message.user}`);

      // Convert message to event-like object for handleAppMention (same flow)
      const dmEvent = {
        channel: message.channel,
        ts: message.ts,
        thread_ts: message.thread_ts,
        text: message.text,
        user: message.user,
        isDM: true, // Flag to indicate this is a DM (no channel context)
      };

      await this.handleAppMention(dmEvent, client);
      return;
    }

    // Check if message should be processed (but allow commands through)
    const isBasicProcessable = MessageParser.shouldProcess(message);

    // Check if this is a command (reply to bot notification or mention)
    const command = CommandDetector.parse(message, this.botUserId);

    if (command.isCommand) {
      logger.info('Command detected', {
        commandType: command.commandType,
        platform: command.platform,
        userId: command.userId,
      });

      // Set the slack client on commandHandler if not already set
      commandHandler.setSlackClient(client);

      // Handle the command
      await commandHandler.handleCommand(command, message, client);
      return; // Don't process as regular conversation
    }

    // If not a command, check if it's a regular message to process
    if (!isBasicProcessable) {
      logger.debug('Skipping message', { subtype: message.subtype });
      return;
    }

    // Bot works in any channel it's invited to - no opt-in check needed

    // Use simple analyzer if enabled (recommended - much simpler!)
    if (config.features.useSimpleAnalyzer) {
      await this.handleWithSimpleAnalyzer(message, client);
      return;
    }

    // --- LEGACY: Complex signal gate approach below ---
    // Parse message
    const envelope = MessageParser.parse(message);

    logger.info('Processing message', {
      channelId: envelope.channelId,
      threadTs: envelope.threadTs,
      wordCount: envelope.wordCount,
      isBot: envelope.isBot,
    });

    // Process through conversation manager
    const result = await conversationManager.processMessage(envelope);

    if (!result) {
      logger.debug('Message filtered out (bot or noise)');
      metrics.trackMessageProcessed(true);
      return;
    }

    metrics.trackMessageProcessed(false);

    // Log state
    logger.info('Conversation updated', {
      conversationId: result.conversation.id,
      messageCount: result.conversation.message_count,
      participants: result.conversation.participant_ids.length,
      signalScore: result.conversation.signal_score,
      shouldCompress: result.shouldCompress,
    });

    // Trigger summary compression if needed
    if (result.shouldCompress) {
      logger.info('Compression triggered', { conversationId: result.conversation.id });

      try {
        const compressed = await summaryCompressor.compressConversation(result.conversation.id);
        if (compressed) {
          logger.info('Compression completed', {
            conversationId: result.conversation.id,
            summaryLength: compressed.rolling_summary?.length
          });

          // After compression, check if we should detect insight
          const shouldDetectInsight = conversationManager.shouldTriggerInsightDetection(compressed);

          if (shouldDetectInsight) {
            await this.triggerInsightDetection(compressed.id);
          }
        }
      } catch (error) {
        logger.error('Compression failed, continuing without it', { error, conversationId: result.conversation.id });
      }
    } else {
      // Even without compression, check if insight detection should run
      const shouldDetectInsight = conversationManager.shouldTriggerInsightDetection(
        result.conversation
      );

      if (shouldDetectInsight) {
        await this.triggerInsightDetection(result.conversation.id);
      }
    }
  }

  /**
   * Handle message using simple sliding window analyzer
   * (Much simpler than the complex signal gate approach!)
   */
  async handleWithSimpleAnalyzer(message, client) {
    try {
      logger.debug('Processing with simple analyzer', {
        channelId: message.channel,
        threadTs: message.thread_ts,
      });

      metrics.trackMessageProcessed(false);

      // Simple analyzer handles everything: sliding window, Gemini calls, notifications
      const result = await simpleAnalyzer.processMessage(message, client);

      if (result && result.insight) {
        logger.info('Simple analyzer detected insight!', {
          insightId: result.insight.id,
          title: result.analysis.title,
          confidence: result.analysis.confidence,
        });
        metrics.trackNotification(true, 1);
      }
    } catch (error) {
      logger.error('Simple analyzer error', { error });
      // Don't throw - we don't want analysis errors to break the bot
    }
  }

  /**
   * Trigger insight detection
   */
  async triggerInsightDetection(conversationId) {
    try {
      logger.info('Insight detection triggered', { conversationId });

      const result = await insightDetector.detectInsight(conversationId);

      if (!result) {
        logger.debug('No insight result returned', { conversationId });
        return;
      }

      if (result.shouldNotify) {
        logger.info('Post-worthy insight detected, triggering notification', {
          conversationId,
          insightId: result.insight.id,
          confidence: result.insight.confidence,
        });

        // Send notification
        try {
          const notificationResult = await notifier.notify(result.insight, result.conversation);

          if (notificationResult.success) {
            metrics.trackNotification(true, notificationResult.recipientCount);
            logger.info('Notification sent successfully', {
              conversationId,
              recipientCount: notificationResult.recipientCount,
              dryRun: notificationResult.dryRun,
            });
          }
        } catch (error) {
          logger.error('Notification failed', { error, conversationId });
          metrics.trackNotification(false);
          metrics.trackError('notification');
        }
      } else {
        logger.debug('Insight not post-worthy or already notified', {
          conversationId,
          isPostWorthy: result.insight?.is_post_worthy,
          alreadyNotified: result.conversation?.notified,
        });
      }
    } catch (error) {
      logger.error('Insight detection failed', { error, conversationId });
    }
  }
}

module.exports = EventHandler;
