import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isEmail, isStr, isOneOf, PASSWORD_MIN, PASSWORD_MAX } from '../utils/validate.js';
import { notifRow, adminUserIds } from '../utils/notify.js';

const r = Router();
const ROLES = ['TENANT', 'LANDLORD', 'ADMIN'];

const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, phone: u.phone,
  role: u.role, status: u.status, createdAt: u.createdAt,
});

// POST /api/auth/register
r.post('/register', asyncHandler(async (req, res) => {
  const { email, password, name, phone, role } = req.body || {};
  if (!isEmail(email) || !isStr(name, { min: 2, max: 120 })) {
    return res.status(400).json({ error: 'email et name valides sont requis' });
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return res.status(400).json({ error: `Le mot de passe doit faire entre ${PASSWORD_MIN} et ${PASSWORD_MAX} caractères` });
  }
  if (phone != null && phone !== '' && !isStr(phone, { min: 6, max: 20 })) {
    return res.status(400).json({ error: 'Numéro de téléphone invalide' });
  }
  const exists = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (exists) return res.status(409).json({ error: 'Email déjà utilisé' });

  const user = await prisma.user.create({
    data: {
      email: String(email).toLowerCase(),
      password: await bcrypt.hash(password, 10),
      name: String(name).trim(),
      phone: phone || null,
      role: isOneOf(role, ROLES) ? role : 'TENANT',
    },
  });
  // Les admins sont notifiés de chaque nouvelle inscription (veille plateforme).
  const admins = await adminUserIds();
  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map((userId) => notifRow(userId, 'info', 'Nouvelle inscription',
        `${user.name} (${user.role}) vient de créer un compte — ${user.email}.`)),
    });
  }
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

// POST /api/auth/login  { email, password, role? }
r.post('/login', asyncHandler(async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!isEmail(email) || !isStr(password, { min: 1, max: PASSWORD_MAX })) {
    return res.status(400).json({ error: 'email et password valides sont requis' });
  }
  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  if (user.status !== 'ACTIVE') return res.status(403).json({ error: 'Compte suspendu' });
  if (role != null && role !== '' && !isOneOf(role, ROLES)) {
    return res.status(400).json({ error: 'Rôle demandé invalide' });
  }
  if (role && role !== user.role) {
    return res.status(400).json({ error: `Ce compte n'est pas un compte ${role}` });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

// GET /api/auth/me
r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default r;
