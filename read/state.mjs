import { decodeMessage, MSG } from '../protocol/wire.mjs';

export function createGraphState() {
  const nodes = new Map();
  const labels = new Map();
  const edges = new Map();
  const hulls = new Map();
  const viewers = new Map();

  const state = {
    nodes,
    labels,
    edges,
    hulls,
    viewers,
    welcome: null,
    posScale: 1,
    lastTick: 0,
    frames: 0,
    onDebug: null,
    apply,
    bounds,
    degrees,
    adjacency,
    labelled,
    viewerMatching,
  };

  const enter = (slot, n) => {
    nodes.set(slot, {
      qx: n.px, qy: n.py,
      r: n.r, g: n.g, b: n.b, a: n.a, radius: n.radius,
    });
  };

  function apply(buf) {
    let off = 0;
    const b = Buffer.from(buf);
    while (off < b.length) {
      const { type, msg, next } = decodeMessage(b, off, {
        tokenLen: state.welcome ? state.welcome.tokenLen : 12,
      });
      off = next;
      if (type === MSG.WELCOME) {
        state.welcome = msg;
        state.posScale = msg.posScale;
      } else if (type === MSG.RESCALE) {
        state.posScale = msg.posScale;
      } else if (type === MSG.NODE_LABEL) {
        for (const e of msg.entries) labels.set(e.slot, { text: e.text, importance: e.importance });
      } else if (type === MSG.ROSTER_DELTA) {
        for (const slot of msg.removes) { nodes.delete(slot); labels.delete(slot); }
      } else if (type === MSG.EDGE_DELTA) {
        for (const a of msg.adds) edges.set(a.edgeSlot, { slots: a.nodes, rgba: a.rgba });
        for (const slot of msg.removes) edges.delete(slot);
      } else if (type === MSG.HULL) {
        for (const u of msg.upserts) {
          hulls.set(u.hullSlot, { qcx: u.cx, qcy: u.cy, qfillR: u.fillR, rgba: u.rgba });
        }
        for (const slot of msg.removes) hulls.delete(slot);
      } else if (type === MSG.PRESENCE) {
        viewers.clear();
        for (const v of msg.viewers) viewers.set(v.id, v);
      } else if (type === MSG.DEBUG_INFO) {
        if (msg && msg.id != null && state.onDebug) state.onDebug(msg);
      } else if (type === MSG.KEYFRAME) {
        state.frames++;
        state.lastTick = msg.tickTime;
        const seen = new Set();
        for (const n of msg.nodes) { enter(n.slot, n); seen.add(n.slot); }
        for (const slot of [...nodes.keys()]) if (!seen.has(slot)) nodes.delete(slot);
      } else if (type === MSG.DELTA) {
        state.frames++;
        state.lastTick = msg.tickTime;
        for (const c of msg.changes) {
          if (c.left) { nodes.delete(c.slot); continue; }
          if (c.entered) { enter(c.slot, c.entered); continue; }
          const n = nodes.get(c.slot);
          if (!n) continue;
          n.qx += c.dpos[0];
          n.qy += c.dpos[1];
          if (c.color) { [n.r, n.g, n.b, n.a] = c.color; }
          if (c.radius != null) n.radius = c.radius;
        }
      }
    }
  }

  function bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes.values()) {
      const x = n.qx * state.posScale;
      const y = n.qy * state.posScale;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (!Number.isFinite(x0)) return null;
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }

  function degrees() {
    const deg = new Map();
    for (const e of edges.values()) {
      for (const s of e.slots) deg.set(s, (deg.get(s) || 0) + 1);
    }
    return deg;
  }

  function adjacency() {
    const adj = new Map();
    for (const [edgeSlot, e] of edges) {
      const slots = e.slots || [];
      const rgba = e.rgba >>> 0;
      for (const s of slots) {
        let row = adj.get(s);
        if (!row) { row = []; adj.set(s, row); }
        for (const o of slots) {
          if (o !== s) row.push({ other: o, rgba, edgeSlot });
        }
      }
    }
    for (const row of adj.values()) row.sort((a, b) => (a.rgba - b.rgba) || (a.other - b.other));
    return adj;
  }

  function labelled() {
    const deg = degrees();
    const out = [];
    for (const [slot, l] of labels) {
      const n = nodes.get(slot);
      if (!n || !l.text) continue;
      out.push({
        slot,
        text: l.text,
        importance: l.importance,
        degree: deg.get(slot) || 0,
        x: Math.round(n.qx * state.posScale),
        y: Math.round(n.qy * state.posScale),
      });
    }
    out.sort((a, b) =>
      (b.importance - a.importance) || (b.degree - a.degree) || a.text.localeCompare(b.text));
    return out;
  }

  function viewerMatching(name) {
    const want = String(name).toLowerCase();
    return [...viewers.values()]
      .find((v) => !v.self && (v.label || '').toLowerCase().includes(want)) || null;
  }

  return state;
}
