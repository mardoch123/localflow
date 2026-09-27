/** Enveloppe les handlers async pour propager les erreurs vers Express */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
