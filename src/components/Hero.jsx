// Slim hero — Reconcile button now lives in the sidebar (co-located with
// Agent Freshness for the visibility-layer story).
export default function Hero({ count, queueCount, sourceCount, decisionCount, externalCount, lastReconciled }) {
  return (
    <div className="hero">
      <h1>
        The Brain needs you for<span className="n">{count}</span>item{count === 1 ? '' : 's'}
      </h1>
      <div className="sub">
        {queueCount} captured · {sourceCount} source narrative{sourceCount === 1 ? '' : 's'} · {decisionCount} decision{decisionCount === 1 ? '' : 's'} · {externalCount} external hold{externalCount === 1 ? '' : 's'} · last reconciled {lastReconciled}
      </div>
    </div>
  );
}
