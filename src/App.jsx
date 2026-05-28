import { useState } from 'react';
import SubmissionForm from './SubmissionForm.jsx';
import {
  ActivityView,
  PinsView,
  QuestionsView,
  ChannelView,
  PendingWorkView,
} from './Dashboard.jsx';

const TABS = [
  { id: 'submit', label: '➕ Submit' },
  { id: 'activity', label: '📋 Activity' },
  { id: 'pins', label: '📌 PINs' },
  { id: 'questions', label: '❓ Questions' },
  { id: 'pending', label: '🔀 Pending Work' },
  { id: 'channel', label: '🔄 Channel' },
];

export default function App() {
  const [tab, setTab] = useState('submit');
  const [lastResult, setLastResult] = useState(null);

  return (
    <div className="app-shell wide">
      <header className="topbar">
        <div className="brand">
          <div className="wordmark">Spindletap</div>
          <div className="app-name">Executive Console</div>
        </div>
        <div className="brain-pill">
          <span className="dot" />
          Brain Live · v4.6
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'submit' && (
          <>
            <SubmissionForm onSubmitted={setLastResult} />
            {lastResult && (
              <div className="result-card success">
                <div className="result-title">✓ Submitted to Brain</div>
                <div className="result-meta">
                  <a href={lastResult.url} target="_blank" rel="noreferrer">
                    Open row in Notion →
                  </a>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'activity' && (
          <Panel
            title="Recent Console Submissions"
            subtitle="Everything you've submitted through this console, newest first."
          >
            <ActivityView />
          </Panel>
        )}

        {tab === 'pins' && (
          <Panel
            title="Active PINs"
            subtitle="Pinned context items across the system, from any source."
          >
            <PinsView />
          </Panel>
        )}

        {tab === 'questions' && (
          <Panel
            title="Open Questions"
            subtitle="Questions still sitting unanswered or partially answered."
          >
            <QuestionsView />
          </Panel>
        )}

        {tab === 'pending' && (
          <Panel
            title="Pending Work"
            subtitle="What's queued or actively being worked on across agents."
          >
            <PendingWorkView />
          </Panel>
        )}

        {tab === 'channel' && (
          <Panel
            title="Cross-Agent Channel"
            subtitle="Most recent agent-to-agent messages, newest first."
          >
            <ChannelView />
          </Panel>
        )}
      </main>

      <footer className="footer">
        <span>Tier 1 live · Tier 2 staging via Intake Queue · v0.2</span>
      </footer>
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
      </div>
      <div className="card-body list-body">{children}</div>
    </div>
  );
}
