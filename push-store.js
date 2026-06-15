import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, 'push-subscriptions.json');

function load() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error loading push subscriptions:', err.message);
  }
  return [];
}

function save(subscriptions) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(subscriptions, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving push subscriptions:', err.message);
  }
}

export function getAll() {
  return load();
}

export function add(subscription) {
  const subs = load();
  const exists = subs.some(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    subs.push(subscription);
    save(subs);
    console.log(`Push subscription added (total: ${subs.length})`);
  }
  return subs;
}

export function remove(endpoint) {
  const subs = load().filter(s => s.endpoint !== endpoint);
  save(subs);
  console.log(`Push subscription removed (total: ${subs.length})`);
  return subs;
}
