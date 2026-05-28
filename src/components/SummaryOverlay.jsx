// Modal overlay — bounded item detail interaction. The "rabbit-hole guardrail":
// click an item title, see context, decide, close — without losing your anchor
// on the inbox underneath.
export default function SummaryOverlay({ open, onClose, payload }) {
  if (!open || !payload) return null;

  function backdropClick(e) {
    if (e.target.classList.contains('overlay-backdrop')) onClose();
  }

  return (
    <div className="overlay-backdrop open" onClick={backdropClick}>
      <div className="overlay-card">
        <div className="overlay-head">
          <div className="overlay-head-left">
            <div className="overlay-section-tag">{payload.sectionTag}</div>
            <div className="overlay-title">{payload.title}</div>
          </div>
          <button
            type="button"
            className="overlay-close"
            onClick={onClose}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        <div className="overlay-body">
          {payload.meta && Object.keys(payload.meta).length > 0 && (
            <dl className="overlay-meta-grid">
              {Object.entries(payload.meta).map(([k, v]) => (
                <span key={k} style={{ display: 'contents' }}>
                  <dt>{k}</dt>
                  <dd dangerouslySetInnerHTML={{ __html: v }} />
                </span>
              ))}
            </dl>
          )}
          {payload.summary && (
            <div
              className="overlay-summary"
              dangerouslySetInnerHTML={{ __html: payload.summary }}
            />
          )}
        </div>

        {payload.actions && payload.actions.length > 0 && (
          <div className="overlay-actions">
            {payload.actions.map((a, i) => (
              <button
                key={i}
                type="button"
                className={`btn ${a.kind || 'ghost'}`}
                onClick={a.onClick}
              >
                {a.label}
              </button>
            ))}
            <div className="overlay-hint">
              <kbd>Esc</kbd> to close
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
