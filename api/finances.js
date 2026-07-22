// Vercel serverless function for the Finances snapshot (Exec-only surface).
// Mirrors the dev middleware in notion-plugin.js.

import { financesDashboard } from '../lib/financeCore.js';
import { requireSpace } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    await requireSpace(req, 'Exec');
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
  try {
    const model = await financesDashboard();
    return res.status(200).json({ ok: true, ...model });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.error('[/api/finances] error:', msg);
    return res.status((err && err.status) || 500).json({ ok: false, error: msg });
  }
}
