import React, { useState, useRef, useEffect } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { apiFetch } from '../Auth.jsx'

// Production space: chat over the Ekos mirror (read-only analyst).
// The EOD dashboard iterates into this space next.

const STARTERS = [
  'What finished beer is on hand right now?',
  'Top sellers this year by revenue?',
  'What did we lose to breakage and spoilage this quarter, in dollars?',
  'Which batches are in progress?',
  'What POs are still open and when do they land?',
  'How does Houston Haze production this year compare to last?',
]

function renderMarkdown(text) {
  return { __html: DOMPurify.sanitize(marked.parse(text || '')) }
}

export default function ProductionChat() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [dataAsOf, setDataAsOf] = useState(null)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  async function send(text) {
    const question = (text || input).trim()
    if (!question || busy) return
    const next = [...messages, { role: 'user', content: question }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Something went wrong')
      setMessages([...next, { role: 'assistant', content: data.reply }])
      if (data.dataAsOf) setDataAsOf(data.dataAsOf)
    } catch (err) {
      setMessages([
        ...next,
        { role: 'assistant', content: '⚠️ ' + err.message, isError: true },
      ])
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="prodchat">
      <header className="prodchat-head">
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
        {messages.length === 0 && (
          <div className="prodchat-welcome">
            <p>Try one of these to get started:</p>
            <div className="prodchat-chips">
              {STARTERS.map((s) => (
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
  )
}
