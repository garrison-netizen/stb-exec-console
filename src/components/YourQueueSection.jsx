import { useState } from 'react';
import Item from './Item.jsx';
import { ROUTING_AGENTS } from '../state/mockData.js';
import { relativeAge } from '../state/queue.js';

// "Your captured thoughts" — the purple-accented section. Inline capture form
// pins to the localStorage queue; per-item route chips assign an agent
// destination (writes to Brain pending Architect's call on routing mechanism).
export default function YourQueueSection({
  items,
  onCapture,
  onRoute,
  onDismiss,
  onOpenSummary,
}) {
  const [draft, setDraft] = useState('');

  function submit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onCapture(text);
    setDraft('');
  }

  return (
    <div className="section your-queue">
      <div className="section-header">
        <span className="section-icon">💭</span>
        <span className="section-title">Your captured thoughts</span>
        <span className="section-count yours">{items.length}</span>
        <span
          className="mocked-tag"
          title="Local-only for v1 — Brain-side queue schema pending Architect's routing mechanism call"
        >
          local
        </span>
        <div className="section-divider" />
        <span className="section-chevron">▼</span>
      </div>

      <form className="capture-inline" onSubmit={submit}>
        <input
          type="text"
          className="capture-inline-input"
          placeholder="Pin a thought for later — type and hit enter…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="capture-inline-send">+ Pin</button>
      </form>

      <div className="items">
        {items.length === 0 && (
          <div className="empty">
            Your queue is clear. Capture a thought above or in the bottom bar.
          </div>
        )}
        {items.map((it) => (
          <Item
            key={it.id}
            extraClass="your-item"
            title={it.text}
            summaryId={it.id}
            onOpenSummary={onOpenSummary}
            meta={
              <>
                <span>captured {relativeAge(it.capturedAt)}</span>
                <span className="sep">·</span>
                <span>
                  {it.routedTo
                    ? `tagged for: ${it.routedTo}`
                    : 'unrouted — sitting until you decide'}
                </span>
              </>
            }
            actions={
              <>
                <div className="route-chips">
                  <span className="route-label">Route to:</span>
                  {ROUTING_AGENTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={`chip-route ${it.routedTo === a ? 'active' : ''}`}
                      onClick={() => onRoute(it.id, a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => onDismiss(it.id)}
                >
                  Dismiss
                </button>
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}
