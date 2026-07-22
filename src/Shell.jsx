import React, { useState, useEffect } from 'react'
import App from './App.jsx'
import ProductionSpace from './spaces/ProductionSpace.jsx'
import EventsSpace from './spaces/EventsSpace.jsx'
import { RndSpace } from './spaces/PlannedSpaces.jsx'
import TaproomSpace from './spaces/TaproomSpace.jsx'
import SalesSpace from './spaces/SalesSpace.jsx'
import MarketingSpace from './spaces/MarketingSpace.jsx'
import FinancesSpace from './spaces/FinancesSpace.jsx'
import CoffeeSpace from './spaces/CoffeeSpace.jsx'
import { apiFetch, currentEmail, signOut, getToken } from './Auth.jsx'

// The STB App shell: asks the server which spaces this user may enter and
// renders role-scoped navigation. Exec = the existing Executive Console.
// Department spaces mount alongside it. The calendar and calculator remain
// separate apps (same sign-in + allow-list), annexed as links.

// Department dashboards are Exec-only while being dialed in (2026-07-21) —
// each space also enforces this server-side (/api/* requireSpace 'Exec').
const SPACE_DEFS = [
  { key: 'Exec', label: 'Executive', render: () => <App /> },
  { key: 'Finances', label: 'Finances', render: () => <FinancesSpace /> },
  { key: 'Production', label: 'Production', render: (isExec) => <ProductionSpace isExec={isExec} /> },
  { key: 'Events', label: 'Events', render: () => <EventsSpace /> },
  { key: 'Taproom', label: 'Taproom', render: (isExec) => <TaproomSpace isExec={isExec} /> },
  { key: 'Sales', label: 'Sales', render: (isExec) => <SalesSpace isExec={isExec} /> },
  { key: 'Marketing', label: 'Marketing', render: (isExec) => <MarketingSpace isExec={isExec} /> },
  { key: 'Coffee', label: 'Coffee', render: () => <CoffeeSpace /> },
  { key: 'R&D', label: 'R&D', render: () => <RndSpace /> },
]

// Annexed app links — shown only to holders of the matching Tools tag
// (me.apps from /api/me; Exec holds both).
const LINK_DEFS = [
  { label: 'Calendar', href: import.meta.env.VITE_CALENDAR_URL },
  { label: 'Calculator', href: import.meta.env.VITE_CALCULATOR_URL },
].filter((l) => l.href)

export default function Shell() {
  const [me, setMe] = useState(null)
  const [error, setError] = useState(null)
  const [active, setActive] = useState(null)

  useEffect(() => {
    apiFetch('/api/me')
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load your access')
        return data
      })
      .then((data) => {
        setMe(data)
        const available = SPACE_DEFS.filter((s) => data.spaces.includes(s.key))
        setActive(available.length ? available[0].key : null)
      })
      .catch((e) => setError(e.message))
  }, [])

  if (error) {
    return (
      <div className="signin-screen">
        <div className="signin-card">
          <img src="/logo-mark.png" alt="Spindletap Beverages" className="signin-logo" />
          <h1>STB Console</h1>
          <p className="signin-deny">{error}</p>
          <button className="shell-signout" onClick={signOut}>
            Sign in with a different account
          </button>
        </div>
      </div>
    )
  }
  if (!me) {
    return (
      <div className="shell-loading">
        <div className="shell-loading-dot" /> Loading your workspace…
      </div>
    )
  }

  const available = SPACE_DEFS.filter((s) => me.spaces.includes(s.key))
  const current = available.find((s) => s.key === active) || available[0]
  const email = me.email || currentEmail() || 'dev'

  return (
    <div className="shell">
      {/* Always shown — it carries the brand, the user's identity, and sign-out,
          even for single-space users like a department head. */}
      <nav className="shell-nav">
        <img src="/logo-mark.png" alt="Spindletap Beverages" className="shell-logo" />
          {/* A single-space user needs no tab — the space banner names the room. */}
          {available.length > 1 &&
            available.map((s) => (
              <button
                key={s.key}
                className={'shell-tab' + (current && current.key === s.key ? ' active' : '')}
                onClick={() => setActive(s.key)}
              >
                {s.label}
              </button>
            ))}
          {LINK_DEFS.filter((l) => (me.apps || []).includes(l.label)).map((l) => (
            <a
              key={l.label}
              className="shell-tab shell-link"
              href={l.href}
              target="_blank"
              rel="noreferrer"
              // Single sign-on handoff: pass the current (already-verified)
              // Google token in the URL fragment so the target app skips its
              // sign-in screen. Fragments never reach servers or logs; the
              // target strips it immediately and verifies server-side.
              onClick={(e) => {
                const t = getToken()
                if (!t) return // local dev / no token — plain link
                e.preventDefault()
                window.open(l.href + '#sso=' + encodeURIComponent(t), '_blank', 'noreferrer')
              }}
            >
              {l.label} ↗
            </a>
          ))}
          <span className="shell-spacer" />
          <span className="shell-user" title={email}>{email}</span>
          {import.meta.env.VITE_GOOGLE_CLIENT_ID && (
            <button className="shell-signout" onClick={signOut}>Sign out</button>
          )}
      </nav>
      <div className="shell-body">
        {available.map((s) => (
          // Every granted space stays mounted; switching tabs hides rather than
          // destroys, so a chat conversation survives a trip to another space.
          <div
            key={s.key}
            className="shell-space"
            style={{ display: current && current.key === s.key ? 'block' : 'none' }}
          >
            {s.render(me.spaces.includes('Exec'))}
          </div>
        ))}
      </div>
    </div>
  )
}
