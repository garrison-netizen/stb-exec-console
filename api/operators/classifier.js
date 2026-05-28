// Vercel serverless endpoint — Capture Classifier one-pass trigger.
// Called on a schedule (GitHub Actions cron). Requires shared-secret auth.
//
// Endpoint: POST /api/operators/classifier
// Headers:  Authorization: Bearer <CRON_SECRET>
// Body:     { dryRun?: boolean }
// Returns:  { ok, polledAt, rowCount, results }
//
// 5-minute cadence per ADR-009 §7 (filters: Capture type empty + Pending
// promotion). Singleton — Vercel function invocations are independent but the
// underlying state-flip filter prevents double-classification on collisions.

import { runOnePass } from '../../lib/operators/classifier.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const auth = req.headers.authorization || '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const dryRun = Boolean(req.body?.dryRun);
  try {
    const result = await runOnePass({ dryRun });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[/api/operators/classifier] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
