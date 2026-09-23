import { supabase } from './db.js';
import * as inventoryStore from './inventory-store.js';
import * as pushStore from './sheets-store.js';
import { createPayload, sendPushBroadcast } from './push-notification-service.js';
import { shouldNotifyForInventoryChange } from './change-detector.js';

const lastNotifyTimesByUser = new Map();
const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;

async function getLastKnownChange() {
  const { data, error } = await supabase
    .from('sync_metadata')
    .select('value')
    .eq('key', 'last_known_change')
    .maybeSingle();

  if (error || !data) return null;
  return data.value;
}

async function setLastKnownChange(timestamp) {
  const { error } = await supabase
    .from('sync_metadata')
    .upsert(
      { key: 'last_known_change', value: String(timestamp), updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

  if (error) {
    throw new Error(`No se pudo guardar el estado de sincronización: ${error.message}`);
  }
}

async function detectChanges() {
  const lastKnown = await getLastKnownChange();
  const latestTimestamp = await inventoryStore.getLastUpdatedAt();

  if (!latestTimestamp) return [];

  const shouldNotify = shouldNotifyForInventoryChange(lastKnown, latestTimestamp);
  const changedUsers = shouldNotify
    ? await inventoryStore.getChangedUsersSince(lastKnown)
    : [];

  await setLastKnownChange(latestTimestamp);
  return changedUsers;
}

async function broadcastPush(usuario) {
  const now = Date.now();
  const lastNotifyTime = lastNotifyTimesByUser.get(usuario) || 0;
  if (now - lastNotifyTime < NOTIFY_COOLDOWN_MS) return;

  const payload = createPayload({
    title: '📀 Biblioteca actualizada',
    body: 'Hay cambios en la biblioteca',
    data: { url: './' },
  });

  const subscriptions = await pushStore.getByUser(usuario);
  if (subscriptions.length === 0) return;

  const broadcast = await sendPushBroadcast(
    subscriptions,
    payload,
    endpoint => pushStore.remove(endpoint, usuario)
  );

  if (broadcast.sent > 0) {
    lastNotifyTimesByUser.set(usuario, now);
  }

  broadcast.results
    .filter(result => !result.ok)
    .forEach(result => {
      console.error('Background check push error:', result.error);
    });

  console.log(`Background check: push enviado a ${broadcast.sent}/${subscriptions.length} dispositivos para ${usuario} (${broadcast.failed} fallidos)`);
}

async function checkForChanges() {
  try {
    const changedUsers = await detectChanges();
    if (changedUsers.length === 0) return;

    console.log(`Background check: cambios detectados para ${changedUsers.length} usuario(s)`);
    await Promise.all(changedUsers.map(usuario => broadcastPush(usuario)));
  } catch (err) {
    console.error('Background check: error:', err.message);
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
