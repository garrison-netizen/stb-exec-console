import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../Auth.jsx'
import DeptSpace, { EOS_TABS } from './DeptSpace.jsx'
import DeptChat from './DeptChat.jsx'

// The Sales department: distribution numbers from the VIP marts in the Brain
// (ADR-013 — refreshed monthly when new VIP exports land) plus a read-only
// assistant over the same marts. Graduated from PlannedSpaces 2026-07-21.

const ce = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }))
const ceSigned = (n) => (n < 0 ? '−' : '+') + ce(Math.abs(n || 0))

function Delta({ value }) {
  if (value === null || value === undefined) return <>—</>
  return <span className={'pe-delta ' + (value < 0 ? 'bad' : 'ok')}>{ceSigned(value)}</span>
}

const STARTER_POOL = [
  // Volume
  'How is this year tracking against last year, fairly compared?',
  'Which brands are moving the most volume this year?',
  'How does on-premise compare to off-premise this year?',
  'How has our total depletion volume trended since 2021?',
  // Distributors
  'Which distributors move the most volume for us?',
  'How is each distributor trending vs last year?',
  // Accounts
  'Which accounts grew the most this year?',
  'Which accounts are declining the fastest?',
  'How many accounts have we gained and lost this year?',
  'What are our top 10 accounts by volume?',
  'Which chains carry us in the most locations?',
  'Which lapsed accounts were biggest at their peak?',
  // Diagnosis
  'Where is the volume decline concentrated — brands, distributors, or accounts?',
  'Which cities have the most active accounts?',
  'How many H-E-B locations carry us, and how are they trending?',
]

function SalesChat() {
  return (
    <DeptChat
      endpoint="/api/sales-chat"
      title="Sales Assistant"
      sub="Distributor depletions, brands, and account trajectories — from the VIP marts."
      starterPool={STARTER_POOL}
      storagePrefix="stb_saleschat"
      inputPlaceholder="Ask a distribution question…"
      freshTitle="When the VIP mart data was last loaded from the Brain"
    />
  )
}

export default function SalesSpace({ isExec }) {
  const tabs = [
    // Dashboard is Exec-only while being dialed in (API enforces this too).
    ...(isExec ? [{ key: 'dashboard', label: 'Dashboard', render: () => <SalesDashboard /> }] : []),
    { key: 'assistant', label: 'Assistant', render: () => <SalesChat /> },
    ...EOS_TABS,
  ]
  return <DeptSpace title="Sales" tabs={tabs} />
}

function SalesDashboard() {
  const [model, setModel] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback((refresh) => {
    setLoading(true)
    setError(null)
    apiFetch('/api/sales' + (refresh ? '?refresh=1' : ''))
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load the sales dashboard')
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
      {!error && !model && <div className="pe-loading">Loading VIP mart data…</div>}
      {model && (
        <>
          <div className="pe-asof">
            Mart data loaded {new Date(model.loadedAt).toLocaleString()} (refreshes monthly with VIP exports) ·{' '}
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
  const bucketOrder = ['New', 'Growing', 'Steady', 'Declining', 'Lapsed', 'Never material', 'Unclassified']
  const buckets = bucketOrder.filter((b) => m.buckets[b]).map((b) => ({ label: b, n: m.buckets[b] }))

  return (
    <>
      <div className="pe-kpis">
        <div className="pe-kpi">
          <div className="pe-kpi-value">{ce(k.ytdCE)} CE</div>
          <div className="pe-kpi-label">{m.year} YTD depletions</div>
          {k.vsSamePct !== null && (
            <div className={'pe-kpi-delta ' + (k.vsSamePct >= 0 ? 'ok' : 'bad')}>
              {k.vsSamePct >= 0 ? '▲' : '▼'} {Math.abs(k.vsSamePct)}% vs {m.sameYear} same period ({ce(k.samePeriodCE)} CE)
            </div>
          )}
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{k.activeAccounts.toLocaleString('en-US')}</div>
          <div className="pe-kpi-label">accounts buying in {m.year} · {k.totalAccounts.toLocaleString('en-US')} all-time</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{k.newAccounts}</div>
          <div className="pe-kpi-label">new accounts in {m.year}</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{k.lapsedAccounts}</div>
          <div className="pe-kpi-label">lapsed accounts (all vintages)</div>
        </div>
      </div>

      <section className="pe-section">
        <h2>Account trajectory — {k.totalAccounts.toLocaleString('en-US')} accounts</h2>
        <table className="pe-table pe-table-narrow">
          <thead><tr><th>Bucket</th><th className="num">Accounts</th></tr></thead>
          <tbody>
            {buckets.map((b, i) => (
              <tr key={i}><td>{b.label}</td><td className="num">{b.n.toLocaleString('en-US')}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="pe-note">Growing &gt; +10%, Steady ±10%, Declining &lt; −10% vs same period (ADR-013).</p>
      </section>

      <section className="pe-section">
        <h2>Brands — {m.year} YTD</h2>
        <table className="pe-table">
          <thead><tr><th>Brand</th><th className="num">{m.year} YTD CE</th><th className="num">{m.year - 1} full-year CE</th></tr></thead>
          <tbody>
            {m.brands.map((b, i) => (
              <tr key={i}>
                <td className="ev" title={b.brand}>{b.brand}</td>
                <td className="num">{ce(b.ce)}</td>
                <td className="num">{ce(b.prior)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pe-note">Prior-year column is the full year, not same-period — a YTD number will trail it naturally.</p>
      </section>

      <section className="pe-section">
        <h2>Distributors &amp; segments — {m.year} YTD</h2>
        <table className="pe-table pe-table-narrow">
          <thead><tr><th>Distributor</th><th className="num">CE</th></tr></thead>
          <tbody>
            {m.distributors.map((d, i) => (
              <tr key={i}><td className="ev" title={d.distributor}>{d.distributor}</td><td className="num">{ce(d.ce)}</td></tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: 8 }}>
          {m.segments.map((s) => `${s.segment}: ${ce(s.ce)} CE`).join(' · ')}
        </p>
      </section>

      <section className="pe-section">
        <h2>Depletions by year</h2>
        <table className="pe-table pe-table-narrow">
          <thead><tr><th>Year</th><th className="num">CE</th></tr></thead>
          <tbody>
            {m.byYear.map((y, i) => (
              <tr key={i}>
                <td>{y.year}{y.year === m.year ? ' (YTD)' : ''}</td>
                <td className="num">{ce(y.ce)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pe-section">
        <h2>Top accounts — {m.year} YTD</h2>
        <table className="pe-table">
          <thead><tr><th>Account</th><th>City</th><th>Distributor</th><th className="num">{m.year} YTD</th><th className="num">{m.sameYear} same-period</th><th>Trajectory</th></tr></thead>
          <tbody>
            {m.topAccounts.map((a, i) => (
              <tr key={i}>
                <td className="ev" title={a.name}>{a.name}</td><td>{a.city}</td>
                <td className="ev" title={a.distributor}>{a.distributor}</td>
                <td className="num">{ce(a.ceYtd)}</td><td className="num">{ce(a.samePeriod)}</td>
                <td>{a.trajectory}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(m.gainers.length > 0 || m.decliners.length > 0) && (
        <section className="pe-section">
          <h2>Biggest movers vs {m.sameYear} same period</h2>
          {m.gainers.length > 0 && (
            <>
              <h3>Gaining</h3>
              <table className="pe-table">
                <thead><tr><th>Account</th><th>City</th><th className="num">{m.year} YTD</th><th className="num">Δ CE</th></tr></thead>
                <tbody>
                  {m.gainers.map((a, i) => (
                    <tr key={i}>
                      <td className="ev" title={a.name}>{a.name}</td><td>{a.city}</td>
                      <td className="num">{ce(a.ceYtd)}</td><td className="num"><Delta value={a.delta} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {m.decliners.length > 0 && (
            <>
              <h3>Declining</h3>
              <table className="pe-table">
                <thead><tr><th>Account</th><th>City</th><th className="num">{m.year} YTD</th><th className="num">Δ CE</th></tr></thead>
                <tbody>
                  {m.decliners.map((a, i) => (
                    <tr key={i}>
                      <td className="ev" title={a.name}>{a.name}</td><td>{a.city}</td>
                      <td className="num">{ce(a.ceYtd)}</td><td className="num"><Delta value={a.delta} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      <p className="pe-note pe-footer">
        Data: VIP marts in the Brain (ADR-013), refreshed monthly from VIP depletion exports.
        CE = case-equivalent units. Distribution only — taproom sales are not in this data.
      </p>
    </>
  )
}
