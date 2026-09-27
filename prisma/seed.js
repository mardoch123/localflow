// Seed LocaFlow - données de démonstration cohérentes avec l'app Flutter
// Lancement : npm run db:seed  (ou npx prisma db seed)
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const hash = (pwd) => bcrypt.hashSync(pwd, 10);
const d = (s) => new Date(s);

async function main() {
  console.log('🌱 Seed LocaFlow…');

  // ── USERS ────────────────────────────────────────────────
  const users = [
    { email: 'kofi.mensah@locaflow.bj', password: hash('Locaflow2026'), name: 'Kofi Mensah', phone: '+229 97 12 34 56', role: 'TENANT' },
    { email: 'fatou.traore@locaflow.bj', password: hash('Locaflow2026'), name: 'Fatou Traoré', phone: '+228 90 45 12 78', role: 'TENANT' },
    { email: 'moussa.coulibaly@locaflow.bj', password: hash('Locaflow2026'), name: 'Moussa Coulibaly', phone: '+229 96 33 21 45', role: 'TENANT' },
    { email: 'ibrahim.sow@locaflow.bj', password: hash('Locaflow2026'), name: 'Ibrahim Sow', phone: '+228 91 22 55 33', role: 'TENANT' },
    { email: 'aissatou.ndiaye@locaflow.bj', password: hash('Locaflow2026'), name: 'Aïssatou Ndiaye', phone: '+229 95 87 41 20', role: 'TENANT' },
    { email: 'amara.diallo@locaflow.bj', password: hash('Proprio2026'), name: 'Amara Diallo', phone: '+229 97 54 23 11', role: 'LANDLORD' },
    { email: 'khadija.ouedraogo@locaflow.bj', password: hash('Proprio2026'), name: 'Khadija Ouédraogo', phone: '+226 70 12 34 56', role: 'LANDLORD' },
    { email: 'seydou.bah@locaflow.bj', password: hash('Proprio2026'), name: 'Seydou Bah', phone: '+225 07 88 44 21', role: 'LANDLORD' },
    { email: 'aminata.kone@locaflow.bj', password: hash('Proprio2026'), name: 'Aminata Koné', phone: '+225 05 44 78 90', role: 'LANDLORD' },
    { email: 'admin@locaflow.bj', password: hash('SuperAdmin2026'), name: 'Super Admin', phone: '+229 00 00 00 01', role: 'ADMIN' },
  ];

  const byEmail = {};
  for (const u of users) {
    byEmail[u.email] = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: u,
    });
  }
  console.log(`👤 ${Object.keys(byEmail).length} utilisateurs`);

  // ── PROPERTIES ───────────────────────────────────────────
  const properties = [
    { key: 'riviera', ref: { name: 'Appartement Cocody Riviera', address: 'Riviera 3, Abidjan', city: 'Abidjan', type: 'Appartement 2 pièces', monthlyRent: 185000, status: 'OCCUPIED', imageUrl: 'https://img.rocket.new/generatedImages/rocket_gen_img_1be989a4f-1773164988183.png', imageLabel: 'Modern apartment living room with white walls and wooden furniture', area: '65 m²', rooms: 2, ageYears: '4 ans', visitors: 41, ownerId: byEmail['amara.diallo@locaflow.bj'].id } },
    { key: 'plateau', ref: { name: 'Villa Plateau', address: 'Plateau, Abidjan', city: 'Abidjan', type: 'Villa', monthlyRent: 250000, status: 'OCCUPIED', imageUrl: 'https://img.rocket.new/generatedImages/rocket_gen_img_145f70c5b-1774177504950.png', imageLabel: 'White villa with garden and blue sky in West Africa', area: '140 m²', rooms: 4, ageYears: '6 ans', visitors: 22, ownerId: byEmail['amara.diallo@locaflow.bj'].id } },
    { key: 'marcory', ref: { name: 'Studio Marcory', address: 'Marcory, Abidjan', city: 'Abidjan', type: 'Studio meublé', monthlyRent: 85000, status: 'OCCUPIED', imageUrl: 'https://img.rocket.new/generatedImages/rocket_gen_img_1b8a45670-1772145277857.png', imageLabel: 'Compact studio apartment with modern minimalist design', area: '30 m²', rooms: 1, ageYears: '3 ans', visitors: 58, ownerId: byEmail['amara.diallo@locaflow.bj'].id } },
    { key: 'yopougon', ref: { name: 'Appartement Yopougon', address: 'Yopougon, Abidjan', city: 'Abidjan', type: 'Appartement 2 pièces', monthlyRent: 100000, status: 'VACANT', imageUrl: 'https://img.rocket.new/generatedImages/rocket_gen_img_1a40c06be-1778064650429.png', imageLabel: 'Empty apartment with large windows and city view', area: '58 m²', rooms: 2, ageYears: '7 ans', visitors: 17, ownerId: byEmail['amara.diallo@locaflow.bj'].id } },
    { key: 'palmiers', ref: { name: 'Résidence Les Palmiers', address: 'Rue des Palmiers 12, Cotonou', city: 'Cotonou', type: 'Appartement 3 pièces', monthlyRent: 180000, status: 'AVAILABLE', imageUrl: 'https://img.rocket.new/generatedImages/rocket_gen_img_1b1b18bf9-1768030064827.png', imageLabel: 'Modern apartment building exterior with palm trees and blue sky', area: '85 m²', rooms: 3, ageYears: '5 ans', visitors: 34, ownerId: byEmail['amara.diallo@locaflow.bj'].id } },
    { key: 'marina', ref: { name: 'Villa La Marina', address: 'Boulevard de la Marina, Lomé', city: 'Lomé', type: 'Villa 5 pièces', monthlyRent: 450000, status: 'OCCUPIED', imageUrl: 'https://img.rocket.new/generatedImages/rocket_gen_img_17e04fc0b-1774058899296.png', imageLabel: 'Luxury villa with pool and garden in coastal residential area', area: '210 m²', rooms: 5, ageYears: '3 ans', visitors: 12, ownerId: byEmail['seydou.bah@locaflow.bj'].id } },
    { key: 'zogbo', ref: { name: 'Studio Zogbo', address: 'Quartier Zogbo, Cotonou', city: 'Cotonou', type: 'Studio meublé', monthlyRent: 85000, status: 'AVAILABLE', imageUrl: 'https://img.rocket.new/generatedImages/rocket_gen_img_132626547-1766145574497.png', imageLabel: 'Compact furnished studio apartment with modern interior and city view', area: '32 m²', rooms: 1, ageYears: '8 ans', visitors: 67, ownerId: byEmail['khadija.ouedraogo@locaflow.bj'].id } },
    { key: 'tokoin', ref: { name: 'Immeuble Tokoin', address: 'Rue Tokoin, Lomé', city: 'Lomé', type: 'Appartement 4 pièces', monthlyRent: 250000, status: 'MAINTENANCE', imageUrl: 'https://images.unsplash.com/photo-1712552980879-d7fbeed83f89', imageLabel: 'Four-bedroom apartment building under renovation with scaffolding', area: '120 m²', rooms: 4, ageYears: '12 ans', visitors: 5, ownerId: byEmail['amara.diallo@locaflow.bj'].id } },
    { key: 'fidjrosse', ref: { name: 'Duplex Fidjrossè', address: 'Quartier Fidjrossè, Cotonou', city: 'Cotonou', type: 'Duplex 6 pièces', monthlyRent: 380000, status: 'OCCUPIED', imageUrl: 'https://img.rocket.new/generatedImages/rocket_gen_img_14c6fa199-1777454821192.png', imageLabel: 'Modern duplex house with white facade and landscaped front garden', area: '180 m²', rooms: 6, ageYears: '2 ans', visitors: 28, ownerId: byEmail['amara.diallo@locaflow.bj'].id } },
    { key: 'liberation', ref: { name: 'Bureau La Libération', address: 'Avenue de la Libération, Abidjan', city: 'Abidjan', type: 'Bureau / Commerce', monthlyRent: 320000, status: 'OCCUPIED', imageUrl: 'https://img.rocket.new/generatedImages/rocket_gen_img_1852a66df-1769183706976.png', imageLabel: 'Modern commercial office space with glass facade in business district', area: '95 m²', rooms: 4, ageYears: '6 ans', visitors: 89, ownerId: byEmail['aminata.kone@locaflow.bj'].id } },
  ];

  const propByKey = {};
  for (const p of properties) {
    const existing = await prisma.property.findFirst({ where: { name: p.ref.name } });
    propByKey[p.key] = existing
      ? await prisma.property.update({ where: { id: existing.id }, data: p.ref })
      : await prisma.property.create({ data: p.ref });
  }
  console.log(`🏠 ${Object.keys(propByKey).length} propriétés`);

  // ── CONTRACTS ────────────────────────────────────────────
  const contracts = [
    { ref: { reference: 'C-2026-001', monthlyRent: 180000, depositAmount: 360000, depositPaid: true, startDate: d('2025-03-01'), endDate: d('2027-02-28'), status: 'ACTIVE', tenantId: byEmail['kofi.mensah@locaflow.bj'].id, landlordId: byEmail['amara.diallo@locaflow.bj'].id, propertyId: propByKey.palmiers.id } },
    { ref: { reference: 'C-2026-002', monthlyRent: 380000, depositAmount: 760000, depositPaid: true, startDate: d('2026-09-15'), endDate: d('2028-09-14'), status: 'ACTIVE', tenantId: byEmail['fatou.traore@locaflow.bj'].id, landlordId: byEmail['amara.diallo@locaflow.bj'].id, propertyId: propByKey.fidjrosse.id } },
    { ref: { reference: 'C-2026-003', monthlyRent: 450000, depositAmount: 900000, depositPaid: true, startDate: d('2026-01-01'), endDate: d('2026-12-31'), status: 'EXPIRING', tenantId: byEmail['ibrahim.sow@locaflow.bj'].id, landlordId: byEmail['seydou.bah@locaflow.bj'].id, propertyId: propByKey.marina.id } },
    { ref: { reference: 'C-2025-047', monthlyRent: 85000, depositAmount: 170000, depositPaid: false, startDate: d('2024-06-01'), endDate: d('2025-05-31'), status: 'EXPIRED', tenantId: byEmail['aissatou.ndiaye@locaflow.bj'].id, landlordId: byEmail['khadija.ouedraogo@locaflow.bj'].id, propertyId: propByKey.zogbo.id } },
    { ref: { reference: 'C-2026-004', monthlyRent: 320000, depositAmount: 640000, depositPaid: true, startDate: d('2026-07-01'), endDate: d('2028-06-30'), status: 'ACTIVE', tenantId: byEmail['seydou.bah@locaflow.bj'].id, landlordId: byEmail['aminata.kone@locaflow.bj'].id, propertyId: propByKey.liberation.id } },
    // Contrat principal du locataire démo (Kofi) - dashboard locataire
    { ref: { reference: 'C-2026-005', monthlyRent: 185000, depositAmount: 370000, depositPaid: true, startDate: d('2025-10-01'), endDate: d('2026-12-31'), status: 'EXPIRING', tenantId: byEmail['kofi.mensah@locaflow.bj'].id, landlordId: byEmail['amara.diallo@locaflow.bj'].id, propertyId: propByKey.riviera.id } },
    { ref: { reference: 'C-2026-006', monthlyRent: 250000, depositAmount: 500000, depositPaid: true, startDate: d('2026-01-15'), endDate: d('2027-01-14'), status: 'ACTIVE', tenantId: byEmail['fatou.traore@locaflow.bj'].id, landlordId: byEmail['amara.diallo@locaflow.bj'].id, propertyId: propByKey.plateau.id } },
    { ref: { reference: 'C-2026-007', monthlyRent: 85000, depositAmount: 170000, depositPaid: true, startDate: d('2026-02-01'), endDate: d('2027-01-31'), status: 'ACTIVE', tenantId: byEmail['moussa.coulibaly@locaflow.bj'].id, landlordId: byEmail['amara.diallo@locaflow.bj'].id, propertyId: propByKey.marcory.id } },
  ];

  const contractByRef = {};
  for (const c of contracts) {
    contractByRef[c.ref.reference] = await prisma.contract.upsert({
      where: { reference: c.ref.reference },
      update: {},
      create: { ...c.ref, signedAt: c.ref.startDate }, // contrats de démo déjà signés
    });
  }
  console.log(`📄 ${Object.keys(contractByRef).length} contrats`);

  // ── PAYMENTS ─────────────────────────────────────────────
  // reference unique, période par contrat
  const payments = [
    { reference: 'PAY-2026-0847', contractRef: 'C-2026-005', amount: 185000, method: 'FeexPay', status: 'PAID', dueDate: d('2026-10-01'), paidAt: d('2026-09-28'), period: '2026-10' },
    { reference: 'PAY-2026-0846', contractRef: 'C-2026-002', amount: 380000, method: 'FedaPay', status: 'PAID', dueDate: d('2026-10-01'), paidAt: d('2026-10-01'), period: '2026-10' },
    { reference: 'PAY-2026-0845', contractRef: 'C-2026-004', amount: 320000, method: 'FeexPay', status: 'PAID', dueDate: d('2026-09-30'), paidAt: d('2026-09-30'), period: '2026-09' },
    { reference: 'PAY-2026-0844', contractRef: 'C-2026-003', amount: 450000, method: 'FedaPay', status: 'OVERDUE', dueDate: d('2026-10-01'), paidAt: null, period: '2026-10' },
    { reference: 'PAY-2026-0843', contractRef: 'C-2025-047', amount: 85000, method: 'FeexPay', status: 'PENDING', dueDate: d('2026-09-25'), paidAt: null, period: '2026-09' },
    // Historique de paiement (pour les cartes de paiement / dashboards)
    ...['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((p, i) => ({
      reference: `PAY-C001-${p}`, contractRef: 'C-2026-001', amount: 180000, method: 'FeexPay',
      status: i === 0 ? 'PENDING' : 'PAID', dueDate: d(`${p}-01`), paidAt: i === 0 ? null : d(`${p}-01`), period: p,
    })),
    ...['2026-09', '2026-10'].map((p) => ({
      reference: `PAY-C002-${p}`, contractRef: 'C-2026-002', amount: 380000, method: 'FedaPay',
      status: 'PAID', dueDate: d(`${p}-01`), paidAt: d(`${p}-01`), period: p,
    })),
    ...['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((p) => ({
      reference: `PAY-C003-${p}`, contractRef: 'C-2026-003', amount: 450000, method: 'FedaPay',
      status: 'PAID', dueDate: d(`${p}-01`), paidAt: d(`${p}-01`), period: p,
    })),
    { reference: 'PAY-C005-2026-09', contractRef: 'C-2026-005', amount: 185000, method: 'FeexPay', status: 'PAID', dueDate: d('2026-09-01'), paidAt: d('2026-08-30'), period: '2026-09' },
    { reference: 'PAY-C006-2026-10', contractRef: 'C-2026-006', amount: 250000, method: 'FedaPay', status: 'OVERDUE', dueDate: d('2026-10-01'), paidAt: null, period: '2026-10' },
    { reference: 'PAY-C007-2026-10', contractRef: 'C-2026-007', amount: 85000, method: 'FeexPay', status: 'PAID', dueDate: d('2026-10-01'), paidAt: d('2026-09-30'), period: '2026-10' },
  ];

  let created = 0;
  for (const p of payments) {
    const contract = contractByRef[p.contractRef];
    if (!contract) continue;
    const existing = await prisma.payment.findUnique({ where: { reference: p.reference } });
    if (existing) continue;
    await prisma.payment.create({
      data: {
        reference: p.reference,
        amount: p.amount,
        method: p.method,
        status: p.status,
        dueDate: p.dueDate,
        paidAt: p.paidAt,
        period: p.period,
        contractId: contract.id,
        propertyId: contract.propertyId,
        tenantId: contract.tenantId,
      },
    });
    created++;
  }
  console.log(`💳 ${created} paiements insérés`);

  // ── NOTIFICATIONS ────────────────────────────────────────
  const notifSpecs = [
    { email: 'kofi.mensah@locaflow.bj', title: 'Paiement confirmé', body: 'Votre loyer d\'octobre a bien été reçu.', type: 'payment' },
    { email: 'kofi.mensah@locaflow.bj', title: 'Rappel échéance', body: 'Échéance dans 7 jours — 185 000 FCFA.', type: 'payment' },
    { email: 'fatou.traore@locaflow.bj', title: 'Paiement en retard', body: 'Le loyer du Plateau n\'a pas été réglé.', type: 'payment' },
    { email: 'amara.diallo@locaflow.bj', title: 'Paiement reçu', body: 'Kofi Mensah a payé 185 000 FCFA.', type: 'payment' },
    { email: 'amara.diallo@locaflow.bj', title: 'Contrat bientôt expiré', body: 'C-2026-005 expire le 31/12/2026.', type: 'contract' },
    { email: 'admin@locaflow.bj', title: 'Signalement maintenance', body: 'Immeuble Tokoin passé en maintenance.', type: 'maintenance' },
  ];
  for (const n of notifSpecs) {
    const { email, ...rest } = n;
    const existing = await prisma.notification.findFirst({ where: { userId: byEmail[email].id, title: n.title } });
    if (!existing) await prisma.notification.create({ data: { ...rest, userId: byEmail[email].id } });
  }
  console.log(`🔔 Notifications par défaut créées`);

  // ── PAYMENT PROVIDERS (config propriétaire Amara) ────────
  const providers = [
    { provider: 'feexpay', name: 'FeexPay', description: 'Paiement mobile Bénin & Togo', icon: 'account_balance_wallet', enabled: true, connected: true, apiKeyMasked: 'fxp_live_••••••••••••3f8a', transactions: 142, volume: 18400000, primaryColor: '#1B6CA8' },
    { provider: 'fedapay', name: 'FedaPay', description: "Passerelle de paiement Afrique de l'Ouest", icon: 'payments', enabled: true, connected: true, apiKeyMasked: 'fdp_live_••••••••••••7c2b', transactions: 87, volume: 11200000, primaryColor: '#34C98B' },
    { provider: 'kkiapay', name: 'KKiaPay', description: 'Paiement mobile simplifié', icon: 'mobile_friendly', enabled: false, connected: false, apiKeyMasked: null, transactions: 0, volume: 0, primaryColor: '#F59E0B' },
    { provider: 'ussd', name: 'USSD', description: 'Débit mobile MTN / Moov / CELBAIR', icon: 'dialpad', enabled: true, connected: true, apiKeyMasked: 'ussd_live_••••••4d71', transactions: 23, volume: 2760000, primaryColor: '#8B5CF6' },
  ];
  const amaraId = byEmail['amara.diallo@locaflow.bj'].id;
  for (const p of providers) {
    const existing = await prisma.paymentProviderConfig.findUnique({ where: { userId_provider: { userId: amaraId, provider: p.provider } } });
    if (!existing) await prisma.paymentProviderConfig.create({ data: { ...p, userId: amaraId } });
  }
  console.log(`🏦 Providers de paiement configurés`);

  console.log('✅ Seed terminé.');
}

main()
  .catch((e) => { console.error('❌ Seed erreur:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
