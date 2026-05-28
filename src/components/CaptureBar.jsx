import { useState } from 'react';

// Sticky bottom capture bar — pins to queue (localStorage v1).
// Mic affordance is reserved for v3 (Whisper Memos + iOS Action Button → webhook).
export default function CaptureBar({ onCapture }) {
  const [text, setText] = useState('');

  function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onCapture(t);
    setText('');
  }

  return (
    <form className="capture-bar" onSubmit={submit}>
      <div className="capture-inner">
        <span className="capture-icon">💭</span>
        <button
          type="button"
          className="capture-mic"
          title="Voice capture — v3 roadmap (Whisper + iOS Action Button)"
          aria-label="Voice capture coming soon"
          disabled
        >
          🎤
        </button>
        <input
          type="text"
          className="capture-input"
          placeholder="Quick capture — pins to your queue, route to an agent when ready…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="capture-send">
          Pin to Queue
        </button>
        <span className="capture-hint">⏎</span>
      </div>
    </form>
  );
}
