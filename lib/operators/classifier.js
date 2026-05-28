// Capture Classifier — Operator class (Classifier role) per ADR-009.
//
// Reads Capture Inbox rows where Capture type is empty AND Promotion status =
// Pending promotion. Fills empty classification fields (Capture type, Capture
// domain, Title, Suggested project). Never overwrites a pre-set field. Never
// touches Promotion status or any source-of-truth field (Body, Captured by,
// pre-set Capture domain/Capture type, Date captured, Source, Suggested*
// other than Suggested project).
//
// Two-mode logic per Garrison's design:
//   1. Explicit-cue parsing (no LLM call, fast + deterministic + free)
//   2. LLM fallback (Haiku by default) with structured prompt → JSON
//
// Confidence threshold safety valve: low-confidence LLM results set Capture
// type = "Undecided" so the Promoter routes them to Held for Garrison.
//
// Autonomy: full self-act (no draft-then-release). The Console is the
// verification surface; downstream Task draft-hold (Operator label) is the
// safety net.

import {
  listClassifierPending,
  writeClassification,
  appendPromotionNotes,
} from './captureInbox.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLASSIFIER_MODEL = process.env.ANTHROPIC_CLASSIFIER_MODEL || 'claude-haiku-4-5';

// ─────────────────────────────────────────────────────────────
// Cue dictionary v1 (hardcoded — per Architect ADR-009 §3.1 lean)
// ─────────────────────────────────────────────────────────────
// Lowercase keys. Match against the *start* of a normalized capture text
// (lowercased, leading whitespace stripped). Order matters within each class:
// more specific cues first.

const TYPE_CUES = [
  { match: /^(task|todo|to-do|to do)\s*[:\-—]/, type: 'Task' },
  { match: /^(note|reminder)\s*[:\-—]/, type: 'Note' },
  { match: /^(project|new project)\s*[:\-—]/, type: 'Project' },
  { match: /^(idea|thought)\s*[:\-—]/, type: 'Note' },
  // Imperative verbs at start strongly imply Task
  {
    match: /^(call|email|text|schedule|book|order|buy|pay|file|send|review|check|follow up|followup|finish|finalize|draft|write|update|fix|build|wire|ship|deploy|delete|archive|cancel|confirm|reach out|ping|remind me)\b/,
    type: 'Task',
  },
];

const DOMAIN_CUES = [
  { match: /\b(stb|spindletap|brewery|coffee|texzas|thc)\b/, domain: 'STB' },
  { match: /\b(finance|qbo|quickbooks|paylocity|payables|receivables|tax|tips|gratuity|cc classification)\b/, domain: 'Finance' },
  { match: /\b(side hustle|side hustles|hustle|s2s)\b/, domain: 'Side Hustles' },
  { match: /\b(strength|lift|lifting|squat|bench|deadlift|press|gym strength)\b/, domain: 'Strength Training' },
  { match: /\b(health|fitness|bjj|jiu-jitsu|jiu jitsu|medical|doctor|dentist|sleep|nutrition)\b/, domain: 'Health' },
];

// ─────────────────────────────────────────────────────────────
// Cue parser — primary path, no LLM call
// ─────────────────────────────────────────────────────────────

function normalizeForCues(text = '') {
  return text.toLowerCase().trim();
}

function deriveTitle(body) {
  // First non-empty line, strip leading cue marker, truncate to 120 chars
  const firstLine = (body || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) || '';
  const stripped = firstLine.replace(/^(task|todo|to-do|to do|note|reminder|project|new project|idea|thought)\s*[:\-—]\s*/i, '');
  return stripped.length > 120 ? stripped.slice(0, 117) + '...' : stripped;
}

function parseWithCues(body) {
  const norm = normalizeForCues(body);
  let captureType = null;
  let captureDomain = null;
  const matched = [];

  for (const cue of TYPE_CUES) {
    if (cue.match.test(norm)) {
      captureType = cue.type;
      matched.push(`type:${cue.match.source}`);
      break;
    }
  }
  for (const cue of DOMAIN_CUES) {
    if (cue.match.test(norm)) {
      captureDomain = cue.domain;
      matched.push(`domain:${cue.match.source}`);
      break;
    }
  }

  if (!captureType && !captureDomain) return null; // No cues matched
  return {
    captureType,
    captureDomain,
    title: deriveTitle(body),
    confidence: 'high', // cue match = deterministic
    via: 'cue-parser',
    matched,
  };
}

// ─────────────────────────────────────────────────────────────
// LLM fallback — Haiku by default
// ─────────────────────────────────────────────────────────────

const LLM_PROMPT = `You classify raw text captures into a GTD inbox. Read the capture and return ONLY a JSON object with these fields (no markdown, no preamble):

{
  "captureType": "Task" | "Note" | "Project" | "Undecided",
  "captureDomain": "STB" | "Finance" | "Side Hustles" | "Strength Training" | "Health" | null,
  "title": "<short imperative headline, ≤120 chars>",
  "suggestedProject": "<freeform project hint, or null if none implied>",
  "confidence": "high" | "medium" | "low"
}

Rules:
- captureType: "Task" = something to DO. "Note" = something to REMEMBER. "Project" = a multi-step initiative. "Undecided" if you genuinely can't tell.
- captureDomain: STB (Spindletap Beverages — brewery, coffee, texzas, thc), Finance (money/accounting), Side Hustles (separate ventures), Strength Training (lifting), Health (fitness/medical/bjj). null if no clear domain.
- title: Rephrase as imperative (e.g., "Call the dentist") if Task; preserve original if Note/Project.
- suggestedProject: Only if the capture explicitly references a project name. Otherwise null.
- confidence: "low" if you're guessing. "low" forces Undecided downstream.

Capture:
`;

async function parseWithLLM(body) {
  if (!ANTHROPIC_API_KEY) {
    return null; // No key configured; skip LLM fallback gracefully
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLASSIFIER_MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: LLM_PROMPT + '\n' + body }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  const textOut = (data.content || []).map((b) => b.text || '').join('');
  let parsed;
  try {
    // Strip code fences if the model added any
    const jsonText = textOut.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`LLM returned non-JSON: ${textOut.slice(0, 200)}`);
  }
  return { ...parsed, via: 'llm', model: CLASSIFIER_MODEL };
}

// ─────────────────────────────────────────────────────────────
// Run one classification — cue parser first, LLM fallback if no cues.
// Applies confidence-low safety valve.
// ─────────────────────────────────────────────────────────────

export async function classifyOne(row, { dryRun = false } = {}) {
  const body = row.body || row.title || '';
  if (!body.trim() || body.length < 20) {
    // Too thin to classify; mark Undecided so Promoter holds it
    const result = { captureType: 'Undecided', captureDomain: null, title: row.title || '(empty capture)', confidence: 'low', via: 'too-short' };
    if (!dryRun) await applyClassification(row, result);
    return { row, result, applied: !dryRun };
  }

  // 1. Try cue parser
  let result = parseWithCues(body);

  // 2. LLM fallback if cue parser had no hits
  if (!result) {
    try {
      result = await parseWithLLM(body);
    } catch (err) {
      // LLM failed — log and fall back to Undecided so it surfaces for Garrison
      result = { captureType: 'Undecided', captureDomain: null, title: deriveTitle(body), confidence: 'low', via: 'llm-error', error: err.message };
    }
  }

  // 3. Safety valve: confidence=low → Undecided
  if (result && result.confidence === 'low' && result.captureType !== 'Undecided') {
    result.captureType = 'Undecided';
    result.via = (result.via || 'unknown') + '+low-confidence';
  }

  if (!dryRun) await applyClassification(row, result);
  return { row, result, applied: !dryRun };
}

async function applyClassification(row, result) {
  // Write only the empty fields (captureInbox.js enforces non-overwrite)
  const writeResult = await writeClassification(row.id, row, {
    captureType: result.captureType,
    captureDomain: result.captureDomain,
    title: result.title,
    suggestedProject: result.suggestedProject || null,
  });
  // Append audit trail to Promotion notes
  const traceLines = [
    `## Classifier trace (${new Date().toISOString()})`,
    `- Via: ${result.via}`,
    `- Capture type: ${result.captureType || '(unset)'}`,
    `- Capture domain: ${result.captureDomain || '(unset)'}`,
    `- Title: ${result.title || '(unset)'}`,
    `- Suggested project: ${result.suggestedProject || '(unset)'}`,
    `- Confidence: ${result.confidence || 'n/a'}`,
    ...(result.matched ? [`- Matched cues: ${result.matched.join(', ')}`] : []),
    ...(result.model ? [`- Model: ${result.model}`] : []),
    ...(result.error ? [`- Error: ${result.error}`] : []),
    ...(writeResult.changed ? [`- Fields written: ${writeResult.fields.join(', ')}`] : ['- No new fields written (all pre-set)']),
  ];
  await appendPromotionNotes(row.id, row.promotionNotes, traceLines.join('\n'));
}

// ─────────────────────────────────────────────────────────────
// Public entry — one polling pass
// ─────────────────────────────────────────────────────────────
export async function runOnePass({ dryRun = false, limit = 25 } = {}) {
  const rows = await listClassifierPending(limit);
  const results = [];
  for (const row of rows) {
    try {
      const r = await classifyOne(row, { dryRun });
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
