const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');
const { ImageGenerationError } = require('../utils/errors');

/**
 * Leonardo AI Image Generator
 * API Docs: https://docs.leonardo.ai/
 */
class ImageGenerator {
  constructor() {
    this.apiKey = config.imageGeneration?.leonardoApiKey;
    this.baseUrl = 'https://cloud.leonardo.ai/api/rest/v1';
    this.defaultModel = 'b7aa9939-abed-4d4e-96c4-140b8c65dd92'; // DreamShaper v7
  }

  /**
   * Check if image generation is available
   */
  isAvailable() {
    return !!this.apiKey;
  }

  /**
   * Generate an image from a prompt
   * @param {string} prompt - The image generation prompt
   * @param {object} options - Generation options
   * @returns {Promise<object>} Generated image result
   */
  async generateImage(prompt, options = {}) {
    if (!this.isAvailable()) {
      throw new ImageGenerationError('Leonardo AI API key not configured');
    }

    const {
      width = 1024,
      height = 1024,
      numImages = 1,
      modelId = this.defaultModel,
    } = options;

    try {
      logger.info('Starting image generation', { promptLength: prompt.length });

      // Step 1: Create generation request
      const generationResponse = await axios.post(
        `${this.baseUrl}/generations`,
        {
          prompt,
          modelId,
          width,
          height,
          num_images: numImages,
          guidance_scale: 7,
          presetStyle: 'DYNAMIC',
          public: false,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const generationId = generationResponse.data.sdGenerationJob?.generationId;

      if (!generationId) {
        throw new Error('No generation ID returned from Leonardo AI');
      }

      logger.debug('Generation started', { generationId });

      // Step 2: Poll for completion
      const result = await this.waitForGeneration(generationId);

      logger.info('Image generation completed', {
        generationId,
        imageCount: result.images?.length || 0,
      });

      return {
        generationId,
        images: result.images || [],
        base64: result.images?.[0]?.url ? null : result.images?.[0]?.base64,
        url: result.images?.[0]?.url,
      };
    } catch (error) {
      logger.error('Image generation failed', {
        error: error.message,
        response: error.response?.data,
      });

      if (error.response?.status === 402) {
        throw new ImageGenerationError('Leonardo AI credits exhausted. Please add more credits.');
      }

      if (error.response?.status === 429) {
        throw new ImageGenerationError('Leonardo AI rate limit exceeded. Please try again later.');
      }

      throw new ImageGenerationError(`Image generation failed: ${error.message}`, error);
    }
  }

  /**
   * Wait for generation to complete
   */
  async waitForGeneration(generationId, maxAttempts = 30, intervalMs = 2000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await axios.get(
          `${this.baseUrl}/generations/${generationId}`,
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
            },
            timeout: 10000,
          }
        );

        const generation = response.data.generations_by_pk;

        if (generation?.status === 'COMPLETE') {
          return {
            status: 'COMPLETE',
            images: generation.generated_images || [],
          };
        }

        if (generation?.status === 'FAILED') {
          throw new Error('Generation failed');
        }

        logger.debug('Generation in progress', { attempt, status: generation?.status });

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }
        logger.warn('Poll failed, retrying', { attempt, error: error.message });
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }

    throw new Error('Generation timed out');
  }

  /**
   * Upload generated image to Slack
   */
  async uploadToSlack(slackClient, channelId, threadTs, imageUrl, filename) {
    try {
      logger.info('Uploading image to Slack', { channelId, threadTs });

      // Download the image first
      const imageResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const imageBuffer = Buffer.from(imageResponse.data);

      // Upload to Slack using files.uploadV2
      const result = await slackClient.files.uploadV2({
        channel_id: channelId,
        thread_ts: threadTs,
        file: imageBuffer,
        filename: filename || 'generated-image.png',
        title: 'Generated Image for Your Post',
      });

      logger.info('Image uploaded to Slack', {
        channelId,
        fileId: result.file?.id,
      });

      return result;
    } catch (error) {
      logger.error('Failed to upload image to Slack', { error: error.message });
      throw new ImageGenerationError(`Failed to upload image to Slack: ${error.message}`, error);
    }
  }

  /**
   * Get account credits/usage info
   */
  async getAccountInfo() {
    if (!this.isAvailable()) {
      return { available: false };
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/me`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        }
      );

      return {
        available: true,
        user: response.data.user_details?.[0],
      };
    } catch (error) {
      logger.error('Failed to get account info', { error: error.message });
      return { available: false, error: error.message };
    }
  }
}

module.exports = new ImageGenerator();
