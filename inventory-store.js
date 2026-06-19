import { google } from 'googleapis';
import fs from 'fs';

function looksLikeSpreadsheetId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9-_]{20,}$/.test(value.trim());
}

function getSpreadsheetId() {
  const inventarioSheetId = process.env.INVENTARIO_SHEET_ID;

  if (looksLikeSpreadsheetId(inventarioSheetId)) {
    return inventarioSheetId;
  }

  return process.env.PUSH_SHEET_ID;
}

function getSheetName() {
  return process.env.INVENTARIO_SHEET_NAME || 'INVENTARIO';
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

let sheetsClient = null;

async function getSheets() {
  if (sheetsClient) {
    return sheetsClient;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function ensureInventoryStorageConfigured() {
  if (!getSpreadsheetId()) {
    throw new Error('INVENTARIO_SHEET_ID/PUSH_SHEET_ID no configurado');
  }
}

async function getHeadersAndRows() {
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();
  const sheetName = getSheetName();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:ZZ`,
  });

  const values = result.data.values || [];
  const headers = values[0] || [];
  const rows = values.slice(1);

  if (headers.length === 0) {
    throw new Error(`La hoja ${sheetName} no tiene encabezados`);
  }

  return { headers, rows };
}

function getNextOrden(headers, rows) {
  const ordenIndex = headers.indexOf('Orden');
  if (ordenIndex === -1) {
    return '';
  }

  const maxOrden = rows.reduce((max, row) => {
    const value = parseFloat(row[ordenIndex] || '0');
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);

  return String(maxOrden + 1);
}

function buildInventoryValueMap(item, headers, rows) {
  const numericDiscogsId = String(item.discogsId || item.ID || '').replace(/\D+/g, '');

  return {
    ID: numericDiscogsId ? `r${numericDiscogsId}` : '',
    Artista: item.Artista || '',
    Disco: item.Disco || '',
    'Año': item.Año || '',
    Tipo: item.Tipo || '',
    Genero: item.Genero || '',
    Disqueria: item.Disqueria || '',
    Catalogo: item.Catalogo || '',
    img: item.img || '',
    imgFULL: item.imgFULL || '',
    Visible: 'SI',
    Recibido: item.Recibido || 'SI',
    Orden: getNextOrden(headers, rows),
    Origen: item.Origen || '',
    OrigenISO: item.OrigenISO || '',
  };
}

function mapItemToRow(headers, rows, item) {
  const valueMap = buildInventoryValueMap(item, headers, rows);
  return headers.map(header => valueMap[header] ?? '');
}

export async function add(item) {
  ensureInventoryStorageConfigured();

  const { headers, rows } = await getHeadersAndRows();
  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();
  const sheetName = getSheetName();
  const row = mapItemToRow(headers, rows, item);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:ZZ`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });

  return {
    ...item,
    ID: row[headers.indexOf('ID')] || '',
    Recibido: row[headers.indexOf('Recibido')] || item.Recibido || 'SI',
    Visible: row[headers.indexOf('Visible')] || 'SI',
    Orden: row[headers.indexOf('Orden')] || '',
  };
}
