// Generic item card — title (optionally clickable to open summary overlay) +
// metadata row + actions row. Variants (urgent, medium, your-item) controlled
// via extraClass / urgency props.
export default function Item({
  urgency,
  extraClass,
  title,
  summaryId,
  onOpenSummary,
  meta,
  actions,
}) {
  const classes = ['item', urgency || '', extraClass || ''].filter(Boolean).join(' ');
  const titleEl =
    summaryId && onOpenSummary ? (
      <span className="item-title-link" onClick={() => onOpenSummary(summaryId)}>
        {title}
      </span>
    ) : (
      <span>{title}</span>
    );

  return (
    <div className={classes}>
      <div className="item-title">{titleEl}</div>
      {meta && <div className="item-meta">{meta}</div>}
      {actions && <div className="item-actions">{actions}</div>}
    </div>
  );
}
