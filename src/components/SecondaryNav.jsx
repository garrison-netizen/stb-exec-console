// Secondary nav — non-inbox surfaces. v1 stubs only; each link surfaces a tooltip
// describing what will live there once built.
export default function SecondaryNav() {
  const links = [
    { label: 'Browse Brain', title: 'v2 — full Brain browse + the legacy submission form' },
    { label: 'Recent activity', title: 'v2 — full activity timeline across all agents' },
    { label: 'Agent status', title: 'v2 — health + last-active for each agent' },
    { label: 'Settings', title: 'v2 — Console preferences + domain editor' },
  ];
  return (
    <nav className="secondary-nav">
      {links.map((l) => (
        <a key={l.label} href="#" title={l.title} onClick={(e) => e.preventDefault()}>
          {l.label}
        </a>
      ))}
    </nav>
  );
}
