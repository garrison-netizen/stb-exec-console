// One-time migration (2026-07-09): draft-hold retired. Strips the
// '🤖 Operator draft' label from every existing UB Task that carries it,
// using the same releaseDraftTask write the Console's Release button used.
// Run: node scripts/retire-draft-hold.mjs [--live]
import { config } from 'dotenv';
config();

const { listDraftTasks, releaseDraftTask } = await import('../lib/notionCore.js');

const live = process.argv.includes('--live');
const drafts = await listDraftTasks(100);
console.log(`${drafts.length} task(s) carry the draft label${live ? '' : ' (dry run — pass --live to strip)'}`);

for (const t of drafts) {
  if (!live) {
    console.log(`  would release: ${t.name}`);
    continue;
  }
  const r = await releaseDraftTask({ pageId: t.id });
  console.log(`  released: ${t.name} (labels ${r.labelsBefore.length} → ${r.labelsAfter.length})`);
}

if (live) {
  const remaining = await listDraftTasks(100);
  console.log(`verify: ${remaining.length} task(s) still labeled (expect 0)`);
}
