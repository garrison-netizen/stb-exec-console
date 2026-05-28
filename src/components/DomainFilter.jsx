import { DOMAINS } from '../state/mockData.js';

// Domain filter — extensible taxonomy. v1 manages active domain in App state;
// items will filter on `active` in v2 once each item carries a domain.
export default function DomainFilter({ active, onChange }) {
  return (
    <div className="domain-bar">
      <span className="domain-label">Focus:</span>
      <button
        type="button"
        className={`domain-chip ${active === 'all' ? 'active' : ''}`}
        onClick={() => onChange?.('all')}
      >
        All domains
      </button>
      {Object.entries(DOMAINS).map(([key, { label }]) => (
        <button
          key={key}
          type="button"
          className={`domain-chip ${active === key ? 'active' : ''}`}
          onClick={() => onChange?.(key)}
        >
          {label} <span className="caret">▾</span>
        </button>
      ))}

      <div className="domain-sublist">
        <span className="domain-sublabel">STB:</span>
        {DOMAINS.STB.sub.map((s) => (
          <button
            key={s}
            type="button"
            className={`domain-subchip ${active === s ? 'active' : ''}`}
            onClick={() => onChange?.(s)}
          >
            {s}
          </button>
        ))}
        <span className="domain-sublabel" style={{ marginLeft: 14 }}>Personal:</span>
        {DOMAINS.Personal.sub.map((s) => (
          <button
            key={s}
            type="button"
            className={`domain-subchip ${active === s ? 'active' : ''}`}
            onClick={() => onChange?.(s)}
          >
            {s}
          </button>
        ))}
        <button type="button" className="domain-subchip add" title="Domain editor lands in v2">+ add domain</button>
      </div>
    </div>
  );
}
