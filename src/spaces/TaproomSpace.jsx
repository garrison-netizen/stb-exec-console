import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../Auth.jsx'
import DeptSpace, { EOS_TABS, EosPlaceholder } from './DeptSpace.jsx'
import DeptChat from './DeptChat.jsx'

const STARTER_POOL = [
  // Revenue & rhythm
  'How is taproom revenue trending vs last year?',
  'What are our busiest days of the week?',
  'What was our best single day ever, and what drove it?',
  'How did this month compare to the same month last year?',
  'What were our best and worst weeks this year?',
  'How is average transaction size trending?',
  // Products
  'Which beers sell best at the register?',
  'How are THC drinks doing at the taproom?',
  'What share of register sales is beer vs everything else?',
  'Which merch items actually sell?',
  'How seasonal is coffee at the register?',
  'What sold most last week?',
  // Money details
  'How do tips track with revenue?',
  'How much sales tax have we collected this year?',
  'How much of our revenue comes through card vs cash?',
]

function TaproomChat() {
  return (
    <DeptChat
      endpoint="/api/assistant?space=taproom"
      title="Taproom Assistant"
      sub="Register revenue, traffic, and what sells — straight from Clover."
      starterPool={STARTER_POOL}
      storagePrefix="stb_tapchat"
      inputPlaceholder="Ask a taproom question…"
      freshTitle="When the register data was last loaded"
    />
  )
}

// The Taproom department: Clover register data (daily totals + SKU weeks)
// from the Brain. Graduated from PlannedSpaces 2026-07-22 when the Clover
// pipeline went production-live. The backfill is still chaining backward
// toward 2025-05-01, so every surface states its coverage window; labor
// stays hidden until that feed flows. Dashboard is Exec-only while being
// dialed in; department users see a status card meanwhile.

const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US')
const count = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }))

const heat = (value, max) =>
  max > 0
    ? { backgroundImage: `linear-gradient(90deg, var(--navy-50) ${Math.min(100, (100 * value) / max)}%, transparent ${Math.min(100, (100 * value) / max)}%)` }
    : undefined

export default function TaproomSpace() {
  // Dashboard opened to the department 2026-07-22.
  const tabs = [
    { key: 'dashboard', label: 'Dashboard', render: () => <TaproomDashboard /> },
    { key: 'assistant', label: 'Assistant', render: () => <TaproomChat /> },
    ...EOS_TABS,
  ]
  return <DeptSpace title="Taproom" tabs={tabs} />
}

function TaproomDashboard() {
  const [model, setModel] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback((refresh) => {
    setLoading(true)
    setError(null)
    apiFetch('/api/dashboards?space=taproom' + (refresh ? '&refresh=1' : ''))
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load the taproom dashboard')
        setModel(data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(false) }, [load])

  return (
    <div className="pe-body">
      {error && (
        <div className="pe-error">
          <strong>Couldn’t load the dashboard.</strong> {error}
        </div>
      )}
      {!error && !model && <div className="pe-loading">Loading register data…</div>}
      {model && (
        <>
          <div className="pe-asof">
            Clover data {model.coverage.from} → {model.coverage.to}
            {model.backfillComplete ? '' : ' (history still loading backward)'} ·{' '}
            <button className="pe-refresh" onClick={() => load(true)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <Body m={model} />
        </>
      )}
    </div>
  )
}

function Body({ m }) {
  const k = m.kpis
  const maxW = Math.max(...m.weekly.map((w) => w.net), 0)
  const maxD = Math.max(...m.dowProfile.map((d) => d.avgNet), 0)
  const maxC = Math.max(...m.categories.map((c) => c.revenue), 0)

  return (
    <>
      <div className="pe-kpis">
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.net)}</div>
          <div className="pe-kpi-label">net register revenue · {m.coverage.tradingDays} trading days in window</div>
          {m.yoy && m.yoy.pct !== null && (
            <div className={'pe-kpi-delta ' + (m.yoy.pct >= 0 ? 'ok' : 'bad')}>
              {m.yoy.pct >= 0 ? '▲' : '▼'} {Math.abs(m.yoy.pct)}% last 28 days vs same period last year ({money(m.yoy.lastYear)})
            </div>
          )}
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.avgDay)}</div>
          <div className="pe-kpi-label">average per trading day · {count(k.transactions)} transactions</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{k.bestDay ? money(k.bestDay.net) : '—'}</div>
          <div className="pe-kpi-label">best day{k.bestDay ? ` · ${k.bestDay.dow} ${k.bestDay.date}` : ''}</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.tips)}</div>
          <div className="pe-kpi-label">tips · {k.cardPct != null ? `${k.cardPct}% card` : 'tender split n/a'}</div>
        </div>
      </div>

      <section className="pe-section">
        <h2>Net revenue by week — last {m.weekly.length} weeks</h2>
        <table className="pe-table pe-table-narrow">
          <thead><tr><th>Week of</th><th className="num">Net</th></tr></thead>
          <tbody>
            {m.weekly.map((w, i) => (
              <tr key={i}>
                <td>{w.week}</td>
                <td className="num pe-heat" style={heat(w.net, maxW)}>{money(w.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pe-section">
        <h2>What sells — categories &amp; top SKUs (since {m.weekReliableFrom})</h2>
        <table className="pe-table pe-table-narrow">
          <thead><tr><th>Category</th><th className="num">Register revenue</th></tr></thead>
          <tbody>
            {m.categories.map((c, i) => (
              <tr key={i}>
                <td>{c.category}</td>
                <td className="num pe-heat" style={heat(c.revenue, maxC)}>{money(c.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Top SKUs</h3>
        <table className="pe-table">
          <thead><tr><th>SKU</th><th>Category</th><th className="num">Units</th><th className="num">Revenue</th></tr></thead>
          <tbody>
            {m.topSkus.map((s, i) => (
              <tr key={i}>
                <td className="ev" title={s.name}>{s.name}</td>
                <td>{s.category}</td>
                <td className="num">{count(s.units)}</td>
                <td className="num">{money(s.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pe-section">
        <h2>Rhythm — average net by day of week</h2>
        <table className="pe-table pe-table-narrow">
          <thead><tr><th>Day</th><th className="num">Avg net</th><th className="num">Days</th></tr></thead>
          <tbody>
            {m.dowProfile.map((d, i) => (
              <tr key={i}>
                <td>{d.dow}</td>
                <td className="num pe-heat" style={heat(d.avgNet, maxD)}>{d.avgNet ? money(d.avgNet) : '—'}</td>
                <td className="num">{d.days || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pe-section">
        <h2>Last 14 trading days</h2>
        <table className="pe-table">
          <thead><tr><th>Date</th><th>Day</th><th className="num">Transactions</th><th className="num">Net</th><th className="num">Tips</th></tr></thead>
          <tbody>
            {m.recent.map((d, i) => (
              <tr key={i}>
                <td>{d.date}</td><td>{d.dow}</td>
                <td className="num">{count(d.transactions)}</td>
                <td className="num">{money(d.net)}</td>
                <td className="num">{money(d.tips)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="pe-note pe-footer">
        Data: Clover register via the Brain (Taproom Daily since Mar 2025, audited to Clover's own
        reports; SKU weeks reliable since {m.weekReliableFrom}). Net = gross − tax; pre-May-2026
        history was rebuilt from payment records (discounts unavailable, refund days read slightly
        high). Labor isn't tracked here — staff don't clock in via Clover.
      </p>
    </>
  )
}
