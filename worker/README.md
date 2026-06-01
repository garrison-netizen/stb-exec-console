# Voice Capture Worker

Tiny Cloudflare Worker that turns voice-memo transcripts into Capture Inbox rows. Per ADR-008.

```
[iPhone Action Button] → [Whisper Memos] → [this Worker] → [Capture Inbox]
                                                                  ↓
                                              [Classifier → Promoter → UB Task]
```

## What it does

- Accepts `POST` with a transcript (`text` / `transcript` / `body` field).
- Writes a Capture Inbox row: `Captured by = Garrison`, `Promotion status = Pending promotion`, `Capture type` left empty so the Classifier picks it up.
- Returns the Notion page URL.

Isolated from the Console deploy by design: capture must never fail because a UI deploy is mid-rollback.

## Deploy (5 minutes, no CLI required)

You can do this entirely from the Cloudflare dashboard.

### Step 1 — Create the Worker

1. Sign in at **https://dash.cloudflare.com** (free account if you don't have one).
2. Left sidebar → **Workers & Pages** → **Create application** → **Create Worker**.
3. Give it a name: `stb-voice-capture`. Click **Deploy** (with the default Hello World code — we'll replace it next).
4. After deploy, click **Edit code**.
5. Delete everything in the editor. Paste the contents of `voice-capture-worker.js` from this folder.
6. Click **Save and deploy**.

### Step 2 — Set the three secrets

In the Worker's page → **Settings** → **Variables and Secrets** → **Add variable**.

Add these three, each as **Type: Secret** (encrypted):

| Variable name | Value |
|---|---|
| `NOTION_TOKEN` | `ntn_E76081234359MTVKJjw23JhfSqusNLy2hgqMGJzpbfjfyB` *(same Console integration token; reuse from your `.env.vercel`)* |
| `NOTION_CAPTURE_INBOX_DS` | `6a008419-485f-4c2e-b162-895090931abb` |
| `WORKER_SECRET` | *(generate a fresh random string — e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — save this; you'll paste it into Whisper Memos)* |

Click **Save and deploy** after adding them.

### Step 3 — Note your Worker URL

The dashboard shows it at the top — something like:

```
https://stb-voice-capture.<your-cloudflare-subdomain>.workers.dev
```

### Step 4 — Sanity check

Hit it from your browser. You should see:

```json
{"ok":true,"worker":"voice-capture","message":"POST with Authorization: Bearer <WORKER_SECRET> to capture."}
```

Then test the POST path from your machine (in PowerShell or curl):

```powershell
$secret = "<your WORKER_SECRET>"
Invoke-WebRequest -UseBasicParsing `
  -Uri "https://stb-voice-capture.<your-subdomain>.workers.dev/" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"; "Authorization"="Bearer $secret"} `
  -Body '{"text":"test from worker — should land in capture inbox"}'
```

You should get back `{"ok":true,"id":"...","url":"...","length":48}` and see a new row in your Capture Inbox.

## Wire Whisper Memos to it

In **Whisper Memos** (iOS / macOS app):

1. Open the app → **Settings** → **Integrations** (or **Webhooks**, depending on version).
2. Add a new webhook:
   - **URL:** your Worker URL from Step 3
   - **Method:** POST
   - **Headers:**
     - `Authorization: Bearer <your WORKER_SECRET>`
     - `Content-Type: application/json`
   - **Body template:**
     ```json
     {"text": "{{transcript}}", "duration": "{{duration}}"}
     ```
     *(Whisper Memos templating syntax — adjust if the variable names differ in your version.)*
3. Map the **iPhone Action Button** to "Record a Whisper Memo" via iOS Settings → Action Button → Whisper Memos shortcut.

Press the Action Button → speak → release → the transcript becomes a Capture Inbox row within ~3 seconds. Classifier picks it up next 5-min poll, Promoter lands it as a UB Task within 15-min of the Classifier finishing.

## Deploy via CLI instead (optional)

If you'd rather use wrangler from the command line:

```bash
cd worker
npm install
npx wrangler login                 # one-time browser auth
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put NOTION_CAPTURE_INBOX_DS
npx wrangler secret put WORKER_SECRET
npx wrangler deploy
```

Subsequent deploys: just `npx wrangler deploy` after editing the .js file.

## Costs

- Cloudflare Workers free tier: 100,000 requests/day. You'd need to record ~70 voice memos per minute, every minute, all day, to hit it.
- Notion API: free with rate limit of ~3 req/sec sustained — well above expected use.
- Total monthly cost: **$0** at any realistic personal use volume.

## What this Worker doesn't do (deferred)

- Doesn't transcribe audio itself — Whisper Memos / SuperWhisper / etc. do that on-device.
- Doesn't preserve audio files. The transcript is the canonical capture.
- Doesn't retry on Notion API 5xx — the Notion API is rock solid; if you need retries, add them as a follow-up.
- Doesn't deduplicate. If the same transcript is sent twice, you get two rows.
