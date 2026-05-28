// Placeholder data for sections pending Architect schema work.
// Items carry __mock: true so the UI can render a subtle "🧪 mock" indicator.
// When real queries land, swap the imports in App.jsx — the section shape stays the same.

export const MOCK_ROCKS = [
  { id: 'r1', emoji: '🍺', domain: 'Brewery', text: 'Hit Q2 distribution target (Houston + Austin)' },
  { id: 'r2', emoji: '🍵', domain: 'Coffee', text: 'Summer menu + seasonal drop' },
  { id: 'r3', emoji: '🌿', domain: 'THC', text: '5mg singles food-service launch' },
  { id: 'r4', emoji: '🥋', domain: 'BJJ', text: 'Purple belt grading' },
  { id: 'r5', emoji: '👨‍👩‍👧', domain: 'Family', text: 'Aug Big Bend trip planned + booked' },
  { id: 'r6', emoji: '🗣️', domain: 'Spanish', text: 'Daily 20-min minimum, B1 by Sept' },
];

export const MOCK_SOURCE_NARRATIVES = [
  {
    id: 'sn1',
    title: 'Carlos Cortez hire from Silver Eagle (2019-11-11)',
    domainTone: 'stb',
    domainLabel: 'STB · Brewery',
    meta: 'Architect needs your first-person account',
    destination: 'Living Archive',
    age: 'held 8 days',
    ageState: 'stale',
    __mock: true,
  },
  {
    id: 'sn2',
    title: 'Lone Star Beverage Brands 3-market wholesale relationship',
    meta: 'Architect needs your first-person account',
    destination: 'Living Archive',
    age: 'held 8 days',
    ageState: 'stale',
    __mock: true,
  },
  {
    id: 'sn3',
    title: 'Solstice / Johnnyo / Gorrity contractor file enrichment',
    meta: 'Architect needs your first-person account',
    destination: 'Living Archive',
    age: 'held 5 days',
    ageState: 'fresh',
    __mock: true,
  },
];

export const MOCK_DECISIONS = [
  {
    id: 'd1',
    title: 'ADR-004 Release Agent — strategic veto gate',
    domainTone: 'stb',
    domainLabel: 'STB · System',
    by: 'Architect',
    posted: 'posted 1h ago',
    note: 'blocks Console v1 build',
    urgency: 'urgent',
    __mock: true,
  },
  {
    id: 'd2',
    title: 'Party Pay Brain schema build — Workflow A approval',
    by: 'Architect',
    note: 'waiting since May 20',
    urgency: 'medium',
    __mock: true,
  },
  {
    id: 'd3',
    title: 'TSP2 — your step-1-vs-step-2 answer',
    by: 'Code',
    note: 'Triple Seat Phase 2 paused at this gate',
    ageState: 'stale',
    age: 'waiting 15 days',
    urgency: 'medium',
    __mock: true,
  },
];

export const MOCK_INFO_EXTERNAL = [
  { id: 'i1', text: 'Triple Seat API key — your request in', external: 'awaiting provider grant · 6 days', __mock: true },
  { id: 'i2', text: 'Mailchimp + Clover access — your requests in', external: 'awaiting provider grant · 6 days', __mock: true },
];

// Domain taxonomy — extensible. Sub-domains driven by Garrison's workflow walkthrough.
export const DOMAINS = {
  STB: {
    label: '🍺 STB',
    sub: ['Brewery', 'Coffee', 'Texzas', 'THC'],
  },
  Personal: {
    label: '🧘 Personal',
    sub: ['Family', 'Health/Fitness', 'Hobbies', 'Spiritual', 'Language', 'Side hustles'],
  },
};

// Agents a captured thought can be routed to (canonical roster, 2026-05-28).
// Personal Mentor doesn't need STB Brain channel access — operates on Obsidian as
// its data store. Kept in the chip list because captured personal thoughts still
// need a destination; mechanism TBD (open Architect question on routing).
export const ROUTING_AGENTS = ['Architect', 'Executive Advisor', 'Code', 'File Steward', 'Personal Mentor'];

// Sidebar Agent Freshness — MOCK for v1. Real wiring depends on the
// multi-agent freshness contract extension owed by Architect (see proposal
// 36e1c57a-c02b-8141-9240-fd919f0550c5).
// state: 'ok' (green dot) | 'stale' (gold) | 'bad' (red)
export const MOCK_AGENT_FRESHNESS = [
  { name: 'Architect',         state: 'bad',   ts: '5d stale' },
  { name: 'Executive Advisor', state: 'stale', ts: '3d stale' },
  { name: 'Code',              state: 'ok',    ts: 'now'      },
  { name: 'File Steward',      state: 'stale', ts: '4d stale' },
  { name: 'Personal Mentor',   state: 'bad',   ts: '9d stale' },
];
