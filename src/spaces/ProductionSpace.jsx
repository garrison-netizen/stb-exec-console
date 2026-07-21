import React from 'react'
import DeptSpace, { EOS_TABS } from './DeptSpace.jsx'
import ProductionDashboard from './ProductionDashboard.jsx'
import ProductionChat from './ProductionChat.jsx'

// The Production department: standard department frame (DeptSpace) — the
// Ekos dashboard and assistant plus the EOS tabs (Rocks / Scorecard / L10
// light up as the EOS rollout standardizes them — ADR-005 Admin-hub pilot
// first).

export default function ProductionSpace({ isExec }) {
  const tabs = [
    // Dashboard is Exec-only while being dialed in (API enforces this too).
    ...(isExec ? [{ key: 'dashboard', label: 'Dashboard', render: () => <ProductionDashboard /> }] : []),
    { key: 'assistant', label: 'Assistant', render: () => <ProductionChat /> },
    ...EOS_TABS,
  ]
  return <DeptSpace title="Production" tabs={tabs} />
}
