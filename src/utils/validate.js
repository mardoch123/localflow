// Validation stricte des entrées — réutilisable dans toutes les routes.

export const isEmail = (v) =>
  typeof v === 'string' &&
  v.length <= 160 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export const isStr = (v, { min = 1, max = 255 } = {}) =>
  typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;

export const isInt = (v, { min = 0, max = 1_000_000_000_000 } = {}) => {
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) && n >= min && n <= max;
};

export const isOneOf = (v, list) => list.includes(v);

export const isDate = (v) => v != null && !Number.isNaN(new Date(v).getTime());

/**
 * Valide une liste de règles [valeur, booléenValide, messageErreur].
 * Retourne la liste des messages invalides (vide ⇒ tout est bon).
 */
export function collectErrors(...rules) {
  return rules.filter(([, ok]) => !ok).map(([, , msg]) => msg).filter(Boolean);
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
// USSD : débit mobile — activable par le propriétaire comme les autres providers.
// 'espece' n'est PAS listé ici : seul le propriétaire peut l'encaisser (route cash).
export const PAYMENT_METHODS = ['feexpay', 'fedapay', 'kkiapay', 'ussd'];

// Commission plateforme : 1 % de chaque loyer encaissé, à la charge du propriétaire.
export const COMMISSION_RATE = 0.01;
export const commissionOf = (amount) => Math.round(Number(amount) * COMMISSION_RATE);

// Largeurs d'imprimante thermique acceptées pour le ticket de caisse.
export const PRINTER_WIDTHS = ['58mm', '80mm'];

/** Normalise une méthode de paiement ('FeexPay' → 'feexpay'). */
export const normalizeMethod = (v) =>
  typeof v === 'string' ? v.trim().toLowerCase() : null;
