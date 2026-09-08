import fs from 'node:fs';
import { encodeMark } from '../protocol/wire.mjs';
import { sendRows } from './rows.mjs';

export function emitOptions(cfg) {
  return {
    file: cfg.args.value('emit', cfg.command === 'emit' ? cfg.subject : null),
    batch: cfg.args.num('batch', 0) || undefined,
    rps: cfg.args.num('rps', 0) || undefined,
    markMax: Math.max(1, cfg.args.num('mark-max', 2000) || 2000),
  };
}

export function markTouched(stream, what, { slots = [], ids = [] }, max) {
  const pool = slots.length ? slots : ids;
  if (!pool.length) return;
  const stride = Math.max(1, Math.ceil(pool.length / max));
  const picked = [];
  for (let i = 0; i < pool.length; i += stride) picked.push(pool[i]);
  stream.send(encodeMark({
    seq: stream.nextSeq(),
    ...(slots.length ? { slots: picked } : { ids: picked }),
  }));
  console.log(`marked ${picked.length} of ${pool.length} ${what} in the browser`
    + (stride > 1 ? ` (every ${stride}th)` : ''));
}

export async function emit(stream, opts) {
  const parsed = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!Array.isArray(rows)) throw new Error(`${opts.file} has no rows array`);

  // Progress is reported as it goes, not at the end: an emit paced to the
  // server's budget can take a while, and a silent CLI looks hung.
  let painted = 0;
  const sent = await sendRows(stream.ws, rows, {
    batch: opts.batch,
    rps: opts.rps,
    backlog: () => (stream.ws && typeof stream.ws.bufferedAmount === 'number' ? stream.ws.bufferedAmount : 0),
    onProgress: ({ sent: n, total, batch, batches }) => {
      const t = Date.now();
      if (n < total && t - painted < 250) return;
      painted = t;
      const pct = Math.round((n / total) * 100);
      process.stdout.write(`\r[companion] sending ${pct}% (${n}/${total} rows, batch ${batch}/${batches})   `);
    },
  });
  if (rows.length) process.stdout.write('\n');
  console.log(`emitted ${sent.rows} row(s) in ${sent.batches} batch(es) at ${sent.rps} rows/sec from ${opts.file}`);

  const touched = new Set();
  for (const row of rows) {
    if (row.type === 'NODE') touched.add(row.id);
    else {
      if (row.source) touched.add(row.source);
      if (row.target) touched.add(row.target);
    }
  }
  markTouched(stream, 'written node(s)', { ids: [...touched] }, opts.markMax);
  return sent;
}
