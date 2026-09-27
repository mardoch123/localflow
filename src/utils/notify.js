// Centralisateur de notifications : chaque action métier doit être notifiée.
// Types supportés par l'app : payment | contract | maintenance | info.
import { prisma } from '../config.js';

/** Ligne de notification pour createMany. */
export const notifRow = (userId, type, title, body) =>
  ({ userId, type, title, body });

/** Notifie un utilisateur (hors transaction). */
export const notifyUser = (userId, type, title, body) =>
  prisma.notification.create({ data: { userId, type, title, body } });

/** Identifiants de tous les admins (veille plateforme). */
export async function adminUserIds() {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

/** Locataires distincts liés à un propriétaire par un contrat non résilié. */
export async function tenantIdsOfLandlord(landlordId) {
  const contracts = await prisma.contract.findMany({
    where: { landlordId, status: { not: 'TERMINATED' } },
    select: { tenantId: true },
  });
  return [...new Set(contracts.map((c) => c.tenantId))];
}

/** Locataires distincts occupant un bien (contrats non résiliés). */
export async function tenantIdsOfProperty(propertyId) {
  const contracts = await prisma.contract.findMany({
    where: { propertyId, status: { not: 'TERMINATED' } },
    select: { tenantId: true },
  });
  return [...new Set(contracts.map((c) => c.tenantId))];
}
