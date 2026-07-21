import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../Auth.jsx'

// Production Dashboard tab: at-a-glance numbers from the Ekos mirror — the
// same database the Production Assistant queries. Reuses the pe-* dashboard
// styles so every department dashboard reads as one system.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US')
const moneySigned = (n) => (n < 0 ? '−' : '+') + money(Math.abs(n || 0))

// invert: for measures where lower is better (losses), a negative delta is good.
function Delta({ value, invert }) {
  if (value === null || value === undefined) return <>—</>
  const good = invert ? value <= 0 : value >= 0
  return <span className={'pe-delta ' + (good ? 'ok' : 'bad')}>{moneySigned(value)}</span>
}

export default function ProductionDashboard() {
  const [model, setModel] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    apiFetch('/api/production')
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load the production dashboard')
        setModel(data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="pe-body">
      {error && (
        <div className="pe-error">
          <strong>Couldn’t load the dashboard.</strong> {error}
        </div>
      )}
      {!error && !model && <div className="pe-loading">Loading production data…</div>}
      {model && (
        <>
          <div className="pe-asof">
            Ekos data as of {model.dataAsOf ? new Date(model.dataAsOf).toLocaleString() : 'unknown'} ·{' '}
            <button className="pe-refresh" onClick={load} disabled={loading}>
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
  const year = Number(m.today.slice(0, 4))
  const thisMonth = Number(m.today.slice(5, 7))
  const lossVsLY = k.lossLY > 0 ? Math.round((100 * (k.lossYTD - k.lossLY)) / k.lossLY) : null
  const monthly = m.monthly.filter((row, i) => i < thisMonth || row.loss > 0)

  return (
    <>
      <div className="pe-kpis">
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.finishedValue)}</div>
          <div className="pe-kpi-label">finished goods on hand · {money(k.totalValue)} total inventory</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{k.inProgress}</div>
          <div className="pe-kpi-label">batches in progress</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{k.batchesYTD}</div>
          <div className="pe-kpi-label">batches finished in {year} · {k.batchesLY} by this point {year - 1}</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.lossYTD)}</div>
          <div className="pe-kpi-label">{year} losses (breakage/spoilage/shrink/destroyed)</div>
          {lossVsLY !== null && (
            <div className={'pe-kpi-delta ' + (lossVsLY <= 0 ? 'ok' : 'bad')}>
              {lossVsLY <= 0 ? '▼' : '▲'} {Math.abs(lossVsLY)}% vs same point {year - 1}
            </div>
          )}
        </div>
      </div>

      {(m.expiring.length > 0 || m.overduePOs > 0) && (
        <section className="pe-section">
          <h2>Needs attention</h2>
          {m.expiring.length > 0 && (
            <>
              <h3>
                Inventory expiring in the next {m.expiringDays} days —{' '}
                {m.expiringTotal.items} items, {money(m.expiringTotal.value)} at risk
                {m.expiringTotal.items > m.expiring.length ? ` (soonest ${m.expiring.length} shown)` : ''}
              </h3>
              <table className="pe-table">
                <thead><tr><th>Expires</th><th>Item</th><th className="num">Qty</th><th className="num">Value</th></tr></thead>
                <tbody>
                  {m.expiring.map((e, i) => (
                    <tr key={i}>
                      <td>{e.expires}</td><td className="ev" title={e.item}>{e.item}</td>
                      <td className="num">{e.qty}</td><td className="num">{money(e.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {m.overduePOs > 0 && (
            <p className="pe-note" style={{ marginTop: 8 }}>
              {m.overduePOs} open PO{m.overduePOs === 1 ? ' is' : 's are'} past the expected delivery date — see Open POs below.
            </p>
          )}
        </section>
      )}

      <section className="pe-section">
        <h2>In the tanks — {m.inProgress.length} batches</h2>
        {m.inProgress.length === 0 && <p className="pe-note">No batches in progress.</p>}
        {m.inProgress.length > 0 && (
          <table className="pe-table">
            <thead><tr><th>Batch</th><th>Product</th><th>Started</th><th className="num">Days in</th></tr></thead>
            <tbody>
              {m.inProgress.map((b, i) => (
                <tr key={i}>
                  <td>{b.batch}</td><td className="ev" title={b.product}>{b.product}</td>
                  <td>{b.started}</td><td className="num">{b.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="pe-section">
        <h2>Losses by month — {year} vs {year - 1}</h2>
        <table className="pe-table pe-table-narrow">
          <thead><tr><th>Month</th><th className="num">{year}</th><th className="num">{year - 1}</th><th className="num">Δ vs {year - 1}</th></tr></thead>
          <tbody>
            {monthly.map((r, i) => (
              <tr key={i}>
                <td>{MONTH_NAMES[Number(r.month) - 1]}</td>
                <td className="num">{money(r.loss)}</td>
                <td className="num">{r.lastYear ? money(r.lastYear) : '—'}</td>
                <td className="num">{r.lastYear || r.loss ? <Delta value={r.loss - r.lastYear} invert /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pe-section">
        <h2>Open POs — last 12 months{m.overduePOs > 0 ? `, ${m.overduePOs} overdue` : ''}</h2>
        {m.openPOs.length === 0 && <p className="pe-note">No open purchase orders from the last 12 months.</p>}
        {m.openPOs.length > 0 && (
          <table className="pe-table">
            <thead><tr><th>PO</th><th>Vendor</th><th>Expected</th><th className="num">Total</th></tr></thead>
            <tbody>
              {m.openPOs.map((p, i) => (
                <tr key={i}>
                  <td>{p.number}</td><td className="ev" title={p.vendor}>{p.vendor}</td>
                  <td>{p.expected && p.expected < m.today
                    ? <span className="pe-delta bad">{p.expected} (overdue)</span>
                    : (p.expected || '—')}</td>
                  <td className="num">{money(p.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {m.stalePOs > 0 && (
        <p className="pe-note">
          {m.stalePOs} older open PO{m.stalePOs === 1 ? '' : 's'} (raised more than a year ago) look
          abandoned rather than pending — worth a cleanup pass in Ekos; ask the Assistant for the list.
        </p>
      )}

      <p className="pe-note pe-footer">
        Data: Ekos mirror (refreshed via the VPN sync). Losses = breakage, spoilage, shrinkage, destroyed, at COGS.
      </p>
    </>
  )
}
