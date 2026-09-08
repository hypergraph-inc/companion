import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createProbe, reportProbe, DEBUG_SEL } from './probe.mjs';
import { decodeMessage, MSG } from '../protocol/wire.mjs';

// A stream that records what was asked and answers from a fixture, driving the
// probe through state.onDebug the way a real DEBUG_INFO would.
function fakeStream(graph, { answer = true } = {}) {
  const asked = [];
  const state = { onDebug: null };
  let seq = 0;
  const stream = {
    nextSeq: () => ++seq,
    send: (bytes) => {
      const { type, msg } = decodeMessage(Buffer.from(bytes), 0, {});
      assert.equal(type, MSG.DEBUG_REQ);
      asked.push({ id: msg.id, sel: msg.sel, seq: msg.seq });
      if (!answer) return;
      const info = graph[msg.id];
      if (info) queueMicrotask(() => state.onDebug({ id: msg.id, ...info }));
    },
  };
  return { stream, state, asked };
}

const GRAPH = {
  'node:a': { kind: 'atom', degree: 2, x: 1.4, y: -2.6, label: 'A', edges: [
    { other: 'node:b', dir: 'out', layer: 'calls' },
    { other: 'node:c', dir: 'in', layer: 'calls' },
  ] },
  'node:b': { kind: 'atom', degree: 1, edges: [{ other: 'node:a', dir: 'in', layer: 'calls' }] },
  'node:c': { kind: 'atom', degree: 2, edges: [{ other: 'node:d', dir: 'out', layer: 'calls' }] },
  'node:d': { kind: 'atom', degree: 1, edges: [] },
};

function quiet(fn) {
  const log = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { console.log = log; }
  return lines.join('\n');
}

test('zero hops asks for one id and reports it', async () => {
  const { stream, state, asked } = fakeStream(GRAPH);
  const probe = createProbe(stream, state);
  const order = await probe.walk('node:a', 0, DEBUG_SEL.NODE_ID);
  assert.equal(order.length, 1);
  assert.equal(order[0].depth, 0);
  assert.equal(order[0].info.id, 'node:a');
  assert.deepEqual(asked.map((a) => a.id), ['node:a']);
});

test('the root selector is honoured, and neighbours are always walked as nodes', async () => {
  const { stream, state, asked } = fakeStream({
    'e:1': { kind: 'edge', degree: 1, edges: [{ other: 'node:b', dir: 'out', layer: 'l' }] },
    'node:b': { kind: 'atom', degree: 1, edges: [] },
  });
  const probe = createProbe(stream, state);
  await probe.walk('e:1', 1, DEBUG_SEL.EDGE_ID);
  assert.equal(asked[0].sel, DEBUG_SEL.EDGE_ID);
  assert.equal(asked[1].sel, DEBUG_SEL.NODE_ID);
});

test('one hop reaches the neighbours and stamps their depth', async () => {
  const { stream, state } = fakeStream(GRAPH);
  const probe = createProbe(stream, state);
  const order = await probe.walk('node:a', 1, DEBUG_SEL.NODE_ID);
  assert.deepEqual(order.map((o) => [o.depth, o.info.id]),
    [[0, 'node:a'], [1, 'node:b'], [1, 'node:c']]);
});

test('two hops go one ring further', async () => {
  const { stream, state } = fakeStream(GRAPH);
  const probe = createProbe(stream, state);
  const order = await probe.walk('node:a', 2, DEBUG_SEL.NODE_ID);
  assert.deepEqual(order.map((o) => o.info.id), ['node:a', 'node:b', 'node:c', 'node:d']);
  assert.equal(order.at(-1).depth, 2);
});

// The walk is over a graph with cycles; without the visited set node:a comes
// back through node:b forever.
test('a cycle is walked once, not forever', async () => {
  const { stream, state, asked } = fakeStream(GRAPH);
  const probe = createProbe(stream, state);
  const order = await probe.walk('node:a', 3, DEBUG_SEL.NODE_ID);
  const ids = order.map((o) => o.info.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(asked.filter((a) => a.id === 'node:a').length, 1);
});

test('the walk stops early when the frontier runs dry', async () => {
  const { stream, state, asked } = fakeStream({ 'node:d': { kind: 'atom', degree: 0, edges: [] } });
  const probe = createProbe(stream, state);
  const order = await probe.walk('node:d', 9, DEBUG_SEL.NODE_ID);
  assert.equal(order.length, 1);
  assert.equal(asked.length, 1);
});

test('an id nobody answers for resolves empty instead of hanging', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { stream, state } = fakeStream(GRAPH, { answer: false });
  const probe = createProbe(stream, state);
  const walking = probe.walk('node:a', 0, DEBUG_SEL.NODE_ID);
  await Promise.resolve();
  t.mock.timers.tick(3000);
  assert.deepEqual(await walking, []);
});

// One reply is in flight at a time, so a miss inside a walk must not strand the
// waiter for the ids that follow it.
test('a missing neighbour does not strand the rest of the ring', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { stream, state } = fakeStream({
    'node:a': { kind: 'atom', degree: 2, edges: [
      { other: 'node:missing', dir: 'out', layer: 'l' },
      { other: 'node:b', dir: 'out', layer: 'l' },
    ] },
    'node:b': { kind: 'atom', degree: 1, edges: [] },
  });
  const probe = createProbe(stream, state);
  const walking = probe.walk('node:a', 1, DEBUG_SEL.NODE_ID);
  // node:a answers on a microtask; only once the walk is parked on the missing
  // neighbour is there a timer for the tick below to expire.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  t.mock.timers.tick(3000);
  const order = await walking;
  assert.deepEqual(order.map((o) => o.info.id), ['node:a', 'node:b']);
});

test('every reply is remembered in seen', async () => {
  const { stream, state } = fakeStream(GRAPH);
  const probe = createProbe(stream, state);
  await probe.walk('node:a', 1, DEBUG_SEL.NODE_ID);
  assert.deepEqual([...probe.seen.keys()].sort(), ['node:a', 'node:b', 'node:c']);
});

test('each request carries a fresh sequence number', async () => {
  const { stream, state, asked } = fakeStream(GRAPH);
  const probe = createProbe(stream, state);
  await probe.walk('node:a', 1, DEBUG_SEL.NODE_ID);
  const seqs = asked.map((a) => a.seq);
  assert.deepEqual(seqs, [...new Set(seqs)]);
});

test('reportProbe says NOT FOUND on an empty walk', () => {
  assert.match(quiet(() => reportProbe([], 'node:x', {})), /probe node:x: NOT FOUND/);
});

test('reportProbe prints kind, degree, rounded position and label', () => {
  const order = [{ depth: 0, info: { id: 'node:a', ...GRAPH['node:a'] } }];
  const out = quiet(() => reportProbe(order, 'node:a', { hops: 0 }));
  assert.match(out, /node:a\s+kind=atom\s+deg=2\s+1,-3\s+"A"/);
  assert.match(out, /-> node:b @calls/);
  assert.match(out, /<- node:c @calls/);
});

test('reportProbe says unplaced when the node has no position', () => {
  const order = [{ depth: 0, info: { id: 'node:z', kind: 'atom', degree: 0, edges: [] } }];
  assert.match(quiet(() => reportProbe(order, 'node:z', {})), /unplaced/);
});

test('reportProbe --json prints one parseable document carrying the depths', () => {
  const order = [
    { depth: 0, info: { id: 'node:a', kind: 'atom', degree: 1, edges: [] } },
    { depth: 1, info: { id: 'node:b', kind: 'atom', degree: 1, edges: [] } },
  ];
  const out = quiet(() => reportProbe(order, 'node:a', { hops: 1, json: true }));
  const parsed = JSON.parse(out);
  assert.deepEqual(parsed.map((p) => [p.depth, p.id]), [[0, 'node:a'], [1, 'node:b']]);
});
