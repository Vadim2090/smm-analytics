import GoLogin from 'gologin';
import { GOLOGIN_TOKEN, NAV_TIMEOUT_MS, HEADLESS } from './config.js';

let glInstance = null;

/**
 * Start a GoLogin browser profile and return a Puppeteer browser + page.
 *
 * @param {string} profileId - GoLogin profile ID
 * @returns {Promise<{ browser: import('puppeteer-core').Browser, page: import('puppeteer-core').Page }>}
 */
export async function startBrowser(profileId) {
  const puppeteer = (await import('puppeteer-core')).default;

  const gl = new GoLogin({
    token: GOLOGIN_TOKEN,
    profile_id: profileId,
    extra_params: [
      ...(HEADLESS ? ['--headless=new'] : []),
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  glInstance = gl;

  console.log(`[browser] Starting GoLogin profile ${profileId}...`);
  let status, wsUrl;
  try {
    ({ status, wsUrl } = await gl.start());
  } catch (e) {
    // GoLogin font download errors are non-fatal — retry without fonts
    if (e.statusCode === 404 || e.message?.includes('Not Found')) {
      console.warn('[browser] Font download failed (known GoLogin issue), retrying...');
      ({ status, wsUrl } = await gl.start());
    } else {
      throw e;
    }
  }
  console.log(`[browser] Profile started. Status: ${status}`);

  const browser = await puppeteer.connect({
    browserWSEndpoint: wsUrl,
    defaultViewport: null,
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  page.setDefaultTimeout(NAV_TIMEOUT_MS);

  return { browser, page, gl };
}

/**
 * Close browser and stop GoLogin profile.
 */
export async function stopBrowser(browser, gl) {
  try {
    if (browser) await browser.close();
  } catch (e) {
    console.warn('[browser] Error closing browser:', e.message);
  }
  try {
    const instance = gl || glInstance;
    if (instance) await instance.stop();
    console.log('[browser] GoLogin profile stopped.');
  } catch (e) {
    console.warn('[browser] Error stopping profile:', e.message);
  }
}

/**
 * Scroll down a page to trigger lazy loading.
 */
export async function autoScroll(page, maxScrolls = 10, pauseMs = 2000) {
  let previousHeight = 0;
  let staleCount = 0;
  for (let i = 0; i < maxScrolls; i++) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === previousHeight) {
      staleCount++;
      // In headless, give extra time for lazy content to load
      if (staleCount >= 3) break;
      await new Promise(r => setTimeout(r, pauseMs * 1.5));
      continue;
    }
    staleCount = 0;
    previousHeight = currentHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, pauseMs));
  }
}

/**
 * Wait for a selector with retry.
 */
export async function waitForSelector(page, selector, timeoutMs = 10000) {
  try {
    await page.waitForSelector(selector, { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
