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
import { supabase } from './db.js';
import * as inventoryStore from './inventory-store.js';
import { createPayload, sendPushBroadcast } from './push-notification-service.js';
import { start as startBackgroundCheck } from './background-check.js';
import { createRateLimiter } from './rate-limit.js';
import { ExpiringCache, ExternalServiceError, fetchJsonWithTimeout } from './external-service.js';
import { getCookieValue, getSessionCookieOptions, SESSION_COOKIE_NAME } from './session-cookie.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();

const PORT = process.env.PORT || 3000;
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://jsuazos.github.io',
];
const allowedOrigins = new Set(
  (process.env.ALLOWED_PUBLIC_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json());

const UNSAFE_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (UNSAFE_HTTP_METHODS.has(req.method) && origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }

  return next();
});


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
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';
const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE !== 'false';
const DEFAULT_SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const configuredSessionCookieMaxAgeMs = Number(process.env.SESSION_COOKIE_MAX_AGE_MS);
const SESSION_COOKIE_MAX_AGE_MS = Number.isFinite(configuredSessionCookieMaxAgeMs) && configuredSessionCookieMaxAgeMs > 0
  ? configuredSessionCookieMaxAgeMs
  : DEFAULT_SESSION_COOKIE_MAX_AGE_MS;
const sessionCookieOptions = getSessionCookieOptions({
  secure: SESSION_COOKIE_SECURE,
  maxAgeMs: SESSION_COOKIE_MAX_AGE_MS,
});
const loginIpRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxAttempts: 20,
  keyGenerator: req => `login-ip:${req.ip}`,
});
const loginAccountRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxAttempts: 5,
  keyGenerator: req => `login-account:${req.ip}:${String(req.body?.usuario || '').trim().toLowerCase()}`,
  resetOnSuccess: true,
});
const registerRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxAttempts: 5,
  keyGenerator: req => `register-ip:${req.ip}`,
});
const externalApiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxAttempts: 60,
  keyGenerator: req => `external-api:${req.ip}`,
});
const adminUsers = new Set(
  (process.env.ADMIN_USERS || '')
    .split(',')
    .map(usuario => usuario.trim())
    .filter(Boolean)
);
const artistsCache = new ExpiringCache({ ttlMs: 30 * 60 * 1000 });
const fanartCache = new ExpiringCache({ ttlMs: 6 * 60 * 60 * 1000 });
const discogsSearchCache = new ExpiringCache({ ttlMs: 5 * 60 * 1000 });
const discogsReleaseCache = new ExpiringCache({ ttlMs: 24 * 60 * 60 * 1000 });

webpush.setVapidDetails(
  'mailto:push@inventario-musica.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'inventario-server', timestamp: new Date().toISOString() });
});

function getRequestToken(req) {
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice('Bearer '.length)
    : null;
  const cookieToken = getCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
  return cookieToken || headerToken;
}

function authMiddleware(req, res, next) {
  const token = getRequestToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function adminMiddleware(req, res, next) {
  if (!adminUsers.has(req.user?.usuario)) {
    return res.status(403).json({ error: 'Se requieren permisos de administrador' });
  }

  next();
}

// --- Auth ---

async function findUser(usuario) {
  const { data } = await supabase
    .from('users')
    .select('usuario, hash')
    .eq('usuario', usuario)
    .maybeSingle();

  if (data) return data;

  const usuariosJSON = process.env.USUARIOS_JSON;
  if (usuariosJSON) {
    const usuarios = JSON.parse(usuariosJSON);
    return usuarios.find(u => u.usuario === usuario) || null;
  }

  return null;
}

app.post('/api/login', loginIpRateLimiter, loginAccountRateLimiter, async (req, res) => {
  const usuario = typeof req.body?.usuario === 'string' ? req.body.usuario.trim() : '';
  const contrasena = typeof req.body?.contrasena === 'string' ? req.body.contrasena : '';

  if (!usuario || !contrasena) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  try {
    const user = await findUser(usuario);

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
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions);
    res.json({ usuario: user.usuario });

  } catch (error) {
    console.error('Error al procesar login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/login/verify', (req, res) => {
  const token = getRequestToken(req);
  if (!token) {
    return res.json({ valido: false });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({ valido: true, usuario: decoded.usuario });
  } catch {
    return res.json({ valido: false });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: SESSION_COOKIE_SECURE,
    sameSite: SESSION_COOKIE_SECURE ? 'none' : 'lax',
    path: '/',
  });
  res.json({ ok: true });
});

app.post('/api/register', registerRateLimiter, async (req, res) => {
  const usuario = typeof req.body?.usuario === 'string' ? req.body.usuario.trim() : '';
  const contrasena = typeof req.body?.contrasena === 'string' ? req.body.contrasena : '';

  if (!usuario || !contrasena) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  if (usuario.length < 3 || usuario.length > 32) {
    return res.status(400).json({ error: 'El usuario debe tener entre 3 y 32 caracteres' });
  }

  if (contrasena.length < 10 || contrasena.length > 128) {
    return res.status(400).json({ error: 'La contraseña debe tener entre 10 y 128 caracteres' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(usuario)) {
    return res.status(400).json({ error: 'El usuario solo puede contener letras, números y guión bajo' });
  }

  try {
    const existing = await findUser(usuario);
    if (existing) {
      return res.status(409).json({ error: 'El usuario ya existe' });
    }

    const hash = await bcrypt.hash(contrasena, 10);

    const { error } = await supabase.from('users').insert({
      usuario,
      hash,
    });

    if (error) {
      console.error('Error al crear usuario en Supabase:', error.message);
      return res.status(500).json({ error: 'Error al crear usuario' });
    }

    const token = jwt.sign(
      { usuario },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions);
    res.status(201).json({ usuario });

  } catch (error) {
    console.error('Error al registrar:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// --- Inventario (solo autenticado, multi-usuario) ---

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

app.get('/api/inventario/ocultos', authMiddleware, async (req, res) => {
  try {
    const items = await inventoryStore.getHidden(req.user.usuario);
    res.json({ data: items, meta: { count: items.length } });
  } catch (error) {
    console.error('Error al consultar inventario oculto:', error);
    res.status(500).json({ error: 'Error al consultar inventario oculto' });
  }
});

// --- Artistas (Google Apps Script proxy - se mantiene) ---

function getQueryString(value, { minLength = 1, maxLength = 120 } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length < minLength || normalized.length > maxLength) {
    return null;
  }
  return normalized;
}

function sendExternalServiceError(res, error) {
  if (error instanceof ExternalServiceError) {
    return res.status(error.status).json({ error: error.message });
  }

  console.error('Error inesperado en proxy externo:', error);
  return res.status(502).json({ error: 'Error al consultar el servicio externo' });
}

async function respondFromCache(res, cache, key, loader, maxAgeSeconds) {
  const { data, cached } = await cache.getOrLoad(key, loader);
  res.set('Cache-Control', `public, max-age=${maxAgeSeconds}`);
  res.set('X-Cache', cached ? 'HIT' : 'MISS');
  res.json(data);
}

app.get('/api/artistas', externalApiRateLimiter, async (req, res) => {
  if (!process.env.SECRET_TOKEN_INVENTARIO) {
    return res.status(500).json({ error: 'SECRET_TOKEN_INVENTARIO no configurado' });
  }

  const url = `https://script.google.com/macros/s/${process.env.SECRET_TOKEN_INVENTARIO}/exec?path=ARTISTAS&action=read`;

  try {
    await respondFromCache(
      res,
      artistsCache,
      'artists',
      () => fetchJsonWithTimeout(url),
      1800
    );
  } catch (error) {
    console.error('Error al consultar Artistas:', error.message);
    sendExternalServiceError(res, error);
  }
});

// --- Fanart ---

app.get('/api/fanart', externalApiRateLimiter, async (req, res) => {
  const artistMbId = getQueryString(req.query.mbid, { minLength: 36, maxLength: 36 });
  if (!artistMbId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(artistMbId)) {
    return res.status(400).json({ error: 'El parámetro mbid no es válido' });
  }

  const url = `https://webservice.fanart.tv/v3/music/${artistMbId}?api_key=${process.env.FANART_API_KEY}`;

  try {
    await respondFromCache(
      res,
      fanartCache,
      `fanart:${artistMbId.toLowerCase()}`,
      () => fetchJsonWithTimeout(url),
      21600
    );
  } catch (error) {
    console.error('Error al consultar Fanart.tv:', error.message);
    sendExternalServiceError(res, error);
  }
});

// --- Discogs ---

app.get('/api/discogs', externalApiRateLimiter, async (req, res) => {
  const query = getQueryString(req.query.q, { minLength: 2, maxLength: 120 });
  if (!query) return res.status(400).json({ error: 'El parámetro q debe tener entre 2 y 120 caracteres' });

  const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&token=${process.env.DISCOGS_TOKEN}`;

  try {
    await respondFromCache(
      res,
      discogsSearchCache,
      `discogs:search:${query.toLocaleLowerCase('es')}`,
      () => fetchJsonWithTimeout(url),
      300
    );
  } catch (error) {
    console.error('Error en Discogs:', error.message);
    sendExternalServiceError(res, error);
  }
});

app.get('/api/discogs/release/:id', externalApiRateLimiter, async (req, res) => {
  const releaseId = getQueryString(req.params.id, { minLength: 1, maxLength: 12 });
  if (!releaseId || !/^\d+$/.test(releaseId)) return res.status(400).json({ error: 'Falta un ID de release válido' });

  const url = `https://api.discogs.com/releases/${encodeURIComponent(releaseId)}?token=${process.env.DISCOGS_TOKEN}`;

  try {
    await respondFromCache(
      res,
      discogsReleaseCache,
      `discogs:release:${releaseId}`,
      () => fetchJsonWithTimeout(url),
      86400
    );
  } catch (error) {
    console.error('Error en Discogs release:', error.message);
    sendExternalServiceError(res, error);
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
    res.json({ ok: true, item: saved });
  } catch (error) {
    if (error.code === 'INVENTORY_DUPLICATE') {
      return res.status(409).json({ error: error.message });
    }
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
      return res.status(403).json({ error: 'No puedes editar un disco que no te pertenece' });
    }

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
      return res.status(403).json({ error: 'No puedes modificar un disco que no te pertenece' });
    }

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
      return res.status(403).json({ error: 'No puedes eliminar un disco que no te pertenece' });
    }

    res.json({ ok: true, item: removed });
  } catch (error) {
    console.error('Error ocultando inventario:', error);
    res.status(500).json({ error: 'Error ocultando inventario' });
  }
});

app.patch('/api/inventario/restaurar', authMiddleware, async (req, res) => {
  try {
    const { originalItem } = req.body || {};
    if (!originalItem) {
      return res.status(400).json({ error: 'Falta el item original de inventario' });
    }

    const restored = await inventoryStore.restore(originalItem, req.user.usuario);
    if (!restored) {
      return res.status(403).json({ error: 'No puedes restaurar un disco que no te pertenece' });
    }

    res.json({ ok: true, item: restored });
  } catch (error) {
    console.error('Error restaurando inventario:', error);
    res.status(500).json({ error: 'Error al restaurar inventario' });
  }
});

// --- Wishlist (solo autenticado, propia) ---

app.get('/api/wishlist/me', authMiddleware, async (req, res) => {
  try {
    const items = await wishlistStore.getByUser(req.user.usuario);
    res.json({ usuario: req.user.usuario, items });
  } catch (error) {
    console.error('Error al consultar wishlist propia:', error);
    res.status(500).json({ error: 'Error al consultar wishlist propia' });
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
      return res.status(403).json({ error: 'No puedes editar un elemento de wishlist que no te pertenece' });
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
    if (!removed) {
      return res.status(403).json({ error: 'No puedes eliminar un elemento de wishlist que no te pertenece' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Error quitando de wishlist:', error);
    res.status(500).json({ error: 'Error quitando de wishlist' });
  }
});

// --- Push notifications ---

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Suscripción inválida' });
  }
  try {
    await pushStore.add(subscription, req.user.usuario);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error guardando suscripción push:', error);
    res.status(500).json({ error: 'Error al guardar suscripción push' });
  }
});

app.delete('/api/push/subscribe', authMiddleware, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: 'Falta endpoint' });
  }
  try {
    const removed = await pushStore.remove(endpoint, req.user.usuario);
    if (!removed) {
      return res.status(404).json({ error: 'Suscripción no encontrada' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Error eliminando suscripción push:', error);
    res.status(500).json({ error: 'Error al eliminar suscripción push' });
  }
});

let lastNotifyTime = 0;
const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;

app.post('/api/push/notify', authMiddleware, adminMiddleware, async (req, res) => {
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
    endpoint => pushStore.removeAny(endpoint)
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

app.get('/api/push/subscriptions', authMiddleware, adminMiddleware, async (req, res) => {
  const subs = await pushStore.getAll();
  res.json({ count: subs.length });
});

app.get('/api/push/check-sheet', authMiddleware, adminMiddleware, async (req, res) => {
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
