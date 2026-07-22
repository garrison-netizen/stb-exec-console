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
        sendJson(res, 200, { ok: true, email: 'dev@local', spaces: ['Exec', 'Finances', 'Production', 'Events', 'Taproom', 'Sales', 'Marketing', 'Coffee', 'R&D'] });
      });

      // Dashboards router — same cores as api/dashboards.js in production.
      server.middlewares.use('/api/dashboards', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        const url = new URL(req.url, 'http://localhost');
        const space = String(url.searchParams.get('space') || '').toLowerCase();
        const force = url.searchParams.get('refresh') === '1';
        try {
          let model;
          if (space === 'events') {
            model = await (await import('./lib/eventsCore.js')).eventsDashboard({ force });
          } else if (space === 'production') {
            model = await (await import('./lib/productionDashCore.js')).productionDashboard();
          } else if (space === 'marketing') {
            model = await (await import('./lib/marketingCore.js')).marketingDashboard({ force });
          } else if (space === 'sales') {
            model = await (await import('./lib/salesCore.js')).salesDashboard({ force });
          } else if (space === 'finances') {
            model = await (await import('./lib/financeCore.js')).financesDashboard();
          } else if (space === 'coffee') {
            model = await (await import('./lib/coffeeCore.js')).coffeeDashboard();
          } else {
            return sendJson(res, 400, { ok: false, error: 'Unknown dashboard: ' + space });
          }
          sendJson(res, 200, { ok: true, ...model });
        } catch (err) {
          const msg = (err && err.message) || String(err); // sql.js throws strings
          console.error(`[dev /api/dashboards ${space}] error:`, msg);
          sendJson(res, (err && err.status) || 500, { ok: false, error: msg });
        }
      });

      // Assistants router — same engines as api/assistant.js in production.
      server.middlewares.use('/api/assistant', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        const url = new URL(req.url, 'http://localhost');
        const space = String(url.searchParams.get('space') || '').toLowerCase();
        try {
          const body = await readJson(req);
          let result;
          if (space === 'production') {
            result = await (await import('./lib/chatCore.js')).handleChat(body, 'dev@local');
          } else if (space === 'events') {
            result = await (await import('./lib/eventsChatCore.js')).handleEventsChat(body, 'dev@local');
          } else if (space === 'sales') {
            result = await (await import('./lib/salesChatCore.js')).handleSalesChat(body, 'dev@local');
          } else {
            return sendJson(res, 400, { ok: false, error: 'Unknown assistant: ' + space });
          }
          sendJson(res, 200, result);
        } catch (err) {
          const msg = (err && err.message) || String(err); // sql.js throws strings
          console.error(`[dev /api/assistant ${space}] error:`, msg);
          sendJson(res, (err && err.status) || 500, { ok: false, error: msg });
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
