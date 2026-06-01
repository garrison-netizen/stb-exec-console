// Synthetic test harness for Classifier v1.1 cue dictionary.
// Exercises the new logic in-memory — no Notion calls, no LLM calls.
//
// Usage: node scripts/test-classifier-v1.1.js

import 'dotenv/config';

// Re-implement parseWithCues semantics by importing the module and calling
// classifyOne with dryRun + a stub row whose body is the test input.
// To keep it pure, we import the cue functions via a thin re-export — but
// since they're not exported individually, we exercise via classifyOne in
// dry-run with no LLM (ANTHROPIC_API_KEY absent forces null fallback, and
// our test setup intentionally leaves it unset for this test file).

import { classifyOne } from '../lib/operators/classifier.js';

const CASES = [
  {
    name: 'Brain-routing safety valve — explicit',
    body: 'Add this to the living archive: Marin\'s leadership arc since 2017. The FOH overhaul she ran was the real pivot point.',
    expect: { captureType: 'Undecided', via: /brain-routing-valve/ },
  },
  {
    name: 'Brain-routing safety valve — voice phrasing',
    body: 'Note for the brain — we should consider doctrine around how the operators handle multi-promotion races. Just thinking out loud.',
    expect: { captureType: 'Undecided', via: /brain-routing-valve/ },
  },
  {
    name: 'Voice cue — i need to',
    body: 'I need to call Brody about the Triple Seat API key before the end of the week. Important.',
    expect: { captureType: 'Task', captureDomain: 'STB', via: /cue-parser/ },
  },
  {
    name: 'Voice cue — remind me to',
    body: 'Remind me to deadlift on Saturday, going for a PR on the conventional setup. Form check on the warmup sets.',
    expect: { captureType: 'Task', captureDomain: 'Strength Training', via: /cue-parser/ },
  },
  {
    name: 'Voice cue — imperative verb at start',
    body: 'Call the dentist about that filling I keep putting off. They had a slot for next Tuesday.',
    expect: { captureType: 'Task', captureDomain: 'Health', via: /cue-parser/ },
  },
  {
    name: 'Decision-language anti-pattern — should I → Note',
    body: 'Should I push the QBO migration before Party Pay or after? Both have payable dependencies and I want to think through the sequencing.',
    expect: { captureType: 'Note', via: /decision-lang-demote|cue-parser/ },
  },
  {
    name: 'Decision-language — wondering if I should',
    body: 'Wondering if I should hire a second sales rep for the Houston territory or wait until Q3 to see how distribution shapes up.',
    expect: { captureType: 'Note', via: /cue-parser|llm/ },
  },
  {
    name: 'Texzas hard short-circuit (even with STB person present)',
    body: 'I need to send Marin the Texzas marketing plan draft so she can review the brand voice before we publish. Side hustle priority.',
    expect: { captureType: 'Task', captureDomain: 'Side Hustles' },
  },
  {
    name: 'STB system cue — Triple Seat',
    body: 'Triple Seat: confirm the API access request came through and Garrison can pull the bookings feed for the dashboard.',
    expect: { captureType: 'Task', captureDomain: 'STB' },
  },
  {
    name: 'Distributor cue — Silver Eagle',
    body: 'Silver Eagle DOH report integration — figure out whether it\'s API or file-drop. Need this for the distributor inventory feed.',
    expect: { captureType: 'Task', captureDomain: 'STB' },
  },
  {
    name: 'BJJ → Health domain (no Task cue → default Note)',
    body: 'Sparring tomorrow with the purple belt at the academy, focus on guard retention against pressure passes. Bring the no-gi pants.',
    expect: { captureType: 'Note', captureDomain: 'Health' },
  },
  {
    name: 'Finance cue — QBO',
    body: 'QBO migration: CC classification needs to be done before the sales tax liability report is correct. Talk to bookkeeper.',
    expect: { captureType: 'Task', captureDomain: 'Finance' },
  },
  {
    name: 'Note cue — note that',
    body: 'Note that the Living Archive flag mechanism Architect shipped lets the Console show stub rows pending narrative. Don\'t need to act on this.',
    // Brain-routing valve catches "Living Archive" first → Undecided
    expect: { captureType: 'Undecided', via: /brain-routing-valve/ },
  },
  {
    name: 'No cues at all — falls through to LLM (which is stubbed to null here)',
    body: 'The neighborhood association meeting last night ran long and they\'re proposing a leash ordinance change. Annoying but minor.',
    expect: { captureType: 'Undecided', via: /llm-error|llm/ }, // LLM disabled in test → fallback to Undecided
  },
];

function matchExpect(actual, expected) {
  for (const [k, v] of Object.entries(expected)) {
    if (v instanceof RegExp) {
      if (!v.test(actual[k] || '')) return false;
    } else {
      if (actual[k] !== v) return false;
    }
  }
  return true;
}

(async () => {
  // Force LLM-disabled for deterministic test (the test framework should
  // exercise the cue parser, not the LLM).
  delete process.env.ANTHROPIC_API_KEY;

  let pass = 0;
  let fail = 0;
  const failures = [];

  for (const c of CASES) {
    const stubRow = {
      id: 'test-' + c.name.replace(/\s+/g, '-').slice(0, 30),
      url: 'about:blank',
      title: '',
      body: c.body,
      promotionNotes: '',
    };
    const r = await classifyOne(stubRow, { dryRun: true });
    const ok = matchExpect(r.result, c.expect);
    if (ok) {
      pass++;
      console.log(`  ✓  ${c.name}`);
      console.log(`         → type=${r.result.captureType} domain=${r.result.captureDomain || '-'} via=${r.result.via}`);
    } else {
      fail++;
      failures.push({ case: c.name, expected: c.expect, actual: r.result });
      console.log(`  ✗  ${c.name}`);
      console.log(`         expected: ${JSON.stringify(c.expect)}`);
      console.log(`         actual:   type=${r.result.captureType} domain=${r.result.captureDomain || '-'} via=${r.result.via} title="${r.result.title}"`);
    }
  }

  console.log(`\n${pass}/${pass + fail} passed${fail > 0 ? `, ${fail} failed` : ''}`);
  if (fail > 0) process.exit(1);
})();
