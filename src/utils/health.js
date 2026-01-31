const { supabase } = require('../database/supabaseClient');
const geminiClient = require('../llm/geminiClient');
const metrics = require('./metrics');
const config = require('../config/config');
const logger = require('./logger');

/**
 * Health check and status reporter
 */
class HealthCheck {
  constructor() {
    this.status = {
      healthy: true,
      lastCheck: null,
      components: {},
    };
  }

  /**
   * Check database health
   */
  async checkDatabase() {
    try {
      const { error } = await supabase.from('conversations').select('id').limit(1);

      if (error) throw error;

      return { healthy: true, message: 'Connected' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  /**
   * Check Gemini rate limits
   */
  checkGemini() {
    try {
      const stats = geminiClient.getRateLimitStats();

      const healthy = stats.canMakeRequest;

      return {
        healthy,
        message: healthy ? 'Available' : 'Rate limited',
        details: stats,
      };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  /**
   * Run full health check
   */
  async check() {
    const components = {};

    // Check database
    components.database = await this.checkDatabase();

    // Check Gemini
    components.gemini = this.checkGemini();

    // Overall health
    const healthy = Object.values(components).every(c => c.healthy);

    this.status = {
      healthy,
      lastCheck: new Date().toISOString(),
      components,
    };

    return this.status;
  }

  /**
   * Get current status
   */
  getStatus() {
    return this.status;
  }

  /**
   * Get bot stats
   */
  getBotStats() {
    const allMetrics = metrics.getAll();

    return {
      uptime: allMetrics.uptime,
      uptimeHours: (allMetrics.uptime / (1000 * 60 * 60)).toFixed(2),
      metrics: allMetrics,
      config: {
        optedInChannels: config.slack.optedInChannels.length,
        founders: config.notification.founderUserIds.length,
        features: config.features,
      },
    };
  }

  /**
   * Get full status report
   */
  async getFullReport() {
    const health = await this.check();
    const stats = this.getBotStats();

    return {
      ...health,
      stats,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Log status report
   */
  async logReport() {
    const report = await this.getFullReport();
    logger.info('Health check report', report);
    return report;
  }
}

module.exports = new HealthCheck();
