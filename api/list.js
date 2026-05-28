// Vercel serverless function for production list reads.
// Mirrors the dev middleware in notion-plugin.js.

import { dispatchList } from '../lib/notionCore.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const { kind, limit } = req.query;
  if (!kind) {
    return res.status(400).json({ ok: false, error: 'missing kind param' });
  }
  try {
    const items = await dispatchList(kind, limit ? Number(limit) : undefined);
    return res.status(200).json({ ok: true, kind, count: items.length, items });
  } catch (err) {
    console.error('[/api/list] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
