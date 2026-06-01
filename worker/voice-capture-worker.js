// Voice Capture Worker — ADR-008.
//
// Tiny Cloudflare Worker that accepts a webhook from a voice-transcription
// app (Whisper Memos / SuperWhisper / anything that does POST + transcript)
// and writes a Capture Inbox row in Garrison's Personal Dashboard. The row
// lands with Capture type empty so the Classifier (ADR-009) picks it up next
// pass and the Promoter (ADR-007) routes it to UB Tasks/Notes/Projects.
//
// Why a separate Cloudflare Worker instead of a Vercel route on the Console:
// per Architect, capture must never fail. The Console redeploys constantly;
// if a Console deploy is mid-rollback or broken, a voice memo captured at
// that moment would vanish. The Worker is isolated, ~80 lines, free at
// expected volume, and has its own deploy lifecycle.
//
// Env vars required (set via wrangler secret or the CF dashboard):
//   NOTION_TOKEN              — same token the Console uses; needs write
//                               access to the Capture Inbox database
//   NOTION_CAPTURE_INBOX_DS   — 6a008419-485f-4c2e-b162-895090931abb
//   WORKER_SECRET             — shared secret for inbound auth; voice app
//                               passes "Authorization: Bearer <secret>"
//
// Endpoint contract:
//   POST /
//   Headers:
//     Authorization: Bearer <WORKER_SECRET>
//     Content-Type:  application/json
//   Body shape (any one of these field names works):
//     { "text": "transcript here" }
//     { "transcript": "transcript here" }
//     { "body": "transcript here" }
//   Optional fields the Worker reads if present:
//     { "source": "label override" }   — defaults to "Voice capture via Whisper Memos"
//     { "duration": "00:00:12" }       — appended to Source for context
//
// Response:
//   200 { ok: true, id, url, length }
//   400 { ok: false, error: "missing transcript" }
//   401 { ok: false, error: "unauthorized" }
//   500 { ok: false, error: "<notion api error>" }

export default {
  async fetch(request, env) {
    // Health check
    if (request.method === 'GET') {
      return json(200, {
        ok: true,
        worker: 'voice-capture',
        message: 'POST with Authorization: Bearer <WORKER_SECRET> to capture.',
      });
    }
    if (request.method !== 'POST') {
      return json(405, { ok: false, error: 'method not allowed' });
    }

    // Auth
    const auth = request.headers.get('authorization') || '';
    const expected = `Bearer ${env.WORKER_SECRET}`;
    if (!env.WORKER_SECRET || auth !== expected) {
      return json(401, { ok: false, error: 'unauthorized' });
    }

    // Parse body
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json(400, { ok: false, error: 'invalid JSON body' });
    }

    const transcript =
      payload?.text ||
      payload?.transcript ||
      payload?.body ||
      '';
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
      return json(400, { ok: false, error: 'missing transcript (expected text / transcript / body field)' });
    }

    // Compose Source label
    const baseSource = payload?.source || 'Voice capture via Whisper Memos';
    const durationSuffix = payload?.duration ? ` (${payload.duration})` : '';
    const source = `${baseSource}${durationSuffix} — ${new Date().toISOString()}`;

    // Write Capture Inbox row
    try {
      const result = await createCaptureInboxRow(env, transcript, source);
      return json(200, {
        ok: true,
        id: result.id,
        url: result.url,
        length: transcript.length,
      });
    } catch (err) {
      return json(500, { ok: false, error: err.message || 'notion write failed' });
    }
  },
};

async function createCaptureInboxRow(env, transcript, source) {
  if (!env.NOTION_TOKEN) throw new Error('NOTION_TOKEN not set');
  if (!env.NOTION_CAPTURE_INBOX_DS) throw new Error('NOTION_CAPTURE_INBOX_DS not set');

  const now = new Date().toISOString();
  const body = {
    parent: { type: 'data_source_id', data_source_id: env.NOTION_CAPTURE_INBOX_DS },
    properties: {
      // Title left empty — Classifier fills it from the transcript
      Body: { rich_text: [{ text: { content: transcript.slice(0, 2000) } }] },
      'Captured by': { select: { name: 'Garrison' } },
      'Date captured': { date: { start: now } },
      'Promotion status': { select: { name: 'Pending promotion' } },
      Source: { rich_text: [{ text: { content: source } }] },
    },
  };

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`notion ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();

  // If the transcript was truncated for the Body property (2000-char limit),
  // append the rest as page-body paragraphs so nothing is lost.
  if (transcript.length > 2000) {
    const overflow = transcript.slice(2000);
    const paragraphs = overflow.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const children = paragraphs.map((p) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: p } }] },
    }));
    if (children.length > 0) {
      await fetch(`https://api.notion.com/v1/blocks/${data.id}/children`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${env.NOTION_TOKEN}`,
          'Notion-Version': '2025-09-03',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ children }),
      });
    }
  }

  return { id: data.id, url: data.url };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
