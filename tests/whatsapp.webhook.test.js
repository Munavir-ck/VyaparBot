import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { MessageLog } from '../src/modules/whatsapp/message-log.model.js';

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

    const res = await request(app).post('/webhook/whatsapp').send(payload);
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
    await request(app).post('/webhook/whatsapp').send(payload);
    await new Promise((r) => setTimeout(r, 100));

    // Retry request with same wamid
    const retryRes = await request(app).post('/webhook/whatsapp').send(payload);
    expect(retryRes.status).toBe(200);

    // Verify only 1 log entry exists
    const logs = await MessageLog.find({ whatsappMessageId: 'wamid.duplicate_retry_001' });
    expect(logs.length).toBe(1);
  });
});
