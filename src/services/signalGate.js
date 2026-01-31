const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Signal Gate - Deterministic filtering before LLM
 */
class SignalGate {
  /**
   * Check volume rules
   */
  static checkVolumeRules(state) {
    const cfg = config.signalGate.volume;

    const messageCheck = state.message_count >= cfg.minMessages;
    const participantCheck = state.participant_ids.length >= cfg.minParticipants;
    const avgWordsCheck =
      state.message_count > 0 &&
      state.total_word_count / state.message_count >= cfg.minAvgWords;
    const totalWordsCheck = state.total_word_count >= cfg.minTotalWords;

    return messageCheck && participantCheck && avgWordsCheck && totalWordsCheck;
  }

  /**
   * Check temporal rules
   */
  static checkTemporalRules(state) {
    const cfg = config.signalGate.temporal;

    const windowStart = new Date(state.window_started_at).getTime();
    const lastActivity = new Date(state.last_activity).getTime();
    const now = Date.now();

    const durationMs = lastActivity - windowStart;
    const durationMinutes = durationMs / 60000;
    const durationHours = durationMinutes / 60;

    // Min duration check
    if (durationMinutes < cfg.minDurationMinutes) {
      return false;
    }

    // Max duration check (TTL)
    if (durationHours > cfg.maxDurationHours) {
      return false;
    }

    // Message velocity check
    const msgPerHour = state.message_count / Math.max(durationHours, 0.1);
    if (msgPerHour < cfg.minVelocityMsgPerHour || msgPerHour > cfg.maxVelocityMsgPerHour) {
      return false;
    }

    // Min age check (don't evaluate too early)
    const ageMinutes = (now - windowStart) / 60000;
    if (ageMinutes < cfg.minAgeMinutes) {
      return false;
    }

    return true;
  }

  /**
   * Check engagement rules
   */
  static checkEngagementRules(state) {
    const cfg = config.signalGate.engagement;

    const participantCount = state.participant_ids.length;
    const messageCount = state.message_count;

    if (participantCount === 0 || messageCount === 0) {
      return false;
    }

    // Back-and-forth ratio
    const backAndForthRatio = participantCount / messageCount;

    return backAndForthRatio >= cfg.minBackAndForthRatio;
  }

  /**
   * Check content quality heuristics
   */
  static checkContentQuality(state) {
    const cfg = config.signalGate.quality;

    const summary = state.rolling_summary || '';

    // Must have at least one question (if required)
    if (cfg.requiresQuestion && !summary.includes('?')) {
      return false;
    }

    // Check uniqueness ratio (avoid spam)
    if (summary.length > 0) {
      const words = summary.toLowerCase().split(/\s+/);
      const uniqueWords = new Set(words);
      const uniquenessRatio = uniqueWords.size / words.length;

      if (uniquenessRatio < cfg.minUniquenessRatio) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculate signal score (0-100)
   */
  static calculateSignalScore(state) {
    let score = 0;

    // Volume signals (0-30 points)
    score += Math.min(state.message_count * 2, 20);
    score += Math.min(state.participant_ids.length * 5, 10);

    // Temporal signals (0-20 points)
    const windowStart = new Date(state.window_started_at).getTime();
    const lastActivity = new Date(state.last_activity).getTime();
    const durationHours = (lastActivity - windowStart) / 3600000;
    score += Math.min(durationHours * 5, 20);

    // Engagement (0-30 points)
    if (state.participant_ids.length > 0 && state.message_count > 0) {
      const engagementRatio = state.participant_ids.length / state.message_count;
      score += Math.min(engagementRatio * 100, 30);
    }

    // Content quality (0-20 points)
    const summary = state.rolling_summary || '';
    if (summary.includes('?')) score += 10;
    if (/\b(decided|decision|will|let's|should we|propose)\b/i.test(summary)) {
      score += 10;
    }

    return Math.min(Math.round(score), 100);
  }

  /**
   * Main gate check
   */
  static passes(state) {
    const volumePass = this.checkVolumeRules(state);
    const temporalPass = this.checkTemporalRules(state);
    const engagementPass = this.checkEngagementRules(state);
    const qualityPass = this.checkContentQuality(state);

    const passed = volumePass && temporalPass && engagementPass && qualityPass;

    logger.debug('Signal gate evaluation', {
      conversationId: state.id,
      passed,
      volumePass,
      temporalPass,
      engagementPass,
      qualityPass,
      messageCount: state.message_count,
      participants: state.participant_ids.length,
    });

    return passed;
  }
}

module.exports = SignalGate;
