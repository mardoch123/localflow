import { Router } from 'express';
import { prisma } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const r = Router();
r.use(requireAuth);

// GET /api/notifications/unread-count — léger, pour le polling temps réel.
// Renvoie le nombre de non lues + l'identifiant de la plus récente
// (le client compare latestId pour détecter une nouvelle notification).
r.get('/unread-count', asyncHandler(async (req, res) => {
  const [unread, latest] = await Promise.all([
    prisma.notification.count({ where: { userId: req.user.id, read: false } }),
    prisma.notification.findFirst({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
  ]);
  res.json({ data: { unread, latestId: latest?.id ?? null } });
}));

// GET /api/notifications
r.get('/', asyncHandler(async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ data: notifications });
}));

// PATCH /api/notifications/:id/read
r.patch('/:id/read', asyncHandler(async (req, res) => {
  const existing = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== req.user.id) {
    return res.status(404).json({ error: 'Notification introuvable' });
  }
  const notification = await prisma.notification.update({
    where: { id: req.params.id },
    data: { read: true },
  });
  res.json({ data: notification });
}));

// POST /api/notifications/read-all
r.post('/read-all', asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id }, data: { read: true } });
  res.json({ success: true });
}));

export default r;
