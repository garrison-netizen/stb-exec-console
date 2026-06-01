// Capture Classifier — Operator class (Classifier role) per ADR-009.
//
// Reads Capture Inbox rows where Capture type is empty AND Promotion status =
// Pending promotion. Fills empty classification fields (Capture type, Capture
// domain, Title, Suggested project). Never overwrites a pre-set field. Never
// touches Promotion status or any source-of-truth field.
//
// Cue dictionary v1.1 (ADR-009 §3.1, amended 2026-06-01). Order matters:
//   1. Brain-routing safety valve → early return as Undecided
//   2. Typed type cues, then voice type cues
//   3. Typed domain cues, then voice domain cues (longest-match wins;
//      "texzas" short-circuits to Side Hustles)
//   4. Decision-language anti-pattern → demote Task to Note
//   5. LLM fallback (Haiku by default) if nothing in the cue path fired
//
// Confidence threshold safety valve: low-confidence LLM results set Capture
// type = "Undecided" so the Promoter routes them to Held for Garrison.
//
// Autonomy: full self-act per ADR-009 (no draft-then-release; Console + the
// downstream Task draft-hold label are the safety nets).

import {
  listClassifierPending,
  writeClassification,
  appendPromotionNotes,
} from './captureInbox.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLASSIFIER_MODEL = process.env.ANTHROPIC_CLASSIFIER_MODEL || 'claude-haiku-4-5';

// ─────────────────────────────────────────────────────────────
// v1.1 — Brain-routing safety valve (ADR-009 §3.1)
// ─────────────────────────────────────────────────────────────
// If the capture references Brain destinations explicitly, the user is
// (likely) trying to write Brain content via a capture surface. Force
// Undecided so Promoter routes to Held for Garrison; he reclassifies via
// the Console. Protects against voice memos crossing the Brain↔GTD split.

const BRAIN_ROUTING_PHRASES = [
  'for the brain',
  'living archive',
  'executive perspective',
  'pending work',
  'decision pipeline',
  'open question',
  'into the brain',
  'add to brain',
];

function hitsBrainRoutingValve(text) {
  const norm = text.toLowerCase();
  return BRAIN_ROUTING_PHRASES.some((p) => norm.includes(p));
}

// ─────────────────────────────────────────────────────────────
// v1.1 — Decision-language anti-pattern (ADR-009 §3.1)
// ─────────────────────────────────────────────────────────────
// Captures are for things Garrison will do, not things he needs to decide
// whether to do. If decision-language present and the cue path classified
// as Task, demote to Note.

const DECISION_LANGUAGE_PATTERNS = [
  /\bshould i\b/i,
  /\bdecide whether\b/i,
  /\bwondering if i should\b/i,
  /\bnot sure if i should\b/i,
  /\bthinking about whether\b/i,
];

function hasDecisionLanguage(text) {
  return DECISION_LANGUAGE_PATTERNS.some((p) => p.test(text));
}

// ─────────────────────────────────────────────────────────────
// Type cues — typed grammar (v1) + voice grammar (v1.1)
// ─────────────────────────────────────────────────────────────

const TYPED_TYPE_CUES = [
  { match: /^(task|todo|to-do|to do)\s*[:\-—]/i, type: 'Task' },
  { match: /^(note|reminder)\s*[:\-—]/i, type: 'Note' },
  { match: /^(project|new project)\s*[:\-—]/i, type: 'Project' },
  { match: /^(idea|thought)\s*[:\-—]/i, type: 'Note' },
];

const VOICE_TYPE_CUES = [
  // Explicit commitment phrasing — strongly Task
  { match: /\b(i need to|i have to|i gotta|i've got to|i must)\b/i, type: 'Task' },
  { match: /\b(remind me to|don't (forget|let me forget) to)\b/i, type: 'Task' },
  { match: /\b(make sure (i|to)|put .* on (my|the) list|gotta remember to)\b/i, type: 'Task' },
  { match: /\b(follow up (with|on)|circle back (with|on)|ping )\b/i, type: 'Task' },
  { match: /\b(needs to be (done|finished|fixed|sent|written|built|deployed)|need to (talk|reach out|circle back))\b/i, type: 'Task' },
  // Imperative verbs — at start of body, or after ": " (post-prefix common in voice/typed)
  {
    match: /(^|[:—-]\s*)(call|email|text|schedule|book|order|buy|pay|file|send|review|check|finish|finalize|draft|write|update|fix|build|wire|ship|deploy|delete|archive|cancel|confirm|reach out|remind|figure out|talk to)\b/i,
    type: 'Task',
  },
  // Note-shaped phrases
  { match: /\b(worth (noting|remembering)|note that|fyi|just for the record)\b/i, type: 'Note' },
];

// ─────────────────────────────────────────────────────────────
// Domain cues — typed (v1) + voice (v1.1). Longest match wins;
// "texzas" is a hard short-circuit per ADR-009 §3.1.
// ─────────────────────────────────────────────────────────────

// Each entry: { match: RegExp, domain: string, weight: number }
// Weight is rough specificity (longer / more specific = higher).
// Multi-word distributor and people names beat bare tokens.

const TEXZAS_PATTERN = /\btexzas\b/i;

const DOMAIN_CUES = [
  // Multi-word, highest specificity
  { match: /\bsilver eagle\b/i, domain: 'STB', weight: 30 },
  { match: /\btriple seat\b/i, domain: 'STB', weight: 30 },
  { match: /\bparty pay\b/i, domain: 'STB', weight: 30 },
  { match: /\badam wright\b/i, domain: 'STB', weight: 30 },
  { match: /\blone star beverage\b/i, domain: 'STB', weight: 30 },
  { match: /\bjiu[ -]?jitsu\b/i, domain: 'Health', weight: 30 },

  // STB systems / vendors
  { match: /\b(clover|ekos|mailchimp|paylocity|vip|karma|paysafe|dynamo|wismer|l&f|cowork)\b/i, domain: 'STB', weight: 20 },
  // STB people (canonical references) — bare "adam" without "wright" is intentionally NOT here
  // so the LLM can disambiguate vs. e.g. Adam-the-customer.
  { match: /\b(marin|brody|shaun|elizabeth|tabitha|carlos cortez|johnnyo|gorrity)\b/i, domain: 'STB', weight: 20 },
  // STB taxonomy
  { match: /\b(stb|spindletap|brewery|coffee|thc|distribution|wholesale|distributor)\b/i, domain: 'STB', weight: 15 },

  // Finance
  { match: /\b(qbo|quickbooks|sales tax|receivables|payables|cc classification|gratuity|tips payable)\b/i, domain: 'Finance', weight: 20 },
  { match: /\b(finance|invoice|expense|reconcile.*account)\b/i, domain: 'Finance', weight: 15 },

  // Side Hustles
  { match: /\b(side hustle|side hustles|hustle)\b/i, domain: 'Side Hustles', weight: 20 },

  // Strength Training — lifting vocabulary
  { match: /\b(deadlift|squat|bench press|overhead press|hip thrust)\b/i, domain: 'Strength Training', weight: 25 },
  { match: /\b(lift|lifting|strength|pr (today|attempt|day)?|set of (reps|five|three|eight))\b/i, domain: 'Strength Training', weight: 15 },

  // Health — distinct from strength training
  { match: /\b(doctor (appointment|visit)?|dentist|labs|bloodwork|prescription|medical|insurance claim)\b/i, domain: 'Health', weight: 25 },
  { match: /\b(bjj|sparring|gi |no[ -]?gi|rolling )\b/i, domain: 'Health', weight: 20 },
  { match: /\b(sleep|nutrition|cardio|run|workout)\b/i, domain: 'Health', weight: 10 },
];

function matchTypeCue(norm) {
  for (const c of TYPED_TYPE_CUES) if (c.match.test(norm)) return { type: c.type, via: 'typed-type' };
  for (const c of VOICE_TYPE_CUES) if (c.match.test(norm)) return { type: c.type, via: 'voice-type' };
  return null;
}

function matchDomainCue(norm) {
  // Texzas hard short-circuit per ADR-009 §3.1: "texzas always Side Hustles
  // even with STB people present."
  if (TEXZAS_PATTERN.test(norm)) {
    return { domain: 'Side Hustles', via: 'texzas-shortcircuit' };
  }
  // Longest-match wins — collect all hits, pick highest-weight.
  const hits = DOMAIN_CUES.filter((c) => c.match.test(norm));
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.weight - a.weight);
  return { domain: hits[0].domain, via: `domain-cue:w${hits[0].weight}` };
}

// ─────────────────────────────────────────────────────────────
// Title extraction (v1.1) — strip cue prefix, first sentence ≤80 chars,
// imperative-normalize for Tasks.
// ─────────────────────────────────────────────────────────────

function extractTitle(body, type) {
  if (!body) return '';
  // First non-empty line
  const firstLine = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) || '';
  // Strip explicit cue prefix
  let stripped = firstLine.replace(/^(task|todo|to-do|to do|note|reminder|project|new project|idea|thought)\s*[:\-—]\s*/i, '');
  // Strip voice "i need to" / "remind me to" / etc. for imperative normalization on Tasks
  if (type === 'Task') {
    stripped = stripped.replace(/^(i need to|i have to|i gotta|i've got to|i must|remind me to|don'?t forget to|make sure (i|to)|gotta remember to)\s+/i, '');
    // Capitalize first letter
    if (stripped.length > 0) stripped = stripped[0].toUpperCase() + stripped.slice(1);
  }
  // First sentence (ends at . / ! / ? — keep punctuation off)
  const sentenceEnd = stripped.search(/[.!?](\s|$)/);
  if (sentenceEnd > 0) stripped = stripped.slice(0, sentenceEnd);
  // Truncate to 80 chars
  return stripped.length > 80 ? stripped.slice(0, 77) + '...' : stripped;
}

// ─────────────────────────────────────────────────────────────
// Cue parser entry — orchestrates v1.1 precedence
// ─────────────────────────────────────────────────────────────

function parseWithCues(body) {
  const text = body || '';
  const norm = text.toLowerCase().trim();

  // 1. Brain-routing safety valve — early return
  if (hitsBrainRoutingValve(text)) {
    return {
      captureType: 'Undecided',
      captureDomain: null,
      title: extractTitle(text, 'Note'),
      confidence: 'high',
      via: 'brain-routing-valve',
      matched: ['brain-routing-phrase'],
    };
  }

  const typeHit = matchTypeCue(norm);
  const domainHit = matchDomainCue(norm);
  const hasDecisionLang = hasDecisionLanguage(text);

  // 2. Decision-language anti-pattern — overrides type. The whole utterance
  // is deliberation, so it's a Note regardless of any Task cue.
  let captureType = typeHit?.type || null;
  if (hasDecisionLang) captureType = 'Note';

  // 3. Domain-only fallthrough — if we matched a domain but no type cue
  // and no decision-language, default to Note. Notes are safe: they hold
  // context without scheduling action. Tasks require an explicit cue.
  if (!captureType && domainHit) captureType = 'Note';

  // Nothing fired at all → LLM fallback
  if (!typeHit && !domainHit && !hasDecisionLang) return null;

  const matched = [];
  if (typeHit) matched.push(typeHit.via);
  if (domainHit) matched.push(domainHit.via);
  if (hasDecisionLang) matched.push('decision-lang' + (typeHit?.type === 'Task' ? '-demote' : ''));
  if (!typeHit && domainHit && !hasDecisionLang) matched.push('domain-only-default-note');

  return {
    captureType,
    captureDomain: domainHit?.domain || null,
    title: extractTitle(text, captureType),
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
  "title": "<short imperative headline, ≤80 chars>",
  "suggestedProject": "<freeform project hint, or null if none implied>",
  "confidence": "high" | "medium" | "low"
}

Rules:
- captureType: "Task" = something to DO. "Note" = something to REMEMBER. "Project" = a multi-step initiative. "Undecided" if you genuinely can't tell.
- captureDomain: STB (Spindletap Beverages — brewery, coffee, distribution, THC), Finance (money/accounting), Side Hustles (separate ventures incl. Texzas), Strength Training (lifting), Health (fitness/medical/BJJ/jiu-jitsu). null if no clear domain.
- title: Rephrase as imperative ("Call the dentist") if Task; preserve original if Note/Project.
- suggestedProject: Only if the capture explicitly references a project name. Otherwise null.
- confidence: "low" if you're guessing. "low" forces Undecided downstream.
- "Should I X" / "deciding whether X" patterns are NOT Tasks — they're Notes (deliberation, not action).

Capture:
`;

async function parseWithLLM(body) {
  if (!ANTHROPIC_API_KEY) return null;
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
    const jsonText = textOut.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`LLM returned non-JSON: ${textOut.slice(0, 200)}`);
  }
  return { ...parsed, via: 'llm', model: CLASSIFIER_MODEL };
}

// ─────────────────────────────────────────────────────────────
// Run one classification — full v1.1 pipeline
// ─────────────────────────────────────────────────────────────

export async function classifyOne(row, { dryRun = false } = {}) {
  const body = row.body || row.title || '';

  // Trivial-body short-circuit
  if (!body.trim() || body.length < 20) {
    const result = {
      captureType: 'Undecided',
      captureDomain: null,
      title: row.title || '(empty capture)',
      confidence: 'low',
      via: 'too-short',
    };
    if (!dryRun) await applyClassification(row, result);
    return { row, result, applied: !dryRun };
  }

  // 1. Cue parser (handles safety valve + cues + decision-language demote)
  let result = parseWithCues(body);

  // 2. LLM fallback if cue parser didn't fire
  if (!result) {
    try {
      result = await parseWithLLM(body);
    } catch (err) {
      result = {
        captureType: 'Undecided',
        captureDomain: null,
        title: extractTitle(body, 'Note'),
        confidence: 'low',
        via: 'llm-error',
        error: err.message,
      };
    }
    // LLM returned null (no API key configured) → graceful Undecided
    if (!result) {
      result = {
        captureType: 'Undecided',
        captureDomain: null,
        title: extractTitle(body, 'Note'),
        confidence: 'low',
        via: 'llm-disabled',
      };
    }
  }

  // 3. Confidence-low safety valve
  if (result && result.confidence === 'low' && result.captureType !== 'Undecided') {
    result.captureType = 'Undecided';
    result.via = (result.via || 'unknown') + '+low-confidence';
  }

  if (!dryRun) await applyClassification(row, result);
  return { row, result, applied: !dryRun };
}

async function applyClassification(row, result) {
  const writeResult = await writeClassification(row.id, row, {
    captureType: result.captureType,
    captureDomain: result.captureDomain,
    title: result.title,
    suggestedProject: result.suggestedProject || null,
  });
  const traceLines = [
    `## Classifier trace (${new Date().toISOString()})`,
    `- Cue dictionary: v1.1`,
    `- Via: ${result.via}`,
    `- Capture type: ${result.captureType || '(unset)'}`,
    `- Capture domain: ${result.captureDomain || '(unset)'}`,
    `- Title: ${result.title || '(unset)'}`,
    `- Suggested project: ${result.suggestedProject || '(unset)'}`,
    `- Confidence: ${result.confidence || 'n/a'}`,
    ...(result.matched ? [`- Matched cues: ${result.matched.join(', ')}`] : []),
    ...(result.model ? [`- Model: ${result.model}`] : []),
    ...(result.error ? [`- Error: ${result.error}`] : []),
    ...(writeResult.changed
      ? [`- Fields written: ${writeResult.fields.join(', ')}`]
      : ['- No new fields written (all pre-set)']),
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
