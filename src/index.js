import { scrapeLinkedIn } from './linkedin.js';
import { scrapeTwitter } from './twitter.js';
import { writeToSheet, writeDetailSheet, verifyIntegrity, loadSegmentsFromSheet, setSegments } from './sheets.js';
import { loadExcludedFromSheet } from './excluded.js';
import { initSegments, initExcluded } from './classifier.js';

const args = process.argv.slice(2);
const platform = args.find(a => a.startsWith('--platform='))?.split('=')[1]
  || (args.includes('--platform') ? args[args.indexOf('--platform') + 1] : 'all');

async function main() {
  console.log(`\n=== smm-analytics ===`);
  console.log(`Platform: ${platform}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  const results = { linkedin: null, twitter: null };

  try {
    // Bootstrap: load segments + excluded list from the user's Sheet.
    // Both auto-create their tab with sensible defaults on first run.
    const segments = await loadSegmentsFromSheet();
    initSegments(segments);
    setSegments(segments);

    const excluded = await loadExcludedFromSheet();
    initExcluded(excluded);

    // LinkedIn
    if (platform === 'all' || platform === 'linkedin') {
      console.log('--- LinkedIn ---');
      const posts = await scrapeLinkedIn();
      console.log(`[linkedin] Scraped ${posts.length} posts.`);

      const errors = verifyIntegrity(posts);
      if (errors.length) {
        console.warn('[linkedin] Data integrity issues:');
        errors.forEach(e => console.warn(`  ⚠️  ${e}`));
      }

      await writeToSheet('LinkedIn', posts);
      await writeDetailSheet('LinkedIn', posts);
      results.linkedin = posts.length;
    }

    // X / Twitter
    if (platform === 'all' || platform === 'twitter') {
      console.log('\n--- X / Twitter ---');
      const posts = await scrapeTwitter();
      console.log(`[twitter] Scraped ${posts.length} posts.`);

      const errors = verifyIntegrity(posts);
      if (errors.length) {
        console.warn('[twitter] Data integrity issues:');
        errors.forEach(e => console.warn(`  ⚠️  ${e}`));
      }

      await writeToSheet('X', posts);
      await writeDetailSheet('X', posts);
      results.twitter = posts.length;
    }

    console.log('\n=== Done ===');
    if (results.linkedin !== null) console.log(`LinkedIn: ${results.linkedin} posts`);
    if (results.twitter !== null) console.log(`X / Twitter: ${results.twitter} posts`);
    console.log(`Sheet: https://docs.google.com/spreadsheets/d/${process.env.SHEET_ID}`);
    console.log(`Finished: ${new Date().toISOString()}`);

  } catch (err) {
    console.error(`\n❌ Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
