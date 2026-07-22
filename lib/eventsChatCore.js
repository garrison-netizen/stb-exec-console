// The Events chatbot engine: the shared chat loop (chatCore.runChat) over an
// in-memory SQLite copy of the Private Events data — the same Notion reads
// the Events dashboard uses, loaded into two flat tables so Claude can query
// leads and bookings with plain SELECTs. Read-only by construction.

import fs from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { runChat } from './chatCore.js'
import { loadNormalized } from './eventsCore.js'
import { brainContextFor } from './brainContext.js'

const require = createRequire(import.meta.url)

const REFRESH_MS = 15 * 60 * 1000
let SQL = null
let cache = { db: null, builtAt: 0 }

async function ensureSqlJs() {
  if (SQL) return SQL
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) })
  return SQL
}

export async function getEventsDb() {
  if (cache.db && Date.now() - cache.builtAt < REFRESH_MS) return cache
  const sqljs = await ensureSqlJs()
  const { leads, bookings } = await loadNormalized()

  const db = new sqljs.Database()
  db.run(`
    CREATE TABLE leads (
      title TEXT, event_type TEXT, headcount REAL, requested_date TEXT,
      status TEXT, created_at TEXT, converted_at TEXT, source TEXT
    );
    CREATE TABLE bookings (
      title TEXT, event_date TEXT, status TEXT,
      quoted_revenue REAL, actual_revenue REAL, bar_sales REAL,
      deposit_amount REAL, deposit_paid INTEGER, balance_paid INTEGER,
      final_headcount REAL, rep TEXT
    );
  `)

  // sql.js throws (a string!) on binding undefined — coalesce every value.
  const v = (x) => (x === undefined || x === '' ? null : x)

  const insLead = db.prepare(
    'INSERT INTO leads VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const l of leads) {
    insLead.run([
      v(l.title), v(l.eventType), v(l.headcount), v(l.reqDate),
      v(l.status), v(l.createdAt), v(l.convertedAt), v(l.source),
    ])
  }
  insLead.free()

  const insBooking = db.prepare(
    'INSERT INTO bookings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const b of bookings) {
    insBooking.run([
      v(b.title), v(b.eventDate), v(b.status),
      v(b.quotedRev), v(b.actualRev), v(b.barActual),
      v(b.depositAmt), b.depositPaid ? 1 : 0, b.balancePaid ? 1 : 0,
      v(b.finalHc), v(b.rep),
    ])
  }
  insBooking.free()

  if (cache.db) cache.db.close()
  cache = { db, builtAt: Date.now() }
  return cache
}

function buildEventsSystemPrompt(builtAt) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  return `You are the Events Assistant for Spindletap Beverages — a read-only analyst
for the private-events business, answering the events team (and executives) in plain,
concise language. Today's date is ${today} (America/Chicago). Data was loaded from
Notion (Triple Seat daily 6am sync) at ${new Date(builtAt).toISOString()}.

You query a SQLite database with two tables. All dates are TEXT 'YYYY-MM-DD';
compare with string dates like '2026-01-01'.

TABLE leads — one row per Triple Seat inquiry.
  title, event_type (Corporate / Private celebration / Wedding / Other, often NULL),
  headcount (estimate), requested_date, status (Pending / Booked / Passed / Lost),
  created_at, converted_at (NULL until booked), source (lead source name).

TABLE bookings — one row per real booking (definite+); prospects/tentatives are
still leads and are NOT in this table.
  title, event_date, status (Confirmed / Completed / Cancelled),
  quoted_revenue, actual_revenue, bar_sales,
  deposit_amount, deposit_paid (0/1), balance_paid (0/1),
  final_headcount, rep (Assigned rep).

Conventions (match the PE Dashboard):
- Event revenue = COALESCE(actual_revenue, quoted_revenue, 0). Exclude
  status = 'Cancelled' from revenue totals. Bar sales are reported separately.
- deposit_paid / balance_paid are poorly maintained in the source system —
  caveat any payment-status answer accordingly.
- Money: whole dollars with $ and commas. Be direct; lead with the number.
- If a question needs data you don't have (contracts, emails, calendar holds),
  say so rather than guessing.`
}

export async function handleEventsChat(body, email) {
  const { db, builtAt } = await getEventsDb()
  return runChat({
    body,
    email,
    db,
    system: buildEventsSystemPrompt(builtAt) + (await brainContextFor('Events')),
    toolDescription:
      'Run one read-only SQLite SELECT against the Spindletap private-events database (leads + bookings). Returns rows as JSON. Prefer aggregated queries with LIMIT.',
    dataAsOf: new Date(builtAt).toISOString(),
    label: 'events-chat',
  })
}
