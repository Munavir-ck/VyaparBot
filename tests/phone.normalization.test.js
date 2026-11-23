import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { normalizeWhatsappNumber } from '../src/utils/phone.js';
import { OtpChallenge } from '../src/modules/auth/otp.model.js';
import { User } from '../src/modules/users/user.model.js';
import { whatsappService } from '../src/modules/whatsapp/whatsapp.service.js';
import { businessService } from '../src/modules/businesses/business.service.js';

describe('WhatsApp Phone Number Normalization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prepends 91 for 10-digit Indian mobile numbers', () => {
    expect(normalizeWhatsappNumber('7510344647')).toBe('917510344647');
    expect(normalizeWhatsappNumber('9876543210')).toBe('919876543210');
  });

  it('normalizes +91, spaces, hyphens, and brackets', () => {
    expect(normalizeWhatsappNumber('+91 7510344647')).toBe('917510344647');
    expect(normalizeWhatsappNumber('91-7510344647')).toBe('917510344647');
    expect(normalizeWhatsappNumber('(+91) 7510-344-647')).toBe('917510344647');
  });

  it('strips leading 0 and prepends 91 for 11-digit Indian numbers', () => {
    expect(normalizeWhatsappNumber('07510344647')).toBe('917510344647');
  });

  it('preserves valid international numbers that already include a country code', () => {
    expect(normalizeWhatsappNumber('917510344647')).toBe('917510344647');
    expect(normalizeWhatsappNumber('14155552671')).toBe('14155552671');
    expect(normalizeWhatsappNumber('+44 7911 123456')).toBe('447911123456');
    expect(normalizeWhatsappNumber('971501234567')).toBe('971501234567');
  });

  it('rejects null, undefined, empty, ambiguous, and invalid numbers', () => {
    expect(() => normalizeWhatsappNumber(null)).toThrow(/Valid WhatsApp phone number/i);
    expect(() => normalizeWhatsappNumber(undefined)).toThrow(/Valid WhatsApp phone number/i);
    expect(() => normalizeWhatsappNumber('')).toThrow(/Valid WhatsApp phone number/i);
    expect(() => normalizeWhatsappNumber('   ')).toThrow(/Valid WhatsApp phone number/i);
    expect(() => normalizeWhatsappNumber('12345')).toThrow(/Valid WhatsApp phone number/i);
    expect(() => normalizeWhatsappNumber('1234567890')).toThrow(/Valid WhatsApp phone number/i);
    expect(() => normalizeWhatsappNumber('01234567890')).toThrow(/Valid WhatsApp phone number/i);
    expect(() => normalizeWhatsappNumber('911234567890123456')).toThrow(/Valid WhatsApp phone number/i);
  });

  it('uses normalized 91-prefixed number for OTP request, verification, and matches existing webhook user', async () => {
    // Simulate an existing user created from a WhatsApp webhook in international format
    const webhookRes = await businessService.resolveBusinessForUser('917510344647', 'Webhook Owner');
    expect(webhookRes.user.whatsappNumber).toBe('917510344647');

    const sendSpy = vi.spyOn(whatsappService, 'sendTextMessage').mockResolvedValue({
      messaging_product: 'whatsapp',
      messages: [{ id: 'wamid.mock_otp' }],
    });

    // Request OTP using 10-digit local format
    const otpReq = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone: '7510344647' });

    expect(otpReq.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledWith('917510344647', expect.any(String));

    const challenge = await OtpChallenge.findOne({ whatsappNumber: '917510344647' });
    expect(challenge).toBeTruthy();

    // Verify OTP using +91 formatted input
    const verifyRes = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone: '+91 7510344647', otp: otpReq.body.data.testOtp });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.user.whatsappNumber).toBe('917510344647');
    expect(verifyRes.body.data.user._id).toBe(String(webhookRes.user._id));

    // Ensure no duplicate user record was created
    const users = await User.find({ whatsappNumber: { $in: ['7510344647', '917510344647'] } });
    expect(users.length).toBe(1);
  });

  it('rejects invalid phone numbers on /api/auth/request-otp', async () => {
    const res = await request(app)
      .post('/api/auth/request-otp')
      .send({ phone: '12345' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PHONE_NUMBER');
  });
});
