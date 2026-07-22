// Vercel serverless function for the Sales space dashboard.
// Mirrors the dev middleware in notion-plugin.js.

import { salesDashboard } from '../lib/salesCore.js';
import { requireSpace } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    // Dashboards are Exec-only while being dialed in (2026-07-21); flip back
    // to requireSpace(req, 'Sales') to open them to the department.
    await requireSpace(req, 'Exec');
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
  try {
    const model = await salesDashboard({ force: req.query.refresh === '1' });
    return res.status(200).json({ ok: true, ...model });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.error('[/api/sales] error:', msg);
    return res.status((err && err.status) || 500).json({ ok: false, error: msg });
  }
}
