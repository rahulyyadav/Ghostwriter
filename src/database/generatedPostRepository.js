const { supabase } = require('./supabaseClient');
const { DatabaseError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Repository for generated posts
 */
class GeneratedPostRepository {
  /**
   * Create a new generated post
   */
  async create(postData) {
    try {
      const { data, error } = await supabase
        .from('generated_posts')
        .insert({
          insight_id: postData.insightId,
          user_id: postData.userId,
          platform: postData.platform,
          content: postData.content,
          image_url: postData.imageUrl || null,
          image_prompt: postData.imagePrompt || null,
          status: postData.status || 'draft',
          generation_model: postData.model || 'gemini-1.5-flash',
          tokens_used: postData.tokensUsed || null,
        })
        .select()
        .single();

      if (error) throw error;

      logger.debug('Generated post created', { id: data.id, platform: postData.platform });
      return data;
    } catch (error) {
      logger.error('Error creating generated post', { error });
      throw new DatabaseError('Failed to create generated post', error);
    }
  }

  /**
   * Find post by ID
   */
  async findById(id) {
    try {
      const { data, error } = await supabase
        .from('generated_posts')
        .select(`
          *,
          insights:insight_id (
            id,
            core_insight,
            suggested_angle,
            confidence
          )
        `)
        .eq('id', id)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error finding generated post', { error, id });
      throw new DatabaseError('Failed to find generated post', error);
    }
  }

  /**
   * Find posts by user ID
   */
  async findByUserId(userId, options = {}) {
    try {
      const { status = 'all', limit = 10, offset = 0 } = options;

      let query = supabase
        .from('generated_posts')
        .select(`
          *,
          insights:insight_id (
            id,
            core_insight,
            suggested_angle,
            confidence
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status !== 'all') {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) throw error;

      logger.debug('Found user posts', { userId, count: data?.length || 0 });
      return data || [];
    } catch (error) {
      logger.error('Error finding user posts', { error, userId });
      throw new DatabaseError('Failed to find user posts', error);
    }
  }

  /**
   * Find posts by insight ID
   */
  async findByInsightId(insightId) {
    try {
      const { data, error } = await supabase
        .from('generated_posts')
        .select('*')
        .eq('insight_id', insightId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('Error finding posts by insight', { error, insightId });
      throw new DatabaseError('Failed to find posts by insight', error);
    }
  }

  /**
   * Find the most recent post for an insight
   */
  async findLatestByInsightId(insightId) {
    try {
      const { data, error } = await supabase
        .from('generated_posts')
        .select(`
          *,
          insights:insight_id (
            id,
            core_insight,
            suggested_angle,
            confidence
          )
        `)
        .eq('insight_id', insightId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error finding latest post', { error, insightId });
      throw new DatabaseError('Failed to find latest post', error);
    }
  }

  /**
   * Update post content (for regeneration)
   */
  async updateContent(id, newContent, newVersion) {
    try {
      const { data, error } = await supabase
        .from('generated_posts')
        .update({
          content: newContent,
          version: newVersion,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      logger.debug('Post content updated', { id, version: newVersion });
      return data;
    } catch (error) {
      logger.error('Error updating post content', { error, id });
      throw new DatabaseError('Failed to update post content', error);
    }
  }

  /**
   * Update post status
   */
  async updateStatus(id, status) {
    try {
      const updates = {
        status,
        updated_at: new Date().toISOString(),
      };

      if (status === 'published') {
        updates.published_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('generated_posts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      logger.debug('Post status updated', { id, status });
      return data;
    } catch (error) {
      logger.error('Error updating post status', { error, id });
      throw new DatabaseError('Failed to update post status', error);
    }
  }

  /**
   * Update post with image
   */
  async updateImage(id, imageUrl, imagePrompt) {
    try {
      const { data, error } = await supabase
        .from('generated_posts')
        .update({
          image_url: imageUrl,
          image_prompt: imagePrompt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      logger.debug('Post image updated', { id });
      return data;
    } catch (error) {
      logger.error('Error updating post image', { error, id });
      throw new DatabaseError('Failed to update post image', error);
    }
  }

  /**
   * Delete a post
   */
  async delete(id) {
    try {
      const { error } = await supabase
        .from('generated_posts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      logger.debug('Generated post deleted', { id });
    } catch (error) {
      logger.error('Error deleting generated post', { error, id });
      throw new DatabaseError('Failed to delete generated post', error);
    }
  }

  /**
   * Get post count by user
   */
  async getCountByUserId(userId) {
    try {
      const { count, error } = await supabase
        .from('generated_posts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (error) throw error;

      return count || 0;
    } catch (error) {
      logger.error('Error getting post count', { error, userId });
      throw new DatabaseError('Failed to get post count', error);
    }
  }
}

module.exports = new GeneratedPostRepository();
