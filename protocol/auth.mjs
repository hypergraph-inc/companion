import { sign } from 'node:crypto';

const originOf = (origin) => (typeof origin === 'string' && origin.includes('://')
  ? origin.replace(/\/+$/, '')
  : `http://127.0.0.1:${origin}`);

export async function authenticate(origin, { keyPair, kind = 'companion' } = {}) {
  if (!keyPair || !keyPair.privateKey || !keyPair.publicKey) {
    throw new Error('authenticate needs a keyPair — see identity.mjs for where they are held');
  }
  const { publicKey, privateKey } = keyPair;

  const jwk = publicKey.export({ format: 'jwk' });
  const pubkey = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]).toString('hex');

  const base = originOf(origin);
  const cr = await fetch(`${base}/identity/challenge?pubkey=${encodeURIComponent(pubkey)}`, { method: 'POST' });
  const challenge = await cr.json();
  if (!challenge.ok) throw new Error(`identity: challenge refused (${challenge.error})`);

  const signature = sign('sha256', Buffer.from(challenge.challenge, 'utf8'),
    { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('hex');

  const ar = await fetch(`${base}/identity/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge: challenge.challenge, pubkey, signature, kind }),
  });
  const answer = await ar.json();
  if (!answer.ok) throw new Error(`identity: authentication refused (${answer.error})`);

  return { token: answer.token, ticket: answer.ticket, pubkey };
}

export function streamProtocols(ticket) {
  return ticket ? ['tess.v1', `tess.ticket.${ticket}`] : ['tess.v1'];
}
