export function createRateLimiter({ windowMs, maxAttempts, keyGenerator, resetOnSuccess = false }) {
  const attemptsByKey = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator(req);
    const recentAttempts = (attemptsByKey.get(key) || [])
      .filter(timestamp => now - timestamp < windowMs);

    if (recentAttempts.length >= maxAttempts) {
      const retryAfterSeconds = Math.ceil((windowMs - (now - recentAttempts[0])) / 1000);
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: 'Demasiados intentos. Intenta nuevamente más tarde.',
      });
    }

    recentAttempts.push(now);
    attemptsByKey.set(key, recentAttempts);

    if (resetOnSuccess) {
      res.once('finish', () => {
        if (res.statusCode < 400) {
          attemptsByKey.delete(key);
        }
      });
    }

    return next();
  };
}
