const logger = require('../utils/logger');

/**
 * Command patterns for detecting user intents
 * IMPORTANT: Order matters! More specific patterns should come before generic ones.
 */
const COMMAND_PATTERNS = {
  // Generate post for Twitter/X - includes "create a tweet" without needing "for twitter"
  generateTwitter: /\b(generate|create|write|draft|make)\s+(a\s+)?(post|tweet|thread)?\s*(for\s+)?(twitter|x)\b|\b(create|make|write)\s+(a\s+)?tweet\b/i,

  // Generate post for LinkedIn - includes "create a linkedin post"
  generateLinkedIn: /\b(generate|create|write|draft|make)\s+(a\s+)?(post)?(\s+on|\s+for)?\s*linkedin(\s+post)?\b/i,

  // Generic generate post (will ask for platform)
  generatePost: /\b(generate|create|write|draft|make)\s+(a\s+)?(post|content)\b/i,

  // Generate image - includes various ways to ask for an image
  generateImage: /\b(generate|create|make|add)\s+(an?\s+)?image\b|\bimage\s+(for|of)\s+(this|the)\s+post\b|\bcan\s+you\s+(generate|create|make)\b.*\bimage\b/i,

  // List saved ideas/posts
  listIdeas: /\b(list|show|view|my)\s+(saved\s+)?(ideas?|posts?|drafts?)\b/i,

  // Save current post
  save: /^(save|store|keep)(\s+(this|it))?$/i, // More strict - must be primarily the command

  // Regenerate/try again
  regenerate: /\b(regenerate|redo|try\s+again|another\s+one|new\s+version)\b/i,

  // Mark as published
  markPublished: /^(published|posted|done|mark\s+(as\s+)?published)$/i, // More strict

  // Review/feedback on an idea - user is asking for feedback on their post idea
  reviewIdea: /(what\s+(do\s+)?you\s+think|how\s+is\s+this|is\s+this\s+(a\s+)?good|give\s+(me\s+)?feedback|thoughts\s+on|opinion\s+on|rate\s+this|evaluate|how('s| is)\s+this)/i,

  // User is sharing an idea (for DMs especially)
  shareIdea: /\b(this\s+is\s+(my\s+|the\s+|an?\s+)?idea|here('s| is)\s+(my\s+|the\s+|an?\s+)?idea|(my|an?)\s+idea\s+(for|is)|post\s+idea|idea\s+for\s+(a\s+)?(post|linkedin|twitter|x))\b/i,
};

/**
 * CommandDetector - Detects and parses commands from user messages
 */
class CommandDetector {
  /**
   * Check if a message mentions the bot
   */
  static isBotMentioned(message, botUserId) {
    if (!message.text || !botUserId) return false;
    return message.text.includes(`<@${botUserId}>`);
  }

  /**
   * Check if message is a reply in a thread
   */
  static isThreadReply(message) {
    return !!message.thread_ts && message.thread_ts !== message.ts;
  }

  /**
   * Check if channel is a DM (direct message)
   * DM channel IDs start with 'D'
   */
  static isDirectMessage(message) {
    return message.channel && message.channel.startsWith('D');
  }

  /**
   * Detect command type from message text
   */
  static detectCommandType(text) {
    if (!text) return null;

    // Clean the text (remove bot mentions)
    const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();

    // First check for explicit generation commands (highest priority)
    if (COMMAND_PATTERNS.generateTwitter.test(cleanText)) {
      return { type: 'generate_post', platform: 'twitter' };
    }

    if (COMMAND_PATTERNS.generateLinkedIn.test(cleanText)) {
      return { type: 'generate_post', platform: 'linkedin' };
    }

    if (COMMAND_PATTERNS.generateImage.test(cleanText)) {
      return { type: 'generate_image' };
    }

    if (COMMAND_PATTERNS.listIdeas.test(cleanText)) {
      return { type: 'list_ideas' };
    }

    if (COMMAND_PATTERNS.regenerate.test(cleanText)) {
      return { type: 'regenerate' };
    }

    // Generic generate post (no specific platform)
    if (COMMAND_PATTERNS.generatePost.test(cleanText)) {
      return { type: 'generate_post', platform: null };
    }

    // Check for review/feedback BEFORE simple commands like save/published
    // because those words might appear in idea content
    if (COMMAND_PATTERNS.reviewIdea.test(cleanText)) {
      return { type: 'review_idea' };
    }

    // User sharing an idea
    if (COMMAND_PATTERNS.shareIdea.test(cleanText)) {
      return { type: 'review_idea' };
    }

    // Simple single-word commands (only if message is short/simple)
    if (cleanText.length < 30) {
      if (COMMAND_PATTERNS.save.test(cleanText)) {
        return { type: 'save' };
      }

      if (COMMAND_PATTERNS.markPublished.test(cleanText)) {
        return { type: 'mark_published' };
      }
    }

    return null;
  }

  /**
   * Check if message content looks like a post idea
   * (multiline, has bullet points/dashes, substantial content)
   */
  static looksLikeIdeaContent(text) {
    if (!text) return false;

    // Remove bot mentions
    const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();

    // Must have reasonable length (at least a sentence)
    if (cleanText.length < 50) return false;

    // Check for indicators of idea/post content
    const hasLineBreaks = cleanText.includes('\n');
    // Support various bullet/dash characters including Unicode
    const hasBulletPoints = /[-•–—‣*]\s|^\s*[-•–—‣*]/m.test(cleanText);
    const hasNumberedList = /\d+[.)]\s/.test(cleanText);
    const hasMultipleSentences = (cleanText.match(/[.!?]/g) || []).length >= 2;
    const hasKeywords = /\b(result|benefit|tip|lesson|insight|learned|built|created|solution|manual|automat|agent|workflow|human|spend|hour|day)\b/i.test(cleanText);
    const hasStructuredContent = cleanText.split('\n').length >= 3;

    // Score the content
    let score = 0;
    if (hasLineBreaks) score += 2;
    if (hasBulletPoints) score += 2;
    if (hasNumberedList) score += 2;
    if (hasMultipleSentences) score += 1;
    if (hasKeywords) score += 2;
    if (hasStructuredContent) score += 1;
    if (cleanText.length > 100) score += 1;
    if (cleanText.length > 200) score += 2;

    logger.debug('Content scoring', {
      length: cleanText.length,
      hasLineBreaks,
      hasBulletPoints,
      hasNumberedList,
      hasMultipleSentences,
      hasKeywords,
      hasStructuredContent,
      score,
    });

    // Lower threshold - if content is substantial, treat it as an idea
    return score >= 2;
  }

  /**
   * Parse a message to detect if it's a command
   * @param {object} message - Slack message object
   * @param {string} botUserId - The bot's user ID
   * @returns {object} Command result
   */
  static parse(message, botUserId) {
    const isDM = this.isDirectMessage(message);

    const result = {
      isCommand: false,
      commandType: null,
      platform: null,
      channelId: message.channel,
      threadTs: message.thread_ts || message.ts,
      messageTs: message.ts,
      userId: message.user,
      rawText: message.text,
      isDM,
    };

    // Skip bot messages
    if (message.bot_id || message.subtype === 'bot_message') {
      return result;
    }

    // Check if this is a DM, thread reply, or bot mention
    const isReply = this.isThreadReply(message);
    const isMentioned = this.isBotMentioned(message, botUserId);

    // Process commands if it's a DM, thread reply, or bot is mentioned
    if (!isDM && !isReply && !isMentioned) {
      return result;
    }

    // Detect command type
    const command = this.detectCommandType(message.text);

    if (command) {
      result.isCommand = true;
      result.commandType = command.type;
      result.platform = command.platform;

      logger.debug('Command detected', {
        commandType: command.type,
        platform: command.platform,
        userId: message.user,
        channelId: message.channel,
        isDM,
      });
    } else if (isDM || isMentioned || isReply) {
      // Thread reply, DM, or mention - route to Gemini for natural conversation
      if (this.looksLikeIdeaContent(message.text)) {
        result.isCommand = true;
        result.commandType = 'review_idea';

        logger.debug('Detected idea-like content', {
          userId: message.user,
          channelId: message.channel,
          isDM,
          isMentioned,
          isReply,
        });
      } else if (isReply) {
        // Thread reply without specific command - send to Gemini for natural response
        result.isCommand = true;
        result.commandType = 'review_idea';
        result.isThreadReply = true;

        logger.debug('Thread reply detected, routing to Gemini', {
          userId: message.user,
          channelId: message.channel,
          threadTs: message.thread_ts,
        });
      } else if (isMentioned && !isDM) {
        // Bot mentioned in a channel - always try to analyze channel context
        // This allows the handler to fetch recent messages and find ideas
        result.isCommand = true;
        result.commandType = 'review_idea';
        result.isChannelMention = true; // Flag to indicate we need to fetch context

        logger.debug('Bot mentioned in channel, will analyze context', {
          userId: message.user,
          channelId: message.channel,
        });
      } else {
        // DM with unrecognized command - show help
        result.isCommand = true;
        result.commandType = 'help';

        logger.debug('Unrecognized command in DM, showing help', {
          userId: message.user,
          channelId: message.channel,
          isDM,
          isMentioned,
        });
      }
    }

    return result;
  }

  /**
   * Get help text for available commands
   */
  static getHelpText() {
    return `*Available Commands:*

• \`generate post for twitter\` - Create a tweet from this insight
• \`generate post for linkedin\` - Create a LinkedIn post from this insight
• \`generate image\` - Create an image for your post
• \`regenerate\` - Generate a new version
• \`save\` - Save this post as a draft
• \`list my ideas\` - View your saved post ideas
• \`published\` - Mark a saved post as published`;
  }
}

module.exports = CommandDetector;
