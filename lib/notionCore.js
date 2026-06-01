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
// Architect shipped 2026-05-28 for the Reconcile visibility layer
const AGENT_STATUS_DS = process.env.NOTION_AGENT_STATUS_DS;
const RECONCILE_LOG_DS = process.env.NOTION_RECONCILE_LOG_DS;
const LIVING_ARCHIVE_DS = process.env.NOTION_LIVING_ARCHIVE_DS;
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
// Reconciliation Log entry (Push phase audit row)
// ─────────────────────────────────────────────────────────────
// Schema (Architect 2026-05-28):
//   Reconciled at (title) — short label like "2026-05-28 11:48 PM"
//   When (date, datetime) — full ISO timestamp
//   Captured count pushed (number)
//   Items per destination (text)
//   Reconciler (text) — defaults to "Garrison-via-Console"
//   Notes (text) — optional
export async function createReconcileLogEntry({
  capturedCountPushed = 0,
  itemsPerDestination = '',
  reconciler = 'Garrison-via-Console',
  notes = '',
}) {
  if (!RECONCILE_LOG_DS) throw new Error('NOTION_RECONCILE_LOG_DS not set');
  const when = new Date();
  const whenIso = when.toISOString();
  // Short human-readable title for the log entry
  const label = when
    .toISOString()
    .replace('T', ' ')
    .slice(0, 16); // "YYYY-MM-DD HH:MM"

  const properties = {
    'Reconciled at': { title: [{ text: { content: label } }] },
    When: { date: { start: whenIso } },
    'Captured count pushed': { number: capturedCountPushed },
  };
  if (itemsPerDestination) {
    properties['Items per destination'] = { rich_text: [{ text: { content: itemsPerDestination } }] };
  }
  if (reconciler) {
    properties.Reconciler = { rich_text: [{ text: { content: reconciler } }] };
  }
  if (notes) {
    properties.Notes = { rich_text: [{ text: { content: notes } }] };
  }

  return await createInDataSource(RECONCILE_LOG_DS, properties, null);
}

// ─────────────────────────────────────────────────────────────
// Tell-the-story: flip Living Archive Needs narrative = true
// ─────────────────────────────────────────────────────────────
// Source-narrative path per Architect: this surfaces the row in the Console's
// "Source Narratives Needed" section so Garrison writes the first-person account.
export async function markLivingArchiveNeedsNarrative({ pageId, note = null }) {
  if (!pageId) throw new Error('pageId is required');
  await client().pages.update({
    page_id: pageId,
    properties: { 'Needs narrative': { checkbox: true } },
  });
  if (note) await appendBody(pageId, `${note}${verificationTrace()}`);
  return { pageId, marked: 'needs-narrative' };
}

// Drop a Source Narrative request — Garrison decides he'll never write this story.
// Unflags Needs narrative so the row drops out of the Console's section.
// The Living Archive row itself stays — the source-narrative ask is just abandoned.
export async function unmarkLivingArchiveNeedsNarrative({ pageId, note = null }) {
  if (!pageId) throw new Error('pageId is required');
  await client().pages.update({
    page_id: pageId,
    properties: { 'Needs narrative': { checkbox: false } },
  });
  if (note) await appendBody(pageId, `${note}${verificationTrace()}`);
  return { pageId, marked: 'narrative-dropped' };
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

function getRichText(page, propName) {
  return (page.properties?.[propName]?.rich_text || []).map((t) => t.plain_text || '').join('');
}

function getCheckbox(page, propName) {
  return Boolean(page.properties?.[propName]?.checkbox);
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

// Agent freshness: every row, sorted by Last loaded desc.
// Schema (Architect, 2026-05-28): Agent (title), Last loaded (date), Last loaded context, Status note, Role.
export async function listAgentFreshness(limit = 25) {
  if (!AGENT_STATUS_DS) throw new Error('NOTION_AGENT_STATUS_DS not set');
  const rows = await queryDataSource(
    AGENT_STATUS_DS,
    undefined,
    [{ property: 'Last loaded', direction: 'descending' }],
    limit
  );
  return rows.map((r) => {
    const lastLoaded = getDate(r, 'Last loaded');
    return {
      id: r.id,
      url: r.url,
      agent: getTitle(r, 'Agent'),
      lastLoaded, // ISO string or null
      lastLoadedContext: getRichText(r, 'Last loaded context'),
      statusNote: getRichText(r, 'Status note'),
      role: getRichText(r, 'Role'),
    };
  });
}

// Source Narratives Needed: Living Archive rows with Needs narrative = true.
// Doctrine 3 — Garrison writes the source narrative; uncheck when filled.
export async function listSourceNarrativesNeeded(limit = 25) {
  if (!LIVING_ARCHIVE_DS) throw new Error('NOTION_LIVING_ARCHIVE_DS not set');
  const rows = await queryDataSource(
    LIVING_ARCHIVE_DS,
    { property: 'Needs narrative', checkbox: { equals: true } },
    [{ property: 'Date', direction: 'descending' }],
    limit
  );
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: getTitle(r, 'Title'),
    type: getSelect(r, 'Type'),
    tags: getMultiSelect(r, 'Tags'),
    date: getDate(r, 'Date'),
    needsNarrative: getCheckbox(r, 'Needs narrative'),
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
    case 'agent_freshness':
      return await listAgentFreshness(limit);
    case 'source_narratives_needed':
      return await listSourceNarrativesNeeded(limit);
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
    case 'reconcile_log':
      return await createReconcileLogEntry(submission);
    case 'mark_needs_narrative':
      return await markLivingArchiveNeedsNarrative(submission);
    case 'unmark_needs_narrative':
      return await unmarkLivingArchiveNeedsNarrative(submission);
    case 'capture_inbox':
      return await createCaptureInboxRow(submission);
    default:
      throw new Error(`Unknown submissionType: ${submissionType}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Capture Inbox write (ADR-006 §6, GTD side of the split)
// ─────────────────────────────────────────────────────────────
// Console-as-capture-surface writes Garrison-actionable items to the
// Capture Inbox on his Personal Dashboard. Title/Capture type/Capture
// domain/Suggested project left empty so the downstream Classifier
// (ADR-009) fills them. Captured by = "Console" per the schema's allowed
// agent list.
export async function createCaptureInboxRow({ body, capturedBy = 'Console', source = null }) {
  const dsId = process.env.NOTION_CAPTURE_INBOX_DS;
  if (!dsId) throw new Error('NOTION_CAPTURE_INBOX_DS not set');
  if (!body || !body.trim()) throw new Error('body is required for capture inbox write');

  const now = new Date().toISOString();
  const properties = {
    Body: { rich_text: [{ text: { content: body } }] },
    'Captured by': { select: { name: capturedBy } },
    'Date captured': { date: { start: now } },
    'Promotion status': { select: { name: 'Pending promotion' } },
    Source: { rich_text: [{ text: { content: source || `Console capture bar — ${now}` } }] },
  };

  const page = await client().pages.create({
    parent: { type: 'data_source_id', data_source_id: dsId },
    properties,
  });
  return { id: page.id, url: page.url };
}
