import React, { useState, useRef, useEffect } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { apiFetch, currentEmail } from '../Auth.jsx'

// Shared department chat surface: Claude-style conversation log over a
// space-specific read-only endpoint. Conversations persist per-user in this
// browser (localStorage keyed by storagePrefix + signed-in email) — nothing
// chat-related is stored server-side. ProductionChat and EventsChat are thin
// wrappers that supply endpoint, copy, and starter questions.

const MAX_CONVOS = 30
const MAX_MESSAGES = 80

function relTime(ts) {
  const d = Date.now() - ts
  const min = Math.round(d / 60000)
  if (min < 1) return 'now'
  if (min < 60) return min + 'm ago'
  const h = Math.round(min / 60)
  if (h < 24) return h + 'h ago'
  const days = Math.round(h / 24)
  return days === 1 ? 'yesterday' : days + 'd ago'
}

function renderMarkdown(text) {
  return { __html: DOMPurify.sanitize(marked.parse(text || '')) }
}

export default function DeptChat({
  endpoint,
  title,
  sub,
  starterPool,
  storagePrefix,
  inputPlaceholder,
  thinkingLabel = 'Checking the numbers…',
  freshTitle = 'When the data snapshot was last refreshed',
}) {
  function storageKey() {
    return storagePrefix + '::' + (currentEmail() || 'dev').toLowerCase()
  }
  function loadConvos() {
    try {
      const raw = localStorage.getItem(storageKey())
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }
  function saveConvos(list) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(list.slice(0, MAX_CONVOS)))
    } catch {
      /* storage full/blocked — chat still works, just unsaved */
    }
  }
  function dealStarters() {
    const pool = [...starterPool]
    const hand = []
    while (hand.length < 6 && pool.length) {
      hand.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
    }
    return hand
  }

  const [convos, setConvos] = useState(loadConvos)
  const [activeId, setActiveId] = useState(null)
  const [starters, setStarters] = useState(dealStarters)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [dataAsOf, setDataAsOf] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  const active = convos.find((c) => c.id === activeId) || null
  const messages = active ? active.messages : []

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeId, messages.length, busy])

  function persist(next) {
    setConvos(next)
    saveConvos(next)
  }

  function newConversation() {
    setActiveId(null)
    setStarters(dealStarters())
    setInput('')
    setDrawerOpen(false)
    inputRef.current?.focus()
  }

  function deleteConversation(id, e) {
    e.stopPropagation()
    const next = convos.filter((c) => c.id !== id)
    persist(next)
    if (activeId === id) {
      setActiveId(null)
      setStarters(dealStarters())
    }
  }

  async function send(text) {
    const question = (text || input).trim()
    if (!question || busy) return

    let convo = active
    let next
    if (!convo) {
      convo = {
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: question.length > 48 ? question.slice(0, 48) + '…' : question,
        updatedAt: Date.now(),
        messages: [],
      }
      next = [convo, ...convos]
      setActiveId(convo.id)
    } else {
      next = [...convos]
    }

    convo.messages = [...convo.messages, { role: 'user', content: question }].slice(-MAX_MESSAGES)
    convo.updatedAt = Date.now()
    // Bubble the touched conversation to the top of the log
    next = [convo, ...next.filter((c) => c.id !== convo.id)]
    persist(next)
    setInput('')
    setBusy(true)

    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: convo.messages }),
      })
      // The platform can answer with plain text (timeouts, gateway errors) —
      // never assume JSON, and translate those cases into human language.
      const raw = await res.text()
      let data = null
      try {
        data = JSON.parse(raw)
      } catch {
        if (res.status === 504 || /timeout/i.test(raw)) {
          throw new Error('That question needed more time than the server allows. Try breaking it into smaller pieces.')
        }
        throw new Error(`The server had a hiccup (${res.status}). Please try again.`)
      }
      if (!res.ok || !data.ok) throw new Error(data.error || 'Something went wrong')
      convo.messages = [...convo.messages, { role: 'assistant', content: data.reply }].slice(-MAX_MESSAGES)
      if (data.dataAsOf) setDataAsOf(data.dataAsOf)
    } catch (err) {
      convo.messages = [
        ...convo.messages,
        { role: 'assistant', content: '⚠️ ' + err.message, isError: true },
      ]
    } finally {
      convo.updatedAt = Date.now()
      persist([convo, ...convos.filter((c) => c.id !== convo.id)])
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="prodchat-wrap">
      <aside className={'prodchat-side' + (drawerOpen ? ' open' : '')}>
        <button className="prodchat-new side" onClick={newConversation}>
          + New conversation
        </button>
        <div className="prodchat-convos">
          {convos.length === 0 && <p className="prodchat-side-empty">No conversations yet.</p>}
          {convos.map((c) => (
            <div
              key={c.id}
              className={'prodchat-convo' + (c.id === activeId ? ' active' : '')}
              onClick={() => {
                setActiveId(c.id)
                setDrawerOpen(false)
              }}
            >
              <div className="prodchat-convo-title">{c.title}</div>
              <div className="prodchat-convo-meta">
                {relTime(c.updatedAt)} · {c.messages.length} msg
              </div>
              <button
                className="prodchat-convo-del"
                title="Delete conversation"
                onClick={(e) => deleteConversation(c.id, e)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="prodchat">
        <header className="prodchat-head">
          <button className="prodchat-drawer-btn" onClick={() => setDrawerOpen(!drawerOpen)}>
            ☰
          </button>
          <div>
            <div className="prodchat-title-row">
              <h1>{title}</h1>
              {dataAsOf && (
                <span className="prodchat-fresh" title={freshTitle}>
                  Data updated{' '}
                  {new Date(dataAsOf).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
            <p className="prodchat-sub">{sub}</p>
          </div>
        </header>

        <div className="prodchat-scroll">
          {!active && (
            <div className="prodchat-welcome">
              <p>Try one of these to get started:</p>
              <div className="prodchat-chips">
                {starters.map((s) => (
                  <button key={s} className="prodchat-chip" onClick={() => send(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="prodchat-msg user">{m.content}</div>
            ) : (
              <div
                key={i}
                className={'prodchat-msg assistant' + (m.isError ? ' error' : '')}
                dangerouslySetInnerHTML={renderMarkdown(m.content)}
              />
            )
          )}
          {busy && (
            <div className="prodchat-msg assistant thinking">
              <span className="dot" /><span className="dot" /><span className="dot" />
              <span className="thinking-label">{thinkingLabel}</span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="prodchat-inputbar"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={inputPlaceholder}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()}>Ask</button>
        </form>
      </div>
    </div>
  )
}
