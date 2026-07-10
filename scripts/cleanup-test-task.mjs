// One-off: verify then archive the add/edit test task created during the
// 2026-07-10 Console add/edit verification. Matches by exact test title.
import { config } from 'dotenv';
config();

const TOKEN = process.env.NOTION_TOKEN;
const DS = process.env.NOTION_UB_TASKS_DS;

const res = await fetch(`https://api.notion.com/v1/data_sources/${DS}/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Notion-Version': '2025-09-03',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    filter: { property: 'Name', title: { contains: 'Console add/edit test' } },
  }),
});
const data = await res.json();
const rows = data.results || [];
console.log(`matched ${rows.length} row(s)`);

for (const r of rows) {
  const name = r.properties.Name.title.map((t) => t.plain_text).join('');
  const priority = r.properties.Priority?.status?.name;
  const due = r.properties.Due?.date?.start;
  const labels = (r.properties.Labels?.multi_select || []).map((s) => s.name).join(', ');
  console.log(`  "${name}" — Priority=${priority} Due=${due} Labels=[${labels}]`);
  const arch = await fetch(`https://api.notion.com/v1/pages/${r.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ archived: true }),
  });
  console.log(`  archived: ${arch.ok}`);
}
