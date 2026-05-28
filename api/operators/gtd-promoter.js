// Vercel serverless endpoint — GTD Promoter one-pass trigger.
// Called on a schedule (GitHub Actions cron). Requires shared-secret auth.
//
// Endpoint: POST /api/operators/gtd-promoter
// Headers:  Authorization: Bearer <CRON_SECRET>
// Body:     { dryRun?: boolean }
// Returns:  { ok, polledAt, rowCount, results }
//
// 15-minute cadence per ADR-007 §7. Single-instance — never invoke in
// parallel (race on Capture Inbox status flips). GitHub Actions cron is
// serialized per workflow, so this holds as long as we don't add a second
// scheduler.

import { runOnePass } from '../../lib/operators/gtdPromoter.js';

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
    console.error('[/api/operators/gtd-promoter] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
