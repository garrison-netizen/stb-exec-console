// One serverless function for every dashboard surface (?space=...), keeping
// the deployment inside Vercel's function budget. Mirrors the dev middleware
// in notion-plugin.js.
//
// Per-space access: 'Exec' = still being dialed in (Garrison only); a
// department tag = signed off and open to that department's holders.
// Events + Coffee opened 2026-07-22 (Garrison: "turn on the dashboards for
// Marin").

import { requireSpace } from '../lib/auth.js';

const SPACES = {
  events: { tag: 'Events', load: async (force) => (await import('../lib/eventsCore.js')).eventsDashboard({ force }) },
  production: { tag: 'Exec', load: async () => (await import('../lib/productionDashCore.js')).productionDashboard() },
  marketing: { tag: 'Exec', load: async (force) => (await import('../lib/marketingCore.js')).marketingDashboard({ force }) },
  sales: { tag: 'Exec', load: async (force) => (await import('../lib/salesCore.js')).salesDashboard({ force }) },
  finances: { tag: 'Exec', load: async () => (await import('../lib/financeCore.js')).financesDashboard() },
  coffee: { tag: 'Coffee', load: async () => (await import('../lib/coffeeCore.js')).coffeeDashboard() },
  taproom: { tag: 'Exec', load: async (force) => (await import('../lib/taproomCore.js')).taproomDashboard({ force }) },
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const space = String(req.query.space || '').toLowerCase();
  const def = SPACES[space];
  if (!def) {
    return res.status(400).json({ ok: false, error: 'Unknown dashboard: ' + space });
  }
  try {
    await requireSpace(req, def.tag);
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
  try {
    const model = await def.load(req.query.refresh === '1');
    return res.status(200).json({ ok: true, ...model });
  } catch (err) {
    const msg = (err && err.message) || String(err); // sql.js throws strings
    console.error(`[/api/dashboards ${space}] error:`, msg);
    return res.status((err && err.status) || 500).json({ ok: false, error: msg });
  }
}
