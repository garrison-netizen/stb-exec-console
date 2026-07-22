// One serverless function for every dashboard surface (?space=...), keeping
// the deployment inside Vercel's function budget. Mirrors the dev middleware
// in notion-plugin.js.
//
// All dashboards are Exec-only while being dialed in (2026-07-21); when a
// dashboard is signed off for its department, move its case into SPACE_GUARD
// with the department tag.

import { requireSpace } from '../lib/auth.js';

const SPACES = {
  events: async (force) => (await import('../lib/eventsCore.js')).eventsDashboard({ force }),
  production: async () => (await import('../lib/productionDashCore.js')).productionDashboard(),
  marketing: async (force) => (await import('../lib/marketingCore.js')).marketingDashboard({ force }),
  sales: async (force) => (await import('../lib/salesCore.js')).salesDashboard({ force }),
  finances: async () => (await import('../lib/financeCore.js')).financesDashboard(),
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const space = String(req.query.space || '').toLowerCase();
  const loader = SPACES[space];
  if (!loader) {
    return res.status(400).json({ ok: false, error: 'Unknown dashboard: ' + space });
  }
  try {
    await requireSpace(req, 'Exec');
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
  try {
    const model = await loader(req.query.refresh === '1');
    return res.status(200).json({ ok: true, ...model });
  } catch (err) {
    const msg = (err && err.message) || String(err); // sql.js throws strings
    console.error(`[/api/dashboards ${space}] error:`, msg);
    return res.status((err && err.status) || 500).json({ ok: false, error: msg });
  }
}
