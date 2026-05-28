import { MOCK_ROCKS } from '../state/mockData.js';

// Rocks strip — EOS Q2 anchors. Mock for v1 — pending Architect's call on
// whether Rocks live centrally on STB Dashboard or per-department.
export default function RocksStrip() {
  return (
    <div className="rocks-strip">
      <div className="rocks-head">
        <span style={{ fontSize: 14 }}>🎯</span>
        <span className="rocks-label">Q2 Rocks</span>
        <span className="rocks-quarter">· Apr–Jun 2026</span>
        <span className="mocked-tag" title="Mock data — Rocks DB structure pending Architect">🧪 mock</span>
        <button className="rocks-edit" title="Edit rocks lands in v2" type="button">edit rocks</button>
      </div>
      <div className="rocks-grid">
        {MOCK_ROCKS.map((r) => (
          <div key={r.id} className="rock-chip">
            <span className="rock-emoji">{r.emoji}</span>
            <span className="rock-domain">{r.domain}</span>
            <span>{r.text}</span>
          </div>
        ))}
        <div className="rock-chip empty">+ add rock</div>
      </div>
    </div>
  );
}
