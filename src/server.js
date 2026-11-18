import app from './app.js';
import { env, validateProductionEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

let server;

const startServer = async () => {
  try {
    // Validate mandatory production configuration before connecting or binding
    validateProductionEnv();

    // Attempt database connection
    await connectDatabase();

    // Start Express server
    server = app.listen(env.PORT, () => {
      logger.info(`Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to start server');
    process.exit(1);
  }
};

// Graceful shutdown helper
const handleShutdown = async (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed.');
      await disconnectDatabase();
      logger.info('Clean shutdown complete.');
      process.exit(0);
    });

    // Force close after 10s timeout if connections hang
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  } else {
    await disconnectDatabase();
    process.exit(0);
  }
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Rejection detected');
});

process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught Exception detected');
  process.exit(1);
});

startServer();
