import mongoose from 'mongoose';
import { logger } from '../config/logger.js';

const MAX_RETRIES = 3;

/**
 * Execute a database operation inside a MongoDB transaction when supported (replica set / Atlas).
 * Safely retries transient transaction errors and gracefully falls back to direct execution
 * on standalone MongoDB instances (e.g., local dev or MongoMemoryServer standalone).
 *
 * @param {(session: mongoose.ClientSession | null) => Promise<T>} workFn
 * @returns {Promise<T>}
 */
export async function runInTransaction(workFn) {
  const isProd = process.env.NODE_ENV === 'production';
  let session = null;

  try {
    session = await mongoose.startSession();
  } catch (startErr) {
    if (isProd) {
      throw new Error(
        `MongoDB replica set or Atlas is required for atomic transactions in production: ${startErr.message}`,
      );
    }
    return workFn(null);
  }

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      let result;
      await session.withTransaction(async () => {
        result = await workFn(session);
      });
      await session.endSession();
      return result;
    } catch (err) {
      const msg = err?.message || '';
      const isStandaloneUnsupported =
        err?.code === 20 ||
        err?.codeName === 'IllegalOperation' ||
        /Transaction numbers are only allowed on a replica set member or mongos/i.test(msg) ||
        /sessions are not supported/i.test(msg);

      if (isStandaloneUnsupported) {
        await session.endSession().catch(() => {});
        if (isProd) {
          throw new Error(
            'MongoDB replica set or Atlas is required for atomic financial and inventory transactions in production.',
          );
        }
        return workFn(null);
      }

      const isTransient =
        err?.errorLabels?.includes('TransientTransactionError') ||
        err?.errorLabels?.includes('UnknownTransactionCommitResult');

      if (isTransient && attempt < MAX_RETRIES) {
        logger.warn({ attempt, err: msg }, 'Retrying transient MongoDB transaction');
        continue;
      }

      await session.endSession().catch(() => {});
      throw err;
    }
  }
}

/**
 * Helper to attach session option only when a session is active
 */
export function sessionOpts(session) {
  return session ? { session } : {};
}

