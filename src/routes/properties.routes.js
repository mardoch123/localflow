import { Router } from 'express';
import { prisma } from '../config.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isStr, isInt, isOneOf } from '../utils/validate.js';
import { notifRow, notifyUser, adminUserIds, tenantIdsOfProperty } from '../utils/notify.js';

const r = Router();
r.use(requireAuth);

const PROPERTY_STATUSES = ['AVAILABLE', 'OCCUPIED', 'VACANT', 'MAINTENANCE'];

// GET /api/properties?status=&q=&mine=true
r.get('/', asyncHandler(async (req, res) => {
  const { status, q, mine } = req.query;
  const where = {};
  if (status && status !== 'ALL') where.status = String(status).toUpperCase();
  if (mine === 'true' || req.query.mine === '1') where.ownerId = req.user.id;
  if (q) {
    where.OR = [
      { name: { contains: String(q), mode: 'insensitive' } },
      { address: { contains: String(q), mode: 'insensitive' } },
      { type: { contains: String(q), mode: 'insensitive' } },
      { city: { contains: String(q), mode: 'insensitive' } },
    ];
  }
  const properties = await prisma.property.findMany({
    where,
    include: { owner: { select: { id: true, name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: properties });
}));

// GET /api/properties/:id
r.get('/:id', asyncHandler(async (req, res) => {
  const property = await prisma.property.findUnique({
    where: { id: req.params.id },
    include: {
      owner: { select: { id: true, name: true, phone: true } },
      contracts: {
        include: { tenant: { select: { id: true, name: true } } },
        orderBy: { startDate: 'desc' },
        take: 1,
      },
    },
  });
  if (!property) return res.status(404).json({ error: 'Propriété introuvable' });
  res.json({ data: property });
}));

// POST /api/properties (LANDLORD/ADMIN)
r.post('/', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const { name, address, city, type, monthlyRent, status, imageUrl, imageLabel, description, area, rooms, ageYears } = req.body || {};
  if (!isStr(name, { min: 3, max: 120 }) || !isStr(address, { min: 3, max: 255 }) || !isStr(type, { min: 2, max: 80 })) {
    return res.status(400).json({ error: 'name, address et type valides sont requis' });
  }
  if (!isInt(monthlyRent, { min: 1, max: 1_000_000_000 })) {
    return res.status(400).json({ error: 'monthlyRent doit être un entier > 0 (FCFA)' });
  }
  if (status != null && !isOneOf(status, PROPERTY_STATUSES)) {
    return res.status(400).json({ error: 'Statut de propriété invalide' });
  }
  const property = await prisma.property.create({
    data: {
      name: String(name).trim(), address: String(address).trim(), city: city || null, type: String(type).trim(),
      monthlyRent: Number(monthlyRent),
      status: isOneOf(status, PROPERTY_STATUSES) ? status : 'AVAILABLE',
      imageUrl: imageUrl || null, imageLabel: imageLabel || null,
      description: description || null, area: area || null,
      rooms: rooms != null ? Number(rooms) : null,
      ageYears: ageYears || null,
      ownerId: req.user.id,
    },
  });
  // Veille plateforme : les admins sont notifiés de chaque nouvelle annonce
  // (sauf si c'est un admin qui crée lui-même le bien).
  if (req.user.role !== 'ADMIN') {
    const admins = await adminUserIds();
    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((userId) => notifRow(userId, 'info',
          'Nouveau bien publié',
          `${req.user.name} a listé « ${property.name} » (${property.address}) — loyer ${property.monthlyRent.toLocaleString('fr-FR')} FCFA/mois.`)),
      });
    }
  }
  res.status(201).json({ data: property });
}));

// PATCH /api/properties/:id (propriétaire ou ADMIN)
r.patch('/:id', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const existing = await prisma.property.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Propriété introuvable' });
  if (req.user.role !== 'ADMIN' && existing.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const allowed = ['name', 'address', 'city', 'type', 'monthlyRent', 'status', 'imageUrl', 'imageLabel', 'description', 'area', 'rooms', 'ageYears', 'visitors'];
  const data = {};
  for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
  if (data.status != null && !isOneOf(data.status, PROPERTY_STATUSES)) {
    return res.status(400).json({ error: 'Statut de propriété invalide' });
  }
  if (data.monthlyRent != null && !isInt(data.monthlyRent, { min: 1, max: 1_000_000_000 })) {
    return res.status(400).json({ error: 'monthlyRent doit être un entier > 0 (FCFA)' });
  }
  const property = await prisma.property.update({ where: { id: req.params.id }, data });
  // 1) Modération par un admin → le propriétaire est informé.
  if (req.user.role === 'ADMIN' && existing.ownerId !== req.user.id) {
    const keys = Object.keys(data).filter((k) => data[k] !== existing[k]);
    if (keys.length > 0) {
      await notifyUser(existing.ownerId, 'info', 'Bien modéré par la plateforme',
        `Un administrateur a modifié « ${existing.name} » : ${keys.join(', ')}.`);
    }
  }
  // 2) Changement de loyer ou de statut par le propriétaire → locataires occupants notifiés.
  const rentChanged = data.monthlyRent != null && Number(data.monthlyRent) !== existing.monthlyRent;
  const statusChanged = data.status != null && data.status !== existing.status;
  if ((rentChanged || statusChanged) && req.user.role !== 'ADMIN') {
    const tenantIds = await tenantIdsOfProperty(existing.id);
    if (tenantIds.length > 0) {
      const msg = rentChanged
        ? `Le loyer de « ${existing.name} » passe à ${Number(data.monthlyRent).toLocaleString('fr-FR')} FCFA/mois.`
        : `Le statut de « ${existing.name} » change : ${existing.status} → ${data.status}.`;
      await prisma.notification.createMany({
        data: tenantIds.map((userId) => notifRow(userId, 'info', 'Votre location mise à jour', msg)),
      });
    }
  }
  res.json({ data: property });
}));

// DELETE /api/properties/:id (propriétaire ou ADMIN)
r.delete('/:id', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const existing = await prisma.property.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Propriété introuvable' });
  if (req.user.role !== 'ADMIN' && existing.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  // Tous les locataires liés + les admins sont informés avant la suppression
  // (cascade Prisma : les contrats et paiements du bien sont résiliés).
  const tenantIds = await tenantIdsOfProperty(existing.id);
  const contractsCount = await prisma.contract.count({ where: { propertyId: existing.id } });
  const notes = tenantIds.map((userId) => notifRow(userId, 'contract', 'Bien supprimé',
    `« ${existing.name} » a été supprimé par ${req.user.name}${contractsCount > 0 ? ` — vos contrats liés ont été résiliés (${existing.status}).` : ''}`));
  if (req.user.role !== 'ADMIN') {
    if (existing.ownerId !== req.user.id) {
      notes.push(notifRow(existing.ownerId, 'info', 'Bien supprimé par la plateforme', `Un administrateur a supprimé « ${existing.name} ».`));
    }
    const admins = await adminUserIds();
    for (const a of admins) {
      if (a !== req.user.id) notes.push(notifRow(a, 'info', 'Bien supprimé', `${req.user.name} a supprimé « ${existing.name} » (${existing.address}).`));
    }
  } else if (existing.ownerId !== req.user.id) {
    notes.push(notifRow(existing.ownerId, 'info', 'Bien supprimé par la plateforme', `Un administrateur a supprimé « ${existing.name} ».`));
  }
  if (notes.length > 0) await prisma.notification.createMany({ data: notes });
  await prisma.property.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

export default r;
