import { MOCK_ROCKS, DOMAINS, MOCK_AGENT_FRESHNESS } from '../state/mockData.js';

// Persistent left sidebar — the visibility layer Garrison wants Reconcile to
// anchor against. Brand → Rocks → Focus filter → System Status → Agent
// Freshness → Reconcile button (anchored bottom).
//
// Most data is MOCK for v1; real wiring depends on the multi-agent freshness
// contract extension owed by Architect (proposal sent 2026-05-28).
export default function Sidebar({
  activeDomain,
  onDomainChange,
  status, // { needYou, queueCount, staleCount, lastReconciled }
  onReconcile,
  reconciling,
  reconcilePending, // number of items reconcile will actually touch
}) {
  return (
    <aside className="side">
      <div className="brand">
        <div className="word">SPINDLETAP</div>
        <div className="name">Executive Console</div>
        <div className="brain-pill" title="Notion canonical schema v4.6 — locked 2026-05-27">
          <span className="dot" />
          BRAIN v4.6 LIVE
        </div>
      </div>

      <div>
        <div className="panel-head">
          <span className="icon">🎯</span>Q2 Rocks
          <span className="mocked-tag" style={{ marginLeft: 'auto' }} title="Mock — DB structure pending Architect">mock</span>
        </div>
        <ul className="rocks-list">
          {MOCK_ROCKS.map((r) => (
            <li key={r.id}>
              <span className="emoji">{r.emoji}</span>
              <span className="meta">
                <span className="dom">{r.domain}</span>
                <span className="text">{r.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="panel-head">Focus</div>
        <div className="filter-chips">
          <button
            type="button"
            className={`fchip ${activeDomain === 'all' ? 'on' : ''}`}
            onClick={() => onDomainChange?.('all')}
          >
            All
          </button>
          {DOMAINS.STB.sub.map((s) => (
            <button
              key={`stb-${s}`}
              type="button"
              className={`fchip ${activeDomain === s ? 'on' : ''}`}
              onClick={() => onDomainChange?.(s)}
            >
              <span className="sw" style={{ background: swatchFor(s) }} />
              {s}
            </button>
          ))}
          {DOMAINS.Personal.sub.map((s) => (
            <button
              key={`p-${s}`}
              type="button"
              className={`fchip ${activeDomain === s ? 'on' : ''}`}
              onClick={() => onDomainChange?.(s)}
            >
              <span className="sw" style={{ background: swatchFor(s) }} />
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="panel-head">System Status</div>
        <div className="stat-grid">
          <div className="stat">
            <div className="v gold">{status.needYou}</div>
            <div className="l">need you</div>
          </div>
          <div className="stat">
            <div className="v purple">{status.queueCount}</div>
            <div className="l">queue</div>
          </div>
          <div className="stat">
            <div className={`v ${status.staleCount > 0 ? 'bad' : 'ok'}`}>{status.staleCount}</div>
            <div className="l">stale &gt;5d</div>
          </div>
          <div className="stat">
            <div className="v ok">{status.lastReconciled}</div>
            <div className="l">last recon.</div>
          </div>
        </div>
      </div>

      <div>
        <div className="panel-head">
          Agent Freshness
          <span className="mocked-tag" style={{ marginLeft: 'auto' }} title="Mock — freshness contract pending Architect">mock</span>
        </div>
        <ul className="agents-list">
          {MOCK_AGENT_FRESHNESS.map((a) => (
            <li key={a.name} className={a.state}>
              <span className="ag">{a.name}</span>
              <span className="ts">{a.ts}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        className="reconcile"
        onClick={onReconcile}
        disabled={reconciling || reconcilePending === 0}
        title={reconcilePending === 0 ? 'Nothing to reconcile' : `Acknowledge ${reconcilePending} Code-queue item${reconcilePending === 1 ? '' : 's'}`}
      >
        <div className="top">
          <span className="bolt">⚡</span>
          {reconciling ? 'Reconciling…' : 'Reconcile'}
        </div>
        <span className="sub">
          {reconcilePending > 0
            ? `${reconcilePending} pending · push · pull · surface`
            : 'all clear'}
        </span>
      </button>
    </aside>
  );
}

// Domain swatch colors (must match --d-* CSS vars for consistency).
function swatchFor(name) {
  const map = {
    Brewery: 'var(--d-brewery)',
    Coffee: 'var(--d-coffee)',
    Texzas: 'var(--d-texzas)',
    THC: 'var(--d-thc)',
    Family: 'var(--d-family)',
    'Health/Fitness': 'var(--d-health)',
    Hobbies: 'var(--d-hobbies)',
    Spiritual: 'var(--d-spiritual)',
    Language: 'var(--d-language)',
    'Side hustles': 'var(--d-side)',
  };
  return map[name] || 'var(--text-faint)';
}
