import jwt from 'jsonwebtoken';
import { config, prisma } from '../config.js';

/** Vérifie le JWT (Authorization: Bearer <token>) et attache req.user */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token manquant' });

    const payload = jwt.verify(token, config.jwtSecret);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, status: true, printerWidth: true, autoPrintReceipt: true },
    });
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
    if (user.status !== 'ACTIVE') return res.status(403).json({ error: 'Compte suspendu' });

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

/** Restreint l'accès à certains rôles (à placer après requireAuth) */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  };
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}
