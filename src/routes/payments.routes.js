import { Router } from 'express';
import { prisma } from '../config.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isInt, isOneOf, isDate, PAYMENT_METHODS, normalizeMethod, commissionOf } from '../utils/validate.js';
import { notifyUser } from '../utils/notify.js';

const r = Router();
r.use(requireAuth);

const STATUSES = ['PAID', 'PENDING', 'OVERDUE', 'FAILED'];

// GET /api/payments?status=  (scopé par rôle)
r.get('/', asyncHandler(async (req, res) => {
  const where = {};
  if (req.user.role === 'TENANT') where.tenantId = req.user.id;
  else if (req.user.role === 'LANDLORD') where.contract = { landlordId: req.user.id };
  if (req.query.status && req.query.status !== 'ALL') where.status = String(req.query.status).toUpperCase();

  const payments = await prisma.payment.findMany({
    where,
    include: {
      tenant: { select: { id: true, name: true } },
      property: { select: { id: true, name: true, address: true } },
      contract: { select: { id: true, reference: true } },
    },
    orderBy: { dueDate: 'desc' },
  });
  res.json({ data: payments });
}));

// GET /api/payments/summary — suivi d'échéances pour le locataire connecté.
// Prochain paiement dû, alerte avant échéance, soldes et totaux.
r.get('/summary', asyncHandler(async (req, res) => {
  if (req.user.role !== 'TENANT') {
    return res.status(403).json({ error: 'Réservé aux locataires' });
  }
  const payments = await prisma.payment.findMany({
    where: { tenantId: req.user.id },
    include: { property: { select: { id: true, name: true, address: true } } },
    orderBy: { dueDate: 'asc' },
  });
  // Moyens réellement payables : providers ACTIVÉS chez le bailleur du contrat actif
  const activeContract = await prisma.contract.findFirst({
    where: { tenantId: req.user.id, status: { not: 'TERMINATED' } },
    orderBy: { startDate: 'desc' },
  });
  const payMethods = activeContract
    ? (await prisma.paymentProviderConfig.findMany({
        where: { userId: activeContract.landlordId, enabled: true },
        select: { provider: true, name: true },
        orderBy: { name: 'asc' },
      })).filter((p) => PAYMENT_METHODS.includes(p.provider))
    : [];
  const now = new Date();
  const outstanding = payments.filter((p) => p.status !== 'PAID');
  const next = outstanding.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0] ?? null;
  const daysUntilDue = next
    ? Math.ceil((new Date(next.dueDate).getTime() - now.getTime()) / 86_400_000)
    : null;
  res.json({
    data: {
      totalPaid: payments.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amount, 0),
      totalOutstanding: outstanding.reduce((s, p) => s + p.amount, 0),
      overdueCount: payments.filter((p) => p.status === 'OVERDUE').length,
      pendingCount: payments.filter((p) => p.status === 'PENDING').length,
      paidCount: payments.filter((p) => p.status === 'PAID').length,
      payMethods,
      nextDue: next ? {
        id: next.id,
        reference: next.reference,
        amount: next.amount,
        dueDate: next.dueDate,
        status: next.status,
        property: next.property,
        daysUntilDue,
        // Alerte : dans les 7 jours avant échéance, ou déjà dépassée
        alert: daysUntilDue != null && daysUntilDue <= 7,
        late: daysUntilDue != null && daysUntilDue < 0,
      } : null,
      history: payments.map((p) => ({
        id: p.id, reference: p.reference, period: p.period, amount: p.amount,
        status: p.status, dueDate: p.dueDate, paidAt: p.paidAt, method: p.method,
        property: p.property,
      })),
    },
  });
}));

// POST /api/payments/:id/pay — le locataire paie lui-même son échéance via un
// provider activé par son propriétaire (FeexPay / FedaPay / KKiaPay).
r.post('/:id/pay', requireRole('TENANT'), asyncHandler(async (req, res) => {
  const method = normalizeMethod(req.body?.method);
  if (!isOneOf(method, PAYMENT_METHODS)) {
    return res.status(400).json({ error: 'Moyen de paiement invalide (feexpay, fedapay, kkiapay, ussd)' });
  }
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: { contract: { select: { id: true, landlordId: true, status: true } } },
  });
  if (!payment) return res.status(404).json({ error: 'Paiement introuvable' });
  if (payment.tenantId !== req.user.id) {
    return res.status(403).json({ error: 'Ce paiement ne vous concerne pas' });
  }
  if (payment.status === 'PAID') {
    return res.status(409).json({ error: 'Ce paiement est déjà réglé' });
  }

  // Le provider doit être activé chez le propriétaire concerné
  const provider = await prisma.paymentProviderConfig.findFirst({
    where: { userId: payment.contract.landlordId, provider: method, enabled: true },
  });
  if (!provider) {
    return res.status(400).json({ error: "Ce moyen de paiement n'est pas activé par votre propriétaire" });
  }

  const now = new Date();
  const commission = commissionOf(payment.amount);
  const [updated] = await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', paidAt: now, method, commissionAmount: commission },
    }),
    // Stats du provider côté propriétaire (suivi des transactions + volume)
    prisma.paymentProviderConfig.update({
      where: { id: provider.id },
      data: { transactions: { increment: 1 }, volume: { increment: payment.amount } },
    }),
    prisma.notification.createMany({
      data: [
        {
          userId: req.user.id, type: 'payment',
          title: 'Paiement confirmé ✔',
          body: `Loyer ${payment.period} réglé via ${provider.name} — ${payment.amount.toLocaleString('fr-FR')} FCFA`,
        },
        {
          userId: payment.contract.landlordId, type: 'payment',
          title: 'Paiement reçu',
          body: `Loyer ${payment.period} reçu via ${provider.name} (${payment.amount.toLocaleString('fr-FR')} FCFA) — commission plateforme 1 % : ${commission.toLocaleString('fr-FR')} FCFA`,
        },
      ],
    }),
  ]);
  res.json({ data: updated });
}));

// POST /api/payments/:id/cash — le propriétaire encaisse un paiement EN ESPÈCES
// (déclenchable uniquement par LANDLORD/ADMIN, jamais par le locataire).
r.post('/:id/cash', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: {
      contract: { select: { landlordId: true, reference: true } },
      tenant: { select: { name: true } },
      property: { select: { name: true, address: true } },
    },
  });
  if (!payment) return res.status(404).json({ error: 'Paiement introuvable' });
  if (req.user.role === 'LANDLORD' && payment.contract.landlordId !== req.user.id) {
    return res.status(403).json({ error: 'Paiement d\'un autre propriétaire' });
  }
  if (payment.status === 'PAID') {
    return res.status(409).json({ error: 'Ce paiement est déjà réglé' });
  }
  const now = new Date();
  const commission = commissionOf(payment.amount);
  const [updated] = await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', paidAt: now, method: 'espece', commissionAmount: commission },
    }),
    prisma.notification.createMany({
      data: [
        {
          userId: payment.tenantId, type: 'payment',
          title: 'Paiement espèces encaissé',
          body: `Le propriétaire a confirmé l'encaissement en espèces du loyer ${payment.period} (${payment.amount.toLocaleString('fr-FR')} FCFA).`,
        },
        {
          userId: req.user.id, type: 'payment',
          title: 'Encaissement espèces enregistré',
          body: `Loyer ${payment.period} : ${payment.amount.toLocaleString('fr-FR')} FCFA encaissés. Commission 1 % : ${commission.toLocaleString('fr-FR')} FCFA — net : ${(payment.amount - commission).toLocaleString('fr-FR')} FCFA.`,
        },
      ],
    }),
  ]);
  // Ticket de caisse prêt à imprimer (imprimante thermique 58/80 mm du propriétaire)
  const receipt = {
    reference: payment.reference,
    contractReference: payment.contract.reference,
    period: payment.period,
    amount: payment.amount,
    commission,
    net: payment.amount - commission,
    method: 'espece',
    tenantName: payment.tenant.name,
    propertyName: payment.property.name,
    propertyAddress: payment.property.address,
    landlordName: req.user.name,
    paidAt: now,
  };
  res.json({
    data: updated,
    receipt,
    printer: {
      width: req.user.printerWidth || '80mm',
      autoPrint: req.user.autoPrintReceipt !== false,
    },
  });
}));

// POST /api/payments  (un propriétaire/enregistré ou ADMIN déclare un paiement)
r.post('/', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const { contractId, amount, method, status, dueDate, period } = req.body || {};
  if (!contractId || !isInt(amount, { min: 1, max: 1_000_000_000 })) {
    return res.status(400).json({ error: 'contractId et amount (entier > 0) sont requis' });
  }
  if (status != null && !isOneOf(status, STATUSES)) {
    return res.status(400).json({ error: 'Statut de paiement invalide' });
  }
  if (dueDate != null && !isDate(dueDate)) {
    return res.status(400).json({ error: 'Date d\'échéance invalide' });
  }
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) return res.status(404).json({ error: 'Contrat introuvable' });
  if (req.user.role === 'LANDLORD' && contract.landlordId !== req.user.id) {
    return res.status(403).json({ error: 'Contrat d\'un autre propriétaire' });
  }

  const count = await prisma.payment.count();
  const finalStatus = isOneOf(status, STATUSES) ? status : 'PENDING';
  const payment = await prisma.payment.create({
    data: {
      reference: `PAY-${new Date().getFullYear()}-${String(1000 + count + 1)}`,
      amount: Number(amount),
      commissionAmount: finalStatus === 'PAID' ? commissionOf(amount) : 0,
      method: method ? normalizeMethod(method) : null,
      status: finalStatus,
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      paidAt: status === 'PAID' ? new Date() : null,
      period: period || new Date().toISOString().slice(0, 7),
      contractId: contract.id,
      propertyId: contract.propertyId,
      tenantId: contract.tenantId,
    },
  });
  if (contract.tenantId !== req.user.id) {
    await notifyUser(contract.tenantId, 'payment', 'Nouvelle échéance de loyer',
      `Le propriétaire a enregistré le loyer ${payment.period} : ${payment.amount.toLocaleString('fr-FR')} FCFA, dû le ${new Date(payment.dueDate).toLocaleDateString('fr-FR')}.`);
  }
  res.status(201).json({ data: payment });
}));

// PATCH /api/payments/:id  (changer le statut, marquer payé — propriétaire du contrat ou ADMIN)
r.patch('/:id', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const existing = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: { contract: { select: { landlordId: true } } },
  });
  if (!existing) return res.status(404).json({ error: 'Paiement introuvable' });
  if (req.user.role === 'LANDLORD' && existing.contract.landlordId !== req.user.id) {
    return res.status(403).json({ error: 'Paiement d\'un autre propriétaire' });
  }
  const data = {};
  if (isOneOf(req.body?.status, STATUSES)) {
    data.status = req.body.status;
    if (req.body.status === 'PAID') data.paidAt = existing.paidAt || new Date();
  }
  if (req.body?.method !== undefined) data.method = normalizeMethod(req.body.method);
  if (req.body?.amount !== undefined && isInt(req.body.amount, { min: 1, max: 1_000_000_000 })) {
    data.amount = Number(req.body.amount);
  }
  // La commission 1 % suit le statut payé et le montant final
  const finalStatus = data.status ?? existing.status;
  if (finalStatus === 'PAID') {
    data.commissionAmount = commissionOf(data.amount ?? existing.amount);
  }
  const payment = await prisma.payment.update({ where: { id: req.params.id }, data });
  // Le locataire est notifié de tout changement le concernant (sauf si c'est lui)
  const notifChanges = [];
  if (data.status && data.status !== existing.status) {
    const labels = { PAID: 'marqué payé', PENDING: 'reprogrammé', OVERDUE: 'en retard', FAILED: 'échoué' };
    notifChanges.push(`statut : ${labels[data.status] ?? data.status}`);
  }
  if (data.amount != null && data.amount !== existing.amount) {
    notifChanges.push(`montant : ${existing.amount.toLocaleString('fr-FR')} → ${data.amount.toLocaleString('fr-FR')} FCFA`);
  }
  if (notifChanges.length > 0 && existing.tenantId !== req.user.id) {
    await notifyUser(existing.tenantId, 'payment', `Échéance ${existing.period} mise à jour`,
      `${req.user.name} a modifié votre paiement ${existing.reference} : ${notifChanges.join(', ')}.`);
  }
  res.json({ data: payment });
}));

export default r;
