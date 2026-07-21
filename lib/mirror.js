// Loads the Ekos mirror (SQLite) for the Production chatbot, via sql.js (pure
// WASM — no native builds, safe on Vercel). The mirror is produced by
// stb-consumers/tools/ekos/sync-mirror.js and lands in this project's PRIVATE
// Blob store via api/mirror-upload.js.
//
// Sources, in order:
//   MIRROR_FILE            — explicit local path (dev)
//   BLOB_READ_WRITE_TOKEN  — production: read 'ekos-mirror.sqlite' from the
//                            project's private Blob store
//   MIRROR_URL             — plain URL fallback (public store, if ever used)
//   default                — ../stb-consumers/tools/ekos/out/ekos-mirror.sqlite
//
// The database handle is cached in module scope (warm serverless instances
// reuse it); the blob store is re-checked at most every 15 minutes.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'

const require = createRequire(import.meta.url)

const PATHNAME = 'ekos-mirror.sqlite'
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

// Fetch a blob URL, adding the store token when the store is private.
async function fetchBlob(url, token) {
  let resp = await fetch(url)
  if ((resp.status === 401 || resp.status === 403) && token) {
    resp = await fetch(url, { headers: { authorization: 'Bearer ' + token } })
  }
  if (!resp.ok) throw new Error('Mirror download failed: ' + resp.status)
  return new Uint8Array(await resp.arrayBuffer())
}

async function fromBlobStore(token) {
  if (cache.db && Date.now() - cache.checkedAt < REMOTE_RECHECK_MS) return cache
  const { list } = await import('@vercel/blob')
  let blob
  try {
    const { blobs } = await list({ token, prefix: PATHNAME, limit: 5 })
    blob = (blobs || []).find((b) => b.pathname === PATHNAME) || (blobs || [])[0]
  } catch (err) {
    if (cache.db) return cache // serve last-known-good
    throw err
  }
  if (!blob) {
    if (cache.db) return cache
    throw new Error('No mirror uploaded yet. Run the Ekos sync (stb-consumers/tools/ekos: npm run sync:full).')
  }
  const stamp = String(blob.uploadedAt || blob.url)
  if (cache.db && stamp === cache.sourceStamp) {
    cache.checkedAt = Date.now()
    return cache
  }
  const bytes = await fetchBlob(blob.downloadUrl || blob.url, token)
  return openFrom(bytes, stamp)
}

export async function getMirror() {
  const file = process.env.MIRROR_FILE
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  const url = process.env.MIRROR_URL

  if (file) {
    const mtime = String(fs.statSync(file).mtimeMs)
    if (cache.db && cache.sourceStamp === mtime) return cache
    return openFrom(fs.readFileSync(file), mtime)
  }
  if (blobToken) return fromBlobStore(blobToken)
  if (url) {
    if (cache.db && Date.now() - cache.checkedAt < REMOTE_RECHECK_MS) return cache
    const bytes = await fetchBlob(url, null)
    return openFrom(bytes, String(Date.now()))
  }
  const fallback = defaultLocalPath()
  if (!fs.existsSync(fallback)) {
    throw new Error(
      'Ekos mirror not found. Run the sync (stb-consumers/tools/ekos: npm run sync) or set MIRROR_FILE.'
    )
  }
  const mtime = String(fs.statSync(fallback).mtimeMs)
  if (cache.db && cache.sourceStamp === mtime) return cache
  return openFrom(fs.readFileSync(fallback), mtime)
}
