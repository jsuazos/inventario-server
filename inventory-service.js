import * as inventoryStore from './inventory-store.js';

let cache = {
  fetchedAt: 0,
  rawData: null,
  publicData: null,
};

let inFlight = null;

export function invalidateInventarioCache() {
  cache = { fetchedAt: 0, rawData: null, publicData: null };
  inFlight = null;
}

export function normalizeInventarioItem(item = {}) {
  return {
    ID: item.ID || '',
    Artista: item.Artista || '',
    Disco: item.Disco || '',
    Año: item.Año || '',
    Genero: item.Genero || '',
    Tipo: item.Tipo || '',
    Recibido: item.Recibido || '',
    img: item.img || '',
    imgFULL: item.imgFULL || '',
    Visible: item.Visible || '',
    Orden: item.Orden || '',
    Origen: item.Origen || '',
    OrigenISO: item.OrigenISO || '',
  };
}

export function sortInventario(items) {
  return [...items].sort((a, b) => {
    const claveA = `${a.Artista || ''} ${a.Año || ''} ${a.Disco || ''} ${a.Recibido || ''}`.toLowerCase();
    const claveB = `${b.Artista || ''} ${b.Año || ''} ${b.Disco || ''} ${b.Recibido || ''}`.toLowerCase();
    return claveA.localeCompare(claveB);
  });
}

export function buildPublicInventario(rawItems) {
  return sortInventario(
    rawItems.filter(item => item.Visible === 'SI').map(normalizeInventarioItem)
  );
}

export async function getInventarioData({ forceRefresh = false } = {}) {
  const now = Date.now();
  const CACHE_TTL_MS = 300000;

  if (!forceRefresh && cache.rawData && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  if (!forceRefresh && inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      const rawData = await inventoryStore.getAll();
      cache = {
        fetchedAt: Date.now(),
        rawData,
        publicData: buildPublicInventario(rawData),
      };
      return cache;
    } catch (error) {
      if (cache.rawData) {
        console.warn('Usando cache stale por error:', error.message);
        return cache;
      }
      throw error;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
