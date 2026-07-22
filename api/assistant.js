// One serverless function for every department assistant (?space=...),
// keeping the deployment inside Vercel's function budget. Mirrors the dev
// middleware in notion-plugin.js. Each space keeps its own access tag.

import { requireSpace } from '../lib/auth.js';

const SPACES = {
  production: {
    tag: 'Production',
    handle: async (body, email) => (await import('../lib/chatCore.js')).handleChat(body, email),
  },
  events: {
    tag: 'Events',
    handle: async (body, email) => (await import('../lib/eventsChatCore.js')).handleEventsChat(body, email),
  },
  sales: {
    tag: 'Sales',
    handle: async (body, email) => (await import('../lib/salesChatCore.js')).handleSalesChat(body, email),
  },
  taproom: {
    tag: 'Taproom',
    handle: async (body, email) => (await import('../lib/taproomChatCore.js')).handleTaproomChat(body, email),
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const space = String(req.query.space || '').toLowerCase();
  const def = SPACES[space];
  if (!def) {
    return res.status(400).json({ ok: false, error: 'Unknown assistant: ' + space });
  }
  let user;
  try {
    user = await requireSpace(req, def.tag);
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
  try {
    const result = await def.handle(req.body, user.email);
    return res.status(200).json(result);
  } catch (err) {
    const msg = (err && err.message) || String(err); // sql.js throws strings
    console.error(`[/api/assistant ${space}] error:`, msg);
    return res.status((err && err.status) || 500).json({ ok: false, error: msg });
  }
}
