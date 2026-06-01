import { useState } from 'react';
import Item from './Item.jsx';
import { relativeAge } from '../state/queue.js';

// "Your captured thoughts" — the purple-accented section. Inline capture form
// pins to the localStorage queue; per-item destination chips select either
// GTD (Capture Inbox) or Brain (Intake Queue, To: Architect). Send fires the
// real write per ADR-006 §6 split rule.
export default function YourQueueSection({
  items,
  onCapture,
  onRoute,
  onDismiss,
  onSend,
  destinations, // { GTD: {...}, Brain: {...} } from App.jsx DESTINATIONS
  onOpenSummary,
}) {
  const [draft, setDraft] = useState('');
  const destList = Object.values(destinations || {});

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
          title="Local drafts; Send pushes to the chosen destination per ADR-006 §6 split rule."
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
        {items.map((it) => {
          const dest = destinations?.[it.routedTo];
          return (
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
                    {dest
                      ? `tagged for: ${dest.emoji} ${dest.label} — ${dest.sublabel}`
                      : 'unrouted — pick Action or Brain'}
                  </span>
                </>
              }
              actions={
                <>
                  <div className="route-chips">
                    <span className="route-label">Destination:</span>
                    {destList.map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        className={`chip-route ${it.routedTo === d.key ? 'active' : ''}`}
                        onClick={() => onRoute(it.id, d.key)}
                        title={d.tooltip}
                      >
                        {d.emoji} {d.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!it.routedTo}
                    onClick={() => onSend?.(it.id)}
                    title={
                      !it.routedTo
                        ? 'Pick Action or Brain first'
                        : `Send to ${destinations[it.routedTo]?.label} now`
                    }
                  >
                    Send{dest ? ` → ${dest.label}` : ''}
                  </button>
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
          );
        })}
      </div>
    </div>
  );
}
