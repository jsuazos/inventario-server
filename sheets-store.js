import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.PUSH_SHEET_ID;
const SHEET_NAME = 'PushSubscriptions';

function getAuth() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!credentials) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT no configurado');
  }
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(credentials),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

let sheetsClient = null;

async function getSheets() {
  if (sheetsClient) return sheetsClient;
  const auth = await getAuth();
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function rowsToSubscriptions(rows) {
  if (!rows || rows.length < 2) return [];
  return rows.slice(1).map(row => ({
    endpoint: row[0] || '',
    keys: {
      p256dh: row[1] || '',
      auth: row[2] || '',
    },
    createdAt: row[3] || '',
  }));
}

export async function getAll() {
  if (!SPREADSHEET_ID) {
    console.warn('PUSH_SHEET_ID no configurado, usando almacenamiento vacío');
    return [];
  }

  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:D`,
    });
    return rowsToSubscriptions(res.data.values);
  } catch (err) {
    console.error('Error leyendo suscripciones de Google Sheets:', err.message);
    return [];
  }
}

export async function add(subscription) {
  if (!SPREADSHEET_ID) return [];

  try {
    const subs = await getAll();
    const exists = subs.some(s => s.endpoint === subscription.endpoint);
    if (exists) return subs;

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:D`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          subscription.endpoint,
          subscription.keys?.p256dh || '',
          subscription.keys?.auth || '',
          new Date().toISOString(),
        ]],
      },
    });

    console.log(`Push subscription added via Sheets (total: ${subs.length + 1})`);
    return [...subs, subscription];
  } catch (err) {
    console.error('Error agregando suscripción a Google Sheets:', err.message);
    return await getAll();
  }
}

export async function remove(endpoint) {
  if (!SPREADSHEET_ID) return [];

  try {
    const subs = await getAll();
    const filtered = subs.filter(s => s.endpoint !== endpoint);
    if (filtered.length === subs.length) return subs;

    const sheets = await getSheets();

    const values = filtered.map(s => [
      s.endpoint,
      s.keys?.p256dh || '',
      s.keys?.auth || '',
      s.createdAt || '',
    ]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:D`,
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:D${values.length + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['endpoint', 'p256dh', 'auth', 'created_at'],
          ...values,
        ],
      },
    });

    console.log(`Push subscription removed via Sheets (remaining: ${filtered.length})`);
    return filtered;
  } catch (err) {
    console.error('Error eliminando suscripción de Google Sheets:', err.message);
    return await getAll();
  }
}
