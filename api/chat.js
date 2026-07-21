// Production space chatbot endpoint. Requires the Production space (or Exec).

import { requireSpace } from '../lib/auth.js';
import { handleChat } from '../lib/chatCore.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    const user = await requireSpace(req, 'Production');
    const result = await handleChat(req.body, user.email);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[/api/chat] error:', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}
