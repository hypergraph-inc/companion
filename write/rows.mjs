import { encodeRows } from '../protocol/wire.mjs';
import { validateRow } from '../protocol/csv.js';

// Rows per batch. Kept under the server's smallest burst (the demo tier) so an
// ordinary emit is never refused wholesale; BATCH_CEILING is the hard cap
// --batch may not exceed, since an oversized batch is dropped silently
// server-side with the sender told nothing.
export const MAX_BATCH = 32;
export const BATCH_CEILING = 64;

// Rows/sec the sender paces itself to. The demo tier admits 16/s and a full
// companion 128/s; the conservative default keeps an unconfigured emit inside
// the demo budget, and --rps opens it up for an entitled companion.
export const DEFAULT_RPS = 8;

// Bytes of unflushed socket buffer before the sender waits for the wire.
export const SOCKET_HIGH_WATER = 1 << 20;

export function checkRows(rows) {
  const bad = [];
  rows.forEach((row, i) => {
    const err = validateRow(row);
    if (err) bad.push(`row ${i} (${row && row.id}): ${err}`);
  });
  return bad;
}

export function batches(rows, size = MAX_BATCH) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function sendRows(ws, rows, opts = {}) {
  const bad = checkRows(rows);
  if (bad.length) throw new Error(`${bad.length} invalid row(s):\n  ${bad.slice(0, 5).join('\n  ')}`);

  const asked = Number(opts.batch) || MAX_BATCH;
  const size = Math.max(1, Math.min(asked, BATCH_CEILING));
  if (asked > BATCH_CEILING) {
    console.warn(`[companion] --batch ${asked} exceeds the ${BATCH_CEILING}-row ceiling; sending ${size} per batch`);
  }

  const rps = Math.max(1, Number(opts.rps) || DEFAULT_RPS);
  // An explicit gap overrides the bucket entirely — tests and callers that
  // want a fixed cadence rather than a budget.
  const fixedGap = Number(opts.gapMs) || 0;
  const chunks = batches(rows, size);
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const backlogOf = typeof opts.backlog === 'function' ? opts.backlog : () => 0;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now || (() => Date.now());

  // Spend from a token bucket the same shape as the server's, so the sender
  // runs out of budget exactly where the server would refuse it. Starting the
  // bucket empty means the first batch waits its turn like every other one —
  // a deadline accumulator instead lets batch one through free and only then
  // starts pacing, which reads as a stall right after a fast start.
  let budget = 0;
  let last = now();
  let sent = 0;

  for (let i = 0; i < chunks.length; i++) {
    const n = chunks[i].length;

    if (fixedGap) {
      if (i > 0) await sleep(fixedGap);
    } else {
      for (;;) {
        const t = now();
        budget = Math.min(size, budget + ((t - last) / 1000) * rps);
        last = t;
        if (budget >= n) break;
        await sleep(Math.max(1, Math.ceil(((n - budget) / rps) * 1000)));
      }
      budget -= n;
    }

    // The socket buffer is the other queue that can run away; a send() that
    // outpaces the wire piles up in memory and reports progress that has not
    // left the machine.
    while (backlogOf() > SOCKET_HIGH_WATER) await sleep(8);

    ws.send(encodeRows({ seq: (Number(opts.seq) || 1) + i, rows: chunks[i] }));
    sent += n;
    if (onProgress) onProgress({ sent, total: rows.length, batch: i + 1, batches: chunks.length });
  }

  return { rows: rows.length, batches: chunks.length, rps, batch: size };
}

export const node = (id, kind, weight = 1, label = null) =>
  ({ type: 'NODE', op: 'add', id, kind, weight, ...(label != null ? { label } : {}) });

export const edge = (source, target, layer, weight = 1) =>
  ({ type: 'EDGE', op: 'add', id: `${source}→${target}@${layer}`, source, target, layer, weight });

export const retype = (id, kind) => ({ type: 'NODE', op: 'update', id, kind });

export function colourRows(kind, hex) {
  return [
    node(`color:${hex}`, 'color', 1, hex),
    node(`kind:${kind}`, 'kind-sentinel', 2, kind),
    edge(`kind:${kind}`, `color:${hex}`, 'color', 1),
  ];
}

export const MEMBER_LAYERS = ['memberOf', 'partOf', 'branchMember'];

export function hyperedgeRows({ id, kind, label, members, weight = 5, layer = 'memberOf', memberWeight = 0.5 }) {
  if (!MEMBER_LAYERS.includes(layer)) {
    throw new Error(`hyperedgeRows(${id}): layer "${layer}" does not form hulls; use one of ${MEMBER_LAYERS.join(', ')}`);
  }
  const rows = [node(id, kind, weight, label)];
  const seen = new Set();
  members.forEach((m, i) => {
    if (typeof m !== 'string' || !m) {
      throw new Error(`hyperedgeRows(${id}): member ${i} is not an id: ${JSON.stringify(m)}`);
    }
    if (seen.has(m)) return;
    seen.add(m);
    rows.push(edge(m, id, layer, memberWeight));
  });
  return rows;
}
