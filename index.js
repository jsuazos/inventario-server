import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import webpush from 'web-push';
import * as pushStore from './sheets-store.js';
import { start as startBackgroundCheck } from './background-check.js';

dotenv.config();

webpush.setVapidDetails(
  'mailto:push@inventario-musica.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'inventario-server', timestamp: new Date().toISOString() });
});

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

app.post('/api/login', async (req, res) => {
  const { usuario, contrasena } = req.body;

  if (!usuario || !contrasena) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  try {
    const usuariosJSON = process.env.USUARIOS_JSON;
    if (!usuariosJSON) {
      console.error('USUARIOS_JSON no está definido en variables de entorno');
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

app.get('/api/inventario', async (req, res) => {
  const url = `https://script.google.com/macros/s/${process.env.SECRET_TOKEN_INVENTARIO}/exec?path=INVENTARIO&action=read`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error al consultar Inventario:', error);
    res.status(500).json({ error: 'Error al consultar Inventario' });
  }
});

app.get('/api/artistas', async (req, res) => {
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

app.post('/api/inventario', authMiddleware, async (req, res) => {
  res.status(501).json({ error: 'Funcionalidad no implementada aún' });
});

app.put('/api/inventario', authMiddleware, async (req, res) => {
  res.status(501).json({ error: 'Funcionalidad no implementada aún' });
});

app.delete('/api/inventario', authMiddleware, async (req, res) => {
  res.status(501).json({ error: 'Funcionalidad no implementada aún' });
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

  const payload = JSON.stringify({
    title: title || 'Inventario Musical',
    body: body || 'La biblioteca ha sido actualizada',
    data: data || { url: './' },
  });

  const subscriptions = await pushStore.getAll();
  if (subscriptions.length === 0) {
    return res.json({ ok: true, sent: 0 });
  }

  lastNotifyTime = now;

  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      webpush.sendNotification(sub, payload).catch(async err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pushStore.remove(sub.endpoint);
        }
        console.error(`Error sending to ${sub.endpoint}:`, err.message);
      })
    )
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  console.log(`Push broadcast: ${sent}/${subscriptions.length} sent`);
  res.json({ ok: true, sent });
});

app.get('/api/push/subscriptions', authMiddleware, async (req, res) => {
  const subs = await pushStore.getAll();
  res.json({ count: subs.length, subscriptions: subs });
});

app.get('/api/push/check-sheet', async (req, res) => {
  const result = {
    config: {
      pushSheetId: !!process.env.PUSH_SHEET_ID,
      googleServiceAccount: !!process.env.GOOGLE_SERVICE_ACCOUNT,
      googleServiceAccountFile: !!process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
    },
    sheetStatus: 'unknown',
    subscriptions: 0,
    details: null,
    error: null,
  };

  if (!process.env.PUSH_SHEET_ID) {
    result.sheetStatus = 'missing PUSH_SHEET_ID';
    return res.json(result);
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
    result.sheetStatus = 'missing GOOGLE_SERVICE_ACCOUNT';
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
