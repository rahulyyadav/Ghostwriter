const conversationRepo = require('../database/conversationRepository');
const MessageParser = require('./messageParser');
const SignalGate = require('./signalGate');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Conversation state manager - core orchestration
 */
class ConversationManager {
  constructor() {
    // In-memory buffer for pending messages (ephemeral)
    this.pendingBuffers = new Map(); // conversationId -> { buffer: string, count: number, wordCount: number }
  }

  /**
   * Process incoming message
   */
  async processMessage(messageEnvelope) {
    try {
      // Filter out bots
      if (messageEnvelope.isBot) {
        logger.debug('Skipping bot message');
        return null;
      }

      // Check if noise
      if (MessageParser.isNoise(messageEnvelope.textForSummary, messageEnvelope.wordCount)) {
        logger.debug('Skipping noise message', { text: messageEnvelope.textForSummary });
        return null;
      }

      // Get or create conversation
      const conversation = await conversationRepo.findOrCreate(
        config.slack.workspaceId,
        messageEnvelope.channelId,
        messageEnvelope.threadTs
      );

      // Update conversation state
      const updatedConversation = await this.updateConversationState(
        conversation,
        messageEnvelope
      );

      // Add to pending buffer
      this.addToBuffer(updatedConversation.id, messageEnvelope);

      // Check if we need to trigger compression or insight detection
      const shouldCompress = this.shouldTriggerCompression(updatedConversation);

      return {
        conversation: updatedConversation,
        shouldCompress,
        pendingBuffer: this.getPendingBuffer(updatedConversation.id),
      };
    } catch (error) {
      logger.error('Error processing message', { error, messageEnvelope });
      throw error;
    }
  }

  /**
   * Update conversation state with new message
   */
  async updateConversationState(conversation, messageEnvelope) {
    // Add user to participants
    const participantIds = conversation.participant_ids || [];
    if (!participantIds.includes(messageEnvelope.userId)) {
      participantIds.push(messageEnvelope.userId);
    }

    // Update counts
    const messageCount = (conversation.message_count || 0) + 1;
    const totalWordCount = (conversation.total_word_count || 0) + messageEnvelope.wordCount;

    // Calculate signal score
    const updatedState = {
      ...conversation,
      message_count: messageCount,
      participant_ids: participantIds,
      total_word_count: totalWordCount,
      last_activity: new Date().toISOString(),
    };

    const signalScore = SignalGate.calculateSignalScore(updatedState);

    // Check if gate passes
    const gatesPasses = SignalGate.passes(updatedState);
    const gatePassedAt =
      gatesPasses && !conversation.gate_passed_at ? new Date().toISOString() : conversation.gate_passed_at;

    // Update database
    const updated = await conversationRepo.update(conversation.id, {
      message_count: messageCount,
      participant_ids: participantIds,
      total_word_count: totalWordCount,
      last_activity: new Date().toISOString(),
      signal_score: signalScore,
      gate_passed_at: gatePassedAt,
    });

    return updated;
  }

  /**
   * Add message to pending buffer
   */
  addToBuffer(conversationId, messageEnvelope) {
    let buffer = this.pendingBuffers.get(conversationId);

    if (!buffer) {
      buffer = { buffer: '', count: 0, wordCount: 0 };
    }

    // Append message snippet to buffer
    const snippet = `User (${messageEnvelope.wordCount} words): ${messageEnvelope.textForSummary}`;
    buffer.buffer += (buffer.buffer ? '\n' : '') + snippet;
    buffer.count += 1;
    buffer.wordCount += messageEnvelope.wordCount;

    this.pendingBuffers.set(conversationId, buffer);
  }

  /**
   * Get pending buffer for conversation
   */
  getPendingBuffer(conversationId) {
    return this.pendingBuffers.get(conversationId) || { buffer: '', count: 0, wordCount: 0 };
  }

  /**
   * Clear pending buffer
   */
  clearBuffer(conversationId) {
    this.pendingBuffers.delete(conversationId);
  }

  /**
   * Check if compression should be triggered
   */
  shouldTriggerCompression(conversation) {
    const cfg = config.summaryCompression;
    const buffer = this.getPendingBuffer(conversation.id);

    // No buffer = no compression needed
    if (buffer.count === 0) {
      return false;
    }

    // Trigger if buffer is large
    if (buffer.count >= cfg.triggerMessageCount || buffer.wordCount >= cfg.triggerWordCount) {
      return true;
    }

    // Trigger if enough time has passed since last compress
    if (conversation.llm_last_called_at) {
      const minutesSinceCompress =
        (Date.now() - new Date(conversation.llm_last_called_at).getTime()) / 60000;

      if (minutesSinceCompress >= cfg.triggerMinutesSinceLastCompress && buffer.count >= 2) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if insight detection should be triggered
   */
  shouldTriggerInsightDetection(conversation) {
    // Must pass signal gate
    if (!SignalGate.passes(conversation)) {
      return false;
    }

    // Must not already be notified
    if (conversation.notified) {
      return false;
    }

    // Feature flag check
    if (!config.features.enableInsightDetection) {
      return false;
    }

    // Cooldown check
    if (conversation.llm_last_called_at) {
      const minutesSinceLastCall =
        (Date.now() - new Date(conversation.llm_last_called_at).getTime()) / 60000;

      if (minutesSinceLastCall < config.insightDetection.cooldownMinutes) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get conversation by ID
   */
  async getConversation(conversationId) {
    // This would need to be implemented based on your DB structure
    // For now, returning null
    return null;
  }
}

module.exports = new ConversationManager();
