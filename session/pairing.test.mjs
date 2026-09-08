import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { listSessions, resolveSession, awaitAdmission, ensurePaired } from './pairing.mjs';

// A stub of the server's companion endpoints. Routes are functions so a test can
// change the answer between polls, which is how the waiting paths are exercised.
async function withServer(routes, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    seen.push({ path: url.pathname, method: req.method, url, auth: req.headers.authorization });
    const route = routes[`${req.method} ${url.pathname}`] || routes[url.pathname];
    if (!route) { res.writeHead(404).end('{}'); return; }
    const out = typeof route === 'function' ? route(url, seen) : route;
    res.writeHead(out.status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body === undefined ? out : out.body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(origin, seen); } finally { server.close(); }
}

const identity = { ticket: 'TICKET', token: 'TOKEN-ABCDEF' };

// The pairing flow polls on real timers; silencing stderr keeps the run readable
// without hiding anything a test asserts on.
async function quiet(fn) {
  const err = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = err; }
}

test('listSessions returns the sessions and the paired flag', async () => {
  await withServer({ '/companion': { sessions: [{ token: 's1' }], paired: true } }, async (origin) => {
    const out = await listSessions({ origin, ticket: 'TICKET' });
    assert.deepEqual(out.sessions, [{ token: 's1' }]);
    assert.equal(out.paired, true);
  });
});

test('listSessions sends the ticket as a bearer token', async () => {
  await withServer({ '/companion': { sessions: [], paired: false } }, async (origin, seen) => {
    await listSessions({ origin, ticket: 'TICKET' });
    assert.equal(seen[0].auth, 'Bearer TICKET');
  });
});

test('listSessions reports a refusal rather than an empty list', async () => {
  for (const status of [401, 403]) {
    await withServer({ '/companion': { status, body: {} } }, async (origin) => {
      await assert.rejects(() => listSessions({ origin, ticket: 'BAD' }),
        /refused to list companion sessions/);
    });
  }
});

test('listSessions copes with a body carrying neither field', async () => {
  await withServer({ '/companion': {} }, async (origin) => {
    assert.deepEqual(await listSessions({ origin, ticket: 'T' }), { sessions: [], paired: false });
  });
});

test('--join takes the token as given, without asking the server', async () => {
  await withServer({}, async (origin, seen) => {
    const out = await resolveSession({ origin, identity, label: 'l', join: 'JOINED' });
    assert.deepEqual(out, { token: 'JOINED', justPaired: false });
    assert.equal(seen.length, 0);
  });
});

test('one open session is joined', async () => {
  await withServer({ '/companion': { sessions: [{ token: 's1' }], paired: true } }, async (origin) => {
    const out = await resolveSession({ origin, identity, label: 'l', join: null });
    assert.deepEqual(out, { token: 's1', justPaired: false });
  });
});

test('several open sessions join the most recent, which is the first listed', async () => {
  const sessions = [{ token: 'newest' }, { token: 'older' }];
  await withServer({ '/companion': { sessions, paired: true } }, async (origin) => {
    const out = await quiet(() => resolveSession({ origin, identity, label: 'l', join: null }));
    assert.equal(out.token, 'newest');
  });
});

// An empty list has two causes that call for opposite advice, and the paired
// flag is the only thing that tells them apart.
test('a paired key with no window is told to open one, not to pair again', async () => {
  await withServer({ '/companion': { sessions: [], paired: true } }, async (origin, seen) => {
    await assert.rejects(
      () => resolveSession({ origin, identity, label: 'l', join: null }),
      /this key is paired, but the account it belongs to has no window/,
    );
    assert.equal(seen.some((s) => s.path === '/companion/pair'), false);
  });
});

test('an unpaired key with --no-pair is told to pair or to join, and never pairs', async () => {
  await withServer({ '/companion': { sessions: [], paired: false } }, async (origin, seen) => {
    await assert.rejects(
      () => resolveSession({ origin, identity, label: 'l', join: null, noPair: true }),
      /no session this key may join has companion mode open/,
    );
    assert.equal(seen.some((s) => s.path === '/companion/pair'), false);
  });
});

test('an unpaired key pairs, then re-lists, and reports that it just paired', async () => {
  let paired = false;
  await withServer({
    '/companion': () => (paired
      ? { sessions: [{ token: 's1' }], paired: true }
      : { sessions: [], paired: false }),
    'POST /companion/pair': { ok: true, path: '/pair/CODE', expiresIn: 1000 },
    'GET /companion/pair': () => { paired = true; return { state: 'paired', account: 'acct-1234' }; },
  }, async (origin) => {
    const out = await quiet(() => resolveSession({
      origin, identity, label: 'l', join: null, noOpen: true,
    }));
    assert.deepEqual(out, { token: 's1', justPaired: true });
  });
});

test('pairing that the server refuses outright surfaces its reason', async () => {
  await withServer({
    '/companion': { sessions: [], paired: false },
    'POST /companion/pair': { ok: false, error: 'companion mode is off on this server' },
  }, async (origin) => {
    await assert.rejects(
      () => quiet(() => resolveSession({ origin, identity, label: 'l', join: null, noOpen: true })),
      /companion mode is off on this server/,
    );
  });
});

test('a pairing code that expires before approval says so', async () => {
  await withServer({
    '/companion': { sessions: [], paired: false },
    'POST /companion/pair': { ok: true, path: '/pair/CODE', expiresIn: 1000 },
    'GET /companion/pair': { state: 'none' },
  }, async (origin) => {
    await assert.rejects(
      () => quiet(() => resolveSession({ origin, identity, label: 'l', join: null, noOpen: true })),
      /expired before it was approved/,
    );
  });
});

test('ensurePaired does nothing for a key that is already paired', async () => {
  await withServer({ '/companion': { sessions: [], paired: true } }, async (origin, seen) => {
    assert.equal(await ensurePaired({ origin, identity, label: 'l' }), false);
    assert.equal(seen.some((s) => s.path === '/companion/pair'), false);
  });
});

test('ensurePaired with --no-pair never even asks', async () => {
  await withServer({}, async (origin, seen) => {
    assert.equal(await ensurePaired({ origin, identity, label: 'l', noPair: true }), false);
    assert.equal(seen.length, 0);
  });
});

test('ensurePaired pairs an unpaired key and says it did', async () => {
  await withServer({
    '/companion': { sessions: [], paired: false },
    'POST /companion/pair': { ok: true, path: '/pair/CODE', expiresIn: 1000 },
    'GET /companion/pair': { state: 'paired', account: 'acct-1234' },
  }, async (origin) => {
    assert.equal(await quiet(() => ensurePaired({ origin, identity, label: 'l', noOpen: true })), true);
  });
});

test('a knock that comes back authorized returns at once', async () => {
  await withServer({ 'POST /companion/knock': { ok: true, state: 'authorized' } },
    async (origin, seen) => {
      await quiet(() => awaitAdmission({ origin, identity, label: 'l', session: 's1' }));
      assert.equal(seen.filter((s) => s.path === '/companion/knock').length, 1);
    });
});

test('the knock carries the session and the label', async () => {
  await withServer({ 'POST /companion/knock': { ok: true, state: 'authorized' } },
    async (origin, seen) => {
      await quiet(() => awaitAdmission({ origin, identity, label: 'my label', session: 's1' }));
      const knock = seen.find((s) => s.path === '/companion/knock');
      assert.equal(knock.url.searchParams.get('s'), 's1');
      assert.equal(knock.url.searchParams.get('label'), 'my label');
      assert.equal(knock.auth, 'Bearer TICKET');
    });
});

test('a refused knock throws the server reason', async () => {
  await withServer({ 'POST /companion/knock': { ok: false, error: 'this key was forgotten' } },
    async (origin) => {
      await assert.rejects(
        () => awaitAdmission({ origin, identity, label: 'l', session: 's1' }),
        /this key was forgotten/,
      );
    });
});

test('a full session is refused with advice to retry, not a wait', async () => {
  await withServer({ 'POST /companion/knock': { ok: true, state: 'full' } }, async (origin) => {
    await assert.rejects(
      () => awaitAdmission({ origin, identity, label: 'l', session: 's1' }),
      /too many keys are waiting/,
    );
  });
});

test('a pending knock is polled until the browser approves it', async () => {
  let calls = 0;
  await withServer({
    'POST /companion/knock': () => {
      calls++;
      return calls < 3 ? { ok: true, state: 'pending' } : { ok: true, state: 'authorized' };
    },
  }, async (origin) => {
    await quiet(() => awaitAdmission({ origin, identity, label: 'l', session: 's1' }));
    assert.equal(calls, 3);
  });
});

test('a knock that stops being accepted mid-wait throws instead of spinning', async () => {
  let calls = 0;
  await withServer({
    'POST /companion/knock': () => {
      calls++;
      return calls === 1
        ? { ok: true, state: 'pending' }
        : { ok: false, error: 'the session went away' };
    },
  }, async (origin) => {
    await assert.rejects(
      () => quiet(() => awaitAdmission({ origin, identity, label: 'l', session: 's1' })),
      /the session went away/,
    );
  });
});
