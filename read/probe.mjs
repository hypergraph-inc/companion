import { encodeDebugReq, DEBUG_SEL } from '../protocol/wire.mjs';

export { DEBUG_SEL };

const REPLY_MS = 3000;

export function probeOptions(cfg) {
  return {
    id: cfg.args.value('probe', cfg.command === 'probe' ? cfg.subject : null),
    edge: cfg.args.value('probe-edge', null),
    slot: cfg.args.has('probe-slot') ? cfg.args.num('probe-slot', 0) : null,
    hops: Math.max(0, cfg.args.num('hops', 0)),
    json: cfg.json,
  };
}

export function createProbe(stream, state) {
  let waiter = null;
  const seen = new Map();

  state.onDebug = (info) => {
    seen.set(info.id, info);
    if (waiter) { const w = waiter; waiter = null; w(info); }
  };

  const ask = (req) => new Promise((resolve) => {
    const timer = setTimeout(() => { waiter = null; resolve(null); }, REPLY_MS);
    waiter = (info) => { clearTimeout(timer); resolve(info); };
    stream.send(encodeDebugReq({ seq: stream.nextSeq(), ...req }));
  });

  const askFor = (id, sel = DEBUG_SEL.NODE_ID) => ask({ sel, id });
  const askSlot = (slot) => ask({ sel: DEBUG_SEL.SLOT, slot });

  async function walkFrom(root, hops) {
    const order = [];
    let frontier = [root];
    const visited = new Set();
    for (let depth = 0; depth <= hops; depth++) {
      const next = [];
      for (const seed of frontier) {
        const info = await seed();
        if (!info) continue;
        if (info.id != null) visited.add(info.id);
        order.push({ depth, info });
        for (const e of info.edges || []) {
          if (visited.has(e.other)) continue;
          visited.add(e.other);
          next.push(() => askFor(e.other));
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return order;
  }

  const walk = (rootId, hops, sel) => walkFrom(() => askFor(rootId, sel), hops);
  const walkSlot = (slot, hops) => walkFrom(() => askSlot(slot), hops);

  return { askFor, askSlot, walk, walkSlot, seen };
}

export function reportProbe(order, rootId, { hops = 0, json = false } = {}) {
  if (!order.length) {
    console.log(`\nprobe ${rootId}: NOT FOUND`);
    return;
  }
  if (json) {
    console.log(JSON.stringify(order.map((o) => ({ depth: o.depth, ...o.info })), null, 2));
    return;
  }
  console.log(`\nprobe ${rootId} — ${order.length} node(s) within ${hops} hop(s):`);
  for (const { depth, info } of order) {
    const pos = info.x == null ? 'unplaced' : `${Math.round(info.x)},${Math.round(info.y)}`;
    console.log(`  ${'  '.repeat(depth)}${info.id}`
      + `  kind=${info.kind}  deg=${info.degree}  ${pos}`
      + (info.label != null ? `  "${info.label}"` : ''));
    for (const e of info.edges || []) {
      console.log(`  ${'  '.repeat(depth)}    ${e.dir === 'out' ? '->' : '<-'} ${e.other} @${e.layer}`);
    }
  }
}
