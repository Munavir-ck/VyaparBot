import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { getDatabaseStatus } from './config/database.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { apiLimiter } from './middleware/rate-limiter.js';
import whatsappRoutes from './modules/whatsapp/whatsapp.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import businessRoutes from './modules/businesses/business.routes.js';
import transactionRoutes from './modules/transactions/transaction.routes.js';
import supplierRoutes from './modules/suppliers/supplier.routes.js';
import customerRoutes from './modules/customers/customer.routes.js';
import reportRoutes from './modules/reports/report.routes.js';
import inventoryRoutes from './modules/inventory/inventory.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';

const app = express();

// Configure reverse proxy trust for accurate client IP detection without spoofing
app.set('trust proxy', env.TRUST_PROXY);

// Security and utility middleware
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',') : true,
    credentials: true,
  }),
);
app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTP request logging
app.use(requestLogger);

// Root route
app.get('/', (req, res) => {
  res.status(200).json({
    service: 'Restaurant Money Management Assistant',
    version: '1.0.0',
    description: 'WhatsApp-first Financial Assistant for Kerala Restaurants',
    status: 'online',
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  const dbStatus = getDatabaseStatus();
  const isHealthy = dbStatus.isConnected;

  const healthData = {
    status: isHealthy ? 'healthy' : 'degraded',
    service: 'restaurant-money-management-backend',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: env.NODE_ENV,
    database: dbStatus,
    memoryUsage: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    },
  };

  res.status(isHealthy ? 200 : 503).json(healthData);
});

// WhatsApp Cloud API Webhook
app.use('/webhook/whatsapp', whatsappRoutes);

// Global API rate limiting
app.use('/api', apiLimiter);

// Auth & Business Onboarding/Settings APIs
app.use('/api/auth', authRoutes);
app.use('/api/business', businessRoutes);

// Business Financial & Inventory Management REST APIs
app.use('/api/transactions', transactionRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/admin', adminRoutes);

// Catch 404 routes
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

export default app;
