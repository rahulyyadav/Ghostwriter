const geminiClient = require('../llm/geminiClient');
const insightRepo = require('../database/insightRepository');
const generatedPostRepo = require('../database/generatedPostRepository');
const notificationRepo = require('../database/notificationRepository');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * CommandHandler - Handles user commands for post generation
 */
class CommandHandler {
  constructor() {
    this.slackClient = null;
    this.imageGenerator = null;
    // Store reviewed ideas by thread/channel for context persistence
    this.reviewedIdeas = new Map(); // key: threadTs or channelId, value: { content, userId, timestamp }
  }

  /**
   * Set the Slack client (called after app initialization)
   */
  setSlackClient(client) {
    this.slackClient = client;
  }

  /**
   * Set the image generator (optional, for image generation feature)
   */
  setImageGenerator(generator) {
    this.imageGenerator = generator;
  }

  /**
   * Main command router
   */
  async handleCommand(command, message, client) {
    const { commandType, platform, channelId, threadTs, userId } = command;

    logger.info('Handling command', { commandType, platform, userId, channelId });

    try {
      switch (commandType) {
        case 'generate_post':
          await this.handleGeneratePost(command, message, client);
          break;
        case 'generate_image':
          await this.handleGenerateImage(command, message, client);
          break;
        case 'list_ideas':
          await this.handleListIdeas(command, message, client);
          break;
        case 'save':
          await this.handleSave(command, message, client);
          break;
        case 'regenerate':
          await this.handleRegenerate(command, message, client);
          break;
        case 'mark_published':
          await this.handleMarkPublished(command, message, client);
          break;
        case 'review_idea':
          await this.handleReviewIdea(command, message, client);
          break;
        case 'help':
          await this.sendHelpMessage(channelId, threadTs, client, command.isDM);
          break;
        default:
          await this.sendHelpMessage(channelId, threadTs, client, command.isDM);
      }
    } catch (error) {
      logger.error('Command handling failed', { error, commandType });
      await this.sendErrorMessage(channelId, threadTs, client, error.message);
    }
  }

  /**
   * Handle generate post command
   */
  async handleGeneratePost(command, message, client) {
    const { platform, channelId, threadTs, userId, isDM } = command;

    // If no platform specified, ask user to choose
    if (!platform) {
      await this.askForPlatform(channelId, threadTs, client, isDM);
      return;
    }

    // Find the insight associated with this thread
    const insight = await this.findInsightForThread(threadTs, channelId);

    // If no insight found, check if there's user-submitted idea content in the message
    // or if we recently reviewed an idea from this user
    if (!insight) {
      // Try to extract idea from the current message
      let ideaContent = this.extractIdeaContent(message.text);

      // If no idea in message, check for reviewed idea by thread context
      // Thread replies use thread_ts which points to original message's ts
      // Also check channelId+userId as fallback
      const threadKey = threadTs; // For thread replies, this is the original message's ts
      const userChannelKey = `${channelId}:${userId}`;

      let reviewedIdea = this.reviewedIdeas.get(threadKey);
      if (!reviewedIdea) {
        reviewedIdea = this.reviewedIdeas.get(userChannelKey);
      }

      if ((!ideaContent || ideaContent.length < 20) && reviewedIdea && reviewedIdea.userId === userId) {
        ideaContent = reviewedIdea.content;
        logger.debug('Using reviewed idea from context', { key: threadKey || userChannelKey, ideaLength: ideaContent.length });
      }

      // Fallback to lastReviewedIdea for backward compatibility
      if ((!ideaContent || ideaContent.length < 20) && this.lastReviewedIdea && this.lastReviewedIdea.userId === userId) {
        ideaContent = this.lastReviewedIdea.content;
        logger.debug('Using lastReviewedIdea fallback', { ideaLength: ideaContent.length });
      }

      if (ideaContent && ideaContent.length >= 20) {
        // Generate post from user-submitted idea
        await this.handleGenerateFromUserIdea(ideaContent, platform, channelId, threadTs, userId, client, isDM);
        return;
      }

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: isDM ? undefined : threadTs,
        text: "I couldn't find an idea to generate a post from.\n\n*To generate a post, you can:*\n• Share your idea first: \"What do you think of this idea: [your content]\"\n• Then say: \"generate post for twitter\" or \"generate post for linkedin\"\n\nOr reply to one of my post suggestion notifications in a channel.",
      });
      return;
    }

    // Send "typing" indicator
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Generating ${platform === 'twitter' ? 'tweet' : 'LinkedIn post'}...`,
    });

    // Generate the post
    const postContent = await geminiClient.generatePost(insight, platform);

    // Save to database
    const savedPost = await generatedPostRepo.create({
      insightId: insight.id,
      userId,
      platform,
      content: postContent,
      status: 'draft',
    });

    // Send the generated post with actions
    await this.sendGeneratedPost(channelId, threadTs, client, savedPost, platform);
  }

  /**
   * Handle generating a post from user-submitted idea content
   */
  async handleGenerateFromUserIdea(ideaContent, platform, channelId, threadTs, userId, client, isDM) {
    // Send "typing" indicator
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: isDM ? undefined : threadTs,
      text: `Generating ${platform === 'twitter' ? 'tweet' : 'LinkedIn post'} from your idea...`,
    });

    // Generate the post using the user's idea
    const postContent = await geminiClient.generatePostFromUserIdea(ideaContent, platform);

    // Create a mock "saved post" object for display (not saving to DB without insight)
    const postDisplay = {
      content: postContent,
      version: 1,
    };

    // Store for potential regeneration
    this.lastGeneratedFromIdea = {
      ideaContent,
      platform,
      postContent,
      userId,
      channelId,
      threadTs,
    };

    // Send the generated post
    await this.sendGeneratedPost(channelId, isDM ? undefined : threadTs, client, postDisplay, platform);
  }

  /**
   * Handle generate image command
   */
  async handleGenerateImage(command, message, client) {
    const { channelId, threadTs, userId } = command;

    // Check if image generation is enabled
    if (!config.features.enableImageGeneration || !this.imageGenerator) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "Image generation is not currently enabled. Please configure the Leonardo AI API key.",
      });
      return;
    }

    // Find the most recent generated post for this thread/insight
    const insight = await this.findInsightForThread(threadTs, channelId);
    if (!insight) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "I couldn't find a post to generate an image for. Please generate a post first.",
      });
      return;
    }

    const latestPost = await generatedPostRepo.findLatestByInsightId(insight.id);
    if (!latestPost) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "Please generate a post first before creating an image.",
      });
      return;
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: "Generating image... This may take a moment.",
    });

    // Generate image prompt from post content
    const imagePrompt = await geminiClient.generateImagePrompt(latestPost.content, latestPost.platform);

    // Generate image using Leonardo AI
    const imageResult = await this.imageGenerator.generateImage(imagePrompt);

    // Upload to Slack
    await this.imageGenerator.uploadToSlack(
      client,
      channelId,
      threadTs,
      imageResult.base64,
      `post-image-${Date.now()}.png`
    );

    // Update the post record with image info
    await generatedPostRepo.updateImage(latestPost.id, imageResult.url || 'uploaded', imagePrompt);

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Image generated using prompt: _"${imagePrompt}"_`,
    });
  }

  /**
   * Handle list ideas command
   */
  async handleListIdeas(command, message, client) {
    const { channelId, threadTs, userId, isDM } = command;

    const posts = await generatedPostRepo.findByUserId(userId, { limit: 5 });

    if (posts.length === 0) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: isDM ? undefined : threadTs,
        text: "You don't have any saved post ideas yet. Generate a post from a suggestion to get started!\n\nInvite me to a channel where interesting discussions happen, and I'll help you find post-worthy insights.",
      });
      return;
    }

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Your Saved Post Ideas' },
      },
    ];

    for (const post of posts) {
      const platformEmoji = post.platform === 'twitter' ? '🐦' : '💼';
      const statusEmoji = post.status === 'published' ? '✅' : '📝';
      const preview = post.content.length > 100
        ? post.content.substring(0, 100) + '...'
        : post.content;

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${platformEmoji} ${statusEmoji} *${post.platform}* (v${post.version})\n${preview}`,
        },
      });

      blocks.push({ type: 'divider' });
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: isDM ? undefined : threadTs,
      blocks,
      text: 'Your saved post ideas',
    });
  }

  /**
   * Handle save command
   */
  async handleSave(command, message, client) {
    const { channelId, threadTs, userId } = command;

    // Find the insight and latest post
    const insight = await this.findInsightForThread(threadTs, channelId);
    if (!insight) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "Nothing to save. Generate a post first!",
      });
      return;
    }

    const latestPost = await generatedPostRepo.findLatestByInsightId(insight.id);
    if (!latestPost) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "No generated post found to save.",
      });
      return;
    }

    // Already saved as draft by default, just confirm
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `✅ Your ${latestPost.platform} post has been saved! Use \`list my ideas\` to see all saved posts.`,
    });
  }

  /**
   * Handle regenerate command
   */
  async handleRegenerate(command, message, client) {
    const { channelId, threadTs, userId } = command;

    // Find the insight and latest post
    const insight = await this.findInsightForThread(threadTs, channelId);
    if (!insight) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "I couldn't find the original insight. Please start from a post suggestion notification.",
      });
      return;
    }

    const latestPost = await generatedPostRepo.findLatestByInsightId(insight.id);
    if (!latestPost) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "No previous post found. Use `generate post for twitter` or `generate post for linkedin` first.",
      });
      return;
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Regenerating ${latestPost.platform} post...`,
    });

    // Generate alternative version
    const newContent = await geminiClient.generateAlternativePost(
      insight,
      latestPost.platform,
      latestPost.content
    );

    // Create new version
    const newPost = await generatedPostRepo.create({
      insightId: insight.id,
      userId,
      platform: latestPost.platform,
      content: newContent,
      status: 'draft',
    });

    // Update version number
    await generatedPostRepo.updateContent(newPost.id, newContent, latestPost.version + 1);

    await this.sendGeneratedPost(channelId, threadTs, client, { ...newPost, version: latestPost.version + 1 }, latestPost.platform);
  }

  /**
   * Handle mark as published command
   */
  async handleMarkPublished(command, message, client) {
    const { channelId, threadTs, userId } = command;

    const insight = await this.findInsightForThread(threadTs, channelId);
    if (!insight) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "Couldn't find the post to mark as published.",
      });
      return;
    }

    const latestPost = await generatedPostRepo.findLatestByInsightId(insight.id);
    if (!latestPost) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "No saved post found to mark as published.",
      });
      return;
    }

    await generatedPostRepo.updateStatus(latestPost.id, 'published');

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: "🎉 Congrats! Your post has been marked as published. Keep sharing great content!",
    });
  }

  /**
   * Fetch recent channel messages for context (sliding window)
   */
  async fetchChannelContext(channelId, client, limit = 50) {
    try {
      const result = await client.conversations.history({
        channel: channelId,
        limit: limit,
      });

      if (!result.ok || !result.messages) {
        logger.warn('Failed to fetch channel history', { channelId });
        return [];
      }

      // Filter out bot messages and format for analysis
      const messages = result.messages
        .filter(m => !m.bot_id && m.text)
        .reverse() // Oldest first
        .map(m => ({
          user: m.user,
          text: m.text,
          ts: m.ts,
        }));

      logger.debug('Fetched channel context', { channelId, messageCount: messages.length });
      return messages;
    } catch (error) {
      logger.error('Error fetching channel context', { error, channelId });
      return [];
    }
  }

  /**
   * Format channel messages for LLM context
   */
  formatMessagesForContext(messages) {
    return messages
      .map(m => m.text)
      .join('\n---\n');
  }

  /**
   * Handle review idea command - user is asking for feedback on their post idea
   * When bot is mentioned, we use Gemini directly to analyze the conversation
   */
  async handleReviewIdea(command, message, client) {
    const { channelId, threadTs, userId, isDM, isChannelMention } = command;

    // Extract the idea content from the message
    let ideaContent = this.extractIdeaContent(message.text);
    let channelContext = '';
    let databaseContext = '';

    // For channel mentions, ALWAYS fetch the sliding window context
    if (!isDM) {
      logger.info('Fetching channel context for Gemini analysis', { channelId, isChannelMention });
      const recentMessages = await this.fetchChannelContext(channelId, client, 50);
      if (recentMessages.length > 0) {
        channelContext = this.formatMessagesForContext(recentMessages);
      }

      // Also fetch recent insights from database for additional context
      try {
        const recentInsights = await insightRepo.findRecentInsights(5);
        if (recentInsights.length > 0) {
          databaseContext = '\n\n--- PREVIOUS POST IDEAS (from database) ---\n' +
            recentInsights.map((insight, i) =>
              `[${i + 1}] ${insight.suggested_angle || 'Post idea'}: ${insight.core_insight?.substring(0, 200)}...`
            ).join('\n');
          logger.info('Added database context', { insightCount: recentInsights.length });
        }
      } catch (err) {
        logger.warn('Could not fetch database context', { error: err.message });
      }
    }

    // Combine all context: channel history + database insights + current message
    const fullContext = channelContext
      ? channelContext + databaseContext + '\n---\nCURRENT MESSAGE: ' + message.text
      : ideaContent || message.text;

    // Send thinking indicator
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: isDM ? undefined : threadTs,
      text: "Let me analyze this... 🤔",
    });

    // Use Gemini to analyze the conversation and respond naturally
    const analysis = await geminiClient.analyzeConversationAndRespond(fullContext, message.text);

    // Store the detected idea content for follow-up commands (like "generate post for twitter")
    if (analysis.detectedIdea && analysis.detectedIdea.length > 20) {
      const originalMessageTs = command.messageTs;
      const threadKey = originalMessageTs;
      const userChannelKey = `${channelId}:${userId}`;

      const ideaData = {
        content: analysis.detectedIdea,
        userId,
        channelId,
        threadTs,
        messageTs: originalMessageTs,
        timestamp: Date.now(),
      };

      this.reviewedIdeas.set(threadKey, ideaData);
      this.reviewedIdeas.set(userChannelKey, ideaData);

      // Also set lastReviewedIdea for backward compatibility
      this.lastReviewedIdea = {
        content: analysis.detectedIdea,
        userId,
        channelId,
        threadTs,
      };
    }

    // Send Gemini's natural response first
    let responseText = analysis.response;

    // Add helpful commands hint if an idea was detected
    if (analysis.hasIdea) {
      responseText += `\n\n💡 *Ready to create a post?*\n• \`generate post for twitter\` - Create a tweet\n• \`generate post for linkedin\` - Create a LinkedIn post`;
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: isDM ? undefined : threadTs,
      text: responseText,
    });

    // If user wants an image and we have a prompt, generate it
    if (analysis.wantsImage && analysis.imagePrompt) {
      // Check if image generation is enabled
      if (!config.features.enableImageGeneration || !this.imageGenerator) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: isDM ? undefined : threadTs,
          text: "🖼️ Image generation is not currently enabled. Please configure the Leonardo AI API key.",
        });
      } else {
        try {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: isDM ? undefined : threadTs,
            text: `🎨 Generating image with prompt: _"${analysis.imagePrompt}"_\n\nThis may take a moment...`,
          });

          // Generate image using Leonardo AI
          const imageResult = await this.imageGenerator.generateImage(analysis.imagePrompt);

          if (imageResult.url) {
            // Upload to Slack
            await this.imageGenerator.uploadToSlack(
              client,
              channelId,
              threadTs,
              imageResult.url,
              `generated-image-${Date.now()}.png`
            );

            await client.chat.postMessage({
              channel: channelId,
              thread_ts: isDM ? undefined : threadTs,
              text: "✅ Image generated successfully!",
            });
          }
        } catch (imageError) {
          logger.error('Image generation failed', { error: imageError.message });
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: isDM ? undefined : threadTs,
            text: `❌ Image generation failed: ${imageError.message}`,
          });
        }
      }
    }
  }

  /**
   * Extract the actual idea content from a message
   */
  extractIdeaContent(text) {
    if (!text) return null;

    // Remove bot mentions
    let content = text.replace(/<@[A-Z0-9]+>/g, '').trim();

    // Remove common prefixes
    const prefixes = [
      /^(what\s+(do\s+)?you\s+think\s+(of|about)\s*(this\s*)?(idea)?(\?)?:?\s*)/i,
      /^(how\s+is\s+this(\s+idea)?(\?)?:?\s*)/i,
      /^(is\s+this\s+(a\s+)?good(\s+one)?(\?)?:?\s*)/i,
      /^(review\s*(this)?:?\s*)/i,
      /^(feedback\s*(on)?:?\s*)/i,
      /^(this\s+is\s+(my\s+|the\s+|an?\s+)?idea:?\s*)/i,
      /^(here('s| is)\s+(my\s+|the\s+|an?\s+)?idea:?\s*)/i,
      /^((my|an?)\s+idea\s+(for|is):?\s*)/i,
      /^(rate\s+this:?\s*)/i,
      /^(evaluate\s*(this)?:?\s*)/i,
    ];

    for (const prefix of prefixes) {
      content = content.replace(prefix, '');
    }

    return content.trim();
  }

  /**
   * Send idea review feedback
   */
  async sendIdeaReview(channelId, threadTs, client, review, isDM) {
    const ratingEmoji = {
      excellent: '🌟',
      good: '👍',
      needs_work: '💡',
    };

    const emoji = ratingEmoji[review.rating] || '📝';
    const scoreDisplay = '⭐'.repeat(Math.min(Math.round(review.score / 2), 5));

    let blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} Post Idea Review`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Rating:* ${review.rating.replace('_', ' ')} ${scoreDisplay} (${review.score}/10)`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Feedback:*\n${review.feedback}`,
        },
      },
    ];

    if (review.strengths && review.strengths.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Strengths:*\n${review.strengths.map(s => `• ${s}`).join('\n')}`,
        },
      });
    }

    if (review.improvements && review.improvements.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Suggestions for improvement:*\n${review.improvements.map(s => `• ${s}`).join('\n')}`,
        },
      });
    }

    if (review.improvedVersion) {
      blocks.push({
        type: 'divider',
      });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Suggested improved version:*\n${review.improvedVersion}`,
        },
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Best for: *${review.bestPlatform}* | Reply with \`generate post for twitter\` or \`generate post for linkedin\` to create a polished version!`,
        },
      ],
    });

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: isDM ? undefined : threadTs,
      blocks,
      text: `Post idea review: ${review.rating} (${review.score}/10)`,
    });
  }

  /**
   * Send conversational review feedback (natural tone)
   */
  async sendConversationalReview(channelId, threadTs, client, review, isDM) {
    // Build a natural, conversational message
    let message = review.conversationalResponse || review.feedback;

    // Add helpful commands at the end
    const helpText = `\n\n💡 *What's next?*\n• \`generate post for twitter\` - Create a tweet\n• \`generate post for linkedin\` - Create a LinkedIn post`;

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: isDM ? undefined : threadTs,
      text: message + helpText,
    });
  }

  /**
   * Find insight for a thread by looking up notification
   */
  async findInsightForThread(threadTs, channelId) {
    try {
      // Try to find notification by thread_ts (the notification's message_ts)
      const notification = await notificationRepo.findByMessageTs(threadTs);

      if (notification && notification.conversation_id) {
        // Find the insight for this conversation
        const insights = await insightRepo.findByConversationId(notification.conversation_id);
        if (insights && insights.length > 0) {
          return insights[0]; // Return the most recent insight
        }
      }

      // Fallback: try to find by channel
      logger.debug('No notification found for thread, trying channel lookup', { threadTs, channelId });
      return null;
    } catch (error) {
      logger.error('Error finding insight for thread', { error, threadTs, channelId });
      return null;
    }
  }

  /**
   * Send generated post with formatting
   */
  async sendGeneratedPost(channelId, threadTs, client, post, platform) {
    const platformName = platform === 'twitter' ? 'Twitter/X' : 'LinkedIn';
    const charLimit = platform === 'twitter' ? 280 : 'unlimited';
    const charCount = post.content.length;

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${platform === 'twitter' ? '🐦' : '💼'} Generated ${platformName} Post`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: post.content,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `📊 ${charCount} characters ${platform === 'twitter' ? `(limit: ${charLimit})` : ''} | Version ${post.version || 1}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*What would you like to do?*\n• `regenerate` - Get a different version\n• `generate image` - Create an image for this post\n• `save` - Save this draft\n• `published` - Mark as published after posting',
        },
      },
    ];

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks,
      text: `Generated ${platformName} post: ${post.content.substring(0, 100)}...`,
    });
  }

  /**
   * Ask user to choose platform
   */
  async askForPlatform(channelId, threadTs, client, isDM = false) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: isDM ? undefined : threadTs,
      text: "Which platform would you like to generate a post for?\n• `generate post for twitter` - Create a tweet (280 chars)\n• `generate post for linkedin` - Create a LinkedIn post",
    });
  }

  /**
   * Send help message
   */
  async sendHelpMessage(channelId, threadTs, client, isDM = false) {
    let helpText;

    if (isDM) {
      helpText = `*Hi! I'm PostSuggestionBot*

I help you create and refine social media posts!

*What I can do:*
1. *Review your post ideas* - Share an idea and I'll give you feedback
2. *Generate polished posts* - I'll create Twitter/LinkedIn versions
3. *Detect insights from channels* - Invite me to watch for post-worthy discussions

*Share your idea for review:*
Just paste your post idea or say "What do you think of this: [your idea]"

*Commands:*
• \`generate post for twitter\` - Create a tweet
• \`generate post for linkedin\` - Create a LinkedIn post
• \`list my ideas\` - View your saved drafts
• \`regenerate\` - Get a different version
• \`save\` - Save post as draft
• \`published\` - Mark as published

*For channel insights:*
Invite me to a channel using \`/invite @PostSuggestionBot\``;
    } else {
      helpText = `*Available Commands:*

• \`generate post for twitter\` - Create a tweet from this insight
• \`generate post for linkedin\` - Create a LinkedIn post from this insight
• \`generate image\` - Create an image for your post
• \`regenerate\` - Generate a new version
• \`save\` - Save this post as a draft
• \`list my ideas\` - View your saved post ideas
• \`published\` - Mark a saved post as published`;
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: isDM ? undefined : threadTs, // Don't use thread_ts in DMs
      text: helpText,
    });
  }

  /**
   * Send error message
   */
  async sendErrorMessage(channelId, threadTs, client, errorMsg) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `❌ Something went wrong: ${errorMsg}\n\nPlease try again or contact support.`,
    });
  }
}

module.exports = new CommandHandler();
