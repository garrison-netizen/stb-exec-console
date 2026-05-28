// CLI runner for the Capture Classifier (one polling pass).
//
// Usage:
//   node scripts/run-classifier.js              # live run, writes to Notion
//   node scripts/run-classifier.js --dry-run    # plan only, no writes
//
// Loads .env via dotenv so the script works outside the dev server too.

import 'dotenv/config';
import { runOnePass } from '../lib/operators/classifier.js';

const dryRun = process.argv.includes('--dry-run');

(async () => {
  console.log(`[Classifier] Starting one pass${dryRun ? ' (DRY RUN)' : ''} at ${new Date().toISOString()}`);
  try {
    const result = await runOnePass({ dryRun });
    console.log(`[Classifier] Polled ${result.rowCount} rows.`);
    for (const r of result.results) {
      if (r.error) {
        console.error(`  ✗ ${r.row.id} — error: ${r.error}`);
        continue;
      }
      const { row, result: classification, applied } = r;
      console.log(`  ${applied ? '✓' : '·'} ${row.id.slice(0, 8)} "${(row.title || row.body || '').slice(0, 60)}…"`);
      console.log(`     → type=${classification.captureType} domain=${classification.captureDomain || '-'} confidence=${classification.confidence} via=${classification.via}`);
      if (classification.suggestedProject) console.log(`     → suggested project: "${classification.suggestedProject}"`);
      if (classification.matched) console.log(`     → matched cues: ${classification.matched.join(', ')}`);
    }
    console.log(`[Classifier] Done.`);
  } catch (err) {
    console.error(`[Classifier] FATAL: ${err.message}`);
    process.exit(1);
  }
})();
