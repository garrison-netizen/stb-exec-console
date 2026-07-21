import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../Auth.jsx'
import DeptSpace, { EOS_TABS, EosPlaceholder } from './DeptSpace.jsx'

// The Marketing department: campaign performance from the Mailchimp log
// (daily sync) joined with email-attributed event leads from the Private
// Events data. Graduated from PlannedSpaces 2026-07-21.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pct = (r) => (r == null ? '—' : (100 * r).toFixed(1) + '%')
const count = (n) => (n || 0).toLocaleString('en-US')

const TABS = [
  { key: 'dashboard', label: 'Dashboard', render: () => <MarketingDashboard /> },
  {
    key: 'assistant',
    label: 'Assistant',
    render: () => (
      <EosPlaceholder
        title="Marketing Assistant"
        note="Read-only analyst over campaigns + lead sources, on the same engine as the other assistants. Say the word and it ships."
        status="Planned"
      />
    ),
  },
  ...EOS_TABS,
]

export default function MarketingSpace() {
  return <DeptSpace title="Marketing" tabs={TABS} />
}

function MarketingDashboard() {
  const [model, setModel] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback((refresh) => {
    setLoading(true)
    setError(null)
    apiFetch('/api/marketing' + (refresh ? '?refresh=1' : ''))
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load the marketing dashboard')
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
      {!error && !model && <div className="pe-loading">Loading campaign data…</div>}
      {model && (
        <>
          <div className="pe-asof">
            Data as of {new Date(model.generatedAt).toLocaleString()} ·{' '}
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
  const a = m.attribution
  const year = Number(m.today.slice(0, 4))
  const thisMonth = Number(m.today.slice(5, 7))
  const monthly = m.monthly.filter((row, i) => i < thisMonth || row.campaigns > 0)

  return (
    <>
      <div className="pe-kpis">
        <div className="pe-kpi">
          <div className="pe-kpi-value">{k.ytdCampaigns}</div>
          <div className="pe-kpi-label">{year} campaigns · {count(k.ytdRecipients)} emails sent</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{pct(k.ytdOpenRate)}</div>
          <div className="pe-kpi-label">{year} open rate (recipient-weighted)</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{pct(k.ytdClickRate)}</div>
          <div className="pe-kpi-label">{year} click rate (recipient-weighted)</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{a.ytdLeads}</div>
          <div className="pe-kpi-label">{year} email-attributed event leads · {a.ytdBooked} booked</div>
        </div>
      </div>

      <section className="pe-section">
        <h2>Recent campaigns</h2>
        <table className="pe-table">
          <thead><tr><th>Sent</th><th>Campaign</th><th>Subject</th><th className="num">Recipients</th><th className="num">Opens</th><th className="num">Clicks</th></tr></thead>
          <tbody>
            {m.recent.map((c, i) => (
              <tr key={i}>
                <td>{c.sent}</td>
                <td className="ev" title={c.name}>{c.name}</td>
                <td className="ev" title={c.subject}>{c.subject}</td>
                <td className="num">{count(c.recipients)}</td>
                <td className="num">{pct(c.openRate)}</td>
                <td className="num">{pct(c.clickRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pe-section">
        <h2>Campaigns by month — {year}</h2>
        <table className="pe-table pe-table-narrow">
          <thead><tr><th>Month</th><th className="num">Campaigns</th><th className="num">Emails</th><th className="num">Open rate</th><th className="num">Click rate</th></tr></thead>
          <tbody>
            {monthly.map((r, i) => (
              <tr key={i}>
                <td>{MONTH_NAMES[Number(r.month) - 1]}</td>
                <td className="num">{r.campaigns || '—'}</td>
                <td className="num">{r.recipients ? count(r.recipients) : '—'}</td>
                <td className="num">{pct(r.openRate)}</td>
                <td className="num">{pct(r.clickRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pe-section">
        <h2>Email → private-event leads</h2>
        <p>
          <strong>{a.ytdLeads} event leads</strong> credited to email this year ({a.ytdBooked} booked);{' '}
          {a.allTimeLeads} all-time ({a.allTimeBooked} booked).
        </p>
        <p className="pe-note">
          Known undercount: Tripleseat only credits "Email" when the lead form captures it, and the
          July 2026 attribution review found most email-driven leads arrive labeled as web leads.
          Treat these as a floor, not the true impact.
        </p>
      </section>

      <p className="pe-note pe-footer">
        Data: Mailchimp Campaign Log (daily 6am sync) + Private Events databases. Open/click rates
        weighted by recipients.
      </p>
    </>
  )
}
