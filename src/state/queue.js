// localStorage-backed "captured thoughts" queue.
// v1 keeps these client-side — they don't write to Brain until you route
// them to an agent. Schema for a persistent queue surface is pending Architect.
//
// Item shape:
//   { id, text, capturedAt, domain (string|null), routedTo (string|null) }

const KEY = 'stb-exec-console.captured-queue';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function loadQueue() {
  return read();
}

export function addThought(text, { domain = null } = {}) {
  const item = {
    id: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: text.trim(),
    capturedAt: new Date().toISOString(),
    domain,
    routedTo: null,
  };
  const items = [item, ...read()];
  write(items);
  return items;
}

export function routeThought(id, routedTo) {
  const items = read().map((it) => (it.id === id ? { ...it, routedTo } : it));
  write(items);
  return items;
}

export function dismissThought(id) {
  const items = read().filter((it) => it.id !== id);
  write(items);
  return items;
}

export function relativeAge(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}
