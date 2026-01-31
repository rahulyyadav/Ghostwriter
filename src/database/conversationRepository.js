const { supabase } = require('./supabaseClient');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class ConversationRepository {
  /**
   * Build conversation ID from channel and thread
   */
  static makeConversationId(channelId, threadTs = null) {
    return threadTs ? `${channelId}:${threadTs}` : channelId;
  }

  /**
   * Find conversation by channel and thread
   */
  async findByChannelAndThread(workspaceId, channelId, threadTs = null) {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('channel_id', channelId)
        .eq('thread_ts', threadTs)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows returned, which is fine
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error finding conversation', { error, channelId, threadTs });
      throw new DatabaseError('Failed to find conversation', error);
    }
  }

  /**
   * Create new conversation
   */
  async create(conversationData) {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .insert({
          workspace_id: conversationData.workspaceId,
          channel_id: conversationData.channelId,
          thread_ts: conversationData.threadTs,
          rolling_summary: conversationData.rollingSummary || null,
          message_count: conversationData.messageCount || 0,
          participant_ids: conversationData.participantIds || [],
          total_word_count: conversationData.totalWordCount || 0,
          summary_version: conversationData.summaryVersion || 1,
          window_started_at: conversationData.windowStartedAt || new Date().toISOString(),
          last_activity: conversationData.lastActivity || new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      logger.debug('Conversation created', { id: data.id });
      return data;
    } catch (error) {
      logger.error('Error creating conversation', { error });
      throw new DatabaseError('Failed to create conversation', error);
    }
  }

  /**
   * Update conversation
   */
  async update(id, updates) {
    try {
      const updateData = {
        ...updates,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      logger.debug('Conversation updated', { id });
      return data;
    } catch (error) {
      logger.error('Error updating conversation', { error, id });
      throw new DatabaseError('Failed to update conversation', error);
    }
  }

  /**
   * Find or create conversation
   */
  async findOrCreate(workspaceId, channelId, threadTs = null) {
    let conversation = await this.findByChannelAndThread(workspaceId, channelId, threadTs);

    if (!conversation) {
      conversation = await this.create({
        workspaceId,
        channelId,
        threadTs,
        messageCount: 0,
        participantIds: [],
        totalWordCount: 0,
        windowStartedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      });
    }

    return conversation;
  }

  /**
   * Mark conversation as notified
   */
  async markAsNotified(id) {
    return this.update(id, {
      notified: true,
      // Note: delivered_at is managed by notification record
    });
  }

  /**
   * Find conversations that need cleanup (inactive for > TTL hours)
   */
  async findStaleConversations(inactiveHours) {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - inactiveHours);

      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .lt('last_activity', cutoffTime.toISOString())
        .eq('notified', false);

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('Error finding stale conversations', { error });
      throw new DatabaseError('Failed to find stale conversations', error);
    }
  }

  /**
   * Delete conversation (for cleanup)
   */
  async delete(id) {
    try {
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', id);

      if (error) throw error;

      logger.debug('Conversation deleted', { id });
    } catch (error) {
      logger.error('Error deleting conversation', { error, id });
      throw new DatabaseError('Failed to delete conversation', error);
    }
  }
}

module.exports = new ConversationRepository();
