import {
  encodeHello, encodeView, encodePresenceSelf, PROTO_VERSION,
} from '../protocol/wire.mjs';
import { streamProtocols } from '../protocol/auth.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEARTBEAT_MS = 200;
const WATCHDOG_MS = 60_000;

export function openStream({ wsOrigin, ticket, scene, session, label, state, settleMs, lingerMs }) {
  const params = new URLSearchParams();
  if (scene) params.set('scene', scene);
  if (session) params.set('s', session);

  const ws = new WebSocket(`${wsOrigin}/stream?${params}`, streamProtocols(ticket));
  ws.binaryType = 'arraybuffer';

  let seq = 0;
  let severed = false;
  let heartbeat = null;
  let watchdog = null;
  let announced = null;
  const severHandlers = new Set();

  const stopTimers = () => {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  };

  const sever = () => {
    severed = true;
    stopTimers();
    for (const fn of severHandlers) { try { fn(); } catch { /* leaving anyway */ } }
  };

  function announce(rect) {
    announced = rect;
    ws.send(encodePresenceSelf({ ...rect, kind: 1, label }));
  }

  async function shutdown(code) {
    severed = true;
    stopTimers();
    announced = null;

    const closed = new Promise((r) => {
      ws.addEventListener('close', r, { once: true });
      setTimeout(r, 2000);
    });
    try { ws.close(); } catch { /* already gone */ }
    await closed;

    await sleep(150);
    process.exit(code);
  }

  const stream = {
    ws,
    label,
    get severed() { return severed; },
    nextSeq: () => ++seq,
    send: (bytes) => ws.send(bytes),
    onSever: (fn) => severHandlers.add(fn),
    holdOpen: () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } },
    announce,
    shutdown,
    aimAt,
  };

  ws.onmessage = (ev) => {
    try {
      state.apply(ev.data);
    } catch (err) {
      console.error(`[companion] could not decode a message from the server: ${err.message}`);
      console.error('[companion] this build and the server agree on protocol version'
        + ` ${PROTO_VERSION} but not on the shape of a message — one of them was built`
        + ' from a tree where wire.mjs changed without the version being bumped.');
      sever();
      try { ws.close(); } catch { /* already gone */ }
      process.exit(1);
    }
  };

  ws.onclose = () => {
    if (severed) return;

    // No WELCOME ever arrived, so the socket was refused during the handshake
    // rather than dropped later. The close frame carries no reason, so this side
    // cannot know which refusal it was -- name the likeliest and point at the one
    // place that does know, rather than asserting a cause.
    if (!state.welcome) {
      console.error('[companion] the server closed this connection during the handshake,'
        + ' before sending WELCOME. No reason provided via wire.');
      console.error(`[companion] most likely a protocol version mismatch — this CLI uses version ${PROTO_VERSION}.`);
      sever();
      process.exit(1);
    }

    console.error('[companion] the browser closed this connection'
      + ' — companion mode was turned off, or this key was forgotten');
    sever();
    process.exit(0);
  };

  ws.onerror = (e) => {
    if (scene && !state.welcome) {
      console.error(`[companion] the server refused ${scene} for this key`
        + ' — a scene may need an account this key is not enrolled on.'
        + ' Pair it first: hypergraph learn');
      process.exit(1);
    }
    console.error('ws error', e.message || e);
    process.exit(1);
  };

  const ready = new Promise((resolve, reject) => {
    ws.onopen = async () => {
      try {
        ws.send(encodeHello({ capFlags: 0b0100, viewportW: 1280, viewportH: 800 }));
        await sleep(settleMs);
        if (!state.welcome) throw new Error('no WELCOME — is the server running on this port?');

        const bb = state.bounds();
        announce(bb
          ? { cx: bb.cx, cy: bb.cy, halfW: Math.max(1, bb.w / 2), halfH: Math.max(1, bb.h / 2) }
          : { cx: 0, cy: 0, halfW: 1000, halfH: 1000 });

        heartbeat = setInterval(() => {
          if (announced) ws.send(encodePresenceSelf({ ...announced, kind: 1, label }));
        }, HEARTBEAT_MS);

        resolve(stream);
      } catch (err) {
        reject(err);
      }
    };
  });

  // Aiming clears what was in view before waiting again: the roster that comes
  // back describes the new rectangle, and mixing it with the old one reports
  // nodes that are no longer on screen.
  async function aimAt(rect) {
    const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v / state.posScale)));
    const qu = (v) => Math.max(1, Math.min(65535, Math.round(v / state.posScale)));
    ws.send(encodeView({
      seq: ++seq,
      cx: q(rect.cx), cy: q(rect.cy), halfW: qu(rect.halfW), halfH: qu(rect.halfH),
    }));
    announce(rect);
    state.nodes.clear();
    await sleep(settleMs);
  }

  watchdog = setTimeout(() => {
    console.error('[companion] timeout');
    shutdown(1);
  }, WATCHDOG_MS + lingerMs);

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.error('\n[companion] leaving');
      shutdown(0);
    });
  }

  return { stream, ready };
}
