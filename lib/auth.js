// Google sign-in + role verification for the STB App API functions.
// Pattern cloned from the Master Calendar's proven gate (cache + retry + stale
// fallback on the shared "STB Allowed Users" Notion list), extended with
// role tags: a user's Tools multi-select on the list decides which app
// spaces they may enter. "Exec" grants every space.
//
// Behaviour:
//  - If VITE_GOOGLE_CLIENT_ID is set (production on Vercel), every API call
//    must carry a valid Google ID token for an account on the allow-list.
//  - If it is not set (local `npm run dev`), the gate is skipped — but never
//    on Vercel, where a missing client id fails closed.

const SPACE_TAGS = ['Exec', 'Production', 'Events', 'Taproom', 'Sales', 'Marketing', 'R&D']

function fail(message, status) {
  return Object.assign(new Error(message), { status })
}

const ALLOWED_DS = process.env.NOTION_ALLOWED_DS

// Cache + retry + last-known-good, same rationale as the calendar (2026-06-25
// hardening): the list is read on every request and Notion intermittently
// rate-limits; a blip must not bounce a legitimate user.
const ALLOW_CACHE_TTL_MS = 60 * 1000
const ALLOW_MAX_RETRIES = 3
let allowCache = { at: 0, users: null } // Map<email, Set<tag>>

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function queryAllowList(token, body) {
  let lastErr
  for (let attempt = 0; attempt <= ALLOW_MAX_RETRIES; attempt++) {
    let resp
    try {
      resp = await fetch('https://api.notion.com/v1/data_sources/' + ALLOWED_DS + '/query', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Notion-Version': '2025-09-03',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (e) {
      lastErr = e
      await sleep(250 * Math.pow(2, attempt))
      continue
    }
    if (resp.ok) return resp.json()
    if (resp.status === 429 || resp.status >= 500) {
      lastErr = new Error('Notion allow-list query ' + resp.status)
      const ra = Number(resp.headers.get('retry-after'))
      await sleep(ra > 0 ? ra * 1000 : 250 * Math.pow(2, attempt))
      continue
    }
    throw new Error('Notion allow-list query ' + resp.status)
  }
  throw lastErr || new Error('Notion allow-list query failed')
}

// Map of lowercased email -> Set of Tools tags, for Active rows.
async function allowedUsers(token) {
  if (allowCache.users && Date.now() - allowCache.at < ALLOW_CACHE_TTL_MS) {
    return allowCache.users
  }
  try {
    const users = new Map()
    let cursor
    do {
      const body = {
        page_size: 100,
        filter: { property: 'Active', checkbox: { equals: true } },
      }
      if (cursor) body.start_cursor = cursor
      const data = await queryAllowList(token, body)
      for (const row of data.results || []) {
        const props = row.properties || {}
        const p = props.Email
        let email = null
        if (p) {
          if (p.type === 'email') email = p.email
          else if (p.type === 'rich_text') email = (p.rich_text || []).map((t) => t.plain_text).join('')
        }
        if (!email) continue
        const tags = new Set(
          ((props.Tools && props.Tools.multi_select) || []).map((o) => o.name)
        )
        users.set(email.trim().toLowerCase(), tags)
      }
      cursor = data.has_more ? data.next_cursor : null
    } while (cursor)
    allowCache = { at: Date.now(), users }
    return users
  } catch (err) {
    if (allowCache.users) return allowCache.users // serve last-known-good
    throw err
  }
}

// Which app spaces this set of tags admits. Exec sees everything.
function spacesFor(tags) {
  if (tags.has('Exec')) return SPACE_TAGS.slice()
  return SPACE_TAGS.filter((s) => tags.has(s))
}

// Verifies the Google ID token and looks the user up on the allow-list.
// Returns { email, spaces } — or { email: null, spaces: [all] } when the gate
// is intentionally skipped (local dev with no client id configured).
export async function requireAuth(req) {
  const clientId = process.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    if (process.env.VERCEL) throw fail('Sign-in is not configured', 500)
    return { email: null, spaces: SPACE_TAGS.slice() } // local dev — no gate
  }
  if (!process.env.NOTION_TOKEN || !ALLOWED_DS) {
    throw fail('Access list is not configured', 500)
  }

  const header = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw fail('Please sign in', 401)

  const resp = await fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token)
  )
  if (!resp.ok) throw fail('Your sign-in has expired — please sign in again', 401)
  const info = await resp.json()

  if (info.aud !== clientId) throw fail('Sign-in token was not issued for this app', 401)
  if (String(info.email_verified) !== 'true')
    throw fail('Your Google email is not verified', 403)

  const email = String(info.email || '').toLowerCase()
  let users
  try {
    users = await allowedUsers(process.env.NOTION_TOKEN)
  } catch (err) {
    // Fail closed but politely; the raw cause (rate limit, revoked share,
    // wrong DS id) goes to the server log, not the user's face.
    console.error('[auth] allow-list unavailable:', err.message)
    throw fail('Could not verify access right now — please try again in a minute.', 503)
  }
  const tags = users.get(email)
  if (!tags) throw fail('You are not authorized for the STB App. Contact Garrison to be added.', 403)

  const spaces = spacesFor(tags)
  if (spaces.length === 0)
    throw fail('Your account has no app spaces yet. Contact Garrison for access.', 403)

  return { email, spaces }
}

// Like requireAuth, but the user must hold the given space (or Exec).
export async function requireSpace(req, space) {
  const user = await requireAuth(req)
  if (!user.spaces.includes(space))
    throw fail('You do not have access to the ' + space + ' space.', 403)
  return user
}
