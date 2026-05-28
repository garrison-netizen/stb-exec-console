// Generic section shell — header + items area. Used by Source narratives,
// Decisions, Channel relay. YourQueueSection has its own variant with the
// inline capture form.
export default function Section({ icon, title, count, countTone, children, mocked = false }) {
  return (
    <div className="section">
      <div className="section-header">
        <span className="section-icon">{icon}</span>
        <span className="section-title">{title}</span>
        {typeof count === 'number' && (
          <span className={`section-count ${countTone || ''}`}>{count}</span>
        )}
        {mocked && (
          <span className="mocked-tag" title="Placeholder data — real wiring pending Architect schema">
            🧪 mock
          </span>
        )}
        <div className="section-divider" />
        <span className="section-chevron">▼</span>
      </div>
      <div className="items">{children}</div>
    </div>
  );
}
