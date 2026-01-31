const geminiClient = require('../llm/geminiClient');
const conversationRepo = require('../database/conversationRepository');
const conversationManager = require('./conversationManager');
const config = require('../config/config');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

/**
 * Summary compression service
 */
class SummaryCompressor {
  /**
   * Compress conversation summary
   */
  async compressConversation(conversationId) {
    try {
      // Get conversation from DB
      const conversation = await this.getConversationById(conversationId);

      if (!conversation) {
        logger.error('Conversation not found for compression', { conversationId });
        return null;
      }

      // Check feature flag
      if (!config.features.enableSummaryCompression) {
        logger.debug('Summary compression disabled by feature flag');
        return conversation;
      }

      // Get pending buffer
      const buffer = conversationManager.getPendingBuffer(conversationId);

      if (!buffer || buffer.count === 0) {
        logger.debug('No pending buffer to compress', { conversationId });
        return conversation;
      }

      logger.info('Starting summary compression', {
        conversationId,
        currentSummaryLength: conversation.rolling_summary?.length || 0,
        bufferCount: buffer.count,
        bufferWordCount: buffer.wordCount,
      });

      // Call Gemini for compression
      const compressedSummary = await geminiClient.compressSummary(
        conversation.rolling_summary,
        buffer.buffer
      );

      // Update conversation in DB
      const updated = await conversationRepo.update(conversationId, {
        rolling_summary: compressedSummary,
        summary_version: (conversation.summary_version || 1) + 1,
        llm_last_called_at: new Date().toISOString(),
      });

      // Clear the pending buffer
      conversationManager.clearBuffer(conversationId);

      // Track metrics
      metrics.trackCompression(true);
      metrics.trackLLMCall('compression', true);

      logger.info('Summary compression completed', {
        conversationId,
        newSummaryLength: compressedSummary.length,
        summaryVersion: updated.summary_version,
      });

      return updated;
    } catch (error) {
      logger.error('Summary compression failed', { error, conversationId });
      metrics.trackCompression(false);
      metrics.trackLLMCall('compression', false);
      metrics.trackError('compression');

      // On failure, use emergency compression
      try {
        return await this.emergencyCompress(conversationId);
      } catch (emergencyError) {
        logger.error('Emergency compression also failed', { emergencyError, conversationId });
        metrics.trackError('emergency_compression');
        throw error;
      }
    }
  }

  /**
   * Emergency compression (no LLM) - fallback if Gemini fails
   */
  async emergencyCompress(conversationId) {
    logger.warn('Using emergency compression (no LLM)', { conversationId });

    const buffer = conversationManager.getPendingBuffer(conversationId);

    if (!buffer || buffer.count === 0) {
      return null;
    }

    // Simple truncation: keep last 10 substantive lines
    const lines = buffer.buffer.split('\n').filter(line => line.length > 50);
    const truncated = lines.slice(-10).join('\n');

    const conversation = await this.getConversationById(conversationId);

    // Append to existing summary
    const emergencySummary = conversation.rolling_summary
      ? `${conversation.rolling_summary}\n\n[Recent messages]: ${truncated}`
      : truncated;

    const updated = await conversationRepo.update(conversationId, {
      rolling_summary: emergencySummary,
      summary_version: (conversation.summary_version || 1) + 1,
    });

    conversationManager.clearBuffer(conversationId);

    return updated;
  }

  /**
   * Get conversation by ID (helper)
   */
  async getConversationById(conversationId) {
    // Query DB to get conversation by UUID
    const { supabase } = require('../database/supabaseClient');
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    return data;
  }
}

module.exports = new SummaryCompressor();
