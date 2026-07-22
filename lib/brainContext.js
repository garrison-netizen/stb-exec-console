// Brain context for the department assistants.
//
// Each assistant's SQL database covers its numbers; this layer adds the
// judgment context that lives in the Brain — who's who, current priorities,
// product facts, department quirks. Mechanism (mechanical, Architect-ownable):
// one "Console Context" parent page in the Brain, shared with the Console
// integration, with a CHILD PAGE PER SPACE ("Production", "Events", "Sales",
// "Marketing"…). Whatever prose is on a child page is injected into that
// assistant's system prompt, refreshed every 15 minutes. No page, no env var,
// or an unreadable page all degrade to "no extra context" — never an error.

const cleanEnv = (v) => (v || '').trim().replace(/^["']|["']$/g, '').trim()
const NOTION_TOKEN = cleanEnv(process.env.NOTION_TOKEN)
const CONTEXT_PAGE = cleanEnv(process.env.NOTION_CONSOLE_CONTEXT_PAGE)

const BLOCKS_VERSION = '2022-06-28'
const CACHE_MS = 15 * 60 * 1000
const MAX_CONTEXT_CHARS = 12000

let cache = { at: 0, bySpace: null }

async function listChildren(blockId) {
  const out = []
  let cursor = null
  let guard = 0
  do {
    const url =
      `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100` +
      (cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : '')
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': BLOCKS_VERSION },
    })
    if (!res.ok) throw new Error(`blocks ${res.status}`)
    const data = await res.json()
    out.push(...(data.results || []))
    cursor = data.has_more ? data.next_cursor : null
    guard += 1
  } while (cursor && guard < 20)
  return out
}

function blockText(block) {
  const t = block.type
  const v = block[t] || {}
  const rich = (v.rich_text || []).map((r) => r.plain_text || '').join('')
  switch (t) {
    case 'heading_1': return `# ${rich}`
    case 'heading_2': return `## ${rich}`
    case 'heading_3': return `### ${rich}`
    case 'bulleted_list_item':
    case 'numbered_list_item': return `- ${rich}`
    case 'to_do': return `- [${v.checked ? 'x' : ' '}] ${rich}`
    case 'quote': return `> ${rich}`
    case 'callout': return `NOTE: ${rich}`
    case 'divider': return '---'
    default: return rich
  }
}

// Collect page ids referenced by a block: link_to_page blocks and inline
// page mentions. This makes each space's context page a POINTER PAGE — drop
// links to real Brain pages on it and the assistant reads those pages too.
function linkedPageIds(block) {
  const ids = []
  if (block.type === 'link_to_page' && block.link_to_page?.page_id) {
    ids.push(block.link_to_page.page_id)
  }
  const v = block[block.type] || {}
  for (const r of v.rich_text || []) {
    if (r.type === 'mention' && r.mention?.type === 'page' && r.mention.page?.id) {
      ids.push(r.mention.page.id)
    }
  }
  return ids
}

async function pageTitle(pageId) {
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': BLOCKS_VERSION },
    })
    if (!res.ok) return null
    const data = await res.json()
    for (const prop of Object.values(data.properties || {})) {
      if (prop.type === 'title') return (prop.title || []).map((t) => t.plain_text || '').join('')
    }
  } catch { /* best-effort */ }
  return null
}

// Read one page's content as plain text (one level of nesting). When
// followLinks is true, pages linked/mentioned from this page are read too
// (one hop only, no recursion) — that is the "authorized areas" mechanism:
// exactly the pages someone deliberately linked, nothing else.
async function pageText(pageId, followLinks = false) {
  const blocks = await listChildren(pageId)
  const lines = []
  const linked = []
  for (const b of blocks) {
    if (followLinks) linked.push(...linkedPageIds(b))
    const line = blockText(b)
    if (line) lines.push(line)
    if (b.has_children && b.type !== 'child_page' && b.type !== 'child_database') {
      try {
        const kids = await listChildren(b.id)
        for (const k of kids) {
          if (followLinks) linked.push(...linkedPageIds(k))
          const kl = blockText(k)
          if (kl) lines.push('  ' + kl)
        }
      } catch { /* nested read is best-effort */ }
    }
  }
  let out = lines.join('\n')
  if (followLinks) {
    for (const id of [...new Set(linked)]) {
      if (out.length >= MAX_CONTEXT_CHARS) break
      try {
        const [title, body] = await Promise.all([pageTitle(id), pageText(id, false)])
        if (body && body.trim()) {
          out += `\n\n--- Linked Brain page: ${title || id} ---\n${body}`
        }
      } catch (err) {
        console.error(`[brainContext] linked page ${id} unreadable:`, (err && err.message) || String(err))
      }
    }
  }
  return out.slice(0, MAX_CONTEXT_CHARS)
}

async function loadAllContexts() {
  if (cache.bySpace && Date.now() - cache.at < CACHE_MS) return cache.bySpace
  const bySpace = {}
  if (NOTION_TOKEN && CONTEXT_PAGE) {
    try {
      const children = await listChildren(CONTEXT_PAGE)
      for (const b of children) {
        if (b.type !== 'child_page') continue
        const title = (b.child_page && b.child_page.title) || ''
        if (!title) continue
        try {
          bySpace[title.toLowerCase()] = await pageText(b.id, true)
        } catch (err) {
          console.error(`[brainContext] failed reading "${title}":`, err.message)
        }
      }
    } catch (err) {
      // Missing share, bad id, Notion blip — assistants run without context.
      console.error('[brainContext] context page unavailable:', err.message)
    }
  }
  cache = { at: Date.now(), bySpace }
  return bySpace
}

// Returns a system-prompt section for the space, or '' when none exists.
export async function brainContextFor(space) {
  const bySpace = await loadAllContexts()
  const text = bySpace[String(space || '').toLowerCase()]
  if (!text || !text.trim()) return ''
  return (
    `\n\nDEPARTMENT CONTEXT (maintained in the company Brain — treat as current
business truth; it may be newer than your other instructions):\n${text.trim()}\n`
  )
}
