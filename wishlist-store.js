import { google } from 'googleapis';
import fs from 'fs';

function looksLikeSpreadsheetId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9-_]{20,}$/.test(value.trim());
}

const HEADERS = ['row_id', 'usuario', 'wishlist_key', 'discogs_id', 'artista', 'disco', 'anio', 'tipo', 'genero', 'img', 'img_full', 'recibido', 'notes', 'priority', 'created_at'];

function getSpreadsheetId() {
  const wishlistSheetId = process.env.WISHLIST_SHEET_ID;

  if (looksLikeSpreadsheetId(wishlistSheetId)) {
    return wishlistSheetId;
  }

  if (wishlistSheetId) {
    console.warn('WISHLIST_SHEET_ID no parece válido, usando PUSH_SHEET_ID como fallback');
  }

  return process.env.PUSH_SHEET_ID;
}

function getSheetName() {
  return process.env.WISHLIST_SHEET_NAME || 'Wishlist';
}

function getCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    const raw = fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf-8');
    return JSON.parse(raw);
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  }

  throw new Error('GOOGLE_SERVICE_ACCOUNT o GOOGLE_SERVICE_ACCOUNT_FILE no configurados');
}

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

let sheetsClient = null;
let sheetEnsured = false;

async function getSheets() {
  if (sheetsClient) {
    return sheetsClient;
  }

  const auth = await getAuth();
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

async function ensureSheet() {
  if (sheetEnsured) {
    return;
  }

  try {
    sheetEnsured = true;
    const sheets = await getSheets();
    const spreadsheetId = getSpreadsheetId();
    const sheetName = getSheetName();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = (meta.data.sheets || []).some(sheet => sheet.properties.title === sheetName);

    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:O1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [HEADERS],
      },
    });
  } catch (error) {
    sheetEnsured = false;
    console.error('Error asegurando sheet de wishlist:', error.message);
    throw error;
  }
}

function ensureWishlistStorageConfigured() {
  const spreadsheetId = getSpreadsheetId();

  if (!spreadsheetId) {
    throw new Error('WISHLIST_SHEET_ID/PUSH_SHEET_ID no configurado');
  }
}

function rowToWishlistItem(row = []) {
  return {
    rowId: row[0] || '',
    usuario: row[1] || '',
    wishlistKey: row[2] || '',
    discogsId: row[3] || '',
    Artista: row[4] || '',
    Disco: row[5] || '',
    Año: row[6] || '',
    Tipo: row[7] || '',
    Genero: row[8] || '',
    img: row[9] || '',
    imgFULL: row[10] || '',
    Recibido: row[11] || '',
    notes: row[12] || '',
    priority: row[13] || '',
    createdAt: row[14] || '',
  };
}

function normalizeWishlistRows(rows = []) {
  if (rows.length < 2) {
    return [];
  }

  return rows
    .slice(1)
    .map(rowToWishlistItem)
    .filter(item => item.wishlistKey && item.usuario)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function wishlistItemToRow(item) {
  return [
    item.rowId || '',
    item.usuario || '',
    item.wishlistKey || '',
    item.discogsId || '',
    item.Artista || '',
    item.Disco || '',
    item.Año || '',
    item.Tipo || '',
    item.Genero || '',
    item.img || '',
    item.imgFULL || '',
    item.Recibido || '',
    item.notes || '',
    item.priority || '',
    item.createdAt || '',
  ];
}

async function getRawRows() {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();
  const sheetName = getSheetName();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:O`,
  });

  return result.data.values || [];
}

async function rewriteRows(items) {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();
  const sheetName = getSheetName();
  const values = [HEADERS, ...items.map(wishlistItemToRow)];

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A:O`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:O${values.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

export function buildWishlistKey(item = {}) {
  if (item.discogsId || item.ID) {
    return `discogs:${String(item.discogsId || item.ID).trim()}`;
  }

  const artista = String(item.Artista || '').trim().toLowerCase();
  const disco = String(item.Disco || '').trim().toLowerCase();
  const anio = String(item.Año || '').trim().toLowerCase();
  const tipo = String(item.Tipo || '').trim().toLowerCase();

  return `wanted:${artista}|${disco}|${anio}|${tipo}`;
}

export async function getAll() {
  ensureWishlistStorageConfigured();

  await ensureSheet();

  try {
    const rows = await getRawRows();
    return normalizeWishlistRows(rows);
  } catch (error) {
    console.error('Error leyendo wishlist desde Google Sheets:', error.message);
    return [];
  }
}

export async function getByUser(usuario) {
  const items = await getAll();
  return items.filter(item => item.usuario === usuario);
}

export async function getUsers() {
  const items = await getAll();
  return [...new Set(items.map(item => item.usuario))].sort((a, b) => a.localeCompare(b));
}

export async function add(usuario, item) {
  ensureWishlistStorageConfigured();

  await ensureSheet();

  const wishlistKey = buildWishlistKey(item);
  const allItems = await getAll();
  const existing = allItems.find(entry => entry.usuario === usuario && entry.wishlistKey === wishlistKey);
  if (existing) {
    return existing;
  }

  const wishlistItem = {
    rowId: crypto.randomUUID(),
    usuario,
    wishlistKey,
    discogsId: item.discogsId || item.ID || '',
    Artista: item.Artista || '',
    Disco: item.Disco || '',
    Año: item.Año || '',
    Tipo: item.Tipo || '',
    Genero: item.Genero || '',
    img: item.img || '',
    imgFULL: item.imgFULL || '',
    Recibido: item.Recibido || '',
    notes: item.notes || '',
    priority: item.priority || '',
    createdAt: new Date().toISOString(),
  };

  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();
  const sheetName = getSheetName();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:O`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [wishlistItemToRow(wishlistItem)],
    },
  });

  return wishlistItem;
}

export async function remove(usuario, rowId) {
  ensureWishlistStorageConfigured();

  await ensureSheet();

  const allItems = await getAll();
  const filtered = allItems.filter(item => !(item.usuario === usuario && item.rowId === rowId));

  if (filtered.length === allItems.length) {
    return false;
  }

  await rewriteRows(filtered);
  return true;
}

export async function update(usuario, rowId, item) {
  ensureWishlistStorageConfigured();

  await ensureSheet();

  const allItems = await getAll();
  const existing = allItems.find(entry => entry.usuario === usuario && entry.rowId === rowId);
  if (!existing) {
    return null;
  }

  const merged = {
    ...existing,
    discogsId: item.discogsId || item.ID || '',
    Artista: item.Artista || existing.Artista,
    Disco: item.Disco || existing.Disco,
    Año: item.Año || '',
    Tipo: item.Tipo || '',
    Genero: item.Genero || '',
    img: item.img || '',
    imgFULL: item.imgFULL || '',
    Recibido: item.Recibido || existing.Recibido || '',
    notes: item.notes || '',
    priority: item.priority || '',
  };

  merged.wishlistKey = buildWishlistKey(merged);

  const duplicated = allItems.find(entry =>
    entry.usuario === usuario &&
    entry.rowId !== rowId &&
    entry.wishlistKey === merged.wishlistKey
  );

  if (duplicated) {
    return duplicated;
  }

  const updatedItems = allItems.map(entry =>
    entry.usuario === usuario && entry.rowId === rowId ? merged : entry
  );

  await rewriteRows(updatedItems);
  return merged;
}
