import app from './app.js';
import { config, prisma } from './config.js';

const server = app.listen(config.port, () => {
  console.log(`🚀 LocaFlow API prête sur http://localhost:${config.port}/api`);
});

// Arrêt propre
async function shutdown(signal) {
  console.log(`\n${signal} reçu, arrêt en cours…`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
