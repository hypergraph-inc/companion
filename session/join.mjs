import { resolveSession, awaitAdmission } from './pairing.mjs';
import { openStream } from './connect.mjs';
import { createGraphState } from '../read/state.mjs';

export async function joinSession(cfg, identity, { onPaired } = {}) {
  let session = null;
  if (!cfg.own && !cfg.scene) {
    const resolved = await resolveSession({
      origin: cfg.origin,
      identity,
      label: cfg.label,
      join: cfg.join,
      noPair: cfg.args.has('no-pair'),
      noOpen: cfg.args.has('no-open'),
    });
    session = resolved.token;
    if (resolved.justPaired && onPaired) await onPaired();
  }

  if (session) console.error(`[companion] joining session ${session.slice(0, 8)}`);
  if (cfg.scene) console.error(`[companion] joining scene ${cfg.scene}`);
  if (session) {
    await awaitAdmission({ origin: cfg.origin, identity, label: cfg.label, session });
  }

  const state = createGraphState();
  const { stream, ready } = openStream({
    wsOrigin: cfg.wsOrigin,
    ticket: identity.ticket,
    scene: cfg.scene,
    session,
    label: cfg.label,
    state,
    settleMs: cfg.settleMs,
    lingerMs: cfg.lingerMs,
  });
  return { state, stream, ready };
}
