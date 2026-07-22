import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../Auth.jsx'
import DeptSpace, { EOS_TABS, EosPlaceholder } from './DeptSpace.jsx'

// The Coffee (Spindletap Coffee / STC) department. Ekos holds coffee as $0
// internal transfers to the taproom, so this dashboard is a VOLUME +
// INVENTORY view — honest about the fact that coffee revenue lands with the
// Clover approval (register) and a future Shopify integration (online).

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US')
const count = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }))

export default function CoffeeSpace({ isExec }) {
  const tabs = [
    // Dashboard is Exec-only while being dialed in (API enforces this too).
    ...(isExec ? [{ key: 'dashboard', label: 'Dashboard', render: () => <CoffeeDashboard /> }] : []),
    {
      key: 'assistant',
      label: 'Assistant',
      render: () => (
        <EosPlaceholder
          title="Coffee Assistant"
          note="Coffee questions are covered by the Production Assistant today (same Ekos data). A dedicated coffee analyst makes sense once Clover/Shopify sales data lands."
          status="Planned"
        />
      ),
    },
    ...EOS_TABS,
  ]
  return <DeptSpace title="Coffee" tabs={tabs} />
}

function CoffeeDashboard() {
  const [model, setModel] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    apiFetch('/api/dashboards?space=coffee')
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load the coffee dashboard')
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
      {!error && !model && <div className="pe-loading">Loading coffee data…</div>}
      {model && (
        <>
          <div className="pe-asof">
            Ekos data as of {model.ekosAsOf ? new Date(model.ekosAsOf).toLocaleString() : 'unknown'} ·{' '}
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
  const thisMonth = Number(m.today.slice(5, 7))
  const monthly = m.monthly.filter((row, i) => i < thisMonth || row.lines > 0)

  return (
    <>
      <div className="pe-kpis">
        <div className="pe-kpi">
          <div className="pe-kpi-value">{count(k.transfersYTD)}</div>
          <div className="pe-kpi-label">{m.year} coffee transfers to the taproom · {count(k.transfersLY)} by this point {m.year - 1}</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.inventoryTotal)}</div>
          <div className="pe-kpi-label">STC inventory on hand (all classes)</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{money(k.packagedValue)}</div>
          <div className="pe-kpi-label">packaged coffee on the shelf</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">—</div>
          <div className="pe-kpi-label">coffee revenue — joins with Clover (register) / Shopify (online)</div>
        </div>
      </div>

      <section className="pe-section">
        <h2>Top movers — {m.year} YTD (units transferred)</h2>
        <table className="pe-table">
          <thead><tr><th>Blend</th><th>Pack</th><th className="num">Qty</th></tr></thead>
          <tbody>
            {m.topItems.map((t, i) => (
              <tr key={i}>
                <td className="ev" title={t.blend}>{t.blend}</td>
                <td>{t.pack || '—'}</td>
                <td className="num">{count(t.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pe-note">Quantities are per-pack units (a 12 oz bag and a bulk ounce each count in their own unit) — compare within a row's pack size, not across packs.</p>
      </section>

      <section className="pe-section">
        <h2>Transfer activity by month — {m.year} vs {m.year - 1}</h2>
        <table className="pe-table pe-table-narrow">
          <thead><tr><th>Month</th><th className="num">{m.year} lines</th><th className="num">{m.year - 1} lines</th></tr></thead>
          <tbody>
            {monthly.map((r, i) => (
              <tr key={i}>
                <td>{MONTH_NAMES[Number(r.month) - 1]}</td>
                <td className="num">{r.lines || '—'}</td>
                <td className="num">{r.lastYear || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="pe-section">
        <h2>Inventory position</h2>
        <table className="pe-table pe-table-narrow">
          <thead><tr><th>Class</th><th className="num">Items</th><th className="num">Value</th></tr></thead>
          <tbody>
            {m.inventory.map((r, i) => (
              <tr key={i}>
                <td>{r.class.replace('STC - ', '')}</td>
                <td className="num">{r.items}</td>
                <td className="num">{money(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {m.onHand.length > 0 && (
          <>
            <h3>Packaged coffee on hand</h3>
            <table className="pe-table">
              <thead><tr><th>Blend</th><th>Pack</th><th className="num">Qty</th><th className="num">Value</th></tr></thead>
              <tbody>
                {m.onHand.map((r, i) => (
                  <tr key={i}>
                    <td className="ev" title={r.blend}>{r.blend}</td>
                    <td>{r.pack || '—'}</td>
                    <td className="num">{count(r.qty)}</td>
                    <td className="num">{money(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <p className="pe-note pe-footer">
        Data: Ekos mirror — coffee moves through Ekos as $0 internal transfers to the taproom, so
        this is a volume and inventory view. Revenue joins when Clover (register) and Shopify
        (online) integrations land. Freshness follows the Ekos VPN sync.
      </p>
    </>
  )
}
