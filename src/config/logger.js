import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : process.env.LOG_LEVEL || (env.isProduction ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.otp',
      '*.accessToken',
      '*.password',
      '*.sessionToken',
    ],
    censor: '[REDACTED]',
  },
  transport: env.isProduction || env.isTest
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
});
