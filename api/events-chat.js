// Vercel serverless function for the Events space chatbot.
// Mirrors the dev middleware in notion-plugin.js.

import { handleEventsChat } from '../lib/eventsChatCore.js';
import { requireSpace } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  let user;
  try {
    user = await requireSpace(req, 'Events');
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
  try {
    const result = await handleEventsChat(req.body, user.email);
    return res.status(200).json(result);
  } catch (err) {
    const msg = (err && err.message) || String(err); // sql.js throws strings
    console.error('[/api/events-chat] error:', msg);
    return res.status((err && err.status) || 500).json({ ok: false, error: msg });
  }
}
