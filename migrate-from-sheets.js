/**
 * Script de migración one-shot: Google Sheets → Supabase
 *
 * Uso:
 *   1. Configurar SUPABASE_URL y SUPABASE_SERVICE_KEY en .env
 *   2. Ejecutar el schema SQL en el dashboard de Supabase
 *   3. node migrate-from-sheets.js
 *
 * Requiere las variables de entorno:
 *   GOOGLE_SERVICE_ACCOUNT, PUSH_SHEET_ID, SECRET_TOKEN_INVENTARIO
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

// ── Supabase ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Google Sheets ──
function getGoogleAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT no configurado');
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function readSheet(spreadsheetId, range) {
  const auth = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

// ── Migración ──

function normalizeInventoryItem(item, usuario) {
  const numericDiscogsId = String(item.ID || '').replace(/[^0-9]/g, '');
  return {
    usuario,
    discogs_id: numericDiscogsId ? `r${numericDiscogsId}` : '',
    artista: item.Artista || '',
    disco: item.Disco || '',
    año: item.Año ? Number(item.Año) : null,
    genero: item.Genero || '',
    tipo: item.Tipo || '',
    formato: item.Formato || '',
    estilo: item.Estilo || item.Estilos || '',
    disqueria: item.Disqueria || item.Sello || item.Label || '',
    catalogo: item.Catalogo || item.Catalog || '',
    img: item.img || '',
    img_full: item.imgFULL || '',
    visible: item.Visible === 'SI',
    recibido: item.Recibido === 'SI',
    orden: item.Orden || `${(item.Artista || '').toLowerCase()} - ${item.Año || ''}`,
    origen: item.Origen || item.Pais || item.País || '',
    origen_iso: (item.OrigenISO || item.PaisISO || item.PaísISO || '').substring(0, 2),
  };
}

async function migrateInventory(usuario) {
  console.log('\n📦 Migrando inventario...');

  const sheetUrl = `https://script.google.com/macros/s/${process.env.SECRET_TOKEN_INVENTARIO}/exec?path=INVENTARIO&action=read`;
  const response = await fetch(sheetUrl);
  const json = await response.json();
  const items = Array.isArray(json.data) ? json.data : [];

  console.log(`   Leídos ${items.length} items desde Google Sheets`);

  if (items.length === 0) {
    console.log('   No hay datos para migrar');
    return;
  }

  const normalized = items.map(item => normalizeInventoryItem(item, usuario));

  const { data, error } = await supabase.from('inventory').upsert(normalized, {
    onConflict: 'id',
    ignoreDuplicates: false,
  });

  if (error) {
    console.error('   Error insertando en Supabase:', error.message);
    return;
  }

  console.log(`   ✅ ${normalized.length} items migrados a Supabase (usuario: ${usuario})`);
}

async function migrateWishlist() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT && !process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    console.log('\n📋 Wishlist: GOOGLE_SERVICE_ACCOUNT no configurado, se salta migración de wishlist');
    return;
  }

  const sheetId = process.env.WISHLIST_SHEET_ID || process.env.PUSH_SHEET_ID;
  const sheetName = process.env.WISHLIST_SHEET_NAME || 'Wishlist';

  console.log(`\n📋 Migrando wishlist desde Google Sheets...`);

  const rows = await readSheet(sheetId, `${sheetName}!A:P`);
  const items = rowsToObjects(rows);

  console.log(`   Leídos ${items.length} items desde Google Sheets`);

  if (items.length === 0) {
    console.log('   No hay datos para migrar');
    return;
  }

  const normalized = items.map(row => {
    const numericDiscogsId = String(row.discogs_id || row.ID || '').replace(/[^0-9]/g, '');
    return {
      usuario: row.usuario || '',
      wishlist_key: row.wishlist_key || '',
      discogs_id: numericDiscogsId ? `r${numericDiscogsId}` : '',
      artista: row.Artista || '',
      disco: row.Disco || '',
      año: row.Año ? Number(row.Año) : null,
      tipo: row.Tipo || '',
      genero: row.Genero || '',
      img: row.img || '',
      img_full: row.imgFULL || '',
      recibido: row.Recibido === 'SI',
      notes: row.notes || '',
      priority: row.priority || '',
      status: row.status || 'wishlist',
    };
  }).filter(item => item.usuario && item.wishlist_key);

  const { data, error } = await supabase.from('wishlist').upsert(normalized, {
    onConflict: 'usuario, wishlist_key',
    ignoreDuplicates: false,
  });

  if (error) {
    console.error('   Error insertando wishlist en Supabase:', error.message);
    return;
  }

  console.log(`   ✅ ${normalized.length} items migrados a Supabase`);
}

async function migratePushSubscriptions() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT && !process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    console.log('\n🔔 Push subscriptions: GOOGLE_SERVICE_ACCOUNT no configurado, se salta');
    return;
  }

  const sheetId = process.env.PUSH_SHEET_ID;
  if (!sheetId) {
    console.log('\n🔔 PUSH_SHEET_ID no configurado, se salta migración de push subscriptions');
    return;
  }

  console.log('\n🔔 Migrando push subscriptions...');

  const rows = await readSheet(sheetId, 'PushSubscriptions!A:D');
  const items = rowsToObjects(rows);

  console.log(`   Leídas ${items.length} suscripciones desde Google Sheets`);

  if (items.length === 0) {
    console.log('   No hay datos para migrar');
    return;
  }

  const normalized = items.map(row => ({
    endpoint: row.endpoint || '',
    p256dh: row.p256dh || '',
    auth: row.auth || '',
  })).filter(item => item.endpoint && item.p256dh && item.auth);

  const { data, error } = await supabase.from('push_subscriptions').upsert(normalized, {
    onConflict: 'endpoint',
    ignoreDuplicates: false,
  });

  if (error) {
    console.error('   Error insertando push subscriptions en Supabase:', error.message);
    return;
  }

  console.log(`   ✅ ${normalized.length} suscripciones migradas a Supabase`);
}

// ── Main ──

async function main() {
  console.log('🚀 Iniciando migración Google Sheets → Supabase');
  console.log('===============================================');

  const usuario = process.argv[2] || 'jsuazo';
  console.log(`\n👤 Asignando inventario existente al usuario: ${usuario}`);

  try {
    await migrateInventory(usuario);
    await migrateWishlist();
    await migratePushSubscriptions();

    console.log('\n===============================================');
    console.log('✅ Migración completada exitosamente');
    console.log('===============================================\n');
  } catch (err) {
    console.error('\n❌ Error durante la migración:', err.message);
    process.exit(1);
  }
}

main();
