import { DOMAINS, MOCK_AGENT_FRESHNESS } from '../state/mockData.js';

// Rock status → dot glyph. Company Rocks DB is the single shared Rocks
// surface (Architect 2026-05-28); the strip is Tier-filtered server-side.
const ROCK_STATUS_DOT = {
  'On Track': '🟢',
  'Off Track': '🔴',
  Done: '✅',
  'Not Started': '⚪',
};

// Persistent left sidebar — the visibility layer Garrison wants Reconcile to
// anchor against. Brand → Rocks → Focus filter → System Status → Agent
// Freshness → Reconcile button (anchored bottom).
//
// Rocks reads Company Rocks live as of 2026-07-09. Agent Freshness reads
// Agent Status DB live as of 2026-05-28.
export default function Sidebar({
  activeDomain,
  onDomainChange,
  status, // { needYou, queueCount, staleCount, lastReconciled }
  rocks, // { items: [{rock,status,quarter,owner,percentComplete}], loading, error }
  freshness, // { items: [{agent,lastLoaded,lastLoadedContext,state,ts}], loading, error }
  onReconcile,
  reconciling,
  reconcilePending, // number of items reconcile will actually touch
}) {
  const freshnessRows = freshness?.items || [];
  const freshnessLoading = freshness?.loading;
  const freshnessError = freshness?.error;
  const showMock = !freshnessRows.length && !freshnessLoading;

  const rockItems = rocks?.items || [];
  const rocksLoading = rocks?.loading;
  const rocksError = rocks?.error || '';
  const rockQuarters = [...new Set(rockItems.map((r) => r.quarter).filter(Boolean))];
  const rocksLabel = rockQuarters.length === 1 ? `${rockQuarters[0]} Rocks` : 'Rocks';
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
          <span className="icon">🎯</span>{rocksLabel}
          {rocksLoading && (
            <span className="mocked-tag" style={{ marginLeft: 'auto' }} title="Loading from Company Rocks">…</span>
          )}
        </div>
        {rocksError && (
          <div className="error" style={{ fontSize: 11 }}>
            {rocksError.includes('object_not_found') ? (
              <>
                ⚠ Company Rocks isn't shared with the Console integration yet.
                <br />
                <span style={{ fontSize: 10, opacity: 0.85 }}>
                  Open Company Rocks in Notion → ⋯ → Connections → add <strong>STB Executive Console</strong>.
                </span>
              </>
            ) : (
              <>⚠ {rocksError}</>
            )}
          </div>
        )}
        <ul className="rocks-list">
          {rockItems.map((r) => {
            const pct = typeof r.percentComplete === 'number'
              ? `${Math.round(r.percentComplete > 1 ? r.percentComplete : r.percentComplete * 100)}%`
              : null;
            const sub = [r.owner, pct].filter(Boolean).join(' · ');
            return (
              <li key={r.id} title={[r.status, r.quarter].filter(Boolean).join(' · ')}>
                <span className="emoji">{ROCK_STATUS_DOT[r.status] || '⚪'}</span>
                <span className="meta">
                  {sub && <span className="dom">{sub}</span>}
                  <span className="text">{r.rock}</span>
                </span>
              </li>
            );
          })}
          {!rocksLoading && !rocksError && rockItems.length === 0 && (
            <li>
              <span className="meta">
                <span className="text" style={{ opacity: 0.7 }}>No Company Rocks defined yet.</span>
              </span>
            </li>
          )}
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
          {showMock && (
            <span className="mocked-tag" style={{ marginLeft: 'auto' }} title="Agent Status DB unreachable — showing mock">mock</span>
          )}
          {freshnessLoading && (
            <span className="mocked-tag" style={{ marginLeft: 'auto' }} title="Loading from Agent Status DB">…</span>
          )}
        </div>
        {freshnessError && <div className="error" style={{ fontSize: 11 }}>⚠ {freshnessError}</div>}
        <ul className="agents-list">
          {(freshnessRows.length ? freshnessRows : MOCK_AGENT_FRESHNESS).map((a) => (
            <li key={a.agent || a.name} className={a.state}>
              <span className="ag">{a.agent || a.name}</span>
              <span className="ts" title={a.lastLoadedContext || ''}>{a.ts}</span>
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
