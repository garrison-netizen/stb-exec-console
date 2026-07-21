import React, { useState } from 'react'

// Shared department-space shell: brand banner + tab row. Every departmental
// build gets the same frame — a working Dashboard/Assistant plus the EOS tabs
// (Rocks / Scorecard / L10) that light up as the EOS rollout standardizes
// them (ADR-005 Admin-hub pilot first). Panes stay mounted; switching tabs
// hides rather than destroys, so a chat conversation survives a trip to
// another tab.

export function EosPlaceholder({ title, note, status = 'Planned' }) {
  return (
    <div className="dept-eos single">
      <div className="dept-eos-card">
        <div className="dept-eos-head">
          <span className="dept-eos-title">{title}</span>
          <span className={'dept-eos-status' + (status === 'Next up' ? ' next' : '')}>{status}</span>
        </div>
        <p className="dept-eos-note">{note}</p>
      </div>
    </div>
  )
}

export const EOS_TABS = [
  {
    key: 'rocks',
    label: 'Rocks',
    render: () => (
      <EosPlaceholder
        title="Rocks"
        note="Department Rocks from the company tracker — wiring up next."
        status="Next up"
      />
    ),
  },
  {
    key: 'scorecard',
    label: 'Scorecard',
    render: () => (
      <EosPlaceholder title="Scorecard" note="Weekly numbers land here with the EOS rollout." />
    ),
  },
  {
    key: 'l10',
    label: 'L10 Agenda',
    render: () => (
      <EosPlaceholder title="L10 Agenda" note="Meeting agenda + IDS list land here with the EOS rollout." />
    ),
  },
]

export default function DeptSpace({ title, tabs }) {
  const [active, setActive] = useState(tabs[0].key)
  return (
    <div className="dept">
      <header className="dept-banner">
        <h1>{title}</h1>
      </header>
      <nav className="dept-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={'dept-tab' + (active === t.key ? ' active' : '')}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="dept-main">
        {tabs.map((t) => (
          <div
            key={t.key}
            className="dept-pane"
            style={{ display: active === t.key ? 'flex' : 'none' }}
          >
            {t.render()}
          </div>
        ))}
      </div>
    </div>
  )
}
