// Point d'entrée serverless Vercel.
// L'app Express (src/app.js) gère déjà tous les chemins sous /api ;
// vercel.json route TOUTES les requêtes vers cette fonction en préservant
// l'URL d'origine, donc Express reçoit /api/health, /api/auth, etc.
import app from '../src/app.js';

export default app;
