const logger = require('../utils/logger');

/**
 * Parse Slack message into MessageEnvelope
 */
class MessageParser {
  /**
   * Check if message is noise and should be filtered out
   */
  static isNoise(text, wordCount) {
    const trimmedText = text.trim().toLowerCase();

    // Rule 1: Too short
    if (wordCount < 3) return true;

    // Rule 2: Common filler patterns
    const fillerPatterns = [
      /^(ok|okay|k|kk|got it|thanks|thank you|ty|np|sure|yep|yeah|nope|lol|haha|lmao|rofl)$/,
      /^(👍|👌|✅|❤️|🙏|😊|😄|🎉)$/, // emoji-only
      /^(cc|fyi|btw|imo|imho|tbh|afaik)$/,
    ];

    if (fillerPatterns.some((pattern) => pattern.test(trimmedText))) {
      return true;
    }

    // Rule 3: Thread meta-messages
    const metaPatterns = [
      'joined the channel',
      'left the channel',
      'set the channel topic',
      'uploaded a file',
      'pinned a message',
      'changed the channel name',
    ];

    if (metaPatterns.some((pattern) => trimmedText.includes(pattern))) {
      return true;
    }

    return false;
  }

  /**
   * Count words in text
   */
  static countWords(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * Parse Slack message event into MessageEnvelope
   */
  static parse(message) {
    try {
      const text = message.text || '';
      const wordCount = this.countWords(text);

      // Filter out bots
      const isBot = message.bot_id !== undefined || message.subtype === 'bot_message';

      // Check for attachments and links
      const hasAttachments = (message.attachments && message.attachments.length > 0) ||
                            (message.files && message.files.length > 0);
      const hasLinks = /<http[s]?:\/\/[^>]+>/.test(text);

      // Create envelope
      const envelope = {
        channelId: message.channel,
        threadTs: message.thread_ts || null,
        messageTs: message.ts,
        userId: message.user,
        isBot,
        wordCount,
        hasAttachments,
        hasLinks,
        textForSummary: this.prepareTextForSummary(text, wordCount),
        receivedAt: Date.now(),
      };

      return envelope;
    } catch (error) {
      logger.error('Error parsing message', { error, message });
      throw error;
    }
  }

  /**
   * Prepare text for summary (truncate if needed, clean up)
   */
  static prepareTextForSummary(text, wordCount) {
    // Remove Slack mentions and format codes
    let cleaned = text
      .replace(/<@[A-Z0-9]+>/g, 'User') // Replace mentions with "User"
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1') // Replace channel mentions
      .replace(/<http[s]?:\/\/[^|>]+\|([^>]+)>/g, '$1') // Replace links with label
      .replace(/<http[s]?:\/\/[^>]+>/g, '[link]') // Replace bare links
      .replace(/```[^```]+```/g, '[code block]') // Replace code blocks
      .replace(/`[^`]+`/g, '[code]') // Replace inline code
      .trim();

    // Truncate to 200 chars max (for privacy + efficiency)
    if (cleaned.length > 200) {
      cleaned = cleaned.substring(0, 197) + '...';
    }

    return cleaned;
  }

  /**
   * Check if message should be processed
   */
  static shouldProcess(message) {
    // Skip if no text
    if (!message.text || message.text.trim().length === 0) {
      return false;
    }

    // Skip subtypes we don't care about
    const skipSubtypes = [
      'channel_join',
      'channel_leave',
      'channel_topic',
      'channel_purpose',
      'channel_name',
      'message_deleted',
      'message_changed',
    ];

    if (message.subtype && skipSubtypes.includes(message.subtype)) {
      return false;
    }

    return true;
  }
}

module.exports = MessageParser;
