import crypto from 'crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { whatsappService } from './whatsapp.service.js';
import { conversationService } from '../conversations/conversation.service.js';
import { MessageLog } from './message-log.model.js';

export function verifyWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return true; // Not configured in local dev/simulation
  if (!signatureHeader || !rawBody) return false;

  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const sigBuf = Buffer.from(String(signatureHeader));
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export const whatsappController = {
  /**
   * Verification request from Meta (GET /webhook/whatsapp)
   */
  verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
      logger.info('Meta WhatsApp webhook verified successfully.');
      return res.status(200).send(challenge);
    }

    logger.warn(
      { receivedToken: token ? `${token.slice(0, 3)}...` : null, mode },
      'WhatsApp webhook verification failed: Invalid verify token or mode',
    );
    return res.status(403).json({
      status: 'error',
      message: 'Verification token mismatch or invalid mode',
    });
  },

  /**
   * Incoming webhook notifications from Meta (POST /webhook/whatsapp)
   */
  async handleWebhook(req, res) {
    // 0. Verify Meta X-Hub-Signature-256 (mandatory in production)
    const secret = process.env.WHATSAPP_APP_SECRET || env.WHATSAPP_APP_SECRET;
    if (process.env.NODE_ENV === 'production' && !secret) {
      logger.error('WHATSAPP_APP_SECRET missing in production; rejecting webhook');
      return res.status(503).json({ status: 'fail', message: 'Webhook signature verification not configured' });
    }
    if (secret) {
      const signature = req.headers['x-hub-signature-256'];
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
      if (!verifyWebhookSignature(rawBody, signature, secret)) {
        logger.warn('Invalid WhatsApp webhook signature rejected');
        return res.status(401).json({ status: 'fail', message: 'Invalid webhook signature' });
      }
    }

    // 1. Immediately acknowledge webhook with 200 OK to prevent Meta retries
    res.status(200).json({ status: 'received' });

    try {
      const { body } = req;
      if (body.object !== 'whatsapp_business_account') {
        return;
      }

      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value;
          if (!value) continue;

          // Delivery status updates
          if (value.statuses && value.statuses.length > 0) {
            for (const statusObj of value.statuses) {
              if (statusObj.status === 'failed') {
                logger.warn(
                  {
                    messageId: statusObj.id,
                    status: statusObj.status,
                    recipient: statusObj.recipient_id,
                    errors: statusObj.errors,
                  },
                  'WhatsApp message delivery failed',
                );
              } else {
                logger.debug(
                  { messageId: statusObj.id, status: statusObj.status, recipient: statusObj.recipient_id },
                  'WhatsApp message delivery status update',
                );
              }
            }
            continue;
          }

          // Incoming messages
          if (value.messages && value.messages.length > 0) {
            const contacts = value.contacts || [];
            const contactMap = new Map(contacts.map((c) => [c.wa_id, c.profile?.name || 'Restaurant Owner']));

            for (const message of value.messages) {
              await whatsappController.processIncomingMessage(message, contactMap);
            }
          }
        }
      }
    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, 'Error processing incoming WhatsApp webhook');
    }
  },

  /**
   * Process individual incoming message with deduplication & idempotency
   */
  async processIncomingMessage(message, contactMap) {
    const senderNumber = message.from;
    const senderName = contactMap.get(senderNumber) || 'Restaurant Owner';
    const messageId = message.id;
    const messageType = message.type;

    // Idempotency check: Avoid duplicate processing on Meta retries
    const existingLog = await MessageLog.findOne({ whatsappMessageId: messageId });
    if (existingLog) {
      logger.info({ messageId }, 'Duplicate WhatsApp message ignored (idempotency)');
      return;
    }

    const logEntry = await MessageLog.create({
      whatsappMessageId: messageId,
      sender: senderNumber,
      messageType,
      processingStatus: 'PROCESSING',
    });

    try {
      // Mark message as read
      whatsappService.markAsRead(messageId).catch(() => {});

      let textContent = '';
      let buttonId = null;
      let media = null;

      if (messageType === 'text') {
        textContent = message.text?.body || '';
      } else if (messageType === 'interactive') {
        const interactive = message.interactive;
        if (interactive?.type === 'button_reply') {
          buttonId = interactive.button_reply?.id;
          textContent = interactive.button_reply?.title || '';
        } else if (interactive?.type === 'list_reply') {
          buttonId = interactive.list_reply?.id;
          textContent = interactive.list_reply?.title || '';
        }
      } else if (messageType === 'button') {
        buttonId = message.button?.payload || message.button?.text;
        textContent = message.button?.text || '';
      } else if (messageType === 'image') {
        textContent = message.image?.caption || '';
        media = {
          type: 'image',
          id: message.image?.id,
          mimeType: message.image?.mime_type,
          sha256: message.image?.sha256,
        };
      } else if (messageType === 'audio' || messageType === 'voice') {
        media = {
          type: 'voice',
          id: (message.audio || message.voice)?.id,
          mimeType: (message.audio || message.voice)?.mime_type,
        };
      }

      await conversationService.handleIncomingMessage(
        senderNumber,
        textContent,
        buttonId,
        senderName,
        media,
      );

      logEntry.processingStatus = 'PROCESSED';
      await logEntry.save();
    } catch (err) {
      logger.error({ err: err.message, messageId }, 'Failed to process WhatsApp incoming message');
      logEntry.processingStatus = 'FAILED';
      logEntry.error = err.message;
      await logEntry.save();
    }
  },
};
