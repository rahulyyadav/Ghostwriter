const { GoogleGenerativeAI } = require('@google/generative-ai');
const RateLimiter = require('./rateLimiter');
const { getSummaryCompressionPrompt, getInsightDetectionPrompt } = require('./prompts');
const {
  getTwitterPostPrompt,
  getLinkedInPostPrompt,
  getImagePromptGeneratorPrompt,
  getAlternativeVersionsPrompt,
} = require('./postGeneratorPrompts');
const config = require('../config/config');
const logger = require('../utils/logger');
const { LLMError, RateLimitError } = require('../utils/errors');

class GeminiClient {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.llm.geminiApiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    this.rateLimiter = new RateLimiter(
      config.gemini.maxRequestsPerMinute,
      config.gemini.maxRequestsPerDay
    );
  }

  /**
   * Make a request to Gemini with retry logic
   */
  async makeRequest(prompt, maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check rate limit
        await this.rateLimiter.attempt();

        // Make request with timeout
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), config.gemini.timeoutMs)
        );

        const requestPromise = this.model.generateContent(prompt);

        const result = await Promise.race([requestPromise, timeoutPromise]);
        const response = result.response;
        const text = response.text();

        logger.debug('Gemini request successful', {
          attempt,
          responseLength: text.length,
        });

        return text;
      } catch (error) {
        lastError = error;

        if (error instanceof RateLimitError) {
          // Rate limit hit - don't retry immediately
          throw error;
        }

        logger.warn('Gemini request failed', {
          attempt,
          maxRetries,
          error: error.message,
          errorCode: error.code || error.status,
          errorDetails: error.errorDetails || error.response?.data,
        });

        // Log the actual error to console for debugging
        console.error(`[Gemini Error] Attempt ${attempt}: ${error.message}`);

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }
    }

    throw new LLMError(`Gemini request failed after ${maxRetries} attempts`, lastError);
  }

  /**
   * Compress summary
   */
  async compressSummary(currentSummary, newMessages) {
    try {
      logger.info('Compressing summary', {
        currentSummaryLength: currentSummary?.length || 0,
        newMessagesLength: newMessages.length,
      });

      const prompt = getSummaryCompressionPrompt(currentSummary, newMessages);
      const response = await this.makeRequest(prompt, config.summaryCompression.maxRetries);

      // Clean up response
      const compressed = response.trim();

      // Enforce max length
      const maxWords = config.summaryCompression.maxSummaryWords;
      const words = compressed.split(/\s+/);

      if (words.length > maxWords) {
        logger.warn('Summary exceeded max words, truncating', {
          actualWords: words.length,
          maxWords,
        });
        return words.slice(0, maxWords).join(' ') + '...';
      }

      logger.info('Summary compressed successfully', {
        outputLength: compressed.length,
        outputWords: words.length,
      });

      return compressed;
    } catch (error) {
      logger.error('Summary compression failed', { error });
      throw error;
    }
  }

  /**
   * Detect insight (post-worthiness)
   */
  async detectInsight(rollingSummary) {
    try {
      logger.info('Detecting insight', {
        summaryLength: rollingSummary.length,
      });

      const prompt = getInsightDetectionPrompt(rollingSummary);
      const response = await this.makeRequest(prompt);

      // Parse JSON response
      const parsed = this.parseInsightResponse(response);

      logger.info('Insight detected', {
        isPostWorthy: parsed.isPostWorthy,
        confidence: parsed.confidence,
      });

      return parsed;
    } catch (error) {
      logger.error('Insight detection failed', { error });
      throw error;
    }
  }

  /**
   * Parse and validate insight detection response
   */
  parseInsightResponse(response) {
    try {
      // Try to extract JSON from response (sometimes LLM adds extra text)
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');

      // Find JSON object
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const data = JSON.parse(jsonStr);

      // Validate required fields
      if (typeof data.isPostWorthy !== 'boolean') {
        throw new Error('isPostWorthy must be boolean');
      }

      if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
        throw new Error('confidence must be number between 0 and 1');
      }

      // Enforce confidence threshold
      if (data.confidence < config.insightDetection.confidenceThreshold) {
        logger.debug('Confidence below threshold, marking as not post-worthy', {
          confidence: data.confidence,
          threshold: config.insightDetection.confidenceThreshold,
        });
        data.isPostWorthy = false;
      }

      // Validate content fields
      if (!data.coreInsight || data.coreInsight.length < 10) {
        logger.warn('Core insight too short or missing');
        data.isPostWorthy = false;
      }

      if (!data.suggestedAngle || data.suggestedAngle.length < 20) {
        logger.warn('Suggested angle too short or missing');
        data.isPostWorthy = false;
      }

      return {
        isPostWorthy: data.isPostWorthy,
        confidence: data.confidence,
        coreInsight: data.coreInsight || 'N/A',
        suggestedAngle: data.suggestedAngle || 'N/A',
        reasoning: data.reasoning || 'N/A',
      };
    } catch (error) {
      logger.error('Failed to parse insight response', { error, response });

      // Return safe fallback
      return {
        isPostWorthy: false,
        confidence: 0,
        coreInsight: 'Error parsing response',
        suggestedAngle: 'N/A',
        reasoning: `JSON parse error: ${error.message}`,
      };
    }
  }

  /**
   * Generate a social media post from an insight
   * @param {object} insight - The insight object with core_insight and suggested_angle
   * @param {string} platform - 'twitter' or 'linkedin'
   * @returns {Promise<string>} Generated post content
   */
  async generatePost(insight, platform) {
    try {
      logger.info('Generating post', {
        platform,
        insightLength: insight.core_insight?.length || 0,
      });

      let prompt;
      if (platform === 'twitter') {
        prompt = getTwitterPostPrompt(insight);
      } else if (platform === 'linkedin') {
        prompt = getLinkedInPostPrompt(insight);
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }

      const response = await this.makeRequest(prompt);
      const post = response.trim();

      // Validate length for Twitter
      if (platform === 'twitter' && post.length > 280) {
        logger.warn('Generated tweet exceeds 280 chars, truncating', {
          originalLength: post.length,
        });
        return post.substring(0, 277) + '...';
      }

      logger.info('Post generated successfully', {
        platform,
        postLength: post.length,
      });

      return post;
    } catch (error) {
      logger.error('Post generation failed', { error, platform });
      throw error;
    }
  }

  /**
   * Generate an alternative version of a post
   * @param {object} insight - The insight object
   * @param {string} platform - 'twitter' or 'linkedin'
   * @param {string} existingPost - The existing post to avoid duplicating
   * @returns {Promise<string>} New post content
   */
  async generateAlternativePost(insight, platform, existingPost) {
    try {
      logger.info('Generating alternative post', {
        platform,
        existingPostLength: existingPost?.length || 0,
      });

      const prompt = getAlternativeVersionsPrompt(insight, platform, existingPost);
      const response = await this.makeRequest(prompt);
      const post = response.trim();

      // Validate length for Twitter
      if (platform === 'twitter' && post.length > 280) {
        return post.substring(0, 277) + '...';
      }

      logger.info('Alternative post generated', {
        platform,
        postLength: post.length,
      });

      return post;
    } catch (error) {
      logger.error('Alternative post generation failed', { error, platform });
      throw error;
    }
  }

  /**
   * Generate an image prompt from post content
   * @param {string} postContent - The post content
   * @param {string} platform - 'twitter' or 'linkedin'
   * @returns {Promise<string>} Image generation prompt
   */
  async generateImagePrompt(postContent, platform) {
    try {
      logger.info('Generating image prompt', {
        platform,
        postContentLength: postContent.length,
      });

      const prompt = getImagePromptGeneratorPrompt(postContent, platform);
      const response = await this.makeRequest(prompt);
      const imagePrompt = response.trim();

      logger.info('Image prompt generated', {
        promptLength: imagePrompt.length,
      });

      return imagePrompt;
    } catch (error) {
      logger.error('Image prompt generation failed', { error });
      throw error;
    }
  }

  // ============================================
  // TWO-PHASE LLM APPROACH
  // Phase A: Quick filter (cheap, fast)
  // Phase B: Detailed analysis (only if Phase A passes)
  // ============================================

  /**
   * Phase A: Quick insight check - just YES/NO
   * This is a cheap, fast filter to avoid expensive detailed analysis
   *
   * @param {string} conversationText - Formatted conversation
   * @returns {Promise<{hasInsight: boolean, reasoning: string}>}
   */
  async quickInsightCheck(conversationText) {
    try {
      logger.debug('Phase A: Quick insight check');

      // Shorter prompt = faster + cheaper
      const prompt = `Analyze this conversation quickly. Is there a GENERALIZED INSIGHT or ARTICULATION that could stand alone as a social media post?

CONVERSATION:
${conversationText}

---

Answer in JSON: {"hasInsight": true/false, "reasoning": "1 sentence why"}

Only say true if there's something genuinely interesting to share (not just Q&A, small talk, or debugging).`;

      const response = await this.makeRequest(prompt, 2); // Fewer retries for quick check

      // Parse response
      try {
        let jsonStr = response.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];

        const data = JSON.parse(jsonStr);
        return {
          hasInsight: data.hasInsight === true,
          reasoning: data.reasoning || '',
        };
      } catch {
        // If parsing fails, be conservative - say no
        return { hasInsight: false, reasoning: 'Parse error' };
      }
    } catch (error) {
      logger.error('Phase A quick check failed', { error });
      // On error, skip Phase B (be conservative with API calls)
      return { hasInsight: false, reasoning: `Error: ${error.message}` };
    }
  }

  /**
   * Phase B: Detailed analysis - full insight extraction
   * Only called if Phase A returns hasInsight: true
   *
   * @param {string} conversationText - Formatted conversation from sliding window
   * @returns {Promise<object>} Analysis result with hasPostIdea, title, summary, etc.
   */
  async detectPostIdea(conversationText) {
    try {
      logger.info('Analyzing conversation for post ideas', {
        textLength: conversationText.length,
      });

      const prompt = `You are an expert content strategist helping identify post-worthy ideas from team conversations.

Analyze this Slack conversation and determine if it contains an insight worth sharing on social media (Twitter/X or LinkedIn).

CONVERSATION:
${conversationText}

---

A post-worthy idea should have:
- An interesting insight, tip, lesson learned, or unique perspective
- Value for others in the tech/startup community
- Something concrete (not just generic discussion)
- Potential for engagement (thought-provoking, relatable, or actionable)

RESPOND IN THIS EXACT JSON FORMAT:
{
  "hasPostIdea": true/false,
  "confidence": 0.0-1.0,
  "title": "Short title for the idea (3-7 words)",
  "summary": "2-3 sentence summary of the post-worthy insight",
  "suggestedAngle": "How to frame this for social media",
  "bestPlatform": "twitter" or "linkedin" or "both",
  "reasoning": "Why this is/isn't post-worthy"
}

Only set hasPostIdea to true if confidence is >= 0.7 and you genuinely believe this would make a good social media post.`;

      const response = await this.makeRequest(prompt);
      const parsed = this.parsePostIdeaResponse(response);

      logger.info('Post idea analysis complete', {
        hasPostIdea: parsed.hasPostIdea,
        confidence: parsed.confidence,
        title: parsed.title,
      });

      return parsed;
    } catch (error) {
      logger.error('Post idea detection failed', { error });
      // Return safe fallback - don't throw to avoid breaking the bot
      return {
        hasPostIdea: false,
        confidence: 0,
        title: '',
        summary: '',
        suggestedAngle: '',
        bestPlatform: 'both',
        reasoning: `Error: ${error.message}`,
      };
    }
  }

  /**
   * Parse post idea detection response
   */
  parsePostIdeaResponse(response) {
    try {
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');

      // Find JSON object
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const data = JSON.parse(jsonStr);

      // Validate and set defaults
      return {
        hasPostIdea: data.hasPostIdea === true && data.confidence >= 0.7,
        confidence: typeof data.confidence === 'number' ? data.confidence : 0,
        title: data.title || '',
        summary: data.summary || '',
        suggestedAngle: data.suggestedAngle || '',
        bestPlatform: data.bestPlatform || 'both',
        reasoning: data.reasoning || '',
      };
    } catch (error) {
      logger.error('Failed to parse post idea response', { error, response });
      return {
        hasPostIdea: false,
        confidence: 0,
        title: '',
        summary: '',
        suggestedAngle: '',
        bestPlatform: 'both',
        reasoning: `Parse error: ${error.message}`,
      };
    }
  }

  /**
   * Review a user-submitted post idea and provide feedback
   * @param {string} ideaContent - The user's post idea
   * @returns {Promise<object>} Feedback on the idea
   */
  async reviewUserIdea(ideaContent) {
    try {
      logger.info('Reviewing user-submitted idea', {
        ideaLength: ideaContent.length,
      });

      const prompt = `You are an expert social media content strategist. A user has shared a post idea and wants your feedback.

USER'S POST IDEA:
${ideaContent}

---

Please analyze this post idea and provide constructive feedback. Consider:
- Clarity and message effectiveness
- Hook/opening strength
- Value proposition for readers
- Appropriate length and formatting
- Suggestions for improvement

RESPOND IN THIS EXACT JSON FORMAT:
{
  "rating": "excellent" or "good" or "needs_work",
  "score": 1-10,
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["suggestion 1", "suggestion 2"],
  "feedback": "2-3 sentence overall assessment",
  "improvedVersion": "An improved version of the post (optional, only if changes would significantly help)",
  "bestPlatform": "twitter" or "linkedin" or "both"
}

Be encouraging but honest. Focus on actionable feedback.`;

      const response = await this.makeRequest(prompt);
      const parsed = this.parseIdeaReviewResponse(response);

      logger.info('Idea review complete', {
        rating: parsed.rating,
        score: parsed.score,
      });

      return parsed;
    } catch (error) {
      logger.error('Idea review failed', { error });
      throw error;
    }
  }

  /**
   * Detect if there's a post-worthy idea and generate post content if yes
   * Simple flow: Returns { hasIdea: false } or { hasIdea: true, postContent: "..." }
   * 
   * @param {string} conversationText - The sliding window conversation text
   * @returns {Promise<object>} { hasIdea, postContent, title, platform }
   */
  async detectAndGeneratePost(conversationText) {
    try {
      console.log(`[GEMINI] detectAndGeneratePost called with ${conversationText.length} chars`);

      const prompt = `Analyze this conversation and determine if there's a post-worthy idea for LinkedIn or Twitter.

CONVERSATION:
${conversationText}

---

If there's a good post idea (an insight, tip, lesson learned, interesting perspective, or shareable content), respond with:
{
  "hasIdea": true,
  "title": "Brief title of the idea",
  "platform": "linkedin" or "twitter",
  "postContent": "The actual post content ready to publish. Make it engaging and professional."
}

If there's no post-worthy idea, respond with:
{
  "hasIdea": false
}

Return ONLY valid JSON, nothing else.`;

      const response = await this.makeRequest(prompt);

      console.log(`[GEMINI] Raw response: ${response.substring(0, 200)}...`);

      // Parse JSON response
      let jsonStr = response.trim();
      jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const result = JSON.parse(jsonStr);

      console.log(`[GEMINI] Parsed result: hasIdea=${result.hasIdea}`);

      if (result.hasIdea) {
        return {
          hasIdea: true,
          hasPostIdea: true, // For backward compatibility
          title: result.title || 'Post Idea',
          postContent: result.postContent,
          summary: result.postContent,
          bestPlatform: result.platform || 'linkedin',
          confidence: 0.9,
        };
      }

      return { hasIdea: false, hasPostIdea: false };

    } catch (error) {
      console.error(`[GEMINI] detectAndGeneratePost error:`, error.message);
      logger.error('detectAndGeneratePost failed', { error: error.message });
      return { hasIdea: false, hasPostIdea: false };
    }
  }

  /**
   * Analyze a conversation and respond naturally
   * This is the main entry point when bot is mentioned - uses Gemini to:
   * 1. Detect if there are any post-worthy ideas in the conversation
   * 2. Detect if user wants an image generated
   * 3. Respond in a natural, human-like tone
   * 
   * @param {string} conversationContext - The 50 message sliding window + current message
   * @param {string} currentMessage - The user's current message that triggered the mention
   * @returns {Promise<object>} Analysis result with response and detected idea
   */
  async analyzeConversationAndRespond(conversationContext, currentMessage) {
    try {
      // Sanitize the context - remove Slack user mentions and special formatting
      const sanitizedContext = conversationContext
        .replace(/<@[A-Z0-9]+>/g, '[user]') // Remove user mentions
        .replace(/<#[A-Z0-9]+\|[^>]+>/g, '[channel]') // Remove channel mentions
        .replace(/<[^>]+>/g, '') // Remove other Slack formatting
        .substring(0, 3000); // Limit context size to avoid API issues

      const sanitizedMessage = currentMessage
        .replace(/<@[A-Z0-9]+>/g, '')
        .trim();

      logger.info('Analyzing conversation with Gemini', {
        contextLength: sanitizedContext.length,
        messageLength: sanitizedMessage.length,
      });

      const prompt = `You are a helpful AI assistant that identifies interesting ideas from conversations and helps create social media content.

Conversation:
${sanitizedContext}

User's question: ${sanitizedMessage}

Task: 
1. Is there a post-worthy idea (insight, tip, lesson, interesting perspective)?
2. Is the user asking for an image? (e.g., "what image", "generate image", "create a visual", "best image for this post", "make an image")
3. If user wants an image, create a detailed image prompt suitable for AI image generation (describe the visual, style, mood).
4. Respond naturally.

Return JSON:
{
  "hasIdea": true/false,
  "detectedIdea": "the idea text if found, else empty",
  "wantsImage": true/false,
  "imagePrompt": "detailed image generation prompt if wantsImage is true, else empty",
  "response": "your friendly 2-3 sentence response"
}`;

      const response = await this.makeRequest(prompt);

      // Parse the JSON response
      try {
        let jsonStr = response.trim();
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }

        const data = JSON.parse(jsonStr);

        logger.info('Conversation analysis complete', {
          hasIdea: data.hasIdea,
          wantsImage: data.wantsImage,
          detectedIdeaLength: data.detectedIdea?.length || 0,
        });

        return {
          hasIdea: data.hasIdea === true,
          detectedIdea: data.detectedIdea || '',
          wantsImage: data.wantsImage === true,
          imagePrompt: data.imagePrompt || '',
          response: data.response || "I'm here to help! Let me know what you'd like to do.",
        };
      } catch (parseError) {
        logger.warn('Failed to parse Gemini response as JSON, using raw text', { parseError });
        // If JSON parsing fails, use the raw response as the message
        return {
          hasIdea: false,
          detectedIdea: '',
          wantsImage: false,
          imagePrompt: '',
          response: response.trim() || "I'm here to help! What would you like me to do?",
        };
      }
    } catch (error) {
      logger.error('Conversation analysis failed', { error: error.message });
      console.error('[Gemini] Conversation analysis error:', error.message);
      return {
        hasIdea: false,
        detectedIdea: '',
        wantsImage: false,
        imagePrompt: '',
        response: "Hey! I had a little trouble understanding. Could you tell me more about what you'd like help with?",
      };
    }
  }

  /**
   * Review a user-submitted post idea with conversational, natural tone
   * @param {string} ideaContent - The user's post idea
   * @param {string} channelContext - Optional context from recent channel messages
   * @returns {Promise<object>} Conversational feedback on the idea
   */
  async reviewUserIdeaConversationally(ideaContent, channelContext = '') {
    try {
      logger.info('Reviewing user idea conversationally', {
        ideaLength: ideaContent.length,
        hasContext: channelContext.length > 0,
      });

      const contextSection = channelContext
        ? `\nRECENT CHANNEL CONTEXT (for understanding the discussion):\n${channelContext.substring(0, 2000)}\n---\n`
        : '';

      const prompt = `You are a friendly content strategist having a casual conversation about post ideas. A user has shared an idea they want your feedback on.

${contextSection}
USER'S POST IDEA:
${ideaContent}

---

Respond in a natural, conversational way like you're chatting with a colleague. Be encouraging but honest.

Your response should:
1. Acknowledge the idea warmly
2. Point out what's working well (be specific)
3. Suggest 1-2 improvements if needed (constructively)
4. Give a quick recommendation on which platform suits it best

Keep your response concise (2-4 paragraphs max). Don't use formal headers or bullet lists - write naturally like a friendly expert would in a chat.

Output ONLY your conversational response, nothing else.`;

      const response = await this.makeRequest(prompt);
      const conversationalResponse = response.trim();

      logger.info('Conversational review complete', {
        responseLength: conversationalResponse.length,
      });

      return {
        conversationalResponse,
        feedback: conversationalResponse,
        rating: 'good', // Default rating for compatibility
        score: 7,
        bestPlatform: 'both',
      };
    } catch (error) {
      logger.error('Conversational idea review failed', { error });
      // Return a friendly fallback
      return {
        conversationalResponse: "I had a little trouble analyzing your idea, but it looks interesting! Feel free to try sharing it again, and I'll give you more detailed feedback.",
        feedback: "Analysis error - please try again.",
        rating: 'good',
        score: 5,
        bestPlatform: 'both',
      };
    }
  }

  /**
   * Parse idea review response
   */
  parseIdeaReviewResponse(response) {
    try {
      let jsonStr = response.trim();
      jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');

      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const data = JSON.parse(jsonStr);

      return {
        rating: data.rating || 'good',
        score: data.score || 5,
        strengths: data.strengths || [],
        improvements: data.improvements || [],
        feedback: data.feedback || 'Unable to generate feedback.',
        improvedVersion: data.improvedVersion || null,
        bestPlatform: data.bestPlatform || 'both',
      };
    } catch (error) {
      logger.error('Failed to parse idea review response', { error, response });
      return {
        rating: 'good',
        score: 5,
        strengths: [],
        improvements: [],
        feedback: 'I had trouble analyzing your idea. Please try again.',
        improvedVersion: null,
        bestPlatform: 'both',
      };
    }
  }

  /**
   * Generate a post from user-submitted idea content
   * @param {string} ideaContent - The user's raw idea
   * @param {string} platform - 'twitter' or 'linkedin'
   * @returns {Promise<string>} Generated post content
   */
  async generatePostFromUserIdea(ideaContent, platform) {
    try {
      logger.info('Generating post from user idea', {
        platform,
        ideaLength: ideaContent.length,
      });

      const charLimit = platform === 'twitter' ? '280 characters' : '1300 characters';
      const platformStyle = platform === 'twitter'
        ? 'concise, punchy, with strong hook'
        : 'professional, detailed, with clear value proposition';

      const prompt = `You are an expert social media copywriter. Transform this idea into a polished ${platform} post.

USER'S IDEA:
${ideaContent}

---

Create a ${platform} post that:
- Has a strong opening hook
- Is ${platformStyle}
- Stays within ${charLimit}
- Maintains the core message but improves clarity and engagement
- Uses appropriate formatting (line breaks for LinkedIn, concise for Twitter)

Output ONLY the post content, nothing else.`;

      const response = await this.makeRequest(prompt);
      let post = response.trim();

      // Validate length for Twitter
      if (platform === 'twitter' && post.length > 280) {
        logger.warn('Generated tweet exceeds 280 chars, truncating', {
          originalLength: post.length,
        });
        post = post.substring(0, 277) + '...';
      }

      logger.info('Post generated from user idea', {
        platform,
        postLength: post.length,
      });

      return post;
    } catch (error) {
      logger.error('Post generation from user idea failed', { error, platform });
      throw error;
    }
  }

  // ============================================
  // HYBRID BUFFER SYSTEM - SCOUT & AUTHOR
  // Scout: Fast filter to find worthy content
  // Author: Creative writer to generate posts
  // ============================================

  /**
   * Scout AI - Fast filter to detect post-worthy content
   * This is the cheap, fast filter in the Hybrid Buffer System
   * 
   * @param {string} conversationText - Raw conversation logs (20-100 messages)
   * @returns {Promise<{worthy: boolean, topic: string, summary: string}>}
   */
  async scoutAnalyze(conversationText) {
    try {
      console.log(`[SCOUT] Analyzing ${conversationText.length} chars`);
      logger.debug('Scout: Analyzing conversation batch');

      const prompt = `You are a content scout. Analyze this chat log for startup/business ideas worth sharing on LinkedIn.

CHAT LOG (may include Hinglish, typos, casual language):
${conversationText}

---

Your job: Filter noise. Find value.

Look for:
- Insights about building products/startups
- Lessons learned from failures/successes
- Interesting perspectives on business/tech
- Tips that would resonate with founders/builders
- Stories that could inspire others

DO NOT mark as worthy:
- General chit-chat or small talk
- Debugging discussions or technical Q&A
- Meeting scheduling or logistics
- Simple questions without insights

RESPOND IN THIS EXACT JSON FORMAT:
{
  "worthy": true/false,
  "topic": "Brief topic if worthy (e.g., 'Why we pivoted to B2B')",
  "summary": "2-3 sentence summary of the post-worthy insight if worthy"
}

Be selective. Only mark as worthy if it would genuinely make a good LinkedIn post.
Return ONLY valid JSON.`;

      const response = await this.makeRequest(prompt, 2); // Fewer retries for speed

      // Parse JSON response with robust extraction
      const result = this.extractJSON(response, { worthy: false, topic: '', summary: '' });

      console.log(`[SCOUT] Result: worthy=${result.worthy}, topic="${result.topic || 'none'}"`);

      return {
        worthy: result.worthy === true,
        topic: result.topic || '',
        summary: result.summary || '',
      };

    } catch (error) {
      console.error(`[SCOUT] Error:`, error.message);
      logger.error('Scout analysis failed', { error: error.message });
      return { worthy: false, topic: '', summary: '' };
    }
  }

  /**
   * Author AI - Generate a viral LinkedIn post from the Scout's findings
   * Only called if Scout marks content as worthy
   * 
   * @param {string} topic - The topic from Scout
   * @param {string} summary - The summary from Scout
   * @param {string} rawText - Optional raw conversation for tone matching
   * @returns {Promise<string>} The generated post content
   */
  async authorGeneratePost(topic, summary, rawText = '') {
    try {
      console.log(`[AUTHOR] Generating post for topic: "${topic}"`);
      logger.info('Author: Generating post', { topic, summaryLength: summary.length });

      const prompt = `You are a VIRAL LinkedIn content creator. Your posts consistently get 10K+ impressions. 

You write like: Justin Welsh, Sahil Bloom, Shaan Puri, Dickie Bush.

TOPIC: ${topic}

INSIGHT SUMMARY: ${summary}

${rawText ? `ORIGINAL CONVERSATION (for tone reference):\n${rawText.substring(0, 1500)}\n\n---` : ''}

WRITE A VIRAL POST USING THESE TECHNIQUES:

**THE HOOK (Line 1)** - This is EVERYTHING. Use one of these patterns:
- Contrarian: "Everyone obsesses about X. The best founders focus on Y."
- Confession: "Unpopular opinion: [bold take]"
- Curiosity gap: "This one mistake cost me 6 months."  
- Pattern interrupt: Single powerful word. Or a short punchy phrase.
- Numbers: "I spent 2 years learning this in 2 minutes."

**THE BODY:**
- One idea per line
- White space is your friend
- Short sentences punch harder
- Use "You" more than "I"
- Tell a micro-story (setup → conflict → insight)

**THE CLOSER:**
- End with a question (drives comments)
- Or a reframe that sticks
- Never say "What do you think?" - be more specific

**FORMAT:**
- 80-150 words MAX
- No emojis except sparingly
- No hashtags
- Line breaks after every 1-2 sentences
- First person, conversational tone

**AVOID:**
- Generic advice ("work hard", "stay focused")
- Corporate speak
- Starting with "I"
- Long paragraphs
- Sounding preachy

Write the post directly. Hook on line 1. Make it SCROLL-STOPPING.`;

      const response = await this.makeRequest(prompt);
      const post = response.trim();

      console.log(`[AUTHOR] Generated post (${post.length} chars)`);
      logger.info('Author: Post generated', { postLength: post.length });

      return post;

    } catch (error) {
      console.error(`[AUTHOR] Error:`, error.message);
      logger.error('Author post generation failed', { error: error.message });
      return null;
    }
  }

  /**
   * Get rate limiter stats
   */
  getRateLimitStats() {
    return this.rateLimiter.getStats();
  }

  /**
   * Robust JSON extraction from LLM response
   * Handles markdown code blocks, extra text, and malformed responses
   *
   * @param {string} response - Raw LLM response
   * @param {object} fallback - Default value if parsing fails
   * @returns {object} Parsed JSON or fallback
   */
  extractJSON(response, fallback = {}) {
    try {
      let text = response.trim();

      // Remove markdown code blocks
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

      // Try to find a balanced JSON object using bracket counting
      const startIdx = text.indexOf('{');
      if (startIdx === -1) {
        logger.warn('No JSON object found in response', { responsePreview: text.substring(0, 100) });
        return fallback;
      }

      let braceCount = 0;
      let endIdx = -1;

      for (let i = startIdx; i < text.length; i++) {
        if (text[i] === '{') braceCount++;
        if (text[i] === '}') braceCount--;

        if (braceCount === 0) {
          endIdx = i;
          break;
        }
      }

      if (endIdx === -1) {
        logger.warn('Unbalanced braces in JSON response', { responsePreview: text.substring(0, 200) });
        return fallback;
      }

      const jsonStr = text.substring(startIdx, endIdx + 1);
      const parsed = JSON.parse(jsonStr);

      return parsed;
    } catch (error) {
      logger.error('JSON extraction failed', { error: error.message, responsePreview: response.substring(0, 200) });
      return fallback;
    }
  }
}

module.exports = new GeminiClient();
