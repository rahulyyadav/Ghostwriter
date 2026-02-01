const { App, ExpressReceiver } = require('@slack/bolt');
const express = require('express');
const config = require('./src/config/config');
const logger = require('./src/utils/logger');
const { testConnection, supabase } = require('./src/database/supabaseClient');
const EventHandler = require('./src/slack/eventHandler');
const notifier = require('./src/slack/notifier');
const commandHandler = require('./src/services/commandHandler');
const imageGenerator = require('./src/services/imageGenerator');
const lifecycleManager = require('./src/services/lifecycleManager');
const healthCheck = require('./src/utils/health');
const metrics = require('./src/utils/metrics');

const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

async function main() {
  try {
    logger.info('🚀 Starting Ghostwriter Bot...');

    // Test database connection first
    logger.info('Testing Supabase connection...');
    await testConnection();

    // Create Express receiver for HTTP mode (handles OAuth + events)
    const receiver = new ExpressReceiver({
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      clientId: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
      stateSecret: process.env.STATE_SECRET || 'ghostwriter-state-secret-2026',
      scopes: [
        'chat:write',
        'channels:history',
        'groups:history',
        'im:history',
        'mpim:history',
        'app_mentions:read',
        'files:write',
        'users:read',
      ],
      installerOptions: {
        directInstall: true,
        redirectUriPath: '/slack/oauth_redirect',
        stateVerification: false, // Disable state verification for simpler OAuth flow
      },
      installationStore: {
        storeInstallation: async (installation) => {
          logger.info('📦 Storing installation', {
            teamId: installation.team?.id,
            enterpriseId: installation.enterprise?.id
          });

          const id = installation.isEnterpriseInstall
            ? installation.enterprise?.id
            : installation.team?.id;

          if (!id) {
            throw new Error('No team or enterprise id found');
          }

          const { error } = await supabase
            .from('slack_installations')
            .upsert({
              id,
              installation_type: installation.isEnterpriseInstall ? 'enterprise' : 'team',
              installation_data: installation,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'id' });

          if (error) {
            logger.error('Failed to store installation', { error: error.message });
            throw error;
          }

          logger.info('✅ Installation stored successfully', { id });
        },

        fetchInstallation: async (installQuery) => {
          const id = installQuery.isEnterpriseInstall
            ? installQuery.enterpriseId
            : installQuery.teamId;

          logger.debug('Fetching installation', { id });

          const { data, error } = await supabase
            .from('slack_installations')
            .select('installation_data')
            .eq('id', id)
            .single();

          if (error) {
            logger.error('Failed to fetch installation', { id, error: error.message });
            throw error;
          }

          return data.installation_data;
        },

        deleteInstallation: async (installQuery) => {
          const id = installQuery.isEnterpriseInstall
            ? installQuery.enterpriseId
            : installQuery.teamId;

          logger.info('🗑️ Deleting installation', { id });

          const { error } = await supabase
            .from('slack_installations')
            .delete()
            .eq('id', id);

          if (error) {
            logger.error('Failed to delete installation', { id, error: error.message });
            throw error;
          }
        },
      },
    });

    // Add custom routes to the receiver's Express app

    // Health check endpoint
    receiver.app.get('/health', (req, res) => {
      res.status(200).send('I am alive 🚀');
    });

    // Landing page
    receiver.app.get(['/', '/home', '/landing', '/index.html'], (req, res) => {
      fs.readFile(path.join(__dirname, 'landing_page', 'index.html'), (err, data) => {
        if (err) {
          res.status(500).send('Error loading landing page');
        } else {
          res.setHeader('Content-Type', 'text/html');
          res.send(data);
        }
      });
    });

    // CSS for landing page
    receiver.app.get('/styles.css', (req, res) => {
      fs.readFile(path.join(__dirname, 'landing_page', 'styles.css'), (err, data) => {
        if (err) {
          res.status(500).send('Error loading styles');
        } else {
          res.setHeader('Content-Type', 'text/css');
          res.send(data);
        }
      });
    });

    // Initialize Slack app with the receiver
    const app = new App({
      receiver,
      logLevel: config.logging.level === 'debug' ? 'DEBUG' : 'INFO',
    });

    // ============================================
    // EVERYTHING BELOW THIS LINE IS UNCHANGED
    // Same event handlers, same logic, same features
    // ============================================

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

    // Setup event handlers (UNCHANGED - same EventHandler class)
    new EventHandler(app);

    // Start the app on the specified port
    await app.start(PORT);
    logger.info(`✅ Slack app listening on port ${PORT}`);

    // Start lifecycle manager (cleanup job)
    await lifecycleManager.start();

    // Log health check and metrics every hour
    const healthCheckInterval = setInterval(async () => {
      await healthCheck.logReport();
      metrics.logSummary();
    }, 60 * 60 * 1000);

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
