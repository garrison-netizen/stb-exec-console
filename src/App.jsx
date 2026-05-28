import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Hero from './components/Hero.jsx';
import Section from './components/Section.jsx';
import Item from './components/Item.jsx';
import YourQueueSection from './components/YourQueueSection.jsx';
import CaptureBar from './components/CaptureBar.jsx';
import SummaryOverlay from './components/SummaryOverlay.jsx';
import {
  loadQueue,
  addThought,
  routeThought,
  dismissThought,
  relativeAge,
} from './state/queue.js';
import {
  MOCK_SOURCE_NARRATIVES,
  MOCK_DECISIONS,
  MOCK_INFO_EXTERNAL,
} from './state/mockData.js';

export default function App() {
  const [queue, setQueue] = useState(() => loadQueue());
  const [activeDomain, setActiveDomain] = useState('all');
  const [overlay, setOverlay] = useState({ open: false, payload: null });
  const [infoOpen, setInfoOpen] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  // Channel state is kept internal (no visible section) — used only to know
  // what Reconcile will touch and to count "pending" for the sidebar button.
  const [reconcileTargets, setReconcileTargets] = useState([]);

  // Load channel items where Code is the recipient + status Unread (matches
  // the doctrinal narrow filter shipped earlier today).
  useEffect(() => {
    reloadReconcileTargets();
  }, []);

  function reloadReconcileTargets() {
    fetch('/api/list?kind=channel_recent&limit=25')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        const filtered = (d.items || []).filter(
          (it) =>
            (it.type === 'Question' || it.type === 'Action requested') &&
            it.status === 'Unread' &&
            it.to === 'Code'
        );
        setReconcileTargets(filtered);
      })
      .catch(() => {});
  }

  // Esc closes overlay
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setOverlay({ open: false, payload: null });
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function capture(text) { setQueue(addThought(text)); }
  function route(id, agent) {
    const item = queue.find((q) => q.id === id);
    const next = item?.routedTo === agent ? null : agent;
    setQueue(routeThought(id, next));
  }
  function dismiss(id) { setQueue(dismissThought(id)); }

  function openSummaryForQueueItem(id) {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    setOverlay({
      open: true,
      payload: {
        sectionTag: '💭 Your captured thought',
        title: item.text,
        meta: {
          Captured: relativeAge(item.capturedAt),
          'Routed for': item.routedTo || 'Unrouted — sitting until you decide',
          Source: 'You (this Console)',
        },
        summary: item.routedTo
          ? `Routed to <strong>${item.routedTo}</strong>. Your next ${item.routedTo} session will see this as starting context (mechanism TBD pending Architect's routing call).`
          : `Sitting unrouted. Pick a destination via the route chips on the item.`,
        actions: [
          { kind: 'ghost', label: 'Edit thought (v2)', onClick: () => alert('Edit lands in v2.') },
          {
            kind: 'danger',
            label: 'Dismiss',
            onClick: () => {
              dismiss(item.id);
              setOverlay({ open: false, payload: null });
            },
          },
        ],
      },
    });
  }

  function openSummaryForMock(item, sectionTag) {
    setOverlay({
      open: true,
      payload: {
        sectionTag,
        title: item.title,
        meta: {
          ...(item.destination && { Destination: item.destination }),
          ...(item.by && { Author: item.by }),
          ...(item.age && {
            Age: item.ageState === 'stale' ? `<span class="age-stale">${item.age}</span>` : item.age,
          }),
          ...(item.note && { Note: item.note }),
        },
        summary:
          '<em>This item is currently mocked. Real data wiring is pending Architect schema work — see the project memory file for which schema additions are owed.</em>',
        actions: [{ kind: 'ghost', label: 'Close' }],
      },
    });
  }

  async function onReconcile() {
    if (reconcileTargets.length === 0 || reconciling) return;
    setReconciling(true);
    const items = reconcileTargets;
    const acknowledgedAt = new Date().toISOString();
    const results = await Promise.allSettled(
      items.map((it) =>
        fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submissionType: 'status_update',
            pageId: it.id,
            newStatus: 'Acknowledged',
            note: `Acknowledged by Garrison via Executive Console at ${acknowledgedAt}. Code marked this on its own queue per ADR-003 / Doctrine 8 — no agent reply composed.`,
          }),
        }).then((r) => r.json())
      )
    );
    const failures = results.filter((r) => r.status === 'rejected' || !r.value?.ok);
    if (failures.length) {
      console.error('Reconcile failures:', failures);
      alert(
        `Reconciled ${items.length - failures.length} of ${items.length} items. ${failures.length} failed — see console.`
      );
    } else {
      alert(`Reconciled ${items.length} channel item${items.length === 1 ? '' : 's'}.`);
    }
    reloadReconcileTargets();
    setReconciling(false);
  }

  // Counts
  const queueCount = queue.length;
  const sourceCount = MOCK_SOURCE_NARRATIVES.length;
  const decisionCount = MOCK_DECISIONS.length;
  const externalCount = MOCK_INFO_EXTERNAL.length;
  const totalNeedsYou = queueCount + sourceCount + decisionCount;
  // Mocked freshness count — count stale agents (state !== 'ok')
  const staleAgentCount = 4; // mocked; real count once freshness wires

  return (
    <div className="grid">
      <Sidebar
        activeDomain={activeDomain}
        onDomainChange={setActiveDomain}
        status={{
          needYou: totalNeedsYou,
          queueCount,
          staleCount: staleAgentCount,
          lastReconciled: '3d', // mocked; real value once Reconciliation Log lands
        }}
        onReconcile={onReconcile}
        reconciling={reconciling}
        reconcilePending={reconcileTargets.length}
      />

      <main className="main">
        <Hero
          count={totalNeedsYou}
          queueCount={queueCount}
          sourceCount={sourceCount}
          decisionCount={decisionCount}
          externalCount={externalCount}
          lastReconciled="3d ago"
        />

        <YourQueueSection
          items={queue}
          onCapture={capture}
          onRoute={route}
          onDismiss={dismiss}
          onOpenSummary={openSummaryForQueueItem}
        />

        <Section icon="📖" title="Source narratives needed" count={sourceCount} mocked>
          {MOCK_SOURCE_NARRATIVES.map((it) => (
            <Item
              key={it.id}
              extraClass="dom-brewery"
              title={it.title}
              summaryId={it.id}
              onOpenSummary={() => openSummaryForMock(it, '📖 Source narrative needed')}
              meta={
                <>
                  {it.domainLabel && (
                    <span className={`domain-badge ${it.domainTone || 'stb'}`}>{it.domainLabel}</span>
                  )}
                  <span>{it.meta}</span>
                  <span className="sep">·</span>
                  <span>destination: {it.destination}</span>
                  <span className="sep">·</span>
                  <span className={`age ${it.ageState || ''}`}>{it.age}</span>
                </>
              }
              actions={
                <>
                  <button type="button" className="btn primary">Tell the story</button>
                  <button type="button" className="btn secondary">Defer 7d</button>
                  <button type="button" className="btn danger">Drop</button>
                  <button type="button" className="btn ghost">
                    Open in Notion <span className="btn-arrow">↗</span>
                  </button>
                </>
              }
            />
          ))}
        </Section>

        <Section icon="⚖️" title="Decisions pending your call" count={decisionCount} mocked>
          {MOCK_DECISIONS.map((it) => (
            <Item
              key={it.id}
              urgency={it.urgency}
              extraClass={it.domainTone === 'stb' && it.domainLabel?.includes('System') ? 'dom-system' : 'dom-brewery'}
              title={it.title}
              summaryId={it.id}
              onOpenSummary={() => openSummaryForMock(it, '⚖️ Decision pending your call')}
              meta={
                <>
                  {it.domainLabel && (
                    <span className={`domain-badge ${it.domainTone || 'stb'}`}>{it.domainLabel}</span>
                  )}
                  <span>{it.by}</span>
                  {it.posted && (
                    <>
                      <span className="sep">·</span>
                      <span>{it.posted}</span>
                    </>
                  )}
                  {it.note && (
                    <>
                      <span className="sep">·</span>
                      <span className={it.ageState ? `age ${it.ageState}` : undefined}>{it.note}</span>
                    </>
                  )}
                  {it.age && !it.note && (
                    <>
                      <span className="sep">·</span>
                      <span className={`age ${it.ageState || ''}`}>{it.age}</span>
                    </>
                  )}
                </>
              }
              actions={
                <>
                  <button type="button" className="btn primary">Approve</button>
                  <button type="button" className="btn secondary">Modify</button>
                  <button type="button" className="btn danger">Reject</button>
                  <button type="button" className="btn ghost">
                    Open <span className="btn-arrow">↗</span>
                  </button>
                </>
              }
            />
          ))}
        </Section>

        <div className={`info-section ${infoOpen ? 'open' : ''}`}>
          <div className="info-header" onClick={() => setInfoOpen((s) => !s)}>
            <span className="section-icon" style={{ fontSize: 14 }}>ℹ️</span>
            <span className="info-title">
              Was you, now external — {externalCount} item{externalCount === 1 ? '' : 's'} waiting on providers
            </span>
            <span className="mocked-tag" title="Mock — query against Pending Work pending">mock</span>
            <span className="section-chevron" style={{ marginLeft: 'auto' }}>
              {infoOpen ? '▲' : '▼'}
            </span>
          </div>
          {infoOpen && (
            <div className="info-list">
              {MOCK_INFO_EXTERNAL.map((i) => (
                <div key={i.id} className="info-row">
                  <span>{i.text}</span>
                  <span className="external">{i.external}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <nav className="secondary-nav">
          <a href="#" onClick={(e) => e.preventDefault()} title="v2 — full Brain browse + the legacy submission form">Browse Brain</a>
          <a href="#" onClick={(e) => e.preventDefault()} title="v2 — full activity timeline">Recent activity</a>
          <a href="#" onClick={(e) => e.preventDefault()} title="v2 — health + last-active for each agent">Agent status</a>
          <a href="#" onClick={(e) => e.preventDefault()} title="v2 — Console preferences + domain editor">Settings</a>
        </nav>
      </main>

      <SummaryOverlay
        open={overlay.open}
        onClose={() => setOverlay({ open: false, payload: null })}
        payload={overlay.payload}
      />

      <CaptureBar onCapture={capture} />
    </div>
  );
}
