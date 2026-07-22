import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../Auth.jsx'

// Finances snapshot — Exec-only surface, not a department: operational
// revenue across the streams the Console can see today (Ekos wholesale +
// taproom invoices, Tripleseat private events) plus losses. Explicitly NOT
// the books — QBO is the accounting truth; the /close automation replaces
// the caveat when its production keys land. No EOS tabs by design.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US')
const moneySigned = (n) => (n < 0 ? '−' : '+') + money(Math.abs(n || 0))

function Delta({ value }) {
  if (value === null || value === undefined) return <>—</>
  return <span className={'pe-delta ' + (value < 0 ? 'bad' : 'ok')}>{moneySigned(value)}</span>
}

const heat = (value, max) =>
  max > 0
    ? { backgroundImage: `linear-gradient(90deg, var(--navy-50) ${Math.min(100, (100 * value) / max)}%, transparent ${Math.min(100, (100 * value) / max)}%)` }
    : undefined

export default function FinancesSpace() {
  const [model, setModel] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    apiFetch('/api/dashboards?space=finances')
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load the finances snapshot')
        setModel(data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="dept">
      <header className="dept-banner">
        <h1>Finances</h1>
        <span className="dept-banner-sub">Operational revenue snapshot — QBO stays the book of record</span>
      </header>
      <div className="pe-body">
        {error && (
          <div className="pe-error">
            <strong>Couldn’t load the snapshot.</strong> {error}
          </div>
        )}
        {!error && !model && <div className="pe-loading">Loading revenue data…</div>}
        {model && (
          <>
            <div className="pe-asof">
              Ekos data as of {model.ekosAsOf ? new Date(model.ekosAsOf).toLocaleString() : 'unknown'} ·{' '}
              events synced daily ·{' '}
              <button className="pe-refresh" onClick={load} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <Body m={model} />
          </>
        )}
      </div>
    </div>
  )
}

function Body({ m }) {
  const k = m.kpis
  const thisMonth = Number(m.today.slice(5, 7))
  const monthly = m.monthly.filter((row, i) => i < thisMonth || row.total > 0)

  return (
    <>
      <div className="pe-kpis">
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.totalYTD)}</div>
          <div className="pe-kpi-label">{m.year} operational revenue (all streams)</div>
          {k.vsLYPct !== null && (
            <div className={'pe-kpi-delta ' + (k.vsLYPct >= 0 ? 'ok' : 'bad')}>
              {k.vsLYPct >= 0 ? '▲' : '▼'} {Math.abs(k.vsLYPct)}% vs same point {m.year - 1} ({money(k.totalLYtd)})
            </div>
          )}
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.wholesaleYTD)}</div>
          <div className="pe-kpi-label">wholesale (Ekos invoices)</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.eventsYTD)}</div>
          <div className="pe-kpi-label">private events (Tripleseat) · losses {money(k.lossYTD)}</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">—</div>
          <div className="pe-kpi-label">taproom register sales — joins on Clover API approval</div>
        </div>
      </div>

      <section className="pe-section">
        <h2>Revenue by month — {m.year}</h2>
        <table className="pe-table">
          <thead>
            <tr>
              <th>Month</th><th className="num">Wholesale</th>
              <th className="num">Events</th><th className="num">Total</th>
              <th className="num">{m.year - 1}</th><th className="num">Δ vs {m.year - 1}</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((r, i) => {
              const future = i + 1 > thisMonth
              const maxT = Math.max(...monthly.map((x) => Math.max(x.total, x.lastYear)))
              return (
                <tr key={i}>
                  <td>{MONTH_NAMES[Number(r.month) - 1]}{future ? ' (booked ahead)' : ''}</td>
                  <td className="num">{future ? '—' : money(r.wholesale)}</td>
                  <td className="num">{money(r.events)}</td>
                  <td className="num pe-heat" style={future ? undefined : heat(r.total, maxT)}>{money(r.total)}</td>
                  <td className="num">{future || !r.lastYear ? '—' : money(r.lastYear)}</td>
                  <td className="num">{future || !(r.lastYear || r.total) ? '—' : <Delta value={r.total - r.lastYear} />}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <p className="pe-note pe-footer">
        Signal layer, not the books: Ekos invoice subtotals (wholesale) + Tripleseat event revenue
        (actual else quoted, cancelled excluded). Taproom register sales live in Clover and join on
        API approval; also excluded: anything invoiced outside Ekos, refunds/adjustments in QBO, and
        non-beverage income. Freshness follows the Ekos VPN sync; events sync daily at 6am.
      </p>
    </>
  )
}
