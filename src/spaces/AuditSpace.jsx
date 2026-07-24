import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../Auth.jsx'

// Assistant Audit — Exec-only review of what the department assistants are
// being asked and where they fall down. Reads /api/dashboards?space=audit
// (lib/auditCore.js over the server-side query log).
//
// The report is cached for 12 hours; "Re-run now" forces a fresh pass.

const FLAG_LABELS = {
  failed: 'errored out',
  'query-errors': 'bad SQL',
  'tool-errors': 'tool error',
  'ran-out-of-time': 'ran out of time',
  'hit-research-limit': 'hit research limit',
  'no-answer': 'couldn’t answer',
  slow: 'slow',
  're-asked': 're-asked immediately',
}

const KIND_LABELS = {
  'data-gap': 'Data gap',
  findability: 'Can’t find it',
  bug: 'Bug',
  usage: 'Wrong room',
}

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—'

export default function AuditSpace() {
  const [model, setModel] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback((force) => {
    setLoading(true)
    setError(null)
    apiFetch('/api/dashboards?space=audit' + (force ? '&refresh=1' : ''))
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load the audit')
        setModel(data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(false)
  }, [load])

  return (
    <div className="dept">
      <header className="dept-banner">
        <h1>Assistant Audit</h1>
      </header>
      <div className="dept-main">
        <div className="dept-pane" style={{ display: 'flex' }}>
          <div className="pe-body">
            {error && (
              <div className="pe-error">
                <strong>Couldn’t load the audit.</strong> {error}
              </div>
            )}
            {!error && !model && <div className="pe-loading">Reading the query log…</div>}
            {model && (
              <>
                <div className="pe-asof">
                  {model.logging
                    ? `Last ${model.windowDays} days · report generated ${when(model.generatedAt)}${model.fromCache ? ' (cached)' : ''}`
                    : 'Query log unavailable in this environment'}{' '}
                  ·{' '}
                  <button className="pe-refresh" onClick={() => load(true)} disabled={loading}>
                    {loading ? 'Re-running…' : 'Re-run now'}
                  </button>
                </div>
                {model.logging ? <Report m={model} /> : <p className="pe-note">{model.note}</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Report({ m }) {
  if (!m.turnCount) {
    return (
      <p className="pe-note">
        No assistant questions logged in the last {m.windowDays} days. Logging started 2026-07-24 —
        anything asked before that was never recorded.
      </p>
    )
  }
  const syn = m.synthesis || {}
  return (
    <>
      <div className="pe-kpis">
        <div className="pe-kpi">
          <div className="pe-kpi-value">{m.turnCount}</div>
          <div className="pe-kpi-label">questions asked in the last {m.windowDays} days</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{m.cleanRate == null ? '—' : m.cleanRate + '%'}</div>
          <div className="pe-kpi-label">answered without a struggle signal</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{m.flagged}</div>
          <div className="pe-kpi-label">flagged for review</div>
        </div>
        <div className="pe-kpi">
          <div className="pe-kpi-value">{m.signals['re-asked'] || 0}</div>
          <div className="pe-kpi-label">answers a user immediately re-asked</div>
        </div>
      </div>

      {syn.headline && (
        <section className="pe-section">
          <h2>Read on the system</h2>
          <p className="audit-headline">{syn.headline}</p>
        </section>
      )}
      {syn.unavailable && <p className="pe-note">Theme synthesis unavailable — {syn.unavailable}</p>}

      {Array.isArray(syn.themes) && syn.themes.length > 0 && (
        <section className="pe-section">
          <h2>What it’s struggling with</h2>
          {syn.themes.map((t, i) => (
            <div key={i} className={'audit-theme sev-' + (t.severity || 'low')}>
              <div className="audit-theme-head">
                <span className={'audit-kind kind-' + (t.kind || 'usage')}>
                  {KIND_LABELS[t.kind] || t.kind}
                </span>
                <strong>{t.title}</strong>
                <span className="audit-theme-count">
                  {t.count} {t.count === 1 ? 'question' : 'questions'}
                  {t.spaces && t.spaces.length ? ' · ' + t.spaces.join(', ') : ''}
                </span>
              </div>
              <p className="audit-theme-what">{t.what_happened}</p>
              {Array.isArray(t.evidence) && t.evidence.length > 0 && (
                <ul className="audit-evidence">
                  {t.evidence.map((e, j) => (
                    <li key={j}>“{e}”</li>
                  ))}
                </ul>
              )}
              {t.fix && (
                <p className="audit-fix">
                  <strong>Fix:</strong> {t.fix}
                </p>
              )}
            </div>
          ))}
          {syn.false_positives && <p className="pe-note">Judged not a problem: {syn.false_positives}</p>}
          {syn.truncated && <p className="pe-note">{syn.truncated}</p>}
        </section>
      )}

      <section className="pe-section">
        <h2>Volume by assistant</h2>
        <table className="pe-table pe-table-narrow">
          <thead>
            <tr>
              <th>Assistant</th>
              <th className="num">Questions</th>
              <th className="num">Flagged</th>
            </tr>
          </thead>
          <tbody>
            {m.spaces.map((s, i) => (
              <tr key={i}>
                <td style={{ textTransform: 'capitalize' }}>{s.space}</td>
                <td className="num">{s.turns}</td>
                <td className="num">{s.flagged || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {m.users && m.users.length > 0 && (
          <>
            <h3>Who’s using them</h3>
            <table className="pe-table pe-table-narrow">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="num">Questions</th>
                  <th className="num">Flagged</th>
                </tr>
              </thead>
              <tbody>
                {m.users.map((u, i) => (
                  <tr key={i}>
                    <td className="ev" title={u.email}>{u.email}</td>
                    <td className="num">{u.turns}</td>
                    <td className="num">{u.flagged || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="pe-section">
        <h2>Signals</h2>
        <div className="audit-signals">
          {Object.entries(m.signals)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => (
              <span key={k} className="audit-signal">
                <strong>{n}</strong> {FLAG_LABELS[k] || k}
              </span>
            ))}
          {Object.values(m.signals).every((n) => !n) && (
            <span className="audit-signal">No struggle signals in this window.</span>
          )}
        </div>
      </section>

      {m.flaggedTurns.length > 0 && (
        <section className="pe-section">
          <h2>Every flagged question</h2>
          <p className="pe-note">
            Verbatim, so the themes above can be checked against what was actually asked.
          </p>
          {m.flaggedTurns.map((t, i) => (
            <div key={i} className="audit-turn">
              <div className="audit-turn-head">
                <span className="audit-turn-meta">
                  {when(t.at)} · {t.space} · {t.email || 'unknown'}
                </span>
                {t.flags.map((f) => (
                  <span key={f} className="audit-flag">{FLAG_LABELS[f] || f}</span>
                ))}
              </div>
              <p className="audit-q">{t.question}</p>
              {t.error && <p className="audit-err">Error: {t.error}</p>}
              {t.sqlErrors.map((e, j) => (
                <p key={j} className="audit-err">SQL: {e}</p>
              ))}
              {t.replyExcerpt && <p className="audit-a">{t.replyExcerpt}</p>}
            </div>
          ))}
        </section>
      )}

      {m.topics.length > 0 && (
        <section className="pe-section">
          <h2>What people ask about most</h2>
          <div className="audit-signals">
            {m.topics.map((t) => (
              <span key={t.label} className="audit-signal">
                <strong>{t.count}</strong> {t.label}
              </span>
            ))}
          </div>
          <p className="pe-note">
            Word frequency across every question, not just the flagged ones — a demand signal for
            what to build next.
          </p>
        </section>
      )}

      {m.note && <p className="pe-note">{m.note}</p>}
      <p className="pe-note pe-footer">
        Every assistant turn is logged server-side (question, answer, SQL run, timings). Flags are
        mechanical — a SQL error, a forced landing, a user re-asking within two minutes. Only the
        theme grouping is model-written.
      </p>
    </>
  )
}
