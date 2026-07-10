import { useEffect, useState } from 'react';

// Add/edit modal for UB Tasks (2026-07-10). One form, two modes:
// task == null → create; task set → field-level update. Only the fields
// Garrison actually works with day-to-day: name, domain, due, priority,
// project. Save calls onSave(fields) — the parent owns the API call.
const DOMAIN_OPTIONS = ['STB', 'Finance', 'Side Hustles', 'Strength Training', 'Health'];
const PRIORITY_OPTIONS = ['Low', 'Medium', 'High'];

export default function TaskEditor({ open, task, projects, onSave, onClose, saving }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('');
  const [projectId, setProjectId] = useState('');

  // Re-seed the form whenever a different task (or a fresh add) opens.
  useEffect(() => {
    if (!open) return;
    setName(task?.name || '');
    setDomain(task?.domainLabel || '');
    setDue(task?.due || '');
    setPriority(task?.priority || '');
    setProjectId(task?.projectId || '');
  }, [open, task]);

  if (!open) return null;

  function backdropClick(e) {
    if (e.target.classList.contains('overlay-backdrop')) onClose();
  }

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      domain: domain || null,
      due: due || null,
      priority: priority || null,
      projectId: projectId || null,
    });
  }

  return (
    <div className="overlay-backdrop open" onClick={backdropClick}>
      <div className="overlay-card">
        <div className="overlay-head">
          <div className="overlay-head-left">
            <div className="overlay-section-tag">{task ? '✏️ Edit task' : '➕ New task'}</div>
            <div className="overlay-title">{task ? task.name : 'What needs doing?'}</div>
          </div>
          <button type="button" className="overlay-close" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        <form className="editor-form" onSubmit={submit}>
          <label className="field">
            <span className="field-label">Task</span>
            <input
              type="text"
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Call Trevor about the Dynamo territory"
              autoFocus
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field-label">Due</span>
              <input
                type="date"
                className="field-input"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Priority</span>
              <select className="field-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="">None</option>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span className="field-label">Domain</span>
              <select className="field-input" value={domain} onChange={(e) => setDomain(e.target.value)}>
                <option value="">None</option>
                {DOMAIN_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Project</span>
              <select className="field-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">No project</option>
                {(projects || []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="overlay-actions" style={{ padding: '4px 0 0', borderTop: 'none' }}>
            <button type="submit" className="btn primary" disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : task ? 'Save changes' : 'Add task'}
            </button>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
