import { Router } from 'express';
import { prisma } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const r = Router();
r.use(requireAuth);

const initials = (name) =>
  name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

// GET /api/dashboard/tenant
r.get('/tenant', asyncHandler(async (req, res) => {
  const contract = await prisma.contract.findFirst({
    where: {
      tenantId: req.user.id,
      status: { in: ['ACTIVE', 'EXPIRING'] },
    },
    include: {
      property: true,
      landlord: { select: { name: true, phone: true } },
      payments: { orderBy: { period: 'desc' }, take: 2 },
    },
    orderBy: { endDate: 'desc' },
  });
  if (!contract) return res.json({ data: null });

  const lastPayment = contract.payments[0];
  const now = new Date();
  const daysUntilPayment = Math.max(
    0,
    Math.ceil((new Date(lastPayment?.dueDate || now).getTime() - now.getTime()) / 86400000),
  );
  res.json({
    data: {
      name: req.user.name,
      initials: initials(req.user.name),
      contractReference: contract.reference,
      property: contract.property.name,
      address: contract.property.address,
      monthlyRent: contract.monthlyRent,
      nextPaymentDate: lastPayment ? new Date(lastPayment.dueDate) : null,
      contractEnd: new Date(contract.endDate),
      landlordName: contract.landlord.name,
      landlordPhone: contract.landlord.phone,
      paymentStatus: lastPayment ? lastPayment.status.toLowerCase() : 'pending',
      daysUntilPayment,
      balance: lastPayment && lastPayment.status !== 'PAID' ? contract.monthlyRent : 0,
    },
  });
}));

// GET /api/dashboard/owner
r.get('/owner', asyncHandler(async (req, res) => {
  const properties = await prisma.property.findMany({
    where: { ownerId: req.user.id },
    include: {
      contracts: {
        where: { status: { in: ['ACTIVE', 'EXPIRING'] } },
        include: { tenant: { select: { id: true, name: true } } },
        orderBy: { startDate: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const propertyIds = properties.map((p) => p.id);
  const pendingPayments = await prisma.payment.findMany({
    where: { propertyId: { in: propertyIds }, status: { in: ['PENDING', 'OVERDUE'] } },
  });
  // Commission plateforme 1 % — à la charge du propriétaire (somme réelle des paiements payés)
  const paidAgg = await prisma.payment.aggregate({
    _sum: { amount: true, commissionAmount: true },
    _count: true,
    where: { propertyId: { in: propertyIds }, status: 'PAID' },
  });
  const totalPaid = paidAgg._sum.amount || 0;
  const totalCommission = paidAgg._sum.commissionAmount || 0;

  const occupied = properties.filter((p) => p.status === 'OCCUPIED');
  const totalMonthlyRevenue = occupied.reduce((s, p) => s + p.monthlyRent, 0);
  const pendingAmount = pendingPayments.reduce((s, p) => s + p.amount, 0);

  res.json({
    data: {
      name: req.user.name,
      initials: initials(req.user.name),
      totalProperties: properties.length,
      occupiedProperties: occupied.length,
      vacantProperties: properties.filter((p) => ['VACANT', 'AVAILABLE'].includes(p.status)).length,
      totalMonthlyRevenue,
      totalPaid,
      totalCommission,
      netRevenue: totalPaid - totalCommission,
      paidCount: paidAgg._count,
      pendingPayments: pendingPayments.length,
      pendingAmount,
      totalTenants: new Set(occupied.map((p) => p.contracts[0]?.tenantId).filter(Boolean)).size,
      occupancyRate: properties.length
        ? Math.round((occupied.length / properties.length) * 100)
        : 0,
      properties: properties.map((p) => ({
        id: p.id,
        name: p.name,
        address: p.address,
        imageUrl: p.imageUrl,
        tenant: p.contracts[0]?.tenant?.name || null,
        rent: p.monthlyRent,
        status: p.status.toLowerCase(),
      })),
      printer: {
        width: req.user.printerWidth || '80mm',
        autoPrint: req.user.autoPrintReceipt !== false,
      },
    },
  });
}));

// GET /api/dashboard/admin
r.get('/admin', asyncHandler(async (req, res) => {
  const [totalUsers, totalLandlords, totalTenants, totalProperties, occupiedProperties, overduePayments, activeContracts, paymentsAgg, recentPayments, users] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'LANDLORD' } }),
      prisma.user.count({ where: { role: 'TENANT' } }),
      prisma.property.count(),
      prisma.property.count({ where: { status: 'OCCUPIED' } }),
      prisma.payment.count({ where: { status: 'OVERDUE' } }),
      prisma.contract.count({ where: { status: { in: ['ACTIVE', 'EXPIRING'] } } }),
      prisma.payment.aggregate({ _sum: { amount: true, commissionAmount: true }, where: { status: 'PAID' } }),
      prisma.payment.findMany({
        orderBy: { dueDate: 'desc' },
        take: 10,
        include: { tenant: { select: { name: true } }, property: { select: { name: true } } },
      }),
      prisma.user.findMany({ select: { role: true, createdAt: true } }),
    ]);

  // Tendance d'inscriptions sur 12 mois glissants (réelle, calculée depuis createdAt)
  const buckets = {};
  const order = [];
  const cur = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(cur.getFullYear(), cur.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets[key] = { monthKey: key, landlords: 0, tenants: 0 };
    order.push(key);
  }
  for (const u of users) {
    const k = `${u.createdAt.getFullYear()}-${String(u.createdAt.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets[k]) continue;
    if (u.role === 'LANDLORD') buckets[k].landlords += 1;
    else if (u.role === 'TENANT') buckets[k].tenants += 1;
  }
  const signupTrend = order.map((k) => buckets[k]);
  res.json({
    data: {
      totalUsers,
      totalLandlords,
      totalTenants,
      totalProperties,
      occupiedProperties,
      overduePayments,
      activeContracts,
      occupancyRate: totalProperties
        ? Math.round((occupiedProperties / totalProperties) * 100)
        : 0,
      totalVolume: paymentsAgg._sum.amount || 0,
      // Recette plateforme : commission 1 % prélevée sur les paiements (à la charge des propriétaires)
      totalCommission: paymentsAgg._sum.commissionAmount || 0,
      recentPayments,
      signupTrend,
    },
  });
}));

export default r;
