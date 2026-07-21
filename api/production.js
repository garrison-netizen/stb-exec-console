// Vercel serverless function for the Production space dashboard.
// Mirrors the dev middleware in notion-plugin.js.

import { productionDashboard } from '../lib/productionDashCore.js';
import { requireSpace } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    await requireSpace(req, 'Production');
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
  try {
    const model = await productionDashboard();
    return res.status(200).json({ ok: true, ...model });
  } catch (err) {
    const msg = (err && err.message) || String(err); // sql.js throws strings
    console.error('[/api/production] error:', msg);
    return res.status((err && err.status) || 500).json({ ok: false, error: msg });
  }
}
