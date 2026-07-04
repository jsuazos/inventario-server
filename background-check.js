import { supabase } from './db.js';
import * as inventoryStore from './inventory-store.js';
import * as pushStore from './sheets-store.js';
import { createPayload, sendPushBroadcast } from './push-notification-service.js';

let lastNotifyTime = 0;
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
  await supabase
    .from('sync_metadata')
    .upsert(
      { key: 'last_known_change', value: String(timestamp), updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
}

async function detectChanges() {
  const lastKnown = await getLastKnownChange();
  const latestTimestamp = await inventoryStore.getLastUpdatedAt();

  if (!latestTimestamp) return false;

  if (lastKnown && Number(lastKnown) >= latestTimestamp) return false;

  await setLastKnownChange(latestTimestamp);
  return !lastKnown;
}

async function broadcastPush() {
  const now = Date.now();
  if (now - lastNotifyTime < NOTIFY_COOLDOWN_MS) return;

  const payload = createPayload({
    title: '📀 Biblioteca actualizada',
    body: 'Hay cambios en la biblioteca',
    data: { url: './' },
  });

  const subscriptions = await pushStore.getAll();
  if (subscriptions.length === 0) return;

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
      console.error(`Background check push error to ${result.endpoint}:`, result.error);
    });

  console.log(`Background check: cambios detectados, push enviado a ${broadcast.sent}/${subscriptions.length} dispositivos (${broadcast.failed} fallidos)`);
}

async function checkForChanges() {
  try {
    const hasChanges = await detectChanges();
    if (!hasChanges) return;

    console.log('Background check: cambios detectados en la base de datos');
    await broadcastPush();
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
