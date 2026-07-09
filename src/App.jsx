import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Hero from './components/Hero.jsx';
import Section from './components/Section.jsx';
import Item from './components/Item.jsx';
import YourQueueSection from './components/YourQueueSection.jsx';
import TaskListRow from './components/TaskListRow.jsx';
import ProjectsSection from './components/ProjectsSection.jsx';
import CaptureBar from './components/CaptureBar.jsx';
import SummaryOverlay from './components/SummaryOverlay.jsx';
import {
  loadQueue,
  addThought,
  routeThought,
  dismissThought,
  relativeAge,
} from './state/queue.js';

// Source Narrative Intake page — Architect's pointer for "tell the story".
const SOURCE_NARRATIVE_INTAKE_URL = 'https://www.notion.so/3651c57ac02b810eb1b4f724dec7c99d';

// Capture-bar destinations per ADR-006 §6 (Brain↔GTD split rule).
// - GTD  → Capture Inbox (Classifier + Promoter handle classification + landing in UB)
// - Brain → Intake Queue with Routing tag = To: Architect (durable intelligence)
// Each Capture has one destination; clicking the chip selects it, Send fires.
const DESTINATIONS = {
  GTD: {
    key: 'GTD',
    emoji: '📥',
    label: 'Action',
    sublabel: 'Land in my GTD',
    tooltip: 'Send to Capture Inbox — Classifier picks up, Promoter lands it in UB Tasks/Notes/Projects.',
  },
  Brain: {
    key: 'Brain',
    emoji: '🧠',
    label: 'Brain',
    sublabel: 'For the Architect',
    tooltip: 'Send to Intake Queue with Routing tag = To: Architect. Durable intelligence, not an actionable.',
  },
};

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

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render a list of channel rows for the Reconcile overlay. Variant controls
// the trailing marker per item (preview = arrow, pending = spinner-ish dot,
// result = ✓ / ✗ with optional error tooltip).
function renderItemList(items, variant = 'preview') {
  if (!items.length) return '<em>Nothing to reconcile.</em>';
  const rows = items
    .map((it) => {
      let marker = '<span class="reconcile-marker">→</span>';
      if (variant === 'pending') marker = '<span class="reconcile-marker">…</span>';
      if (variant === 'result') {
        marker = it.outcome === 'acked'
          ? '<span class="reconcile-marker ok">✓</span>'
          : `<span class="reconcile-marker bad" title="${escapeHtml(it.error || 'failed')}">✗</span>`;
      }
      const subj = escapeHtml(it.subject || '(no subject)');
      const from = escapeHtml(it.from || '?');
      const to = escapeHtml(it.to || '?');
      const type = escapeHtml(it.type || '');
      const link = it.url
        ? `<a href="${it.url}" target="_blank" rel="noreferrer">↗</a>`
        : '';
      return `<li>${marker} <span class="reconcile-meta">${from} → ${to}${type ? ' · ' + type : ''}</span><br/><span class="reconcile-subj">${subj}</span> ${link}</li>`;
    })
    .join('');
  return `<ul class="reconcile-list">${rows}</ul>`;
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

  // Active Tasks — UB Tasks where Status != Done and no '🤖 Operator draft' label.
  const [activeTasks, setActiveTasks] = useState({ items: [], loading: true, error: null });

  // Held for Garrison — Capture Inbox rows the Classifier punted; Garrison
  // reclassifies (Task/Note/Project) or drops them via Console.
  const [heldCaptures, setHeldCaptures] = useState({ items: [], loading: true, error: null });

  // Draft Tasks — UB Tasks the Promoter created with the '🤖 Operator draft'
  // label, awaiting Garrison's review. Release removes the label.
  const [draftTasks, setDraftTasks] = useState({ items: [], loading: true, error: null });

  // Project-shape inbox per ADR-005 §2 — projects + their related tasks.
  const [projects, setProjects] = useState({ items: [], loading: true, error: null });
  const [projectedTasks, setProjectedTasks] = useState({ items: [], loading: true, error: null });

  // De-mock wiring 2026-07-09 — the last four surfaces reading placeholder data.
  const [rocks, setRocks] = useState({ items: [], loading: true, error: null });
  const [decisions, setDecisions] = useState({ items: [], loading: true, error: null });
  const [externalHolds, setExternalHolds] = useState({ items: [], loading: true, error: null });
  const [lastRecon, setLastRecon] = useState({ when: null, loading: true });

  // Load channel items where Code is the recipient + status Unread (matches
  // the doctrinal narrow filter shipped earlier today).
  useEffect(() => {
    reloadReconcileTargets();
    reloadFreshness();
    reloadSourceNarratives();
    reloadActiveTasks();
    reloadHeldCaptures();
    reloadDraftTasks();
    reloadProjects();
    reloadProjectedTasks();
    reloadRocks();
    reloadDecisions();
    reloadExternalHolds();
    reloadLastRecon();
  }, []);

  function reloadRocks() {
    setRocks((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/list?kind=company_rocks&limit=12')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setRocks({ items: d.items || [], loading: false, error: null });
      })
      .catch((err) => setRocks({ items: [], loading: false, error: err.message }));
  }

  function reloadDecisions() {
    setDecisions((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/list?kind=decisions_pending&limit=25')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        // Ready (needs Garrison now) first, then Pending input, then Forming;
        // oldest first within each band.
        const rank = { Ready: 0, 'Pending input': 1, Forming: 2 };
        const items = (d.items || []).sort(
          (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
        );
        setDecisions({ items, loading: false, error: null });
      })
      .catch((err) => setDecisions({ items: [], loading: false, error: err.message }));
  }

  function reloadExternalHolds() {
    setExternalHolds((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/list?kind=external_holds&limit=25')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setExternalHolds({ items: d.items || [], loading: false, error: null });
      })
      .catch((err) => setExternalHolds({ items: [], loading: false, error: err.message }));
  }

  function reloadLastRecon() {
    fetch('/api/list?kind=recent_reconciles&limit=1')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setLastRecon({ when: d.items?.[0]?.when || null, loading: false });
      })
      .catch(() => setLastRecon({ when: null, loading: false }));
  }

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

  function reloadActiveTasks() {
    setActiveTasks((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/list?kind=active_tasks&limit=25')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setActiveTasks({ items: d.items || [], loading: false, error: null });
      })
      .catch((err) => setActiveTasks({ items: [], loading: false, error: err.message }));
  }

  function reloadHeldCaptures() {
    setHeldCaptures((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/list?kind=held_for_garrison&limit=25')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setHeldCaptures({ items: d.items || [], loading: false, error: null });
      })
      .catch((err) => setHeldCaptures({ items: [], loading: false, error: err.message }));
  }

  // Reclassify a Held capture → Pending promotion. Promoter picks up next pass.
  async function reclassifyHeld(item, captureType) {
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionType: 'reclassify_held_capture',
          pageId: item.id,
          captureType,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'reclassify failed');
      reloadHeldCaptures();
    } catch (err) {
      alert(`Reclassify failed: ${err.message}`);
    }
  }

  function reloadDraftTasks() {
    setDraftTasks((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/list?kind=draft_tasks&limit=25')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setDraftTasks({ items: d.items || [], loading: false, error: null });
      })
      .catch((err) => setDraftTasks({ items: [], loading: false, error: err.message }));
  }

  function reloadProjects() {
    setProjects((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/list?kind=active_projects&limit=50')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setProjects({ items: d.items || [], loading: false, error: null });
      })
      .catch((err) => setProjects({ items: [], loading: false, error: err.message }));
  }

  function reloadProjectedTasks() {
    setProjectedTasks((s) => ({ ...s, loading: true, error: null }));
    fetch('/api/list?kind=projected_active_tasks&limit=200')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || 'fetch failed');
        setProjectedTasks({ items: d.items || [], loading: false, error: null });
      })
      .catch((err) => setProjectedTasks({ items: [], loading: false, error: err.message }));
  }

  // Mark Done — straight write to UB Tasks (Status=Done, Completed=today).
  // ADR-005 §2 write boundary, ADR-006-formalize-write pending.
  async function markTaskDone(task) {
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionType: 'mark_task_done', pageId: task.id }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'mark done failed');
      // Refresh both project-tasks (within projects) and loose active list.
      reloadProjectedTasks();
      reloadActiveTasks();
    } catch (err) {
      alert(`Mark done failed: ${err.message}`);
    }
  }

  async function releaseDraft(item) {
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionType: 'release_draft_task', pageId: item.id }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'release failed');
      reloadDraftTasks();
      reloadActiveTasks(); // released task moves into active list
    } catch (err) {
      alert(`Release failed: ${err.message}`);
    }
  }

  // Drop a Held capture → Bounced with Garrison-attributed reason.
  async function discardHeld(item) {
    if (!confirm(`Drop this capture? It will not be promoted.\n\n"${(item.body || item.title || '').slice(0, 120)}"`)) return;
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionType: 'discard_held_capture',
          pageId: item.id,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'discard failed');
      reloadHeldCaptures();
    } catch (err) {
      alert(`Drop failed: ${err.message}`);
    }
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

  // Send a captured thought to its picked destination.
  // routedTo is the destination key ('GTD' or 'Brain' per DESTINATIONS).
  async function sendThought(id) {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    const dest = DESTINATIONS[item.routedTo];
    if (!dest) {
      alert(`Pick a destination first — Action or Brain.`);
      return;
    }
    try {
      const submission = dest.key === 'Brain'
        ? {
            submissionType: 'general_note',
            title: item.text,
            body: `Captured via Executive Console on ${new Date(item.capturedAt).toISOString()}.\n\nDestination: Brain (Intake Queue, Routing tag = To: Architect).`,
            routingTag: 'To: Architect',
          }
        : {
            submissionType: 'capture_inbox',
            body: item.text,
            capturedBy: 'Console',
            source: `Console capture bar — ${new Date(item.capturedAt).toISOString()}`,
          };

      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'send failed');

      setQueue(dismissThought(id));
      setOverlay({
        open: true,
        payload: {
          sectionTag: `${dest.emoji} Sent to ${dest.label}`,
          title: item.text,
          meta: {
            Destination: dest.key === 'Brain'
              ? 'Brain — Intake Queue (To: Architect)'
              : 'GTD — Capture Inbox (Classifier picks up next pass)',
            Captured: relativeAge(item.capturedAt),
            'Sent at': new Date().toLocaleString(),
          },
          summary: dest.key === 'Brain'
            ? `Created as an Intake Queue row, <code>Captured by = Console</code>, <code>Routing tag = To: Architect</code>, <code>Status = Pending review</code>. Architect picks up on next /refresh.`
            : `Created as a Capture Inbox row, <code>Captured by = Console</code>, <code>Promotion status = Pending promotion</code>. The Classifier will fill in Capture type/domain/title on its next pass (every 5 min when cron is live); the Promoter then routes to UB Tasks/Notes/Projects.`,
          actions: [
            { kind: 'primary', label: 'Open in Notion ↗', onClick: () => window.open(json.url, '_blank', 'noopener,noreferrer') },
            { kind: 'ghost', label: 'Close', onClick: () => setOverlay({ open: false, payload: null }) },
          ],
        },
      });
    } catch (err) {
      console.error(`Send to ${dest.key} failed:`, err);
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

  // Decisions are Brain content — Architect-owned writes — so the overlay is
  // read-and-jump only: full context here, resolution happens in Notion.
  function openSummaryForDecision(item) {
    setOverlay({
      open: true,
      payload: {
        sectionTag: '⚖️ Decision pending your call',
        title: item.decision,
        meta: {
          Status: item.status,
          ...(item.dateLogged && { Logged: item.dateLogged }),
          ...(item.targetResolution && { 'Target resolution': item.targetResolution }),
        },
        summary: item.context
          ? escapeHtml(item.context)
          : '<em>No context written on this decision yet.</em>',
        actions: [
          {
            kind: 'primary',
            label: 'Open in Notion ↗',
            onClick: () => window.open(item.url, '_blank', 'noopener,noreferrer'),
          },
          { kind: 'ghost', label: 'Close' },
        ],
      },
    });
  }

  // Reconcile is now a two-stage flow: clicking opens a preview overlay listing
  // exactly what will move; a second click inside the overlay executes the
  // writes and re-renders the overlay with what landed, including links.
  function onReconcile() {
    if (reconcileTargets.length === 0 || reconciling) return;
    openReconcilePreview(reconcileTargets);
  }

  function openReconcilePreview(items) {
    setOverlay({
      open: true,
      payload: {
        sectionTag: '⚡ Reconcile — preview',
        title: `${items.length} channel item${items.length === 1 ? '' : 's'} pending acknowledgement`,
        meta: {
          'Filter': 'To:Code · Status:Unread · Type:Question or Action requested',
          'Action': 'Flip Status → Acknowledged, append doctrinal trace footer, write one Reconciliation Log row',
          'Reversible?': 'Status flip is — re-edit in Notion. Log row is append-only.',
        },
        summary: renderItemList(items, 'preview'),
        actions: [
          {
            kind: 'primary',
            label: `Reconcile ${items.length} item${items.length === 1 ? '' : 's'}`,
            onClick: () => executeReconcile(items),
          },
          { kind: 'ghost', label: 'Cancel', onClick: () => setOverlay({ open: false, payload: null }) },
        ],
      },
    });
  }

  async function executeReconcile(items) {
    setReconciling(true);
    // Re-render the overlay in "working" state so Garrison sees feedback.
    setOverlay({
      open: true,
      payload: {
        sectionTag: '⚡ Reconcile — running',
        title: `Reconciling ${items.length} item${items.length === 1 ? '' : 's'}…`,
        meta: { Status: 'Pushing acks to Brain, then writing the audit row.' },
        summary: renderItemList(items, 'pending'),
        actions: [],
      },
    });

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
    const outcomes = items.map((it, i) => {
      const r = results[i];
      const ok = r.status === 'fulfilled' && r.value?.ok;
      return {
        ...it,
        outcome: ok ? 'acked' : 'failed',
        error: ok ? null : (r.status === 'rejected' ? r.reason?.message : r.value?.error),
      };
    });
    const successes = outcomes.filter((o) => o.outcome === 'acked');
    const failures = outcomes.filter((o) => o.outcome === 'failed');

    // Push phase: write one Reconciliation Log entry summarizing what moved.
    // We log even on partial failure so the audit trail reflects what actually shipped.
    let logUrl = null;
    if (successes.length > 0) {
      try {
        const fromCounts = successes.reduce((acc, it) => {
          const k = `${it.from} → ${it.to}`;
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {});
        const summary = Object.entries(fromCounts)
          .map(([k, v]) => `${v} ${k}`)
          .join('; ');
        const logRes = await fetch('/api/submit', {
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
        const logJson = await logRes.json();
        if (logJson.ok) logUrl = logJson.url;
      } catch (err) {
        console.error('Reconciliation Log write failed:', err);
      }
    }

    // Result overlay — show every item's outcome with a link, plus link to the
    // log row so Garrison has a one-click jump to the audit entry he just made.
    const actions = [];
    if (logUrl) {
      actions.push({
        kind: 'primary',
        label: 'Open log entry in Notion ↗',
        onClick: () => window.open(logUrl, '_blank', 'noopener,noreferrer'),
      });
    }
    actions.push({ kind: 'ghost', label: 'Close', onClick: () => setOverlay({ open: false, payload: null }) });

    setOverlay({
      open: true,
      payload: {
        sectionTag: failures.length === 0 ? '⚡ Reconcile — complete' : '⚡ Reconcile — partial',
        title:
          failures.length === 0
            ? `${successes.length} item${successes.length === 1 ? '' : 's'} acknowledged · log row written`
            : `${successes.length}/${items.length} acknowledged · ${failures.length} failed`,
        meta: {
          Acknowledged: String(successes.length),
          Failed: String(failures.length),
          Log: logUrl ? '<a href="' + logUrl + '" target="_blank" rel="noreferrer">open new Reconciliation Log row ↗</a>' : '(not written — no successes)',
        },
        summary: renderItemList(outcomes, 'result'),
        actions,
      },
    });

    reloadReconcileTargets();
    reloadLastRecon();
    setReconciling(false);
  }

  // Counts
  const queueCount = queue.length;
  const sourceCount = sourceNarratives.items.length;
  const decisionCount = decisions.items.length;
  const externalCount = externalHolds.items.length;
  const totalNeedsYou = queueCount + sourceCount + decisionCount;
  // Real stale agent count from Agent Status DB (state !== 'ok').
  const staleAgentCount = freshness.items.filter((a) => a.state !== 'ok').length;
  // Real "last recon." from the newest Reconciliation Log row.
  const lastReconShort = lastRecon.loading ? '…' : lastRecon.when ? relAgeShort(lastRecon.when) : 'never';
  const lastReconLabel = lastRecon.loading ? '…' : lastRecon.when ? `${relAgeShort(lastRecon.when)} ago` : 'never';

  return (
    <div className="grid">
      <Sidebar
        activeDomain={activeDomain}
        onDomainChange={setActiveDomain}
        status={{
          needYou: totalNeedsYou,
          queueCount,
          staleCount: staleAgentCount,
          lastReconciled: lastReconShort,
        }}
        rocks={rocks}
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
          lastReconciled={lastReconLabel}
        />

        {(heldCaptures.items.length > 0 || heldCaptures.loading || heldCaptures.error) && (
          <Section icon="✋" title="Held for your call" count={heldCaptures.items.length} countTone="urgent">
            {heldCaptures.loading && <div className="loading">Loading from Capture Inbox…</div>}
            {heldCaptures.error && <div className="error">⚠ {heldCaptures.error}</div>}
            {!heldCaptures.loading && !heldCaptures.error && heldCaptures.items.length === 0 && (
              <div className="empty">Nothing held — Classifier handled everything cleanly.</div>
            )}
            {!heldCaptures.loading && !heldCaptures.error && heldCaptures.items.map((c) => {
              const preview = (c.title || c.body || '(no content)').slice(0, 200);
              return (
                <Item
                  key={c.id}
                  extraClass={c.captureDomain ? `dom-${c.captureDomain.toLowerCase().replace(/\s+/g, '-')}` : ''}
                  title={preview}
                  summaryId={c.id}
                  onOpenSummary={() => window.open(c.url, '_blank', 'noopener,noreferrer')}
                  meta={
                    <>
                      {c.captureDomain && <span className="domain-badge stb">{c.captureDomain}</span>}
                      <span className="pill ghost">by {c.capturedBy || '?'}</span>
                      {c.dateCaptured && (
                        <>
                          <span className="sep">·</span>
                          <span>captured {c.dateCaptured.slice(0, 10)}</span>
                        </>
                      )}
                      {c.bounceReason && (
                        <>
                          <span className="sep">·</span>
                          <span className="age stale">{c.bounceReason}</span>
                        </>
                      )}
                    </>
                  }
                  actions={
                    <>
                      <button type="button" className="btn primary" onClick={() => reclassifyHeld(c, 'Task')}>
                        Task
                      </button>
                      <button type="button" className="btn secondary" onClick={() => reclassifyHeld(c, 'Note')}>
                        Note
                      </button>
                      <button type="button" className="btn secondary" onClick={() => reclassifyHeld(c, 'Project')}>
                        Project
                      </button>
                      <button type="button" className="btn danger" onClick={() => discardHeld(c)}>
                        Drop
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => window.open(c.url, '_blank', 'noopener,noreferrer')}
                      >
                        Open <span className="btn-arrow">↗</span>
                      </button>
                    </>
                  }
                />
              );
            })}
          </Section>
        )}

        <ProjectsSection
          projects={projects.items}
          tasksByProject={(() => {
            const grouped = {};
            for (const t of projectedTasks.items) {
              if (!t.projectId) continue;
              (grouped[t.projectId] = grouped[t.projectId] || []).push(t);
            }
            return grouped;
          })()}
          onMarkDone={markTaskDone}
          loading={projects.loading || projectedTasks.loading}
          error={projects.error || projectedTasks.error}
        />

        <Section icon="✅" title="Loose tasks (no project)" count={activeTasks.items.length}>
          {activeTasks.loading && <div className="loading">Loading from UB Tasks…</div>}
          {activeTasks.error && <div className="error">⚠ {activeTasks.error}</div>}
          {!activeTasks.loading && !activeTasks.error && activeTasks.items.length === 0 && (
            <div className="empty">
              <strong>Nothing loose.</strong> Every active task is attached to a project above.
            </div>
          )}
          {!activeTasks.loading && !activeTasks.error && activeTasks.items.map((t) => (
            <TaskListRow key={t.id} task={t} variant="active" />
          ))}
        </Section>

        {(draftTasks.items.length > 0 || draftTasks.error) && (
          <Section icon="🤖" title="Operator drafts awaiting release" count={draftTasks.items.length} countTone="gold">
            {draftTasks.error && <div className="error">⚠ {draftTasks.error}</div>}
            {!draftTasks.error && draftTasks.items.map((t) => (
              <TaskListRow key={t.id} task={t} variant="draft" onRelease={releaseDraft} />
            ))}
          </Section>
        )}

        <YourQueueSection
          items={queue}
          onCapture={capture}
          onRoute={route}
          onDismiss={dismiss}
          onSend={sendThought}
          destinations={DESTINATIONS}
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
            <div className="empty">
              <div style={{ marginBottom: 6 }}>
                <strong>Nothing waiting on you for a source narrative.</strong>
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
                Entries land here when an agent flags a Living Archive row as needing
                your first-person account (Doctrine 3) — either by creating a stub or by you
                clicking <em>Tell the story</em> on an existing row. The flag schema went
                live today; no rows are flagged yet.
              </div>
            </div>
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

        <Section icon="⚖️" title="Decisions pending your call" count={decisionCount}>
          {decisions.loading && <div className="loading">Loading from Decision Pipeline…</div>}
          {decisions.error && <div className="error">⚠ {decisions.error}</div>}
          {!decisions.loading && !decisions.error && decisionCount === 0 && (
            <div className="empty">
              <strong>No decisions in formation.</strong> Rows land here from the Brain's
              Decision Pipeline when a decision is Forming, Pending input, or Ready for your call.
            </div>
          )}
          {!decisions.loading && !decisions.error && decisions.items.map((it) => {
            const ageDays = it.dateLogged
              ? Math.floor((Date.now() - new Date(it.dateLogged).getTime()) / 86_400_000)
              : null;
            return (
              <Item
                key={it.id}
                urgency={it.status === 'Ready' ? 'urgent' : it.status === 'Pending input' ? 'medium' : undefined}
                extraClass="dom-system"
                title={it.decision}
                summaryId={it.id}
                onOpenSummary={() => openSummaryForDecision(it)}
                meta={
                  <>
                    <span className="domain-badge stb">{it.status}</span>
                    {ageDays !== null && (
                      <>
                        <span className="sep">·</span>
                        <span className={`age ${ageDays > 14 ? 'stale' : ''}`}>
                          {ageDays === 0 ? 'logged today' : `in pipeline ${ageDays}d`}
                        </span>
                      </>
                    )}
                    {it.targetResolution && (
                      <>
                        <span className="sep">·</span>
                        <span>target {it.targetResolution}</span>
                      </>
                    )}
                  </>
                }
                actions={
                  <>
                    <button type="button" className="btn primary" onClick={() => openSummaryForDecision(it)}>
                      Context
                    </button>
                    <a className="btn ghost" href={it.url} target="_blank" rel="noreferrer">
                      Open in Notion <span className="btn-arrow">↗</span>
                    </a>
                  </>
                }
              />
            );
          })}
        </Section>

        <div className={`info-section ${infoOpen ? 'open' : ''}`}>
          <div className="info-header" onClick={() => setInfoOpen((s) => !s)}>
            <span className="section-icon" style={{ fontSize: 14 }}>ℹ️</span>
            <span className="info-title">
              Was you, now external — {externalCount} item{externalCount === 1 ? '' : 's'} waiting on providers
            </span>
            {externalHolds.loading && <span className="mocked-tag" title="Loading from Pending Work">…</span>}
            <span className="section-chevron" style={{ marginLeft: 'auto' }}>
              {infoOpen ? '▲' : '▼'}
            </span>
          </div>
          {infoOpen && (
            <div className="info-list">
              {externalHolds.error && (
                <div className="info-row">
                  <span className="error">
                    {externalHolds.error.includes('object_not_found') ? (
                      <>⚠ Pending Work isn't shared with the Console integration yet — open it in Notion → ⋯ → Connections → add STB Executive Console.</>
                    ) : (
                      <>⚠ {externalHolds.error}</>
                    )}
                  </span>
                </div>
              )}
              {!externalHolds.loading && !externalHolds.error && externalCount === 0 && (
                <div className="info-row">
                  <span>Nothing waiting on outside parties.</span>
                </div>
              )}
              {externalHolds.items.map((i) => {
                const days = i.dateLogged
                  ? Math.floor((Date.now() - new Date(i.dateLogged).getTime()) / 86_400_000)
                  : null;
                return (
                  <div key={i.id} className="info-row">
                    <span>
                      <a href={i.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                        {i.title}
                      </a>
                      {i.workstream ? ` — ${i.workstream}` : ''}
                    </span>
                    <span className="external">
                      awaiting external event{days !== null ? ` · ${days}d` : ''}
                    </span>
                  </div>
                );
              })}
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
