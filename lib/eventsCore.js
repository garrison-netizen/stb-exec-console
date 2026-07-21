// Events space data layer: reads the three Private Events data sources the
// Triple Seat pipeline maintains (Leads / Bookings / Lead Sources) and computes
// the dashboard model. Read-only. Metrics ported from the proven pipeline
// logic (stb-consumers/pipelines/pe-dashboard, unit-tested 2026-07-21).
//
// Revenue convention matches the Q2 2026 close method: actual revenue when
// recorded, else quoted; cancelled bookings excluded; bar sales separate.
//
// The three DS ids come from env (same ids the Triple Seat pipeline writes to).
// A Notion 404 here means the databases aren't shared with the Console
// integration yet — surfaced as a distinct error so the UI can say so.

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const LEADS_DS = process.env.NOTION_TS_LEADS_DS;
const BOOKINGS_DS = process.env.NOTION_TS_BOOKINGS_DS;
const SOURCES_DS = process.env.NOTION_TS_SOURCES_DS;

const FUNNEL_LOOKBACK_DAYS = 90;
const UPCOMING_DAYS = 45;
const STALE_LEAD_DAYS = 14;
const COLLECTIONS_LOOKBACK_DAYS = 90;
const TOP_SOURCES = 5;

// Exact Notion property names (verified against live Brain schema 2026-06-05,
// same constants as the Triple Seat pipeline's Config.gs).
const L = {
  TITLE: 'Lead title', EVENT_TYPE: 'Event type', REQ_DATE: 'Requested event date',
  STATUS: 'Status', CREATED_AT: 'Created at', SOURCE: 'Source',
};
const B = {
  TITLE: 'Booking title', EVENT_DATE: 'Event date', STATUS: 'Status',
  QUOTED_REV: 'Quoted revenue', ACTUAL_REV: 'Actual revenue', BAR_ACTUAL: 'Bar sales actual',
  DEPOSIT_AMT: 'Deposit amount', DEPOSIT_PAID: 'Deposit paid', BALANCE_PAID: 'Balance paid',
  FINAL_HC: 'Final headcount', REP: 'Assigned rep',
};

// ── Notion reads ────────────────────────────────────────────────

// Full paginated read (notionCore.queryDataSource caps at one page).
async function loadAll(dsId, label) {
  if (!dsId) throw new Error(`Events data source id missing from env (${label}).`);
  const rows = [];
  let cursor = null;
  let guard = 0;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/data_sources/${dsId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 404) {
      throw new Error(
        `Notion 404 on ${label} — share the Private Events databases with the ` +
        `STB Executive Console integration (⋯ → Connections) and retry.`
      );
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Notion query failed on ${label} (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    rows.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
    guard += 1;
  } while (cursor && guard < 200);
  return rows;
}

const text = (page, name) => {
  const prop = page.properties?.[name];
  const arr = prop?.title || prop?.rich_text || [];
  return arr.map((t) => t.plain_text || '').join('');
};
const num = (page, name) => page.properties?.[name]?.number ?? null;
const dateISO = (page, name) => (page.properties?.[name]?.date?.start || '').slice(0, 10);
const sel = (page, name) => page.properties?.[name]?.select?.name || '';
const check = (page, name) => Boolean(page.properties?.[name]?.checkbox);
const relIds = (page, name) => (page.properties?.[name]?.relation || []).map((r) => r.id);

async function loadNormalized() {
  const [sourceRows, leadRows, bookingRows] = await Promise.all([
    loadAll(SOURCES_DS, 'Lead Sources'),
    loadAll(LEADS_DS, 'Triple Seat Leads'),
    loadAll(BOOKINGS_DS, 'Bookings'),
  ]);
  const sourceNames = Object.fromEntries(sourceRows.map((r) => [r.id, text(r, 'Source name')]));
  const leads = leadRows.map((r) => ({
    title: text(r, L.TITLE),
    eventType: sel(r, L.EVENT_TYPE),
    reqDate: dateISO(r, L.REQ_DATE),
    status: sel(r, L.STATUS),
    createdAt: dateISO(r, L.CREATED_AT),
    source: relIds(r, L.SOURCE).map((id) => sourceNames[id]).find(Boolean) || 'Unknown',
  }));
  const bookings = bookingRows.map((r) => ({
    title: text(r, B.TITLE),
    eventDate: dateISO(r, B.EVENT_DATE),
    status: sel(r, B.STATUS),
    quotedRev: num(r, B.QUOTED_REV),
    actualRev: num(r, B.ACTUAL_REV),
    barActual: num(r, B.BAR_ACTUAL),
    depositAmt: num(r, B.DEPOSIT_AMT),
    depositPaid: check(r, B.DEPOSIT_PAID),
    balancePaid: check(r, B.BALANCE_PAID),
    finalHc: num(r, B.FINAL_HC),
    rep: sel(r, B.REP),
  }));
  return { leads, bookings };
}

// ── Metrics (pure) ──────────────────────────────────────────────

const rev = (b) => (b.actualRev != null ? b.actualRev : b.quotedRev || 0);

function todayCT() {
  // en-CA gives yyyy-mm-dd directly.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
}
function addDaysISO(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`); // noon UTC dodges DST edges
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computeMetrics(leads, bookings, today = todayCT()) {
  const year = Number(today.slice(0, 4));
  const live = bookings.filter((b) => b.status !== 'Cancelled' && b.eventDate);

  // KPIs
  const lyCutoff = String(year - 1) + today.slice(4);
  let ytdRevenue = 0, ytdEvents = 0, ytdLastYear = 0;
  for (const b of live) {
    const y = b.eventDate.slice(0, 4);
    if (y === String(year) && b.eventDate <= today) { ytdRevenue += rev(b); ytdEvents += 1; }
    if (y === String(year - 1) && b.eventDate <= lyCutoff) ytdLastYear += rev(b);
  }
  const h30 = addDaysISO(today, 30);
  const next30 = live.filter((b) => b.eventDate > today && b.eventDate <= h30);
  const openLeads = leads.filter((l) => l.status === 'Pending').length;

  // Monthly (current year vs last year)
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    const row = { month: mm, events: 0, revenue: 0, bar: 0, lastYear: 0 };
    for (const b of live) {
      if (b.eventDate.slice(5, 7) !== mm) continue;
      const y = b.eventDate.slice(0, 4);
      if (y === String(year)) { row.events += 1; row.revenue += rev(b); row.bar += b.barActual || 0; }
      else if (y === String(year - 1)) row.lastYear += rev(b);
    }
    return row;
  });

  // Upcoming board
  const hUp = addDaysISO(today, UPCOMING_DAYS);
  const upcoming = live
    .filter((b) => b.eventDate > today && b.eventDate <= hUp)
    .sort((a, b) => (a.eventDate < b.eventDate ? -1 : 1))
    .map((b) => ({
      date: b.eventDate, title: b.title, headcount: b.finalHc,
      revenue: rev(b), depositPaid: b.depositPaid, balancePaid: b.balancePaid, rep: b.rep,
    }));

  // Needs attention
  const floor = addDaysISO(today, -COLLECTIONS_LOOKBACK_DAYS);
  const unpaidBalances = live
    .filter((b) => b.eventDate <= today && b.eventDate >= floor && !b.balancePaid && rev(b) > 0)
    .sort((a, b) => (a.eventDate < b.eventDate ? -1 : 1));
  const unpaidDeposits = live
    .filter((b) => b.eventDate > today && !b.depositPaid)
    .sort((a, b) => (a.eventDate < b.eventDate ? -1 : 1));
  const staleCutoff = addDaysISO(today, -STALE_LEAD_DAYS);
  const staleLeads = leads
    .filter((l) => l.status === 'Pending' && l.createdAt && l.createdAt <= staleCutoff)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  // Funnel (trailing window)
  const fFloor = addDaysISO(today, -FUNNEL_LOOKBACK_DAYS);
  const win = leads.filter((l) => l.createdAt && l.createdAt >= fFloor);
  const byStatus = { Pending: 0, Booked: 0, Passed: 0, Lost: 0 };
  const bySource = {};
  for (const l of win) {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    const s = l.source || 'Unknown';
    bySource[s] = bySource[s] || { leads: 0, booked: 0 };
    bySource[s].leads += 1;
    if (l.status === 'Booked') bySource[s].booked += 1;
  }
  const topSources = Object.entries(bySource)
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.leads - a.leads)
    .slice(0, TOP_SOURCES);

  return {
    generatedAt: new Date().toISOString(),
    today,
    kpis: {
      ytdRevenue, ytdEvents, ytdLastYear,
      next30Count: next30.length,
      next30Revenue: next30.reduce((n, b) => n + rev(b), 0),
      openLeads,
    },
    monthly,
    upcoming,
    attention: {
      unpaidBalances: unpaidBalances.map((b) => ({
        date: b.eventDate, title: b.title, revenue: rev(b), depositPaid: b.depositPaid, rep: b.rep,
      })),
      unpaidBalanceTotal: unpaidBalances.reduce((n, b) => n + rev(b), 0),
      unpaidDeposits: unpaidDeposits.map((b) => ({
        date: b.eventDate, title: b.title, revenue: rev(b), depositAmt: b.depositAmt, rep: b.rep,
      })),
      staleLeads: staleLeads.slice(0, 15).map((l) => ({
        createdAt: l.createdAt, title: l.title, eventType: l.eventType, reqDate: l.reqDate, source: l.source,
      })),
      staleLeadCount: staleLeads.length,
      staleLeadDays: STALE_LEAD_DAYS,
    },
    funnel: {
      windowDays: FUNNEL_LOOKBACK_DAYS,
      total: win.length,
      byStatus,
      conversionPct: win.length ? Math.round((100 * (byStatus.Booked || 0)) / win.length) : 0,
      topSources,
    },
    upcomingDays: UPCOMING_DAYS,
  };
}

// ── Entry point with a short cache ──────────────────────────────
// ~1,900 rows over ~20 paginated calls is slow; serve a 10-minute-old copy
// rather than re-reading Notion on every dashboard visit. Per-instance cache
// (fine on Vercel — a cold instance just refetches).

const CACHE_MS = 10 * 60 * 1000;
let cache = { at: 0, model: null };

export async function eventsDashboard({ force = false } = {}) {
  if (!force && cache.model && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.model, cached: true };
  }
  const { leads, bookings } = await loadNormalized();
  const model = computeMetrics(leads, bookings);
  cache = { at: Date.now(), model };
  return { ...model, cached: false };
}
