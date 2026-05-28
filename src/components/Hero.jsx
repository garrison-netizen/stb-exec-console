export default function Hero({ count, queueCount, channelCount, lastReconciled, onReconcile }) {
  const reconcileDisabled = channelCount === 0;
  return (
    <div className="hero">
      <div className="hero-left">
        <h1>
          The Brain needs you for
          <span className="hero-count">{count} item{count === 1 ? '' : 's'}</span>
        </h1>
        <div className="sub">
          You have {queueCount} thought{queueCount === 1 ? '' : 's'} in your queue
          {' · '}
          channel has {channelCount} agent-relay item{channelCount === 1 ? '' : 's'}
          {' · '}
          last reconciled {lastReconciled}
        </div>
      </div>
      <button
        type="button"
        className="reconcile-btn"
        onClick={onReconcile}
        disabled={reconcileDisabled}
        title={reconcileDisabled ? 'Nothing to reconcile' : 'Acknowledge + sync all agent-relay items'}
        style={reconcileDisabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
      >
        <span className="reconcile-bolt">⚡</span>
        <div>
          Reconcile Channel
          <span className="reconcile-sub">
            {reconcileDisabled ? 'all clear' : `clear ${channelCount} item${channelCount === 1 ? '' : 's'}`}
          </span>
        </div>
      </button>
    </div>
  );
}
