const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Conversation lifecycle manager - handles TTL and cleanup
 * 
 * Note: With the Hybrid Buffer System, cleanup is handled by:
 * - Redis TTL (6 hours) for message buffers
 * - Supabase cascade deletes for conversations/insights/posts
 */
class LifecycleManager {
  constructor() {
    this.cleanupInterval = null;
  }

  /**
   * Start cleanup job
   */
  async start() {
    const intervalHours = config.conversationTTL.cleanupIntervalHours;
    const intervalMs = intervalHours * 60 * 60 * 1000;

    logger.info('Starting lifecycle manager', {
      cleanupIntervalHours: intervalHours,
    });

    // Run cleanup immediately
    await this.runCleanup();

    // Schedule periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.runCleanup().catch(error => {
        logger.error('Scheduled cleanup failed', { error });
      });
    }, intervalMs);
  }

  /**
   * Stop cleanup job
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Lifecycle manager stopped');
    }
  }

  /**
   * Run cleanup
   * 
   * With the new Hybrid Buffer System:
   * - Redis TTL auto-expires message buffers after 6 hours
   * - Supabase conversations are permanent (for history/analytics)
   * - No need for manual Supabase cleanup jobs
   */
  async runCleanup() {
    try {
      logger.info('Running conversation cleanup');

      // Hybrid Buffer uses Redis with TTL, no manual cleanup needed
      logger.debug('Hybrid buffer uses Redis TTL for auto-cleanup');
      logger.info('Cleanup completed (Redis TTL handles buffer cleanup)');

    } catch (error) {
      logger.error('Cleanup job failed', { error });
    }
  }

  /**
   * Manually trigger cleanup (for testing)
   */
  async triggerCleanup() {
    await this.runCleanup();
  }
}

module.exports = new LifecycleManager();
