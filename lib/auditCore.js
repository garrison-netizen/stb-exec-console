// Assistant Audit — reads the query log (lib/assistantLog.js) and reports what
// the department assistants are struggling with.
//
// Doctrine: the FLAGS ARE MECHANICAL, not vibes. Every "this went badly"
// judgement below comes from something the engine actually recorded — a SQL
// error, a forced landing, a user re-asking the same question ninety seconds
// later. Claude is used only at the end, to group already-flagged turns into
// themes and to sort each theme into data gap vs findability gap vs bug. That
// split is the point: it turns the log into a build queue.
//
// Degrades gracefully: no blob store (local dev) → "no log yet"; no API key →
// mechanical report with the synthesis section marked unavailable.

import Anthropic from '@anthropic-ai/sdk'
import { readTurns, readAuditCache, writeAuditCache } from './assistantLog.js'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const WINDOW_DAYS = 14
const RE_ASK_WINDOW_MS = 120 * 1000
const RE_ASK_SIMILARITY = 0.35
const SLOW_MS = 90 * 1000
const MAX_TURNS_TO_MODEL = 60

// Phrases that mean "I could not answer that". A legitimate "we don't track
// labor" lands here too — that is intended: it is a data gap worth surfacing.
const NO_ANSWER = /\b(i (don'?t|do not) have|don'?t have (the |any )?data|not (currently )?(available|tracked)|isn'?t (tracked|available|in the)|no data (for|on|about)|can(no|')t (determine|tell|answer|find)|cannot (determine|answer|find)|unable to (determine|answer|find)|not in the (data|mirror|database))\b/i

const STOP = new Set(
  'the a an and or of for to in on at is are was were do does did how what when which who why me my our we us you your it its that this those these show tell give list many much last this year month week day per by from vs with'.split(' ')
)

function tokens(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  )
}

function similarity(a, b) {
  const A = tokens(a)
  const B = tokens(b)
  if (!A.size || !B.size) return 0
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / Math.min(A.size, B.size)
}

// Attach mechanical flags to every turn, including the cross-turn re-ask
// signal (which needs the conversation, not just the turn).
export function flagTurns(turns) {
  for (const t of turns) {
    const flags = []
    if (t.error) flags.push('failed')
    if ((t.sqlErrors || []).length) flags.push('query-errors')
    if ((t.toolErrors || []).length) flags.push('tool-errors')
    if (t.outOfTime) flags.push('ran-out-of-time')
    if (t.roundCap) flags.push('hit-research-limit')
    if (t.reply && NO_ANSWER.test(t.reply)) flags.push('no-answer')
    if (t.ms && t.ms > SLOW_MS) flags.push('slow')
    t.flags = flags
  }

  // Re-ask: the same person, same conversation, asking again almost
  // immediately with substantially the same words. The strongest evidence
  // there is that the previous answer missed.
  const byConvo = new Map()
  for (const t of turns) {
    if (!t.conversationId) continue
    if (!byConvo.has(t.conversationId)) byConvo.set(t.conversationId, [])
    byConvo.get(t.conversationId).push(t)
  }
  for (const list of byConvo.values()) {
    list.sort((a, b) => (a.at < b.at ? -1 : 1))
    for (let i = 0; i < list.length - 1; i++) {
      const cur = list[i]
      const next = list[i + 1]
      const answeredAt = Date.parse(cur.at)
      const nextAskedAt = Date.parse(next.at) - (next.ms || 0)
      if (!(nextAskedAt - answeredAt < RE_ASK_WINDOW_MS)) continue
      if (similarity(cur.question, next.question) < RE_ASK_SIMILARITY) continue
      if (!cur.flags.includes('re-asked')) cur.flags.push('re-asked')
    }
  }
  return turns
}

export function aggregate(turns) {
  const signals = {
    failed: 0,
    'query-errors': 0,
    'tool-errors': 0,
    'ran-out-of-time': 0,
    'hit-research-limit': 0,
    'no-answer': 0,
    slow: 0,
    're-asked': 0,
  }
  const spaces = new Map()
  const users = new Map()
  let flagged = 0

  for (const t of turns) {
    for (const f of t.flags) if (f in signals) signals[f]++
    if (t.flags.length) flagged++
    const s = spaces.get(t.space) || { space: t.space, turns: 0, flagged: 0 }
    s.turns++
    if (t.flags.length) s.flagged++
    spaces.set(t.space, s)
    if (t.email) {
      const u = users.get(t.email) || { email: t.email, turns: 0, flagged: 0 }
      u.turns++
      if (t.flags.length) u.flagged++
      users.set(t.email, u)
    }
  }

  // What people actually ask about — the demand signal, separate from failure.
  const wordCount = new Map()
  for (const t of turns) {
    for (const w of tokens(t.question)) wordCount.set(w, (wordCount.get(w) || 0) + 1)
  }
  const topics = [...wordCount.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([label, count]) => ({ label, count }))

  return {
    turnCount: turns.length,
    flagged,
    cleanRate: turns.length ? Math.round(((turns.length - flagged) / turns.length) * 100) : null,
    signals,
    spaces: [...spaces.values()].sort((a, b) => b.turns - a.turns),
    users: [...users.values()].sort((a, b) => b.turns - a.turns),
    topics,
  }
}

function compactForModel(t) {
  return {
    space: t.space,
    at: t.at,
    question: t.question,
    flags: t.flags,
    reply_excerpt: t.reply ? String(t.reply).slice(0, 600) : null,
    error: t.error || null,
    sql_errors: (t.sqlErrors || []).slice(0, 3),
    rounds: t.rounds || 0,
  }
}

const SYNTH_PROMPT = `You are auditing Spindletap's internal department assistants (Production/Ekos, Events/Tripleseat, Sales/VIP distributor marts, Taproom/Clover register). Each is Claude with a read-only SQL tool over a small database for its department.

You are given turns that were MECHANICALLY flagged as having gone badly, plus the volume context. Group them into a small number of real themes and, for each, decide what kind of problem it is:

- "data-gap": the answer needs data Spindletap does not have in that assistant's database at all. Fixing it means building a pipeline or accepting the limit.
- "findability": the data IS there but the assistant could not reach it — bad schema hints, wrong table, a prompt that doesn't mention the column, questions phrased in business words the schema doesn't use. Fixing it means editing the assistant's schema description or prompt.
- "bug": the assistant did something wrong — malformed SQL it should have got right, a crash, a contradiction, an answer that misreads its own data.
- "usage": the question was outside what this assistant is for, or the user needed a different space. Not a defect; may indicate a missing assistant.

Be strict about evidence. Only claim what the turns show. If a flag looks like a false positive (e.g. a correct answer that merely contains the phrase "not tracked" as an appropriate caveat), say so rather than inventing a defect.

Return ONLY JSON, no prose, in this shape:
{
  "headline": "one sentence on the overall health of the assistants",
  "themes": [
    {
      "title": "short specific title",
      "kind": "data-gap|findability|bug|usage",
      "severity": "high|medium|low",
      "count": <how many flagged turns fall under this>,
      "spaces": ["production"],
      "what_happened": "1-2 sentences, concrete",
      "evidence": ["a verbatim question from the turns", "another"],
      "fix": "the specific change you would make, naming the file or data source where you can"
    }
  ],
  "false_positives": "one sentence on flags you judged not to be real problems, or null"
}`

async function synthesize(flaggedTurns, stats) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { unavailable: 'No ANTHROPIC_API_KEY in this environment — mechanical signals only.' }
  }
  if (!flaggedTurns.length) {
    return { headline: 'No flagged turns in this window — the assistants answered everything cleanly.', themes: [] }
  }

  const sample = flaggedTurns.slice(0, MAX_TURNS_TO_MODEL)
  const client = new Anthropic()
  const payload = {
    window_days: WINDOW_DAYS,
    total_turns: stats.turnCount,
    flagged_turns: stats.flagged,
    signal_counts: stats.signals,
    turns: sample.map(compactForModel),
  }
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYNTH_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  })
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { unavailable: 'The synthesis pass did not return usable JSON.' }
  try {
    const parsed = JSON.parse(match[0])
    if (flaggedTurns.length > sample.length) {
      parsed.truncated = `Synthesis read the ${sample.length} most recent flagged turns of ${flaggedTurns.length}.`
    }
    return parsed
  } catch {
    return { unavailable: 'The synthesis pass returned malformed JSON.' }
  }
}

export async function assistantAudit({ force = false, days = WINDOW_DAYS } = {}) {
  if (!force) {
    const cached = await readAuditCache()
    if (cached && Date.now() - Date.parse(cached.generatedAt) < CACHE_TTL_MS) {
      return { ...cached, fromCache: true }
    }
  }

  const { turns, available, truncated } = await readTurns({ days })
  if (!available) {
    return {
      generatedAt: new Date().toISOString(),
      windowDays: days,
      logging: false,
      note: 'No query log in this environment (the log lives in the production Blob store).',
      turnCount: 0,
    }
  }

  flagTurns(turns)
  const stats = aggregate(turns)
  const flaggedTurns = turns.filter((t) => t.flags.length)

  let synthesis
  try {
    synthesis = await synthesize(flaggedTurns, stats)
  } catch (err) {
    synthesis = { unavailable: 'Synthesis failed: ' + ((err && err.message) || String(err)) }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    logging: true,
    ...stats,
    synthesis,
    // Every flagged turn, verbatim — the audit's claims must be checkable
    // against what was actually asked and answered.
    flaggedTurns: flaggedTurns.map((t) => ({
      at: t.at,
      space: t.space,
      email: t.email,
      question: t.question,
      flags: t.flags,
      replyExcerpt: t.reply ? String(t.reply).slice(0, 700) : null,
      error: t.error || null,
      sqlErrors: (t.sqlErrors || []).slice(0, 2),
      ms: t.ms || null,
      rounds: t.rounds || 0,
    })),
    note: truncated ? 'Log window truncated at the read cap — older turns not included.' : null,
  }

  await writeAuditCache(report)
  return report
}
