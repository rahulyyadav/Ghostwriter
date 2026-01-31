const logger = require('./logger');

/**
 * Simple in-memory metrics tracker
 */
class Metrics {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.startTime = Date.now();
  }

  /**
   * Increment a counter
   */
  increment(name, value = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  /**
   * Set a gauge value
   */
  set(name, value) {
    this.gauges.set(name, value);
  }

  /**
   * Get a counter value
   */
  getCounter(name) {
    return this.counters.get(name) || 0;
  }

  /**
   * Get a gauge value
   */
  getGauge(name) {
    return this.gauges.get(name);
  }

  /**
   * Get all metrics
   */
  getAll() {
    const counters = {};
    const gauges = {};

    for (const [key, value] of this.counters.entries()) {
      counters[key] = value;
    }

    for (const [key, value] of this.gauges.entries()) {
      gauges[key] = value;
    }

    return {
      counters,
      gauges,
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.counters.clear();
    this.gauges.clear();
  }

  /**
   * Log metrics summary
   */
  logSummary() {
    const metrics = this.getAll();
    logger.info('Metrics summary', metrics);
  }

  /**
   * Track message processed
   */
  trackMessageProcessed(filtered = false) {
    this.increment('messages.total');
    if (filtered) {
      this.increment('messages.filtered');
    } else {
      this.increment('messages.processed');
    }
  }

  /**
   * Track compression
   */
  trackCompression(success = true) {
    this.increment('compression.attempts');
    if (success) {
      this.increment('compression.success');
    } else {
      this.increment('compression.failures');
    }
  }

  /**
   * Track insight detection
   */
  trackInsightDetection(postWorthy = false) {
    this.increment('insights.detections');
    if (postWorthy) {
      this.increment('insights.post_worthy');
    } else {
      this.increment('insights.not_worthy');
    }
  }

  /**
   * Track notification
   */
  trackNotification(success = true, count = 1) {
    this.increment('notifications.attempts');
    if (success) {
      this.increment('notifications.sent', count);
    } else {
      this.increment('notifications.failed');
    }
  }

  /**
   * Track error
   */
  trackError(type = 'unknown') {
    this.increment('errors.total');
    this.increment(`errors.${type}`);
  }

  /**
   * Track LLM usage
   */
  trackLLMCall(type = 'unknown', success = true) {
    this.increment('llm.calls');
    this.increment(`llm.${type}`);
    if (success) {
      this.increment('llm.success');
    } else {
      this.increment('llm.failures');
    }
  }
}

module.exports = new Metrics();
