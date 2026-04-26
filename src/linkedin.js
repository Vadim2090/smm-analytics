import { startBrowser, stopBrowser, autoScroll, waitForSelector } from './browser.js';
import { classifyAllDetailed } from './classifier.js';
import { LINKEDIN_PROFILE_ID, LINKEDIN_USERNAME, MAX_POSTS, MAX_SCROLLS, BATCH_SIZE, BACKFILL, MAX_RETRIES } from './config.js';

const BASE_URL = 'https://www.linkedin.com';
const WAIT = (ms) => new Promise(r => setTimeout(r, ms));

export async function scrapeLinkedIn() {
  const { browser, page, gl } = await startBrowser(LINKEDIN_PROFILE_ID);

  try {
    await page.setViewport({ width: 1280, height: 800 });

    console.log('[linkedin] Navigating to activity feed...');
    await page.goto(`${BASE_URL}/in/${LINKEDIN_USERNAME}/recent-activity/all/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await WAIT(5000);

    const url = page.url();
    if (url.includes('/login') || url.includes('/authwall')) {
      throw new Error('LinkedIn session expired — GoLogin profile needs re-authentication');
    }

    // Scroll to load posts
    if (BACKFILL) console.log('[linkedin] Backfill mode — loading more posts...');
    for (let i = 0; i < MAX_SCROLLS; i++) {
      const count = await page.evaluate(() =>
        document.querySelectorAll('.feed-shared-update-v2[data-urn]').length
      );
      if (i % 5 === 0) console.log(`[linkedin] Scroll ${i}: ${count} posts loaded`);
      await page.evaluate(() => window.scrollBy(0, 800));
      await WAIT(2000);
      const newCount = await page.evaluate(() =>
        document.querySelectorAll('.feed-shared-update-v2[data-urn]').length
      );
      if (newCount >= MAX_POSTS) break;
      if (newCount === count && i > 8) break;
    }

    // Extract posts
    const posts = await extractPostData(page);
    console.log(`[linkedin] Found ${posts.length} posts.`);
    if (posts.length === 0) return [];

    // Classify engagement inline
    await page.evaluate(() => window.scrollTo(0, 0));
    await WAIT(1000);

    const postsWithLikes = posts.filter(p => p.totalLikes > 0);
    console.log(`[linkedin] ${postsWithLikes.length} posts have likes to classify.`);

    for (let i = 0; i < postsWithLikes.length; i++) {
      const p = postsWithLikes[i];
      console.log(`[linkedin] Classifying post ${i + 1}/${postsWithLikes.length}: "${p.text?.slice(0, 50)}..." (${p.totalLikes} likes)`);
      await classifyWithRetry(page, p);

      if ((i + 1) % BATCH_SIZE === 0 && i + 1 < postsWithLikes.length) {
        console.log(`[linkedin] Batch pause...`);
        await WAIT(3000);
      }
    }

    // Initialize zero engagement for posts without likes
    for (const p of posts) {
      if (p.likesOutsideTeam === undefined) {
        p.likesOutsideTeam = 0;
        p.commentsOutsideTeam = 0;
        p.repostsOutsideTeam = 0;
        p.segmentLikes = {};
      }
    }

    return posts;
  } finally {
    await stopBrowser(browser, gl);
  }
}

/**
 * Extract basic metrics from all loaded posts on the activity feed.
 */
async function extractPostData(page) {
  // Get the current date for converting relative labels
  const nowMs = Date.now();

  return page.evaluate((maxPosts, nowMs) => {
    const results = [];
    const feedItems = document.querySelectorAll('.feed-shared-update-v2[data-urn]');

    for (const item of feedItems) {
      if (results.length >= maxPosts) break;

      const textEl =
        item.querySelector('.update-components-text .break-words') ||
        item.querySelector('.feed-shared-text .break-words');
      const text = textEl?.innerText?.trim()?.slice(0, 300) || '';
      if (!text) continue;

      const urn = item.getAttribute('data-urn') || '';
      const postUrl = urn ? `https://www.linkedin.com/feed/update/${urn}/` : '';

      // Reactions count
      let totalLikes = 0;
      const fallbackNum = item.querySelector('.social-details-social-counts__social-proof-fallback-number');
      if (fallbackNum) {
        totalLikes = parseInt(fallbackNum.innerText?.replace(/[^0-9]/g, ''), 10) || 0;
      } else {
        const singleCount = item.querySelector('.social-details-social-counts__reactions-count');
        if (singleCount) {
          totalLikes = parseInt(singleCount.innerText?.replace(/[^0-9]/g, ''), 10) || 0;
        }
      }

      // Comments
      let totalComments = 0;
      for (const btn of item.querySelectorAll('button')) {
        const label = btn.getAttribute('aria-label') || '';
        if (label.includes('comment')) {
          totalComments = parseInt(label.replace(/[^0-9]/g, ''), 10) || 0;
          break;
        }
      }

      // Reposts
      let totalReposts = 0;
      for (const btn of item.querySelectorAll('button')) {
        const label = btn.getAttribute('aria-label') || '';
        if (label.includes('repost')) {
          totalReposts = parseInt(label.replace(/[^0-9]/g, ''), 10) || 0;
          break;
        }
      }

      // Impressions
      let impressions = 0;
      const impEl = item.querySelector('.ca-entry-point__num-views');
      if (impEl) {
        impressions = parseInt(impEl.innerText?.replace(/[^0-9]/g, ''), 10) || 0;
      }

      // Date — three sources, in order of accuracy:
      //   1. <time datetime="..."> — exact ISO timestamp LinkedIn embeds for
      //      accessibility on some posts. Always prefer this when present.
      //   2. Absolute date string (e.g. "April 18, 2026") — older posts.
      //   3. Relative label ("1w", "2d", "3mo") — fallback for recent posts.
      //      This is imprecise: "1w" means 7-13 days old, we round to 7.
      let date = '';

      // 1. <time datetime>
      const timeEl = item.querySelector('time[datetime]');
      const datetimeAttr = timeEl?.getAttribute('datetime');
      if (datetimeAttr) {
        const parsed = new Date(datetimeAttr);
        if (!isNaN(parsed.getTime())) {
          date = parsed.toISOString().slice(0, 10);
        }
      }

      // 2 + 3. Fallback to the displayed text
      if (!date) {
        const dateSpan = item.querySelector('.update-components-actor__sub-description span');
        const rawDate = dateSpan?.innerText?.trim() || '';
        date = rawDate;

        const relMatch = rawDate.match(/(\d+)\s*(mo|h|d|w|m)\b/i);
        if (relMatch) {
          const n = parseInt(relMatch[1], 10);
          const unit = relMatch[2].toLowerCase();
          const msMap = { h: 3600000, d: 86400000, w: 604800000, mo: 2592000000, m: 60000 };
          const postTime = new Date(nowMs - n * (msMap[unit] || 0));
          date = postTime.toISOString().slice(0, 10);
        } else if (rawDate) {
          const parsed = new Date(rawDate);
          if (!isNaN(parsed.getTime())) {
            date = parsed.toISOString().slice(0, 10);
          }
        }
      }

      results.push({
        urn,
        text,
        url: postUrl,
        date,
        impressions,
        totalLikes,
        totalComments,
        totalReposts,
      });
    }

    return results;
  }, MAX_POSTS, nowMs);
}

/**
 * Classify engagement with retry logic (spec: 3 retries).
 */
async function classifyWithRetry(page, post) {
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await classifyPostInline(page, post);
      if (result === 'no_button' || result === 'no_modal') {
        if (attempt < MAX_RETRIES) {
          console.log(`[linkedin]   Retry ${attempt}/${MAX_RETRIES}...`);
          await WAIT(2000);
          continue;
        }
        // After all retries, flag it
        post.flags = `⚠️ ${result} after ${MAX_RETRIES} retries`;
        console.warn(`[linkedin]   ${post.flags}`);
        return;
      }
      return; // success
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        console.log(`[linkedin]   Retry ${attempt}/${MAX_RETRIES} after error: ${err.message}`);
        await WAIT(2000);
      }
    }
  }

  // All retries exhausted
  post.flags = `⚠️ Failed after ${MAX_RETRIES} retries: ${lastErr?.message || 'unknown'}`;
  console.warn(`[linkedin]   ${post.flags}`);
}

/**
 * Classify engagement for a post INLINE on the activity feed page.
 * Returns 'success', 'no_button', or 'no_modal' for retry logic.
 */
async function classifyPostInline(page, post) {
  post.likesOutsideTeam = 0;
  post.commentsOutsideTeam = 0;
  post.repostsOutsideTeam = 0;
  post.segmentLikes = {};

  if (post.totalLikes === 0) return 'success';

  const scrolled = await page.evaluate((urn) => {
    const el = document.querySelector(`[data-urn="${urn}"]`);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    return true;
  }, post.urn);

  if (!scrolled) return 'no_button';
  await WAIT(1000);

  const clicked = await page.evaluate((urn) => {
    const postEl = document.querySelector(`[data-urn="${urn}"]`);
    if (!postEl) return false;
    const btn =
      postEl.querySelector('.social-details-social-counts__social-proof-fallback-number') ||
      postEl.querySelector('.social-details-social-counts__reactions-count') ||
      postEl.querySelector('.social-details-social-counts__social-proof-container');
    if (!btn) return false;
    const clickTarget = btn.closest('button') || btn;
    clickTarget.click();
    return true;
  }, post.urn);

  if (!clicked) return 'no_button';
  await WAIT(2500);

  const modalFound = await waitForSelector(page, '[role="dialog"], .artdeco-modal', 8000);
  if (!modalFound) return 'no_modal';

  // Smart scroll: track entry count, not just scroll position
  let stale = 0;
  let prevCount = 0;
  for (let i = 0; i < 50; i++) {
    await page.evaluate(() => {
      const content = document.querySelector('.artdeco-modal__content, [role="dialog"] [class*="content"]');
      if (content) content.scrollTop = content.scrollHeight;
    });
    await WAIT(1500);

    const currentCount = await page.evaluate(() => {
      const modal =
        document.querySelector('.artdeco-modal--layer-default') ||
        document.querySelector('.artdeco-modal[role="dialog"]');
      if (!modal) return 0;
      return modal.querySelectorAll('.artdeco-entity-lockup').length;
    });

    if (currentCount === prevCount) {
      stale++;
      if (stale >= 3) break; // 3 consecutive checks with no new entries
    } else {
      stale = 0;
    }
    prevCount = currentCount;
  }

  // Extract reactors — dedup by profile URL, not display name
  const engagers = await page.evaluate(() => {
    const modal =
      document.querySelector('.artdeco-modal--layer-default') ||
      document.querySelector('.artdeco-modal[role="dialog"]') ||
      document.querySelector('.social-details-reactors-modal');
    if (!modal) return [];

    const results = [];
    const seenUrls = new Set();
    const seenNames = new Set();

    const items = modal.querySelectorAll(
      '.artdeco-entity-lockup, [class*="reactor-list"] li'
    );

    for (const item of items) {
      const nameEl =
        item.querySelector('.artdeco-entity-lockup__title a span') ||
        item.querySelector('.artdeco-entity-lockup__title span');
      const headlineEl =
        item.querySelector('.artdeco-entity-lockup__subtitle') ||
        item.querySelector('.artdeco-entity-lockup__caption');
      const profileLink = item.querySelector('a[href*="/in/"]');

      const name = nameEl?.innerText?.trim() || '';
      const headline = headlineEl?.innerText?.trim() || '';
      const profileUrl = profileLink?.getAttribute('href') || '';

      if (!name || name === 'LinkedIn Member') continue;

      // Dedup by profile URL first, fall back to name
      const dedupeKey = profileUrl || name;
      if (profileUrl && seenUrls.has(profileUrl)) continue;
      if (!profileUrl && seenNames.has(name)) continue;

      if (profileUrl) seenUrls.add(profileUrl);
      else seenNames.add(name);

      results.push({ name, headline, profileUrl });
    }
    return results;
  });

  console.log(`[linkedin]   Found ${engagers.length} reactors (of ${post.totalLikes} total likes).`);

  const { counts, classified: classifiedEngagers } = classifyAllDetailed(engagers);

  // Cap by public total minus team — same invariant as twitter.js. Math.max
  // alone trusts noisy modal extraction over the public counter and can
  // produce likesOutsideTeam > totalLikes if duplicates or non-reactor
  // lockups slip through.
  post.likesOutsideTeam = Math.min(
    Math.max(post.totalLikes - counts.teamCount, 0),
    counts.outsideTeam
  );
  post.segmentLikes = counts.byCategory;
  post.engagers = classifiedEngagers; // for detail tab

  // Comments/reposts outside team: use total minus estimated team overlap.
  // Guard div-by-zero when modal returned 0 engagers (else NaN cells in sheet).
  const teamRatio = engagers.length > 0 ? counts.teamCount / engagers.length : 0;
  post.commentsOutsideTeam = Math.round(post.totalComments * (1 - teamRatio));
  post.repostsOutsideTeam = Math.round(post.totalReposts * (1 - teamRatio));

  const classifiedCount = Object.values(counts.byCategory).reduce((s, n) => s + n, 0);
  const unclassified = post.likesOutsideTeam - classifiedCount;
  if (unclassified > 0) {
    post.flags = `⚠️ Retrieved ${engagers.length} of ${post.totalLikes} — ${unclassified} unclassified`;
    console.log(`[linkedin]   ${post.flags}`);
  }

  // Close modal
  const closeBtn = await page.$(
    'button[aria-label="Dismiss"], button[aria-label="Close"], button.artdeco-modal__dismiss'
  );
  if (closeBtn) await closeBtn.click();
  await WAIT(1000);

  return 'success';
}
