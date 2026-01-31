/**
 * LLM prompts for summary compression and insight detection
 */

/**
 * Summary compression prompt
 */
function getSummaryCompressionPrompt(currentSummary, newMessages) {
  const hasSummary = currentSummary && currentSummary.length > 0;

  return `You are maintaining a rolling summary of a Slack conversation.

${hasSummary ? `Current summary:\n"""${currentSummary}"""\n\n` : ''}New messages since last summary:
"""
${newMessages}
"""

Task: Create an updated summary that:
1. ${hasSummary ? 'Merges the current summary with new messages' : 'Summarizes the new messages'}
2. Keeps key decisions, insights, and action items
3. Removes greetings, off-topic banter, and redundancy
4. Maximum 250 words
5. Focus on "why" and "what" - skip "who said"

Return ONLY the new summary, no explanation.`;
}

/**
 * Insight detection prompt
 */
function getInsightDetectionPrompt(rollingSummary) {
  return `You are a content strategist analyzing internal Slack conversations to identify post-worthy insights.

Your task: Determine if this conversation contains material suitable for a public LinkedIn/X post by a founder/CEO.

CONVERSATION SUMMARY:
"""
${rollingSummary}
"""

EVALUATION CRITERIA:
A conversation is post-worthy if it contains:
1. A non-obvious insight about product, customers, or business
2. A decision with interesting reasoning
3. A learning or mistake worth sharing
4. A contrarian or surprising perspective
5. Actionable advice other founders would value

NOT post-worthy:
- Internal logistics, scheduling, trivial updates
- Sensitive/confidential information
- Complaints without constructive framing
- Routine operational discussions

YOUR RESPONSE:
Respond with ONLY valid JSON matching this schema:
{
  "isPostWorthy": boolean,
  "confidence": number between 0.0 and 1.0,
  "coreInsight": "One sentence: the key insight or decision",
  "suggestedAngle": "1-2 sentences: how this could be framed as a post",
  "reasoning": "Brief explanation of your decision"
}

IMPORTANT:
- Do NOT write the actual post
- Do NOT add commentary outside the JSON
- Be conservative: when uncertain, set isPostWorthy to false
- Only mark as post-worthy if confidence >= 0.7`;
}

module.exports = {
  getSummaryCompressionPrompt,
  getInsightDetectionPrompt,
};
