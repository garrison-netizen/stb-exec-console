import React from 'react'
import DeptSpace, { EOS_TABS } from './DeptSpace.jsx'
import ProductionDashboard from './ProductionDashboard.jsx'
import ProductionChat from './ProductionChat.jsx'

// The Production department: standard department frame (DeptSpace) — the
// Ekos dashboard and assistant plus the EOS tabs (Rocks / Scorecard / L10
// light up as the EOS rollout standardizes them — ADR-005 Admin-hub pilot
// first).

const TABS = [
  { key: 'dashboard', label: 'Dashboard', render: () => <ProductionDashboard /> },
  { key: 'assistant', label: 'Assistant', render: () => <ProductionChat /> },
  ...EOS_TABS,
]

export default function ProductionSpace() {
  return <DeptSpace title="Production" tabs={TABS} />
}
