const { RateLimitError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Rate limiter for Gemini API
 */
class RateLimiter {
  constructor(maxRequestsPerMinute = 15, maxRequestsPerDay = 1000) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.maxRequestsPerDay = maxRequestsPerDay;

    // Sliding window for per-minute tracking
    this.requestTimestamps = [];

    // Daily counter
    this.dailyCount = 0;
    this.dailyResetTime = this.getNextDayTimestamp();
  }

  /**
   * Get timestamp for next day reset
   */
  getNextDayTimestamp() {
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    return tomorrow.getTime();
  }

  /**
   * Reset daily counter if needed
   */
  checkDailyReset() {
    const now = Date.now();
    if (now >= this.dailyResetTime) {
      this.dailyCount = 0;
      this.dailyResetTime = this.getNextDayTimestamp();
      logger.info('Daily rate limit reset');
    }
  }

  /**
   * Clean old timestamps (older than 1 minute)
   */
  cleanOldTimestamps() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
  }

  /**
   * Check if request can proceed
   */
  canMakeRequest() {
    this.checkDailyReset();
    this.cleanOldTimestamps();

    // Check per-minute limit
    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      return false;
    }

    // Check daily limit
    if (this.dailyCount >= this.maxRequestsPerDay) {
      return false;
    }

    return true;
  }

  /**
   * Get time until next available slot
   */
  getRetryAfterMs() {
    this.cleanOldTimestamps();

    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      // Per-minute limit hit - wait until oldest request expires
      const oldestTimestamp = this.requestTimestamps[0];
      const retryAfter = oldestTimestamp + 60000 - Date.now();
      return Math.max(retryAfter, 1000);
    }

    if (this.dailyCount >= this.maxRequestsPerDay) {
      // Daily limit hit - wait until next day
      return this.dailyResetTime - Date.now();
    }

    return 0;
  }

  /**
   * Record a request
   */
  recordRequest() {
    const now = Date.now();
    this.requestTimestamps.push(now);
    this.dailyCount++;
  }

  /**
   * Attempt to make a request (throws if rate limited)
   */
  async attempt() {
    if (!this.canMakeRequest()) {
      const retryAfterMs = this.getRetryAfterMs();
      const retryAfterMinutes = Math.ceil(retryAfterMs / 60000);

      logger.warn('Rate limit hit', {
        perMinuteCount: this.requestTimestamps.length,
        dailyCount: this.dailyCount,
        retryAfterMs,
      });

      throw new RateLimitError(
        `Gemini rate limit exceeded. Retry after ${retryAfterMinutes} minutes.`,
        retryAfterMs
      );
    }

    this.recordRequest();
  }

  /**
   * Get current usage stats
   */
  getStats() {
    this.checkDailyReset();
    this.cleanOldTimestamps();

    return {
      perMinuteCount: this.requestTimestamps.length,
      perMinuteLimit: this.maxRequestsPerMinute,
      dailyCount: this.dailyCount,
      dailyLimit: this.maxRequestsPerDay,
      canMakeRequest: this.canMakeRequest(),
    };
  }
}

module.exports = RateLimiter;
