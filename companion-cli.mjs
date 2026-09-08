#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { splitCommand } from './cli/args.mjs';
import { COMMANDS, usage, commandHelp } from './cli/commands.mjs';
import { resolveConfig, writeDefaultLabel } from './cli/config.mjs';
import { companionIdentity } from './session/identity.mjs';
import { resolveSession, ensurePaired, awaitAdmission } from './session/pairing.mjs';
import { openStream } from './session/connect.mjs';
import { createGraphState } from './read/state.mjs';
import { report, censusOptions } from './read/census.mjs';
import { createProbe, reportProbe, probeOptions, DEBUG_SEL } from './read/probe.mjs';
import { render, renderOptions } from './read/render.mjs';
import { runRepl } from './read/repl.mjs';
import { emit, emitOptions, markTouched } from './write/emit.mjs';
import { learn } from './learn.mjs';

const { name: command, args } = splitCommand(process.argv.slice(2));

if (command && !COMMANDS[command]) {
  console.error(`hypergraph: unknown command "${command}"`);
  console.error(usage());
  process.exit(2);
}

if (args.includes('--help') || args.includes('--h')
  || (!command && process.argv.length === 2 && process.stdin.isTTY)) {
  console.log(command ? commandHelp(command) : usage());
  process.exit(0);
}

if (args.includes('--version') || args.includes('--V')) {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

const cfg = resolveConfig({ command, args });
const a = cfg.args;

const identity = await companionIdentity(cfg.origin, { label: cfg.label });
console.error(`[companion] identity "${identity.label}" ${identity.token.slice(0, 8)}`
  + (identity.minted
    ? ` (new key ${identity.custody === 'keychain' ? 'in the macOS Keychain' : `saved to ${identity.file}`})`
    : ''));

function learnProgress(p) {
  if (p.phase === 'plan') {
    console.error(`[learn] ${p.total} lesson(s) to download`
      + (p.skipped ? `, ${p.skipped} already held` : '')
      + (p.locked ? `, ${p.locked} locked` : ''));
  } else if (p.phase === 'open') {
    console.error(`[learn] ${p.index + 1}/${p.total} ${p.lesson.name} — ${p.lesson.title}`);
  } else if (p.phase === 'mark') {
    console.error(`[learn]   marked ${p.count} ${p.swept}`);
  } else if (p.phase === 'wrote') {
    console.error(`[learn]   ${p.read.examples.length} examples, ${p.read.counts.nodes} nodes`
      + ` → skill "${p.skill}"`);
  } else if (p.phase === 'done') {
    console.error(`[learn] ${p.learned} learned, ${p.skipped} unchanged — ${p.skillDir}`);
  }
}

async function runLearn({ coreOnly = true, only = null } = {}) {
  try {
    return await learn({
      origin: cfg.origin,
      ticket: identity.ticket,
      label: cfg.label,
      skillDir: cfg.skillDir,
      settleMs: cfg.settleMs,
      coreOnly,
      only,
      force: a.has('relearn'),
      onProgress: learnProgress,
    });
  } catch (err) {
    console.error(`[learn] the curriculum could not be downloaded: ${err.message}`);
    return null;
  }
}

if (command === 'welcome') {
  try {
    if (!a.has('no-pair')) {
      await ensurePaired({
        origin: cfg.origin,
        identity,
        label: cfg.label,
        noPair: false,
        noOpen: a.has('no-open'),
      });
    }
    if (!a.has('no-default')) {
      writeDefaultLabel(cfg.label);
      console.error(`[companion] "${cfg.label}" is now the default identity — commands need `
        + '--label only to use a different one');
    }
    if (!a.has('no-learn')) await runLearn({ coreOnly: true });
    process.exit(0);
  } catch (err) {
    console.error(`[companion] ${err.message}`);
    process.exit(1);
  }
}

if (command === 'learn' || a.has('learn')) {
  const only = command === 'learn'
    ? cfg.subject
    : a.value('learn', null);
  await ensurePaired({
    origin: cfg.origin,
    identity,
    label: cfg.label,
    noPair: a.has('no-pair'),
    noOpen: a.has('no-open'),
  });
  const out = await runLearn({ coreOnly: !a.has('all') && !only, only: only ? [only] : null });
  process.exit(out ? 0 : 1);
}

let session = null;
let justPaired = false;
if (!cfg.own && !cfg.scene) {
  ({ token: session, justPaired } = await resolveSession({
    origin: cfg.origin,
    identity,
    label: cfg.label,
    join: cfg.join,
    noPair: a.has('no-pair'),
    noOpen: a.has('no-open'),
  }));
}

if (justPaired && !a.has('no-learn')) await runLearn({ coreOnly: true });

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

try {
  await ready;

  const census = censusOptions(cfg);
  const probeOpts = probeOptions(cfg);
  const renderOpts = renderOptions(cfg);
  const emitOpts = emitOptions(cfg);

  if (a.has('follow')) {
    const want = a.value('follow');
    const peer = state.viewerMatching(want);
    if (!peer) {
      const names = [...state.viewers.values()].filter((v) => !v.self)
        .map((v) => v.label || `viewer ${v.id}`);
      throw new Error(`no viewer matching "${want}"`
        + (names.length ? ` — present: ${names.join(', ')}` : ' — nobody else is connected'));
    }
    console.error(`[companion] following "${peer.label || peer.id}"`);
    await stream.aimAt({ cx: peer.cx, cy: peer.cy, halfW: peer.halfW, halfH: peer.halfH });
  } else if (a.has('cx')) {
    await stream.aimAt({
      cx: a.num('cx', 0),
      cy: a.num('cy', 0),
      halfW: a.num('halfW', 500),
      halfH: a.num('halfH', 500),
    });
  }

  report(state, census);

  if (renderOpts.png || renderOpts.field) {
    const grid = render(state, renderOpts);
    if (grid) {
      markTouched(stream, 'sampled node(s)', { slots: grid.slots }, emitOpts.markMax);
    }
  }

  if (emitOpts.file) await emit(stream, emitOpts);

  const probe = createProbe(stream, state);

  if (probeOpts.slot != null) {
    const order = await probe.walkSlot(probeOpts.slot, probeOpts.hops);
    reportProbe(order, `slot ${probeOpts.slot}`, probeOpts);
  } else if (probeOpts.id || probeOpts.edge) {
    const rootId = probeOpts.edge || probeOpts.id;
    const sel = probeOpts.edge ? DEBUG_SEL.EDGE_ID : DEBUG_SEL.NODE_ID;
    const order = await probe.walk(rootId, probeOpts.hops, sel);
    reportProbe(order, rootId, probeOpts);
  }

  if (a.has('repl')) {
    await runRepl({ stream, state, probe, census });
    await stream.shutdown(0);
  }

  console.error(`[companion] "${cfg.label}" is visible in the browser for`
    + ` ${(cfg.lingerMs / 1000).toFixed(0)}s (--linger <s> to hold)`);
  await new Promise((r) => setTimeout(r, cfg.lingerMs));

  await stream.shutdown(0);
} catch (err) {
  console.error(`[companion] ${err.message}`);
  await stream.shutdown(1);
}
