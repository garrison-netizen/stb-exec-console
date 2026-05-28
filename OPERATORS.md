# Operators (Capture Classifier + GTD Promoter)

The two headless polling agents per ADR-007 (Promoter) and ADR-009 (Classifier). Both run on a schedule against the Capture Inbox in Garrison's Personal Dashboard.

```
Capture (any source) → Capture Inbox row (Pending promotion)
   ↓                          ↓
[Classifier, every 5 min]    [Promoter, every 15 min]
   • fills Capture type        • Undecided → Held for Garrison
   • fills Capture domain      • Thin body → Bounced
   • fills Title               • Mapped → UB Tasks/Notes/Projects
   • fills Suggested project   • Audit trail in Promotion notes
   • adds Classifier trace     • Status → Promoted, Resolved at set
```

## Running locally

```bash
npm run classifier:dry     # plan only, no writes
npm run classifier         # live
npm run promoter:dry       # plan only, no writes
npm run promoter           # live (writes UB destination rows)
```

The Classifier needs `ANTHROPIC_API_KEY` only if you want the LLM fallback (used when no cue dictionary entries match). Without a key, low-confidence captures route to Undecided cleanly.

## Production setup (cron deployment)

Schedule lives in **GitHub Actions** (free, 5-min minimum granularity). Each scheduled run hits a **Vercel serverless endpoint** that fires one polling pass.

### One-time setup steps

**1. Vercel project env vars** (Settings → Environment Variables, Production scope)

Copy these from your local `.env` to the Vercel project:

- `NOTION_TOKEN`
- `NOTION_CAPTURE_INBOX_DS`
- `NOTION_UB_TASKS_DS`
- `NOTION_UB_NOTES_DS`
- `NOTION_UB_PROJECTS_DS`
- `ANTHROPIC_API_KEY` (optional, for LLM fallback)
- `ANTHROPIC_CLASSIFIER_MODEL` (defaults to `claude-haiku-4-5`)
- `CRON_SECRET` (generate a fresh value — see below)

**2. Generate a CRON_SECRET** (or use the one Code generated)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set the same value in **both**:
- Vercel project env vars (as `CRON_SECRET`)
- GitHub repo secrets (as `CRON_SECRET`)

**3. GitHub repo secrets** (Settings → Secrets and variables → Actions)

- `CRON_SECRET` — same value you set in Vercel
- `CONSOLE_BASE_URL` — your Vercel production URL (e.g. `https://stb-exec-console.vercel.app`), no trailing slash

**4. Push to `main`**

Vercel auto-deploys; GitHub Actions auto-picks up the new workflows. Cron schedules begin firing within 5 minutes.

### Verifying cron is running

GitHub repo → **Actions** tab → look for "Run Capture Classifier" and "Run GTD Promoter" workflows. You'll see one run every 5 / 15 minutes. Click into any run to see the HTTP response from the Vercel endpoint (row count, results).

You can also fire a one-off run manually: Actions → workflow → **Run workflow** button.

## Endpoint contract

Both endpoints accept POST with `Authorization: Bearer <CRON_SECRET>`. Optional `{ dryRun: true }` body for plan-only.

```
POST /api/operators/classifier
POST /api/operators/gtd-promoter
```

Response shape:
```json
{
  "ok": true,
  "polledAt": "2026-05-28T21:07:17Z",
  "rowCount": 1,
  "results": [ ... ]
}
```

## Audit trail

Every Operator action writes to the Capture Inbox row's **Promotion notes** field. Each role prefixes its own header so traces layer cleanly:

```
## Classifier trace (2026-05-28T21:00:00Z)
- Via: cue-parser
- Capture type: Task
- ...

## Promotion trace (2026-05-28T21:07:19Z)
- Outcome: Promoted
- Destination: UB Task
- Destination URL: ...
- Project relation: matched "Brain Build"
```

## Safety design

- **Classifier** never overwrites pre-set fields. Only fills blanks.
- **Promoter** never updates existing UB rows. Create-only.
- **Low confidence** → Capture type = Undecided → Promoter routes to Held for Garrison (no bad data lands in your Tasks DB).
- **Draft-hold** — every Operator-promoted Task lands with label `🤖 Operator draft`. Filter your daily views to exclude this label; release Tasks by removing the label.
- **Reverse-pointer** — every destination row carries a trailer linking back to its Capture Inbox source, so promotions are always traceable.

## What's deferred

- **Notes/Projects mapping** is basic — Title + body + status only. Type defaults to "Reference" on Notes. Refine when the first real Note/Project capture flows through.
- **Dedicated narrow integrations** per Operator (Architect's recommendation) — currently both use the existing Console integration. Swap is a one-env-var change.
- **Channel relay for circuit-breaker failures** — if an Operator hits >5 consecutive failures, the GitHub Actions workflow will show as red. Code (the chat agent) sees this on next /refresh and writes a channel message on Garrison's behalf.
