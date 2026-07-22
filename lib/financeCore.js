// Finances snapshot data layer (Exec-only surface): operational revenue
// across the streams the Console can already see —
//   wholesale       → Ekos mirror (fact_invoice, line grain)
//   private events  → Tripleseat-synced bookings (eventsCore)
//   losses          → Ekos adjustments at COGS
// Taproom register sales do NOT flow through Ekos invoices (verified
// 2026-07-22: the one taproom-flagged company has zero invoice revenue in
// any year) — they live in Clover and join this snapshot when the Clover
// production API approval lands.
// This is a signal layer, NOT the books: QBO remains the accounting truth
// (the /close automation is blocked on production API keys).

import { getMirror } from './mirror.js'
import { loadNormalized } from './eventsCore.js'
import { taproomMonthlyNet } from './taproomCore.js'

function rows(db, sql) {
  const res = db.exec(sql)
  if (!res.length) return []
  const { columns, values } = res[0]
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])))
}

function todayCT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

const LOSS_REASONS = ['Breakage', 'Spoilage', 'Shrinkage', 'Destroyed']
const q = (s) => `'${s.replace(/'/g, "''")}'`

export async function financesDashboard() {
  const { db, syncedAt } = await getMirror()
  const today = todayCT()
  const year = Number(today.slice(0, 4))
  const lyCutoff = String(year - 1) + today.slice(4)

  // Monthly invoice revenue (all Ekos invoices are wholesale — see header).
  // Line-item grain: SUM(InvoiceItemSubtotal) is safe to sum (schema.js).
  const inv = rows(db, `
    SELECT substr(f.InvoiceOrderDate, 1, 4) AS y,
           substr(f.InvoiceOrderDate, 6, 2) AS m,
           ROUND(SUM(f.InvoiceItemSubtotal)) AS revenue
    FROM fact_invoice f
    WHERE f.InvoiceOrderDate >= '${year - 1}-01-01'
    GROUP BY y, m`)

  const lossYTD = rows(db, `
    SELECT ROUND(-SUM(a.AdjustmentCOGS)) AS dollars
    FROM fact_adjustment a
    JOIN dim_adjustment_reason r ON a.AdjustmentReasonId = r.AdjustmentReasonId
    WHERE r.AdjustmentReasonName IN (${LOSS_REASONS.map(q).join(', ')})
      AND a.AdjustmentTransactionDate >= '${year}-01-01'
      AND a.AdjustmentTransactionDate <= '${today} 23:59:59'`)[0] || {}

  // Taproom register net revenue (Clover via the Brain) — best-effort: if the
  // Clover DBs aren't shared with the Console integration yet, the snapshot
  // still renders with the taproom column pending rather than failing whole.
  let taproom = { byMonth: {}, coverageFrom: null, available: false }
  try {
    const t = await taproomMonthlyNet()
    taproom = { ...t, available: true }
  } catch (err) {
    console.error('[finances] taproom stream unavailable:', (err && err.message) || String(err))
  }

  // Private-events revenue by event month (actual else quoted, no cancelled).
  const { bookings } = await loadNormalized()
  const eventRev = (b) => (b.actualRev != null ? b.actualRev : b.quotedRev || 0)
  const live = bookings.filter((b) => b.status !== 'Cancelled' && b.eventDate)

  // Assemble monthly rows for the current year + LY totals for comparison.
  // LY stays wholesale+events only (taproom has no LY data yet) — the
  // comparison is like-for-like and labeled as such in the UI.
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0')
    const pick = (y) => {
      const r = inv.find((x) => x.y == y && x.m === mm)
      return (r && r.revenue) || 0
    }
    const events = Math.round(live
      .filter((b) => b.eventDate.slice(0, 4) == year && b.eventDate.slice(5, 7) === mm)
      .reduce((n, b) => n + eventRev(b), 0))
    const eventsLY = Math.round(live
      .filter((b) => b.eventDate.slice(0, 4) == year - 1 && b.eventDate.slice(5, 7) === mm)
      .reduce((n, b) => n + eventRev(b), 0))
    const wholesale = pick(year)
    const taproomNet = taproom.byMonth[`${year}-${mm}`] || 0
    const lastYear = pick(year - 1) + eventsLY
    return { month: mm, wholesale, events, taproom: taproomNet, total: wholesale + events + taproomNet, lastYear }
  })

  // KPIs: YTD by stream + fair LY-to-date comparison (through today's date).
  const invSum = (y, cutoff) => {
    let n = 0
    for (const r of inv) {
      if (r.y != y) continue
      if (`${r.y}-${r.m}-01` > cutoff) continue
      n += r.revenue || 0
    }
    return n
  }
  const wholesaleYTD = invSum(year, today)
  const eventsYTD = Math.round(live
    .filter((b) => b.eventDate.slice(0, 4) == year && b.eventDate <= today)
    .reduce((n, b) => n + eventRev(b), 0))
  const eventsLYtd = Math.round(live
    .filter((b) => b.eventDate.slice(0, 4) == year - 1 && b.eventDate <= lyCutoff)
    .reduce((n, b) => n + eventRev(b), 0))
  const taproomYTD = Object.entries(taproom.byMonth)
    .filter(([m]) => m.startsWith(String(year)))
    .reduce((n, [, v]) => n + v, 0)
  const totalYTD = wholesaleYTD + eventsYTD + taproomYTD
  // Like-for-like vs LY excludes taproom (no LY register data yet).
  const likeForLikeYTD = wholesaleYTD + eventsYTD
  const totalLYtd = invSum(year - 1, lyCutoff) + eventsLYtd

  return {
    generatedAt: new Date().toISOString(),
    ekosAsOf: syncedAt,
    today,
    year,
    taproomAvailable: taproom.available,
    taproomFrom: taproom.coverageFrom,
    kpis: {
      totalYTD,
      totalLYtd,
      vsLYPct: totalLYtd > 0 ? Math.round((100 * (likeForLikeYTD - totalLYtd)) / totalLYtd) : null,
      wholesaleYTD,
      eventsYTD,
      taproomYTD,
      lossYTD: lossYTD.dollars || 0,
    },
    monthly,
  }
}
