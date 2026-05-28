// Shared Notion data layer for STB Executive Console
// Schema locked by Architect 2026-05-27 (Brain Manifest v4.6)
//
// All writes attribute Captured by = "Console" so the (future) Release Agent
// can identify console-originated rows. Tier 1 writes go directly to canonical
// destinations. Tier 2 writes stage into Intake Queue as Pending review.

import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const INTAKE_QUEUE_DS = process.env.NOTION_INTAKE_QUEUE_DS;
const OPEN_QUESTIONS_DS = process.env.NOTION_OPEN_QUESTIONS_DS;
const PENDING_WORK_DS = process.env.NOTION_PENDING_WORK_DS;
const CHANNEL_DS = process.env.NOTION_CHANNEL_DS;
const SOURCE_EMAIL = process.env.CONSOLE_SOURCE_EMAIL || 'garrison@spindletap.com';

let _client = null;
function client() {
  if (!_client) {
    if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN is not set');
    _client = new Client({ auth: NOTION_TOKEN });
  }
  return _client;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isoNow() {
  return new Date().toISOString();
}

function verificationTrace() {
  return `\n\n---\n_verification trace: source = console submission · ${SOURCE_EMAIL} · ${isoNow()}_`;
}

// ─────────────────────────────────────────────────────────────
// Tier 1: PIN → Intake Queue row
// ─────────────────────────────────────────────────────────────
// Title prefix `📌 PIN: `, Status = "Pending review", Captured by = "Console",
// Routing tag + Type pickable. Body lives in the page body (rich text blocks).
export async function createPin({ title, body, routingTag = 'Undecided', type = null }) {
  if (!title) throw new Error('title is required');
  if (!INTAKE_QUEUE_DS) throw new Error('NOTION_INTAKE_QUEUE_DS is not set');

  const summary = `📌 PIN: ${title}`;
  const properties = {
    Summary: { title: [{ text: { content: summary } }] },
    Status: { select: { name: 'Pending review' } },
    'Captured by': { select: { name: 'Console' } },
    'Routing tag': { select: { name: routingTag } },
    'Date logged': { date: { start: today() } },
  };
  if (type) properties.Type = { select: { name: type } };

  return await createInDataSource(INTAKE_QUEUE_DS, properties, body);
}

// ─────────────────────────────────────────────────────────────
// Tier 1: Open Question → Open Questions DB
// ─────────────────────────────────────────────────────────────
export async function createOpenQuestion({ question, whyItMatters = '', domains = [] }) {
  if (!question) throw new Error('question is required');
  if (!OPEN_QUESTIONS_DS) throw new Error('NOTION_OPEN_QUESTIONS_DS is not set');

  const properties = {
    Question: { title: [{ text: { content: question } }] },
    Status: { select: { name: 'Open' } },
    Logged: { date: { start: today() } },
  };
  if (whyItMatters) {
    properties['Why it matters'] = { rich_text: [{ text: { content: whyItMatters } }] };
  }
  if (domains.length) {
    properties.Domain = { multi_select: domains.map((name) => ({ name })) };
  }

  return await createInDataSource(OPEN_QUESTIONS_DS, properties, null);
}

// ─────────────────────────────────────────────────────────────
// Tier 2: Stage into Intake Queue for Release Agent
// ─────────────────────────────────────────────────────────────
// Used for Living Archive, Executive Perspective, etc.
// Release Agent picks up rows with Captured by=Console and Status=Pending review,
// reconciles to the canonical destination, then flips Status to Routed or Bounced.
export async function createStagingRow({ title, body, routingTag, type = null }) {
  if (!title) throw new Error('title is required');
  if (!routingTag) throw new Error('routingTag is required for Tier 2');
  if (!INTAKE_QUEUE_DS) throw new Error('NOTION_INTAKE_QUEUE_DS is not set');

  const properties = {
    Summary: { title: [{ text: { content: title } }] },
    Status: { select: { name: 'Pending review' } },
    'Captured by': { select: { name: 'Console' } },
    'Routing tag': { select: { name: routingTag } },
    'Date logged': { date: { start: today() } },
  };
  if (type) properties.Type = { select: { name: type } };

  return await createInDataSource(INTAKE_QUEUE_DS, properties, body);
}

// ─────────────────────────────────────────────────────────────
// Tier 1: Status update — PATCH an existing row
// ─────────────────────────────────────────────────────────────
// dbType decides which Status enum is valid:
//   pending_work     → Queued | Active | Resolved | Dropped
//   intake_queue     → Pending review | Routed | Discarded | Extended dwell | Bounced
//   channel          → Unread | Acknowledged | Acted on | Won't do
export async function patchRowStatus({ pageId, newStatus, note = null }) {
  if (!pageId) throw new Error('pageId is required');
  if (!newStatus) throw new Error('newStatus is required');

  await client().pages.update({
    page_id: pageId,
    properties: {
      Status: { select: { name: newStatus } },
    },
  });

  if (note) {
    await appendBody(pageId, `${note}${verificationTrace()}`);
  }

  return { pageId, newStatus };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
async function createInDataSource(dataSourceId, properties, bodyText) {
  const page = await client().pages.create({
    parent: { type: 'data_source_id', data_source_id: dataSourceId },
    properties,
  });

  if (bodyText && bodyText.trim()) {
    await appendBody(page.id, `${bodyText}${verificationTrace()}`);
  }

  return { id: page.id, url: page.url };
}

async function appendBody(pageId, text) {
  // Split on double-newline to create paragraph blocks
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const blocks = paragraphs.map((p) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: p } }],
    },
  }));

  if (blocks.length === 0) return;

  await client().blocks.children.append({
    block_id: pageId,
    children: blocks,
  });
}

// ─────────────────────────────────────────────────────────────
// Read functions — dashboard surfaces
// ─────────────────────────────────────────────────────────────
// All return normalized objects for the UI: { id, url, ... fields ... }

// Use raw fetch for data_sources/{id}/query because @notionhq/client 2.3.0
// doesn't expose this endpoint yet (added in 3.x). Same Notion-Version + auth.
async function queryDataSource(dataSourceId, filter, sorts, pageSize = 25) {
  const body = { page_size: pageSize };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;

  const res = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion query failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.results || [];
}

function getTitle(page, propName) {
  const prop = page.properties?.[propName];
  if (!prop) return '';
  const arr = prop.title || prop.rich_text || [];
  return arr.map((t) => t.plain_text || '').join('');
}

function getSelect(page, propName) {
  return page.properties?.[propName]?.select?.name || null;
}

function getMultiSelect(page, propName) {
  return (page.properties?.[propName]?.multi_select || []).map((s) => s.name);
}

function getDate(page, propName) {
  return page.properties?.[propName]?.date?.start || null;
}

// Console submissions: Intake Queue rows with Captured by = "Console"
export async function listConsoleSubmissions(limit = 25) {
  if (!INTAKE_QUEUE_DS) throw new Error('NOTION_INTAKE_QUEUE_DS not set');
  const rows = await queryDataSource(
    INTAKE_QUEUE_DS,
    { property: 'Captured by', select: { equals: 'Console' } },
    [{ property: 'Date logged', direction: 'descending' }],
    limit
  );
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    summary: getTitle(r, 'Summary'),
    status: getSelect(r, 'Status'),
    routingTag: getSelect(r, 'Routing tag'),
    type: getSelect(r, 'Type'),
    dateLogged: getDate(r, 'Date logged'),
    createdAt: r.created_time,
  }));
}

// Active PINs: Intake Queue rows with Summary starting with 📌 PIN: and Status open
export async function listActivePins(limit = 50) {
  if (!INTAKE_QUEUE_DS) throw new Error('NOTION_INTAKE_QUEUE_DS not set');
  const rows = await queryDataSource(
    INTAKE_QUEUE_DS,
    {
      and: [
        { property: 'Summary', title: { starts_with: '📌 PIN' } },
        {
          or: [
            { property: 'Status', select: { equals: 'Pending review' } },
            { property: 'Status', select: { equals: 'Routed' } },
            { property: 'Status', select: { equals: 'Extended dwell' } },
          ],
        },
      ],
    },
    [{ property: 'Date logged', direction: 'descending' }],
    limit
  );
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    summary: getTitle(r, 'Summary').replace(/^📌 PIN:\s*/, ''),
    status: getSelect(r, 'Status'),
    routingTag: getSelect(r, 'Routing tag'),
    capturedBy: getSelect(r, 'Captured by'),
    dateLogged: getDate(r, 'Date logged'),
  }));
}

// Open Questions: status Open or Partially answered
export async function listOpenQuestions(limit = 50) {
  if (!OPEN_QUESTIONS_DS) throw new Error('NOTION_OPEN_QUESTIONS_DS not set');
  const rows = await queryDataSource(
    OPEN_QUESTIONS_DS,
    {
      or: [
        { property: 'Status', select: { equals: 'Open' } },
        { property: 'Status', select: { equals: 'Partially answered' } },
      ],
    },
    [{ property: 'Logged', direction: 'descending' }],
    limit
  );
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    question: getTitle(r, 'Question'),
    status: getSelect(r, 'Status'),
    domains: getMultiSelect(r, 'Domain'),
    whyItMatters: (r.properties?.['Why it matters']?.rich_text || []).map((t) => t.plain_text).join(''),
    logged: getDate(r, 'Logged'),
  }));
}

// Channel: recent rows, newest first
export async function listChannelRecent(limit = 25) {
  if (!CHANNEL_DS) throw new Error('NOTION_CHANNEL_DS not set');
  const rows = await queryDataSource(
    CHANNEL_DS,
    undefined,
    [{ property: 'Date sent', direction: 'descending' }],
    limit
  );
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    subject: getTitle(r, 'Subject'),
    from: getSelect(r, 'From'),
    to: getSelect(r, 'To'),
    type: getSelect(r, 'Type'),
    status: getSelect(r, 'Status'),
    dateSent: getDate(r, 'Date sent'),
  }));
}

// Pending Work: rows with Status = Queued or Active
export async function listPendingWork(limit = 50) {
  if (!PENDING_WORK_DS) throw new Error('NOTION_PENDING_WORK_DS not set');
  const rows = await queryDataSource(
    PENDING_WORK_DS,
    {
      or: [
        { property: 'Status', select: { equals: 'Queued' } },
        { property: 'Status', select: { equals: 'Active' } },
      ],
    },
    undefined,
    limit
  );
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: getTitle(r, 'Title'),
    status: getSelect(r, 'Status'),
    workstream: getSelect(r, 'Workstream'),
    priority: getSelect(r, 'Priority'),
    heldFor: getSelect(r, 'Held for'),
  }));
}

// Dispatch table for the list endpoint
export async function dispatchList(kind, limit) {
  switch (kind) {
    case 'console_submissions':
      return await listConsoleSubmissions(limit);
    case 'active_pins':
      return await listActivePins(limit);
    case 'open_questions':
      return await listOpenQuestions(limit);
    case 'channel_recent':
      return await listChannelRecent(limit);
    case 'pending_work':
      return await listPendingWork(limit);
    default:
      throw new Error(`Unknown list kind: ${kind}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Submission dispatch
// ─────────────────────────────────────────────────────────────
// Single entry point used by the API handler. Returns { id, url } on success.
export async function dispatchSubmission(submission) {
  const { submissionType } = submission;
  switch (submissionType) {
    case 'pin':
      return await createPin(submission);
    case 'open_question':
      return await createOpenQuestion(submission);
    case 'status_update':
      return await patchRowStatus(submission);
    case 'living_archive':
      return await createStagingRow({ ...submission, routingTag: 'Living Archive' });
    case 'executive_perspective':
      return await createStagingRow({ ...submission, routingTag: 'Executive Perspective' });
    case 'general_note':
      return await createStagingRow({ ...submission, routingTag: submission.routingTag || 'Undecided' });
    default:
      throw new Error(`Unknown submissionType: ${submissionType}`);
  }
}
