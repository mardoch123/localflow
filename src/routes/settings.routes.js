import { Router } from 'express';
import { prisma } from '../config.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isOneOf, PRINTER_WIDTHS, COMMISSION_RATE } from '../utils/validate.js';

const r = Router();
r.use(requireAuth);

// GET /api/settings — réglages de l'utilisateur courant (imprimante, commission)
r.get('/', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { printerWidth: true, autoPrintReceipt: true },
  });
  res.json({
    data: {
      printerWidth: user?.printerWidth || '80mm',
      autoPrintReceipt: user?.autoPrintReceipt !== false,
      commissionRate: COMMISSION_RATE,
    },
  });
}));

// PATCH /api/settings/printer — largeur 58mm/80mm + impression automatique (propriétaire/admin)
r.patch('/printer', requireRole('LANDLORD', 'ADMIN'), asyncHandler(async (req, res) => {
  const data = {};
  if (req.body?.printerWidth !== undefined) {
    if (!isOneOf(req.body.printerWidth, PRINTER_WIDTHS)) {
      return res.status(400).json({ error: 'Largeur invalide (58mm ou 80mm)' });
    }
    data.printerWidth = req.body.printerWidth;
  }
  if (req.body?.autoPrintReceipt !== undefined) {
    if (typeof req.body.autoPrintReceipt !== 'boolean') {
      return res.status(400).json({ error: 'autoPrintReceipt doit être un booléen' });
    }
    data.autoPrintReceipt = req.body.autoPrintReceipt;
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Aucun réglage à mettre à jour' });
  }
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    select: { printerWidth: true, autoPrintReceipt: true },
  });
  res.json({ data: user });
}));

export default r;
