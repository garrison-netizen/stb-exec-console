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
const LABOR_DS = cleanEnv(process.env.NOTION_CLOVER_LABOR_DS)

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
      transactions: num(r, 'Transaction count') || 0,
      gross: num(r, 'Gross revenue') || 0,
      net: num(r, 'Net revenue') || 0,
      tax: num(r, 'Tax collected') || 0,
      tips: num(r, 'Tips') || 0,
      discounts: num(r, 'Discounts applied') || 0,
      card: num(r, 'Tender - card') || 0,
      cash: num(r, 'Tender - cash') || 0,
    }))
    .filter((d) => d.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const skus = skuRows
    .map((r) => ({
      name: text(r, 'Clover SKU name'),
      category: sel(r, 'Category') || text(r, 'Category') || 'Other',
      week: (r.properties?.['Week start']?.date?.start || '').slice(0, 10),
      revenue: num(r, 'Revenue') || 0,
      units: num(r, 'Units sold') || 0,
    }))
    .filter((s) => s.week)

  const labor = laborRows.length // section stays hidden until this feed flows

  cache = { at: Date.now(), model: { daily, skus, laborRows: labor, loadedAt: new Date().toISOString() } }
  return cache.model
}

export async function taproomDashboard({ force = false } = {}) {
  const { daily, skus, laborRows, loadedAt } = await loadTaproom({ force })

  const revDays = daily.filter((d) => d.net > 0)
  const coverage = {
    from: daily.length ? daily[0].date : null,
    to: daily.length ? daily[daily.length - 1].date : null,
    tradingDays: revDays.length,
  }

  const totals = revDays.reduce(
    (t, d) => ({
      net: t.net + d.net,
      gross: t.gross + d.gross,
      tips: t.tips + d.tips,
      transactions: t.transactions + d.transactions,
      card: t.card + d.card,
      cash: t.cash + d.cash,
    }),
    { net: 0, gross: 0, tips: 0, transactions: 0, card: 0, cash: 0 }
  )
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

  // Day-of-week profile (average net on trading days).
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const dowProfile = DOW.map((dow) => {
    const days = revDays.filter((d) => d.dow === dow)
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

  return {
    generatedAt: new Date().toISOString(),
    loadedAt,
    coverage,
    backfillComplete: coverage.from ? coverage.from <= '2025-05-01' : false,
    laborAvailable: laborRows > 0,
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

// Weekly coffee register revenue + top coffee SKUs for the Coffee space.
export async function coffeeRegisterSales() {
  const { skus, loadedAt } = await loadTaproom()
  const coffee = skus.filter((s) => s.category === 'Coffee')
  const byWeek = new Map()
  for (const s of coffee) byWeek.set(s.week, (byWeek.get(s.week) || 0) + s.revenue)
  const weekly = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, revenue]) => ({ week, revenue: r0(revenue) }))
  const bySku = new Map()
  for (const s of coffee) {
    const cur = bySku.get(s.name) || { name: s.name, revenue: 0, units: 0 }
    cur.revenue += s.revenue
    cur.units += s.units
    bySku.set(s.name, cur)
  }
  return {
    loadedAt,
    total: r0(coffee.reduce((n, s) => n + s.revenue, 0)),
    weekly,
    topSkus: [...bySku.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8)
      .map((s) => ({ ...s, revenue: r0(s.revenue), units: r1(s.units) })),
  }
}
