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

// Trajectory chip: label + tint (never color alone — the word carries it).
function Chip({ t }) {
  if (!t) return <>—</>
  const cls = /Growing/.test(t) ? 'up' : /Declining/.test(t) ? 'down' : /New/.test(t) ? 'new'
    : /Lapsed|Never/.test(t) ? 'idle' : 'flat'
  return <span className={'pe-chip ' + cls}>{t}</span>
}

// Left-anchored magnitude bar behind a numeric cell (Excel-style data bar).
const heat = (value, max) =>
  max > 0
    ? { backgroundImage: `linear-gradient(90deg, var(--navy-50) ${Math.min(100, (100 * value) / max)}%, transparent ${Math.min(100, (100 * value) / max)}%)` }
    : undefined

const STARTER_POOL = [
  // Volume
  'How is this year tracking against last year, fairly compared?',
  'Which brands are moving the most volume this year?',
  'How does on-premise compare to off-premise this year?',
  'How has our total depletion volume trended since 2021?',
  // Distributors
  'Which distributors move the most volume for us?',
  'How is each distributor trending vs last year?',
  // Weekly momentum (Mart C)
  'Which brands are gaining momentum over the last few weeks?',
  'How has weekly volume trended over the last 12 weeks?',
  'Which brands slowed down most in the last complete week?',
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
      endpoint="/api/assistant?space=sales"
      title="Sales Assistant"
      sub="Distributor depletions, brands, and account trajectories — from the VIP marts."
      starterPool={STARTER_POOL}
      storagePrefix="stb_saleschat"
      inputPlaceholder="Ask a distribution question…"
      freshTitle="When the VIP mart data was last loaded from the Brain"
    />
  )
}

export default function SalesSpace() {
  // Dashboard signed off to the Sales tag 2026-07-23 (API enforces via
  // requireSpace 'Sales'); anyone who can see the Sales space sees it.
  const tabs = [
    { key: 'dashboard', label: 'Dashboard', render: () => <SalesDashboard /> },
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
    apiFetch('/api/dashboards?space=sales' + (refresh ? '&refresh=1' : ''))
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
            {buckets.map((b, i) => {
              const maxB = Math.max(...buckets.map((x) => x.n))
              return (
                <tr key={i}>
                  <td><Chip t={b.label} /></td>
                  <td className="num pe-heat" style={heat(b.n, maxB)}>{b.n.toLocaleString('en-US')}</td>
                </tr>
              )
            })}
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
            {m.distributors.map((d, i) => {
              const maxD = Math.max(...m.distributors.map((x) => x.ce))
              return (
                <tr key={i}>
                  <td className="ev" title={d.distributor}>{d.distributor}</td>
                  <td className="num pe-heat" style={heat(d.ce, maxD)}>{ce(d.ce)}</td>
                </tr>
              )
            })}
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
            {m.byYear.map((y, i) => {
              const maxY = Math.max(...m.byYear.map((x) => x.ce))
              return (
                <tr key={i}>
                  <td>{y.year}{y.year === m.year ? ' (YTD)' : ''}</td>
                  <td className="num pe-heat" style={heat(y.ce, maxY)}>{ce(y.ce)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {m.weekly && m.weekly.series.length > 0 && <WeeklySection w={m.weekly} />}

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
                <td><Chip t={a.trajectory} /></td>
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
        Data: VIP marts in the Brain — annual/account marts (ADR-013) refreshed monthly,
        weekly mart (ADR-015) refreshed weekly. CE = case-equivalent units.
        Distribution only — taproom sales are not in this data.
      </p>
    </>
  )
}

// Recent weekly depletions (Mart C). Every week's actual number is shown, but
// the newest two are still SETTLING (the latest is partial; the one before is
// still being restated as distributors report late) — they're flagged and
// kept out of the trend/momentum math so a still-filling week never reads as a
// real decline. (Garrison's call, 2026-07-23.)
function WeeklySection({ w }) {
  // Heat bars scale to the settled weeks so a still-filling week's short bar
  // reads as "not yet in" rather than shrinking every other week's bar.
  const settledMax = Math.max(...w.series.filter((x) => !x.settling).map((x) => x.ce), 0)
  const nSettling = w.settlingWeeks ? w.settlingWeeks.length : 0
  const mom = w.momentum
  return (
    <section className="pe-section">
      <h2>Recent weekly depletions{w.windowLabel ? ` — trend ${w.windowLabel}` : ''}</h2>
      <table className="pe-table pe-table-narrow">
        <thead><tr><th>Week ending</th><th className="num">CE</th></tr></thead>
        <tbody>
          {w.series.map((wk, i) => (
            <tr key={i} className={wk.settling ? 'pe-settling' : undefined}>
              <td title={wk.label}>{wk.week}{wk.settling ? ' *' : ''}</td>
              <td className="num pe-heat" style={wk.settling ? undefined : heat(wk.ce, settledMax)}>{ce(wk.ce)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {nSettling > 0 && (
        <p className="pe-note">
          * The newest {nSettling === 1 ? 'week is' : `${nSettling} weeks are`} still <strong>settling</strong> —
          the latest is a partial week and distributor reporting lags, so these numbers rise as later pulls come in.
          They're shown for visibility but excluded from the trend and momentum below.
        </p>
      )}

      {mom && (mom.gainers.length > 0 || mom.decliners.length > 0) && (
        <>
          <h3>Brand momentum — last settled week vs prior {mom.baseWeeks}-week average</h3>
          <div className="pe-two-col">
            {mom.gainers.length > 0 && (
              <table className="pe-table">
                <thead><tr><th>Gaining brand</th><th className="num">Wk CE</th><th className="num">Δ vs avg</th></tr></thead>
                <tbody>
                  {mom.gainers.map((b, i) => (
                    <tr key={i}>
                      <td className="ev" title={b.brand}>{b.brand}</td>
                      <td className="num">{ce(b.latestCE)}</td>
                      <td className="num"><Delta value={b.delta} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {mom.decliners.length > 0 && (
              <table className="pe-table">
                <thead><tr><th>Slowing brand</th><th className="num">Wk CE</th><th className="num">Δ vs avg</th></tr></thead>
                <tbody>
                  {mom.decliners.map((b, i) => (
                    <tr key={i}>
                      <td className="ev" title={b.brand}>{b.brand}</td>
                      <td className="num">{ce(b.latestCE)}</td>
                      <td className="num"><Delta value={b.delta} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="pe-note">
            Momentum compares the latest <em>settled</em> week to the mean of the {mom.baseWeeks} weeks
            before it (the newest {nSettling} settling {nSettling === 1 ? 'week is' : 'weeks are'} excluded).
            Weekly grain has no year-over-year.
          </p>
        </>
      )}
    </section>
  )
}
