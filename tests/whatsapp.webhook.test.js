import crypto from 'crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { whatsappService } from '../src/modules/whatsapp/whatsapp.service.js';
import { MessageLog } from '../src/modules/whatsapp/message-log.model.js';

function buildWebhookHeaders(payload) {
  const secret = process.env.WHATSAPP_APP_SECRET || env.WHATSAPP_APP_SECRET;
  if (!secret) return {};
  const sig = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return { 'x-hub-signature-256': `sha256=${sig}` };
}

describe('WhatsApp Cloud API Webhook Integration', () => {
  it('GET /webhook/whatsapp verifies webhook with challenge and valid token', async () => {
    const res = await request(app)
      .get('/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': env.WHATSAPP_VERIFY_TOKEN,
        'hub.challenge': 'CHALLENGE_ACCEPTED_123',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('CHALLENGE_ACCEPTED_123');
  });

  it('GET /webhook/whatsapp returns 403 on invalid verify token', async () => {
    const res = await request(app)
      .get('/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': '12345',
      });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('status', 'error');
  });

  it('POST /webhook/whatsapp acknowledges incoming payload immediately with 200', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WHATSAPP_BIZ_ID',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '1234567890', phone_number_id: 'PN_ID' },
                contacts: [{ wa_id: '919876543210', profile: { name: 'Chef Ali' } }],
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.test_msg_001',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Innu total sales 10000' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const res = await request(app)
      .post('/webhook/whatsapp')
      .set(buildWebhookHeaders(payload))
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'received' });

    // Wait for asynchronous processing to complete
    let log;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 100));
      log = await MessageLog.findOne({ whatsappMessageId: 'wamid.test_msg_001' });
      if (log && log.processingStatus === 'PROCESSED') break;
    }

    expect(log).toBeTruthy();
    expect(log.sender).toBe('919876543210');
    expect(log.processingStatus).toBe('PROCESSED');
  });

  it('POST /webhook/whatsapp ignores duplicate message retries (idempotency)', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WHATSAPP_BIZ_ID',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                contacts: [{ wa_id: '919876543210', profile: { name: 'Chef Ali' } }],
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.duplicate_retry_001',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Innu 500 rupa pachakkari' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    // First request
    await request(app)
      .post('/webhook/whatsapp')
      .set(buildWebhookHeaders(payload))
      .send(payload);
    await new Promise((r) => setTimeout(r, 100));

    // Retry request with same wamid
    const retryRes = await request(app)
      .post('/webhook/whatsapp')
      .set(buildWebhookHeaders(payload))
      .send(payload);
    expect(retryRes.status).toBe(200);

    // Verify only 1 log entry exists
    const logs = await MessageLog.find({ whatsappMessageId: 'wamid.duplicate_retry_001' });
    expect(logs.length).toBe(1);
  });
});

describe('WhatsApp Cloud API Outbound Error Logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs complete Meta error metadata for sendTextMessage without exposing tokens or message body', async () => {
    vi.spyOn(whatsappService, 'isMockMode').mockReturnValue(false);
    vi.spyOn(whatsappService, 'accessToken', 'get').mockReturnValue('super_secret_wa_token_123');
    vi.spyOn(whatsappService, 'phoneNumberId', 'get').mockReturnValue('1493095410548341');

    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: '(#100) Invalid parameter',
          type: 'OAuthException',
          code: 100,
          error_subcode: 2494010,
          error_user_title: 'Invalid recipient',
          error_user_msg: 'Recipient phone number is not valid',
          error_data: {
            messaging_product: 'whatsapp',
            details: 'Parameter to is invalid',
          },
          fbtrace_id: 'A5ZMSNQKjxIbuoRy',
        },
      }),
    });

    await expect(
      whatsappService.sendTextMessage('917510344647', 'SENSITIVE_SECRET_BODY_TEXT'),
    ).rejects.toThrow('(#100) Invalid parameter');

    expect(errorSpy).toHaveBeenCalled();
    const firstLogPayload = errorSpy.mock.calls[0][0];
    expect(firstLogPayload).toMatchObject({
      operation: 'sendTextMessage',
      apiVersion: env.WHATSAPP_API_VERSION,
      status: 400,
      code: 100,
      errorSubcode: 2494010,
      errorUserTitle: 'Invalid recipient',
      errorUserMsg: 'Recipient phone number is not valid',
      errorDataDetails: 'Parameter to is invalid',
      fbtraceId: 'A5ZMSNQKjxIbuoRy',
    });

    const serializedLogs = JSON.stringify(errorSpy.mock.calls);
    expect(serializedLogs).not.toContain('super_secret_wa_token_123');
    expect(serializedLogs).not.toContain('SENSITIVE_SECRET_BODY_TEXT');
  });

  it('identifies markAsRead operation on Meta 400 error', async () => {
    vi.spyOn(whatsappService, 'isMockMode').mockReturnValue(false);
    vi.spyOn(whatsappService, 'accessToken', 'get').mockReturnValue('super_secret_wa_token_123');
    vi.spyOn(whatsappService, 'phoneNumberId', 'get').mockReturnValue('1493095410548341');

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: '(#100) Invalid parameter',
          code: 100,
          error_subcode: 131009,
          error_data: { details: 'Invalid message_id' },
          fbtrace_id: 'TRACE_MARK_READ_1',
        },
      }),
    });

    await expect(whatsappService.markAsRead('wamid.invalid_123')).rejects.toThrow('(#100) Invalid parameter');

    expect(warnSpy).toHaveBeenCalled();
    const firstLogPayload = warnSpy.mock.calls[0][0];
    expect(firstLogPayload).toMatchObject({
      operation: 'markAsRead',
      apiVersion: env.WHATSAPP_API_VERSION,
      status: 400,
      code: 100,
      errorSubcode: 131009,
      errorDataDetails: 'Invalid message_id',
      fbtraceId: 'TRACE_MARK_READ_1',
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('super_secret_wa_token_123');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('super_secret_wa_token_123');
  });
});
