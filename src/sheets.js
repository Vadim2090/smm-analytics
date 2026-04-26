import { google } from 'googleapis';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SHEET_ID, GOOGLE_SA_CREDENTIALS, BACKFILL, MY_TARGETS } from './config.js';

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

// ───────── Lock (Codex review fix) ─────────
const LOCK_PATH = path.join(os.tmpdir(), 'smm-analytics-sheet.lock');
const LOCK_STALE_MS = 10 * 60 * 1000;

function acquireSheetLock(tabName) {
  try {
    const fd = fs.openSync(LOCK_PATH, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, tab: tabName, ts: Date.now() }));
    fs.closeSync(fd);
    return () => { try { fs.unlinkSync(LOCK_PATH); } catch {} };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try {
      const stat = fs.statSync(LOCK_PATH);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        fs.unlinkSync(LOCK_PATH);
        return acquireSheetLock(tabName);
      }
    } catch {}
    throw new Error(`Sheet write already in progress (lock at ${LOCK_PATH}). Wait or remove if stale.`);
  }
}

// ───────── Segments tab (NEW — drives column headers + classifier) ─────────
const SEGMENTS_TAB = 'Segments';

/**
 * Load segment definitions from the user's "Segments" sheet tab.
 * Schema:
 *   A: id           (segment label, also used as column header)
 *   B: keywords     (comma-separated keywords; empty = fallback segment)
 *   C: priority     (lower number = checked first)
 *
 * Auto-creates the tab with sensible defaults on first run.
 */
export async function loadSegmentsFromSheet() {
  const sheets = getSheets();
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const exists = meta.data.sheets.some(s => s.properties.title === SEGMENTS_TAB);
    if (!exists) {
      console.log(`[segments] "${SEGMENTS_TAB}" tab not found — creating with defaults...`);
      await seedSegmentsTab(sheets);
    }
  } catch (e) {
    if (!e.message?.includes('already exists')) throw e;
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SEGMENTS_TAB}!A2:C100`,
  });

  const segments = [];
  for (const row of (res.data.values || [])) {
    const id = (row[0] || '').trim();
    if (!id) continue;
    const keywords = (row[1] || '')
      .split(',')
      .map(k => k.trim().toLowerCase())
      .filter(Boolean);
    const priority = parseInt(row[2], 10) || 99;
    segments.push({ id, keywords, priority });
  }
  segments.sort((a, b) => a.priority - b.priority);
  console.log(`[segments] Loaded ${segments.length} segments: ${segments.map(s => s.id).join(', ')}`);
  return segments;
}

async function seedSegmentsTab(sheets) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: SEGMENTS_TAB } } }],
    },
  });

  const rows = [
    ['Segment ID', 'Keywords (comma-separated, lowercase)', 'Priority (lower = first match)'],
    ['VC',       'investor, partner at, venture, capital, fund, private equity', '1'],
    ['Founder',  'founder, co-founder, ceo, owner, entrepreneur',                '2'],
    ['Engineer', 'engineer, developer, swe, sre, devops, programmer, cto',      '3'],
    ['Designer', 'designer, ux, ui, product design',                             '4'],
    ['Marketer', 'marketing, growth, demand gen, brand, smm',                    '5'],
    ['Operator', 'coo, operations, chief of staff',                              '6'],
    ['Other',    '',                                                             '99'],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SEGMENTS_TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
  console.log(`[segments] Seeded "${SEGMENTS_TAB}" with 7 example segments. Edit in Sheets.`);
}

// ───────── Output schema ─────────
let SEGMENT_IDS = []; // set by setSegments() — drives column headers

export function setSegments(segments) {
  SEGMENT_IDS = segments.map(s => s.id);
}

function buildHeaders() {
  return [
    'Post Date',
    'Post Text',
    'Post URL',
    'Impressions',
    'Total Likes',
    'Total Comments',
    'Total Reposts',
    'Likes Outside Team',
    'Comments Outside Team',
    'Reposts Outside Team',
    ...SEGMENT_IDS.map(id => `${id} Likes`),
    '% Target Audience',
    'Flags',
  ];
}

// Column index (in the data row, 0-based) for each section
const FIXED_PREFIX_COLS = 10; // Post Date … Reposts Outside Team
function segmentLikesIdx(segId) {
  const i = SEGMENT_IDS.indexOf(segId);
  return i < 0 ? -1 : FIXED_PREFIX_COLS + i;
}
function pctTargetIdx() {
  return FIXED_PREFIX_COLS + SEGMENT_IDS.length;
}
function flagsIdx() {
  return FIXED_PREFIX_COLS + SEGMENT_IDS.length + 1;
}

const DATA_START_ROW = 7;

// ───────── writeToSheet ─────────
export async function writeToSheet(tabName, posts) {
  const sheets = getSheets();
  await ensureTab(sheets, tabName);

  const releaseLock = acquireSheetLock(tabName);
  try {
    if (BACKFILL) {
      return await writeFullSheet(sheets, tabName, posts);
    }

    const existingRows = await readExistingDataRows(sheets, tabName);
    const existingByUrl = new Map();
    for (const row of existingRows) {
      const url = row[2];
      if (url?.startsWith('http')) existingByUrl.set(url, row);
    }

    let updated = 0;
    let appended = 0;

    for (const p of posts) {
      const row = postToRow(p);
      if (existingByUrl.has(p.url)) {
        existingByUrl.set(p.url, row);
        updated++;
      } else {
        existingByUrl.set(p.url, row);
        appended++;
      }
    }

    if (updated === 0 && appended === 0) {
      console.log(`[sheets] No changes for "${tabName}".`);
      return 0;
    }

    const allRows = [...existingByUrl.values()];
    sortRowsByDate(allRows);

    await writeFullSheetFromRows(sheets, tabName, allRows);
    console.log(`[sheets] "${tabName}": ${updated} updated, ${appended} new. Total: ${allRows.length}.`);
    return appended;
  } finally {
    releaseLock();
  }
}

async function writeFullSheet(sheets, tabName, posts) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1:Z5000`,
  });

  const rows = posts.map(postToRow);
  sortRowsByDate(rows);
  const sheetRows = buildSheetRows(rows);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: sheetRows },
  });

  console.log(`[sheets] Wrote ${posts.length} posts to "${tabName}" (backfill).`);
  return posts.length;
}

async function writeFullSheetFromRows(sheets, tabName, dataRows) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1:Z5000`,
  });

  const sheetRows = buildSheetRows(dataRows);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: sheetRows },
  });
}

function buildSheetRows(dataRows) {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const rows = [];
  rows.push([`Last Updated: ${now}`]);
  rows.push([]);
  rows.push(buildHeaders());
  rows.push(computeTotalsFromRows(dataRows));
  rows.push(computeAveragesFromRows(dataRows));
  rows.push([]);
  rows.push(...dataRows);
  return rows;
}

// ───────── Sort by date ─────────
function sortRowsByDate(rows) {
  rows.sort((a, b) => parseDateForSort(b[0]) - parseDateForSort(a[0]));
}

function parseDateForSort(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.getTime();
  const now = Date.now();
  const match = String(dateStr).match(/(\d+)\s*(h|d|w|mo|m)/i);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const ms = { h: 3600000, d: 86400000, w: 604800000, mo: 2592000000, m: 60000 };
    return now - n * (ms[unit] || 0);
  }
  return 0;
}

// ───────── Row construction ─────────
function postToRow(p) {
  // Segment likes pulled from p.segmentLikes (a plain object keyed by segment id),
  // populated by linkedin.js / twitter.js.
  const segLikes = p.segmentLikes || {};
  const segCols = SEGMENT_IDS.map(id => segLikes[id] ?? 0);

  // % target audience: sum of likes in MY_TARGETS / outside-team total
  let targetSum = 0;
  for (const id of MY_TARGETS) targetSum += (segLikes[id] ?? 0);
  const pct = (p.likesOutsideTeam || 0) > 0
    ? (targetSum / p.likesOutsideTeam * 100).toFixed(1) + '%'
    : 'N/A';

  return [
    p.date,
    p.text,
    p.url,
    p.impressions || '',
    p.totalLikes,
    p.totalComments,
    p.totalReposts,
    p.likesOutsideTeam,
    p.commentsOutsideTeam,
    p.repostsOutsideTeam,
    ...segCols,
    pct,
    p.flags || '',
  ];
}

async function readExistingDataRows(sheets, tabName) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A${DATA_START_ROW}:Z5000`,
    });
    return (res.data.values || []).filter(row => row.length > 2 && row[2]?.startsWith('http'));
  } catch {
    return [];
  }
}

// ───────── Aggregations ─────────
function computeTotalsFromRows(rows) {
  const sumCol = (idx) => rows.reduce((s, r) => s + (parseFloat(r[idx]) || 0), 0);
  const segSums = SEGMENT_IDS.map((_, i) => sumCol(FIXED_PREFIX_COLS + i));
  const likesOT = sumCol(7);
  let target = 0;
  for (const id of MY_TARGETS) {
    const i = SEGMENT_IDS.indexOf(id);
    if (i >= 0) target += segSums[i];
  }
  const pct = likesOT > 0 ? (target / likesOT * 100).toFixed(1) + '%' : 'N/A';
  return [
    'TOTALS', '', '',
    sumCol(3), sumCol(4), sumCol(5), sumCol(6),
    likesOT, sumCol(8), sumCol(9),
    ...segSums,
    pct, '',
  ];
}

function computeAveragesFromRows(rows) {
  const n = rows.length || 1;
  const avgCol = (idx) => (rows.reduce((s, r) => s + (parseFloat(r[idx]) || 0), 0) / n).toFixed(1);
  const segAvgs = SEGMENT_IDS.map((_, i) => avgCol(FIXED_PREFIX_COLS + i));
  const likesOT = parseFloat(avgCol(7));
  let target = 0;
  for (const id of MY_TARGETS) {
    const i = SEGMENT_IDS.indexOf(id);
    if (i >= 0) target += parseFloat(segAvgs[i]);
  }
  const pct = likesOT > 0 ? (target / likesOT * 100).toFixed(1) + '%' : 'N/A';
  return [
    'AVERAGES', '', '',
    avgCol(3), avgCol(4), avgCol(5), avgCol(6),
    avgCol(7), avgCol(8), avgCol(9),
    ...segAvgs,
    pct, '',
  ];
}

async function ensureTab(sheets, tabName) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const exists = meta.data.sheets.some(s => s.properties.title === tabName);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
      });
      console.log(`[sheets] Created tab "${tabName}".`);
    }
  } catch (e) {
    if (!e.message?.includes('already exists')) throw e;
  }
}

/** Detail tab — one row per reactor per post. */
export async function writeDetailSheet(tabName, posts) {
  const sheets = getSheets();
  const detailTab = `${tabName} Detail`;
  await ensureTab(sheets, detailTab);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${detailTab}!A1:Z10000`,
  });

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const rows = [
    [`Last Updated: ${now}`],
    [],
    ['Post Text (snippet)', 'Post URL', 'Reactor Name', 'Headline', 'Profile URL', 'Segment', 'Excluded?'],
  ];

  for (const p of posts) {
    if (!p.engagers || p.engagers.length === 0) continue;
    for (const e of p.engagers) {
      rows.push([
        p.text?.slice(0, 80) || '',
        p.url || '',
        e.name,
        e.headline,
        e.profileUrl || '',
        e.category,
        e.isTeam ? 'Yes' : 'No',
      ]);
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${detailTab}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
  console.log(`[sheets] Wrote ${rows.length - 3} reactor entries to "${detailTab}".`);
}

/** Verify integrity invariants. */
export function verifyIntegrity(posts) {
  const errors = [];
  for (const p of posts) {
    const segLikes = p.segmentLikes || {};
    const sum = SEGMENT_IDS.reduce((s, id) => s + (segLikes[id] || 0), 0);
    if (sum > (p.likesOutsideTeam || 0)) {
      errors.push(`Post "${p.text?.slice(0, 40)}...": segments sum (${sum}) > outside-team likes (${p.likesOutsideTeam})`);
    }
    if ((p.likesOutsideTeam || 0) > (p.totalLikes || 0)) {
      errors.push(`Post "${p.text?.slice(0, 40)}...": outside-team likes (${p.likesOutsideTeam}) > total likes (${p.totalLikes})`);
    }
  }
  return errors;
}
