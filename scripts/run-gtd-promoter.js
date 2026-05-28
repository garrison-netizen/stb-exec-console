// CLI runner for the GTD Promoter Operator (one polling pass).
//
// Usage:
//   node scripts/run-gtd-promoter.js              # live run, writes to UB
//   node scripts/run-gtd-promoter.js --dry-run    # plan only, no writes
//
// Loads .env via dotenv. Single-instance — don't run two at once.

import 'dotenv/config';
import { runOnePass } from '../lib/operators/gtdPromoter.js';

const dryRun = process.argv.includes('--dry-run');

(async () => {
  console.log(`[Promoter] Starting one pass${dryRun ? ' (DRY RUN)' : ''} at ${new Date().toISOString()}`);
  try {
    const result = await runOnePass({ dryRun });
    console.log(`[Promoter] Polled ${result.rowCount} rows.`);
    for (const r of result.results) {
      if (r.error) {
        console.error(`  ✗ ${r.row.id} — error: ${r.error}`);
        continue;
      }
      const { row, outcome, destination, reason, projectMatch, applied } = r;
      const tag = applied ? (outcome === 'promoted' ? '✓' : outcome === 'bounced' ? '✗' : '⏸') : (outcome === 'would-promote' ? '→' : '·');
      console.log(`  ${tag} ${row.id.slice(0, 8)} "${(row.title || '').slice(0, 60)}…"`);
      console.log(`     → outcome=${outcome} type=${row.captureType}`);
      if (destination && destination.url) console.log(`     → wrote: ${destination.url}`);
      if (projectMatch) {
        if (projectMatch.ambiguous) console.log(`     → project hint matched ${projectMatch.matches.length} rows — left blank`);
        else console.log(`     → project relation: "${projectMatch.name}"`);
      }
      if (reason) console.log(`     → reason: ${reason}`);
    }
    console.log(`[Promoter] Done.`);
  } catch (err) {
    console.error(`[Promoter] FATAL: ${err.message}`);
    process.exit(1);
  }
})();
