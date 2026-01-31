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
  return `Based on this ${platform} post, generate an image generation prompt.

POST:
"${postContent}"

Create a prompt for generating a professional, modern image that:
1. Visually represents the core message of the post
2. Uses clean, minimalist design aesthetics
3. Works well as a social media visual
4. Does NOT include any text in the image
5. Uses abstract concepts or metaphors rather than literal representations

The image should feel:
- Professional and polished
- Thought-provoking
- Suitable for a business/tech audience

Return ONLY the image generation prompt (1-2 sentences), nothing else. Start directly with the visual description.

Example outputs:
- "A minimalist illustration of two paths diverging in a forest, one well-worn and one overgrown, bathed in golden morning light"
- "Abstract geometric shapes forming a bridge between two floating islands, with a gradient sunset background"`;
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
