import React, { useState, useEffect } from 'react'
import App from './App.jsx'
import ProductionChat from './spaces/ProductionChat.jsx'
import { apiFetch, currentEmail, signOut } from './Auth.jsx'

// The STB App shell: asks the server which spaces this user may enter and
// renders role-scoped navigation. Exec = the existing Executive Console.
// Department spaces mount alongside it. The calendar and calculator remain
// separate apps (same sign-in + allow-list), annexed as links.

const SPACE_DEFS = [
  { key: 'Exec', label: 'Executive', render: () => <App /> },
  { key: 'Production', label: 'Production', render: () => <ProductionChat /> },
  // Events space mounts here when it ships.
]

const LINKS = [
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
  const showNav = available.length + LINKS.length > 1

  return (
    <div className="shell">
      {showNav && (
        <nav className="shell-nav">
          <span className="shell-brand">STB</span>
          {available.map((s) => (
            <button
              key={s.key}
              className={'shell-tab' + (current && current.key === s.key ? ' active' : '')}
              onClick={() => setActive(s.key)}
            >
              {s.label}
            </button>
          ))}
          {LINKS.map((l) => (
            <a key={l.label} className="shell-tab shell-link" href={l.href} target="_blank" rel="noreferrer">
              {l.label} ↗
            </a>
          ))}
          <span className="shell-spacer" />
          <span className="shell-user" title={email}>{email}</span>
          {import.meta.env.VITE_GOOGLE_CLIENT_ID && (
            <button className="shell-signout" onClick={signOut}>Sign out</button>
          )}
        </nav>
      )}
      <div className="shell-body">
        {available.map((s) => (
          // Every granted space stays mounted; switching tabs hides rather than
          // destroys, so a chat conversation survives a trip to another space.
          <div
            key={s.key}
            className="shell-space"
            style={{ display: current && current.key === s.key ? 'block' : 'none' }}
          >
            {s.render()}
          </div>
        ))}
      </div>
    </div>
  )
}
