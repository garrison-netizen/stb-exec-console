// The Taproom chatbot engine: the shared chat loop (chatCore.runChat) over an
// in-memory SQLite copy of the Clover register data — daily totals plus the
// two product grains (monthly history / living weekly feed). Read-only by
// construction; same pattern as the Events and Sales assistants.

import fs from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { runChat } from './chatCore.js'
import { loadTaproom, loadSkuMonths, ORDERS_ERA_FROM, provenanceForDate } from './taproomCore.js'
import { brainContextFor } from './brainContext.js'

const require = createRequire(import.meta.url)

const REFRESH_MS = 15 * 60 * 1000
let SQL = null
let cache = { db: null, builtAt: 0, coverage: null }

async function ensureSqlJs() {
  if (SQL) return SQL
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) })
  return SQL
}

// sql.js throws (a string!) on binding undefined — coalesce every value.
const v = (x) => (x === undefined || x === '' ? null : x)

export async function getTaproomDb() {
  if (cache.db && Date.now() - cache.builtAt < REFRESH_MS) return cache
  const sqljs = await ensureSqlJs()
  const [{ daily, skus }, months] = await Promise.all([
    loadTaproom(),
    // Month history is one share away from existing — degrade, don't die.
    loadSkuMonths().catch((err) => {
      console.error('[taproom-chat] month table unavailable:', (err && err.message) || String(err))
      return []
    }),
  ])

  const db = new sqljs.Database()
  // Every table carries a provenance column — how the row was derived is DATA,
  // never something the assistant has to recompute from a boundary date.
  db.run(`
    CREATE TABLE daily (
      date TEXT, day_of_week TEXT, transactions INTEGER,
      gross_revenue REAL, net_revenue REAL, tax_collected REAL, tips REAL,
      discounts REAL, tender_card REAL, tender_cash REAL, tender_other REAL,
      provenance TEXT
    );
    CREATE TABLE sku_months (
      sku TEXT, category TEXT, month TEXT, gross_revenue REAL, net_revenue REAL, units REAL,
      provenance TEXT
    );
    CREATE TABLE sku_weeks (
      sku TEXT, category TEXT, week_start TEXT, revenue REAL, units REAL,
      provenance TEXT
    );
  `)

  const dailyRow = (d) => [
    v(d.date), v(d.dow), v(d.transactions), v(d.gross), v(d.net), v(d.tax),
    v(d.tips), v(d.discounts), v(d.card), v(d.cash), v(d.other),
    provenanceForDate(d.date),
  ]
  const insD = db.prepare(`INSERT INTO daily VALUES (${Array(dailyRow(daily[0] || {}).length).fill('?').join(',')})`)
  for (const d of daily) insD.run(dailyRow(d))
  insD.free()

  const insM = db.prepare('INSERT INTO sku_months VALUES (?,?,?,?,?,?,?)')
  for (const m of months) {
    insM.run([v(m.name), v(m.category), v(m.month), v(m.gross), v(m.net), v(m.units), 'export-load'])
  }
  insM.free()

  const insW = db.prepare('INSERT INTO sku_weeks VALUES (?,?,?,?,?,?)')
  for (const s of skus) {
    insW.run([v(s.name), v(s.category), v(s.week), v(s.revenue), v(s.units), 'orders'])
  }
  insW.free()

  const dates = daily.map((d) => d.date)
  const coverage = { from: dates[0] || null, to: dates[dates.length - 1] || null, hasMonths: months.length > 0 }
  if (cache.db) cache.db.close()
  cache = { db, builtAt: Date.now(), coverage }
  return cache
}

// Stamps every query result with what the caveat rule needs. Two paths:
// exact counts when the result carries provenance, otherwise an era verdict
// derived from the SQL's own date literals (no literals on a history table
// = full history = spans the rebuild era). The model reads a verdict; it
// never has to work out which side of a boundary a date falls on.
export function provenanceStamp(sql, rows) {
  const q = String(sql || '')
  const lower = q.toLowerCase()

  if (Array.isArray(rows) && rows.length && 'provenance' in rows[0]) {
    const counts = {}
    for (const r of rows) counts[r.provenance || 'unknown'] = (counts[r.provenance || 'unknown'] || 0) + 1
    const parts = Object.entries(counts).map(([k, n]) => `${n} ${k}`)
    const rebuilt = counts['payments-rebuild'] || counts['export-load'] || 0
    return `PROVENANCE: rows returned — ${parts.join(', ')}. ` +
      (rebuilt ? 'CAVEAT REQUIRED in your answer (discounts/refunds).' : 'No caveat needed.')
  }

  const touchesDaily = /\bdaily\b/.test(lower)
  const touchesMonths = /\bsku_months\b/.test(lower)
  const touchesWeeks = /\bsku_weeks\b/.test(lower)
  if (!touchesDaily && !touchesMonths && !touchesWeeks) return ''

  if (touchesMonths) {
    return 'PROVENANCE: sku_months is entirely export-load (verified monthly exports, pre-May-2026 era). ' +
      'CAVEAT REQUIRED in your answer (discounts/refunds).'
  }
  if (touchesWeeks && !touchesDaily) {
    return 'PROVENANCE: sku_weeks is entirely orders-derived. No caveat needed.'
  }

  // daily: decide the era from the date literals the query itself used.
  const literals = (q.match(/'(\d{4}-\d{2}(?:-\d{2})?)'/g) || []).map((s) => s.replace(/'/g, ''))
  const boundaryMonth = ORDERS_ERA_FROM.slice(0, 7)
  const beforeBoundary = literals.filter((d) => (d.length === 7 ? d < boundaryMonth : d < ORDERS_ERA_FROM))
  if (!literals.length) {
    return `PROVENANCE: unfiltered query over daily — spans both eras (payments-rebuild before ${ORDERS_ERA_FROM}, orders after). ` +
      'CAVEAT REQUIRED in your answer (discounts/refunds).'
  }
  if (beforeBoundary.length) {
    return `PROVENANCE: this query's date range reaches before ${ORDERS_ERA_FROM}, so it includes payments-rebuild rows. ` +
      'CAVEAT REQUIRED in your answer (discounts/refunds).'
  }
  return `PROVENANCE: this query's date range is entirely on or after ${ORDERS_ERA_FROM} (orders-derived). No caveat needed.`
}

function buildTaproomSystemPrompt(builtAt, coverage) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  return `You are the Taproom Assistant for Spindletap Beverages — a read-only analyst
for the taproom's Clover register data, answering the taproom team (and executives)
in plain, concise language. Today's date is ${today}. Data loaded ${new Date(builtAt).toISOString()};
register history refreshes daily ~6am CT and is audited against Clover's own reports.

You query a SQLite database with three tables. All dates are TEXT 'YYYY-MM-DD'.

TABLE daily — one row per open day, ${coverage?.from || '2025-03-06'} → ${coverage?.to || 'yesterday'}.
  date, day_of_week (Mon..Sun), transactions,
  gross_revenue (order totals incl tax, post-discount), net_revenue (gross − tax),
  tax_collected, tips, discounts, tender_card, tender_cash, tender_other.

TABLE sku_months — product history at MONTH grain, 2025-03 → 2026-04 only (one-time
verified load; it does NOT grow). sku, category, month ('YYYY-MM'),
gross_revenue, net_revenue, units.${coverage?.hasMonths ? '' : ' CURRENTLY EMPTY (access pending) — say product history before May 2026 is not connected yet if asked.'}

TABLE sku_weeks — the LIVING product feed at WEEK grain, reliable from week_start
2026-04-27 forward; current week recomputed each morning.
  sku, category ('Beer'/'THC'/'Coffee'/'Food'/'Merch'/'Other'), week_start, revenue, units.

GRAIN RULES (hard):
- Product questions about periods through Apr 2026 → sku_months. From May 2026 → sku_weeks.
  NEVER mix the two grains in one series or sum them across their boundary.
- Whole-taproom revenue/traffic questions → daily (it spans the full history).

PROVENANCE — DO NOT REASON ABOUT DATES, READ THE STAMP:
Every table has a provenance column ('payments-rebuild' | 'orders' | 'export-load'),
and every query result is prefixed with a PROVENANCE: line stating whether a caveat
is required. Follow that line literally:
- "CAVEAT REQUIRED" → your answer MUST say, unprompted, that the figures come partly
  from rebuilt payment records: discounts show as 0 (not truly zero) and days with
  refunds read slightly high.
- "No caveat needed" → do NOT mention provenance at all.
Never assert which era a date belongs to from memory; the stamp is the authority.
(For reference only: payments-rebuild covers dates before ${ORDERS_ERA_FROM}.)

Conventions: money in whole dollars with $ and commas; lead with the number;
say what period you assumed. Boundaries — be straight about them: this is DAILY
register data (no time-of-day breakdown), no labor/staffing (staff don't clock
in via Clover), no customer identity, no reservations, and accounting truth
lives in QBO — this is the operational register view.`
}

export async function handleTaproomChat(body, email) {
  const { db, builtAt, coverage } = await getTaproomDb()
  return runChat({
    body,
    email,
    db,
    system: buildTaproomSystemPrompt(builtAt, coverage) + (await brainContextFor('Taproom')),
    toolDescription:
      'Run one read-only SQLite SELECT against the Spindletap taproom register data (daily totals + product months/weeks). Returns rows as JSON. Prefer aggregated queries with LIMIT.',
    dataAsOf: new Date(builtAt).toISOString(),
    label: 'taproom-chat',
    annotate: provenanceStamp,
  })
}
