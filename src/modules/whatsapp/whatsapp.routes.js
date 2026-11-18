import { Router } from 'express';
import { whatsappController } from './whatsapp.controller.js';
import { webhookLimiter } from '../../middleware/rate-limiter.js';

const router = Router();

// Webhook verification endpoint (GET)
router.get('/', whatsappController.verifyWebhook);

// Webhook event receiver endpoint (POST)
router.post('/', webhookLimiter, whatsappController.handleWebhook);

export default router;
