export class ExternalServiceError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export class ExpiringCache {
  constructor({ ttlMs, maxEntries = 500, now = () => Date.now() }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.values = new Map();
  }

  async getOrLoad(key, loader) {
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return { data: cached.data, cached: true };
    }

    this.values.delete(key);
    if (this.values.size >= this.maxEntries) {
      const oldestKey = this.values.keys().next().value;
      this.values.delete(oldestKey);
    }

    const data = await loader();
    this.values.set(key, { data, expiresAt: this.now() + this.ttlMs });
    return { data, cached: false };
  }
}

export async function fetchJsonWithTimeout(url, { timeoutMs = 8000 } = {}) {
  let response;

  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new ExternalServiceError('El servicio externo tardó demasiado en responder', 504);
    }
    throw new ExternalServiceError('No fue posible conectar con el servicio externo');
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new ExternalServiceError('El servicio externo alcanzó su límite de solicitudes', 429);
    }
    throw new ExternalServiceError('El servicio externo no pudo procesar la solicitud');
  }

  try {
    return await response.json();
  } catch {
    throw new ExternalServiceError('El servicio externo devolvió una respuesta inválida');
  }
}
