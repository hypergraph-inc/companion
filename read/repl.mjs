import readline from 'node:readline';
import { report } from './census.mjs';
import { reportProbe, DEBUG_SEL } from './probe.mjs';

const HELP = [
  'commands (one per line):',
  '  <id>            probe a node by id',
  '  <id> <hops>     probe a node and walk N hops',
  '  e <id>          probe an edge by id',
  '  s <slot>        probe a slot the census printed, and learn its id',
  '  s <slot> <hops> probe a slot and walk N hops',
  '  r               re-print the census report',
  '  a               re-print the census with adjacency',
  '  ?               this help',
  '  q               quit',
].join('\n');

export async function runRepl({ stream, state, probe, census }) {
  stream.holdOpen();
  console.error(`[companion] repl open — "${stream.label}" stays visible until you quit.`);
  console.error(HELP);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  stream.onSever(() => { try { rl.close(); } catch {} });

  for await (const raw of rl) {
    if (stream.severed) break;
    const line = raw.trim();
    if (!line) continue;
    if (line === 'q' || line === 'quit' || line === 'exit') break;
    if (line === '?' || line === 'help') { console.error(HELP); continue; }
    if (line === 'r') { report(state, census); continue; }
    if (line === 'a') { report(state, { ...census, adjacency: true }); continue; }

    try {
      const parts = line.split(/\s+/);
      if (parts[0] === 's') {
        parts.shift();
        const slot = Number(parts[0]);
        if (!Number.isFinite(slot)) { console.error('[companion] s wants a slot number'); continue; }
        const hops = parts[1] != null ? Math.max(0, Number(parts[1]) || 0) : 0;
        const order = await probe.walkSlot(slot, hops);
        reportProbe(order, `slot ${slot}`, { hops, json: census.json });
        continue;
      }
      let sel = DEBUG_SEL.NODE_ID;
      if (parts[0] === 'e') { sel = DEBUG_SEL.EDGE_ID; parts.shift(); }
      const rootId = parts[0];
      if (!rootId) { console.error('[companion] nothing to probe'); continue; }
      const hops = parts[1] != null ? Math.max(0, Number(parts[1]) || 0) : 0;
      const order = await probe.walk(rootId, hops, sel);
      reportProbe(order, rootId, { hops, json: census.json });
    } catch (err) {
      console.error(`[companion] ${err.message}`);
    }
  }
  rl.close();
}
