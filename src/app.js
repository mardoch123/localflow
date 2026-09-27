import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { config, prisma } from './config.js';

import authRoutes from './routes/auth.routes.js';
import propertiesRoutes from './routes/properties.routes.js';
import contractsRoutes from './routes/contracts.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import providersRoutes from './routes/providers.routes.js';
import usersRoutes from './routes/users.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import inventoryRoutes from './routes/inventory.routes.js';

const app = express();

// ── Sécurité ───────────────────────────────────────────────
// En-têtes HTTP sûrs (X-Content-Type-Options, HSTS, masquage du fingerprint…)
app.use(helmet());

// CORS : liste d'origines configurable (jamais * en production)
app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
  }),
);

// Corps de requête limité à 100 ko (antiabus)
app.use(express.json({ limit: '100kb' }));

// Rate limit global : 300 requêtes / minute / IP
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
);

// Rate limit renforcé sur l'authentification : 20 tentatives / 15 min / IP
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Trop de tentatives, réessayez dans 15 minutes' },
  }),
);

// Healthcheck (sans auth) — vérifie la connexion API + DB
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'degraded', database: 'disconnected', error: e.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/payment-providers', providersRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/inventories', inventoryRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: `Route introuvable: ${req.method} ${req.path}` }));

// Gestionnaire d'erreurs centralisé (ne fuit jamais la stack trace en prod)
app.use((err, _req, res, _next) => {
  console.error('💥', err.message);
  const status = err.status || 500;
  res.status(status).json({
    error: status >= 500 && process.env.NODE_ENV === 'production'
      ? 'Erreur interne du serveur'
      : err.message || 'Erreur interne du serveur',
  });
});

export default app;
