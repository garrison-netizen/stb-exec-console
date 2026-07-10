import { useState, useEffect } from 'react';
import TaskListRow from './TaskListRow.jsx';

// Project-shape inbox per ADR-005 §2 (Architect, 2026-05-28). Each Project
// from the GM Personal Dashboard Projects DB renders as a primary group;
// its related UB Tasks render as TaskListRow children. Done checkbox on a
// task writes Status=Done straight to UB Tasks (no Intake Queue staging —
// per Architect, Done writes through).
//
// Projects collapsed by default (chevron toggles). On mount, project with
// most tasks expanded by default so the surface feels alive on first paint.
export default function ProjectsSection({ projects, tasksByProject, onMarkDone, onEditTask, loading, error }) {
  // Track which projects are expanded. On first data arrival, expand the
  // top 3 by task count so the surface shows real work without a click.
  // After that, manual toggle is sticky.
  const [expanded, setExpanded] = useState(new Set());
  const [hasInitialExpand, setHasInitialExpand] = useState(false);
  useEffect(() => {
    if (hasInitialExpand) return;
    if (projects.length === 0) return;
    // Wait until at least one project has tasks loaded — otherwise we'd
    // commit "nothing to expand" before projectedTasks arrives.
    const totalTasks = Object.values(tasksByProject || {}).reduce(
      (sum, arr) => sum + (arr?.length || 0),
      0
    );
    if (totalTasks === 0) return;
    const sorted = projects
      .map((p) => ({ id: p.id, count: (tasksByProject[p.id] || []).length }))
      .filter((p) => p.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((p) => p.id);
    setExpanded(new Set(sorted));
    setHasInitialExpand(true);
  }, [projects, tasksByProject, hasInitialExpand]);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) return <div className="section"><div className="loading">Loading Projects…</div></div>;
  if (error) return <div className="section"><div className="error">⚠ {error}</div></div>;

  const total = projects.length;
  const tasksCounted = projects.reduce((sum, p) => sum + (tasksByProject[p.id]?.length || 0), 0);

  return (
    <div className="section projects-section">
      <div className="section-header">
        <span className="section-icon">🚀</span>
        <span className="section-title">Projects</span>
        <span className="section-count">{total}</span>
        <span className="section-subcount">· {tasksCounted} active tasks</span>
        <div className="section-divider" />
        <span className="section-chevron">▼</span>
      </div>
      {total === 0 && (
        <div className="empty">
          <strong>No active projects.</strong> Nothing in your UB Projects DB has Status = Doing,
          Ongoing, or Planned right now.
        </div>
      )}
      <div className="items projects-list">
        {projects.map((p) => {
          const tasks = tasksByProject[p.id] || [];
          const isOpen = expanded.has(p.id);
          const todayStr = new Date().toISOString().slice(0, 10);
          const isOverdue = p.targetDeadline && p.targetDeadline < todayStr;
          return (
            <div key={p.id} className={`project-card ${isOpen ? 'open' : ''}`}>
              <div className="project-head" onClick={() => toggle(p.id)}>
                <span className="project-chev">{isOpen ? '▾' : '▸'}</span>
                <span className="project-name">{p.name || '(untitled project)'}</span>
                <span className="project-meta">
                  <span className={`pill status-${(p.status || '').toLowerCase().replace(/\s+/g, '-')}`}>
                    {p.status}
                  </span>
                  {p.targetDeadline && (
                    <span className={`project-due ${isOverdue ? 'overdue' : ''}`}>
                      {isOverdue ? '⚠ ' : 'by '}{p.targetDeadline}
                    </span>
                  )}
                  <span className="project-task-count">
                    {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                  </span>
                </span>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="project-open"
                  onClick={(e) => { e.stopPropagation(); }}
                  title="Open project in Notion"
                >
                  ↗
                </a>
              </div>
              {isOpen && (
                <div className="project-tasks">
                  {tasks.length === 0 ? (
                    <div className="project-empty">No active tasks under this project.</div>
                  ) : (
                    tasks.map((t) => (
                      <TaskListRow key={t.id} task={t} variant="project" onMarkDone={onMarkDone} onEdit={onEditTask} />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
