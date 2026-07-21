// Vite middleware: mounts API handlers in dev so the React app can call /api/*
// In production, api/*.js are served by Vercel as serverless functions.
//
// We load .env here (server-side only — token never reaches the client).

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function notionDevPlugin() {
  return {
    name: 'notion-dev-api',
    configureServer(server) {
      // Dev user has every space; production resolves this from the allow-list.
      server.middlewares.use('/api/me', (req, res, next) => {
        if (req.method !== 'GET') return next();
        sendJson(res, 200, { ok: true, email: 'dev@local', spaces: ['Exec', 'Production', 'Events'] });
      });

      // Production space chatbot — same engine as api/chat.js in production.
      server.middlewares.use('/api/chat', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const body = await readJson(req);
          const { handleChat } = await import('./lib/chatCore.js');
          const result = await handleChat(body, 'dev@local');
          sendJson(res, 200, result);
        } catch (err) {
          console.error('[dev /api/chat] error:', err.message);
          sendJson(res, err.status || 500, { ok: false, error: err.message });
        }
      });

      server.middlewares.use('/api/submit', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const body = await readJson(req);
          const { dispatchSubmission } = await import('./lib/notionCore.js');
          const result = await dispatchSubmission(body);
          sendJson(res, 200, { ok: true, ...result });
        } catch (err) {
          console.error('[/api/submit] error:', err);
          sendJson(res, 500, { ok: false, error: err.message });
        }
      });

      server.middlewares.use('/api/list', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          const url = new URL(req.url, 'http://localhost');
          const kind = url.searchParams.get('kind');
          const limit = Number(url.searchParams.get('limit')) || undefined;
          if (!kind) {
            return sendJson(res, 400, { ok: false, error: 'missing kind param' });
          }
          const { dispatchList } = await import('./lib/notionCore.js');
          const items = await dispatchList(kind, limit);
          sendJson(res, 200, { ok: true, kind, count: items.length, items });
        } catch (err) {
          console.error('[/api/list] error:', err);
          sendJson(res, 500, { ok: false, error: err.message });
        }
      });

      // Production space dashboard — same core as api/production.js in production.
      server.middlewares.use('/api/production', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          const { productionDashboard } = await import('./lib/productionDashCore.js');
          const model = await productionDashboard();
          sendJson(res, 200, { ok: true, ...model });
        } catch (err) {
          const msg = (err && err.message) || String(err);
          console.error('[dev /api/production] error:', msg);
          sendJson(res, (err && err.status) || 500, { ok: false, error: msg });
        }
      });

      // Events space chatbot — same engine as api/events-chat.js in production.
      server.middlewares.use('/api/events-chat', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const body = await readJson(req);
          const { handleEventsChat } = await import('./lib/eventsChatCore.js');
          const result = await handleEventsChat(body, 'dev@local');
          sendJson(res, 200, result);
        } catch (err) {
          const msg = (err && err.message) || String(err); // sql.js throws strings
          console.error('[dev /api/events-chat] error:', msg);
          sendJson(res, (err && err.status) || 500, { ok: false, error: msg });
        }
      });

      // Events space dashboard — same core as api/events.js in production.
      server.middlewares.use('/api/events', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          const url = new URL(req.url, 'http://localhost');
          const { eventsDashboard } = await import('./lib/eventsCore.js');
          const model = await eventsDashboard({ force: url.searchParams.get('refresh') === '1' });
          sendJson(res, 200, { ok: true, ...model });
        } catch (err) {
          console.error('[dev /api/events] error:', err.message);
          sendJson(res, 500, { ok: false, error: err.message });
        }
      });

      server.middlewares.use('/api/health', (req, res, next) => {
        if (req.method !== 'GET') return next();
        sendJson(res, 200, {
          ok: true,
          time: new Date().toISOString(),
          tokenSet: Boolean(process.env.NOTION_TOKEN),
          dsConfigured: {
            intakeQueue: Boolean(process.env.NOTION_INTAKE_QUEUE_DS),
            openQuestions: Boolean(process.env.NOTION_OPEN_QUESTIONS_DS),
            pendingWork: Boolean(process.env.NOTION_PENDING_WORK_DS),
            channel: Boolean(process.env.NOTION_CHANNEL_DS),
            agentStatus: Boolean(process.env.NOTION_AGENT_STATUS_DS),
            reconcileLog: Boolean(process.env.NOTION_RECONCILE_LOG_DS),
            livingArchive: Boolean(process.env.NOTION_LIVING_ARCHIVE_DS),
          },
        });
      });
    },
  };
}
