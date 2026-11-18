import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Base API & Health Endpoints', () => {
  it('GET / should return 200 and restaurant service metadata', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('service', 'Restaurant Money Management Assistant');
    expect(res.body).toHaveProperty('version', '1.0.0');
    expect(res.body).toHaveProperty('status', 'online');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('GET /health should return system status and database state', async () => {
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('database');
    expect(res.body.database).toHaveProperty('state');
    expect(res.body).toHaveProperty('memoryUsage');
  });

  it('GET /non-existent-route should return 404 with AppError format', async () => {
    const res = await request(app).get('/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('status', 'fail');
    expect(res.body.message).toContain('Cannot GET /non-existent-route');
  });
});
