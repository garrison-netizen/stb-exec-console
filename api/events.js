// Vercel serverless function for the Events space dashboard.
// Mirrors the dev middleware in notion-plugin.js.

import { eventsDashboard } from '../lib/eventsCore.js';
import { requireSpace } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    await requireSpace(req, 'Events');
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
  try {
    const model = await eventsDashboard({ force: req.query.refresh === '1' });
    return res.status(200).json({ ok: true, ...model });
  } catch (err) {
    console.error('[/api/events] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
