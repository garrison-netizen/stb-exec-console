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

// Read one page's content as plain text (one level of nesting).
async function pageText(pageId) {
  const blocks = await listChildren(pageId)
  const lines = []
  for (const b of blocks) {
    const line = blockText(b)
    if (line) lines.push(line)
    if (b.has_children && b.type !== 'child_page' && b.type !== 'child_database') {
      try {
        const kids = await listChildren(b.id)
        for (const k of kids) {
          const kl = blockText(k)
          if (kl) lines.push('  ' + kl)
        }
      } catch { /* nested read is best-effort */ }
    }
  }
  return lines.join('\n').slice(0, MAX_CONTEXT_CHARS)
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
          bySpace[title.toLowerCase()] = await pageText(b.id)
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
