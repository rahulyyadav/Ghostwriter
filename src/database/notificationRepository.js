const { supabase } = require('./supabaseClient');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

class NotificationRepository {
  /**
   * Create notification record
   */
  async create(notificationData) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .insert({
          conversation_id: notificationData.conversationId,
          type: notificationData.type || 'insight_detected',
          message_ts: notificationData.messageTs || null,
        })
        .select()
        .single();

      if (error) throw error;

      logger.debug('Notification record created', { id: data.id });
      return data;
    } catch (error) {
      logger.error('Error creating notification record', { error });
      throw new DatabaseError('Failed to create notification record', error);
    }
  }

  /**
   * Update message_ts for a notification
   */
  async updateMessageTs(conversationId, messageTs) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .update({ message_ts: messageTs })
        .eq('conversation_id', conversationId)
        .order('delivered_at', { ascending: false })
        .limit(1)
        .select()
        .single();

      if (error) throw error;

      logger.debug('Notification message_ts updated', { conversationId, messageTs });
      return data;
    } catch (error) {
      logger.error('Error updating notification message_ts', { error, conversationId });
      throw new DatabaseError('Failed to update notification message_ts', error);
    }
  }

  /**
   * Find notification by thread_ts (to detect replies to bot notifications)
   */
  async findByMessageTs(messageTs) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select(`
          *,
          conversations:conversation_id (
            id,
            channel_id,
            thread_ts
          )
        `)
        .eq('message_ts', messageTs)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error finding notification by message_ts', { error, messageTs });
      throw new DatabaseError('Failed to find notification by message_ts', error);
    }
  }

  /**
   * Find notifications for a conversation
   */
  async findByConversationId(conversationId) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('delivered_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('Error finding notifications', { error, conversationId });
      throw new DatabaseError('Failed to find notifications', error);
    }
  }

  /**
   * Check if conversation has been notified
   */
  async hasBeenNotified(conversationId) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id')
        .eq('conversation_id', conversationId)
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return !!data;
    } catch (error) {
      logger.error('Error checking notification status', { error, conversationId });
      throw new DatabaseError('Failed to check notification status', error);
    }
  }
}

module.exports = new NotificationRepository();
