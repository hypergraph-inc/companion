import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateRow } from './csv.js';

test('a well-formed NODE and EDGE pass', () => {
  assert.equal(validateRow({ type: 'NODE', op: 'add', id: 'a', kind: 'atom' }), null);
  assert.equal(validateRow({ type: 'EDGE', op: 'add', id: 'e', source: 'a', target: 'b', layer: 'l' }), null);
});

test('a row that is not an object is refused', () => {
  for (const bad of [null, undefined, 'row', 42, []]) {
    assert.ok(validateRow(bad), `${JSON.stringify(bad)} should not validate`);
  }
});

test('only NODE and EDGE are types', () => {
  assert.match(validateRow({ type: 'HYPEREDGE', op: 'add', id: 'a' }), /invalid type/);
  assert.match(validateRow({ type: 'node', op: 'add', id: 'a' }), /invalid type/);
});

test('only add, update and remove are ops', () => {
  for (const op of ['add', 'update', 'remove']) {
    assert.equal(validateRow({ type: 'NODE', op, id: 'a' }), null);
  }
  assert.match(validateRow({ type: 'NODE', op: 'mov', id: 'a' }), /invalid op/);
  assert.match(validateRow({ type: 'NODE', op: 'ADD', id: 'a' }), /invalid op/);
});

test('the id must be a non-empty string', () => {
  assert.match(validateRow({ type: 'NODE', op: 'add' }), /missing id/);
  assert.match(validateRow({ type: 'NODE', op: 'add', id: '' }), /missing id/);
  assert.match(validateRow({ type: 'NODE', op: 'add', id: 7 }), /missing id/);
});

// t is optional, but a t that is not a number would land in the history as a
// timestamp nothing can order.
test('t is optional but must be finite when present', () => {
  assert.equal(validateRow({ type: 'NODE', op: 'add', id: 'a', t: 0 }), null);
  assert.equal(validateRow({ type: 'NODE', op: 'add', id: 'a', t: null }), null);
  assert.match(validateRow({ type: 'NODE', op: 'add', id: 'a', t: 'now' }), /invalid t/);
  assert.match(validateRow({ type: 'NODE', op: 'add', id: 'a', t: NaN }), /invalid t/);
  assert.match(validateRow({ type: 'NODE', op: 'add', id: 'a', t: Infinity }), /invalid t/);
});

test('only an EDGE add needs its endpoints', () => {
  assert.match(validateRow({ type: 'EDGE', op: 'add', id: 'e', target: 'b', layer: 'l' }), /requires source/);
  assert.equal(validateRow({ type: 'EDGE', op: 'remove', id: 'e' }), null);
  assert.equal(validateRow({ type: 'EDGE', op: 'update', id: 'e', weight: 2 }), null);
});
