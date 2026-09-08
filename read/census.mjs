export function censusOptions(cfg) {
  return {
    top: cfg.args.num('top', 40),
    json: cfg.json,
    adjacency: cfg.args.has('adjacency'),
    adjacencyMax: cfg.args.num('adjacency-max', 60),
  };
}

function build(state, opts) {
  const bb = state.bounds();
  const labelled = state.labelled();

  const viewers = [...state.viewers.values()].map((v) => ({
    id: v.id,
    label: v.label || `viewer ${v.id}`,
    kind: v.kind === 1 ? 'agent' : 'human',
    self: v.self,
    cx: Math.round(v.cx),
    cy: Math.round(v.cy),
    halfW: Math.round(v.halfW),
    halfH: Math.round(v.halfH),
  }));

  const out = {
    tick: state.lastTick,
    frames: state.frames,
    nodes: state.nodes.size,
    edges: state.edges.size,
    hulls: state.hulls.size,
    labelled: labelled.length,
    bounds: bb && {
      x0: Math.round(bb.x0), y0: Math.round(bb.y0),
      x1: Math.round(bb.x1), y1: Math.round(bb.y1),
      w: Math.round(bb.w), h: Math.round(bb.h),
    },
    viewers,
    top: labelled.slice(0, opts.top),
  };

  if (opts.adjacency) {
    const adj = state.adjacency();
    const name = (slot) => {
      const l = state.labels.get(slot);
      return l && l.text ? l.text : null;
    };
    const rows = [];
    for (const l of labelled) {
      const row = adj.get(l.slot);
      if (!row || !row.length) continue;
      rows.push({
        slot: l.slot,
        text: l.text,
        to: row.map((r) => ({
          other: r.other,
          text: name(r.other),
          rgba: `#${(r.rgba >>> 8).toString(16).padStart(6, '0')}`,
        })),
      });
      if (rows.length >= opts.adjacencyMax) break;
    }
    out.adjacency = rows;
  }

  return out;
}

export function report(state, opts) {
  const out = build(state, opts);

  if (opts.json) {
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  console.log(`tick ${out.tick}  frames ${out.frames}`);
  console.log(`${out.nodes} nodes, ${out.edges} edges, ${out.hulls} hulls, ${out.labelled} labelled`);
  if (out.bounds) {
    console.log(`bounds  x ${out.bounds.x0}..${out.bounds.x1}  y ${out.bounds.y0}..${out.bounds.y1}`
      + `  (${out.bounds.w} x ${out.bounds.h})`);
  }

  if (out.viewers.length) {
    console.log(`\nviewers (${out.viewers.length}):`);
    for (const p of out.viewers) {
      console.log(`  ${p.self ? '*' : ' '} ${p.label.padEnd(16)} ${p.kind.padEnd(6)}`
        + ` at ${String(p.cx).padStart(7)},${String(p.cy).padStart(7)}`
        + `  +-${p.halfW}x${p.halfH}`);
    }
  }

  if (out.top.length) {
    console.log(`\ntop ${out.top.length} of ${out.labelled} labelled:`);
    for (const l of out.top) {
      console.log(`  ${String(l.importance).padStart(3)}  deg ${String(l.degree).padStart(3)}`
        + `  ${String(l.x).padStart(7)},${String(l.y).padStart(7)}  ${l.text}`);
    }
  } else {
    console.log('\nno labelled nodes in view');
  }

  if (out.adjacency) {
    console.log(`\nadjacency (${out.adjacency.length} of ${out.labelled} labelled):`);
    for (const r of out.adjacency) {
      console.log(`  ${r.slot} "${r.text}"`);
      for (const t of r.to) {
        console.log(`      -> ${String(t.other).padStart(5)}  ${t.rgba}`
          + (t.text != null ? `  "${t.text}"` : ''));
      }
    }
  }

  return out;
}
