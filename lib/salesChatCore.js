// The Sales chatbot engine: the shared chat loop (chatCore.runChat) over an
// in-memory SQLite copy of the VIP marts — Mart A (depletion trend) and
// Mart B (account trajectory). Read-only by construction; same pattern as
// the Events assistant (eventsChatCore).

import fs from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { runChat } from './chatCore.js'
import { loadMarts } from './salesCore.js'
import { brainContextFor } from './brainContext.js'

const require = createRequire(import.meta.url)

const REFRESH_MS = 15 * 60 * 1000
let SQL = null
let cache = { db: null, builtAt: 0, cols: null }

async function ensureSqlJs() {
  if (SQL) return SQL
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) })
  return SQL
}

// sql.js throws (a string!) on binding undefined — coalesce every value.
const v = (x) => (x === undefined || x === '' ? null : x)

export async function getSalesDb() {
  if (cache.db && Date.now() - cache.builtAt < REFRESH_MS) return cache
  const sqljs = await ensureSqlJs()
  const { martA, accounts, cols, martC } = await loadMarts()

  // The newest weeks in Mart C are still settling: the latest is partial and
  // the one before it is still being restated (distributor reporting lags).
  // Flag both so the assistant excludes them from trend/momentum, and mark the
  // very newest as provisional (genuinely partial). (ADR-015; Garrison 2026-07-23.)
  const sortedWeeks = (martC && martC.length) ? [...new Set(martC.map((r) => r.week))].sort() : []
  const provisionalWeek = sortedWeeks.length ? sortedWeeks[sortedWeeks.length - 1] : null
  const settlingWeeks = new Set(sortedWeeks.slice(-2)) // newest two

  const db = new sqljs.Database()
  const histCols = (cols ? cols.history : []).map((h) => 'ce_' + h.slice(3)) // "CE 2021" -> ce_2021
  db.run(`
    CREATE TABLE depletions (
      brand TEXT, distributor TEXT, branch TEXT, segment TEXT, year INTEGER,
      ce REAL, units REAL, effective REAL, did_buys REAL, placements REAL,
      ce_prior_year REAL, yoy_delta REAL, yoy_pct REAL
    );
    CREATE TABLE accounts (
      name TEXT, city TEXT, address TEXT, chain TEXT, chain_account INTEGER,
      class_of_trade TEXT, distributor TEXT, trajectory TEXT,
      ce_ytd REAL, ce_same_period REAL,
      ${histCols.map((c) => c + ' REAL').join(', ')},
      first_active INTEGER, last_active INTEGER, peak_year INTEGER, peak_ce REAL,
      yoy_delta REAL, airport_cluster INTEGER
    );
    CREATE TABLE weekly (
      brand TEXT, distributor TEXT, branch TEXT, segment TEXT,
      week TEXT, week_label TEXT,
      ce REAL, units REAL, did_buys REAL, effective REAL, placements REAL,
      provisional INTEGER, settling INTEGER
    );
  `)

  const insA = db.prepare('INSERT INTO depletions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
  for (const r of martA) {
    insA.run([
      v(r.brand), v(r.distributor), v(r.branch), v(r.segment), v(r.year),
      v(r.ce), v(r.units), v(r.effective), v(r.didBuys), v(r.placements),
      v(r.cePrior), v(r.yoyDelta), v(r.yoyPct),
    ])
  }
  insA.free()

  // Placeholder count derives from the row we actually bind — the column
  // list and the values can never drift apart again (a hardcoded count
  // shipped 19 placeholders against 21 columns and broke every query).
  const accountRow = (a) => [
    v(a.name), v(a.city), v(a.address), v(a.chain), a.chainAccount ? 1 : 0,
    v(a.classOfTrade), v(a.distributor), v(a.trajectory),
    v(a.ceYtd), v(a.ceSamePeriod),
    ...(cols ? cols.history : []).map((h) => v(a.history[h.slice(3)])),
    v(a.firstActive), v(a.lastActive), v(a.peakYear), v(a.peakCe),
    v(a.yoyDelta), a.airport ? 1 : 0,
  ]
  const width = accounts.length ? accountRow(accounts[0]).length : 0
  const insB = db.prepare(`INSERT INTO accounts VALUES (${Array(width).fill('?').join(',')})`)
  for (const a of accounts) {
    insB.run(accountRow(a))
  }
  insB.free()

  // Same width-derived-placeholder discipline as accounts above.
  const weeklyRow = (w) => [
    v(w.brand), v(w.distributor), v(w.branch), v(w.segment),
    v(w.week), v(w.weekLabel),
    v(w.ce), v(w.units), v(w.didBuys), v(w.effective), v(w.placements),
    w.week === provisionalWeek ? 1 : 0,
    settlingWeeks.has(w.week) ? 1 : 0,
  ]
  const weeklyRows = martC || []
  if (weeklyRows.length) {
    const wWidth = weeklyRow(weeklyRows[0]).length
    const insC = db.prepare(`INSERT INTO weekly VALUES (${Array(wWidth).fill('?').join(',')})`)
    for (const w of weeklyRows) insC.run(weeklyRow(w))
    insC.free()
  }

  if (cache.db) cache.db.close()
  cache = { db, builtAt: Date.now(), cols, provisionalWeek }
  return cache
}

function buildSalesSystemPrompt(builtAt, cols, provisionalWeek) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  const year = cols ? cols.currentYear : Number(today.slice(0, 4))
  const histList = (cols ? cols.history : []).map((h) => 'ce_' + h.slice(3)).join(', ')
  return `You are the Sales Assistant for Spindletap Beverages — a read-only analyst
for wholesale/distribution, answering the sales team (and executives) in plain,
concise language. Today's date is ${today}. Data comes from the VIP marts in the
company Brain (Mart A/B refreshed monthly, Mart C weekly; loaded ${new Date(builtAt).toISOString()}).
CE = case-equivalent units, the standard volume measure.

You query a SQLite database with three tables.

TABLE depletions — Mart A: one row per Brand × Distributor × Segment × Year.
  brand, distributor, branch, segment ('On-Premise'/'Off-Premise'), year,
  ce, units, effective, did_buys, placements,
  ce_prior_year, yoy_delta, yoy_pct.
  NOTE: year ${year} rows are YTD (partial year); earlier years are full-year.
  Comparing ${year} to a full prior year overstates decline — for a fair
  current-year comparison use the accounts table's same-period column.

TABLE accounts — Mart B: one row per retail account (${cols ? 'columns detected live' : ''}).
  name, city, address, chain, chain_account (0/1), class_of_trade,
  distributor (parent, last-active), trajectory
  ('New ${year}' / 'Growing' / 'Steady' / 'Declining' / 'Lapsed ${year}' or earlier / 'Never material'),
  ce_ytd (${year} YTD), ce_same_period (${cols ? cols.sameYear : year - 1} same-period — the fair YoY base),
  ${histList} (full-year history),
  first_active, last_active, peak_year, peak_ce, yoy_delta (ce_ytd - ce_same_period),
  airport_cluster (0/1).

TABLE weekly — Mart C: one row per Brand × Distributor × Segment × Week (a
rolling ~13-week trailing window that accumulates over time).
  brand, distributor, branch, segment, week (ISO 'yyyy-mm-dd' week-ENDING date),
  week_label (verbatim VIP range, e.g. '7/19/2026 thru 7/25/2026'),
  ce, units, did_buys, effective, placements,
  provisional (0/1), settling (0/1).
  CRITICAL: the newest two weeks are still SETTLING (settling=1) — the latest
  (provisional=1) is a partial week, and the one before it is still being
  restated as distributors report late; both rise as later pulls arrive. For
  any trend, momentum, or "how are we doing lately" question, EXCLUDE the
  settling weeks (WHERE settling=0) so a still-filling week isn't read as a
  real decline. You may report a settling week's individual number if asked,
  but SAY it is still settling/partial. There is no year-over-year at weekly
  grain; use the depletions/accounts tables for YoY. Use this table for recent
  momentum ("which brands are moving lately"), NOT for annual totals.

Conventions:
- Growth buckets per ADR-013: Growing > +10%, Steady within ±10%, Declining < -10%.
- Fair YoY = SUM(ce_ytd) vs SUM(ce_same_period). Volumes to 1 decimal; lead with the number.
- This is DISTRIBUTOR DEPLETION data (wholesale to retail). Taproom sales, production,
  and private events are NOT here — say so instead of guessing.
- Mart A/B (annual, accounts) refresh monthly; Mart C (weekly) refreshes weekly.
  For "this week"/recent-momentum questions use the weekly table and mind the
  provisional flag.`
}

export async function handleSalesChat(body, email) {
  const { db, builtAt, cols, provisionalWeek } = await getSalesDb()
  return runChat({
    body,
    email,
    db,
    system: buildSalesSystemPrompt(builtAt, cols, provisionalWeek) + (await brainContextFor('Sales')),
    toolDescription:
      'Run one read-only SQLite SELECT against the Spindletap VIP distribution marts (depletions + accounts). Returns rows as JSON. Prefer aggregated queries with LIMIT.',
    dataAsOf: new Date(builtAt).toISOString(),
    label: 'sales-chat',
  })
}
