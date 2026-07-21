import React, { useState, useRef, useEffect } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { apiFetch, currentEmail } from '../Auth.jsx'

// Production space: chat over the Ekos mirror (read-only analyst), with a
// Claude-style conversation log. Conversations persist per-user in this
// browser (localStorage keyed by the signed-in email) — nothing chat-related
// is stored server-side.

// Pool of starter questions; each fresh conversation deals a random six so
// the welcome screen stays lively and teaches the bot's range over time.
const STARTER_POOL = [
  // Inventory
  'What finished beer is on hand right now?',
  'What inventory is expiring in the next 60 days?',
  'What is our total inventory value by category?',
  'What is sitting in WIP right now?',
  'How much packaging inventory do we have on hand?',
  // Production
  'Which batches are in progress?',
  'What did we finish brewing last month?',
  'How does Houston Haze production this year compare to last?',
  'How have yields trended on Heavy Hands batches?',
  'How many barrels have we produced this year?',
  // Losses
  'What did we lose to breakage and spoilage this quarter, in dollars?',
  'How are losses trending month by month this year?',
  'Which items have we destroyed or written off most this year?',
  // Purchasing
  'What POs are still open and when do they land?',
  'How have hop prices trended over the last two years?',
  'Who are our top vendors by spend this year?',
  // Sales out the door
  'Top sellers this year by revenue?',
  'How do taproom sales compare to wholesale this year?',
  'How is the coffee line performing this year?',
]

function dealStarters() {
  const pool = [...STARTER_POOL]
  const hand = []
  while (hand.length < 6 && pool.length) {
    hand.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  }
  return hand
}

const MAX_CONVOS = 30
const MAX_MESSAGES = 80

function storageKey() {
  return 'stb_prodchat::' + (currentEmail() || 'dev').toLowerCase()
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

export default function ProductionChat() {
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
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: convo.messages }),
      })
      const data = await res.json()
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
            <h1>Production Assistant</h1>
            <p className="prodchat-sub">
              Ask about inventory, batches, yields, losses, purchasing, and sales —
              answers come straight from Ekos data.
              {dataAsOf ? ` Data as of ${String(dataAsOf).slice(0, 16).replace('T', ' ')} UTC.` : ''}
            </p>
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
              <span className="thinking-label">Checking the numbers…</span>
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
            placeholder="Ask a production question…"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()}>Ask</button>
        </form>
      </div>
    </div>
  )
}
