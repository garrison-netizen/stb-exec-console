import { useEffect, useState } from 'react';
import Header from './components/Header.jsx';
import RocksStrip from './components/RocksStrip.jsx';
import DomainFilter from './components/DomainFilter.jsx';
import Hero from './components/Hero.jsx';
import Section from './components/Section.jsx';
import Item from './components/Item.jsx';
import YourQueueSection from './components/YourQueueSection.jsx';
import CaptureBar from './components/CaptureBar.jsx';
import SummaryOverlay from './components/SummaryOverlay.jsx';
import SecondaryNav from './components/SecondaryNav.jsx';
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
  const [channel, setChannel] = useState({ items: [], loaded: false, error: null });

  // Load real channel data — Type=Question or Action requested,
  // recent, not already addressed to Code (since those are Code's to ack).
  useEffect(() => {
    fetch('/api/list?kind=channel_recent&limit=20')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setChannel({ items: filterChannel(d.items), loaded: true, error: null });
      })
      .catch((err) => setChannel({ items: [], loaded: true, error: err.message }));
  }, []);

  // Channel filter — items where Code is the recipient AND Garrison hasn't yet
  // released the acknowledgement. Bounded to To: Code because Code has
  // acknowledge-authority on its own queue per ADR-003 / Doctrine 8; clicking
  // Reconcile authorizes Code-via-Console to ack on Garrison's behalf.
  // Items addressed To: Architect / Advisor / etc. belong in those agents'
  // queues, not Garrison's — we don't surface them here.
  function filterChannel(items) {
    return (items || []).filter(
      (it) =>
        (it.type === 'Question' || it.type === 'Action requested') &&
        it.status === 'Unread' &&
        it.to === 'Code'
    );
  }

  function reloadChannel() {
    fetch('/api/list?kind=channel_recent&limit=20')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setChannel({ items: filterChannel(d.items), loaded: true, error: null });
      })
      .catch((err) => setChannel({ items: [], loaded: true, error: err.message }));
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
        summary:
          item.routedTo
            ? `Routed to <strong>${item.routedTo}</strong>. Your next ${item.routedTo} session will see this as starting context.`
            : `Sitting unrouted. Pick a destination on the item to surface it in your next session with that agent.`,
        actions: [
          {
            kind: 'ghost',
            label: 'Edit thought (v2)',
            onClick: () => alert('Edit lands in v2.'),
          },
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
            Age:
              item.ageState === 'stale'
                ? `<span class="age-stale">${item.age}</span>`
                : item.age,
          }),
          ...(item.note && { Note: item.note }),
        },
        summary:
          '<em>This item is currently mocked. Real data wiring is pending Architect schema work — see the project memory file for which schema additions are owed.</em>',
        actions: [{ kind: 'ghost', label: 'Close' }],
      },
    });
  }

  function openSummaryForChannelItem(it) {
    setOverlay({
      open: true,
      payload: {
        sectionTag: '🔄 Channel item needing your relay',
        title: `${it.from} → ${it.to}: ${it.subject}`,
        meta: {
          Type: it.type,
          Status: it.status,
          'Date sent': it.dateSent || '—',
        },
        summary:
          '<em>Full body lives in the underlying Notion row. Open it in Notion for the complete thread, or reconcile from the inbox to acknowledge in bulk.</em>',
        actions: [
          {
            kind: 'primary',
            label: 'Open in Notion ↗',
            onClick: () => {
              window.open(it.url, '_blank');
              setOverlay({ open: false, payload: null });
            },
          },
          {
            kind: 'ghost',
            label: 'Close',
            onClick: () => setOverlay({ open: false, payload: null }),
          },
        ],
      },
    });
  }

  const [reconciling, setReconciling] = useState(false);
  async function onReconcile() {
    if (channel.items.length === 0 || reconciling) return;
    setReconciling(true);
    const items = channel.items;
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
    const failures = results.filter(
      (r) => r.status === 'rejected' || !r.value?.ok
    );
    if (failures.length) {
      console.error('Reconcile failures:', failures);
      alert(
        `Reconciled ${items.length - failures.length} of ${items.length} items. ${failures.length} failed — see console.`
      );
    }
    reloadChannel();
    setReconciling(false);
  }

  // Counts
  const queueCount = queue.length;
  const sourceCount = MOCK_SOURCE_NARRATIVES.length;
  const decisionCount = MOCK_DECISIONS.length;
  const channelCount = channel.items.length;
  const totalNeedsYou = queueCount + sourceCount + decisionCount + channelCount;

  return (
    <div className="shell">
      <Header />
      <RocksStrip />
      <DomainFilter active={activeDomain} onChange={setActiveDomain} />

      <Hero
        count={totalNeedsYou}
        queueCount={queueCount}
        channelCount={channelCount}
        lastReconciled="never (v1)"
        onReconcile={onReconcile}
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

      <Section icon="🔄" title="Channel items needing your relay" count={channelCount}>
        {!channel.loaded && <div className="loading">Loading channel…</div>}
        {channel.loaded && channel.error && (
          <div className="error">⚠ {channel.error}</div>
        )}
        {channel.loaded && !channel.error && channel.items.length === 0 && (
          <div className="empty">Channel is clear — no agent threads waiting on your relay.</div>
        )}
        {channel.items.map((it) => (
          <Item
            key={it.id}
            title={`${it.from} → ${it.to}: ${it.subject}`}
            summaryId={it.id}
            onOpenSummary={() => openSummaryForChannelItem(it)}
            meta={
              <>
                <span>Type: {it.type}</span>
                <span className="sep">·</span>
                <span
                  className={`pill status-${(it.status || '')
                    .toLowerCase()
                    .replace(/['\s]+/g, '-')}`}
                >
                  {it.status}
                </span>
                {it.dateSent && (
                  <>
                    <span className="sep">·</span>
                    <span className="date">{it.dateSent}</span>
                  </>
                )}
              </>
            }
            actions={
              <>
                <a
                  href={it.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn primary"
                >
                  Open in Notion <span className="btn-arrow">↗</span>
                </a>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => openSummaryForChannelItem(it)}
                >
                  Read thread
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
            Was you, now external — {MOCK_INFO_EXTERNAL.length} item
            {MOCK_INFO_EXTERNAL.length === 1 ? '' : 's'} waiting on providers
          </span>
          <span className="mocked-tag" title="Placeholder — wiring to Pending Work pending">
            🧪 mock
          </span>
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

      <SecondaryNav />

      <SummaryOverlay
        open={overlay.open}
        onClose={() => setOverlay({ open: false, payload: null })}
        payload={overlay.payload}
      />

      <CaptureBar onCapture={capture} />
    </div>
  );
}
