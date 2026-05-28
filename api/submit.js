// Vercel serverless function for production.
// Mirrors the dev middleware in notion-plugin.js — same handler logic via the
// shared lib/notionCore.js dispatch.

import { dispatchSubmission } from '../lib/notionCore.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    const result = await dispatchSubmission(req.body);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[/api/submit] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
