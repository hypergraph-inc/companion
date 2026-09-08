import { writeFileSync } from 'node:fs';
import { encodePng } from './png.mjs';

export const DEFAULT_CELL = 16;

export function sampleGrid(nodes, posScale, opts = {}) {
  const pts = [];
  for (const [slot, n] of nodes) {
    pts.push({ slot, x: n.qx * posScale, y: n.qy * posScale, r: n.r, g: n.g, b: n.b, a: n.a });
  }
  if (!pts.length) return null;

  const cell = Number(opts.cell) || DEFAULT_CELL;
  let x0 = opts.x0, y0 = opts.y0, x1 = opts.x1, y1 = opts.y1;
  if (x0 == null || y0 == null || x1 == null || y1 == null) {
    let ax0 = Infinity, ay0 = Infinity, ax1 = -Infinity, ay1 = -Infinity;
    for (const p of pts) {
      if (p.x < ax0) ax0 = p.x;
      if (p.x > ax1) ax1 = p.x;
      if (p.y < ay0) ay0 = p.y;
      if (p.y > ay1) ay1 = p.y;
    }
    x0 = x0 ?? ax0; y0 = y0 ?? ay0; x1 = x1 ?? ax1; y1 = y1 ?? ay1;
  }

  const w = Math.max(1, Math.round((x1 - x0) / cell) + 1);
  const h = Math.max(1, Math.round((y1 - y0) / cell) + 1);
  const cells = new Array(w * h).fill(null);
  const slots = [];
  let filled = 0;
  for (const p of pts) {
    const gx = Math.round((p.x - x0) / cell);
    const gy = Math.round((p.y - y0) / cell);
    if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
    const i = gy * w + gx;
    if (cells[i] === null) filled++;
    cells[i] = [p.r, p.g, p.b, p.a];
    slots.push(p.slot);
  }
  return { w, h, cell, x0, y0, cells, slots, filled, total: pts.length };
}

export const at = (grid, gx, gy) =>
  (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) ? null : grid.cells[gy * grid.w + gx];

export const worldOf = (grid, gx, gy) => [grid.x0 + gx * grid.cell, grid.y0 + gy * grid.cell];

export function rasterOf(grid, scale = 3, background = [0, 0, 0]) {
  const w = grid.w * scale;
  const h = grid.h * scale;
  const rgba = Buffer.allocUnsafe(w * h * 4);
  for (let gy = 0; gy < grid.h; gy++) {
    for (let gx = 0; gx < grid.w; gx++) {
      const c = at(grid, gx, gy) || background;
      for (let dy = 0; dy < scale; dy++) {
        const row = (gy * scale + dy) * w;
        for (let dx = 0; dx < scale; dx++) {
          const i = (row + gx * scale + dx) * 4;
          rgba[i] = c[0];
          rgba[i + 1] = c[1];
          rgba[i + 2] = c[2];
          rgba[i + 3] = c[3] ?? 255;
        }
      }
    }
  }
  return { rgba, w, h };
}

export function writePng(grid, file, scale = 3, background = [0, 0, 0]) {
  const { rgba, w, h } = rasterOf(grid, scale, background);
  writeFileSync(file, encodePng(w, h, rgba));
  return { file, w, h };
}

const LUMA = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;

const BUILTIN = {
  luma: LUMA,
  warm: (c) => c[0] - c[2],
  green: (c) => c[1] - (c[0] + c[2]) / 2,
  alpha: (c) => c[3],
  red: (c) => c[0], grn: (c) => c[1], blu: (c) => c[2],
};

export function fieldOf(grid, spec, texRadius = 2) {
  const out = new Float64Array(grid.w * grid.h).fill(NaN);
  if (spec === 'tex') {
    const l = new Float64Array(grid.w * grid.h).fill(NaN);
    for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i]) l[i] = LUMA(grid.cells[i]);
    for (let gy = 0; gy < grid.h; gy++) {
      for (let gx = 0; gx < grid.w; gx++) {
        let n = 0, s = 0, s2 = 0;
        for (let dy = -texRadius; dy <= texRadius; dy++) {
          for (let dx = -texRadius; dx <= texRadius; dx++) {
            const nx = gx + dx, ny = gy + dy;
            if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
            const v = l[ny * grid.w + nx];
            if (Number.isNaN(v)) continue;
            n++; s += v; s2 += v * v;
          }
        }
        if (n) out[gy * grid.w + gx] = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
      }
    }
    return out;
  }
  const fn = BUILTIN[spec] || Function('r', 'g', 'b', 'a', 'l', `return (${spec});`);
  const call = BUILTIN[spec] ? (c) => fn(c) : (c) => fn(c[0], c[1], c[2], c[3], LUMA(c));
  for (let i = 0; i < grid.cells.length; i++) {
    const c = grid.cells[i];
    if (c) out[i] = call(c);
  }
  return out;
}

export const DEFAULT_RAMP = ' .:-=+*#%@';

export function renderField(grid, values, opts = {}) {
  const ramp = opts.ramp || DEFAULT_RAMP;
  const step = Math.max(1, Number(opts.step) || 1);
  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (Number.isNaN(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return 'field is empty';
  const span = hi - lo || 1;
  const lines = [];
  lines.push(`range ${lo.toFixed(1)} .. ${hi.toFixed(1)}   ramp "${ramp}" low->high`
    + `   grid ${grid.w}x${grid.h} cell ${grid.cell}   step ${step}`);
  for (let gy = 0; gy < grid.h; gy += step) {
    let s = String(gy).padStart(4) + ' ';
    for (let gx = 0; gx < grid.w; gx += step) {
      const v = values[gy * grid.w + gx];
      if (Number.isNaN(v)) { s += ' '; continue; }
      const k = Math.min(ramp.length - 1, Math.floor(((v - lo) / span) * ramp.length));
      s += ramp[k];
    }
    lines.push(s);
  }
  return lines.join('\n');
}

export function stats(grid, values, box) {
  const [x0, y0, x1, y1] = box;
  const a = [];
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) continue;
      const v = values[gy * grid.w + gx];
      if (!Number.isNaN(v)) a.push(v);
    }
  }
  if (!a.length) return null;
  a.sort((p, q) => p - q);
  const pick = (f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
  return { n: a.length, min: a[0], p10: pick(0.1), median: pick(0.5), p90: pick(0.9), max: a[a.length - 1] };
}
