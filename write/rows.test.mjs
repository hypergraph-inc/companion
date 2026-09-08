import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkRows, batches, sendRows, node, edge, retype, colourRows,
  hyperedgeRows, MEMBER_LAYERS, MAX_BATCH, BATCH_CEILING, DEFAULT_RPS,
} from './rows.mjs';
import { decodeMessage, MSG } from '../protocol/wire.mjs';

const good = node('a', 'atom');

test('checkRows passes valid rows', () => {
  assert.deepEqual(checkRows([node('a', 'atom'), edge('a', 'b', 'calls')]), []);
});

test('checkRows names the index and the id of each bad row', () => {
  const bad = checkRows([good, { type: 'NOPE', op: 'add', id: 'x' }]);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /^row 1 \(x\): invalid type: NOPE/);
});

test('checkRows rejects a missing type, op or id', () => {
  assert.equal(checkRows([{ op: 'add', id: 'x' }]).length, 1);
  assert.equal(checkRows([{ type: 'NODE', id: 'x' }]).length, 1);
  assert.equal(checkRows([{ type: 'NODE', op: 'add' }]).length, 1);
  assert.equal(checkRows([null]).length, 1);
});

test('checkRows requires source, target and layer on an EDGE add', () => {
  const base = { type: 'EDGE', op: 'add', id: 'e' };
  assert.match(checkRows([{ ...base, target: 'b', layer: 'l' }])[0], /requires source/);
  assert.match(checkRows([{ ...base, source: 'a', layer: 'l' }])[0], /requires target/);
  assert.match(checkRows([{ ...base, source: 'a', target: 'b' }])[0], /requires layer/);
});

// A remove names the edge by id, so it does not need the endpoints again.
test('an EDGE remove needs only its id', () => {
  assert.deepEqual(checkRows([{ type: 'EDGE', op: 'remove', id: 'e' }]), []);
});

test('batches splits on the size and keeps every row', () => {
  const rows = Array.from({ length: 10 }, (_, i) => node(`n${i}`, 'atom'));
  const out = batches(rows, 4);
  assert.deepEqual(out.map((b) => b.length), [4, 4, 2]);
  assert.equal(out.flat().length, 10);
  assert.equal(out.flat()[9].id, 'n9');
});

test('batches leaves a short list in one chunk, and an empty one in none', () => {
  assert.equal(batches([good], 4).length, 1);
  assert.deepEqual(batches([], 4), []);
});

test('sendRows refuses the whole write when any row is invalid', async () => {
  const sent = [];
  await assert.rejects(
    () => sendRows({ send: (b) => sent.push(b) }, [good, { type: 'X', op: 'add', id: 'bad' }]),
    /1 invalid row\(s\)/,
  );
  assert.equal(sent.length, 0);
});

test('sendRows shows only the first five bad rows but counts them all', async () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ type: 'X', op: 'add', id: `b${i}` }));
  await assert.rejects(() => sendRows({ send: () => {} }, rows), (err) => {
    assert.match(err.message, /^9 invalid row\(s\)/);
    assert.equal(err.message.split('\n').length - 1, 5);
    return true;
  });
});

test('sendRows encodes one ROWS message per batch and reports the tally', async () => {
  const sent = [];
  const rows = Array.from({ length: 5 }, (_, i) => node(`n${i}`, 'atom'));
  const out = await sendRows({ send: (b) => sent.push(b) }, rows, { batch: 2, gapMs: 1 });
  assert.equal(out.rows, 5);
  assert.equal(out.batches, 3);
  assert.equal(sent.length, 3);
  const { type, msg } = decodeMessage(Buffer.from(sent[0]), 0, {});
  assert.equal(type, MSG.ROWS);
  assert.equal(msg.rows.length, 2);
  assert.equal(msg.rows[0].id, 'n0');
});

test('sendRows numbers the batches in order from the given seq', async () => {
  const seqs = [];
  const rows = Array.from({ length: 6 }, (_, i) => node(`n${i}`, 'atom'));
  await sendRows({ send: (b) => seqs.push(decodeMessage(Buffer.from(b), 0, {}).msg.seq) },
    rows, { batch: 2, gapMs: 1, seq: 10 });
  assert.deepEqual(seqs, [10, 11, 12]);
});

test('sendRows defaults to MAX_BATCH', async () => {
  const sent = [];
  const rows = Array.from({ length: MAX_BATCH + 1 }, (_, i) => node(`n${i}`, 'atom'));
  const out = await sendRows({ send: (b) => sent.push(b) }, rows, { gapMs: 1 });
  assert.equal(out.batches, 2);
});

test('sendRows on no rows sends nothing', async () => {
  const sent = [];
  const out = await sendRows({ send: (b) => sent.push(b) }, []);
  assert.equal(out.rows, 0);
  assert.equal(out.batches, 0);
  assert.equal(sent.length, 0);
});

test('node builds a valid row and omits an absent label', () => {
  assert.deepEqual(node('a', 'atom'), { type: 'NODE', op: 'add', id: 'a', kind: 'atom', weight: 1 });
  assert.equal(node('a', 'atom', 3, 'A').label, 'A');
  assert.equal('label' in node('a', 'atom'), false);
  assert.equal(node('a', 'atom', 1, '').label, '');
  assert.deepEqual(checkRows([node('a', 'atom', 3, 'A')]), []);
});

test('edge names itself source-target-layer and validates', () => {
  const e = edge('a', 'b', 'calls', 2);
  assert.equal(e.id, 'a→b@calls');
  assert.equal(e.weight, 2);
  assert.deepEqual(checkRows([e]), []);
});

test('retype is an update carrying only the new kind', () => {
  assert.deepEqual(retype('a', 'color'), { type: 'NODE', op: 'update', id: 'a', kind: 'color' });
  assert.deepEqual(checkRows([retype('a', 'color')]), []);
});

// A kind is coloured with three rows: the colour node, the kind sentinel, and
// the edge between them.
test('colourRows is a sentinel, a colour and the edge joining them', () => {
  const rows = colourRows('atom', '#ff8800');
  assert.equal(rows.length, 3);
  assert.deepEqual(checkRows(rows), []);
  const [colour, sentinel, link] = rows;
  assert.equal(colour.id, 'color:#ff8800');
  assert.equal(colour.kind, 'color');
  assert.equal(colour.label, '#ff8800');
  assert.equal(sentinel.id, 'kind:atom');
  assert.equal(sentinel.kind, 'kind-sentinel');
  assert.equal(link.source, 'kind:atom');
  assert.equal(link.target, 'color:#ff8800');
  assert.equal(link.layer, 'color');
});

test('hyperedgeRows mints the hull node and one member edge each', () => {
  const rows = hyperedgeRows({ id: 'h', kind: 'group', label: 'H', members: ['a', 'b'] });
  assert.deepEqual(checkRows(rows), []);
  assert.equal(rows[0].id, 'h');
  assert.equal(rows[0].label, 'H');
  assert.equal(rows[0].weight, 5);
  assert.deepEqual(rows.slice(1).map((r) => [r.source, r.target, r.layer, r.weight]),
    [['a', 'h', 'memberOf', 0.5], ['b', 'h', 'memberOf', 0.5]]);
});

test('hyperedgeRows takes weights and an alternative member layer', () => {
  const rows = hyperedgeRows({
    id: 'h', kind: 'group', label: 'H', members: ['a'],
    weight: 9, layer: 'partOf', memberWeight: 2,
  });
  assert.equal(rows[0].weight, 9);
  assert.equal(rows[1].layer, 'partOf');
  assert.equal(rows[1].weight, 2);
});

// Only these three layers form hulls; any other silently produces no hull at
// all, so it is refused at the point the rows are built.
test('hyperedgeRows refuses a layer that does not form a hull', () => {
  assert.throws(
    () => hyperedgeRows({ id: 'h', kind: 'g', label: 'H', members: ['a'], layer: 'calls' }),
    /does not form hulls/,
  );
  for (const layer of MEMBER_LAYERS) {
    assert.doesNotThrow(() => hyperedgeRows({ id: 'h', kind: 'g', label: 'H', members: ['a'], layer }));
  }
});

test('hyperedgeRows drops a repeated member rather than double-wiring it', () => {
  const rows = hyperedgeRows({ id: 'h', kind: 'g', label: 'H', members: ['a', 'b', 'a'] });
  assert.deepEqual(rows.slice(1).map((r) => r.source), ['a', 'b']);
});

test('hyperedgeRows refuses a member that is not an id', () => {
  for (const bad of [null, 42, '', { id: 'a' }]) {
    assert.throws(
      () => hyperedgeRows({ id: 'h', kind: 'g', label: 'H', members: ['a', bad] }),
      /member 1 is not an id/,
    );
  }
});

test('hyperedgeRows with no members is just the hull node', () => {
  assert.equal(hyperedgeRows({ id: 'h', kind: 'g', label: 'H', members: [] }).length, 1);
});


test('sendRows clamps --batch to the ceiling so a batch is never dropped as oversized', async () => {
  const rows = Array.from({ length: BATCH_CEILING + 50 }, (_, i) => node(`n${i}`, 'atom'));
  const sent = [];
  const out = await sendRows({ send: (b) => sent.push(b) }, rows, { batch: 99999, gapMs: 1 });
  assert.equal(out.batches, 2);
  const first = decodeMessage(Buffer.from(sent[0]), 0, {}).msg;
  assert.equal(first.rows.length, BATCH_CEILING);
});

test('sendRows paces from rps when no explicit gap is given', async () => {
  const rows = Array.from({ length: MAX_BATCH * 3 }, (_, i) => node(`n${i}`, 'atom'));
  const started = Date.now();
  await sendRows({ send: () => {} }, rows, { rps: MAX_BATCH * 1000 });
  assert.ok(Date.now() - started < 500, 'a high rps should barely sleep');
});

// TESS_DEMO_ROWS_BURST / TESS_DEMO_ROWS_PER_SEC in server/stream-host.mjs. A
// batch above the burst is dropped whole and the sender is told nothing, so
// the client's own ceiling has to stay under it.
const DEMO_BURST = 64;
const DEMO_RPS = 16;

test('the default batch and ceiling stay under the smallest server burst', () => {
  assert.ok(MAX_BATCH <= DEMO_BURST, `MAX_BATCH ${MAX_BATCH} must fit the ${DEMO_BURST}-row demo burst`);
  assert.ok(BATCH_CEILING <= DEMO_BURST, `BATCH_CEILING ${BATCH_CEILING} must fit the ${DEMO_BURST}-row demo burst`);
});

test('the default pacing stays under the demo refill rate', () => {
  assert.ok(DEFAULT_RPS <= DEMO_RPS, `DEFAULT_RPS ${DEFAULT_RPS} must not outrun the demo tier's ${DEMO_RPS}/s`);
});
