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

function rowToObject(headers, row = []) {
  return headers.reduce((acc, header, index) => {
    acc[header] = row[index] || '';
    return acc;
  }, {});
}

function findRowIndex(headers, rows, originalItem = {}) {
  const ordenIndex = headers.indexOf('Orden');

  if (ordenIndex !== -1 && originalItem.Orden) {
    const rowIndex = rows.findIndex(row => String(row[ordenIndex] || '') === String(originalItem.Orden));
    if (rowIndex !== -1) {
      return rowIndex;
    }
  }

  return rows.findIndex(row => {
    const rowData = rowToObject(headers, row);
    return String(rowData.ID || '') === String(originalItem.ID || '') &&
      String(rowData.Artista || '') === String(originalItem.Artista || '') &&
      String(rowData.Disco || '') === String(originalItem.Disco || '') &&
      String(rowData['Año'] || '') === String(originalItem['Año'] || originalItem.Año || '');
  });
}

function buildInventoryValueMap(item, headers, rows, existingRow = null) {
  const numericDiscogsId = String(item.discogsId || item.ID || '').replace(/\D+/g, '');
  const currentRow = existingRow || {};

  return {
    ID: numericDiscogsId ? `r${numericDiscogsId}` : (currentRow.ID || ''),
    Artista: item.Artista || currentRow.Artista || '',
    Disco: item.Disco || currentRow.Disco || '',
    'Año': item.Año || currentRow['Año'] || '',
    Tipo: item.Tipo || currentRow.Tipo || '',
    Genero: item.Genero || currentRow.Genero || '',
    Disqueria: item.Disqueria || currentRow.Disqueria || '',
    Catalogo: item.Catalogo || currentRow.Catalogo || '',
    img: item.img || currentRow.img || '',
    imgFULL: item.imgFULL || currentRow.imgFULL || '',
    Visible: item.Visible || currentRow.Visible || 'SI',
    Recibido: item.Recibido || currentRow.Recibido || 'SI',
    Orden: currentRow.Orden || getNextOrden(headers, rows),
    Origen: item.Origen || currentRow.Origen || '',
    OrigenISO: item.OrigenISO || currentRow.OrigenISO || '',
  };
}

function mapItemToRow(headers, rows, item, existingRow = null) {
  const valueMap = buildInventoryValueMap(item, headers, rows, existingRow);
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

export async function update(originalItem, item) {
  ensureInventoryStorageConfigured();

  const { headers, rows } = await getHeadersAndRows();
  const rowIndex = findRowIndex(headers, rows, originalItem);

  if (rowIndex === -1) {
    return null;
  }

  const existingRow = rowToObject(headers, rows[rowIndex]);
  const updatedRow = mapItemToRow(headers, rows, item, existingRow);
  const values = [headers, ...rows];
  values[rowIndex + 1] = updatedRow;

  const sheets = await getSheets();
  const spreadsheetId = getSpreadsheetId();
  const sheetName = getSheetName();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:ZZ${values.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  return rowToObject(headers, updatedRow);
}

export async function softRemove(originalItem) {
  return update(originalItem, {
    ...originalItem,
    Visible: 'NO',
  });
}
