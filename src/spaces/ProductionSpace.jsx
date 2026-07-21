import React from 'react'
import ProductionChat from './ProductionChat.jsx'

// The Production department's dashboard: banner, EOS framing (Rocks /
// Scorecard / L10 land here as the EOS rollout standardizes them — ADR-005
// Admin-hub pilot first), and the Ekos assistant as the working surface.

const EOS_PANELS = [
  {
    title: 'Rocks',
    note: 'Department Rocks from the company tracker — wiring up next.',
    status: 'Next up',
  },
  {
    title: 'Scorecard',
    note: 'Weekly numbers land here with the EOS rollout.',
    status: 'Planned',
  },
  {
    title: 'L10 Agenda',
    note: 'Meeting agenda + IDS list land here with the EOS rollout.',
    status: 'Planned',
  },
]

export default function ProductionSpace() {
  return (
    <div className="dept">
      <header className="dept-banner">
        <h1>Production Dashboard</h1>
      </header>
      <div className="dept-eos">
        {EOS_PANELS.map((p) => (
          <div key={p.title} className="dept-eos-card">
            <div className="dept-eos-head">
              <span className="dept-eos-title">{p.title}</span>
              <span className={'dept-eos-status' + (p.status === 'Next up' ? ' next' : '')}>{p.status}</span>
            </div>
            <p className="dept-eos-note">{p.note}</p>
          </div>
        ))}
      </div>
      <div className="dept-main">
        <ProductionChat />
      </div>
    </div>
  )
}
