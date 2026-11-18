import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const status = err.status || 'error';
  const message = err.message || 'Internal server error';

  logger.error({
    err: {
      message: err.message,
      stack: err.stack,
      statusCode,
    },
    req: {
      method: req.method,
      url: req.url,
      ip: req.ip,
    },
  }, 'Unhandled request error occurred');

  res.status(statusCode).json({
    status,
    message,
    ...(env.isDevelopment && { stack: err.stack }),
  });
};
