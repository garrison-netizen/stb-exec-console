import { useState } from 'react';
import { apiFetch } from './Auth.jsx';

// Submission types — drives form behavior + tier mapping
// Schema names match Brain canonical (Architect v4.6, 2026-05-27)
const SUBMISSION_TYPES = [
  { value: 'pin', label: '📌 PIN', tier: 1, destination: 'Intake Queue (prefix 📌 PIN:)' },
  { value: 'open_question', label: '❓ Open Question', tier: 1, destination: 'Open Questions DB' },
  { value: 'living_archive', label: '📚 Living Archive entry', tier: 2, destination: 'Intake Queue (staged for Release Agent)' },
  { value: 'executive_perspective', label: '🧭 Executive Perspective', tier: 2, destination: 'Intake Queue (staged for Release Agent)' },
  { value: 'general_note', label: '📋 General Note', tier: 2, destination: 'Intake Queue (Release Agent will classify)' },
];

// Routing tag options for PIN submissions (subset that makes sense for a PIN)
const PIN_ROUTING_TAGS = [
  'Undecided',
  'Operating Doctrine',
  'Living Archive',
  'Executive Perspective',
  'Open Questions',
  'Brand Bible',
  'Individual file',
  'Workflow A',
  'Brainstorm (no routing)',
];

const INTAKE_TYPE_OPTIONS = [
  'Personnel',
  'Strategic',
  'Market',
  'Operational',
  'Financial',
  'Brainstorm',
  'Gap analysis',
];

const OPEN_QUESTION_DOMAINS = [
  'Distribution',
  'Production',
  'Personnel',
  'Financial',
  'Marketing',
  'Industry',
  'Regulatory',
  'Brand',
  'Strategic',
];

export default function SubmissionForm({ onSubmitted }) {
  const [submissionType, setSubmissionType] = useState('pin');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [routingTag, setRoutingTag] = useState('Undecided');
  const [intakeType, setIntakeType] = useState('');
  const [whyItMatters, setWhyItMatters] = useState('');
  const [domains, setDomains] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const meta = SUBMISSION_TYPES.find((t) => t.value === submissionType);

  function toggleDomain(d) {
    setDomains((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function reset() {
    setTitle('');
    setBody('');
    setRoutingTag('Undecided');
    setIntakeType('');
    setWhyItMatters('');
    setDomains([]);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const payload = { submissionType };

    if (submissionType === 'open_question') {
      payload.question = title;
      payload.whyItMatters = whyItMatters;
      payload.domains = domains;
    } else {
      payload.title = title;
      payload.body = body;
      if (submissionType === 'pin') {
        payload.routingTag = routingTag;
        if (intakeType) payload.type = intakeType;
      } else if (submissionType === 'general_note') {
        if (intakeType) payload.type = intakeType;
      }
    }

    try {
      const res = await apiFetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      reset();
      onSubmitted?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card form" onSubmit={handleSubmit}>
      <div className="card-header">
        <h2>Submit Update to Brain</h2>
        <div className={`tier-pill tier-${meta.tier}`}>Tier {meta.tier}</div>
      </div>

      <div className="card-body">
        <div className="form-group">
          <label>TYPE</label>
          <div className="type-chips">
            {SUBMISSION_TYPES.map((t) => (
              <button
                type="button"
                key={t.value}
                className={`type-chip ${submissionType === t.value ? 'selected' : ''}`}
                onClick={() => setSubmissionType(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="destination-hint">→ {meta.destination}</div>
        </div>

        {submissionType === 'open_question' ? (
          <>
            <div className="form-group">
              <label>QUESTION</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="The question you're sitting with..."
                required
              />
            </div>

            <div className="form-group">
              <label>WHY IT MATTERS</label>
              <textarea
                value={whyItMatters}
                onChange={(e) => setWhyItMatters(e.target.value)}
                placeholder="What does answering this unblock or clarify?"
              />
            </div>

            <div className="form-group">
              <label>DOMAIN (multi-select)</label>
              <div className="type-chips">
                {OPEN_QUESTION_DOMAINS.map((d) => (
                  <button
                    type="button"
                    key={d}
                    className={`type-chip small ${domains.includes(d) ? 'selected' : ''}`}
                    onClick={() => toggleDomain(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <label>TITLE</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short label — what is this about?"
                required
              />
            </div>

            <div className="form-group">
              <label>BODY</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What happened, what's the status, what's next?"
              />
            </div>

            {submissionType === 'pin' && (
              <div className="form-group">
                <label>ROUTING TAG</label>
                <select value={routingTag} onChange={(e) => setRoutingTag(e.target.value)}>
                  {PIN_ROUTING_TAGS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(submissionType === 'pin' || submissionType === 'general_note') && (
              <div className="form-group">
                <label>TYPE (optional)</label>
                <select value={intakeType} onChange={(e) => setIntakeType(e.target.value)}>
                  <option value="">— none —</option>
                  {INTAKE_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        {error && <div className="error">⚠ {error}</div>}

        <div className="actions">
          <button type="button" className="btn ghost" onClick={reset} disabled={submitting}>
            Reset
          </button>
          <button type="submit" className="btn primary" disabled={submitting || !title.trim()}>
            {submitting ? 'Submitting…' : 'Submit to Brain'}
          </button>
        </div>
      </div>
    </form>
  );
}
