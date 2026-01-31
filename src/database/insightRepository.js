const { supabase } = require('./supabaseClient');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class InsightRepository {
  /**
   * Create new insight
   */
  async create(insightData) {
    try {
      console.log(`[DB] Inserting insight:`, {
        conversation_id: insightData.conversationId,
        is_post_worthy: insightData.isPostWorthy,
        core_insight: insightData.coreInsight?.substring(0, 50) + '...',
      });

      const { data, error } = await supabase
        .from('insights')
        .insert({
          conversation_id: insightData.conversationId,
          is_post_worthy: insightData.isPostWorthy,
          confidence: insightData.confidence,
          core_insight: insightData.coreInsight,
          suggested_angle: insightData.suggestedAngle,
          llm_model: insightData.llmModel || 'gemini-2.0-flash',
          tokens_used: insightData.tokensUsed || null,
          evaluated_summary_version: insightData.evaluatedSummaryVersion || null,
        })
        .select()
        .single();

      if (error) {
        console.error(`[DB ERROR] Supabase insert failed:`, error);
        throw error;
      }

      console.log(`[DB] Insert success! ID:`, data.id);
      logger.debug('Insight created', { id: data.id, isPostWorthy: data.is_post_worthy });
      return data;
    } catch (error) {
      console.error(`[DB ERROR] Full error:`, error.message, error.code, error.details);
      logger.error('Error creating insight', { error });
      throw new DatabaseError('Failed to create insight', error);
    }
  }

  /**
   * Find insights for a conversation
   */
  async findByConversationId(conversationId) {
    try {
      const { data, error } = await supabase
        .from('insights')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('Error finding insights', { error, conversationId });
      throw new DatabaseError('Failed to find insights', error);
    }
  }

  /**
   * Find latest post-worthy insight for a conversation
   */
  async findLatestPostWorthyInsight(conversationId) {
    try {
      const { data, error } = await supabase
        .from('insights')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('is_post_worthy', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error finding latest post-worthy insight', { error, conversationId });
      throw new DatabaseError('Failed to find latest insight', error);
    }
  }

  /**
   * Find recent post-worthy insights (for context when bot is mentioned)
   * @param {number} limit - Number of insights to fetch
   * @returns {Promise<Array>} Recent insights
   */
  async findRecentInsights(limit = 5) {
    try {
      const { data, error } = await supabase
        .from('insights')
        .select('*')
        .eq('is_post_worthy', true)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('Error finding recent insights', { error });
      return []; // Return empty array on error, don't break the flow
    }
  }
}

module.exports = new InsightRepository();
