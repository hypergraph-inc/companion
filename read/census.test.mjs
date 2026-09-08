import { test } from 'node:test';
import assert from 'node:assert/strict';

import { report } from './census.mjs';

// A fake graph state, so the census is tested against a shape rather than a
// live stream. state.test.mjs already proves the real one builds this shape.
function fakeState(over = {}) {
  const labels = over.labels || new Map();
  return {
    lastTick: 42,
    frames: 3,
    nodes: over.nodes || new Map(),
    edges: over.edges || new Map(),
    hulls: over.hulls || new Map(),
    viewers: over.viewers || new Map(),
    labels,
    bounds: () => (over.bounds === undefined
      ? { x0: -10, y0: -20, x1: 30, y1: 40, cx: 10, cy: 10, w: 40, h: 60 }
      : over.bounds),
    labelled: () => over.labelled || [],
    adjacency: () => over.adjacency || new Map(),
    degrees: () => new Map(),
  };
}

const OPTS = { top: 40, json: true, adjacency: false, adjacencyMax: 60 };

// Every assertion below reads the returned object, so stdout is only silenced
// to keep the run readable -- report writes to the console by design.
function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

const lbl = (slot, text, importance = 1, degree = 0) =>
  ({ slot, text, importance, degree, x: 0, y: 0 });

test('the counts come straight off the state', () => {
  const out = quiet(() => report(fakeState({
    nodes: new Map([[1, {}], [2, {}]]),
    edges: new Map([[1, {}]]),
    hulls: new Map([[1, {}], [2, {}], [3, {}]]),
    labelled: [lbl(1, 'a')],
  }), OPTS));
  assert.equal(out.tick, 42);
  assert.equal(out.frames, 3);
  assert.equal(out.nodes, 2);
  assert.equal(out.edges, 1);
  assert.equal(out.hulls, 3);
  assert.equal(out.labelled, 1);
});

test('bounds are rounded, and null when nothing is in view', () => {
  const out = quiet(() => report(fakeState(), OPTS));
  assert.deepEqual(out.bounds, { x0: -10, y0: -20, x1: 30, y1: 40, w: 40, h: 60 });
  assert.equal(quiet(() => report(fakeState({ bounds: null }), OPTS)).bounds, null);
});

test('--top caps the listing but not the count', () => {
  const labelled = Array.from({ length: 10 }, (_, i) => lbl(i, `n${i}`));
  const out = quiet(() => report(fakeState({ labelled }), { ...OPTS, top: 3 }));
  assert.equal(out.top.length, 3);
  assert.equal(out.labelled, 10);
});

test('viewers get a readable kind and a fallback name', () => {
  const viewers = new Map([
    [1, { id: 1, label: 'ana', kind: 0, self: true, cx: 1.6, cy: -2.4, halfW: 10.5, halfH: 20.4 }],
    [2, { id: 2, label: '', kind: 1, self: false, cx: 0, cy: 0, halfW: 1, halfH: 1 }],
  ]);
  const out = quiet(() => report(fakeState({ viewers }), OPTS));
  assert.equal(out.viewers[0].kind, 'human');
  assert.equal(out.viewers[0].self, true);
  assert.deepEqual([out.viewers[0].cx, out.viewers[0].cy], [2, -2]);
  assert.equal(out.viewers[1].kind, 'agent');
  assert.equal(out.viewers[1].label, 'viewer 2');
});

test('adjacency is absent unless asked for', () => {
  assert.equal(quiet(() => report(fakeState(), OPTS)).adjacency, undefined);
});

test('adjacency names the far end when it has a label, and renders rgba as hex', () => {
  const state = fakeState({
    labels: new Map([[1, { text: 'from' }], [2, { text: 'to' }]]),
    labelled: [lbl(1, 'from')],
    adjacency: new Map([[1, [
      { other: 2, rgba: 0xff8800ff, edgeSlot: 1 },
      { other: 3, rgba: 0x000000ff, edgeSlot: 1 },
    ]]]),
  });
  const out = quiet(() => report(state, { ...OPTS, adjacency: true }));
  assert.equal(out.adjacency.length, 1);
  assert.deepEqual(out.adjacency[0].to[0], { other: 2, text: 'to', rgba: '#ff8800' });
  assert.equal(out.adjacency[0].to[1].text, null);
});

test('adjacency skips labelled nodes that are wired to nothing', () => {
  const state = fakeState({
    labelled: [lbl(1, 'wired'), lbl(2, 'lonely')],
    adjacency: new Map([[1, [{ other: 3, rgba: 0, edgeSlot: 1 }]]]),
  });
  const out = quiet(() => report(state, { ...OPTS, adjacency: true }));
  assert.deepEqual(out.adjacency.map((r) => r.text), ['wired']);
});

test('--adjacency-max caps the adjacency rows', () => {
  const labelled = Array.from({ length: 5 }, (_, i) => lbl(i, `n${i}`));
  const adjacency = new Map(labelled.map((l) => [l.slot, [{ other: 99, rgba: 0, edgeSlot: 1 }]]));
  const out = quiet(() => report(fakeState({ labelled, adjacency }),
    { ...OPTS, adjacency: true, adjacencyMax: 2 }));
  assert.equal(out.adjacency.length, 2);
});

test('the same object is returned whether or not --json was passed', () => {
  const state = () => fakeState({ labelled: [lbl(1, 'a')] });
  const asJson = quiet(() => report(state(), OPTS));
  const asText = quiet(() => report(state(), { ...OPTS, json: false }));
  assert.deepEqual(asText, asJson);
});

test('--json prints one parseable document and nothing else', () => {
  const lines = [];
  const log = console.log;
  console.log = (s) => lines.push(s);
  try { report(fakeState({ labelled: [lbl(1, 'a')] }), OPTS); } finally { console.log = log; }
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).top[0].text, 'a');
});

test('an empty scene reports rather than throwing', () => {
  const out = quiet(() => report(fakeState({ bounds: null }), OPTS));
  assert.equal(out.nodes, 0);
  assert.deepEqual(out.top, []);
  assert.deepEqual(out.viewers, []);
});
