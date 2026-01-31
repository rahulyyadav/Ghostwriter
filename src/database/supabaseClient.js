const { createClient } = require('@supabase/supabase-js');
const config = require('../config/config');
const logger = require('../utils/logger');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Test connection on startup
async function testConnection() {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('id')
      .limit(1);

    if (error) throw error;

    logger.info('✅ Supabase connection established');
    return true;
  } catch (error) {
    logger.error('❌ Supabase connection failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  supabase,
  testConnection,
};
