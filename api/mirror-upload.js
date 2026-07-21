// Authorizes the Ekos-mirror sync machine to upload directly into this
// project's private Blob store (client-upload handshake — the file itself
// never passes through this function, so no 4.5MB body limit applies).
//
// Why this exists: the store is Private and its read-write token is a
// sensitive env var (unreadable outside deployments), and Vercel disallows
// local-machine OIDC blob writes. So the sync tool authenticates HERE with a
// Vercel OIDC JWT (obtained via `vercel env pull` by a logged-in CLI), and
// this endpoint — which does hold the token — issues a scoped upload grant.
//
// Auth: Authorization: Bearer <Vercel OIDC JWT>, verified against the team
// issuer's JWKS; must be issued for THIS project. The grant is limited to the
// single pathname 'ekos-mirror.sqlite'.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { handleUpload } from '@vercel/blob/client';

const TEAM_ISSUER = 'https://oidc.vercel.com/garrison-s-projects';
const AUDIENCE = 'https://vercel.com/garrison-s-projects';
const PROJECT_MARKER = 'project:stb-console'; // OIDC sub claim follows the Vercel project name (renamed 2026-07-21)
const PATHNAME = 'ekos-mirror.sqlite';
const MAX_BYTES = 200 * 1024 * 1024; // generous ceiling; mirror is ~22MB today

const jwks = createRemoteJWKSet(new URL(TEAM_ISSUER + '/.well-known/jwks'));

async function requireOidc(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw Object.assign(new Error('Missing bearer token'), { status: 401 });
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: TEAM_ISSUER,
      audience: AUDIENCE,
    });
    if (!String(payload.sub || '').includes(PROJECT_MARKER)) {
      throw new Error('Token is not for this project');
    }
    return payload;
  } catch (err) {
    throw Object.assign(new Error('Invalid sync credential: ' + err.message), { status: 403 });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    await requireOidc(req);
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (pathname !== PATHNAME) {
          throw new Error('Only ' + PATHNAME + ' may be uploaded here');
        }
        return {
          allowedContentTypes: ['application/octet-stream'],
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: MAX_BYTES,
        };
      },
      // Fired by Vercel after the blob lands; nothing to do — the chat's
      // mirror loader re-checks the store on its own schedule.
      onUploadCompleted: async ({ blob }) => {
        console.log('[mirror-upload] new mirror stored:', blob.pathname, blob.uploadedAt || '');
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error('[/api/mirror-upload] error:', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}
