// Génère sql/seed.sql (INSERT idempotents ON CONFLICT DO NOTHING)
// à partir des données réellement présentes dans la base Neon.
// Usage : node scripts/dump-seed-sql.js
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const cols = (o) => Object.keys(o);
const vals = (o) => cols(o).map((k) => q(o[k])).join(', ');

async function table(name, rows, colList) {
  if (rows.length === 0) return `-- ${name}: aucune donnée\n`;
  const conflicts = {
    User: 'email', Property: 'id', Contract: 'reference',
    Payment: 'reference', Notification: 'id', PaymentProviderConfig: 'id',
  }[name] || 'id';
  const header = `INSERT INTO "${name}" (${colList.map((c) => `"${c}"`).join(', ')}) VALUES\n`;
  const body = rows
    .map((r) => `  (${colList.map((c) => q(r[c])).join(', ')})`)
    .join(',\n');
  const tail = `\nON CONFLICT ("${conflicts}") DO NOTHING;\n`;
  return `-- ${name} (${rows.length} lignes)\n${header}${body}${tail}\n`;
}

async function main() {
  const [users, properties, contracts, payments, notifications, providers] =
    await Promise.all([
      prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.property.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.contract.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.payment.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.notification.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.paymentProviderConfig.findMany({ orderBy: { createdAt: 'asc' } }),
    ]);

  let sql = `-- ═══════════════════════════════════════════════════════════════
-- LocaFlow - Seed SQL (données de démonstration)
-- Exporté depuis la base Neon active le ${new Date().toISOString()}
-- Prérequis : exécuter d'abord schema.sql
-- Idempotent : ON CONFLICT DO NOTHING
-- ═══════════════════════════════════════════════════════════════

BEGIN;

`;
  sql += await table('User', users, cols(users[0] || {}));
  sql += await table('Property', properties, cols(properties[0] || {}));
  sql += await table('Contract', contracts, cols(contracts[0] || {}));
  sql += await table('Payment', payments, cols(payments[0] || {}));
  sql += await table('Notification', notifications, cols(notifications[0] || {}));
  sql += await table('PaymentProviderConfig', providers, cols(providers[0] || {}));
  sql += 'COMMIT;\n';

  const out = path.join(__dirname, '..', 'sql', 'seed.sql');
  writeFileSync(out, sql, 'utf8');
  console.log(`✅ ${out} écrit (${users.length} users, ${properties.length} props, ${contracts.length} contrats, ${payments.length} paiements)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
