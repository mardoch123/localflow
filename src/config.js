import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// Singleton Prisma : sur un runtime serverless (Vercel/Lambda), chaque
// fonction éphémère ne doit pas ouvrir son propre pool de connexions Neon.
// On réutilise l'instance via globalThis entre les invocations à chaud.
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__prisma = prisma;

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'locaflow_dev_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || '*',
};
