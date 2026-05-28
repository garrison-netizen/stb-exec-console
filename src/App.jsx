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
  MOCK_DECISIONS,
  MOCK_INFO_EXTERNAL,
} from './state/mockData.js';

// Source Narrative Intake page — Architect's pointer for "tell the story".
const SOURCE_NARRATIVE_INTAKE_URL = 'https://www.notion.so/3651c57ac02b810eb1b4f724dec7c99d';

// Map a route-chip agent label to the Intake Queue `Routing tag` value.
// Architect extended Routing tag with "To: Architect" on 2026-05-28; other
// agent destinations land as he ships more options.
const AGENT_TO_ROUTING_TAG = {
  Architect: 'To: Architect',
};
const ROUTABLE_AGENTS = new Set(Object.keys(AGENT_TO_ROUTING_TAG));

// Agent Freshness staleness thresholds (hours since Last loaded).
const FRESH_HRS = 24;   // <24h → ok
const STALE_HRS = 120;  // 24–120h → stale; >120h or null → bad

function relAgeShort(iso) {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function freshnessState(iso) {
  if (!iso) return 'bad';
  const hrs = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hrs < FRESH_HRS) return 'ok';
  if (hrs < STALE_HRS) return 'stale';
  return 'bad';
}

// Best-effort mapping from Living Archive Tag set → the domain-colored left
// stripe class. First-match wins; defaults to brewery (most common).
function extraClassForTags(tags = []) {
  const tagSet = new Set(tags);
  if (tagSet.has('Coffee')) return 'dom-coffee';
  if (tagSet.has('THC')) return 'dom-thc';
  if (tagSet.has('Architecture')) return 'dom-system';
  return 'dom-brewery';
}

export default function App() {
  const [queue, setQueue] = useState(() => loadQueue());
  const [activeDomain, setActiveDomain] = useState('all');
  const [overlay, setOverlay] = useState({ open: false, payload: null });
  const [infoOpen, setInfoOpen] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  // Channel state is kept internal (no visible section) — used only to know
  // what Reconcile will touch and to count "pending" for the sidebar button.
  const [reconcileTargets, setReconcileTargets] = useState([]);

  // Agent Freshness — fetched from Agent Status DB (Architect 2026-05-28).
  const [freshness, setFreshness] = useState({ items: [], loading: true, error: null });

  // Source Narratives Needed — Living Archive rows with Needs narrative=true.
  const [sourceNarratives, setSourceNarratives] = useState({ items: [], loading: true, error: null });

  // Load channel items where Code is the recipient + status Unread (matches
  // the doctrinal narrow filter shipped earlier today).
  useEffect(() => {
    reloadReconcileTargets();
    reloadFreshness();
    reloadSourceNarratives();
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

  function reloadFreshness() {
    setFreshness((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/list?kind=agent_freshness&limit=25')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        const items = (d.items || []).map((a) => ({
          ...a,
          state: freshnessState(a.lastLoaded),
          ts: a.lastLoaded ? `${relAgeShort(a.lastLoaded)} ago` : 'never',
        }));
        setFreshness({ items, loading: false, error: null });
      })
      .catch((err) => setFreshness({ items: [], loading: false, error: err.message }));
  }

  function reloadSourceNarratives() {
    setSourceNarratives((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/list?kind=source_narratives_needed&limit=25')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setSourceNarratives({ items: d.items || [], loading: false, error: null });
      })
      .catch((err) => setSourceNarratives({ items: [], loading: false, error: err.message }));
  }

  // ─── Source Narrative actions ────────────────────────────────
  async function tellTheStory(item) {
    // Per Architect's mapping: row is already Needs narrative=true; the action
    // is navigating Garrison to the Source Narrative Intake page to write it.
    window.open(SOURCE_NARRATIVE_INTAKE_URL, '_blank', 'noopener,noreferrer');
  }

  async function dropNarrative(item) {
    if (!confirm(`Drop the source-narrative request for "${item.title}"?\n\nThe Living Archive row stays; only the narrative ask is unflagged.`)) return;
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionType: 'unmark_needs_narrative',
          pageId: item.id,
          note: `Source-narrative request dropped via Executive Console at ${new Date().toISOString()}. Garrison declined to author. Row preserved.`,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'unflag failed');
      reloadSourceNarratives();
    } catch (err) {
      alert(`Failed to drop: ${err.message}`);
    }
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

  // Send a captured thought to the Brain via the Intake Queue.
  // Only fires when the item's routedTo is in ROUTABLE_AGENTS — other chips
  // tag locally only, pending Architect's per-destination Routing tag entries.
  async function sendThoughtToBrain(id) {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    const routingTag = AGENT_TO_ROUTING_TAG[item.routedTo];
    if (!routingTag) {
      alert(`Can't send yet — "${item.routedTo}" isn't a live Brain destination. Only ${[...ROUTABLE_AGENTS].join(', ')} routable right now.`);
      return;
    }
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionType: 'general_note',
          title: item.text,
          body: `Captured via Executive Console on ${new Date(item.capturedAt).toISOString()}.\n\nDestination chip: ${item.routedTo}. Routing tag: ${routingTag}.`,
          routingTag,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'send failed');

      // Remove from local queue — the row lives in Brain now.
      setQueue(dismissThought(id));
      setOverlay({
        open: true,
        payload: {
          sectionTag: '💭 Sent to Brain',
          title: item.text,
          meta: {
            'Routed to': item.routedTo,
            'Routing tag': routingTag,
            Captured: relativeAge(item.capturedAt),
            'Sent at': new Date().toLocaleString(),
          },
          summary:
            `Created as an Intake Queue row, <code>Captured by = Console</code>, <code>Status = Pending review</code>. ${item.routedTo}'s next /refresh will surface it.`,
          actions: [
            { kind: 'primary', label: 'Open in Notion ↗', onClick: () => window.open(json.url, '_blank', 'noopener,noreferrer') },
            { kind: 'ghost', label: 'Close', onClick: () => setOverlay({ open: false, payload: null }) },
          ],
        },
      });
    } catch (err) {
      console.error('Send to Brain failed:', err);
      alert(`Failed to send: ${err.message}`);
    }
  }

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
    const successes = results.filter((r) => r.status === 'fulfilled' && r.value?.ok);
    const failures = results.filter((r) => r.status === 'rejected' || !r.value?.ok);

    // Push phase: write one Reconciliation Log entry summarizing what moved.
    // We log even on partial failure so the audit trail reflects what actually shipped.
    if (successes.length > 0) {
      try {
        const fromCounts = items.reduce((acc, it) => {
          const k = `${it.from} → ${it.to}`;
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {});
        const summary = Object.entries(fromCounts)
          .map(([k, v]) => `${v} ${k}`)
          .join('; ');
        await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submissionType: 'reconcile_log',
            capturedCountPushed: successes.length,
            itemsPerDestination: `${successes.length} channel ack${successes.length === 1 ? '' : 's'} (To:Code Unread → Acknowledged) — ${summary}`,
            reconciler: 'Garrison-via-Console',
            notes: failures.length ? `${failures.length} push failure(s) in same batch — see Console logs.` : '',
          }),
        });
      } catch (err) {
        console.error('Reconciliation Log write failed:', err);
      }
    }

    if (failures.length) {
      console.error('Reconcile failures:', failures);
      alert(
        `Reconciled ${items.length - failures.length} of ${items.length} items. ${failures.length} failed — see console.`
      );
    } else {
      alert(`Reconciled ${items.length} channel item${items.length === 1 ? '' : 's'}. Log entry written.`);
    }
    reloadReconcileTargets();
    setReconciling(false);
  }

  // Counts
  const queueCount = queue.length;
  const sourceCount = sourceNarratives.items.length;
  const decisionCount = MOCK_DECISIONS.length;
  const externalCount = MOCK_INFO_EXTERNAL.length;
  const totalNeedsYou = queueCount + sourceCount + decisionCount;
  // Real stale agent count from Agent Status DB (state !== 'ok').
  const staleAgentCount = freshness.items.filter((a) => a.state !== 'ok').length;

  return (
    <div className="grid">
      <Sidebar
        activeDomain={activeDomain}
        onDomainChange={setActiveDomain}
        status={{
          needYou: totalNeedsYou,
          queueCount,
          staleCount: staleAgentCount,
          lastReconciled: '3d', // mocked; surfacing from Reconciliation Log lands as a v2.4 polish
        }}
        freshness={freshness}
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
          onSendToBrain={sendThoughtToBrain}
          routableAgents={ROUTABLE_AGENTS}
          onOpenSummary={openSummaryForQueueItem}
        />

        <Section icon="📖" title="Source narratives needed" count={sourceCount}>
          {sourceNarratives.loading && <div className="loading">Loading from Living Archive…</div>}
          {sourceNarratives.error && (
            <div className="error">
              {sourceNarratives.error.includes('object_not_found') ? (
                <>
                  ⚠ The Living Archive database isn't shared with the Console integration yet.
                  <br />
                  <span style={{ fontSize: 12, opacity: 0.85 }}>
                    Open Living Archive in Notion → ⋯ menu → Connections → add <strong>STB Executive Console</strong>.
                    Same one-time grant needed for Reconciliation Log.
                  </span>
                </>
              ) : (
                <>⚠ {sourceNarratives.error}</>
              )}
            </div>
          )}
          {!sourceNarratives.loading && !sourceNarratives.error && sourceCount === 0 && (
            <div className="empty">No source narratives currently flagged.</div>
          )}
          {sourceNarratives.items.map((it) => {
            const ageDays = it.date
              ? Math.floor((Date.now() - new Date(it.date).getTime()) / 86_400_000)
              : null;
            const ageState = ageDays !== null && ageDays > 7 ? 'stale' : '';
            const ageLabel = ageDays === null ? 'no date' : ageDays === 0 ? 'today' : `${ageDays}d ago`;
            return (
              <Item
                key={it.id}
                extraClass={extraClassForTags(it.tags)}
                title={it.title || '(untitled Living Archive row)'}
                summaryId={it.id}
                onOpenSummary={() =>
                  setOverlay({
                    open: true,
                    payload: {
                      sectionTag: '📖 Source narrative needed',
                      title: it.title || '(untitled)',
                      meta: {
                        ...(it.type && { Type: it.type }),
                        ...(it.tags?.length && { Tags: it.tags.join(', ') }),
                        Date: it.date || '(no date)',
                        Destination: 'Living Archive (this row)',
                      },
                      summary:
                        'Architect flagged this Living Archive row as needing your first-person source narrative (Doctrine 3). Click <strong>Tell the story</strong> to open the Source Narrative Intake page; click <strong>Drop</strong> if you\'ll never author it.',
                      actions: [
                        { kind: 'primary', label: 'Tell the story ↗', onClick: () => tellTheStory(it) },
                        { kind: 'danger', label: 'Drop', onClick: () => { dropNarrative(it); setOverlay({ open: false, payload: null }); } },
                        { kind: 'ghost', label: 'Open row ↗', onClick: () => window.open(it.url, '_blank', 'noopener,noreferrer') },
                      ],
                    },
                  })
                }
                meta={
                  <>
                    {it.type && <span className="domain-badge stb">{it.type}</span>}
                    {it.tags?.slice(0, 3).map((t) => (
                      <span key={t} className="domain-badge stb">{t}</span>
                    ))}
                    <span>destination: Living Archive</span>
                    <span className="sep">·</span>
                    <span className={`age ${ageState}`}>{ageLabel}</span>
                  </>
                }
                actions={
                  <>
                    <button type="button" className="btn primary" onClick={() => tellTheStory(it)}>Tell the story ↗</button>
                    <button type="button" className="btn danger" onClick={() => dropNarrative(it)}>Drop</button>
                    <a className="btn ghost" href={it.url} target="_blank" rel="noreferrer">
                      Open in Notion <span className="btn-arrow">↗</span>
                    </a>
                  </>
                }
              />
            );
          })}
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
