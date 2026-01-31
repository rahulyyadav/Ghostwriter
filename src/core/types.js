/**
 * @typedef {Object} ConversationState
 * @property {string} id - UUID
 * @property {string} workspaceId - Slack workspace ID
 * @property {string} channelId - Slack channel ID
 * @property {string|null} threadTs - Thread timestamp (null for channel-level)
 * @property {string|null} rollingSummary - Compressed summary
 * @property {number} summaryVersion - Version number for optimistic locking
 * @property {number} messageCount - Total messages in window
 * @property {string[]} participantIds - Array of user IDs
 * @property {number} totalWordCount - Accumulated word count
 * @property {Date} windowStartedAt - When conversation window began
 * @property {Date} lastActivity - Last message timestamp
 * @property {Date|null} gatePassedAt - When signal gate first passed
 * @property {Date|null} llmLastCalledAt - Last LLM call timestamp
 * @property {boolean} notified - Whether founder has been notified
 * @property {number|null} signalScore - Computed signal score
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} MessageEnvelope
 * @property {string} channelId
 * @property {string|null} threadTs
 * @property {string} messageTs
 * @property {string} userId
 * @property {boolean} isBot
 * @property {number} wordCount
 * @property {boolean} hasAttachments
 * @property {boolean} hasLinks
 * @property {string} textForSummary - Ephemeral field
 * @property {number} receivedAt - Unix timestamp
 */

/**
 * @typedef {Object} InsightDetectionResult
 * @property {string} id - UUID
 * @property {string} conversationId - UUID reference
 * @property {boolean} isPostWorthy
 * @property {number} confidence - 0.0 to 1.0
 * @property {string} coreInsight
 * @property {string} suggestedAngle
 * @property {string} llmModel
 * @property {number|null} tokensUsed
 * @property {number|null} evaluatedSummaryVersion
 * @property {Date} createdAt
 */

/**
 * @typedef {Object} NotificationRecord
 * @property {string} id - UUID
 * @property {string} conversationId - UUID reference
 * @property {string} type - Notification type
 * @property {Date} deliveredAt
 */

module.exports = {};
