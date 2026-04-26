import 'dotenv/config';
import { readFileSync } from 'fs';

// ── Required env vars ──
function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.startsWith('your-') || v === '') {
    throw new Error(`Missing required env var: ${name}. See .env.example.`);
  }
  return v;
}

export const GOLOGIN_TOKEN = requireEnv('GOLOGIN_API_TOKEN');
export const SHEET_ID = requireEnv('SHEET_ID');
export const LINKEDIN_PROFILE_ID = requireEnv('LINKEDIN_PROFILE_ID');
export const TWITTER_PROFILE_ID = requireEnv('TWITTER_PROFILE_ID');
export const LINKEDIN_USERNAME = requireEnv('LINKEDIN_USERNAME');
export const TWITTER_USERNAME = requireEnv('TWITTER_USERNAME');

// Comma-separated list of segment ids the user is targeting.
// Used to compute "% Target Audience" — the headline KPI on the dashboard.
// Example: MY_TARGETS=Founder,Engineer,Designer
export const MY_TARGETS = (process.env.MY_TARGETS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ── Google service account ──
const saPath = (process.env.GOOGLE_SA_KEY_PATH || '').replace(/^~/, process.env.HOME);
if (!saPath) {
  throw new Error('Missing GOOGLE_SA_KEY_PATH in .env');
}
export const GOOGLE_SA_CREDENTIALS = JSON.parse(readFileSync(saPath, 'utf8'));

// ── Scraping config ──
export const BACKFILL = process.argv.includes('--backfill');
export const MAX_POSTS = BACKFILL ? 100 : 50;
export const MAX_SCROLLS = BACKFILL ? 60 : 30;
export const BATCH_SIZE = 15;
export const SCROLL_PAUSE_MS = 2000;
export const NAV_TIMEOUT_MS = 60000;
export const HEADLESS = !process.argv.includes('--visible');
export const MAX_RETRIES = 3;
