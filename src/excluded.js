import { google } from 'googleapis';
import { SHEET_ID, GOOGLE_SA_CREDENTIALS } from './config.js';

const EXCLUDED_TAB = 'Excluded People';

let sheetsApi = null;
function getSheets() {
  if (sheetsApi) return sheetsApi;
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_SA_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsApi = google.sheets({ version: 'v4', auth });
  return sheetsApi;
}

/**
 * Load the user's exclusion list from the "Excluded People" sheet tab.
 * People matched here are counted in TOTAL metrics but excluded from
 * "outside team" totals and never assigned a segment.
 *
 * Sheet schema (columns):
 *   A: Name           (case-insensitive match against engager name)
 *   B: LinkedIn URL   (substring match — e.g. "/in/foo")
 *   C: Type           ("person" | "company"; "company" matches headline substring)
 */
export async function loadExcludedFromSheet() {
  const sheets = getSheets();

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const exists = meta.data.sheets.some(s => s.properties.title === EXCLUDED_TAB);
    if (!exists) {
      console.log(`[excluded] "${EXCLUDED_TAB}" tab not found — creating with header...`);
      await seedExcludedTab(sheets);
    }
  } catch (e) {
    if (!e.message?.includes('already exists')) throw e;
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${EXCLUDED_TAB}!A2:C500`,
  });

  const names = new Set();
  const urls = new Set();
  const companies = new Set();

  for (const row of (res.data.values || [])) {
    const value = (row[0] || '').trim().toLowerCase();
    const url = (row[1] || '').trim().toLowerCase();
    const type = (row[2] || '').trim().toLowerCase();

    if (type === 'company') {
      if (value) companies.add(value);
    } else {
      if (value) names.add(value);
      if (url) {
        const match = url.match(/\/in\/([^\/\?]+)/);
        if (match) urls.add(`/in/${match[1]}`);
        else urls.add(url);
      }
    }
  }

  console.log(`[excluded] Loaded ${names.size} names, ${urls.size} URLs, ${companies.size} companies.`);
  return { names, urls, companies };
}

async function seedExcludedTab(sheets) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: EXCLUDED_TAB } } }],
    },
  });

  const rows = [
    ['Name (or company)', 'LinkedIn URL', 'Type (person | company)'],
    // Examples — delete these and add your own:
    ['Your Name Here',    'https://www.linkedin.com/in/your-handle', 'person'],
    ['Co-founder Name',   '',                                        'person'],
    ['your-company-name', '',                                        'company'],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${EXCLUDED_TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  console.log(`[excluded] Seeded "${EXCLUDED_TAB}" tab with header + examples. Edit in Sheets.`);
}
