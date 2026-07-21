// Receives the Ekos mirror from the sync machine and relays it into this
// project's private Blob store using the deployment's own BLOB token.
//
// Why this exists: the Blob store is Private and its read-write token is a
// sensitive env var (unreadable outside deployments), and Vercel disallows
// local-machine OIDC blob writes. So the sync tool authenticates HERE with a
// Vercel OIDC JWT (obtained via `vercel env pull` by a logged-in CLI), and
// this endpoint — which does hold the token — writes the store.
//
// Auth: Bearer <Vercel OIDC JWT>, verified against the team issuer's JWKS;
// must be issued for THIS project. 22MB > the 4.5MB function body limit, so
// the file arrives as base64 chunks through Blob multipart upload.
//
// Protocol (POST, JSON):
//   {action:'create'}                                    -> {uploadId, key}
//   {action:'part', uploadId, key, partNumber, dataBase64} -> {part}
//   {action:'complete', uploadId, key, parts}            -> {url}

import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
} from '@vercel/blob';

const TEAM_ISSUER = 'https://oidc.vercel.com/garrison-s-projects';
const AUDIENCE = 'https://vercel.com/garrison-s-projects';
const PROJECT_MARKER = 'project:stb-exec-console';
const PATHNAME = 'ekos-mirror.sqlite';

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
    const { action } = req.body || {};
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) throw new Error('Blob token not available in this deployment');
    const common = { access: 'private', token, contentType: 'application/octet-stream' };

    if (action === 'create') {
      const mp = await createMultipartUpload(PATHNAME, { ...common, allowOverwrite: true });
      return res.status(200).json({ ok: true, uploadId: mp.uploadId, key: mp.key });
    }
    if (action === 'part') {
      const { uploadId, key, partNumber, dataBase64 } = req.body;
      const part = await uploadPart(PATHNAME, Buffer.from(dataBase64, 'base64'), {
        ...common,
        uploadId,
        key,
        partNumber,
      });
      return res.status(200).json({ ok: true, part });
    }
    if (action === 'complete') {
      const { uploadId, key, parts } = req.body;
      const blob = await completeMultipartUpload(PATHNAME, parts, { ...common, uploadId, key });
      return res.status(200).json({ ok: true, url: blob.url });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    console.error('[/api/mirror-upload] error:', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}
