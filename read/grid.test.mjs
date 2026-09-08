import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  sampleGrid, at, worldOf, rasterOf, writePng, fieldOf, renderField, stats,
  DEFAULT_CELL, DEFAULT_RAMP,
} from './grid.mjs';

const nodesOf = (...pts) => new Map(pts.map(([slot, qx, qy, c = [10, 20, 30, 255]], i) =>
  [slot ?? i, { qx, qy, r: c[0], g: c[1], b: c[2], a: c[3] }]));

test('an empty view samples to null', () => {
  assert.equal(sampleGrid(new Map(), 1), null);
});

test('the grid spans the extent, with the origin at the low corner', () => {
  const g = sampleGrid(nodesOf([1, 0, 0], [2, 32, 16]), 1, { cell: 16 });
  assert.equal(g.cell, 16);
  assert.equal(g.x0, 0);
  assert.equal(g.y0, 0);
  assert.equal(g.w, 3);
  assert.equal(g.h, 2);
  assert.equal(g.total, 2);
  assert.equal(g.filled, 2);
});

test('posScale is applied before the world is bucketed', () => {
  const g = sampleGrid(nodesOf([1, 0, 0], [2, 10, 0]), 4, { cell: 16 });
  assert.equal(g.x0, 0);
  assert.equal(g.w, Math.round(40 / 16) + 1);
});

test('a single node makes a one-cell grid', () => {
  const g = sampleGrid(nodesOf([1, 7, -7]), 1);
  assert.equal(g.w, 1);
  assert.equal(g.h, 1);
  assert.equal(g.cell, DEFAULT_CELL);
  assert.equal(g.filled, 1);
});

test('the sampled colour lands in the right cell', () => {
  const g = sampleGrid(nodesOf([1, 0, 0, [1, 2, 3, 4]], [2, 16, 0, [9, 8, 7, 6]]), 1, { cell: 16 });
  assert.deepEqual(at(g, 0, 0), [1, 2, 3, 4]);
  assert.deepEqual(at(g, 1, 0), [9, 8, 7, 6]);
});

// Two nodes in one cell is one filled cell, but both slots were sampled -- the
// caller marks what it touched, and touching means both.
test('nodes sharing a cell fill it once but record both slots', () => {
  const g = sampleGrid(nodesOf([1, 0, 0], [2, 2, 2]), 1, { cell: 16 });
  assert.equal(g.filled, 1);
  assert.equal(g.total, 2);
  assert.deepEqual(g.slots.sort(), [1, 2]);
});

test('an explicit box crops the nodes outside it', () => {
  const g = sampleGrid(nodesOf([1, 0, 0], [2, 1000, 1000]), 1,
    { cell: 16, x0: 0, y0: 0, x1: 32, y1: 32 });
  assert.equal(g.total, 2);
  assert.equal(g.filled, 1);
  assert.deepEqual(g.slots, [1]);
});

test('at is bounds-checked in every direction', () => {
  const g = sampleGrid(nodesOf([1, 0, 0]), 1);
  assert.equal(at(g, -1, 0), null);
  assert.equal(at(g, 0, -1), null);
  assert.equal(at(g, g.w, 0), null);
  assert.equal(at(g, 0, g.h), null);
});

test('worldOf inverts the bucketing', () => {
  const g = sampleGrid(nodesOf([1, 100, 200]), 1, { cell: 16 });
  assert.deepEqual(worldOf(g, 0, 0), [100, 200]);
  assert.deepEqual(worldOf(g, 2, 3), [132, 248]);
});

test('rasterOf blows each cell up by the scale', () => {
  const g = sampleGrid(nodesOf([1, 0, 0, [1, 2, 3, 4]]), 1);
  const r = rasterOf(g, 3);
  assert.equal(r.w, g.w * 3);
  assert.equal(r.h, g.h * 3);
  assert.equal(r.rgba.length, r.w * r.h * 4);
  assert.deepEqual([...r.rgba.subarray(0, 4)], [1, 2, 3, 4]);
});

test('an empty cell takes the background', () => {
  const g = sampleGrid(nodesOf([1, 0, 0], [2, 32, 0]), 1, { cell: 16 });
  const r = rasterOf(g, 1, [7, 7, 7]);
  assert.deepEqual([...r.rgba.subarray(4, 8)], [7, 7, 7, 255]);
});

test('writePng writes a real PNG', () => {
  const file = join(tmpdir(), `companion-grid-${process.pid}.png`);
  try {
    const g = sampleGrid(nodesOf([1, 0, 0], [2, 32, 32]), 1, { cell: 16 });
    const out = writePng(g, file, 2);
    assert.equal(out.file, file);
    assert.equal(out.w, g.w * 2);
    const bytes = readFileSync(file);
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(bytes.subarray(12, 16).toString('latin1'), 'IHDR');
    assert.equal(bytes.readUInt32BE(16), out.w);
    assert.equal(bytes.readUInt32BE(20), out.h);
  } finally {
    rmSync(file, { force: true });
  }
});

// NaN is "no node here", which is what keeps an empty cell out of the stats and
// out of the ASCII ramp.
test('a field is NaN wherever no node was sampled', () => {
  const g = sampleGrid(nodesOf([1, 0, 0], [2, 32, 0]), 1, { cell: 16 });
  const v = fieldOf(g, 'alpha');
  assert.equal(Number.isNaN(v[1]), true);
  assert.equal(Number.isNaN(v[0]), false);
});

test('the built-in fields compute what they say', () => {
  const g = sampleGrid(nodesOf([1, 0, 0, [100, 50, 20, 200]]), 1);
  assert.equal(fieldOf(g, 'red')[0], 100);
  assert.equal(fieldOf(g, 'grn')[0], 50);
  assert.equal(fieldOf(g, 'blu')[0], 20);
  assert.equal(fieldOf(g, 'alpha')[0], 200);
  assert.equal(fieldOf(g, 'warm')[0], 80);
  assert.equal(fieldOf(g, 'green')[0], 50 - 60);
  assert.ok(Math.abs(fieldOf(g, 'luma')[0] - (100 * 0.299 + 50 * 0.587 + 20 * 0.114)) < 1e-9);
});

test('an expression field sees r g b a and l', () => {
  const g = sampleGrid(nodesOf([1, 0, 0, [10, 20, 30, 40]]), 1);
  assert.equal(fieldOf(g, 'r + g + b + a')[0], 100);
  assert.equal(fieldOf(g, 'l')[0], fieldOf(g, 'luma')[0]);
});

// tex is local standard deviation of luma, so a flat patch is zero and an
// alternating one is not.
test('tex is zero on a flat patch and positive on a varied one', () => {
  const flat = sampleGrid(new Map([
    [1, { qx: 0, qy: 0, r: 100, g: 100, b: 100, a: 255 }],
    [2, { qx: 16, qy: 0, r: 100, g: 100, b: 100, a: 255 }],
  ]), 1, { cell: 16 });
  const varied = sampleGrid(new Map([
    [1, { qx: 0, qy: 0, r: 0, g: 0, b: 0, a: 255 }],
    [2, { qx: 16, qy: 0, r: 255, g: 255, b: 255, a: 255 }],
  ]), 1, { cell: 16 });
  assert.equal(fieldOf(flat, 'tex')[0], 0);
  assert.ok(fieldOf(varied, 'tex')[0] > 0);
});

test('renderField says so when the field is entirely empty', () => {
  const g = sampleGrid(nodesOf([1, 0, 0]), 1);
  assert.equal(renderField(g, new Float64Array(g.w * g.h).fill(NaN), {}), 'field is empty');
});

test('renderField maps low to the first ramp character and high to the last', () => {
  const g = sampleGrid(nodesOf([1, 0, 0], [2, 16, 0]), 1, { cell: 16 });
  const out = renderField(g, Float64Array.from([0, 10]), { ramp: '.#' });
  const row = out.split('\n')[1];
  assert.match(out, /range 0\.0 \.\. 10\.0/);
  assert.equal(row.slice(5), '.#');
});

test('renderField leaves a blank where the field is NaN', () => {
  const g = sampleGrid(nodesOf([1, 0, 0], [2, 32, 0]), 1, { cell: 16 });
  const out = renderField(g, Float64Array.from([5, NaN, 9]), { ramp: '.#' });
  assert.equal(out.split('\n')[1].slice(5), '. #');
});

test('renderField step thins both axes and reports itself', () => {
  const g = sampleGrid(nodesOf([1, 0, 0], [2, 64, 64]), 1, { cell: 16 });
  const values = new Float64Array(g.w * g.h).fill(1);
  const full = renderField(g, values, { step: 1 }).split('\n').length;
  const thin = renderField(g, values, { step: 2 }).split('\n');
  assert.ok(thin.length < full);
  assert.match(thin[0], /step 2/);
});

test('a flat field does not divide by a zero span', () => {
  const g = sampleGrid(nodesOf([1, 0, 0], [2, 16, 0]), 1, { cell: 16 });
  const out = renderField(g, Float64Array.from([5, 5]), { ramp: DEFAULT_RAMP });
  assert.doesNotMatch(out, /NaN/);
  assert.match(out, /range 5\.0 \.\. 5\.0/);
});

test('stats ignores NaN and returns null when nothing is left', () => {
  const g = sampleGrid(nodesOf([1, 0, 0], [2, 16, 0]), 1, { cell: 16 });
  const box = [0, 0, g.w - 1, g.h - 1];
  assert.equal(stats(g, Float64Array.from([NaN, NaN]), box), null);
  assert.equal(stats(g, Float64Array.from([4, NaN]), box).n, 1);
});

test('stats reports order statistics over the box', () => {
  const nodes = new Map(Array.from({ length: 10 }, (_, i) =>
    [i, { qx: i * 16, qy: 0, r: 0, g: 0, b: 0, a: 255 }]));
  const g = sampleGrid(nodes, 1, { cell: 16 });
  const s = stats(g, Float64Array.from(Array.from({ length: 10 }, (_, i) => i)),
    [0, 0, g.w - 1, g.h - 1]);
  assert.equal(s.n, 10);
  assert.equal(s.min, 0);
  assert.equal(s.max, 9);
  assert.equal(s.median, 5);
});

test('stats clips a box that runs off the grid', () => {
  const g = sampleGrid(nodesOf([1, 0, 0]), 1);
  const s = stats(g, Float64Array.from([3]), [-5, -5, 500, 500]);
  assert.equal(s.n, 1);
  assert.equal(s.min, 3);
});
