// GTD Operator (Promoter role) — per ADR-007.
//
// Polls Capture Inbox where Promotion status = Pending promotion, runs the
// state machine in §3, and promotes each row to its UB destination per the
// mapping in §4. Single-instance only (no parallel promotions — race on
// status flips). Deterministic; no LLM judgment.
//
// Draft-hold RETIRED 2026-07-09 (Garrison decision, ADR-007 §6 autonomy
// clause: draft-then-release → self-act). Tasks land live with only the
// "Domain: <X>" tag; the "🤖 Operator draft" label is no longer applied.
//
// Read scope: Capture Inbox + UB Tasks/Notes/Projects (substrate-only per
// Doctrine 10). NEVER the STB Brain. NEVER the Cross-Agent Channel.
// Write scope:
//   1. Capture Inbox status flips + audit fields only.
//   2. UB Tasks/Notes/Projects create-only — never updates existing UB rows.

import {
  listPromoterPending,
  markPromoted,
  markBounced,
  markHeldForGarrison,
  appendPromotionNotes,
  notion,
  queryDataSource,
} from './captureInbox.js';

const UB_TASKS_DS = process.env.NOTION_UB_TASKS_DS;
const UB_NOTES_DS = process.env.NOTION_UB_NOTES_DS;
const UB_PROJECTS_DS = process.env.NOTION_UB_PROJECTS_DS;

const MIN_BODY_LENGTH = 20;
const BODY_TRUNCATE = 2000;

// ─────────────────────────────────────────────────────────────
// Helpers — body building, reverse-pointer trailer, project match
// ─────────────────────────────────────────────────────────────

function reversePointer(row) {
  const agent = row.capturedBy || 'unknown';
  return `\n\n---\n_Source: Captured by ${agent} via Capture Inbox row ${row.url}._`;
}

function buildDescription(row) {
  const body = row.body || '';
  const trailer = reversePointer(row);
  // Truncate so that body + trailer fits within Notion's 2000-char rich_text
  // limit. Reserve trailer length + 3 for ellipsis.
  const maxBody = BODY_TRUNCATE - trailer.length - 3;
  const truncated = body.length > maxBody
    ? body.slice(0, maxBody) + '...'
    : body;
  return truncated + trailer;
}

// Case-insensitive exact match against UB Projects Name. Returns {url, name}
// on single match; null on no match; { ambiguous: true, matches: [...] } on
// multi-match. Operator records the outcome in Promotion notes.
async function findProjectByName(name) {
  if (!UB_PROJECTS_DS) return null;
  if (!name || !name.trim()) return null;
  // Notion title filter is case-sensitive `equals`; use `contains` then filter client-side
  const rows = await queryDataSource(
    UB_PROJECTS_DS,
    { property: 'Name', title: { contains: name.trim() } },
    undefined,
    20
  );
  const norm = name.trim().toLowerCase();
  const exact = rows.filter((r) => {
    const title = (r.properties?.Name?.title || []).map((t) => t.plain_text || '').join('').toLowerCase();
    return title === norm;
  });
  if (exact.length === 1) return { url: exact[0].url, id: exact[0].id, name };
  if (exact.length > 1) return { ambiguous: true, matches: exact.map((r) => r.id) };
  return null;
}

// ─────────────────────────────────────────────────────────────
// Mappers — Capture Inbox → UB destination payloads
// ─────────────────────────────────────────────────────────────

async function buildTaskPayload(row) {
  // Draft-hold retired 2026-07-09 per Garrison (ADR-007 §6 autonomy clause,
  // draft-then-release → self-act): promotions land as live Tasks directly.
  const labels = [];
  if (row.captureDomain) labels.push(`Domain: ${row.captureDomain}`);

  const properties = {
    Name: { title: [{ text: { content: row.title || '(untitled capture)' } }] },
    Description: { rich_text: [{ text: { content: buildDescription(row) } }] },
    Status: { status: { name: 'To Do' } },
    Labels: { multi_select: labels.map((name) => ({ name })) },
  };
  if (row.suggestedDue) {
    properties.Due = { date: { start: row.suggestedDue } };
  }
  if (row.suggestedPriority) {
    properties.Priority = { status: { name: row.suggestedPriority } };
  }

  // Project relation match
  let projectMatch = null;
  if (row.suggestedProject) {
    projectMatch = await findProjectByName(row.suggestedProject);
    if (projectMatch && !projectMatch.ambiguous) {
      properties.Project = { relation: [{ id: projectMatch.id }] };
    }
  }

  return { ds: UB_TASKS_DS, properties, projectMatch };
}

async function buildNotePayload(row) {
  const properties = {
    Name: { title: [{ text: { content: row.title || '(untitled capture)' } }] },
    Type: { select: { name: 'Reference' } }, // default; Garrison adjusts
    Archived: { checkbox: false },
  };
  // Notes: Project relation match same as Tasks
  let projectMatch = null;
  if (row.suggestedProject) {
    projectMatch = await findProjectByName(row.suggestedProject);
    if (projectMatch && !projectMatch.ambiguous) {
      properties.Project = { relation: [{ id: projectMatch.id }] };
    }
  }
  return { ds: UB_NOTES_DS, properties, projectMatch, includeBodyAsContent: true };
}

async function buildProjectPayload(row) {
  const properties = {
    Name: { title: [{ text: { content: row.title || '(untitled capture)' } }] },
    Status: { status: { name: 'Planned' } },
    Archived: { checkbox: false },
  };
  if (row.suggestedDue) {
    properties['Target Deadline'] = { date: { start: row.suggestedDue } };
  }
  return { ds: UB_PROJECTS_DS, properties, projectMatch: null, includeBodyAsContent: true };
}

async function writeDestination(payload, row) {
  const args = {
    parent: { type: 'data_source_id', data_source_id: payload.ds },
    properties: payload.properties,
  };
  if (payload.includeBodyAsContent && row.body) {
    // Notes and Projects carry the Body in the page content, not a property.
    args.children = bodyToParagraphBlocks(row.body + reversePointer(row));
  }
  const page = await notion().pages.create(args);
  return { id: page.id, url: page.url };
}

function bodyToParagraphBlocks(text) {
  // Split on double-newline to create paragraph blocks (mirrors notionCore.js)
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((p) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: p } }] },
  }));
}

// ─────────────────────────────────────────────────────────────
// State machine (ADR-007 §3)
// ─────────────────────────────────────────────────────────────

export async function promoteOne(row, { dryRun = false } = {}) {
  const startedAt = new Date().toISOString();

  // Step 1: Undecided → Held for Garrison
  if (row.captureType === 'Undecided' || !row.captureType) {
    const reason = !row.captureType
      ? 'Capture type unset — needs Garrison classification.'
      : 'Classifier returned Undecided (low confidence or thin body) — needs Garrison classification.';
    if (!dryRun) {
      await markHeldForGarrison(row.id, { reason, resolvedAt: startedAt });
      await appendPromotionNotes(row.id, row.promotionNotes, formatPromoterTrace({
        outcome: 'Held for Garrison',
        reason,
      }));
    }
    return { row, outcome: 'held', reason, applied: !dryRun };
  }

  // Step 2: Body validation
  const body = row.body || '';
  if (body.trim().length < MIN_BODY_LENGTH) {
    const reason = `Body too thin (${body.trim().length} chars) — needs ≥${MIN_BODY_LENGTH}.`;
    if (!dryRun) {
      await markBounced(row.id, { reason, resolvedAt: startedAt });
      await appendPromotionNotes(row.id, row.promotionNotes, formatPromoterTrace({
        outcome: 'Bounced',
        reason,
      }));
    }
    return { row, outcome: 'bounced', reason, applied: !dryRun };
  }

  // Step 3+4: Build payload + write destination
  let payload;
  try {
    if (row.captureType === 'Task') payload = await buildTaskPayload(row);
    else if (row.captureType === 'Note') payload = await buildNotePayload(row);
    else if (row.captureType === 'Project') payload = await buildProjectPayload(row);
    else {
      const reason = `Unknown Capture type "${row.captureType}".`;
      if (!dryRun) {
        await markBounced(row.id, { reason, resolvedAt: startedAt });
        await appendPromotionNotes(row.id, row.promotionNotes, formatPromoterTrace({ outcome: 'Bounced', reason }));
      }
      return { row, outcome: 'bounced', reason, applied: !dryRun };
    }
  } catch (err) {
    const reason = `Payload build failed: ${err.message}`;
    if (!dryRun) {
      await markBounced(row.id, { reason, resolvedAt: startedAt });
      await appendPromotionNotes(row.id, row.promotionNotes, formatPromoterTrace({ outcome: 'Bounced', reason }));
    }
    return { row, outcome: 'bounced', reason, applied: !dryRun };
  }

  if (dryRun) {
    return {
      row,
      outcome: 'would-promote',
      destination: row.captureType,
      payload,
      projectMatch: payload.projectMatch,
      applied: false,
    };
  }

  let destination;
  try {
    destination = await writeDestination(payload, row);
  } catch (err) {
    const reason = `Destination write failed: ${err.message}`;
    await markBounced(row.id, { reason, resolvedAt: startedAt });
    await appendPromotionNotes(row.id, row.promotionNotes, formatPromoterTrace({ outcome: 'Bounced', reason }));
    return { row, outcome: 'bounced', reason, applied: true };
  }

  // Step 5: Flip status + audit
  await markPromoted(row.id, { destinationUrl: destination.url, resolvedAt: startedAt });
  await appendPromotionNotes(row.id, row.promotionNotes, formatPromoterTrace({
    outcome: 'Promoted',
    destination: row.captureType,
    destinationUrl: destination.url,
    projectMatch: payload.projectMatch,
    bodyTruncated: (row.body || '').length > BODY_TRUNCATE,
  }));

  return { row, outcome: 'promoted', destination, applied: true };
}

function formatPromoterTrace({ outcome, destination, destinationUrl, projectMatch, bodyTruncated, reason }) {
  const lines = [
    `## Promotion trace (${new Date().toISOString()})`,
    `- Outcome: ${outcome}`,
  ];
  if (destination) lines.push(`- Destination: UB ${destination}`);
  if (destinationUrl) lines.push(`- Destination URL: ${destinationUrl}`);
  if (projectMatch === null) lines.push(`- Project relation: hint was empty`);
  else if (projectMatch && projectMatch.ambiguous) lines.push(`- Project relation: hint matched multiple (${projectMatch.matches.length}) — left blank for Garrison`);
  else if (projectMatch && !projectMatch.ambiguous) lines.push(`- Project relation: matched "${projectMatch.name}"`);
  else if (projectMatch === undefined) lines.push(`- Project relation: not attempted`);
  else lines.push(`- Project relation: no match`);
  if (typeof bodyTruncated === 'boolean') {
    lines.push(`- Body truncation: ${bodyTruncated ? `truncated at ${BODY_TRUNCATE} chars; full text in source row` : 'none'}`);
  }
  if (reason) lines.push(`- Reason: ${reason}`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Public entry — one polling pass
// ─────────────────────────────────────────────────────────────
export async function runOnePass({ dryRun = false, limit = 25 } = {}) {
  const rows = await listPromoterPending(limit);
  const results = [];
  for (const row of rows) {
    try {
      const r = await promoteOne(row, { dryRun });
      results.push(r);
    } catch (err) {
      results.push({ row, error: err.message, applied: false });
    }
  }
  return {
    polledAt: new Date().toISOString(),
    dryRun,
    rowCount: rows.length,
    results,
  };
}
