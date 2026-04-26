import { startBrowser, stopBrowser, autoScroll, waitForSelector } from './browser.js';
import { classifyAllDetailed } from './classifier.js';
import { TWITTER_PROFILE_ID, TWITTER_USERNAME, MAX_POSTS, BATCH_SIZE, MAX_RETRIES } from './config.js';

const WAIT = (ms) => new Promise(r => setTimeout(r, ms));

export async function scrapeTwitter() {
  const { browser, page, gl } = await startBrowser(TWITTER_PROFILE_ID);

  try {
    console.log('[twitter] Navigating to profile...');
    await page.goto(`https://x.com/${TWITTER_USERNAME}`, {
      waitUntil: 'networkidle2',
    });
    await WAIT(3000);

    const url = page.url();
    if (url.includes('/login') || url.includes('/i/flow/login')) {
      throw new Error('X session expired — GoLogin profile needs re-authentication');
    }

    await autoScroll(page, 10);

    const posts = await page.evaluate((maxPosts) => {
      const results = [];
      const tweets = document.querySelectorAll(
        'article[data-testid="tweet"], [data-testid="cellInnerDiv"] article'
      );

      for (const tweet of tweets) {
        if (results.length >= maxPosts) break;

        const textEl = tweet.querySelector('[data-testid="tweetText"]');
        const text = textEl?.innerText?.trim()?.slice(0, 300) || '';
        if (!text) continue;
        // Skip Vova's citation-reply tweets ("Sources: link1 link2…"), which
        // are follow-ups to a parent thread tweet and pure noise on their own.
        if (/^sources?\s*:/i.test(text)) continue;

        const timeLink = tweet.querySelector('a[href*="/status/"] time')?.closest('a');
        const postUrl = timeLink ? `https://x.com${timeLink.getAttribute('href')}` : '';

        const timeEl = tweet.querySelector('time');
        const date = timeEl?.getAttribute('datetime')?.slice(0, 10) || ''; // YYYY-MM-DD

        const metricsBar = tweet.querySelector('[role="group"]');
        let totalLikes = 0, totalComments = 0, totalReposts = 0, impressions = 0;

        if (metricsBar) {
          for (const btn of metricsBar.querySelectorAll('button')) {
            const label = btn.getAttribute('aria-label') || '';
            const num = parseInt(label.replace(/[^0-9]/g, ''), 10) || 0;
            if (label.toLowerCase().includes('repl')) totalComments = num;
            else if (label.toLowerCase().includes('repost') || label.toLowerCase().includes('retweet')) totalReposts = num;
            else if (label.toLowerCase().includes('like')) totalLikes = num;
            else if (label.toLowerCase().includes('view')) impressions = num;
          }
        }

        results.push({ text, url: postUrl, date, impressions, totalLikes, totalComments, totalReposts });
      }

      return results;
    }, MAX_POSTS);

    console.log(`[twitter] Found ${posts.length} posts.`);

    for (let i = 0; i < posts.length; i++) {
      console.log(`[twitter] Processing post ${i + 1}/${posts.length}: "${posts[i].text?.slice(0, 50)}..."`);
      await scrapePostLikesWithRetry(page, posts[i]);

      if ((i + 1) % BATCH_SIZE === 0 && i + 1 < posts.length) {
        console.log(`[twitter] Batch pause...`);
        await WAIT(5000);
      }
    }

    return posts;
  } finally {
    await stopBrowser(browser, gl);
  }
}

/**
 * Scrape likes with retry logic (spec: 3 retries + explicit flagging).
 */
async function scrapePostLikesWithRetry(page, post) {
  post.likesOutsideTeam = 0;
  post.commentsOutsideTeam = 0;
  post.repostsOutsideTeam = 0;
  post.segmentLikes = {};

  if (!post.url || post.totalLikes === 0) return;

  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const likesUrl = post.url + '/likes';
      await page.goto(likesUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await WAIT(2000);

      await autoScroll(page, 5, 1500);

      const engagers = await page.evaluate(() => {
        const results = [];
        const seen = new Set();
        // Only UserCell — cellInnerDiv is a generic wrapper that also
        // matches sidebar / "Who to follow" cards on the /likes page.
        const userCells = document.querySelectorAll('[data-testid="UserCell"]');

        for (const cell of userCells) {
          const nameEl = cell.querySelector(
            '[data-testid="User-Name"] a span, a[role="link"] span'
          );
          const bioEl = cell.querySelector(
            '[data-testid="UserDescription"], [dir="auto"]:last-of-type'
          );
          const profileLink = cell.querySelector('a[href*="/"][role="link"]');

          const name = nameEl?.innerText?.trim() || '';
          const headline = bioEl?.innerText?.trim() || '';
          const profileUrl = profileLink?.getAttribute('href') || '';

          // Dedup by profile URL
          const key = profileUrl || name;
          if (name && !name.startsWith('@') && !seen.has(key)) {
            seen.add(key);
            results.push({ name, headline, profileUrl });
          }
        }

        return results;
      });

      console.log(`[twitter]   Found ${engagers.length} likers.`);

      // Sanity check: if the post has likes but the selector found zero
      // UserCells, X likely changed its DOM. Throw so the retry loop kicks in
      // instead of silently writing zeros to the sheet.
      if (engagers.length === 0 && post.totalLikes > 0) {
        throw new Error(`UserCell selector miss: 0 engagers but ${post.totalLikes} expected`);
      }

      const { counts, classified } = classifyAllDetailed(engagers);
      // Cap by total likes minus team — the post's public like count is the
      // ground truth. Math.max alone used to inflate the count when the
      // /likes page returned more cells than actual likers (sidebar leak).
      post.likesOutsideTeam = Math.min(
        Math.max(post.totalLikes - counts.teamCount, 0),
        counts.outsideTeam
      );
      post.segmentLikes = counts.byCategory;
      post.engagers = classified;
      // Guard div-by-zero: if 0 engagers retrieved, no team estimate possible.
      const teamRatio = engagers.length > 0 ? counts.teamCount / engagers.length : 0;
      post.commentsOutsideTeam = Math.round(post.totalComments * (1 - teamRatio));
      post.repostsOutsideTeam = Math.round(post.totalReposts * (1 - teamRatio));

      await page.goBack({ waitUntil: 'networkidle2' }).catch(() => {});
      await WAIT(1000);
      return; // success

    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        console.log(`[twitter]   Retry ${attempt}/${MAX_RETRIES}: ${err.message}`);
        await WAIT(2000);
      }
    }
  }

  // All retries exhausted
  post.flags = `⚠️ Failed after ${MAX_RETRIES} retries: ${lastErr?.message || 'unknown'}`;
  console.warn(`[twitter]   ${post.flags}`);
}
