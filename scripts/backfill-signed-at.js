// Backfill : les contrats existants (seed) sont considérés déjà signés.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const updated = await prisma.$executeRawUnsafe(
  `UPDATE "Contract" SET "signedAt" = "createdAt" WHERE "signedAt" IS NULL AND status <> 'TERMINATED'`,
);
console.log(`✒ ${updated} contrat(s) marqué(s) comme signés (backfill).`);
await prisma.$disconnect();
