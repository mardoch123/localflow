import { Router } from 'express';
import { prisma } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { tenantIdsOfLandlord } from '../utils/notify.js';

const r = Router();
r.use(requireAuth);

const DEFAULT_PROVIDERS = [
  { provider: 'feexpay', name: 'FeexPay', description: 'Paiement mobile Bénin & Togo', icon: 'account_balance_wallet', primaryColor: '#1B6CA8' },
  { provider: 'fedapay', name: 'FedaPay', description: "Passerelle de paiement Afrique de l'Ouest", icon: 'payments', primaryColor: '#34C98B' },
  { provider: 'kkiapay', name: 'KKiaPay', description: 'Paiement mobile simplifié', icon: 'mobile_friendly', primaryColor: '#F59E0B' },
  { provider: 'ussd', name: 'USSD', description: 'Débit mobile MTN / Moov / CELBAIR', icon: 'dialpad', primaryColor: '#8B5CF6' },
];

// GET /api/payment-providers — config de l'utilisateur courant (complétée si des providers manquent)
r.get('/', asyncHandler(async (req, res) => {
  const existing = await prisma.paymentProviderConfig.findMany({
    where: { userId: req.user.id },
  });
  const missing = DEFAULT_PROVIDERS.filter(
    (d) => !existing.some((e) => e.provider === d.provider),
  );
  if (missing.length > 0) {
    await prisma.$transaction(
      missing.map((p) =>
        prisma.paymentProviderConfig.create({ data: { ...p, userId: req.user.id } }),
      ),
    );
  }
  const providers = await prisma.paymentProviderConfig.findMany({
    where: { userId: req.user.id },
    orderBy: { name: 'asc' },
  });
  res.json({ data: providers });
}));

// PATCH /api/payment-providers/:id — activer/désactiver
r.patch('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.paymentProviderConfig.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== req.user.id) {
    return res.status(404).json({ error: 'Provider introuvable' });
  }
  const data = {};
  if (typeof req.body.enabled === 'boolean') data.enabled = req.body.enabled;
  if (typeof req.body.connected === 'boolean') data.connected = req.body.connected;
  const provider = await prisma.paymentProviderConfig.update({ where: { id: req.params.id }, data });
  // Promesse tenue côté UI : les locataires du bailleur sont notifiés du
  // changement de ses moyens de paiement activés.
  if (typeof data.enabled === 'boolean' && data.enabled !== existing.enabled) {
    const tenantIds = await tenantIdsOfLandlord(req.user.id);
    if (tenantIds.length > 0) {
      await prisma.notification.createMany({
        data: tenantIds.map((userId) => ({
          userId,
          type: 'info',
          title: provider.enabled
            ? `Nouveau moyen de paiement : ${provider.name}`
            : `${provider.name} désactivé`,
          body: provider.enabled
            ? `Votre propriétaire a activé ${provider.name} — vous pouvez payer vos loyers via ce moyen.`
            : `Votre propriétaire a désactivé ${provider.name}. Choisissez un autre moyen pour vos prochains paiements.`,
        })),
      });
    }
  }
  res.json({ data: provider });
}));

export default r;
