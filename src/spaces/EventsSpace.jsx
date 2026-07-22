import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../Auth.jsx'
import DeptSpace, { EOS_TABS } from './DeptSpace.jsx'
import EventsChat from './EventsChat.jsx'

// The Events department: standard department frame (DeptSpace) with the
// Private Events dashboard as the working surface, the Events assistant,
// and the EOS tabs. Dashboard numbers are computed server-side from the
// Triple Seat–synced Private Events databases (/api/events).
// Revenue = actual when recorded, else quoted; cancelled events excluded.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US')
// Signed money for deltas: −$3,670 / +$1,369 (real minus sign, not $-).
const moneySigned = (n) => (n < 0 ? '−' : '+') + money(Math.abs(n || 0))

function Delta({ value }) {
  if (value === null || value === undefined) return <>—</>
  return <span className={'pe-delta ' + (value < 0 ? 'bad' : 'ok')}>{moneySigned(value)}</span>
}

const heat = (value, max) =>
  max > 0
    ? { backgroundImage: `linear-gradient(90deg, var(--navy-50) ${Math.min(100, (100 * value) / max)}%, transparent ${Math.min(100, (100 * value) / max)}%)` }
    : undefined

function Paid({ yes, label }) {
  // Status is never color alone: symbol + word, tinted.
  return (
    <span className={'pe-paid ' + (yes ? 'ok' : 'bad')}>
      {yes ? '✓' : '✗'} {label || (yes ? 'Paid' : 'Unpaid')}
    </span>
  )
}

export default function EventsSpace({ isExec }) {
  const tabs = [
    // Dashboard is Exec-only while being dialed in (API enforces this too).
    ...(isExec ? [{ key: 'dashboard', label: 'Dashboard', render: () => <EventsDashboard /> }] : []),
    { key: 'assistant', label: 'Assistant', render: () => <EventsChat /> },
    ...EOS_TABS,
  ]
  return <DeptSpace title="Private Events" tabs={tabs} />
}

function EventsDashboard() {
  const [model, setModel] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback((refresh) => {
    setLoading(true)
    setError(null)
    apiFetch('/api/dashboards?space=events' + (refresh ? '&refresh=1' : ''))
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load the events dashboard')
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
      {!error && !model && <div className="pe-loading">Loading private-events data…</div>}
      {model && (
        <>
          <div className="pe-asof">
            Data as of {new Date(model.generatedAt).toLocaleString()} ·{' '}
            <button className="pe-refresh" onClick={() => load(true)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <DashboardBody m={model} />
        </>
      )}
    </div>
  )
}

function DashboardBody({ m }) {
  const k = m.kpis
  const vsLY = k.ytdLastYear > 0 ? Math.round((100 * (k.ytdRevenue - k.ytdLastYear)) / k.ytdLastYear) : null
  const a = m.attention
  const year = Number(m.today.slice(0, 4))
  const thisMonth = Number(m.today.slice(5, 7))
  // Show Jan..current month + any future month with bookings on the calendar.
  const monthly = m.monthly.filter((row, i) => i < thisMonth || row.events > 0)

  return (
    <>
      <div className="pe-kpis">
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.ytdRevenue)}</div>
          <div className="pe-kpi-label">{year} event revenue · {k.ytdEvents} events</div>
          {vsLY !== null && (
            <div className={'pe-kpi-delta ' + (vsLY >= 0 ? 'ok' : 'bad')}>
              {vsLY >= 0 ? '▲' : '▼'} {Math.abs(vsLY)}% vs same point {year - 1}
            </div>
          )}
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.next30Revenue)}</div>
          <div className="pe-kpi-label">next 30 days · {k.next30Count} events booked</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{k.openLeads}</div>
          <div className="pe-kpi-label">open leads</div>
          {a.staleLeadCount > 0 && (
            <div className="pe-kpi-delta warn">{a.staleLeadCount} waiting &gt;{a.staleLeadDays} days</div>
          )}
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(a.unpaidBalanceTotal)}</div>
          <div className="pe-kpi-label">unpaid balances · {a.unpaidBalanceCount} past events</div>
        </div>
      </div>

      {(a.unpaidBalances.length > 0 || a.unpaidDeposits.length > 0 || a.staleLeads.length > 0) && (
        <section className="pe-section">
          <h2>Needs attention</h2>
          {a.unpaidBalances.length > 0 && (
            <>
              <h3>
                Unpaid balances — {a.unpaidBalanceCount} past events, {money(a.unpaidBalanceTotal)} outstanding
                {a.unpaidBalanceCount > a.unpaidBalances.length ? ` (largest ${a.unpaidBalances.length} shown)` : ''}
              </h3>
              <table className="pe-table">
                <thead><tr><th>Event date</th><th>Event</th><th className="num">Revenue</th><th>Deposit</th><th>Rep</th></tr></thead>
                <tbody>
                  {a.unpaidBalances.map((b, i) => (
                    <tr key={i}>
                      <td>{b.date}</td><td className="ev" title={b.title}>{b.title}</td><td className="num">{money(b.revenue)}</td>
                      <td><Paid yes={b.depositPaid} /></td><td>{b.rep || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {a.unpaidDeposits.length > 0 && (
            <>
              <h3>Upcoming revenue events with no deposit — next {m.upcomingDays} days ({a.unpaidDepositCount})</h3>
              <table className="pe-table">
                <thead><tr><th>Event date</th><th>Event</th><th className="num">Revenue</th><th className="num">Deposit due</th><th>Rep</th></tr></thead>
                <tbody>
                  {a.unpaidDeposits.map((b, i) => (
                    <tr key={i}>
                      <td>{b.date}</td><td className="ev" title={b.title}>{b.title}</td><td className="num">{money(b.revenue)}</td>
                      <td className="num">{b.depositAmt != null ? money(b.depositAmt) : '—'}</td><td>{b.rep || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {a.unpaidDepositCount > a.unpaidDeposits.length && (
                <p className="pe-note">…and {a.unpaidDepositCount - a.unpaidDeposits.length} more in this window.</p>
              )}
            </>
          )}
          {a.staleLeads.length > 0 && (
            <>
              <h3>Pending leads older than {a.staleLeadDays} days ({a.staleLeadCount})</h3>
              <table className="pe-table">
                <thead><tr><th>Created</th><th>Lead</th><th>Event type</th><th>Requested date</th><th>Source</th></tr></thead>
                <tbody>
                  {a.staleLeads.map((l, i) => (
                    <tr key={i}>
                      <td>{l.createdAt}</td><td className="ev" title={l.title}>{l.title}</td><td>{l.eventType || '—'}</td>
                      <td>{l.reqDate || '—'}</td><td>{l.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {a.staleLeadCount > a.staleLeads.length && (
                <p className="pe-note">…and {a.staleLeadCount - a.staleLeads.length} more in Triple Seat.</p>
              )}
            </>
          )}
        </section>
      )}

      <section className="pe-section">
        <h2>Upcoming events — next {m.upcomingDays} days</h2>
        {m.upcoming.length === 0 && <p className="pe-note">Nothing on the books in this window.</p>}
        {m.upcoming.length > 0 && (
          <table className="pe-table">
            <thead><tr><th>Date</th><th>Event</th><th className="num">Headcount</th><th className="num">Revenue</th><th>Deposit</th><th>Balance</th><th>Rep</th></tr></thead>
            <tbody>
              {m.upcoming.map((u, i) => (
                <tr key={i}>
                  <td>{u.date}</td><td className="ev" title={u.title}>{u.title}</td>
                  <td className="num">{u.headcount ?? '—'}</td><td className="num">{money(u.revenue)}</td>
                  <td><Paid yes={u.depositPaid} /></td><td><Paid yes={u.balancePaid} /></td><td>{u.rep || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="pe-section">
        <h2>Event revenue by month — {year} vs {year - 1}</h2>
        <table className="pe-table">
          <thead><tr><th>Month</th><th className="num">Events</th><th className="num">Revenue</th><th className="num">Bar sales</th><th className="num">{year - 1}</th><th className="num">Δ vs {year - 1}</th></tr></thead>
          <tbody>
            {monthly.map((r, i) => {
              const maxR = Math.max(...monthly.map((x) => Math.max(x.revenue, x.lastYear)))
              return (
              <tr key={i}>
                <td>{MONTH_NAMES[Number(r.month) - 1]}</td>
                <td className="num">{r.events || '—'}</td>
                <td className="num pe-heat" style={heat(r.revenue, maxR)}>{money(r.revenue)}</td>
                <td className="num">{r.bar ? money(r.bar) : '—'}</td>
                <td className="num">{r.lastYear ? money(r.lastYear) : '—'}</td>
                <td className="num">{r.lastYear || r.revenue ? <Delta value={r.revenue - r.lastYear} /> : '—'}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="pe-section">
        <h2>Lead funnel — trailing {m.funnel.windowDays} days</h2>
        <p>
          <strong>{m.funnel.total} leads</strong> — {m.funnel.byStatus.Booked || 0} booked
          ({m.funnel.conversionPct}% conversion), {m.funnel.byStatus.Pending || 0} pending,{' '}
          {(m.funnel.byStatus.Lost || 0) + (m.funnel.byStatus.Passed || 0)} lost or passed.
        </p>
        {m.funnel.topSources.length > 0 && (
          <table className="pe-table pe-table-narrow">
            <thead><tr><th>Lead source</th><th className="num">Leads</th><th className="num">Booked</th></tr></thead>
            <tbody>
              {m.funnel.topSources.map((s, i) => (
                <tr key={i}><td>{s.source}</td><td className="num">{s.leads}</td><td className="num">{s.booked}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="pe-note pe-footer">
        Data: Private Events databases, Triple Seat daily 6am sync. Revenue = actual when recorded,
        else quoted; cancelled events excluded; bar sales shown separately.
      </p>
    </>
  )
}
