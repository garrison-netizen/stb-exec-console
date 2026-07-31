// Taproom dashboard data layer: the Clover-fed Brain databases (Taproom
// Daily + Taproom SKU-by-week + Labor Daily). Read-only. IMPORTANT COVERAGE
// REALITY: the Clover backfill is self-chaining backward toward 2025-05-01,
// so the coverage window is partial and growing — every surface states its
// window and nothing fakes a year-over-year until the data reaches back.
// Labor Daily is empty until that feed flows; its section stays hidden.

const cleanEnv = (v) => (v || '').trim().replace(/^["']|["']$/g, '').trim()
const NOTION_TOKEN = cleanEnv(process.env.NOTION_TOKEN)
const DAILY_DS = cleanEnv(process.env.NOTION_CLOVER_DAILY_DS)
const SKUWEEK_DS = cleanEnv(process.env.NOTION_CLOVER_SKUWEEK_DS)
const SKUMONTH_DS = cleanEnv(process.env.NOTION_CLOVER_SKUMONTH_DS)
const LABOR_DS = cleanEnv(process.env.NOTION_CLOVER_LABOR_DS)

// Data contract (Clover import handoff, 2026-07-22):
// - Daily: 2025-03-06 → yesterday, daily ~6am refresh. Rows titled like
//   "000 DELETE ME" are tombstones pending deletion — keep only real dates.
// - SKU WEEKS are reliable from this boundary; earlier rows were built from
//   purged-order fragments and are being deleted. The 2026-04-27 week is
//   missing Apr 28-30 detail (the month table covers April fully).
// - SKU MONTHS (Architect-scaffolded) cover 2025-03 → 2026-04, one-time
//   load, no recurring pipeline. Never mix the two grains in one series.
const WEEK_RELIABLE_FROM = '2026-04-27'
const DATE_RE = /^2\d{3}-\d{2}-\d{2}$/

// PROVENANCE ERAS — the single source of truth for how a row was derived.
// Daily rows before ORDERS_ERA_FROM were rebuilt from Clover payment records
// (discounts unavailable → NULL, never 0; refund days read slightly high);
// from that date they come from full order data. Rows before CLOVER_FROM come
// from the retired Arryved POS (one-time history load, 2026-07-23). Keep eras
// here, in ONE place: the Arryved load added an entry, not scattered edits.
//
// Discounts in the payments era USED to be written as 0, and both the pipeline
// and this file treated that as expected. It was not: zero is a claim ("we ran
// no promotions"), null is the truth ("payments cannot tell us"). It made the
// daily surface report $0.00 across ~356 days while the SKU-by-Month table
// reported roughly $132,500 for the same period. Corrected 2026-07-31 — the
// rows are now NULL and this file must never coerce them back.
export const CLOVER_FROM = '2025-03-13'
export const ORDERS_ERA_FROM = '2026-05-01'
export const provenanceForDate = (iso) =>
  iso < CLOVER_FROM ? 'arryved' : iso >= ORDERS_ERA_FROM ? 'orders' : 'payments-rebuild'

// Columns the Arryved era does not have. They are NULL BY NATURE, not missing
// by error: Arryved's monthly exports carry net revenue, tax and comps only.
// Any KPI or chart built on these MUST scope itself to Clover rows, or it
// renders a four-year cliff that reads as a business collapse. The `Source`
// column on the row is authoritative; the date is the fallback for rows
// written before the stamping pass.
export const CLOVER_ONLY_FIELDS = ['gross', 'tips', 'card', 'cash', 'other', 'transactions']

// Columns only the ORDERS era can supply. Payment records carry no discount
// data at all, so a payments-era discount is unknowable rather than zero.
// Anything summing discounts across the seam must scope to the orders era or
// state that the earlier span is not measured — the SKU-by-Month table, built
// from item-level exports, is the surface that actually knows.
export const ORDERS_ONLY_FIELDS = ['discounts']
export const hasDiscountData = (d) =>
  provenanceForDate(d.date || d) === 'orders'
const isClover = (d) => (d.source ? d.source === 'clover' : d.date >= CLOVER_FROM)

const CACHE_MS = 15 * 60 * 1000
let cache = { at: 0, model: null }

async function loadAll(dsId, label) {
  if (!dsId) throw new Error(`Clover data source id missing from env (${label}).`)
  const rows = []
  let cursor = null
  let guard = 0
  do {
    const body = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const res = await fetch(`https://api.notion.com/v1/data_sources/${dsId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (res.status === 404) {
      throw new Error(
        `Notion 404 on ${label} — share the Clover taproom databases with the STB ` +
        `Executive Console integration (⋯ → Connections) and retry.`
      )
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Notion query failed on ${label} (${res.status}): ${text.slice(0, 200)}`)
    }
    const data = await res.json()
    rows.push(...(data.results || []))
    cursor = data.has_more ? data.next_cursor : null
    guard += 1
  } while (cursor && guard < 100)
  return rows
}

const text = (page, name) => {
  const prop = page.properties?.[name]
  const arr = prop?.title || prop?.rich_text || []
  return arr.map((t) => t.plain_text || '').join('')
}
const num = (page, name) => page.properties?.[name]?.number ?? null
const sel = (page, name) => page.properties?.[name]?.select?.name || ''
const dateISO = (page, name) => (page.properties?.[name]?.date?.start || '').slice(0, 10)

const r0 = (n) => Math.round(n || 0)
const r1 = (n) => Math.round((n || 0) * 10) / 10

function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function shiftYear(iso) {
  return String(Number(iso.slice(0, 4)) - 1) + iso.slice(4)
}

// Monday of the ISO week containing the date (matches the SKU-week grain).
function weekStart(iso) {
  const d = new Date(iso + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

export async function loadTaproom({ force = false } = {}) {
  if (!force && cache.model && Date.now() - cache.at < CACHE_MS) return cache.model

  const [dailyRows, skuRows, laborRows] = await Promise.all([
    loadAll(DAILY_DS, 'Taproom Daily'),
    loadAll(SKUWEEK_DS, 'Taproom SKU-by-week'),
    // Labor is optional (feed not flowing yet) — never let it kill the dashboard.
    loadAll(LABOR_DS, 'Taproom Labor Daily').catch((err) => {
      console.error('[taproom] labor feed unavailable:', (err && err.message) || String(err))
      return []
    }),
  ])

  const daily = dailyRows
    .map((r) => ({
      // "Date" may be a real date property or the row's title text ("YYYY-MM-DD").
      date: dateISO(r, 'Date') || text(r, 'Date').slice(0, 10),
      dow: sel(r, 'Day of week') || text(r, 'Day of week'),
      source: (sel(r, 'Source') || '').toLowerCase(),
      transactions: num(r, 'Transaction count') || 0,
      gross: num(r, 'Gross revenue') || 0,
      net: num(r, 'Net revenue') || 0,
      tax: num(r, 'Tax collected') || 0,
      tips: num(r, 'Tips') || 0,
      // NOT `|| 0` — a null here means "not captured", and coercing it to 0
      // is what let the Console report $0.00 of discounts for 14 months.
      discounts: num(r, 'Discounts applied'),
      comps: num(r, 'Comps') || 0,
      card: num(r, 'Tender - card') || 0,
      cash: num(r, 'Tender - cash') || 0,
      other: num(r, 'Tender - other') || 0,
    }))
    .filter((d) => DATE_RE.test(d.date)) // drops tombstone rows per contract
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const skus = skuRows
    .map((r) => ({
      name: text(r, 'Clover SKU name'),
      category: sel(r, 'Category') || text(r, 'Category') || 'Other',
      week: (r.properties?.['Week start']?.date?.start || '').slice(0, 10),
      revenue: num(r, 'Revenue') || 0,
      units: num(r, 'Units sold') || 0,
    }))
    .filter((s) => s.week && s.week >= WEEK_RELIABLE_FROM)

  const labor = laborRows.length // stays 0: staff don't clock in via Clover

  cache = { at: Date.now(), model: { daily, skus, laborRows: labor, loadedAt: new Date().toISOString() } }
  return cache.model
}

export async function taproomDashboard({ force = false } = {}) {
  const { daily, skus, laborRows, loadedAt } = await loadTaproom({ force })

  const revDays = daily.filter((d) => d.net > 0)
  const cloverDays = revDays.filter(isClover)
  const coverage = {
    from: daily.length ? daily[0].date : null,
    to: daily.length ? daily[daily.length - 1].date : null,
    tradingDays: revDays.length,
    // Era split, so every surface can state the window it actually covers.
    cloverFrom: cloverDays.length ? cloverDays[0].date : null,
    cloverTradingDays: cloverDays.length,
    arryvedTradingDays: revDays.length - cloverDays.length,
  }

  // Net revenue is the one money column both eras carry, so lifetime net is
  // honest. Everything else sums CLOVER ROWS ONLY — summing the Arryved era's
  // nulls as zeroes would quietly halve tips and understate transactions.
  const sum = (rows, f) => rows.reduce((n, d) => n + d[f], 0)
  const totals = {
    net: sum(revDays, 'net'),
    gross: sum(cloverDays, 'gross'),
    tips: sum(cloverDays, 'tips'),
    transactions: sum(cloverDays, 'transactions'),
    card: sum(cloverDays, 'card'),
    cash: sum(cloverDays, 'cash'),
  }
  const tender = totals.card + totals.cash
  const best = revDays.reduce((b, d) => (d.net > (b?.net || 0) ? d : b), null)

  // Weekly net trend from the daily rows (Mon-start weeks).
  const byWeek = new Map()
  for (const d of revDays) {
    const w = weekStart(d.date)
    byWeek.set(w, (byWeek.get(w) || 0) + d.net)
  }
  const weekly = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, net]) => ({ week, net: r0(net) }))
    .slice(-13) // one quarter of weeks, matches the 13-week idea

  // Day-of-week profile (average net on trading days), scoped to the trailing
  // 52 weeks. This answers "what does a good Thursday look like NOW", and the
  // fixed window keeps the number meaning the same thing as history grows —
  // unscoped, the Arryved load would have silently turned a 16-month profile
  // into a four-year blend of two different businesses.
  const dowFrom = coverage.to ? addDays(coverage.to, -363) : null
  const dowDays = dowFrom ? revDays.filter((d) => d.date >= dowFrom) : revDays
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const dowProfile = DOW.map((dow) => {
    const days = dowDays.filter((d) => d.dow === dow)
    return {
      dow,
      days: days.length,
      avgNet: days.length ? r0(days.reduce((n, d) => n + d.net, 0) / days.length) : 0,
    }
  })

  // Category mix + top SKUs (SKU grain is gross-ish register revenue).
  const byCat = new Map()
  for (const s of skus) byCat.set(s.category, (byCat.get(s.category) || 0) + s.revenue)
  const categories = [...byCat.entries()]
    .map(([category, revenue]) => ({ category, revenue: r0(revenue) }))
    .sort((a, b) => b.revenue - a.revenue)

  const bySku = new Map()
  for (const s of skus) {
    const cur = bySku.get(s.name) || { name: s.name, category: s.category, revenue: 0, units: 0 }
    cur.revenue += s.revenue
    cur.units += s.units
    bySku.set(s.name, cur)
  }
  const topSkus = [...bySku.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 12)
    .map((s) => ({ ...s, revenue: r0(s.revenue), units: r1(s.units) }))

  const recent = [...revDays].slice(-14).reverse().map((d) => ({
    date: d.date, dow: d.dow, transactions: d.transactions,
    net: r0(d.net), tips: r1(d.tips),
  }))

  // Year-over-year: trailing 28 days vs the same 28 dates last year — both
  // windows fully covered once history reaches back a year (it now does).
  const today = coverage.to
  let yoy = null
  if (today) {
    const start = addDays(today, -27)
    const lyStart = shiftYear(start)
    const lyEnd = shiftYear(today)
    const inWin = (d, a, b) => d.date >= a && d.date <= b
    const cur = revDays.filter((d) => inWin(d, start, today)).reduce((n, d) => n + d.net, 0)
    const lyDays = revDays.filter((d) => inWin(d, lyStart, lyEnd))
    const ly = lyDays.reduce((n, d) => n + d.net, 0)
    if (lyDays.length >= 20) { // only claim YoY when LY window is truly covered
      yoy = {
        window: `${start} → ${today}`,
        net: r0(cur),
        lastYear: r0(ly),
        pct: ly > 0 ? Math.round((100 * (cur - ly)) / ly) : null,
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    loadedAt,
    coverage,
    backfillComplete: coverage.from ? coverage.from <= '2025-03-07' : false,
    weekReliableFrom: WEEK_RELIABLE_FROM,
    yoy,
    laborAvailable: laborRows > 0,
    // Which window each KPI actually covers. The UI must never blend two of
    // these in one sentence: `net` and `avgDay` span all history, the
    // `cloverOnly` figures start at cloverFrom because the Arryved era has no
    // such columns at all.
    windows: {
      cloverOnly: ['transactions', 'tips', 'cardPct'],
      cloverFrom: coverage.cloverFrom,
      dowFrom,
    },
    kpis: {
      net: r0(totals.net),
      avgDay: revDays.length ? r0(totals.net / revDays.length) : 0,
      transactions: totals.transactions,
      tips: r0(totals.tips),
      cardPct: tender > 0 ? Math.round((100 * totals.card) / tender) : null,
      bestDay: best ? { date: best.date, dow: best.dow, net: r0(best.net) } : null,
    },
    weekly,
    dowProfile,
    categories,
    topSkus,
    recent,
  }
}

// Monthly net revenue for the Finances snapshot: { 'YYYY-MM': net }.
export async function taproomMonthlyNet() {
  const { daily } = await loadTaproom()
  const byMonth = {}
  for (const d of daily) {
    if (d.net <= 0) continue
    const m = d.date.slice(0, 7)
    byMonth[m] = (byMonth[m] || 0) + d.net
  }
  for (const k of Object.keys(byMonth)) byMonth[k] = r0(byMonth[k])
  const dates = daily.map((d) => d.date)
  return { byMonth, coverageFrom: dates.length ? dates[0] : null }
}

// SKU-by-MONTH history table (2025-03 → 2026-04, one-time load, no pipeline).
let monthCache = { at: 0, rows: null }
export async function loadSkuMonths() {
  if (monthCache.rows && Date.now() - monthCache.at < 60 * 60 * 1000) return monthCache.rows
  const raw = await loadAll(SKUMONTH_DS, 'Taproom SKU-by-month')
  const rows = raw
    .map((r) => ({
      name: text(r, 'Clover SKU name'),
      category: sel(r, 'Category') || text(r, 'Category') || 'Other',
      month: (r.properties?.['Month']?.date?.start || '').slice(0, 7) || text(r, 'Month').slice(0, 7),
      gross: num(r, 'Gross revenue') || 0,
      net: num(r, 'Net revenue') || 0,
      units: num(r, 'Units sold') || 0,
    }))
    .filter((s) => /^2\d{3}-\d{2}$/.test(s.month))
  monthCache = { at: Date.now(), rows }
  return rows
}

// Coffee register revenue for the Coffee space — two series, two grains,
// never mixed (contract): monthly history from the month table (2025-03 →
// 2026-04) + recent weeks from the living week table (from 2026-05-04, the
// first full week after the boundary; April is fully covered monthly).
export async function coffeeRegisterSales() {
  const { skus, loadedAt } = await loadTaproom()
  const months = await loadSkuMonths().catch((err) => {
    console.error('[coffee] month table unavailable:', (err && err.message) || String(err))
    return []
  })

  const coffeeMonths = months.filter((s) => s.category === 'Coffee')
  const byMonth = new Map()
  for (const s of coffeeMonths) byMonth.set(s.month, (byMonth.get(s.month) || 0) + s.net)
  const monthly = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, revenue]) => ({ month, revenue: r0(revenue) }))

  const WEEK_ERA_FROM = '2026-05-04'
  const coffeeWeeks = skus.filter((s) => s.category === 'Coffee' && s.week >= WEEK_ERA_FROM)
  const byWeek = new Map()
  for (const s of coffeeWeeks) byWeek.set(s.week, (byWeek.get(s.week) || 0) + s.revenue)
  const weekly = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, revenue]) => ({ week, revenue: r0(revenue) }))

  const bySku = new Map()
  for (const s of [...coffeeMonths.map((m) => ({ name: m.name, revenue: m.net, units: m.units })),
                   ...coffeeWeeks.map((w) => ({ name: w.name, revenue: w.revenue, units: w.units }))]) {
    const cur = bySku.get(s.name) || { name: s.name, revenue: 0, units: 0 }
    cur.revenue += s.revenue
    cur.units += s.units
    bySku.set(s.name, cur)
  }

  return {
    loadedAt,
    total: r0(coffeeMonths.reduce((n, s) => n + s.net, 0) + coffeeWeeks.reduce((n, s) => n + s.revenue, 0)),
    totalNote: 'since Mar 2025 (monthly history + weekly feed; ~3-day seam at the May 2026 boundary)',
    monthly,
    weekly,
    topSkus: [...bySku.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8)
      .map((s) => ({ ...s, revenue: r0(s.revenue), units: r1(s.units) })),
  }
}
