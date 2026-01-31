/**
 * Redis Client for TCP connections (ioredis)
 * Uses standard Redis protocol with redis:// connection string
 */
const Redis = require('ioredis');
const logger = require('../utils/logger');

let redis = null;

/**
 * Initialize Redis client from REDIS_URL
 */
function init() {
    if (redis) return redis;

    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
        logger.warn('REDIS_URL not configured - falling back to in-memory storage');
        return null;
    }

    try {
        redis = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryDelayOnFailover: 100,
            enableReadyCheck: true,
            lazyConnect: true, // Don't connect immediately
        });

        // Connect and handle events
        redis.connect().catch((err) => {
            logger.error('Redis connection failed', { error: err.message });
            redis = null;
        });

        redis.on('connect', () => {
            logger.info('Redis connected (TCP)');
        });

        redis.on('error', (err) => {
            logger.error('Redis error', { error: err.message });
        });

        redis.on('close', () => {
            logger.debug('Redis connection closed');
        });

        console.log(`🔗 [REDIS] Connecting via TCP: ${redisUrl.substring(0, 30)}...`);
        return redis;
    } catch (error) {
        logger.error('Failed to initialize Redis', { error: error.message });
        return null;
    }
}

/**
 * Get the Redis client instance
 */
function getClient() {
    if (!redis) {
        init();
    }
    return redis;
}

/**
 * Check if Redis is available
 */
function isAvailable() {
    return redis !== null && redis.status === 'ready';
}

/**
 * Gracefully disconnect Redis
 */
async function disconnect() {
    if (redis) {
        await redis.quit();
        redis = null;
        logger.info('Redis disconnected');
    }
}

module.exports = {
    init,
    getClient,
    isAvailable,
    disconnect,
};
