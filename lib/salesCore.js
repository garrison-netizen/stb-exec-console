// Sales space data layer: the VIP marts the vip-marts pipeline maintains in
// the Brain. Read-only.
//   Mart A — Depletion Trend (ADR-013): Brand × Distributor × Segment × Year, CE etc.
//   Mart B — Account Trajectory (ADR-013): one row per account; CE history columns are
//   year-embedded ("CE 2026 YTD", "CE 2025 same-period", "CE 2021"…), so
//   columns are DETECTED from the live rows rather than hardcoded — the
//   January rollover renames them and this must keep working.
//   Mart C — Weekly Depletion (ADR-015): Brand × Distributor × Segment × Week,
//   one row per week (accumulating). Optional: absent env id = weekly features
//   simply don't render (keeps preview/dev envs without the id working).

const cleanEnv = (v) => (v || '').trim().replace(/^["']|["']$/g, '').trim()
const NOTION_TOKEN = cleanEnv(process.env.NOTION_TOKEN)
const MART_A_DS = cleanEnv(process.env.NOTION_VIP_MART_A_DS)
const MART_B_DS = cleanEnv(process.env.NOTION_VIP_MART_B_DS)
const MART_C_DS = cleanEnv(process.env.NOTION_VIP_MART_C_DS)

const CACHE_MS = 15 * 60 * 1000
let cache = { at: 0, data: null }

async function loadAll(dsId, label) {
  if (!dsId) throw new Error(`VIP mart data source id missing from env (${label}).`)
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
        `Notion 404 on ${label} — share the VIP mart databases with the STB Executive ` +
        `Console integration (⋯ → Connections) and retry.`
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
const check = (page, name) => Boolean(page.properties?.[name]?.checkbox)
const date = (page, name) => page.properties?.[name]?.date?.start || null

// ── Normalized loads ────────────────────────────────────────────

function normalizeMartA(rows) {
  return rows.map((r) => ({
    cell: text(r, 'Cell'),
    brand: sel(r, 'Brand') || text(r, 'Brand'),
    distributor: sel(r, 'Distributor (parent)') || text(r, 'Distributor (parent)'),
    branch: sel(r, 'Branch') || text(r, 'Branch') || null,
    segment: sel(r, 'Segment') || text(r, 'Segment'),
    year: num(r, 'Year'),
    ce: num(r, 'CE') || 0,
    units: num(r, 'Units'),
    effective: num(r, 'Effective'),
    didBuys: num(r, 'Did Buys'),
    placements: num(r, 'Placements'),
    cePrior: num(r, 'CE prior year'),
    yoyDelta: num(r, 'CE YoY delta'),
    yoyPct: num(r, 'CE YoY pct'),
    footprint: check(r, 'Footprint artifact'),
  }))
}

function normalizeMartC(rows) {
  return rows.map((r) => ({
    cell: text(r, 'Cell'),
    brand: sel(r, 'Brand') || text(r, 'Brand'),
    distributor: sel(r, 'Distributor (parent)') || text(r, 'Distributor (parent)'),
    branch: text(r, 'Branch') || null,
    segment: sel(r, 'Segment') || text(r, 'Segment'),
    week: date(r, 'Week'), // ISO "yyyy-mm-dd" week-ending date; sortable
    weekLabel: text(r, 'Week label'),
    ce: num(r, 'CE') || 0,
    units: num(r, 'Units'),
    didBuys: num(r, 'Did Buys'),
    effective: num(r, 'Effective'),
    placements: num(r, 'Placements'),
    footprint: check(r, 'Footprint artifact'),
  })).filter((r) => r.week) // guard against a row with no Week date
}

// Detect the year-embedded Mart B columns from a sample row's property names.
export function detectMartBColumns(propNames) {
  const ytd = propNames.find((n) => /^CE \d{4} YTD$/.test(n))
  const samePeriod = propNames.find((n) => /^CE \d{4} same-period$/.test(n))
  const history = propNames
    .filter((n) => /^CE \d{4}$/.test(n))
    .sort()
  if (!ytd || !samePeriod) {
    throw new Error('Mart B year columns not found — schema drift? Saw: ' + propNames.join(', '))
  }
  return {
    ytd,
    samePeriod,
    history,
    currentYear: Number(ytd.match(/\d{4}/)[0]),
    sameYear: Number(samePeriod.match(/\d{4}/)[0]),
  }
}

function normalizeMartB(rows) {
  if (!rows.length) return { accounts: [], cols: null }
  const cols = detectMartBColumns(Object.keys(rows[0].properties || {}))
  const accounts = rows.map((r) => ({
    name: text(r, 'Account name'),
    uid: text(r, 'account_uid'),
    address: text(r, 'Address'),
    city: text(r, 'City'),
    chain: text(r, 'Chain') || null,
    chainAccount: check(r, 'Chain account'),
    classOfTrade: sel(r, 'Class of Trade') || text(r, 'Class of Trade'),
    distributor: sel(r, 'Distributor (parent, last-active)') || text(r, 'Distributor (parent, last-active)'),
    trajectory: sel(r, 'Trajectory Status') || text(r, 'Trajectory Status'),
    ceYtd: num(r, cols.ytd) || 0,
    ceSamePeriod: num(r, cols.samePeriod) || 0,
    history: Object.fromEntries(cols.history.map((h) => [h.slice(3), num(r, h) || 0])),
    firstActive: num(r, 'First active year'),
    lastActive: num(r, 'Last active year'),
    peakYear: num(r, 'Peak year'),
    peakCe: num(r, 'Peak CE'),
    yoyDelta: num(r, 'Current YoY delta'),
    airport: check(r, 'Airport cluster'),
  }))
  return { accounts, cols }
}

export async function loadMarts({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data
  const [aRows, bRows, cRows] = await Promise.all([
    loadAll(MART_A_DS, 'VIP Mart A - Depletion Trend'),
    loadAll(MART_B_DS, 'VIP Mart B - Account Trajectory'),
    // Mart C is optional — no env id yet ⇒ empty, weekly features hide.
    MART_C_DS ? loadAll(MART_C_DS, 'VIP Mart C - Weekly Depletion') : Promise.resolve([]),
  ])
  const martA = normalizeMartA(aRows)
  const { accounts, cols } = normalizeMartB(bRows)
  const martC = normalizeMartC(cRows)
  cache = { at: Date.now(), data: { martA, accounts, cols, martC, loadedAt: new Date().toISOString() } }
  return cache.data
}

// ── Dashboard model ─────────────────────────────────────────────

const r1 = (n) => Math.round((n || 0) * 10) / 10

function sumBy(rows, keyFn, valFn) {
  const map = new Map()
  for (const row of rows) {
    const k = keyFn(row)
    map.set(k, (map.get(k) || 0) + (valFn(row) || 0))
  }
  return map
}

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)

// Weekly model from Mart C. The newest week in every VIP pull is PARTIAL at
// pull time (the export catches it mid-week) and is restated to full by the
// next week's overlapping pull — so the single most-recent week is always
// provisional. We EXCLUDE it from the trend series and surface it separately,
// clearly labeled, so the chart never reads as a cliff. (Garrison's call,
// 2026-07-23.)
function weeklyModel(martC) {
  if (!martC || !martC.length) return null

  const weeks = [...new Set(martC.map((r) => r.week))].sort() // ISO strings sort chronologically
  if (!weeks.length) return null
  const provisionalWeek = weeks[weeks.length - 1]
  const completeWeeks = weeks.slice(0, -1)

  const labelByWeek = new Map(martC.map((r) => [r.week, r.weekLabel]))
  const ceByWeek = sumBy(martC, (r) => r.week, (r) => r.ce)
  const entry = (w) => ({ week: w, label: labelByWeek.get(w) || w, ce: r1(ceByWeek.get(w)) })

  const series = completeWeeks.map(entry)
  const provisional = entry(provisionalWeek)

  // Brand momentum over COMPLETE weeks only: latest complete week vs the mean
  // of up to 4 complete weeks before it. Answers "which brands are moving
  // week over week" without letting the partial week distort it.
  let momentum = null
  if (completeWeeks.length >= 2) {
    const latest = completeWeeks[completeWeeks.length - 1]
    const base = completeWeeks.slice(-5, -1) // up to 4 prior complete weeks
    const ceByWeekBrand = sumBy(martC, (r) => r.week + '|' + r.brand, (r) => r.ce)
    const get = (w, b) => ceByWeekBrand.get(w + '|' + b) || 0
    const brands = [...new Set(martC.map((r) => r.brand))]
    const rows = brands
      .map((brand) => {
        const latestCE = get(latest, brand)
        const baseMean = mean(base.map((w) => get(w, brand)))
        return { brand, latestCE: r1(latestCE), baseMean: r1(baseMean), delta: r1(latestCE - baseMean) }
      })
      .filter((x) => x.latestCE > 0 || x.baseMean > 0)
    const gainers = rows.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 8)
    const decliners = rows.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 8)
    momentum = {
      latestWeekLabel: labelByWeek.get(latest) || latest,
      baseWeeks: base.length,
      gainers,
      decliners,
    }
  }

  return {
    completeCount: completeWeeks.length,
    windowLabel: series.length ? `${series[0].label.split(' thru ')[0]} thru ${series[series.length - 1].label.split(' thru ')[1] || series[series.length - 1].label}` : null,
    series,        // complete weeks only — safe to chart
    provisional,   // newest, partial week — display separately + labeled
    momentum,
  }
}

export async function salesDashboard({ force = false } = {}) {
  const { martA, accounts, cols, martC, loadedAt } = await loadMarts({ force })
  const year = cols ? cols.currentYear : new Date().getFullYear()

  const cur = martA.filter((r) => r.year === year)
  const ytdCE = cur.reduce((n, r) => n + r.ce, 0)
  const samePeriodCE = accounts.reduce((n, a) => n + a.ceSamePeriod, 0)
  const vsSamePct = samePeriodCE > 0 ? Math.round((100 * (ytdCE - samePeriodCE)) / samePeriodCE) : null

  // Yearly trend (Mart A, all years).
  const byYear = [...sumBy(martA, (r) => r.year, (r) => r.ce).entries()]
    .filter(([y]) => y != null)
    .sort(([a], [b]) => a - b)
    .map(([y, ce]) => ({ year: y, ce: r1(ce) }))

  // Brands, current year, with prior-year comparison from Mart A's own rows.
  const brandCur = sumBy(cur, (r) => r.brand, (r) => r.ce)
  const brandPrior = sumBy(cur, (r) => r.brand, (r) => r.cePrior)
  const brands = [...brandCur.entries()]
    .map(([brand, ce]) => ({ brand, ce: r1(ce), prior: r1(brandPrior.get(brand)) }))
    .sort((a, b) => b.ce - a.ce)

  // Distributors, current year.
  const distCur = sumBy(cur, (r) => r.distributor, (r) => r.ce)
  const distributors = [...distCur.entries()]
    .map(([distributor, ce]) => ({ distributor, ce: r1(ce) }))
    .sort((a, b) => b.ce - a.ce)

  // Segment split, current year.
  const segments = [...sumBy(cur, (r) => r.segment, (r) => r.ce).entries()]
    .map(([segment, ce]) => ({ segment, ce: r1(ce) }))
    .sort((a, b) => b.ce - a.ce)

  // Trajectory buckets ("New 2026" → "New" for display, year kept).
  const buckets = {}
  for (const a of accounts) {
    const label = (a.trajectory || 'Unclassified').replace(/ \d{4}$/, '')
    buckets[label] = (buckets[label] || 0) + 1
  }
  const activeAccounts = accounts.filter((a) => a.ceYtd > 0).length

  // Account movers, current YTD vs same period.
  const movers = accounts
    .filter((a) => a.yoyDelta != null)
    .sort((a, b) => a.yoyDelta - b.yoyDelta)
  const decliners = movers.slice(0, 10).filter((a) => a.yoyDelta < 0)
    .map((a) => ({ name: a.name, city: a.city, distributor: a.distributor, ceYtd: r1(a.ceYtd), delta: r1(a.yoyDelta), trajectory: a.trajectory }))
  const gainers = movers.slice(-10).reverse().filter((a) => a.yoyDelta > 0)
    .map((a) => ({ name: a.name, city: a.city, distributor: a.distributor, ceYtd: r1(a.ceYtd), delta: r1(a.yoyDelta), trajectory: a.trajectory }))

  // Top accounts by current YTD.
  const topAccounts = [...accounts]
    .sort((a, b) => b.ceYtd - a.ceYtd)
    .slice(0, 10)
    .map((a) => ({ name: a.name, city: a.city, chain: a.chain, distributor: a.distributor, ceYtd: r1(a.ceYtd), samePeriod: r1(a.ceSamePeriod), trajectory: a.trajectory }))

  return {
    generatedAt: new Date().toISOString(),
    loadedAt,
    year,
    sameYear: cols ? cols.sameYear : year - 1,
    kpis: {
      ytdCE: r1(ytdCE),
      samePeriodCE: r1(samePeriodCE),
      vsSamePct,
      activeAccounts,
      totalAccounts: accounts.length,
      newAccounts: buckets['New'] || 0,
      lapsedAccounts: buckets['Lapsed'] || 0,
    },
    buckets,
    byYear,
    brands,
    distributors,
    segments,
    topAccounts,
    gainers,
    decliners,
    weekly: weeklyModel(martC),
  }
}
