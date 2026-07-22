// The Production chatbot engine: Claude + a read-only SQL tool over the Ekos
// mirror. Shared by api/chat.js (Vercel) and the Vite dev middleware.

import Anthropic from '@anthropic-ai/sdk'
import { getMirror } from './mirror.js'
import { buildSystemPrompt } from './schema.js'
import { brainContextFor } from './brainContext.js'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const MAX_TOOL_ROUNDS = 12
const MAX_RESULT_ROWS = 300
const MAX_RESULT_CHARS = 30000
const MAX_HISTORY = 30

const FORBIDDEN = /\b(attach|detach|pragma|vacuum|insert|update|delete|drop|create|alter|replace|reindex|analyze|begin|commit|rollback|savepoint|release)\b/i

// Allow only a single SELECT/WITH statement. The mirror is an in-memory copy,
// so writes could not reach Ekos anyway — this keeps the tool honest.
export function guardSql(sql) {
  const cleaned = String(sql || '')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .replace(/;+\s*$/, '')
  if (!cleaned) throw new Error('Empty SQL')
  if (cleaned.includes(';')) throw new Error('Only a single statement is allowed')
  if (!/^(select|with)\b/i.test(cleaned)) throw new Error('Only SELECT queries are allowed')
  if (FORBIDDEN.test(cleaned)) throw new Error('Query contains a forbidden keyword')
  return cleaned
}

export function runQuery(db, sql) {
  const cleaned = guardSql(sql)
  const results = db.exec(cleaned)
  if (!results.length) return { rows: [], note: 'No rows returned.' }
  const { columns, values } = results[0]
  const total = values.length
  const rows = values.slice(0, MAX_RESULT_ROWS).map((v) => {
    const obj = {}
    columns.forEach((c, i) => (obj[c] = v[i]))
    return obj
  })
  let payload = JSON.stringify(rows)
  let note = total > MAX_RESULT_ROWS ? `Returned ${total} rows; truncated to ${MAX_RESULT_ROWS}.` : ''
  if (payload.length > MAX_RESULT_CHARS) {
    payload = payload.slice(0, MAX_RESULT_CHARS)
    note = 'Result too large; JSON truncated. Aggregate more tightly.'
  }
  return { rows, payload, note, total }
}

const TOOLS = [
  {
    name: 'query',
    description:
      'Run one read-only SQLite SELECT against the Spindletap Ekos mirror. Returns rows as JSON. Prefer aggregated queries with LIMIT.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'A single SELECT (or WITH...SELECT) statement.' } },
      required: ['sql'],
    },
  },
]

function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
}

export async function handleChat(body, email) {
  const { db, syncedAt } = await getMirror()
  return runChat({
    body,
    email,
    db,
    system: buildSystemPrompt(syncedAt) + (await brainContextFor('Production')),
    toolDescription:
      'Run one read-only SQLite SELECT against the Spindletap Ekos mirror. Returns rows as JSON. Prefer aggregated queries with LIMIT.',
    dataAsOf: syncedAt,
    label: 'chat',
  })
}

// Generic engine: Claude + one read-only SQL tool over any sql.js database.
// Department assistants (Production/Ekos, Events/Tripleseat) share this loop.
// extraTools: optional [{ definition, handler(input) -> string }] beyond SQL.
export async function runChat({ body, email, db, system, toolDescription, dataAsOf, label = 'chat', extraTools = [] }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('The assistant is not configured yet (missing ANTHROPIC_API_KEY).')
    err.status = 503
    throw err
  }
  const history = sanitizeHistory(body && body.messages)
  if (!history.length || history[history.length - 1].role !== 'user') {
    const err = new Error('Send at least one user message')
    err.status = 400
    throw err
  }

  const client = new Anthropic()
  const tools = [
    { ...TOOLS[0], description: toolDescription || TOOLS[0].description },
    ...extraTools.map((t) => t.definition),
  ]
  const handlers = Object.fromEntries(extraTools.map((t) => [t.definition.name, t.handler]))
  const messages = history.map((m) => ({ role: m.role, content: m.content }))

  // Broad analytical questions can spiral into many research rounds; budget
  // wall-clock so we always land a useful answer instead of a platform timeout.
  const startedAt = Date.now()
  const TIME_BUDGET_MS = 3.5 * 60 * 1000 // function ceiling is 300s; land well before it

  let response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system,
    messages,
    tools,
  })

  let rounds = 0
  const queries = []
  while (response.stop_reason === 'tool_use' && rounds < MAX_TOOL_ROUNDS) {
    rounds++
    const toolResults = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      let resultText
      try {
        if (block.name === 'query') {
          const { payload, note } = runQuery(db, block.input && block.input.sql)
          queries.push(block.input.sql)
          resultText = (note ? note + '\n' : '') + (payload || '[]')
        } else if (handlers[block.name]) {
          resultText = String(await handlers[block.name](block.input || {}))
        } else {
          resultText = 'Unknown tool: ' + block.name
        }
      } catch (err) {
        resultText = ((block.name === 'query' ? 'SQL' : block.name) + ' error: ') + ((err && err.message) || String(err))
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultText })
    }
    const outOfTime = Date.now() - startedAt > TIME_BUDGET_MS || rounds >= MAX_TOOL_ROUNDS
    if (outOfTime) {
      toolResults[toolResults.length - 1].content +=
        '\n\n[Research time is up — give your best answer from the data gathered so far, and say what you would have checked next.]'
    }
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system,
      messages,
      tools,
      // Once out of time, forbid further tool calls so this reply is the answer.
      ...(outOfTime ? { tool_choice: { type: 'none' } } : {}),
    })
  }

  const reply = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

  console.log(`[${label}] ${email || 'dev'} — ${rounds} tool round(s), ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}`)
  return {
    ok: true,
    reply: reply || 'I could not produce an answer — please try rephrasing.',
    dataAsOf,
  }
}
