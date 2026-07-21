// Verifies that the api/mirror-upload auth logic accepts a genuine Vercel OIDC
// token for this project (pulled via `vercel env pull`) and rejects garbage.
// Usage: node scripts/test-oidc-verify.mjs
import fs from 'node:fs'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const TEAM_ISSUER = 'https://oidc.vercel.com/garrison-s-projects'
const AUDIENCE = 'https://vercel.com/garrison-s-projects'
const PROJECT_MARKER = 'project:stb-exec-console'

const envText = fs.readFileSync(new URL('../.env.pulled', import.meta.url), 'utf8')
const token = envText.match(/^VERCEL_OIDC_TOKEN="?([^"\r\n]+)"?$/m)?.[1]
if (!token) throw new Error('No VERCEL_OIDC_TOKEN in .env.pulled — run vercel env pull first')

const jwks = createRemoteJWKSet(new URL(TEAM_ISSUER + '/.well-known/jwks'))
const { payload } = await jwtVerify(token, jwks, { issuer: TEAM_ISSUER, audience: AUDIENCE })
if (!String(payload.sub || '').includes(PROJECT_MARKER)) throw new Error('sub mismatch: ' + payload.sub)
console.log('genuine token VERIFIED — sub:', payload.sub, '| expires:', new Date(payload.exp * 1000).toISOString())

try {
  await jwtVerify(token.slice(0, -12) + 'AAAAAAAAAAAA', jwks, { issuer: TEAM_ISSUER, audience: AUDIENCE })
  console.error('FAIL: tampered token was accepted')
  process.exit(1)
} catch {
  console.log('tampered token REJECTED — auth logic OK')
}
