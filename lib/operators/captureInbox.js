// Shared Capture Inbox client for the GTD Operator (ADR-007) and Capture
// Classifier (ADR-009).
//
// Doctrine 10 (Operator class) defines two role-shapes that may use this
// module: Classifier (fills empty classification fields), Promoter (flips
// Promotion status terminal + writes audit). Helpers below enforce the
// write-scope boundaries each role gets — callers should pass only the field
// subset their role is granted (not enforced at runtime; doc'd in caller code).
//
// Source-of-truth: ADR-006 §3, ADR-007 §3-§5, ADR-009 §3, §7.
//
// One narrow Notion integration token will eventually be issued per-Operator
// (Architect recommended dedicated scoped integrations). For MVP we share the
// existing NOTION_TOKEN; swap is a one-env-var change.

import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const CAPTURE_INBOX_DS = process.env.NOTION_CAPTURE_INBOX_DS;

let _client = null;
function client() {
  if (!_client) {
    if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN is not set');
    _client = new Client({ auth: NOTION_TOKEN });
  }
  return _client;
}

// Use the raw data_sources/{id}/query endpoint — same pattern as notionCore.js.
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

// ─────────────────────────────────────────────────────────────
// Read shapes
// ─────────────────────────────────────────────────────────────

function getTitle(page, propName) {
  const arr = page.properties?.[propName]?.title || [];
  return arr.map((t) => t.plain_text || '').join('');
}
function getRichText(page, propName) {
  const arr = page.properties?.[propName]?.rich_text || [];
  return arr.map((t) => t.plain_text || '').join('');
}
function getSelect(page, propName) {
  return page.properties?.[propName]?.select?.name || null;
}
function getDate(page, propName) {
  return page.properties?.[propName]?.date?.start || null;
}

function normalizeRow(page) {
  return {
    id: page.id,
    url: page.url,
    title: getTitle(page, 'Title'),
    body: getRichText(page, 'Body'),
    capturedBy: getSelect(page, 'Captured by'),
    captureDomain: getSelect(page, 'Capture domain'),
    captureType: getSelect(page, 'Capture type'),
    dateCaptured: getDate(page, 'Date captured'),
    source: getRichText(page, 'Source'),
    suggestedDue: getDate(page, 'Suggested due'),
    suggestedPriority: getSelect(page, 'Suggested priority'),
    suggestedProject: getRichText(page, 'Suggested project'),
    promotionStatus: getSelect(page, 'Promotion status'),
    promotedTo: getRichText(page, 'Promoted to'),
    promotionNotes: getRichText(page, 'Promotion notes'),
    bounceReason: getRichText(page, 'Bounce reason'),
    resolvedAt: getDate(page, 'Resolved at'),
  };
}

// Classifier's primary read filter: rows where the capture is still raw —
// Capture type is empty AND Promotion status = "Pending promotion".
// (ADR-009 §3 / §7.)
export async function listClassifierPending(limit = 25) {
  if (!CAPTURE_INBOX_DS) throw new Error('NOTION_CAPTURE_INBOX_DS not set');
  const rows = await queryDataSource(
    CAPTURE_INBOX_DS,
    {
      and: [
        { property: 'Promotion status', select: { equals: 'Pending promotion' } },
        { property: 'Capture type', select: { is_empty: true } },
      ],
    },
    [{ property: 'Date captured', direction: 'ascending' }],
    limit
  );
  return rows.map(normalizeRow);
}

// Promoter's primary read filter: anything ready to be promoted to UB.
// Capture type may be Task / Note / Project / Undecided (Undecided → Held).
// (ADR-007 §3.)
export async function listPromoterPending(limit = 25) {
  if (!CAPTURE_INBOX_DS) throw new Error('NOTION_CAPTURE_INBOX_DS not set');
  const rows = await queryDataSource(
    CAPTURE_INBOX_DS,
    { property: 'Promotion status', select: { equals: 'Pending promotion' } },
    [{ property: 'Date captured', direction: 'ascending' }],
    limit
  );
  return rows.map(normalizeRow);
}

// ─────────────────────────────────────────────────────────────
// Write helpers — Classifier role (ADR-009 write scope)
// ─────────────────────────────────────────────────────────────
// Fills empty classification fields only. Never overwrites a pre-set field.
// Never touches Promotion status, Promoted to, Bounce reason, Resolved at.
// Body / Captured by / Capture domain (if pre-set) / Date captured / Source /
// Suggested* are all source-of-truth — never mutated.
export async function writeClassification(pageId, current, classification) {
  const properties = {};
  // Capture type — fill only if empty
  if (!current.captureType && classification.captureType) {
    properties['Capture type'] = { select: { name: classification.captureType } };
  }
  // Capture domain — fill only if empty
  if (!current.captureDomain && classification.captureDomain) {
    properties['Capture domain'] = { select: { name: classification.captureDomain } };
  }
  // Title — fill only if empty
  if (!current.title && classification.title) {
    properties['Title'] = { title: [{ text: { content: classification.title } }] };
  }
  // Suggested project — fill only if empty
  if (!current.suggestedProject && classification.suggestedProject) {
    properties['Suggested project'] = { rich_text: [{ text: { content: classification.suggestedProject } }] };
  }
  if (Object.keys(properties).length === 0) return { changed: false };
  await client().pages.update({ page_id: pageId, properties });
  return { changed: true, fields: Object.keys(properties) };
}

// ─────────────────────────────────────────────────────────────
// Write helpers — Promoter role (ADR-007 write scope)
// ─────────────────────────────────────────────────────────────

export async function markPromoted(pageId, { destinationUrl, resolvedAt = new Date().toISOString() }) {
  await client().pages.update({
    page_id: pageId,
    properties: {
      'Promotion status': { select: { name: 'Promoted' } },
      'Promoted to': { rich_text: [{ text: { content: destinationUrl } }] },
      'Resolved at': { date: { start: resolvedAt } },
    },
  });
}

export async function markBounced(pageId, { reason, resolvedAt = new Date().toISOString() }) {
  await client().pages.update({
    page_id: pageId,
    properties: {
      'Promotion status': { select: { name: 'Bounced' } },
      'Bounce reason': { rich_text: [{ text: { content: reason } }] },
      'Resolved at': { date: { start: resolvedAt } },
    },
  });
}

export async function markHeldForGarrison(pageId, { reason, resolvedAt = new Date().toISOString() }) {
  await client().pages.update({
    page_id: pageId,
    properties: {
      'Promotion status': { select: { name: 'Held for Garrison' } },
      'Bounce reason': { rich_text: [{ text: { content: reason } }] },
      'Resolved at': { date: { start: resolvedAt } },
    },
  });
}

// Promotion notes — append (don't overwrite). Both roles append; field is
// shared. Each role prefixes its own header so the audit trail layers cleanly.
export async function appendPromotionNotes(pageId, currentNotes, additionalNote) {
  const merged = currentNotes ? `${currentNotes}\n\n${additionalNote}` : additionalNote;
  await client().pages.update({
    page_id: pageId,
    properties: {
      'Promotion notes': { rich_text: [{ text: { content: merged } }] },
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Notion client passthrough — for callers that need to create destination
// rows (Promoter writes to UB Tasks/Notes/Projects) or fetch project relations.
// ─────────────────────────────────────────────────────────────
export function notion() {
  return client();
}

export { queryDataSource };
