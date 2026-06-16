import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import * as pushStore from './sheets-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(__dirname, 'library-snapshot.json');

let lastNotifyTime = 0;
const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;

function getApiUrl() {
  const token = process.env.SECRET_TOKEN_INVENTARIO;
  if (!token) return null;
  return `https://script.google.com/macros/s/${token}/exec?path=INVENTARIO&action=read`;
}

function createKey(item) {
  return `${item.ID || ''}|${item.Artista || ''}|${item.Disco || ''}|${item.Año || ''}|${item.Recibido || ''}`.toLowerCase();
}

function loadSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_PATH)) {
      const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error loading snapshot:', err.message);
  }
  return null;
}

function saveSnapshot(data) {
  try {
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving snapshot:', err.message);
  }
}

function getChanges(oldArray, newArray) {
  const oldMap = new Map();
  const newMap = new Map();

  oldArray.forEach(item => oldMap.set(createKey(item), item));
  newArray.forEach(item => newMap.set(createKey(item), item));

  const added = [];
  const removed = [];

  newArray.forEach(item => {
    if (!oldMap.has(createKey(item))) {
      added.push(item);
    }
  });

  oldArray.forEach(item => {
    if (!newMap.has(createKey(item))) {
      removed.push(item);
    }
  });

  return { added, removed };
}

async function fetchLibraryData() {
  const url = getApiUrl();
  if (!url) {
    console.error('Background check: SECRET_TOKEN_INVENTARIO no configurado');
    return null;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    const items = (data.data || []).filter(item => item.Visible === 'SI');
    items.sort((a, b) => {
      const keyA = `${a.Artista || ''} ${a.Año || ''} ${a.Disco || ''} ${a.Recibido || ''}`.toLowerCase();
      const keyB = `${b.Artista || ''} ${b.Año || ''} ${b.Disco || ''} ${b.Recibido || ''}`.toLowerCase();
      return keyA.localeCompare(keyB);
    });
    return items;
  } catch (err) {
    console.error('Background check: error fetching data:', err.message);
    return null;
  }
}

async function broadcastPush(added, removed) {
  const now = Date.now();
  if (now - lastNotifyTime < NOTIFY_COOLDOWN_MS) return;

  const parts = [];
  if (added.length > 0) {
    parts.push(`${added.length} agregado${added.length !== 1 ? 's' : ''}`);
  }
  if (removed.length > 0) {
    parts.push(`${removed.length} eliminado${removed.length !== 1 ? 's' : ''}`);
  }

  const body = parts.join(' · ') || 'Hay cambios en la biblioteca';

  const payload = JSON.stringify({
    title: '📀 Biblioteca actualizada',
    body,
    data: { url: './' },
  });

  const subscriptions = await pushStore.getAll();
  if (subscriptions.length === 0) return;

  lastNotifyTime = now;

  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      webpush.sendNotification(sub, payload).catch(async err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pushStore.remove(sub.endpoint);
        }
      })
    )
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  console.log(`Background check: cambios detectados, push enviado a ${sent}/${subscriptions.length} dispositivos`);
}

async function checkForChanges() {
  const newData = await fetchLibraryData();
  if (!newData) return;

  const snapshot = loadSnapshot();

  if (!snapshot) {
    saveSnapshot(newData);
    console.log(`Background check: snapshot inicial guardado (${newData.length} registros)`);
    return;
  }

  const { added, removed } = getChanges(snapshot, newData);

  if (added.length > 0 || removed.length > 0) {
    console.log(`Background check: cambios detectados (+${added.length}, -${removed.length})`);
    saveSnapshot(newData);
    await broadcastPush(added, removed);
  }
}

let intervalHandle = null;

export function start(intervalMs = 10 * 60 * 1000) {
  if (intervalHandle) return;

  const customInterval = process.env.POLL_INTERVAL_MS
    ? parseInt(process.env.POLL_INTERVAL_MS, 10)
    : intervalMs;

  console.log(`Background check: iniciado cada ${Math.round(customInterval / 60000)} minutos`);
  checkForChanges();
  intervalHandle = setInterval(checkForChanges, customInterval);
}

export function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('Background check: detenido');
  }
}

export function restart(intervalMs) {
  stop();
  start(intervalMs);
}
