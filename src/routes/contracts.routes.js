import { Router } from 'express';
import { prisma } from '../config.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isEmail, isInt, isDate } from '../utils/validate.js';
import { notifRow, notifyUser } from '../utils/notify.js';

const r = Router();
r.use(requireAuth);

/** Statut dérivé : priorise TERMINATED/EXPIRED stockés, sinon calculé sur endDate */
function derivedStatus(contract) {
  if (contract.status === 'TERMINATED') return 'TERMINATED';
  const now = Date.now();
  const end = new Date(contract.endDate).getTime();
  if (end < now) return 'EXPIRED';
  if (end - now < 60 * 24 * 3600 * 1000) return 'EXPIRING';
  return 'ACTIVE';
}

function serialize(contract, payments) {
  return {
    ...contract,
    status: derivedStatus(contract),
    requiresSignature: contract.signedAt == null && contract.status !== 'TERMINATED',
    paymentHistory: (payments || [])
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((p) => (p.status === 'PAID' ? 100 : 0)),
  };
}

/** Référence de contrat unique (C-AAAA-NNN), même si des lignes ont été supprimées */
async function nextReference() {
  const year = new Date().getFullYear();
  let n = (await prisma.contract.count()) + 1;
  let ref;
  do {
    ref = `C-${year}-${String(n++).padStart(3, '0')}`;
  } while (await prisma.contract.findUnique({ where: { reference: ref } }));
  return ref;
}

/** Référence unique d'état des lieux EDL-{E|S}-AAAA-NNN. */
async function nextInventoryRef(type) {
  const year = new Date().getFullYear();
  const code = type === 'ENTRY' ? 'E' : 'S';
  let n = (await prisma.inventory.count()) + 1;
  let ref;
  do {
    ref = `EDL-${code}-${year}-${String(n++).padStart(3, '0')}`;
  } while (await prisma.inventory.findUnique({ where: { reference: ref } }));
  return ref;
}

/** Crée (une seule fois) un état des lieux brouillon pré-rempli par pièces.
 *  À l'ENTRÉE (emménagement) comme à la SORTIE (départ). */
async function ensureInventory(contractId, type) {
  const exists = await prisma.inventory.findFirst({ where: { contractId, type } });
  if (exists) return exists;
  const c = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { property: { select: { rooms: true } } },
  });
  const count = Math.max(1, Number(c?.property?.rooms || 1));
  const items = [];
  for (let i = 1; i <= count; i += 1) items.push({ room: `Chambre ${i}`, condition: 'Bon' });
  for (const common of ['Salon', 'Cuisine', 'Salle de bain', 'WC']) {
    items.push({ room: common, condition: 'Bon' });
  }
  return prisma.inventory.create({
    data: { reference: await nextInventoryRef(type), type, contractId, items: { create: items } },
  });
}

/** Persiste les statuts dérivés (ACTIVE → EXPIRING → EXPIRED) et notifie
 * locataire + propriétaire UNE seule fois par transition réelle. */
async function sweepContractStatuses() {
  const candidates = await prisma.contract.findMany({
    where: { status: { in: ['ACTIVE', 'EXPIRING'] } },
    select: { id: true, reference: true, status: true, endDate: true, tenantId: true, landlordId: true },
  });
  const ops = [];
  const notes = [];
  for (const c of candidates) {
    const d = derivedStatus(c);
    if (d === c.status) continue;
    ops.push(prisma.contract.update({ where: { id: c.id }, data: { status: d } }));
    const end = new Date(c.endDate).toLocaleDateString('fr-FR');
    if (d === 'EXPIRING') {
      notes.push(
        notifRow(c.tenantId, 'contract', 'Contrat bientôt expiré ⏳',
          `Le contrat ${c.reference} expire le ${end}. Prévoyez un renouvellement ou un transfert.`),
        notifRow(c.landlordId, 'contract', 'Contrat bientôt expiré ⏳',
          `Le contrat ${c.reference} expire le ${end}. Un renouvellement avec votre locataire est à prévoir.`),
      );
    } else if (d === 'EXPIRED') {
      notes.push(
        notifRow(c.tenantId, 'contract', 'Contrat expiré',
          `Le contrat ${c.reference} est expiré depuis le ${end}. Régularisez la situation avec votre propriétaire.`),
        notifRow(c.landlordId, 'contract', 'Contrat expiré',
          `Le contrat ${c.reference} est expiré depuis le ${end}.`),
      );
    }
  }
  if (ops.length > 0) {
    await prisma.$transaction(
      notes.length ? [...ops, prisma.notification.createMany({ data: notes })] : ops,
    );
  }
}

// GET /api/contracts?status=  (scopé par rôle)
r.get('/', asyncHandler(async (req, res) => {
  // Suivi des statuts dérivés : ACTIVE → EXPIRING → EXPIRED (notifié une fois)
  await sweepContractStatuses();
  const where = {};
  if (req.user.role === 'TENANT') where.tenantId = req.user.id;
  else if (req.user.role === 'LANDLORD') where.landlordId = req.user.id;
  if (req.query.status && req.query.status !== 'ALL') where.status = String(req.query.status).toUpperCase();

  const contracts = await prisma.contract.findMany({
    where,
    include: {
      tenant: { select: { id: true, name: true } },
      landlord: { select: { id: true, name: true, phone: true } },
      property: { select: { id: true, name: true, address: true, type: true, imageUrl: true } },
      payments: { select: { period: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: contracts.map((c) => serialize(c, c.payments)) });
}));

// GET /api/contracts/:id
r.get('/:id', asyncHandler(async (req, res) => {
  const contract = await prisma.contract.findUnique({
    where: { id: req.params.id },
    include: {
      tenant: { select: { id: true, name: true, email: true, phone: true } },
      landlord: { select: { id: true, name: true, email: true, phone: true } },
      property: true,
      payments: { orderBy: { period: 'asc' } },
    },
  });
  if (!contract) return res.status(404).json({ error: 'Contrat introuvable' });
  if (req.user.role === 'TENANT' && contract.tenantId !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });
  if (req.user.role === 'LANDLORD' && contract.landlordId !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });
  res.json({ data: serialize(contract, contract.payments) });
}));

// POST /api/contracts (LANDLORD/ADMIN)
r.post('/', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const { tenantEmail, propertyId, monthlyRent, depositAmount, depositPaid, startDate, endDate } = req.body || {};
  if (!isEmail(tenantEmail) || !propertyId || !isInt(monthlyRent, { min: 1, max: 1_000_000_000 })) {
    return res.status(400).json({ error: 'tenantEmail valide et monthlyRent (entier > 0) requis' });
  }
  if (!isDate(startDate) || !isDate(endDate) || new Date(endDate) <= new Date(startDate)) {
    return res.status(400).json({ error: 'Dates de contrat invalides (endDate doit suivre startDate)' });
  }
  if (depositAmount != null && !isInt(depositAmount, { min: 0, max: 1_000_000_000 })) {
    return res.status(400).json({ error: 'depositAmount invalide' });
  }
  const tenant = await prisma.user.findUnique({ where: { email: String(tenantEmail).toLowerCase() } });
  if (!tenant) return res.status(404).json({ error: 'Locataire introuvable' });
  if (tenant.role !== 'TENANT') return res.status(400).json({ error: 'Cet utilisateur n\'est pas locataire' });
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return res.status(404).json({ error: 'Propriété introuvable' });
  // Un propriétaire ne peut louer que SES propres biens
  if (req.user.role === 'LANDLORD' && property.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Cette propriété ne vous appartient pas' });
  }
  if (property.status === 'OCCUPIED') {
    return res.status(409).json({ error: 'Cette propriété est déjà occupée' });
  }

  const contract = await prisma.contract.create({
    data: {
      reference: await nextReference(),
      monthlyRent: Number(monthlyRent),
      depositAmount: Number(depositAmount || 0),
      depositPaid: Boolean(depositPaid),
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      tenantId: tenant.id,
      landlordId: property.ownerId,
      propertyId: property.id,
    },
  });
  // Le bien passe automatiquement en OCCUPIED à la signature
  await prisma.property.update({ where: { id: property.id }, data: { status: 'OCCUPIED' } });
  await notifyUser(tenant.id, 'contract', 'Nouveau contrat à signer ✍',
    `${req.user.name} vous propose le contrat ${contract.reference} pour « ${property.name} » (loyer ${Number(monthlyRent).toLocaleString('fr-FR')} FCFA/mois). Signez-le pour finaliser votre emménagement.`);
  res.status(201).json({ data: contract });
}));

// PATCH /api/contracts/:id (statut, loyer, dépôt…)
r.patch('/:id', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const existing = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Contrat introuvable' });
  if (req.user.role !== 'ADMIN' && existing.landlordId !== req.user.id) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const data = {};
  for (const k of ['monthlyRent', 'depositAmount', 'depositPaid', 'startDate', 'endDate']) {
    if (req.body[k] !== undefined) data[k] = ['startDate', 'endDate'].includes(k) ? new Date(req.body[k]) : req.body[k];
  }
  if (['ACTIVE', 'EXPIRING', 'EXPIRED', 'TERMINATED'].includes(req.body.status)) data.status = req.body.status;
  const contract = await prisma.contract.update({ where: { id: req.params.id }, data });
  // Le locataire est informé de chaque modification de son contrat
  const changes = [];
  if (data.status && data.status !== existing.status) {
    changes.push(`statut : ${existing.status} → ${data.status}`);
  }
  if (data.monthlyRent != null && Number(data.monthlyRent) !== existing.monthlyRent) {
    changes.push(`loyer : ${existing.monthlyRent.toLocaleString('fr-FR')} → ${Number(data.monthlyRent).toLocaleString('fr-FR')} FCFA`);
  }
  if (data.endDate && data.endDate.getTime() !== existing.endDate.getTime()) {
    changes.push(`fin : ${new Date(data.endDate).toLocaleDateString('fr-FR')}`);
  }
  if (changes.length > 0 && existing.tenantId !== req.user.id) {
    await notifyUser(existing.tenantId, 'contract', `Contrat ${existing.reference} mis à jour`,
      `${req.user.name} a modifié : ${changes.join(', ')}.`);
  }
  // Départ / résiliation → état des lieux de SORTIE (brouillon) à établir.
  if (data.status === 'TERMINATED' && existing.status !== 'TERMINATED') {
    await ensureInventory(existing.id, 'EXIT');
    await notifyUser(existing.landlordId, 'contract', 'État des lieux de sortie à établir 📝',
      `Le contrat ${existing.reference} est résilié. Un état des lieux de sortie pré-rempli par pièce est prêt à compléter.`);
  }
  res.json({ data: contract });
}));

// POST /api/contracts/:id/sign — le locataire signe le contrat de son
// propriétaire (contrat statutaire). Une fois signé, le bien passe en OCCUPIED.
r.post('/:id/sign', requireRole('TENANT'), asyncHandler(async (req, res) => {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
  if (!contract) return res.status(404).json({ error: 'Contrat introuvable' });
  if (contract.tenantId !== req.user.id) {
    return res.status(403).json({ error: 'Ce contrat ne vous est pas destiné' });
  }
  if (contract.signedAt) {
    return res.status(409).json({ error: 'Contrat déjà signé' });
  }
  if (contract.status === 'TERMINATED' || derivedStatus(contract) === 'EXPIRED') {
    return res.status(410).json({ error: 'Contrat expiré ou résilié — non signable' });
  }
  const signed = await prisma.$transaction([
    prisma.contract.update({
      where: { id: contract.id },
      data: { signedAt: new Date() },
    }),
    prisma.property.update({ where: { id: contract.propertyId }, data: { status: 'OCCUPIED' } }),
    prisma.notification.create({
      data: {
        userId: contract.landlordId, type: 'contract',
        title: 'Contrat signé ✒',
        body: `${req.user.name} a signé le contrat ${contract.reference}. Le bien est officiellement occupé.`,
      },
    }),
    prisma.notification.create({
      data: {
        userId: req.user.id, type: 'contract',
        title: 'Contrat signé ✔',
        body: `Vous avez signé le contrat ${contract.reference}. Votre emménagement est confirmé.`,
      },
    }),
  ]);
  // Emménagement → état des lieux d'ENTRÉE (brouillon pré-rempli) à compléter.
  await ensureInventory(contract.id, 'ENTRY');
  await notifyUser(contract.landlordId, 'contract', 'État des lieux d\'entrée à compléter 📝',
    `${req.user.name} a signé le contrat ${contract.reference}. Un état des lieux d'entrée pré-rempli par pièce est prêt : complétez-le puis faites-le signer.`);
  res.json({ data: serialize(signed[0], []) });
}));

// POST /api/contracts/transfer — le locataire se transfère chez un NOUVEAU
// propriétaire : résilie le contrat actuel, crée le contrat statutaire du
// nouveau bien en attente de signature (« tout locataire doit signer »).
r.post('/transfer', requireRole('TENANT'), asyncHandler(async (req, res) => {
  const { propertyId } = req.body || {};
  if (!propertyId) return res.status(400).json({ error: 'propertyId requis' });
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return res.status(404).json({ error: 'Propriété introuvable' });
  if (property.status !== 'AVAILABLE') {
    return res.status(409).json({ error: 'Ce bien n\'est pas disponible à la location' });
  }

  // Contrat locataire actuel (signé et non terminé)
  const current = await prisma.contract.findFirst({
    where: { tenantId: req.user.id, signedAt: { not: null }, status: { not: 'TERMINATED' } },
    include: { property: { select: { name: true } } },
    orderBy: { startDate: 'desc' },
  });
  if (current && current.landlordId === property.ownerId) {
    return res.status(400).json({ error: 'Vous êtes déjà locataire chez ce propriétaire' });
  }

  const now = new Date();
  const endDate = new Date(now);
  endDate.setFullYear(endDate.getFullYear() + 1);

  const ops = [
    prisma.contract.create({
      data: {
        reference: await nextReference(),
        monthlyRent: property.monthlyRent,
        depositAmount: property.monthlyRent, // caution = 1 mois, signature = remise
        depositPaid: false,
        startDate: now,
        endDate,
        signedAt: null, // ← en attente de signature par le locataire
        tenantId: req.user.id,
        landlordId: property.ownerId,
        propertyId: property.id,
      },
    }),
    prisma.notification.create({
      data: {
        userId: property.ownerId, type: 'contract',
        title: 'Nouveau locataire candidat',
        body: `${req.user.name} souhaite emménager à « ${property.name} ». Contrat en attente de signature.`,
      },
    }),
  ];
  if (current) {
    ops.push(
      prisma.contract.update({ where: { id: current.id }, data: { status: 'TERMINATED' } }),
      prisma.notification.create({
        data: {
          userId: req.user.id, type: 'contract',
          title: 'Transfert engagé',
          body: `Votre contrat ${current.reference} est résilié. Signez le nouveau contrat pour finaliser votre emménagement.`,
        },
      }),
      prisma.notification.create({
        data: {
          userId: current.landlordId, type: 'contract',
          title: 'Locataire en transfert',
          body: `${req.user.name} quitte « ${current.property?.name ?? ' votre bien'} » — contrat ${current.reference} résilié pour emménager ailleurs.`,
        },
      }),
    );
    // libérer l'ancien bien si plus aucun contrat actif ne l'occupe
    const remaining = await prisma.contract.count({
      where: { propertyId: current.propertyId, status: { not: 'TERMINATED' }, id: { not: current.id } },
    });
    if (remaining === 0) {
      ops.push(prisma.property.update({
        where: { id: current.propertyId }, data: { status: 'AVAILABLE' },
      }));
    }
  }
  const [created] = await prisma.$transaction(ops);
  // Départ de l'ancien bien → état des lieux de SORTIE (brouillon) à établir.
  if (current) {
    await ensureInventory(current.id, 'EXIT');
    await notifyUser(current.landlordId, 'contract', 'État des lieux de sortie à établir 📝',
      `${req.user.name} quitte « ${current.property?.name ?? 'votre bien'} » (contrat ${current.reference}). Un état des lieux de sortie pré-rempli est prêt à compléter.`);
  }
  res.status(201).json({ data: serialize(created, []) });
}));

// POST /api/contracts/issue — le locataire signale un problème à son propriétaire.
r.post('/issue', requireRole('TENANT'), asyncHandler(async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (message.length < 5 || message.length > 500) {
    return res.status(400).json({ error: 'Message : 5 à 500 caractères' });
  }
  const contract = await prisma.contract.findFirst({
    where: { tenantId: req.user.id, signedAt: { not: null }, status: { not: 'TERMINATED' } },
    include: { property: { select: { name: true } } },
    orderBy: { startDate: 'desc' },
  });
  if (!contract) return res.status(404).json({ error: 'Aucun contrat actif — rien à signaler' });
  await prisma.notification.create({
    data: {
      userId: contract.landlordId, type: 'maintenance',
      title: `Signalement — ${contract.property?.name ?? 'bien'}`,
      body: `${req.user.name} : ${message}`,
    },
  });
  res.json({ success: true });
}));

export default r;
