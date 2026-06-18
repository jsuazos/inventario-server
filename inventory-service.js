const INVENTARIO_FETCH_TIMEOUT_MS = parseInt(process.env.INVENTARIO_FETCH_TIMEOUT_MS || '15000', 10);
const INVENTARIO_CACHE_TTL_MS = parseInt(process.env.INVENTARIO_CACHE_TTL_MS || '300000', 10);

let inventarioCache = {
  fetchedAt: 0,
  rawData: null,
  publicData: null,
};

let inventarioInFlightPromise = null;

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
    rawItems
      .filter(item => item.Visible === 'SI')
      .map(normalizeInventarioItem)
  );
}

export function getInventarioUrl() {
  return `https://script.google.com/macros/s/${process.env.SECRET_TOKEN_INVENTARIO}/exec?path=INVENTARIO&action=read`;
}

export async function fetchInventarioFromSource() {
  const response = await fetch(getInventarioUrl(), {
    signal: AbortSignal.timeout(INVENTARIO_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Inventario upstream HTTP ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.data) ? data.data : [];
}

export async function getInventarioData({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && inventarioCache.rawData && now - inventarioCache.fetchedAt < INVENTARIO_CACHE_TTL_MS) {
    return inventarioCache;
  }

  if (!forceRefresh && inventarioInFlightPromise) {
    return inventarioInFlightPromise;
  }

  inventarioInFlightPromise = (async () => {
    try {
      const rawData = await fetchInventarioFromSource();
      inventarioCache = {
        fetchedAt: Date.now(),
        rawData,
        publicData: buildPublicInventario(rawData),
      };

      return inventarioCache;
    } catch (error) {
      if (inventarioCache.rawData) {
        console.warn('Usando cache stale de inventario por error upstream:', error.message);
        return inventarioCache;
      }

      throw error;
    } finally {
      inventarioInFlightPromise = null;
    }
  })();

  return inventarioInFlightPromise;
}
