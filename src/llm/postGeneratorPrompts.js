/**
 * Prompts for generating social media posts
 */

/**
 * Generate a Twitter/X post prompt
 */
function getTwitterPostPrompt(insight) {
  return `You are a social media expert helping a founder craft an engaging tweet.

INSIGHT FROM CONVERSATION:
"${insight.core_insight}"

SUGGESTED ANGLE:
"${insight.suggested_angle}"

Generate a compelling Twitter/X post (max 280 characters) that:
1. Opens with a hook that stops the scroll
2. Shares a non-obvious insight or contrarian take
3. Feels authentic and conversational, not corporate
4. Ends with engagement (question, opinion, or call to action)

Guidelines:
- Use short, punchy sentences
- Avoid hashtags unless truly relevant
- Don't use emojis excessively (1-2 max if any)
- Make it feel like a real person sharing a genuine insight

Return ONLY the tweet text, nothing else. No quotes, no explanation.`;
}

/**
 * Generate a LinkedIn post prompt
 */
function getLinkedInPostPrompt(insight) {
  return `You are a social media expert helping a founder craft an engaging LinkedIn post.

INSIGHT FROM CONVERSATION:
"${insight.core_insight}"

SUGGESTED ANGLE:
"${insight.suggested_angle}"

Generate a compelling LinkedIn post (400-800 characters) that:
1. Opens with a strong hook (surprising stat, bold statement, or question)
2. Shares context or a brief story
3. Delivers the key insight with specifics
4. Ends with a question to drive comments

Guidelines:
- Use line breaks for readability (short paragraphs)
- Be authentic and share a real perspective
- Avoid buzzwords and corporate speak
- Don't use excessive emojis
- Make the reader think "I need to comment on this"

Return ONLY the post text, nothing else. No quotes, no explanation.`;
}

/**
 * Generate an image prompt from post content
 */
function getImagePromptGeneratorPrompt(postContent, platform) {
  return `You are a creative director creating visuals for viral ${platform} posts. Generate an AI image prompt that DIRECTLY relates to this post's message.

POST:
"${postContent}"

STEP 1: Identify the core theme (examples):
- Startup struggle → show the grind, late nights, empty celebrations
- Revenue milestone → show numbers, dashboards, the "emptiness" of metrics
- Team dynamics → show people collaborating or in conflict
- Failure/learning → show falling and rising, broken things being rebuilt
- Growth mindset → show transformation, before/after, evolution

STEP 2: Create a visual metaphor that viewers INSTANTLY connect to the post:
- If about hustle culture → person working late with coffee cups, dimly lit desk
- If about hollow victories → lone figure on podium in empty stadium
- If about chasing metrics → person climbing endless staircase of numbers
- If about team wins → diverse hands joining together, collaborative workspace
- If about pivoting → ship changing direction, road fork with signs

REQUIREMENTS:
- The image MUST visually tell the same story as the post
- Modern, clean aesthetic (think: Notion, Linear, Vercel vibes)
- Muted, sophisticated color palette (avoid garish colors)
- NO text, NO logos, NO UI elements in the image
- Works as a square (1:1) social media thumbnail

STYLE: Cinematic photography or modern 3D illustration, soft lighting, shallow depth of field, editorial quality.

Return ONLY the image prompt (2-3 sentences max). Be specific about subject, mood, lighting, and composition.

GOOD examples:
- "A lone entrepreneur sitting at a modern desk late at night, laptop glowing, surrounded by empty coffee cups and scattered papers. Moody blue lighting, cinematic composition, the weight of ambition visible in their posture."
- "Minimalist 3D render of a golden trophy on a pedestal in a vast empty room, single spotlight, shadows stretching long. The isolation of achievement."
- "Aerial view of a person standing at a crossroads in a modern city, multiple paths ahead lit differently - one bright, others dim. Decision moment captured."

BAD examples (too generic):
- "Abstract shapes representing growth"
- "A beautiful sunset over mountains"
- "Geometric patterns with gradient colors"`;
}

/**
 * Generate a post refinement prompt
 */
function getPostRefinementPrompt(originalPost, feedback, platform) {
  const charLimit = platform === 'twitter' ? 280 : 800;

  return `Refine this ${platform} post based on the feedback.

ORIGINAL POST:
"${originalPost}"

FEEDBACK:
"${feedback}"

Rewrite the post incorporating the feedback while:
1. Keeping the core message intact
2. Staying within ${charLimit} characters
3. Maintaining engaging, authentic tone

Return ONLY the refined post text, nothing else.`;
}

/**
 * Generate alternative versions prompt
 */
function getAlternativeVersionsPrompt(insight, platform, existingPost) {
  const charLimit = platform === 'twitter' ? 280 : 800;

  return `Generate a different take on this insight for ${platform}.

INSIGHT:
"${insight.core_insight}"

ANGLE:
"${insight.suggested_angle}"

PREVIOUS VERSION (avoid similar phrasing):
"${existingPost}"

Create a fresh version that:
1. Takes a different angle or hook
2. Uses different sentence structure
3. Stays within ${charLimit} characters
4. Is equally engaging but distinct

Return ONLY the new post text, nothing else.`;
}

module.exports = {
  getTwitterPostPrompt,
  getLinkedInPostPrompt,
  getImagePromptGeneratorPrompt,
  getPostRefinementPrompt,
  getAlternativeVersionsPrompt,
};
