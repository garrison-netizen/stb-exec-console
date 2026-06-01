// Compact list-shape row for Tasks. Denser than the card-shaped Item used by
// transactional surfaces. One line: status dot · title (clickable to Notion)
// · inline metadata (domain badge, priority, due, project marker) ·
// optional primary action (e.g. Release for drafts) · open arrow.
//
// variant: 'active' (default) renders status dot + open-only.
//          'draft'  renders 🤖 marker + Release primary action.
export default function TaskListRow({ task, variant = 'active', onRelease }) {
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = task.due && task.due < today;
  const isToday = task.due === today;
  const statusIcon =
    variant === 'draft' ? '🤖' :
    task.status === 'Doing' ? '◐' :
    task.status === 'To Do' ? '○' :
    '·';

  function openInNotion(e) {
    e.preventDefault();
    window.open(task.url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className={`task-row task-row-${variant}`}>
      <span className={`task-row-dot ${task.status === 'Doing' ? 'doing' : ''}`}>{statusIcon}</span>
      <a
        href={task.url}
        target="_blank"
        rel="noreferrer"
        className="task-row-title"
        onClick={openInNotion}
        title={task.name}
      >
        {task.name}
      </a>
      <div className="task-row-meta">
        {task.domainLabel && (
          <span className="task-row-domain" title={`Domain: ${task.domainLabel}`}>
            {task.domainLabel}
          </span>
        )}
        {task.priority && (
          <span className={`task-row-priority p-${task.priority.toLowerCase()}`}>
            {task.priority}
          </span>
        )}
        {task.due && (
          <span className={`task-row-due ${isOverdue ? 'overdue' : isToday ? 'today' : ''}`}>
            {isOverdue ? '⚠ ' : ''}{task.due}
          </span>
        )}
        {task.smartList && variant === 'active' && (
          <span className="task-row-smartlist">{task.smartList}</span>
        )}
        {task.hasProject && variant === 'active' && (
          <span className="task-row-project" title="In a project">·</span>
        )}
      </div>
      {variant === 'draft' && (
        <button
          type="button"
          className="task-row-release"
          onClick={() => onRelease?.(task)}
          title="Release this draft into your active task list"
        >
          Release
        </button>
      )}
      <a
        href={task.url}
        target="_blank"
        rel="noreferrer"
        className="task-row-open"
        onClick={openInNotion}
        title="Open in Notion"
      >
        ↗
      </a>
    </div>
  );
}
