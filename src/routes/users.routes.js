import { Router } from 'express';
import { prisma } from '../config.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notifyUser } from '../utils/notify.js';

const r = Router();
r.use(requireAuth, requireRole('ADMIN'));

// GET /api/users — liste complète (dashboard admin)
r.get('/', asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, phone: true, role: true,
      status: true, createdAt: true,
      _count: { select: { ownedProperties: true, tenantContracts: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: users });
}));

// PATCH /api/users/:id — suspendre / réactiver / changer rôle
r.patch('/:id', asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id && req.body?.status === 'SUSPENDED') {
    return res.status(400).json({ error: 'Impossible de suspendre son propre compte' });
  }
  const data = {};
  if (['ACTIVE', 'SUSPENDED'].includes(req.body.status)) data.status = req.body.status;
  if (['TENANT', 'LANDLORD', 'ADMIN'].includes(req.body.role)) data.role = req.body.role;
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Rien à mettre à jour' });
  const previous = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true, role: true },
  });
  if (!previous) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
    select: { id: true, name: true, email: true, role: true, status: true },
  });
  // L'utilisateur concerné est toujours notifié des décisions sur son compte.
  if (data.status && data.status !== previous.status) {
    await notifyUser(user.id, 'info',
      data.status === 'SUSPENDED' ? 'Compte suspendu ⛔' : 'Compte réactivé ✔',
      data.status === 'SUSPENDED'
        ? 'Un administrateur a suspendu votre compte LocaFlow. Contactez le support pour le rétablir.'
        : 'Votre compte LocaFlow est de nouveau actif. Bienvenue !');
  }
  if (data.role && data.role !== previous.role) {
    await notifyUser(user.id, 'info', 'Rôle modifié',
      `Un administrateur a changé votre rôle : ${previous.role} → ${data.role}.`);
  }
  res.json({ data: user });
}));

export default r;
