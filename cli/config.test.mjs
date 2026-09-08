import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  resolveConfig, readDefaultLabel, writeDefaultLabel,
  DEFAULT_SKILL_DIR, DEFAULT_KEY_DIR, DEFAULT_ORIGIN, FALLBACK_LABEL,
} from './config.mjs';
import { censusOptions } from '../read/census.mjs';
import { probeOptions } from '../read/probe.mjs';
import { renderOptions } from '../read/render.mjs';
import { emitOptions } from '../write/emit.mjs';

const cfg = (command, ...args) => resolveConfig({ command, args });

test('defaults', () => {
  const c = cfg('read');
  assert.equal(c.port, 3000);
  assert.equal(c.origin, DEFAULT_ORIGIN);
  assert.equal(c.wsOrigin, DEFAULT_ORIGIN.replace(/^http/, 'ws'));
  assert.equal(c.label, 'tesseract-companion');
  assert.equal(c.json, false);
  assert.equal(c.settleMs, 2500);
  assert.equal(c.lingerMs, 3000);
  assert.equal(c.own, false);
  assert.equal(c.join, null);
  assert.equal(c.scene, null);
});

test('--port implies a local origin', () => {
  const c = cfg('read', '--port', '4100');
  assert.equal(c.origin, 'http://127.0.0.1:4100');
  assert.equal(c.wsOrigin, 'ws://127.0.0.1:4100');
});

test('--origin overrides --port', () => {
  const c = cfg('read', '--port', '4100', '--origin', 'http://example.test:9');
  assert.equal(c.origin, 'http://example.test:9');
});

test('--origin overrides the hosted default even without --port', () => {
  const c = cfg('read', '--origin', 'http://example.test:9');
  assert.equal(c.origin, 'http://example.test:9');
});

test('a trailing slash is trimmed off the origin', () => {
  assert.equal(cfg('read', '--origin', 'http://a.test/').origin, 'http://a.test');
  assert.equal(cfg('read', '--origin', 'http://a.test///').origin, 'http://a.test');
});

test('https becomes wss, not wsss', () => {
  assert.equal(cfg('read', '--origin', 'https://a.test').wsOrigin, 'wss://a.test');
});

// A run that vanishes the instant it finishes never shows up in the browser.
test('linger has a one-second floor', () => {
  assert.equal(cfg('read', '--linger', '0').lingerMs, 1000);
  assert.equal(cfg('read', '--linger', '-5').lingerMs, 1000);
  assert.equal(cfg('read', '--linger', '10').lingerMs, 10000);
});

test('welcome takes its label from the bare word, or --label', () => {
  assert.equal(cfg('welcome', 'work').label, 'work');
  assert.equal(cfg('welcome', '--label', 'work').label, 'work');
});

test('welcome with no name falls back to the default label', () => {
  const prev = process.env.TESS_COMPANION_KEYS;
  const dir = mkdtempSync(join(tmpdir(), 'tess-companion-'));
  try {
    process.env.TESS_COMPANION_KEYS = dir;
    assert.equal(cfg('welcome').label, FALLBACK_LABEL);
    writeDefaultLabel('work');
    assert.equal(cfg('welcome').label, 'work');
  } finally {
    if (prev == null) delete process.env.TESS_COMPANION_KEYS;
    else process.env.TESS_COMPANION_KEYS = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the default label persists across commands until overwritten, and --label always wins', () => {
  const prev = process.env.TESS_COMPANION_KEYS;
  const dir = mkdtempSync(join(tmpdir(), 'tess-companion-'));
  try {
    process.env.TESS_COMPANION_KEYS = dir;
    assert.equal(readDefaultLabel(), null);
    assert.equal(cfg('read').label, FALLBACK_LABEL);

    writeDefaultLabel('work');
    assert.equal(readDefaultLabel(), 'work');
    assert.equal(cfg('read').label, 'work');
    assert.equal(cfg('emit', 'r.json').label, 'work');
    assert.equal(cfg('read', '--label', 'other').label, 'other');

    writeDefaultLabel('personal');
    assert.equal(cfg('read').label, 'personal');
  } finally {
    if (prev == null) delete process.env.TESS_COMPANION_KEYS;
    else process.env.TESS_COMPANION_KEYS = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('branch takes its scene from the bare word', () => {
  assert.equal(cfg('branch', 'atlas').scene, 'atlas');
  assert.equal(cfg('branch', '--scene', 'atlas').scene, 'atlas');
});

test('only branch reads a bare word as a scene', () => {
  assert.equal(cfg('read', 'atlas').scene, null);
});

test('the skill dir prefers the flag, then the env, then home', () => {
  const prev = process.env.TESS_COMPANION_SKILLS;
  try {
    delete process.env.TESS_COMPANION_SKILLS;
    assert.equal(cfg('learn').skillDir, DEFAULT_SKILL_DIR);
    assert.equal(DEFAULT_SKILL_DIR, join(homedir(), '.claude', 'skills'));

    process.env.TESS_COMPANION_SKILLS = '/tmp/env-skills';
    assert.equal(cfg('learn').skillDir, '/tmp/env-skills');
    assert.equal(cfg('learn', '--skill-dir', '/tmp/flag').skillDir, '/tmp/flag');
  } finally {
    if (prev == null) delete process.env.TESS_COMPANION_SKILLS;
    else process.env.TESS_COMPANION_SKILLS = prev;
  }
});

test('the key dir prefers the env, then home', () => {
  const prev = process.env.TESS_COMPANION_KEYS;
  try {
    delete process.env.TESS_COMPANION_KEYS;
    assert.equal(cfg('read').keyDir, DEFAULT_KEY_DIR);
    assert.equal(DEFAULT_KEY_DIR, join(homedir(), '.tesseract', 'companions'));
    process.env.TESS_COMPANION_KEYS = '/tmp/env-keys';
    assert.equal(cfg('read').keyDir, '/tmp/env-keys');
  } finally {
    if (prev == null) delete process.env.TESS_COMPANION_KEYS;
    else process.env.TESS_COMPANION_KEYS = prev;
  }
});

test('censusOptions', () => {
  assert.deepEqual(censusOptions(cfg('read')),
    { top: 40, json: false, adjacency: false, adjacencyMax: 60 });
  assert.deepEqual(censusOptions(cfg('read', '--top', '5', '--json', '--adjacency', '--adjacency-max', '2')),
    { top: 5, json: true, adjacency: true, adjacencyMax: 2 });
});

test('probeOptions takes the bare word only under the probe command', () => {
  assert.equal(probeOptions(cfg('probe', 'node:7')).id, 'node:7');
  assert.equal(probeOptions(cfg('read', 'node:7')).id, null);
  assert.equal(probeOptions(cfg('read', '--probe', 'node:7')).id, 'node:7');
});

test('probeOptions keeps hops non-negative', () => {
  assert.equal(probeOptions(cfg('probe', 'x')).hops, 0);
  assert.equal(probeOptions(cfg('probe', 'x', '--hops', '3')).hops, 3);
  assert.equal(probeOptions(cfg('probe', 'x', '--hops', '-2')).hops, 0);
});

test('probeOptions keeps --probe-edge apart from --probe', () => {
  const o = probeOptions(cfg('read', '--probe-edge', 'e:1'));
  assert.equal(o.edge, 'e:1');
  assert.equal(o.id, null);
});

test('renderOptions defaults the render command to view.png', () => {
  assert.equal(renderOptions(cfg('render')).png, 'view.png');
  assert.equal(renderOptions(cfg('render', 'out.png')).png, 'out.png');
  assert.equal(renderOptions(cfg('read')).png, null);
  assert.equal(renderOptions(cfg('read', '--render', 'out.png')).png, 'out.png');
});

test('renderOptions carries the sampling knobs', () => {
  const o = renderOptions(cfg('read', '--field', 'luma,warm', '--cell', '32', '--scale', '5',
    '--ramp', '.#', '--field-step', '2'));
  assert.equal(o.field, 'luma,warm');
  assert.equal(o.cell, 32);
  assert.equal(o.scale, 5);
  assert.equal(o.ramp, '.#');
  assert.equal(o.fieldStep, 2);
});

test('emitOptions takes the bare word only under the emit command', () => {
  assert.equal(emitOptions(cfg('emit', 'rows.json')).file, 'rows.json');
  assert.equal(emitOptions(cfg('read', 'rows.json')).file, null);
  assert.equal(emitOptions(cfg('read', '--emit', 'rows.json')).file, 'rows.json');
});

// batch undefined means sendRows picks MAX_BATCH; a 0 from a bad flag must not
// become a batch size of zero and loop forever.
test('emitOptions leaves batch undefined unless it is a real size', () => {
  assert.equal(emitOptions(cfg('emit', 'r.json')).batch, undefined);
  assert.equal(emitOptions(cfg('emit', 'r.json', '--batch', '0')).batch, undefined);
  assert.equal(emitOptions(cfg('emit', 'r.json', '--batch', '10')).batch, 10);
});

test('emitOptions keeps mark-max at one or more', () => {
  assert.equal(emitOptions(cfg('emit', 'r.json')).markMax, 2000);
  assert.equal(emitOptions(cfg('emit', 'r.json', '--mark-max', '0')).markMax, 2000);
  assert.equal(emitOptions(cfg('emit', 'r.json', '--mark-max', '-4')).markMax, 1);
  assert.equal(emitOptions(cfg('emit', 'r.json', '--mark-max', '5')).markMax, 5);
});
