import React from 'react'
import DeptSpace, { EOS_TABS, EosPlaceholder } from './DeptSpace.jsx'

// Framed-out department spaces (2026-07-21): full DeptSpace frame — tab row,
// EOS tabs — with Dashboard/Assistant cards that say exactly what lights
// them up. Each graduates to its own file (like ProductionSpace/EventsSpace)
// when its data input lands; the frame, tags, and tabs don't change.
//
// Input status at framing time:
//   Taproom   — Clover pipeline built + deployed; waiting on Clover
//               production API approval.
//   Sales     — VIP monthly marts land in the Brain (ADR-013); first live
//               load is the acceptance test. Weekly view planned alongside.
//   Marketing — Mailchimp campaign log syncs daily (live since May).
//   R&D       — no data inputs yet; EOS-first space.

const tab = (key, label, title, note, status) => ({
  key,
  label,
  render: () => <EosPlaceholder title={title} note={note} status={status} />,
})

export function TaproomSpace() {
  return (
    <DeptSpace
      title="Taproom"
      tabs={[
        tab('dashboard', 'Dashboard', 'Taproom Dashboard',
          'Daily sales, labor, and SKU movement from Clover. The pipeline is built and deployed — this lights up the day Clover approves production API access.',
          'Next up'),
        tab('assistant', 'Assistant', 'Taproom Assistant',
          'Read-only analyst over the Clover feed, on the same engine as the Production and Events assistants. Follows the dashboard.',
          'Planned'),
        ...EOS_TABS,
      ]}
    />
  )
}

export function RndSpace() {
  return (
    <DeptSpace
      title="R&D"
      tabs={[
        tab('dashboard', 'Dashboard', 'R&D Dashboard',
          'No data inputs yet — this space runs EOS-first. Trial-batch data can come from Ekos when R&D tracking starts there.',
          'Planned'),
        ...EOS_TABS,
      ]}
    />
  )
}
