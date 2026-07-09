// One-off probe: verify the Console integration can query the DSs being
// de-mocked (Company Rocks, Decision Pipeline, Pending Work, Reconcile Log).
// Read-only. Run: node scripts/probe-demock.mjs
import { config } from 'dotenv';
config();

const TOKEN = process.env.NOTION_TOKEN;
const targets = [
  ['Company Rocks', process.env.NOTION_ROCKS_DS],
  ['Decision Pipeline', process.env.NOTION_DECISION_PIPELINE_DS],
  ['Pending Work', process.env.NOTION_PENDING_WORK_DS],
  ['Reconciliation Log', process.env.NOTION_RECONCILE_LOG_DS],
];

for (const [name, ds] of targets) {
  if (!ds) { console.log(`${name}: ENV VAR MISSING`); continue; }
  const res = await fetch(`https://api.notion.com/v1/data_sources/${ds}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 3 }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.log(`${name}: FAIL ${res.status} — ${text.slice(0, 200)}`);
    continue;
  }
  const data = await res.json();
  const first = data.results?.[0];
  const titleProp = first
    ? Object.values(first.properties).find((p) => p.type === 'title')
    : null;
  const title = titleProp?.title?.map((t) => t.plain_text).join('') || '(empty)';
  console.log(`${name}: OK — ${data.results.length} row(s) sampled; first: "${title.slice(0, 70)}"`);
}
