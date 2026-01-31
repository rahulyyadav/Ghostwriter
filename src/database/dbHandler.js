/**
 * Database Handler for Supabase
 * Handles chained inserts: conversations → insights → generated_posts
 * 
 * Schema:
 * - conversations: Parent container for chat bursts
 * - insights: Child records for detected ideas
 * - generated_posts: Grandchild for actual post content
 */
const { createClient } = require('@supabase/supabase-js');
const config = require('../config/config');
const logger = require('../utils/logger');

// Initialize Supabase client
const supabase = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey
);

/**
 * Create a full post chain: conversation → insight → generated_post
 * 
 * @param {object} data - Post data
 * @param {string} data.workspaceId - Slack workspace ID
 * @param {string} data.channelId - Slack channel ID
 * @param {number} data.messageCount - Number of messages analyzed
 * @param {string} data.topic - Core topic/insight
 * @param {string} data.content - Generated post content
 * @param {string} data.platform - Target platform (linkedin/twitter)
 * @param {number} data.confidence - Confidence score (0-1)
 * @returns {Promise<object>} Created records { conversation, insight, post }
 */
async function createPostChain({
    workspaceId,
    channelId,
    messageCount = 0,
    topic,
    content,
    platform = 'linkedin',
    confidence = 0.9,
}) {
    try {
        console.log(`💾 [DB] Creating post chain for channel: ${channelId}`);

        // Step 1: Insert conversation
        const { data: conversation, error: convError } = await supabase
            .from('conversations')
            .insert({
                workspace_id: workspaceId || config.slack.workspaceId || 'default',
                channel_id: channelId,
                message_count: messageCount,
            })
            .select()
            .single();

        if (convError) {
            logger.error('Failed to create conversation', { error: convError });
            throw new Error(`Conversation insert failed: ${convError.message}`);
        }

        console.log(`✅ [DB] Conversation created: ${conversation.id}`);

        // Step 2: Insert insight
        const { data: insight, error: insightError } = await supabase
            .from('insights')
            .insert({
                conversation_id: conversation.id,
                core_insight: topic,
                suggested_angle: topic,
                confidence: confidence,
                is_post_worthy: true,
            })
            .select()
            .single();

        if (insightError) {
            logger.error('Failed to create insight', { error: insightError });
            throw new Error(`Insight insert failed: ${insightError.message}`);
        }

        console.log(`✅ [DB] Insight created: ${insight.id}`);

        // Step 3: Insert generated post
        const { data: post, error: postError } = await supabase
            .from('generated_posts')
            .insert({
                insight_id: insight.id,
                platform: platform,
                content: content,
                status: 'draft',
            })
            .select()
            .single();

        if (postError) {
            logger.error('Failed to create post', { error: postError });
            throw new Error(`Post insert failed: ${postError.message}`);
        }

        console.log(`✅ [DB] Generated post created: ${post.id}`);

        logger.info('Post chain created successfully', {
            conversationId: conversation.id,
            insightId: insight.id,
            postId: post.id,
        });

        return { conversation, insight, post };

    } catch (error) {
        logger.error('createPostChain failed', { error: error.message });
        throw error;
    }
}

/**
 * Get the last N generated posts for a channel
 * Uses JOIN: generated_posts → insights → conversations
 * 
 * @param {string} channelId - Slack channel ID
 * @param {number} limit - Number of posts to retrieve (default: 3)
 * @returns {Promise<Array>} Array of post objects with context
 */
async function getRecentPostsForChannel(channelId, limit = 3) {
    try {
        console.log(`🔍 [DB] Fetching last ${limit} posts for channel: ${channelId}`);

        const { data, error } = await supabase
            .from('generated_posts')
            .select(`
        id,
        content,
        platform,
        image_url,
        image_prompt,
        status,
        created_at,
        insight:insights!inner (
          id,
          core_insight,
          confidence,
          conversation:conversations!inner (
            id,
            channel_id,
            message_count,
            created_at
          )
        )
      `)
            .eq('insight.conversation.channel_id', channelId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            logger.error('Failed to fetch recent posts', { error });
            return [];
        }

        console.log(`✅ [DB] Found ${data?.length || 0} recent posts`);
        return data || [];

    } catch (error) {
        logger.error('getRecentPostsForChannel failed', { error: error.message });
        return [];
    }
}

/**
 * Update a generated post with image data
 * 
 * @param {string} postId - Post UUID
 * @param {string} imageUrl - Generated image URL
 * @param {string} imagePrompt - The prompt used to generate the image
 * @returns {Promise<object>} Updated post
 */
async function updatePostWithImage(postId, imageUrl, imagePrompt) {
    try {
        console.log(`📸 [DB] Updating post ${postId} with image`);

        const { data, error } = await supabase
            .from('generated_posts')
            .update({
                image_url: imageUrl,
                image_prompt: imagePrompt,
            })
            .eq('id', postId)
            .select()
            .single();

        if (error) {
            logger.error('Failed to update post with image', { error });
            throw error;
        }

        console.log(`✅ [DB] Post updated with image`);
        return data;

    } catch (error) {
        logger.error('updatePostWithImage failed', { error: error.message });
        throw error;
    }
}

/**
 * Get the most recent post for a channel (for image generation context)
 * 
 * @param {string} channelId - Slack channel ID
 * @returns {Promise<object|null>} Most recent post or null
 */
async function getMostRecentPost(channelId) {
    const posts = await getRecentPostsForChannel(channelId, 1);
    return posts.length > 0 ? posts[0] : null;
}

/**
 * Get the last N generated posts across ALL channels (for DM context)
 * 
 * @param {number} limit - Number of posts to retrieve (default: 5)
 * @returns {Promise<Array>} Array of post objects with context
 */
async function getRecentPosts(limit = 5) {
    try {
        console.log(`🔍 [DB] Fetching last ${limit} posts (all channels)`);

        const { data, error } = await supabase
            .from('generated_posts')
            .select(`
        id,
        content,
        platform,
        image_url,
        image_prompt,
        status,
        created_at,
        insight:insights!inner (
          id,
          core_insight,
          confidence,
          conversation:conversations!inner (
            id,
            channel_id,
            message_count,
            created_at
          )
        )
      `)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            logger.error('Failed to fetch recent posts', { error });
            return [];
        }

        console.log(`✅ [DB] Found ${data?.length || 0} recent posts`);
        return data || [];

    } catch (error) {
        logger.error('getRecentPosts failed', { error: error.message });
        return [];
    }
}

/**
 * Log a notification delivery
 * 
 * @param {string} conversationId - Conversation UUID
 * @param {string} type - Notification type
 */
async function logNotification(conversationId, type) {
    try {
        const { error } = await supabase
            .from('notifications')
            .insert({
                conversation_id: conversationId,
                type: type,
            });

        if (error) {
            logger.error('Failed to log notification', { error });
        }
    } catch (error) {
        logger.error('logNotification failed', { error: error.message });
    }
}

module.exports = {
    supabase,
    createPostChain,
    getRecentPostsForChannel,
    getRecentPosts,
    updatePostWithImage,
    getMostRecentPost,
    logNotification,
};
