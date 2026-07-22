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

export default function CoffeeSpace() {
  // Dashboard opened to the department 2026-07-22.
  const tabs = [
    { key: 'dashboard', label: 'Dashboard', render: () => <CoffeeDashboard /> },
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
          <div className="pe-kpi-value">{m.register ? money(m.register.total) : '—'}</div>
          <div className="pe-kpi-label">
            {m.register
              ? `register coffee sales ${m.register.totalNote || ''} · Shopify pending`
              : 'coffee revenue — share the Clover DBs with the Console integration'}
          </div>
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

      {m.register && (
        <section className="pe-section">
          <h2>Register coffee sales (Clover)</h2>
          {m.register.monthly.length > 0 && (
            <>
              <h3>By month — history (Mar 2025 → Apr 2026)</h3>
              <table className="pe-table pe-table-narrow">
                <thead><tr><th>Month</th><th className="num">Net revenue</th></tr></thead>
                <tbody>
                  {m.register.monthly.map((r, i) => {
                    const maxM = Math.max(...m.register.monthly.map((x) => x.revenue))
                    return (
                      <tr key={i}>
                        <td>{r.month}</td>
                        <td className="num pe-heat" style={maxM > 0 ? { backgroundImage: `linear-gradient(90deg, var(--navy-50) ${Math.min(100, (100 * r.revenue) / maxM)}%, transparent ${Math.min(100, (100 * r.revenue) / maxM)}%)` } : undefined}>{money(r.revenue)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
          <h3>Recent weeks — living feed</h3>
          <table className="pe-table pe-table-narrow">
            <thead><tr><th>Week of</th><th className="num">Revenue</th></tr></thead>
            <tbody>
              {m.register.weekly.slice(-13).map((w, i) => {
                const maxW = Math.max(...m.register.weekly.map((x) => x.revenue))
                return (
                  <tr key={i}>
                    <td>{w.week}</td>
                    <td className="num pe-heat" style={maxW > 0 ? { backgroundImage: `linear-gradient(90deg, var(--navy-50) ${Math.min(100, (100 * w.revenue) / maxW)}%, transparent ${Math.min(100, (100 * w.revenue) / maxW)}%)` } : undefined}>{money(w.revenue)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <h3>Top sellers at the register</h3>
          <table className="pe-table">
            <thead><tr><th>SKU</th><th className="num">Units</th><th className="num">Revenue</th></tr></thead>
            <tbody>
              {m.register.topSkus.map((s, i) => (
                <tr key={i}>
                  <td className="ev" title={s.name}>{s.name}</td>
                  <td className="num">{count(s.units)}</td>
                  <td className="num">{money(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

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
        Data: Ekos mirror (transfers + inventory; coffee moves through Ekos as $0 internal transfers)
        {m.register ? ' + Clover register sales (history loading backward — coverage grows as the backfill runs)' : ''}.
        Shopify (online sales) not yet integrated. Ekos freshness follows the VPN sync.
      </p>
    </>
  )
}
