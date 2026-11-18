import pinoHttp from 'pino-http';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export const requestLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => env.isTest || req.url === '/health',
  },
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} completed with ${res.statusCode}`,
  customErrorMessage: (req, res, error) => `${req.method} ${req.url} failed with ${res.statusCode}: ${error.message}`,
});
