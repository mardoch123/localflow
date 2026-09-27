// Backfill ponctuel : applique la commission plateforme 1 % sur les paiements
// déjà passés à PAID qui n'ont pas encore de commissionAmount.
// Usage : node scripts/backfill-commissions.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const COMMISSION_RATE = 0.01;

const paid = await prisma.payment.findMany({ where: { status: 'PAID' } });
let updated = 0;
for (const p of paid) {
  const commission = Math.round(p.amount * COMMISSION_RATE);
  if (p.commissionAmount !== commission) {
    await prisma.payment.update({
      where: { id: p.id },
      data: { commissionAmount: commission },
    });
    updated += 1;
  }
}
console.log(`Paiements PAID verifes: ${paid.length} — commissions 1% backfeillees: ${updated}`);
await prisma.$disconnect();
