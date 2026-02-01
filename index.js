const { App } = require('@slack/bolt');
const http = require('http');
const config = require('./src/config/config');
const logger = require('./src/utils/logger');
const { testConnection } = require('./src/database/supabaseClient');
const EventHandler = require('./src/slack/eventHandler');
const notifier = require('./src/slack/notifier');
const commandHandler = require('./src/services/commandHandler');
const imageGenerator = require('./src/services/imageGenerator');
const lifecycleManager = require('./src/services/lifecycleManager');
const healthCheck = require('./src/utils/health');
const metrics = require('./src/utils/metrics');

const fs = require('fs');
const path = require('path');

// HTTP server for health checks and Landing Page
const PORT = process.env.PORT || 3000;
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('I am alive 🚀');
  } else if (req.url === '/' || req.url === '/home' || req.url === '/landing' || req.url === '/index.html') {
    // Serve Landing Page
    fs.readFile(path.join(__dirname, 'landing_page', 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading landing page');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      }
    });
  } else if (req.url === '/styles.css') {
    // Serve CSS
    fs.readFile(path.join(__dirname, 'landing_page', 'styles.css'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading styles');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(data);
      }
    });
  } else if (req.url && req.url.startsWith('/slack/oauth_redirect')) {
    // Handle Slack OAuth redirect - show success page
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Ghostwriter - Installation</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
          .card { background: white; padding: 40px 60px; border-radius: 16px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
          h1 { color: #333; margin-bottom: 10px; }
          p { color: #666; font-size: 18px; }
          .emoji { font-size: 48px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="emoji">🎉</div>
          <h1>Thanks for your interest!</h1>
          <p>Ghostwriter is currently in private beta.</p>
          <p>Contact us to get access!</p>
        </div>
      </body>
      </html>
    `);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

async function main() {
  try {
    logger.info('🚀 Starting Post Suggestion Bot...');

    // Start health server FIRST (Render needs to detect port binding immediately)
    healthServer.listen(PORT, '0.0.0.0', () => {
      logger.info(`✅ Health server listening on port ${PORT}`);
    });

    // Test database connection
    logger.info('Testing Supabase connection...');
    await testConnection();

    // Initialize Slack app
    const app = new App({
      token: config.slack.botToken,
      appToken: config.slack.appToken,
      socketMode: true,
      logLevel: config.logging.level === 'debug' ? 'DEBUG' : 'INFO',
    });

    // Setup notifier with Slack client
    notifier.setClient(app.client);

    // Setup command handler with Slack client
    commandHandler.setSlackClient(app.client);

    // Setup image generator if enabled
    if (config.features.enableImageGeneration && imageGenerator.isAvailable()) {
      commandHandler.setImageGenerator(imageGenerator);
      logger.info('Image generation enabled (Leonardo AI)');
    } else if (config.features.enableImageGeneration) {
      logger.warn('Image generation enabled but LEONARDO_API_KEY not configured');
    }

    // Setup event handlers
    new EventHandler(app);

    // Start the app
    await app.start();

    // Start lifecycle manager (cleanup job)
    await lifecycleManager.start();

    // Log health check and metrics every hour
    const healthCheckInterval = setInterval(async () => {
      await healthCheck.logReport();
      metrics.logSummary();
    }, 60 * 60 * 1000); // Every hour

    // Initial health check
    await healthCheck.logReport();

    logger.info('✅ Bot is running!');
    logger.info('Bot will work in any channel it\'s invited to');
    logger.info(`Notification method: ${config.notification.deliveryMethod}`);
    logger.info(`Analyzer mode: ${config.features.useSimpleAnalyzer ? 'SIMPLE (20-message sliding window)' : 'COMPLEX (signal gates + compression)'}`);
    logger.info(`Features: Insight Detection=${config.features.enableInsightDetection}, Post Generation=${config.features.enablePostGeneration}, Image Generation=${config.features.enableImageGeneration}, Dry Run=${config.features.dryRunMode}`);

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down...');
      clearInterval(healthCheckInterval);
      lifecycleManager.stop();
      await app.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down...');
      clearInterval(healthCheckInterval);
      lifecycleManager.stop();
      await app.stop();
      process.exit(0);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
      console.error('Unhandled rejection at:', promise, 'reason:', reason);
    });
  } catch (error) {
    logger.error('Failed to start bot', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause,
    });
    console.error('Full error details:', error);
    process.exit(1);
  }
}

main();
