const geminiClient = require('../llm/geminiClient');
const conversationRepo = require('../database/conversationRepository');
const insightRepo = require('../database/insightRepository');
const SignalGate = require('./signalGate');
const config = require('../config/config');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

/**
 * Insight detection service
 */
class InsightDetector {
  /**
   * Detect insight for conversation
   */
  async detectInsight(conversationId) {
    try {
      // Get conversation from DB
      const conversation = await this.getConversationById(conversationId);

      if (!conversation) {
        logger.error('Conversation not found for insight detection', { conversationId });
        return null;
      }

      // Check feature flag
      if (!config.features.enableInsightDetection) {
        logger.debug('Insight detection disabled by feature flag');
        return null;
      }

      // Check if already notified
      if (conversation.notified) {
        logger.debug('Conversation already notified, skipping insight detection', {
          conversationId,
        });
        return null;
      }

      // Check signal gate
      if (!SignalGate.passes(conversation)) {
        logger.debug('Conversation did not pass signal gate', { conversationId });
        return null;
      }

      // Check if there's a summary to analyze
      if (!conversation.rolling_summary || conversation.rolling_summary.length < 50) {
        logger.debug('Summary too short for insight detection', {
          conversationId,
          summaryLength: conversation.rolling_summary?.length || 0,
        });
        return null;
      }

      logger.info('Starting insight detection', {
        conversationId,
        summaryLength: conversation.rolling_summary.length,
      });

      // Call Gemini for insight detection
      const insightResponse = await geminiClient.detectInsight(conversation.rolling_summary);

      // Store insight in DB
      const insight = await insightRepo.create({
        conversationId: conversation.id,
        isPostWorthy: insightResponse.isPostWorthy,
        confidence: insightResponse.confidence,
        coreInsight: insightResponse.coreInsight,
        suggestedAngle: insightResponse.suggestedAngle,
        llmModel: 'gemini-1.5-flash',
        tokensUsed: null, // Gemini doesn't provide token counts easily
        evaluatedSummaryVersion: conversation.summary_version,
      });

      // Update conversation LLM call timestamp
      await conversationRepo.update(conversationId, {
        llm_last_called_at: new Date().toISOString(),
      });

      // Track metrics
      metrics.trackInsightDetection(insight.is_post_worthy);
      metrics.trackLLMCall('insight_detection', true);

      logger.info('Insight detection completed', {
        conversationId,
        insightId: insight.id,
        isPostWorthy: insight.is_post_worthy,
        confidence: insight.confidence,
      });

      return {
        conversation,
        insight,
        shouldNotify: insight.is_post_worthy && !conversation.notified,
      };
    } catch (error) {
      logger.error('Insight detection failed', { error, conversationId });
      metrics.trackLLMCall('insight_detection', false);
      metrics.trackError('insight_detection');
      throw error;
    }
  }

  /**
   * Get conversation by ID (helper)
   */
  async getConversationById(conversationId) {
    const { supabase } = require('../database/supabaseClient');
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    return data;
  }
}

module.exports = new InsightDetector();
