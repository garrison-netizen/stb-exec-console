import React, { useState, useEffect, useRef } from 'react'

// Google sign-in gate for the STB App (cloned from the Master Calendar's
// proven pattern). Production: VITE_GOOGLE_CLIENT_ID is set, so the app is
// shown only after a successful sign-in by an account on the STB Allowed
// Users list. Local dev: the var is unset, so the gate is skipped entirely.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const TOKEN_KEY = 'stb_app_id_token'

// Decode a JWT payload for display only. The server independently verifies it.
function decodeJwt(token) {
  try {
    const part = token.split('.')[1]
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || ''
}

export function currentEmail() {
  const claims = decodeJwt(getToken())
  return claims && claims.email ? String(claims.email) : ''
}

export function signOut() {
  sessionStorage.removeItem(TOKEN_KEY)
  try {
    window.google?.accounts?.id?.disableAutoSelect?.()
  } catch {
    /* no-op */
  }
  window.location.reload()
}

export function authHeader() {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// fetch() with the sign-in token attached. All app API calls go through this.
export function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...authHeader() } })
}

export default function AuthGate({ children }) {
  if (!CLIENT_ID) {
    // Never ship an ungated build: in production a missing client id shows a
    // clear setup screen instead of silently opening the app (or a blank page).
    if (import.meta.env.PROD) {
      return (
        <div className="signin-screen">
          <div className="signin-card">
            <img src="/logo-mark.png" alt="Spindletap Beverages" className="signin-logo" />
            <h1>STB Console</h1>
            <p className="signin-deny">
              Sign-in is not configured for this deployment (missing Google
              client id). Contact Garrison.
            </p>
          </div>
        </div>
      )
    }
    return children // local dev — no gate
  }
  return <SignInFlow>{children}</SignInFlow>
}

function SignInFlow({ children }) {
  const [state, setState] = useState(() => {
    const token = getToken()
    const claims = token ? decodeJwt(token) : null
    if (claims && claims.exp * 1000 > Date.now() && claims.email) {
      return { status: 'in' }
    }
    sessionStorage.removeItem(TOKEN_KEY)
    return { status: 'out' }
  })
  const btnRef = useRef(null)

  function handleCredential(resp) {
    const token = resp && resp.credential
    const claims = token ? decodeJwt(token) : null
    if (!claims || !claims.email) {
      setState({ status: 'error' })
      return
    }
    // Any verified Google account may proceed past this screen; the server
    // authorizes the specific account against the STB Allowed Users list.
    sessionStorage.setItem(TOKEN_KEY, token)
    setState({ status: 'in' })
  }

  useEffect(() => {
    if (state.status === 'in') return
    let cancelled = false

    function init() {
      if (cancelled || !window.google?.accounts?.id) return
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: handleCredential,
        // Deliberate account choice — no silent auto-select of the browser's
        // default Google account (calendar lesson: wrong-account sign-ins).
        auto_select: false,
      })
      if (btnRef.current) {
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: 'filled_blue',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
        })
      }
      window.google.accounts.id.prompt()
    }

    if (window.google?.accounts?.id) {
      init()
    } else {
      const timer = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(timer)
          init()
        }
      }, 120)
      return () => {
        cancelled = true
        clearInterval(timer)
      }
    }
    return () => {
      cancelled = true
    }
  }, [state.status])

  if (state.status === 'in') return children

  return (
    <div className="signin-screen">
      <div className="signin-card">
        <img src="/logo-mark.png" alt="Spindletap Beverages" className="signin-logo" />
        <h1>STB Console</h1>
        {state.status === 'error' ? (
          <p className="signin-deny">Something went wrong signing in. Please try again.</p>
        ) : (
          <p className="signin-msg">
            Sign in with your authorized Google account to open the app.
          </p>
        )}
        <div ref={btnRef} className="signin-btn" />
        <p className="signin-foot">Spindletap Beverages · Internal tools</p>
      </div>
    </div>
  )
}
