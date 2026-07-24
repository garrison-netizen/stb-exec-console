// Assistant query log — one record per department-assistant turn.
//
// Why this exists: until 2026-07-24 nothing about assistant conversations was
// stored server-side (conversations live in each user's localStorage, and the
// Vercel runtime log keeps only a counts line for about an hour). There was no
// way to see what the bots were being asked, let alone what they were failing
// at. This module is the raw material for lib/auditCore.js.
//
// Storage: the project's existing PRIVATE Blob store — no new infrastructure,
// no new credential. One small JSON blob per turn, at
//   assistant-logs/<space>/<YYYY-MM-DD>/<timestamp>-<rand>.json
// Per-turn blobs (rather than a daily rollup) because two concurrent turns
// read-modify-writing one file would silently lose records.
//
// Writes are FIRE-AND-FORGET: a logging failure must never cost a user their
// answer. Reads are capped and windowed — at present volume (a handful of
// turns a day) the audit fetches every record in the window individually.

import { get, list, put } from '@vercel/blob'

const PREFIX = 'assistant-logs/'
const MAX_QUESTION = 2000
const MAX_REPLY = 4000
const MAX_SQL = 1200
const FETCH_CONCURRENCY = 8

const clip = (s, n) => (s == null ? null : String(s).slice(0, n))

function token() {
  return process.env.BLOB_READ_WRITE_TOKEN || null
}

// Record one turn. Never throws, never awaited by the request path.
export function logTurn(rec) {
  const t = token()
  if (!t) return // local dev has no blob store — nothing to log to
  const at = rec.at || new Date().toISOString()
  const space = String(rec.space || 'unknown').toLowerCase()
  const day = at.slice(0, 10)
  const stamp = at.replace(/[:.]/g, '-')
  const suffix = Math.random().toString(36).slice(2, 8)
  const path = `${PREFIX}${space}/${day}/${stamp}-${suffix}.json`

  const body = JSON.stringify({
    at,
    space,
    email: rec.email || null,
    conversationId: rec.conversationId || null,
    turn: rec.turn || null,
    question: clip(rec.question, MAX_QUESTION),
    reply: clip(rec.reply, MAX_REPLY),
    error: clip(rec.error, 500),
    ms: rec.ms || null,
    rounds: rec.rounds || 0,
    queries: (rec.queries || []).map((q) => clip(q, MAX_SQL)),
    sqlErrors: (rec.sqlErrors || []).map((e) => clip(e, 500)),
    toolErrors: (rec.toolErrors || []).map((e) => clip(e, 500)),
    outOfTime: !!rec.outOfTime,
    roundCap: !!rec.roundCap,
    replyChars: rec.reply ? String(rec.reply).length : 0,
  })

  // access: 'private' — these records hold staff questions verbatim, so the
  // blob URL must require authentication rather than merely be unguessable.
  put(path, body, {
    access: 'private',
    token: t,
    contentType: 'application/json',
    addRandomSuffix: false,
  }).catch((err) => {
    console.error('[assistant-log] write failed:', (err && err.message) || err)
  })
}

async function fetchJson(pathname, t) {
  const res = await get(pathname, { access: 'private', token: t })
  if (!res || !res.stream) throw new Error('log blob missing: ' + pathname)
  return new Response(res.stream).json()
}

// Read back every logged turn in the trailing `days` window, newest first.
export async function readTurns({ days = 14, max = 1500 } = {}) {
  const t = token()
  if (!t) return { turns: [], available: false }

  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const blobs = []
  let cursor
  do {
    const page = await list({ token: t, prefix: PREFIX, limit: 1000, cursor })
    for (const b of page.blobs || []) {
      // assistant-logs/<space>/<YYYY-MM-DD>/...
      const parts = b.pathname.split('/')
      const day = parts[2]
      if (!day || day < cutoff) continue
      blobs.push(b)
    }
    cursor = page.hasMore ? page.cursor : null
  } while (cursor && blobs.length < max)

  blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1)) // newest first
  const slice = blobs.slice(0, max)

  const turns = []
  for (let i = 0; i < slice.length; i += FETCH_CONCURRENCY) {
    const batch = slice.slice(i, i + FETCH_CONCURRENCY)
    const settled = await Promise.allSettled(batch.map((b) => fetchJson(b.pathname, t)))
    for (const r of settled) if (r.status === 'fulfilled' && r.value) turns.push(r.value)
  }
  turns.sort((a, b) => (a.at < b.at ? 1 : -1))
  return { turns, available: true, truncated: blobs.length > max }
}

// Small cache slot for the audit report, alongside the logs.
const CACHE_PATH = PREFIX + '_audit/latest.json'

export async function readAuditCache() {
  const t = token()
  if (!t) return null
  try {
    const { blobs } = await list({ token: t, prefix: CACHE_PATH, limit: 5 })
    if (!(blobs || []).some((b) => b.pathname === CACHE_PATH)) return null
    return await fetchJson(CACHE_PATH, t)
  } catch {
    return null
  }
}

export async function writeAuditCache(report) {
  const t = token()
  if (!t) return
  try {
    await put(CACHE_PATH, JSON.stringify(report), {
      access: 'private',
      token: t,
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    })
  } catch (err) {
    console.error('[assistant-log] audit cache write failed:', (err && err.message) || err)
  }
}
