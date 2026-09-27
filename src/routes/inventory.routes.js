import { Router } from 'express';
import { prisma } from '../config.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isStr, isOneOf, isInt, isDate } from '../utils/validate.js';
import { notifyUser } from '../utils/notify.js';

const r = Router();
r.use(requireAuth);

// Conditions acceptées pour un item de pièce.
export const INVENTORY_CONDITIONS = ['Neuf', 'Bon', 'Usage', 'Endommagé'];
const INVENTORY_TYPES = ['ENTRY', 'EXIT'];

/** Référence unique EDL-{E|S}-{AAAA}-{NNN}. */
async function nextReference(type) {
  const year = new Date().getFullYear();
  const code = type === 'ENTRY' ? 'E' : 'S';
  let n = (await prisma.inventory.count()) + 1;
  let ref;
  do {
    ref = `EDL-${code}-${year}-${String(n++).padStart(3, '0')}`;
  } while (await prisma.inventory.findUnique({ where: { reference: ref } }));
  return ref;
}

/** Retourne le contrat accessible pour l'utilisateur, ou null. */
async function accessibleContract(contractId, user) {
  const c = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { property: { select: { name: true } } },
  });
  if (!c) return null;
  if (user.role === 'ADMIN') return c;
  if (user.role === 'TENANT' && c.tenantId === user.id) return c;
  if (user.role === 'LANDLORD' && c.landlordId === user.id) return c;
  return null;
}

/** Vérifie l'accès en lecture à un état des lieux. */
function canView(inv, user) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'TENANT') return inv.contract.tenantId === user.id;
  return inv.contract.landlordId === user.id;
}

/** Valide et normalise la liste d'items envoyée. */
function normalizeItems(raw) {
  const items = Array.isArray(raw) ? raw : [];
  const cleaned = [];
  for (const it of items) {
    if (!isStr(it?.room, { min: 1, max: 120 })) continue;
    cleaned.push({
      room: String(it.room).trim().slice(0, 120),
      element: isStr(it?.element, { max: 120 }) ? String(it.element).trim().slice(0, 120) : null,
      condition: isOneOf(it?.condition, INVENTORY_CONDITIONS) ? it.condition : 'Bon',
      observation: isStr(it?.observation, { max: 500 }) ? String(it.observation).trim().slice(0, 500) : null,
    });
  }
  return cleaned;
}

// GET /api/inventories?contractId=  — liste scopée par rôle.
r.get('/', asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.contractId) where.contractId = String(req.query.contractId);
  if (req.user.role === 'TENANT') where.contract = { tenantId: req.user.id };
  else if (req.user.role === 'LANDLORD') where.contract = { landlordId: req.user.id };

  const inventories = await prisma.inventory.findMany({
    where,
    include: {
      items: true,
      contract: {
        select: {
          id: true, reference: true, tenantId: true, landlordId: true,
          property: { select: { name: true, address: true } },
          tenant: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: inventories });
}));

// GET /api/inventories/:id — détail + items + contrat.
r.get('/:id', asyncHandler(async (req, res) => {
  const inv = await prisma.inventory.findUnique({
    where: { id: req.params.id },
    include: {
      items: true,
      contract: {
        include: {
          property: { select: { name: true, address: true } },
          tenant: { select: { id: true, name: true } },
          landlord: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!inv || !canView(inv, req.user)) {
    return res.status(404).json({ error: 'État des lieux introuvable' });
  }
  res.json({ data: inv });
}));

// POST /api/inventories (LANDLORD/ADMIN) — crée un EDL ENTRÉE ou SORTIE.
r.post('/', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const { contractId, type, date, notes, waterMeter, electricMeter, keysCount, items } = req.body || {};
  if (!type || !isOneOf(type, INVENTORY_TYPES)) {
    return res.status(400).json({ error: 'type requis : ENTRY ou EXIT' });
  }
  if (date != null && !isDate(date)) return res.status(400).json({ error: 'date invalide' });
  if (keysCount != null && !isInt(keysCount, { min: 0, max: 1000 })) {
    return res.status(400).json({ error: 'keysCount invalide' });
  }
  const contract = await accessibleContract(contractId, req.user);
  if (!contract) return res.status(404).json({ error: 'Contrat introuvable ou inaccessible' });

  // Un seul état des lieux de chaque type par contrat.
  const dup = await prisma.inventory.findFirst({ where: { contractId: contract.id, type } });
  if (dup) {
    return res.status(409).json({
      error: type === 'ENTRY'
        ? 'Un état des lieux d\'entrée existe déjà pour ce contrat'
        : 'Un état des lieux de sortie existe déjà pour ce contrat',
    });
  }

  const cleanedItems = normalizeItems(items);
  const inventory = await prisma.inventory.create({
    data: {
      reference: await nextReference(type),
      type,
      date: date ? new Date(date) : new Date(),
      notes: isStr(notes, { max: 2000 }) ? String(notes).trim().slice(0, 2000) : null,
      waterMeter: isStr(waterMeter, { max: 60 }) ? String(waterMeter).trim() : null,
      electricMeter: isStr(electricMeter, { max: 60 }) ? String(electricMeter).trim() : null,
      keysCount: Number(keysCount || 0),
      signedByLandlord: true, // le bailleur qui crée le document le signe d'emblée
      contractId: contract.id,
      items: { create: cleanedItems },
    },
    include: { items: true },
  });

  await notifyUser(contract.tenantId, 'contract',
    type === 'ENTRY' ? 'État des lieux d\'entrée à consulter ✍' : 'État des lieux de sortie à consulter ✍',
    `${req.user.name} a établi l'état des lieux ${type === 'ENTRY' ? 'd\'entrée' : 'de sortie'} ${inventory.reference} pour « ${contract.property?.name ?? 'le bien'} ». Consultez-le puis signez-le.`);

  res.status(201).json({ data: inventory });
}));

// PATCH /api/inventories/:id (LANDLORD/ADMIN) — modifie un brouillon (remplace les items).
r.patch('/:id', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const inv = await prisma.inventory.findUnique({ where: { id: req.params.id }, include: { contract: true } });
  if (!inv) return res.status(404).json({ error: 'État des lieux introuvable' });
  if (req.user.role !== 'ADMIN' && inv.contract.landlordId !== req.user.id) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  if (inv.status === 'SIGNED') {
    return res.status(409).json({ error: 'État des lieux déjà contresigné — non modifiable' });
  }

  const data = {};
  if (req.body.notes !== undefined) data.notes = isStr(req.body.notes, { max: 2000 }) ? String(req.body.notes).trim().slice(0, 2000) : null;
  if (req.body.waterMeter !== undefined) data.waterMeter = isStr(req.body.waterMeter, { max: 60 }) ? String(req.body.waterMeter).trim() : null;
  if (req.body.electricMeter !== undefined) data.electricMeter = isStr(req.body.electricMeter, { max: 60 }) ? String(req.body.electricMeter).trim() : null;
  if (req.body.keysCount !== undefined) {
    if (!isInt(req.body.keysCount, { min: 0, max: 1000 })) return res.status(400).json({ error: 'keysCount invalide' });
    data.keysCount = Number(req.body.keysCount);
  }
  if (req.body.date !== undefined) {
    if (!isDate(req.body.date)) return res.status(400).json({ error: 'date invalide' });
    data.date = new Date(req.body.date);
  }

  const replaceItems = Array.isArray(req.body.items);
  const ops = [prisma.inventory.update({ where: { id: inv.id }, data })];
  if (replaceItems) {
    ops.push(prisma.inventoryItem.deleteMany({ where: { inventoryId: inv.id } }));
    const cleaned = normalizeItems(req.body.items);
    if (cleaned.length) {
      ops.push(prisma.inventoryItem.createMany({ data: cleaned.map((it) => ({ ...it, inventoryId: inv.id })) }));
    }
  }
  await prisma.$transaction(ops);

  const updated = await prisma.inventory.findUnique({
    where: { id: inv.id }, include: { items: true },
  });
  res.json({ data: updated });
}));

// POST /api/inventories/:id/sign — signature par la partie concernée.
// Le locataire peut joindre ses réserves (tenantNotes). Quand les deux ont
// signé → statut SIGNED + notification.
r.post('/:id/sign', asyncHandler(async (req, res) => {
  const inv = await prisma.inventory.findUnique({ where: { id: req.params.id }, include: { contract: true } });
  if (!inv) return res.status(404).json({ error: 'État des lieux introuvable' });

  const isTenant = req.user.role === 'TENANT' && inv.contract.tenantId === req.user.id;
  const isLandlord = (req.user.role === 'LANDLORD' && inv.contract.landlordId === req.user.id) || req.user.role === 'ADMIN';
  if (!isTenant && !isLandlord) return res.status(403).json({ error: 'Accès refusé' });
  if (inv.status === 'SIGNED') return res.status(409).json({ error: 'Déjà contresigné' });

  const data = {};
  if (isTenant) {
    if (inv.signedByTenant) return res.status(409).json({ error: 'Vous avez déjà signé' });
    const reserves = req.body?.tenantNotes;
    if (reserves != null && !isStr(reserves, { max: 2000 })) return res.status(400).json({ error: 'tenantNotes trop long' });
    data.signedByTenant = true;
    if (reserves != null) data.tenantNotes = isStr(reserves, { max: 2000 }) ? String(reserves).trim().slice(0, 2000) : null;
  } else {
    data.signedByLandlord = true;
  }

  const bothSigned = (isTenant ? true : inv.signedByTenant) && (isLandlord ? true : inv.signedByLandlord);
  if (bothSigned) data.status = 'SIGNED';

  const updated = await prisma.inventory.update({ where: { id: inv.id }, data, include: { items: true } });

  if (bothSigned) {
    const who = isTenant ? 'Le locataire' : 'Le propriétaire';
    await notifyUser(isTenant ? inv.contract.landlordId : inv.contract.tenantId, 'contract',
      'État des lieux contresigné ✔',
      `${who} a signé l'état des lieux ${inv.reference}. Le document est définitivement validé.`);
  }
  res.json({ data: updated });
}));

// DELETE /api/inventories/:id (LANDLORD/ADMIN) — retire un brouillon.
r.delete('/:id', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const inv = await prisma.inventory.findUnique({ where: { id: req.params.id }, include: { contract: true } });
  if (!inv) return res.status(404).json({ error: 'État des lieux introuvable' });
  if (req.user.role !== 'ADMIN' && inv.contract.landlordId !== req.user.id) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  if (inv.status === 'SIGNED') return res.status(409).json({ error: 'Impossible de supprimer un état des lieux signé' });
  await prisma.inventory.delete({ where: { id: inv.id } }); // items supprimés en cascade
  res.json({ success: true });
}));

export default r;
