import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import webpush from 'web-push';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pushStore from './sheets-store.js';
import * as wishlistStore from './wishlist-store.js';
import * as inventoryStore from './inventory-store.js';
import { getInventarioData, invalidateInventarioCache } from './inventory-service.js';
import { createPayload, sendPushBroadcast } from './push-notification-service.js';
import { start as startBackgroundCheck } from './background-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PUBLIC_INVENTARIO_RATE_LIMIT = parseInt(process.env.PUBLIC_INVENTARIO_RATE_LIMIT || '60', 10);
const PUBLIC_INVENTARIO_RATE_WINDOW_MS = parseInt(process.env.PUBLIC_INVENTARIO_RATE_WINDOW_MS || '60000', 10);
const ALLOWED_PUBLIC_ORIGINS = (process.env.ALLOWED_PUBLIC_ORIGINS || [
  'https://jsuazos.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
].join(',')).split(',').map(origin => origin.trim()).filter(Boolean);

const publicInventoryRateMap = new Map();

const REQUIRED_ENV_VARS = [
  'JWT_SECRET',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
];

for (const envVar of REQUIRED_ENV_VARS) {
  if (!process.env[envVar]) {
    throw new Error(`Falta variable de entorno requerida: ${envVar}`);
  }
}

const JWT_SECRET = process.env.JWT_SECRET;

webpush.setVapidDetails(
  'mailto:push@inventario-musica.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'inventario-server', timestamp: new Date().toISOString() });
});

function originAllowed(value = '') {
  if (!value) return false;
  try {
    return ALLOWED_PUBLIC_ORIGINS.includes(new URL(value).origin);
  } catch {
    return false;
  }
}

function publicInventarioAccessMiddleware(req, res, next) {
  const origin = req.get('origin') || '';
  const referer = req.get('referer') || '';

  if (!originAllowed(origin) && !originAllowed(referer)) {
    return res.status(403).json({ error: 'Acceso no permitido' });
  }

  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const current = publicInventoryRateMap.get(ip);

  if (!current || now - current.startedAt > PUBLIC_INVENTARIO_RATE_WINDOW_MS) {
    publicInventoryRateMap.set(ip, { count: 1, startedAt: now });
    return next();
  }

  if (current.count >= PUBLIC_INVENTARIO_RATE_LIMIT) {
    return res.status(429).json({ error: 'Demasiadas solicitudes' });
  }

  current.count += 1;
  next();
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// --- Auth ---

app.post('/api/login', async (req, res) => {
  const { usuario, contrasena } = req.body;

  if (!usuario || !contrasena) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  try {
    const usuariosJSON = process.env.USUARIOS_JSON;
    if (!usuariosJSON) {
      return res.status(500).json({ error: 'Configuración inválida del servidor' });
    }

    const usuarios = JSON.parse(usuariosJSON);
    const user = usuarios.find(u => u.usuario === usuario);

    if (!user || !user.hash) {
      return res.status(401).json({ error: 'Usuario o contraseña inválidos' });
    }

    const esValida = await bcrypt.compare(contrasena, user.hash);
    if (!esValida) {
      return res.status(401).json({ error: 'Usuario o contraseña inválidos' });
    }

    const token = jwt.sign(
      { usuario: user.usuario },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, usuario: user.usuario });

  } catch (error) {
    console.error('Error al procesar login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/login/verify', authMiddleware, (req, res) => {
  res.json({ valido: true, usuario: req.user.usuario });
});

// --- Inventario público (todos los usuarios, solo visible) ---

app.get('/api/inventario-public', publicInventarioAccessMiddleware, async (req, res) => {
  try {
    const usuario = req.query.usuario || null;
    const items = await inventoryStore.getAll(usuario);
    const publicData = items.filter(item => item.Visible === 'SI').map(item => ({
      ID: item.ID,
      Artista: item.Artista,
      Disco: item.Disco,
      Año: item.Año,
      Genero: item.Genero,
      Tipo: item.Tipo,
      Recibido: item.Recibido,
      img: item.img,
      imgFULL: item.imgFULL,
      Orden: item.Orden,
      Origen: item.Origen,
      OrigenISO: item.OrigenISO,
    }));

    res.json({
      data: publicData,
      meta: {
        source: 'supabase',
        cached: false,
        fetchedAt: new Date().toISOString(),
        count: publicData.length,
      },
    });
  } catch (error) {
    console.error('Error al consultar inventario público:', error);
    res.status(500).json({ error: 'Error al consultar inventario público' });
  }
});

// --- Inventario privado (usuario autenticado) ---

app.get('/api/inventario', authMiddleware, async (req, res) => {
  try {
    const items = await inventoryStore.getAll(req.user.usuario);

    res.json({
      data: items,
      meta: {
        cached: false,
        fetchedAt: new Date().toISOString(),
        count: items.length,
      },
    });
  } catch (error) {
    console.error('Error al consultar inventario:', error);
    res.status(500).json({ error: 'Error al consultar inventario' });
  }
});

// --- Artistas (Google Apps Script proxy - se mantiene) ---

app.get('/api/artistas', async (req, res) => {
  if (!process.env.SECRET_TOKEN_INVENTARIO) {
    return res.status(500).json({ error: 'SECRET_TOKEN_INVENTARIO no configurado' });
  }

  const url = `https://script.google.com/macros/s/${process.env.SECRET_TOKEN_INVENTARIO}/exec?path=ARTISTAS&action=read`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error al consultar Artistas:', error);
    res.status(500).json({ error: 'Error al consultar Artistas' });
  }
});

// --- Fanart ---

app.get('/api/fanart', async (req, res) => {
  const artistMbId = req.query.mbid;
  if (!artistMbId) return res.status(400).json({ error: 'Falta el parámetro mbid' });

  const url = `https://webservice.fanart.tv/v3/music/${artistMbId}?api_key=${process.env.FANART_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error al consultar Fanart.tv:', error);
    res.status(500).json({ error: 'Error al consultar Fanart.tv' });
  }
});

// --- Discogs ---

app.get('/api/discogs', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Falta el parámetro q' });

  const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&token=${process.env.DISCOGS_TOKEN}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error en Discogs:', error);
    res.status(500).json({ error: 'Error al consultar Discogs' });
  }
});

app.get('/api/discogs/release/:id', async (req, res) => {
  const releaseId = String(req.params.id || '').replace(/^[^0-9]+/, '').trim();
  if (!releaseId) return res.status(400).json({ error: 'Falta un ID de release válido' });

  const url = `https://api.discogs.com/releases/${encodeURIComponent(releaseId)}?token=${process.env.DISCOGS_TOKEN}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error en Discogs release:', error);
    res.status(500).json({ error: 'Error al consultar release en Discogs' });
  }
});

// --- CRUD Inventario (requieren auth, multi-usuario) ---

app.post('/api/inventario', authMiddleware, async (req, res) => {
  try {
    const item = req.body || {};
    if (!item.Artista || !item.Disco) {
      return res.status(400).json({ error: 'Datos de inventario inválidos' });
    }

    const saved = await inventoryStore.add(item, req.user.usuario);
    invalidateInventarioCache();
    res.json({ ok: true, item: saved });
  } catch (error) {
    console.error('Error agregando a inventario:', error);
    res.status(500).json({ error: 'Error agregando a inventario' });
  }
});

app.put('/api/inventario', authMiddleware, async (req, res) => {
  try {
    const { originalItem, item } = req.body || {};
    if (!originalItem || !item || !item.Artista || !item.Disco) {
      return res.status(400).json({ error: 'Datos de edición de inventario inválidos' });
    }

    const updated = await inventoryStore.update(originalItem, item, req.user.usuario);
    if (!updated) {
      return res.status(404).json({ error: 'Elemento de inventario no encontrado' });
    }

    invalidateInventarioCache();
    res.json({ ok: true, item: updated });
  } catch (error) {
    console.error('Error editando inventario:', error);
    res.status(500).json({ error: 'Error editando inventario' });
  }
});

app.patch('/api/inventario/recibido', authMiddleware, async (req, res) => {
  try {
    const { originalItem } = req.body || {};
    if (!originalItem) {
      return res.status(400).json({ error: 'Falta el item original de inventario' });
    }

    const updated = await inventoryStore.markReceived(originalItem, req.user.usuario);
    if (!updated) {
      return res.status(404).json({ error: 'Elemento de inventario no encontrado' });
    }

    invalidateInventarioCache();
    res.json({ ok: true, item: updated });
  } catch (error) {
    console.error('Error marcando inventario como recibido:', error);
    res.status(500).json({ error: 'Error marcando inventario como recibido' });
  }
});

app.delete('/api/inventario', authMiddleware, async (req, res) => {
  try {
    const { originalItem } = req.body || {};
    if (!originalItem) {
      return res.status(400).json({ error: 'Falta el item original de inventario' });
    }

    const removed = await inventoryStore.softRemove(originalItem, req.user.usuario);
    if (!removed) {
      return res.status(404).json({ error: 'Elemento de inventario no encontrado' });
    }

    invalidateInventarioCache();
    res.json({ ok: true, item: removed });
  } catch (error) {
    console.error('Error ocultando inventario:', error);
    res.status(500).json({ error: 'Error ocultando inventario' });
  }
});

// --- Wishlist ---

app.get('/api/wishlist-users', async (req, res) => {
  try {
    const users = await wishlistStore.getUsers();
    res.json({ users });
  } catch (error) {
    console.error('Error al consultar usuarios con wishlist:', error);
    res.status(500).json({ error: 'Error al consultar usuarios con wishlist' });
  }
});

app.get('/api/wishlist/me', authMiddleware, async (req, res) => {
  try {
    const items = await wishlistStore.getByUser(req.user.usuario);
    res.json({ usuario: req.user.usuario, items });
  } catch (error) {
    console.error('Error al consultar wishlist propia:', error);
    res.status(500).json({ error: 'Error al consultar wishlist propia' });
  }
});

app.get('/api/wishlist/:usuario', async (req, res) => {
  try {
    const items = await wishlistStore.getByUser(req.params.usuario);
    res.json({ usuario: req.params.usuario, items });
  } catch (error) {
    console.error('Error al consultar wishlist pública:', error);
    res.status(500).json({ error: 'Error al consultar wishlist pública' });
  }
});

app.post('/api/wishlist', authMiddleware, async (req, res) => {
  try {
    const item = req.body || {};
    if (!item.Artista || !item.Disco) {
      return res.status(400).json({ error: 'Datos de wishlist inválidos' });
    }

    const saved = await wishlistStore.add(req.user.usuario, item);
    res.json({ ok: true, item: saved });
  } catch (error) {
    console.error('Error agregando a wishlist:', error);
    res.status(500).json({ error: 'Error agregando a wishlist' });
  }
});

app.put('/api/wishlist/:rowId', authMiddleware, async (req, res) => {
  try {
    const item = req.body || {};
    if (!item.Artista || !item.Disco) {
      return res.status(400).json({ error: 'Datos de wishlist inválidos' });
    }

    const updated = await wishlistStore.update(req.user.usuario, req.params.rowId, item);
    if (!updated) {
      return res.status(404).json({ error: 'Elemento de wishlist no encontrado' });
    }

    res.json({ ok: true, item: updated });
  } catch (error) {
    console.error('Error editando wishlist:', error);
    res.status(500).json({ error: 'Error editando wishlist' });
  }
});

app.delete('/api/wishlist/:rowId', authMiddleware, async (req, res) => {
  try {
    const removed = await wishlistStore.remove(req.user.usuario, req.params.rowId);
    res.json({ ok: removed });
  } catch (error) {
    console.error('Error quitando de wishlist:', error);
    res.status(500).json({ error: 'Error quitando de wishlist' });
  }
});

// --- Push notifications ---

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', async (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Suscripción inválida' });
  }
  await pushStore.add(subscription);
  res.json({ ok: true });
});

app.delete('/api/push/subscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: 'Falta endpoint' });
  }
  await pushStore.remove(endpoint);
  res.json({ ok: true });
});

let lastNotifyTime = 0;
const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;

app.post('/api/push/notify', async (req, res) => {
  const { title, body, data } = req.body;
  const now = Date.now();
  if (now - lastNotifyTime < NOTIFY_COOLDOWN_MS) {
    return res.json({ ok: true, skipped: true, reason: 'cooldown' });
  }

  const payload = createPayload({ title, body, data });

  const subscriptions = await pushStore.getAll();
  if (subscriptions.length === 0) {
    return res.json({ ok: true, sent: 0 });
  }

  const broadcast = await sendPushBroadcast(
    subscriptions,
    payload,
    endpoint => pushStore.remove(endpoint)
  );

  if (broadcast.sent > 0) {
    lastNotifyTime = now;
  }

  broadcast.results
    .filter(result => !result.ok)
    .forEach(result => {
      console.error(`Error sending to ${result.endpoint}:`, result.error);
    });

  console.log(`Push broadcast: ${broadcast.sent}/${subscriptions.length} sent (${broadcast.failed} failed)`);
  res.json({ ok: true, sent: broadcast.sent, failed: broadcast.failed });
});

app.get('/api/push/subscriptions', authMiddleware, async (req, res) => {
  const subs = await pushStore.getAll();
  res.json({ count: subs.length, subscriptions: subs });
});

app.get('/api/push/check-sheet', async (req, res) => {
  const result = {
    config: {
      supabaseUrl: !!process.env.SUPABASE_URL,
      supabaseServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
    },
    sheetStatus: 'unknown',
    subscriptions: 0,
    details: null,
    error: null,
  };

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    result.sheetStatus = 'missing Supabase config';
    return res.json(result);
  }

  try {
    const details = await pushStore.diagnose();
    result.details = details;
    result.subscriptions = details.subscriptionsCount || 0;
    result.sheetStatus = 'ok';
  } catch (err) {
    result.sheetStatus = 'error';
    result.error = err.message;
  }

  res.json(result);
});

app.listen(PORT, () => {
  console.log(`Servidor proxy corriendo en http://localhost:${PORT}`);
  startBackgroundCheck();
});
