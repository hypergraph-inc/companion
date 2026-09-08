import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGraphState } from './state.mjs';
import {
  encodeWelcome, encodeRescale, encodeKeyframe, encodeDelta, encodeNodeLabels,
  encodeRosterDelta, encodeEdgeDelta, encodeHullDelta, encodePresence, encodeDebugReq,
  MSG,
} from '../protocol/wire.mjs';

const WELCOME = {
  sessionId: 1, branchId: 0,
  posScale: 1, velScale: 1, maxRadius: 100,
  serverTickHz: 60, keyframeEvery: 60,
  slotWidth: 2, tokenLen: 12,
};

const header = (frameSeq = 1, tickTime = 100) =>
  ({ frameSeq, tickTime, lastAppliedInputSeq: 0 });

const nodeAt = (slot, px, py, extra = {}) =>
  ({ slot, px, py, vx: 0, vy: 0, r: 10, g: 20, b: 30, a: 255, radius: 5, ...extra });

// A state that has taken WELCOME, so posScale and tokenLen are known -- decoding
// a roster delta before WELCOME would read tokens at the wrong width.
function welcomed(posScale = 1) {
  const s = createGraphState();
  s.apply(encodeWelcome({ ...WELCOME, posScale }));
  return s;
}

test('WELCOME sets posScale', () => {
  const s = welcomed(4);
  assert.equal(s.posScale, 4);
  assert.equal(s.welcome.tokenLen, 12);
});

test('RESCALE moves posScale after the fact', () => {
  const s = welcomed(1);
  s.apply(encodeRescale({ posScale: 8, velScale: 1, effectiveFromSeq: 2 }));
  assert.equal(s.posScale, 8);
});

test('a keyframe enters nodes and advances the tick', () => {
  const s = welcomed();
  s.apply(encodeKeyframe(header(1, 250), [nodeAt(1, 10, 20), nodeAt(2, -5, 7)]));
  assert.equal(s.nodes.size, 2);
  assert.equal(s.frames, 1);
  assert.equal(s.lastTick, 250);
  assert.deepEqual(
    { ...s.nodes.get(1) },
    { qx: 10, qy: 20, r: 10, g: 20, b: 30, a: 255, radius: 5 },
  );
});

// A keyframe is the whole roster, so a node it omits has left the view.
test('a keyframe drops nodes it does not mention', () => {
  const s = welcomed();
  s.apply(encodeKeyframe(header(1), [nodeAt(1, 0, 0), nodeAt(2, 1, 1)]));
  s.apply(encodeKeyframe(header(2), [nodeAt(2, 1, 1)]));
  assert.deepEqual([...s.nodes.keys()], [2]);
});

test('a delta moves a node by its offset', () => {
  const s = welcomed();
  s.apply(encodeKeyframe(header(1), [nodeAt(1, 10, 20)]));
  s.apply(encodeDelta(header(2, 300), 1, [{ slot: 1, dpos: [5, -3] }]));
  assert.equal(s.nodes.get(1).qx, 15);
  assert.equal(s.nodes.get(1).qy, 17);
  assert.equal(s.lastTick, 300);
  assert.equal(s.frames, 2);
});

test('a delta offset larger than a byte still arrives intact', () => {
  const s = welcomed();
  s.apply(encodeKeyframe(header(1), [nodeAt(1, 0, 0)]));
  s.apply(encodeDelta(header(2), 1, [{ slot: 1, dpos: [900, -900] }]));
  assert.equal(s.nodes.get(1).qx, 900);
  assert.equal(s.nodes.get(1).qy, -900);
});

test('a delta recolours and resizes in place', () => {
  const s = welcomed();
  s.apply(encodeKeyframe(header(1), [nodeAt(1, 0, 0)]));
  s.apply(encodeDelta(header(2), 1, [{ slot: 1, dpos: [0, 0], color: [1, 2, 3, 4], radius: 9 }]));
  const n = s.nodes.get(1);
  assert.deepEqual([n.r, n.g, n.b, n.a], [1, 2, 3, 4]);
  assert.equal(n.radius, 9);
});

test('a delta enters and removes nodes', () => {
  const s = welcomed();
  s.apply(encodeKeyframe(header(1), [nodeAt(1, 0, 0)]));
  s.apply(encodeDelta(header(2), 1, [
    { slot: 2, entered: nodeAt(2, 40, 50) },
    { slot: 1, left: true },
  ]));
  assert.deepEqual([...s.nodes.keys()], [2]);
  assert.equal(s.nodes.get(2).qx, 40);
});

// The stream can describe a slot that never entered this viewport; dropping it
// is right, throwing would take the run down.
test('a delta for an unknown slot is ignored', () => {
  const s = welcomed();
  s.apply(encodeDelta(header(1), 0, [{ slot: 99, dpos: [1, 1] }]));
  assert.equal(s.nodes.size, 0);
});

test('labels arrive with their importance', () => {
  const s = welcomed();
  s.apply(encodeNodeLabels([{ slot: 1, importance: 7, text: 'atlas' }]));
  assert.deepEqual(s.labels.get(1), { text: 'atlas', importance: 7 });
});

// A roster removal is the node leaving the view; the label has to go with it,
// or the next census reports a label sitting on a node that is not there.
test('a roster removal takes the label with the node', () => {
  const s = welcomed();
  s.apply(encodeKeyframe(header(1), [nodeAt(1, 0, 0)]));
  s.apply(encodeNodeLabels([{ slot: 1, importance: 1, text: 'gone' }]));
  s.apply(encodeRosterDelta({ adds: [], removes: [1] }));
  assert.equal(s.nodes.has(1), false);
  assert.equal(s.labels.has(1), false);
});

test('edges add and remove by slot', () => {
  const s = welcomed();
  s.apply(encodeEdgeDelta({
    adds: [{ edgeSlot: 5, rgba: [1, 2, 3, 255], nodes: [1, 2, 3] }],
    removes: [], recolors: [],
  }));
  assert.deepEqual(s.edges.get(5).slots, [1, 2, 3]);
  s.apply(encodeEdgeDelta({ adds: [], removes: [5], recolors: [] }));
  assert.equal(s.edges.size, 0);
});

test('hulls upsert and remove by slot', () => {
  const s = welcomed();
  s.apply(encodeHullDelta({
    reliable: true,
    upserts: [{ hullSlot: 3, rgba: [9, 9, 9, 200], cx: 10, cy: 20, vx: 0, vy: 0, fillR: 44, verts: [0, 0, 1, 1, 2, 0] }],
    removes: [],
  }));
  const h = s.hulls.get(3);
  assert.equal(h.qcx, 10);
  assert.equal(h.qcy, 20);
  assert.equal(h.qfillR, 44);
  s.apply(encodeHullDelta({ reliable: true, upserts: [], removes: [3] }));
  assert.equal(s.hulls.size, 0);
});

// Presence is the whole room each time, so it replaces rather than merges --
// otherwise a viewer who left stays listed forever.
test('presence replaces the viewer list wholesale', () => {
  const s = welcomed();
  const viewer = (id, label) =>
    ({ id, cx: 0, cy: 0, halfW: 1, halfH: 1, rgb: [0, 0, 0], kind: 0, self: false, label });
  s.apply(encodePresence({ viewers: [viewer(1, 'ana'), viewer(2, 'bo')] }));
  assert.equal(s.viewers.size, 2);
  s.apply(encodePresence({ viewers: [viewer(2, 'bo')] }));
  assert.deepEqual([...s.viewers.keys()], [2]);
});

test('viewerMatching is a case-insensitive substring, and never self', () => {
  const s = welcomed();
  const viewer = (id, label, self = false) =>
    ({ id, cx: 0, cy: 0, halfW: 1, halfH: 1, rgb: [0, 0, 0], kind: 0, self, label });
  s.apply(encodePresence({ viewers: [viewer(1, 'Zackary', true), viewer(2, 'Ana Lopez')] }));
  assert.equal(s.viewerMatching('ana').id, 2);
  assert.equal(s.viewerMatching('LOPEZ').id, 2);
  assert.equal(s.viewerMatching('zackary'), null);
  assert.equal(s.viewerMatching('nobody'), null);
});

test('several messages in one frame all apply', () => {
  const s = createGraphState();
  s.apply(Buffer.concat([
    encodeWelcome(WELCOME),
    encodeKeyframe(header(1), [nodeAt(1, 3, 4)]),
    encodeNodeLabels([{ slot: 1, importance: 2, text: 'both' }]),
  ]));
  assert.equal(s.nodes.size, 1);
  assert.equal(s.labels.get(1).text, 'both');
});

test('bounds is null with nothing in view, and scaled once there is', () => {
  const s = welcomed(2);
  assert.equal(s.bounds(), null);
  s.apply(encodeKeyframe(header(1), [nodeAt(1, -10, -20), nodeAt(2, 30, 40)]));
  assert.deepEqual(s.bounds(), { x0: -20, y0: -40, x1: 60, y1: 80, cx: 20, cy: 20, w: 80, h: 120 });
});

test('degrees counts every incidence, hyperedges included', () => {
  const s = welcomed();
  s.apply(encodeEdgeDelta({
    adds: [
      { edgeSlot: 1, rgba: [0, 0, 0, 255], nodes: [1, 2, 3] },
      { edgeSlot: 2, rgba: [0, 0, 0, 255], nodes: [1, 4] },
    ],
    removes: [], recolors: [],
  }));
  const deg = s.degrees();
  assert.equal(deg.get(1), 2);
  assert.equal(deg.get(2), 1);
  assert.equal(deg.get(4), 1);
  assert.equal(deg.get(99), undefined);
});

test('adjacency pairs every member of a hyperedge with every other', () => {
  const s = welcomed();
  s.apply(encodeEdgeDelta({
    adds: [{ edgeSlot: 1, rgba: [0, 0, 0, 255], nodes: [1, 2, 3] }],
    removes: [], recolors: [],
  }));
  const adj = s.adjacency();
  assert.deepEqual(adj.get(1).map((r) => r.other), [2, 3]);
  assert.deepEqual(adj.get(2).map((r) => r.other), [1, 3]);
  assert.equal(adj.get(1).every((r) => r.edgeSlot === 1), true);
});

test('labelled skips labels whose node is not in view', () => {
  const s = welcomed();
  s.apply(encodeKeyframe(header(1), [nodeAt(1, 0, 0)]));
  s.apply(encodeNodeLabels([
    { slot: 1, importance: 1, text: 'here' },
    { slot: 2, importance: 9, text: 'not in view' },
  ]));
  assert.deepEqual(s.labelled().map((l) => l.text), ['here']);
});

test('labelled skips a label with empty text', () => {
  const s = welcomed();
  s.apply(encodeKeyframe(header(1), [nodeAt(1, 0, 0)]));
  s.apply(encodeNodeLabels([{ slot: 1, importance: 1, text: '' }]));
  assert.deepEqual(s.labelled(), []);
});

test('labelled reports world position, rounded', () => {
  const s = welcomed(3);
  s.apply(encodeKeyframe(header(1), [nodeAt(1, 10, -7)]));
  s.apply(encodeNodeLabels([{ slot: 1, importance: 1, text: 'a' }]));
  const [l] = s.labelled();
  assert.equal(l.x, 30);
  assert.equal(l.y, -21);
});

// Importance, then degree, then text -- the text tiebreak is what keeps two
// runs over an unchanged scene byte-identical, which the curriculum digests
// depend on.
test('labelled sorts by importance, then degree, then text', () => {
  const s = welcomed();
  s.apply(encodeKeyframe(header(1), [1, 2, 3, 4].map((i) => nodeAt(i, i, i))));
  s.apply(encodeNodeLabels([
    { slot: 1, importance: 5, text: 'zebra' },
    { slot: 2, importance: 9, text: 'apex' },
    { slot: 3, importance: 5, text: 'alpha' },
    { slot: 4, importance: 5, text: 'wired' },
  ]));
  s.apply(encodeEdgeDelta({
    adds: [{ edgeSlot: 1, rgba: [0, 0, 0, 255], nodes: [4, 2] }],
    removes: [], recolors: [],
  }));
  assert.deepEqual(s.labelled().map((l) => l.text), ['apex', 'wired', 'alpha', 'zebra']);
});

test('labelled ties break identically across two runs of the same scene', () => {
  const build = () => {
    const s = welcomed();
    s.apply(encodeKeyframe(header(1), [1, 2, 3].map((i) => nodeAt(i, i, i))));
    s.apply(encodeNodeLabels([
      { slot: 3, importance: 1, text: 'c' },
      { slot: 1, importance: 1, text: 'a' },
      { slot: 2, importance: 1, text: 'b' },
    ]));
    return s.labelled().map((l) => l.text);
  };
  assert.deepEqual(build(), build());
  assert.deepEqual(build(), ['a', 'b', 'c']);
});

// State does not know what a probe is: it hands DEBUG_INFO to whoever set
// onDebug, and drops it on the floor when nobody is waiting.
test('DEBUG_INFO reaches onDebug, and is harmless with no listener', () => {
  const s = welcomed();
  const info = Buffer.from(JSON.stringify({ id: 'node:7', kind: 'atom', degree: 2 }), 'utf8');
  const framed = Buffer.concat([
    Buffer.from([0x7e, MSG.DEBUG_INFO]),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(info.length); return b; })(),
    info,
  ]);
  assert.doesNotThrow(() => s.apply(framed));

  const seen = [];
  s.onDebug = (m) => seen.push(m);
  s.apply(framed);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, 'node:7');
});

test('an unknown message type does not stall the rest of the frame', () => {
  const s = welcomed();
  const junk = Buffer.from([0x7e, 0xfe, 0x02, 0x00, 0x00, 0x00, 0xaa, 0xbb]);
  s.apply(Buffer.concat([junk, encodeKeyframe(header(1), [nodeAt(1, 1, 1)])]));
  assert.equal(s.nodes.size, 1);
});

test('apply accepts an ArrayBuffer the way the socket delivers it', () => {
  const s = welcomed();
  const bytes = encodeKeyframe(header(1), [nodeAt(1, 5, 5)]);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  s.apply(ab);
  assert.equal(s.nodes.get(1).qx, 5);
});
