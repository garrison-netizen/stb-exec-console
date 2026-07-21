// Loads the Ekos mirror (SQLite) for the Production chatbot, via sql.js (pure
// WASM — no native builds, safe on Vercel). The mirror is produced by
// stb-consumers/tools/ekos/sync-mirror.js.
//
// Sources, in order:
//   MIRROR_URL  — production: URL of ekos-mirror.sqlite in Vercel Blob
//   MIRROR_FILE — explicit local path
//   default     — ../stb-consumers/tools/ekos/out/ekos-mirror.sqlite (local dev)
//
// The database handle is cached in module scope (warm serverless instances
// reuse it); remote mirrors are re-checked at most every 15 minutes.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'

const require = createRequire(import.meta.url)

const REMOTE_RECHECK_MS = 15 * 60 * 1000

let SQL = null
let cache = { db: null, sourceStamp: null, checkedAt: 0, syncedAt: null }

async function ensureSqlJs() {
  if (SQL) return SQL
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) })
  return SQL
}

function defaultLocalPath() {
  return path.resolve(process.cwd(), '..', 'stb-consumers', 'tools', 'ekos', 'out', 'ekos-mirror.sqlite')
}

function readSyncedAt(db) {
  try {
    const res = db.exec('SELECT MAX(synced_at) AS s FROM sync_meta')
    return (res[0] && res[0].values[0] && res[0].values[0][0]) || null
  } catch {
    return null
  }
}

async function openFrom(bytes, sourceStamp) {
  const sqljs = await ensureSqlJs()
  if (cache.db) cache.db.close()
  const db = new sqljs.Database(bytes)
  cache = { db, sourceStamp, checkedAt: Date.now(), syncedAt: readSyncedAt(db) }
  return cache
}

export async function getMirror() {
  const url = process.env.MIRROR_URL
  const file = process.env.MIRROR_FILE || defaultLocalPath()

  if (url) {
    if (cache.db && Date.now() - cache.checkedAt < REMOTE_RECHECK_MS) return cache
    const head = await fetch(url, { method: 'HEAD' }).catch(() => null)
    const stamp = head && (head.headers.get('etag') || head.headers.get('last-modified'))
    if (cache.db && stamp && stamp === cache.sourceStamp) {
      cache.checkedAt = Date.now()
      return cache
    }
    const resp = await fetch(url)
    if (!resp.ok) {
      if (cache.db) return cache // serve last-known-good
      throw new Error('Mirror download failed: ' + resp.status)
    }
    const bytes = new Uint8Array(await resp.arrayBuffer())
    return openFrom(bytes, stamp || String(Date.now()))
  }

  if (!fs.existsSync(file)) {
    throw new Error(
      'Ekos mirror not found. Run the sync (stb-consumers/tools/ekos: npm run sync) or set MIRROR_URL/MIRROR_FILE.'
    )
  }
  const mtime = String(fs.statSync(file).mtimeMs)
  if (cache.db && cache.sourceStamp === mtime) return cache
  return openFrom(fs.readFileSync(file), mtime)
}
