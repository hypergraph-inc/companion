import { pairThisKey } from './pairing.mjs';
import { openStream } from './connect.mjs';
import { createGraphState } from '../read/state.mjs';

async function workerBranch({ origin, identity, program }) {
  const r = await fetch(`${origin}/worker/branch?program=${encodeURIComponent(program)}`, {
    headers: { Authorization: `Bearer ${identity.ticket}` },
  });
  const body = await r.json().catch(() => ({}));
  if (!body.ok) throw new Error(body.error || `the server refused the worker branch (HTTP ${r.status})`);
  return body;
}

export async function joinWorkerBranch(cfg, identity, program) {
  let branch = await workerBranch({ origin: cfg.origin, identity, program });
  if (!branch.enrolled) {
    if (cfg.args.has('no-pair')) {
      throw new Error(`"${cfg.label}" is not enrolled on a ${program} branch and --no-pair was passed`);
    }
    await pairThisKey({
      origin: cfg.origin, identity, label: cfg.label, program, noOpen: cfg.args.has('no-open'),
    });
    branch = await workerBranch({ origin: cfg.origin, identity, program });
    if (!branch.enrolled) throw new Error(`pairing finished but "${cfg.label}" is still not enrolled on ${program}`);
  }

  console.error(`[worker] ${cfg.label} → ${program} branch ${branch.token.slice(0, 8)}`
    + ` of account ${branch.account.slice(0, 8)} — may ${branch.grant}`);

  const state = createGraphState();
  const { stream, ready } = openStream({
    wsOrigin: cfg.wsOrigin,
    ticket: identity.ticket,
    session: branch.token,
    label: cfg.label,
    state,
    settleMs: cfg.settleMs,
    lingerMs: cfg.lingerMs,
  });
  return { state, stream, ready, branch };
}
