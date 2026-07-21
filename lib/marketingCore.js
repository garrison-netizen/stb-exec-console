// Marketing dashboard data layer: the Mailchimp Campaign Log (synced daily
// by the Mailchimp pipeline) + email-attributed event leads from the same
// Private Events reads the Events space uses. Read-only.

import { loadNormalized } from './eventsCore.js'

const cleanEnv = (v) => (v || '').trim().replace(/^["']|["']$/g, '').trim()
const NOTION_TOKEN = cleanEnv(process.env.NOTION_TOKEN)
const CAMPAIGNS_DS = cleanEnv(process.env.NOTION_MC_CAMPAIGNS_DS)

const CACHE_MS = 15 * 60 * 1000
let cache = { at: 0, model: null }

async function loadCampaigns() {
  if (!CAMPAIGNS_DS) throw new Error('Campaign log data source id missing from env (NOTION_MC_CAMPAIGNS_DS).')
  const rows = []
  let cursor = null
  let guard = 0
  do {
    const body = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const res = await fetch(`https://api.notion.com/v1/data_sources/${CAMPAIGNS_DS}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2025-09-03',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (res.status === 404) {
      throw new Error('Notion 404 on the Campaign Log — share it with the STB Executive Console integration (⋯ → Connections) and retry.')
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Notion query failed on Campaign Log (${res.status}): ${text.slice(0, 200)}`)
    }
    const data = await res.json()
    rows.push(...(data.results || []))
    cursor = data.has_more ? data.next_cursor : null
    guard += 1
  } while (cursor && guard < 50)

  const text = (page, name) => {
    const prop = page.properties?.[name]
    const arr = prop?.title || prop?.rich_text || []
    return arr.map((t) => t.plain_text || '').join('')
  }
  const num = (page, name) => page.properties?.[name]?.number ?? null

  return rows
    .map((r) => ({
      name: text(r, 'Campaign name'),
      subject: text(r, 'Subject line'),
      sent: (r.properties?.['Send date']?.date?.start || '').slice(0, 10),
      recipients: num(r, 'Recipients'),
      openRate: num(r, 'Open rate'),
      clickRate: num(r, 'Click rate'),
    }))
    .filter((c) => c.sent)
    .sort((a, b) => (a.sent < b.sent ? 1 : -1))
}

function todayCT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

// Recipient-weighted average of a rate field, ignoring rows without data.
function weightedRate(rows, field) {
  let num = 0
  let den = 0
  for (const r of rows) {
    if (r[field] == null || !r.recipients) continue
    num += r[field] * r.recipients
    den += r.recipients
  }
  return den ? num / den : null
}

export async function marketingDashboard({ force = false } = {}) {
  if (!force && cache.model && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.model, cached: true }
  }

  const [campaigns, events] = await Promise.all([loadCampaigns(), loadNormalized()])
  const today = todayCT()
  const year = today.slice(0, 4)

  const ytd = campaigns.filter((c) => c.sent.slice(0, 4) === year && c.sent <= today)

  // Monthly rollup, current year.
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0')
    const inMonth = ytd.filter((c) => c.sent.slice(5, 7) === mm)
    return {
      month: mm,
      campaigns: inMonth.length,
      recipients: inMonth.reduce((n, c) => n + (c.recipients || 0), 0),
      openRate: weightedRate(inMonth, 'openRate'),
      clickRate: weightedRate(inMonth, 'clickRate'),
    }
  })

  // Email-attributed event leads (any lead whose source name mentions email).
  const emailLeads = events.leads.filter((l) => /email/i.test(l.source || ''))
  const emailYTD = emailLeads.filter((l) => l.createdAt && l.createdAt.slice(0, 4) === year)
  const attribution = {
    ytdLeads: emailYTD.length,
    ytdBooked: emailYTD.filter((l) => l.status === 'Booked').length,
    allTimeLeads: emailLeads.length,
    allTimeBooked: emailLeads.filter((l) => l.status === 'Booked').length,
  }

  const model = {
    generatedAt: new Date().toISOString(),
    today,
    kpis: {
      ytdCampaigns: ytd.length,
      ytdRecipients: ytd.reduce((n, c) => n + (c.recipients || 0), 0),
      ytdOpenRate: weightedRate(ytd, 'openRate'),
      ytdClickRate: weightedRate(ytd, 'clickRate'),
    },
    recent: campaigns.slice(0, 10),
    monthly,
    attribution,
  }
  cache = { at: Date.now(), model }
  return { ...model, cached: false }
}
