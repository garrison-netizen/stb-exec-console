import { useEffect, useState } from 'react';
import { apiFetch } from './Auth.jsx';

// Generic list view: fetches /api/list?kind=... and renders rows via renderRow
function ListView({ kind, renderRow, emptyMessage = 'Nothing here yet.', limit }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setError(null);
    const url = `/api/list?kind=${encodeURIComponent(kind)}${limit ? `&limit=${limit}` : ''}`;
    apiFetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setItems(d.items);
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [kind, limit]);

  if (error) return <div className="error">⚠ {error}</div>;
  if (items === null) return <div className="loading">Loading…</div>;
  if (items.length === 0) return <div className="empty">{emptyMessage}</div>;

  return <div className="list">{items.map((it) => renderRow(it))}</div>;
}

// ─── Activity (Console submissions) ─────────────────────────
export function ActivityView() {
  return (
    <ListView
      kind="console_submissions"
      emptyMessage="No submissions from the console yet."
      renderRow={(it) => (
        <a key={it.id} href={it.url} target="_blank" rel="noreferrer" className="row">
          <div className="row-main">
            <div className="row-title">{it.summary || '(untitled)'}</div>
            <div className="row-meta">
              <span className={`pill status-${(it.status || '').replace(/\s+/g, '-').toLowerCase()}`}>
                {it.status}
              </span>
              {it.routingTag && <span className="pill">{it.routingTag}</span>}
              {it.type && <span className="pill ghost">{it.type}</span>}
              <span className="date">{it.dateLogged}</span>
            </div>
          </div>
        </a>
      )}
    />
  );
}

// ─── Active PINs ────────────────────────────────────────────
export function PinsView() {
  return (
    <ListView
      kind="active_pins"
      emptyMessage="No active PINs."
      renderRow={(it) => (
        <a key={it.id} href={it.url} target="_blank" rel="noreferrer" className="row">
          <div className="row-main">
            <div className="row-title">📌 {it.summary}</div>
            <div className="row-meta">
              <span className={`pill status-${(it.status || '').replace(/\s+/g, '-').toLowerCase()}`}>
                {it.status}
              </span>
              {it.routingTag && it.routingTag !== 'Undecided' && (
                <span className="pill">{it.routingTag}</span>
              )}
              {it.capturedBy && <span className="pill ghost">by {it.capturedBy}</span>}
              <span className="date">{it.dateLogged}</span>
            </div>
          </div>
        </a>
      )}
    />
  );
}

// ─── Open Questions ─────────────────────────────────────────
export function QuestionsView() {
  return (
    <ListView
      kind="open_questions"
      emptyMessage="No open questions."
      renderRow={(it) => (
        <a key={it.id} href={it.url} target="_blank" rel="noreferrer" className="row">
          <div className="row-main">
            <div className="row-title">❓ {it.question}</div>
            {it.whyItMatters && <div className="row-sub">{it.whyItMatters}</div>}
            <div className="row-meta">
              <span className={`pill status-${(it.status || '').replace(/\s+/g, '-').toLowerCase()}`}>
                {it.status}
              </span>
              {it.domains.map((d) => (
                <span key={d} className="pill ghost">
                  {d}
                </span>
              ))}
              <span className="date">{it.logged}</span>
            </div>
          </div>
        </a>
      )}
    />
  );
}

// ─── Channel ────────────────────────────────────────────────
export function ChannelView() {
  return (
    <ListView
      kind="channel_recent"
      emptyMessage="Channel is quiet."
      renderRow={(it) => (
        <a key={it.id} href={it.url} target="_blank" rel="noreferrer" className="row">
          <div className="row-main">
            <div className="row-title">
              <span className="agent-tag">{it.from}</span>
              <span className="arrow">→</span>
              <span className="agent-tag">{it.to}</span>
              <span className="row-subject">{it.subject}</span>
            </div>
            <div className="row-meta">
              <span className={`pill type-${(it.type || '').replace(/\s+/g, '-').toLowerCase()}`}>
                {it.type}
              </span>
              <span className={`pill status-${(it.status || '').replace(/\s+/g, '-').toLowerCase()}`}>
                {it.status}
              </span>
              <span className="date">{it.dateSent}</span>
            </div>
          </div>
        </a>
      )}
    />
  );
}

// ─── Pending Work ───────────────────────────────────────────
export function PendingWorkView() {
  return (
    <ListView
      kind="pending_work"
      emptyMessage="No pending work."
      renderRow={(it) => (
        <a key={it.id} href={it.url} target="_blank" rel="noreferrer" className="row">
          <div className="row-main">
            <div className="row-title">{it.title}</div>
            <div className="row-meta">
              <span className={`pill status-${(it.status || '').replace(/\s+/g, '-').toLowerCase()}`}>
                {it.status}
              </span>
              {it.workstream && <span className="pill">{it.workstream}</span>}
              {it.priority && <span className="pill priority">{it.priority}</span>}
              {it.heldFor && it.heldFor !== 'None' && (
                <span className="pill ghost">held: {it.heldFor}</span>
              )}
            </div>
          </div>
        </a>
      )}
    />
  );
}
