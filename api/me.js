// Who am I, and which spaces may I enter? The shell builds its nav from this.

import { requireAuth } from '../lib/auth.js';

export default async function handler(req, res) {
  try {
    const user = await requireAuth(req);
    return res.status(200).json({ ok: true, ...user });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}
