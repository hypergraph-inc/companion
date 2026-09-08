import { spawn } from 'node:child_process';

const PAIR_POLL_MS = 2000;
const APPROVAL_WAIT_MS = 120_000;
const APPROVAL_POLL_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function listSessions({ origin, ticket }) {
  const r = await fetch(`${origin}/companion`, {
    headers: { Authorization: `Bearer ${ticket}` },
  });
  if (r.status === 401 || r.status === 403) {
    throw new Error('the server refused to list companion sessions for this key');
  }
  const body = await r.json();
  return { sessions: (body && body.sessions) || [], paired: !!(body && body.paired) };
}

// A passkey prompt on a loopback IP is a different origin from the same page on
// localhost, so the browser would not find the credential it is being asked for.
function browserOrigin(origin) {
  try {
    const u = new URL(origin);
    if (/^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i.test(u.hostname)) {
      u.hostname = 'localhost';
      return u.origin;
    }
    return u.origin;
  } catch {
    return origin;
  }
}

function openInBrowser(target) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [target], {
      stdio: 'ignore', detached: true, shell: process.platform === 'win32',
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function pairThisKey({ origin, identity, label, noOpen }) {
  const r = await fetch(`${origin}/companion/pair?label=${encodeURIComponent(label)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${identity.ticket}` },
  });
  const body = await r.json().catch(() => ({}));
  if (!body.ok) throw new Error(body.error || `the server refused to start pairing (HTTP ${r.status})`);

  const link = `${browserOrigin(origin)}${body.path}`;
  const opened = !noOpen && openInBrowser(link);
  console.error(`[companion] this key has never been paired with an account on ${origin}`);
  console.error(`[companion] ${opened ? 'opened' : 'open'} ${link}`);
  console.error('[companion] approve there with your passkey — the page must show exactly:');
  console.error(`[companion]   ${identity.token}`);

  const deadline = Date.now() + body.expiresIn + 5 * 60_000;
  while (Date.now() < deadline) {
    await sleep(PAIR_POLL_MS);
    const p = await fetch(`${origin}/companion/pair`, {
      headers: { Authorization: `Bearer ${identity.ticket}` },
    }).then((s) => s.json()).catch(() => ({}));
    if (p.state === 'paired') {
      console.error(`[companion] paired with account ${String(p.account).slice(0, 8)}`
        + `${p.grant ? ` — this key may ${p.grant}` : ''}`);
      return p;
    }
    if (p.state === 'none') {
      throw new Error('the pairing code expired before it was approved — run this again');
    }
  }
  throw new Error('no approval within the pairing window — run this again when you are at the browser');
}

// Learning happens on the account's behalf, so an unpaired key pairs first --
// the server refuses the lesson scenes to a key with no enrollment, and asking
// the owner to approve a download it never authorized is the same mistake.
export async function ensurePaired({ origin, identity, label, noPair, noOpen }) {
  if (noPair) return false;
  const { paired } = await listSessions({ origin, ticket: identity.ticket });
  if (paired) return false;
  await pairThisKey({ origin, identity, label, noOpen });
  return true;
}

export async function resolveSession({ origin, identity, label, join, noPair, noOpen }) {
  if (join) return { token: join, justPaired: false };

  // An empty list has two causes that call for opposite advice: this key is
  // enrolled nowhere and needs to pair, or it is enrolled fine and its owner
  // simply has no window open. Pairing is the answer to the first only -- asking
  // for a passkey because a tab is closed sends the owner to authorize a key
  // that is already authorized.
  let justPaired = false;
  let { sessions, paired } = await listSessions({ origin, ticket: identity.ticket });
  if (!sessions.length && !paired && !noPair) {
    await pairThisKey({ origin, identity, label, noOpen });
    justPaired = true;
    ({ sessions, paired } = await listSessions({ origin, ticket: identity.ticket }));
  }
  if (!sessions.length) {
    throw new Error(paired
      ? 'this key is paired, but the account it belongs to has no window with companion'
        + ' mode open — click "Companion" in the browser toolbar. If the browser is signed'
        + ' in as a different account, this key is not enrolled there; pair a separate'
        + ' identity for it with --label <name>.'
      : 'no session this key may join has companion mode open '
        + '— click "Companion" in the browser toolbar, or pass --join <token>');
  }
  if (sessions.length > 1) {
    console.error(`[companion] ${sessions.length} open sessions, joining most recent`);
  }
  return { token: sessions[0].token, justPaired };
}

export async function awaitAdmission({ origin, identity, label, session }) {
  const knock = async () => {
    const r = await fetch(
      `${origin}/companion/knock?s=${encodeURIComponent(session)}&label=${encodeURIComponent(label)}`,
      { method: 'POST', headers: { Authorization: `Bearer ${identity.ticket}` } },
    );
    return r.json();
  };
  const admitted = (r) => {
    console.error(`[companion] admitted${r.remembered ? ' by a remembered enrollment' : ''}`
      + `${r.grant ? ` — this key may ${r.grant}` : ''}`);
  };

  let reply = await knock();
  if (!reply.ok) throw new Error(reply.error || 'the server refused the knock');
  if (reply.state === 'authorized') { admitted(reply); return; }
  if (reply.state === 'full') throw new Error('too many keys are waiting on that session — try again later');

  console.error(`[companion] waiting for approval — in the browser, allow the key that reads exactly:\n[companion]   ${identity.token}`);
  console.error('[companion] click "remember" instead of "allow once" and this key rejoins without asking');

  const deadline = Date.now() + APPROVAL_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(APPROVAL_POLL_MS);
    reply = await knock();
    if (reply.ok && reply.state === 'authorized') { admitted(reply); return; }
    if (!reply.ok) throw new Error(reply.error || 'the knock stopped being accepted');
  }
  throw new Error(`no approval within ${APPROVAL_WAIT_MS / 1000}s — is the browser owner watching?`);
}
