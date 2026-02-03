const conversationRepo = require('../database/conversationRepository');
const notificationRepo = require('../database/notificationRepository');
const config = require('../config/config');
const logger = require('../utils/logger');
const { SlackAPIError } = require('../utils/errors');

/**
 * Slack notification manager
 */
class Notifier {
  constructor(slackClient = null) {
    this.slackClient = slackClient;
  }

  /**
   * Set Slack client (called after app initialization)
   */
  setClient(client) {
    this.slackClient = client;
  }

  /**
   * Build thread link
   */
  buildThreadLink(channelId, threadTs) {
    const workspaceUrl = `https://app.slack.com/client/${config.slack.workspaceId || 'YOUR-WORKSPACE'}`;

    if (threadTs) {
      const ts = threadTs.replace('.', '');
      return `${workspaceUrl}/${channelId}/p${ts}`;
    } else {
      return `${workspaceUrl}/${channelId}`;
    }
  }

  /**
   * Format notification message
   */
  formatNotificationMessage(insight) {
    return `🎯 *Post Idea Detected*

📝 *Core Insight:*
${insight.core_insight}

💡 *Suggested Angle:*
${insight.suggested_angle}

📊 *Confidence:* ${(insight.confidence * 100).toFixed(0)}%

_This conversation has strong potential for a public post._

*Reply to generate a post:*
• \`generate post for twitter\` - Create a tweet
• \`generate post for linkedin\` - Create a LinkedIn post`;
  }

  /**
   * Post notification in channel
   * @param {string} channelId - Channel to post to
   * @param {string} threadTs - Thread timestamp (optional)
   * @param {string} message - Message to post
   * @param {object} client - Slack client (optional, uses default if not provided)
   * @returns {object} Result with message_ts
   */
  async postInChannel(channelId, threadTs, message, client = null) {
    // Use provided client or fall back to default (for multi-workspace OAuth support)
    const slackClient = client || this.slackClient;

    if (!slackClient) {
      throw new Error('No Slack client available. Either pass a client or call setClient() first.');
    }

    try {
      const postOptions = {
        channel: channelId,
        text: message,
        unfurl_links: false,
      };

      // If this was a thread conversation, reply in the thread
      if (threadTs) {
        postOptions.thread_ts = threadTs;
      }

      const result = await slackClient.chat.postMessage(postOptions);

      logger.info('Notification posted in channel', { channelId, threadTs, messageTs: result.ts });
      return { success: true, messageTs: result.ts };
    } catch (error) {
      logger.error('Failed to post in channel', { error, channelId, threadTs });
      throw new SlackAPIError(`Failed to post notification in channel ${channelId}`, error);
    }
  }

  /**
   * Get channel admins (optional feature)
   */
  async getChannelAdmins(channelId) {
    try {
      const result = await this.slackClient.conversations.members({
        channel: channelId,
      });

      // In a real implementation, you'd filter for admins
      // For now, we'll skip this and just post in channel
      return [];
    } catch (error) {
      logger.warn('Failed to get channel members', { error, channelId });
      return [];
    }
  }

  /**
   * Main notification flow
   */
  async notify(insight, conversation) {
    try {
      if (!this.slackClient) {
        throw new Error('Slack client not initialized');
      }

      // Check if already notified
      if (conversation.notified) {
        logger.warn('Conversation already notified', { conversationId: conversation.id });
        return { success: false, reason: 'already_notified' };
      }

      // Check if insight is post-worthy
      if (!insight.is_post_worthy) {
        logger.debug('Insight not post-worthy, skipping notification', {
          insightId: insight.id,
        });
        return { success: false, reason: 'not_post_worthy' };
      }

      // Check dry run mode
      if (config.features.dryRunMode) {
        logger.info('[DRY RUN] Would post notification', {
          channelId: conversation.channel_id,
          threadTs: conversation.thread_ts,
          insightId: insight.id,
          conversationId: conversation.id,
        });
        return { success: true, dryRun: true };
      }

      logger.info('Posting notification', {
        conversationId: conversation.id,
        insightId: insight.id,
        channelId: conversation.channel_id,
      });

      // Format message
      const message = this.formatNotificationMessage(insight);

      // Post in the same channel where conversation happened
      const postResult = await this.postInChannel(
        conversation.channel_id,
        conversation.thread_ts,
        message
      );

      // Mark conversation as notified
      await conversationRepo.markAsNotified(conversation.id);

      // Create notification record with message_ts for reply detection
      await notificationRepo.create({
        conversationId: conversation.id,
        type: 'insight_detected',
        messageTs: postResult.messageTs,
      });

      logger.info('Notification completed and recorded', {
        conversationId: conversation.id,
        channelId: conversation.channel_id,
      });

      return {
        success: true,
        recipientCount: 1, // Posted once in channel
        dryRun: false,
      };
    } catch (error) {
      logger.error('Notification failed', { error, conversationId: conversation.id });
      throw error;
    }
  }
}

module.exports = new Notifier();
