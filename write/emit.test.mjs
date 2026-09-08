import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emit, markTouched } from './emit.mjs';
import { node, edge } from './rows.mjs';
import { decodeMessage, MSG } from '../protocol/wire.mjs';

function fakeStream() {
  const sent = [];
  let seq = 0;
  const stream = { nextSeq: () => ++seq, send: (b) => sent.push(Buffer.from(b)), ws: null };
  stream.ws = { send: (b) => sent.push(Buffer.from(b)) };
  return { stream, sent };
}

const decodeAll = (sent) => sent.map((b) => decodeMessage(b, 0, {}));
const marks = (sent) => decodeAll(sent).filter((d) => d.type === MSG.MARK)
  .map((d) => JSON.parse(d.msg.json ?? d.msg.payload ?? JSON.stringify(d.msg)));

// emit is async, so the console has to stay silenced across the await, not just
// across the call that starts it.
async function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
}

function markPayload(buf) {
  // MARK is a u32 seq followed by JSON; decode it here rather than depend on
  // which field name the decoder happens to use.
  const json = buf.subarray(6 + 4).toString('utf8');
  return JSON.parse(json);
}

test('markTouched sends nothing when nothing was touched', () => {
  const { stream, sent } = fakeStream();
  quiet(() => markTouched(stream, 'node(s)', { slots: [], ids: [] }, 100));
  assert.equal(sent.length, 0);
});

test('markTouched marks by slot when slots are given', () => {
  const { stream, sent } = fakeStream();
  quiet(() => markTouched(stream, 'sampled node(s)', { slots: [1, 2, 3] }, 100));
  assert.equal(sent.length, 1);
  const m = markPayload(sent[0]);
  assert.deepEqual(m.slots, [1, 2, 3]);
  assert.deepEqual(m.ids, []);
});

test('markTouched marks by id when there are no slots', () => {
  const { stream, sent } = fakeStream();
  quiet(() => markTouched(stream, 'written node(s)', { ids: ['a', 'b'] }, 100));
  const m = markPayload(sent[0]);
  assert.deepEqual(m.ids, ['a', 'b']);
  assert.deepEqual(m.slots, []);
});

test('slots win over ids when both are present', () => {
  const { stream, sent } = fakeStream();
  quiet(() => markTouched(stream, 'n', { slots: [7], ids: ['a'] }, 100));
  const m = markPayload(sent[0]);
  assert.deepEqual(m.slots, [7]);
  assert.deepEqual(m.ids, []);
});

// A big sweep is thinned rather than dropped -- the point is to show where an
// agent had its hands, not to mark every last node.
test('a sweep over the cap is thinned by a stride, not truncated', () => {
  const { stream, sent } = fakeStream();
  const slots = Array.from({ length: 100 }, (_, i) => i);
  quiet(() => markTouched(stream, 'n', { slots }, 10));
  const picked = markPayload(sent[0]).slots;
  assert.ok(picked.length <= 10);
  assert.equal(picked[0], 0);
  assert.equal(picked[1] - picked[0], 10);
  assert.ok(picked.at(-1) > 80, 'the thinning must still reach the far end of the sweep');
});

test('a sweep under the cap is marked whole', () => {
  const { stream, sent } = fakeStream();
  quiet(() => markTouched(stream, 'n', { slots: [1, 2, 3] }, 10));
  assert.deepEqual(markPayload(sent[0]).slots, [1, 2, 3]);
});

test('markTouched reports the stride it used', () => {
  const lines = [];
  const log = console.log;
  console.log = (s) => lines.push(s);
  try {
    const { stream } = fakeStream();
    markTouched(stream, 'sampled node(s)', { slots: Array.from({ length: 50 }, (_, i) => i) }, 10);
  } finally { console.log = log; }
  assert.match(lines[0], /marked \d+ of 50 sampled node\(s\)/);
  assert.match(lines[0], /every 5th/);
});

function withRowsFile(rows, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'companion-emit-'));
  const file = join(dir, 'rows.json');
  writeFileSync(file, typeof rows === 'string' ? rows : JSON.stringify(rows));
  try { return fn(file); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('emit accepts a bare array of rows', async () => {
  const rows = [node('a', 'atom'), node('b', 'atom')];
  const { stream, sent } = fakeStream();
  const out = await withRowsFile(rows, (f) =>
    quiet(() => emit(stream, { file: f, markMax: 100 })));
  assert.equal(out.rows, 2);
  assert.equal(out.batches, 1);
  assert.equal(decodeAll(sent).filter((d) => d.type === MSG.ROWS).length, 1);
});

test('emit accepts a { rows } wrapper', async () => {
  const { stream } = fakeStream();
  const out = await withRowsFile({ rows: [node('a', 'atom')] }, (f) =>
    quiet(() => emit(stream, { file: f, markMax: 100 })));
  assert.equal(out.rows, 1);
});

test('emit refuses a file with no rows array', async () => {
  await assert.rejects(
    () => withRowsFile({ nope: 1 }, (f) => emit(stream(), { file: f, markMax: 100 })),
    /has no rows array/,
  );
  function stream() { return fakeStream().stream; }
});

test('emit refuses invalid rows before sending anything', async () => {
  const { stream, sent } = fakeStream();
  await assert.rejects(
    () => withRowsFile([{ type: 'NOPE', op: 'add', id: 'x' }], (f) =>
      emit(stream, { file: f, markMax: 100 })),
    /invalid row/,
  );
  assert.equal(sent.length, 0);
});

// Writing marks what it touched: a node row touches its id, an edge row touches
// both of its endpoints.
test('emit marks node ids and both ends of every edge', async () => {
  const rows = [node('a', 'atom'), edge('a', 'b', 'calls')];
  const { stream, sent } = fakeStream();
  await withRowsFile(rows, (f) => quiet(() => emit(stream, { file: f, markMax: 100 })));
  const mark = sent.map(markPayloadOrNull).find(Boolean);
  assert.deepEqual(mark.ids.sort(), ['a', 'b']);

  function markPayloadOrNull(b) {
    return decodeMessage(b, 0, {}).type === MSG.MARK ? markPayload(b) : null;
  }
});

test('emit marks a touched id once, however many rows named it', async () => {
  const rows = [node('a', 'atom'), edge('a', 'b', 'calls'), edge('b', 'a', 'calls')];
  const { stream, sent } = fakeStream();
  await withRowsFile(rows, (f) => quiet(() => emit(stream, { file: f, markMax: 100 })));
  const mark = sent.map((b) => (decodeMessage(b, 0, {}).type === MSG.MARK ? markPayload(b) : null))
    .find(Boolean);
  assert.equal(mark.ids.length, 2);
});

test('emit honours the batch size', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => node(`n${i}`, 'atom'));
  const { stream, sent } = fakeStream();
  const out = await withRowsFile(rows, (f) =>
    quiet(() => emit(stream, { file: f, batch: 2, markMax: 100 })));
  assert.equal(out.batches, 3);
  assert.equal(decodeAll(sent).filter((d) => d.type === MSG.ROWS).length, 3);
});

test('emit reports a missing file rather than a silent no-op', async () => {
  const { stream } = fakeStream();
  await assert.rejects(() => emit(stream, { file: '/nope/does/not/exist.json', markMax: 100 }),
    /ENOENT/);
});
