export const MAGIC = 0x7e;

// Bump on any change to a message's byte layout: a field added, removed,
// reordered, or resized. The reader is a fixed sequence of typed reads with
// no per-field framing, so a client one version behind does not fail at the
// changed field -- it silently misparses everything after it, or overruns the
// frame and throws deep inside a decode. The handshake compares this so the
// mismatch is refused at HELLO instead.
export const PROTO_VERSION = 1;

export const MSG = {
  HELLO: 0x01,
  WELCOME: 0x02,
  RESCALE: 0x03,
  PING: 0x04,
  PONG: 0x05,
  ROSTER_DELTA: 0x11,

  NODE_LABEL: 0x12,
  ROSTER: 0x13,
  KEYFRAME: 0x20,
  DELTA: 0x21,
  EDGE_DELTA: 0x31,
  POINTER: 0x41,
  GRAB: 0x42,

  VIEW: 0x43,

  MODE: 0x44,

  SPEED: 0x47,

  DEBUG_REQ: 0x45,
  FILTER: 0x46,

  SELECT: 0x48,
  EDIT: 0x49,

  ROWS: 0x4c,
  MARK: 0x4d,

  // A steering intent for an auto-activating control space. Deliberately not
  // folded into SIM_KEY: a digit key is scene-private and a scene never
  // learns which control space it is standing in, so overloading SIM_KEY
  // would mean six copies of the same key binding again -- exactly what
  // server/control-spaces.mjs exists to stop repeating.
  SPACE_CTL: 0x4e,

  PAUSE: 0x4a,

  SIM_KEY: 0x4b,
  META: 0x50,
  DEBUG_INFO: 0x51,

  STATS: 0x52,
  DEBUG_GRID: 0x53,

  DEBUG_FORCES: 0x54,

  FIRE: 0x32,

  HULL: 0x33,

  PRESENCE_SELF: 0x60,
  PRESENCE: 0x61,

  CAMERA: 0x62,

  // The region a viewer is currently standing in, announced only when it
  // changes -- see activeSpace() in src/layout/space-extent.js for the
  // enter/leave hysteresis that decides when that is. An empty id is "you
  // left every steerable pocket", which a client needs telling exactly as
  // much as which one it entered.
  SPACE: 0x63,

  // Where every 3D region on the branch currently ENDS, as a world box each.
  // Broadcast rather than streamed per viewer: an extent is a fact about the
  // region, like the pose, so two viewers looking at one pocket are handed the
  // same rectangle. SPACE says which one has you; this says where they all are,
  // which is what you need to see a pocket you have not walked into yet.
  SPACE_BOX: 0x64,

  // A region's octree, in MODEL space. Sent once per body rather than per
  // tick, because turning the region does not move the tree -- the model holds
  // still and the camera turns, so only the pose in SPACE_BOX changes.
  SPACE_OCTREE: 0x65,

  // How many sockets are open on this server, all branches and scenes counted
  // together. Not a presence roster: PRESENCE is who is looking at YOUR branch
  // and where their viewport is, this is one number about the whole process.
  POPULATION: 0x66,
};

export const SPACE_CTL_OP = { NUDGE: 0, HALT: 1, HOME: 2, TURN: 3 };

export const FLAG = {
  BIG_DPOS: 1 << 0,
  VEL_CHANGED: 1 << 1,
  BIG_DVEL: 1 << 2,
  COLOR_CHANGED: 1 << 3,
  RADIUS_CHANGED: 1 << 4,
  ENTERED: 1 << 5,
  LEFT: 1 << 6,
  STROKE_CHANGED: 1 << 7,
};

export const DEBUG_SEL = { SLOT: 0, NODE_ID: 1, EDGE_ID: 2 };

export const ROW_TYPE_NAME = { 1: 'NODE', 2: 'EDGE' };
export const ROW_OP_NAME = { 1: 'add', 2: 'update', 3: 'remove' };

const invert = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [v, Number(k)]));
export const ROW_TYPE = invert(ROW_TYPE_NAME);
export const ROW_OP = invert(ROW_OP_NAME);

export const ROW_FIELD = {
  ID: 1 << 0,
  KIND: 1 << 1,
  SOURCE: 1 << 2,
  TARGET: 1 << 3,
  LAYER: 1 << 4,
  WEIGHT: 1 << 5,
  LABEL: 1 << 6,
};

export const MAX_PAYLOAD = 0xffffffff;

export const KEYFRAME_MAX_NODES = Math.floor((MAX_PAYLOAD - 15) / 15);

const clampI16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
const clampI8 = (v) => Math.max(-128, Math.min(127, Math.round(v)));

export function quantPos(world, posScale) {
  return clampI16(world / posScale);
}

export function quantVel(vel, velScale) {
  return clampI16(vel / velScale);
}

export function quantRadius(rWorld, maxRadius) {
  const q = Math.round(255 * Math.sqrt(Math.max(0, rWorld) / maxRadius));
  return Math.max(0, Math.min(255, q));
}

class Writer {
  constructor(capacity = 1024) {
    this.buf = Buffer.alloc(capacity);
    this.off = 0;
  }
  ensure(n) {
    if (this.off + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.off + n) cap *= 2;
    const next = Buffer.alloc(cap);
    this.buf.copy(next, 0, 0, this.off);
    this.buf = next;
  }
  u8(v) { this.ensure(1); this.buf.writeUInt8(v & 0xff, this.off); this.off += 1; return this; }
  i8(v) { this.ensure(1); this.buf.writeInt8(clampI8(v), this.off); this.off += 1; return this; }
  u16(v) { this.ensure(2); this.buf.writeUInt16LE(v & 0xffff, this.off); this.off += 2; return this; }
  i16(v) { this.ensure(2); this.buf.writeInt16LE(clampI16(v), this.off); this.off += 2; return this; }
  u24(v) { this.ensure(3); this.buf.writeUIntLE(v & 0xffffff, this.off, 3); this.off += 3; return this; }
  u32(v) { this.ensure(4); this.buf.writeUInt32LE(v >>> 0, this.off); this.off += 4; return this; }
  f32(v) { this.ensure(4); this.buf.writeFloatLE(v, this.off); this.off += 4; return this; }
  bytes(b) { this.ensure(b.length); b.copy(this.buf, this.off); this.off += b.length; return this; }
  done() { return this.buf.subarray(0, this.off); }
}

function frame(type, payload) {
  if (payload.length > MAX_PAYLOAD) {
    throw new Error(
      `TSBP payload for type 0x${type.toString(16)} is ${payload.length} B — exceeds the u32 ` +
      'length field. Something is encoding without bound; AOI culling should have capped this.',
    );
  }
  const w = new Writer(6 + payload.length);
  w.u8(MAGIC).u8(type).u32(payload.length).bytes(payload);
  return w.done();
}

export function encodeHello(h) {
  const w = new Writer(8);
  w.u8(h.protoVersion ?? PROTO_VERSION).u8(h.capFlags ?? 0)
    .u16(h.viewportW ?? 0).u16(h.viewportH ?? 0)
    .u8(0).u8(0);
  return frame(MSG.HELLO, w.done());
}

export function encodeRescale(r) {
  const w = new Writer(12);
  w.f32(r.posScale).f32(r.velScale).u32(r.effectiveFromSeq);
  return frame(MSG.RESCALE, w.done());
}

export function encodePing(clientTime) {
  const w = new Writer(8);
  w.u32(clientTime).u32(0);
  return frame(MSG.PING, w.done());
}
export function encodePong(clientTime, echoTime) {
  const w = new Writer(8);
  w.u32(clientTime).u32(echoTime);
  return frame(MSG.PONG, w.done());
}

export function encodePointer(p) {
  const w = new Writer(16);
  w.u32(p.clientTime).u32(p.seq).i16(p.wx).i16(p.wy)
    .u16(p.zoomQ ?? 0).u8(p.buttons ?? 0).u8(0);
  return frame(MSG.POINTER, w.done());
}

export function encodeGrab(g) {
  const w = new Writer(8);
  w.u32(g.seq).u16(g.slot).u8(g.action);
  return frame(MSG.GRAB, w.done());
}

export function encodeMode(m) {
  const w = new Writer(8);
  w.u32(m.seq).u8(m.mode);
  return frame(MSG.MODE, w.done());
}

export function encodeSpeed(s) {
  const w = new Writer(8);
  w.u32(s.seq).u16(s.speedQ);
  return frame(MSG.SPEED, w.done());
}

export function encodePause(p) {
  const w = new Writer(8);
  w.u32(p.seq).u8(p.paused ? 1 : 0);
  return frame(MSG.PAUSE, w.done());
}

export function encodeSimKey(k) {
  const w = new Writer(12);
  w.u32(k.seq).u8(k.key).i16(k.wx).i16(k.wy);
  return frame(MSG.SIM_KEY, w.done());
}

// nudge / turn / halt / home, per server/control-spaces.mjs. Nudge carries an
// axis and a direction; turn carries three angle deltas in hundredths of a
// degree, which at int16 spans +/-327 degrees a message - far more than one
// drag frame can be. Halt and home act on every axis at once, so there is
// nothing for those bytes to say.
export function encodeSpaceCtl(c) {
  const w = new Writer(8);
  w.u8(c.op);
  if (c.op === SPACE_CTL_OP.NUDGE) w.u8(c.axis).i8(c.dir);
  else if (c.op === SPACE_CTL_OP.TURN) {
    const q = (v) => Math.max(-32768, Math.min(32767, Math.round((v || 0) * 100)));
    w.i16(q(c.rx)).i16(q(c.ry)).i16(q(c.rz));
  }
  return frame(MSG.SPACE_CTL, w.done());
}

export function encodeView(v) {
  const w = new Writer(16);
  w.u32(v.seq).i16(v.cx).i16(v.cy).u16(v.halfW).u16(v.halfH).f32(v.rot || 0);
  return frame(MSG.VIEW, w.done());
}

// The camera the SERVER is driving, on its way back to the one client it
// belongs to. `claimed` is the whole protocol: while it is set the client
// stops fitting the scene and stands where it is told, and the moment it
// clears the client is holding its own camera again.
export function encodeCamera(c) {
  const w = new Writer(28);
  w.u32(c.seq >>> 0).u8(c.claimed ? 1 : 0)
    .f32(c.cx).f32(c.cy).f32(c.halfW).f32(c.halfH).f32(c.rot || 0);
  return frame(MSG.CAMERA, w.done());
}

const SPACE_ID_MAX = 255;

function writeSpaceId(w, id) {
  let bytes = Buffer.from(id || '', 'utf8');
  if (bytes.length > SPACE_ID_MAX) bytes = bytes.subarray(0, SPACE_ID_MAX);
  w.u8(bytes.length).bytes(bytes);
}

// The projected axis basis is the whole reason this carries a payload beyond
// the id: it is viewMatrix()'s two rows, i.e. where model x/y/z land on
// screen right now, so a client can draw the steering gizmo without knowing
// any 3D math or re-deriving the pose itself. dim/ctl ride along so the
// client can tell a merely-3D region (a talk slide, baked, unsteerable) from
// one it may actually turn.
export function encodeSpace(s) {
  const w = new Writer(32);
  writeSpaceId(w, s.id);
  w.u8(s.dim || 0).u8(s.ctl || 0);
  const m = s.axis || [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) w.f32(m[i] || 0);
  return frame(MSG.SPACE, w.done());
}

// f32 for the same reason PRESENCE_SELF is f32: this box is DRAWN against the
// geometry it claims to frame, and a quantized edge would sit visibly off the
// vertices it is supposed to enclose.
export function encodeSpaceBoxes(d) {
  const w = new Writer(64);
  w.u16(d.boxes.length);
  for (const b of d.boxes) {
    writeSpaceId(w, b.id);
    w.u8(b.dim || 0).u8(b.ctl || 0);
    w.f32(b.minX).f32(b.minY).f32(b.maxX).f32(b.maxY);
    const p = b.pose;
    w.u8(p ? 1 : 0);
    if (p) {
      w.f32(p.cx).f32(p.cy);
      for (let i = 0; i < 9; i++) w.f32(p.m[i] || 0);
    }
  }
  return frame(MSG.SPACE_BOX, w.done());
}

export function encodeSpaceOctree(d) {
  const w = new Writer(64);
  writeSpaceId(w, d.id);
  const c = d.cells;
  const n = c ? c.x.length : 0;
  w.u16(n);
  for (let i = 0; i < n; i++) {
    w.f32(c.x[i]).f32(c.y[i]).f32(c.z[i]).f32(c.s[i]).f32(c.m[i]);
  }
  return frame(MSG.SPACE_OCTREE, w.done());
}

export function encodeWelcome(s) {
  const w = new Writer(32);
  w.u32(s.sessionId).u32(s.branchId)
    .f32(s.posScale).f32(s.velScale).f32(s.maxRadius)
    .u16(s.serverTickHz).u16(s.keyframeEvery)
    .u8(s.slotWidth).u8(s.tokenLen);
  return frame(MSG.WELCOME, w.done());
}

export function encodeRosterDelta(d) {
  const w = new Writer(64);
  w.u16(d.adds.length);
  for (const a of d.adds) { w.u16(a.slot).bytes(a.token); }
  w.u16(d.removes.length);
  for (const slot of d.removes) w.u16(slot);
  return frame(MSG.ROSTER_DELTA, w.done());
}

export function encodeNodeLabels(entries) {
  const w = new Writer(64);
  w.u16(entries.length);
  for (const e of entries) {
    let bytes = Buffer.from(e.text || '', 'utf8');
    if (bytes.length > 255) bytes = bytes.subarray(0, 255);
    w.u16(e.slot).u16(e.flags || 0)
      .u8(Math.max(0, Math.min(255, e.importance || 0)))
      .u8(bytes.length).bytes(bytes);
  }
  return frame(MSG.NODE_LABEL, w.done());
}

export function encodeJson(type, obj) {
  return frame(type, Buffer.from(JSON.stringify(obj), 'utf8'));
}

export function encodeMark(m) {
  const w = new Writer(64);
  w.u32(m.seq >>> 0);
  w.bytes(Buffer.from(JSON.stringify({ slots: m.slots || [], ids: m.ids || [] }), 'utf8'));
  return frame(MSG.MARK, w.done());
}

export function encodeFireEvents(events) {
  const w = new Writer(4 + events.length * 4);
  w.u16(events.length);
  for (const e of events) w.i16(e.px).i16(e.py);
  return frame(MSG.FIRE, w.done());
}

export function encodeHullDelta(d) {
  const w = new Writer(64);
  w.u8(d.reliable ? 1 : 0);
  w.u16(d.upserts.length);
  for (const u of d.upserts) {
    const nVerts = u.verts.length / 2;
    if (nVerts > 255) throw new Error(`hull polygon ${nVerts} verts exceeds u8`);
    w.u16(u.hullSlot).u8(u.rgba[0]).u8(u.rgba[1]).u8(u.rgba[2]).u8(u.rgba[3])
      .i16(u.cx).i16(u.cy).i16(u.vx).i16(u.vy)
      .u16(u.fillR).u8(nVerts);
    for (let i = 0; i < u.verts.length; i++) w.i16(u.verts[i]);
  }
  w.u16(d.removes.length);
  for (const slot of d.removes) w.u16(slot);
  return frame(MSG.HULL, w.done());
}

const PRESENCE_LABEL_MAX = 63;

function writePresenceLabel(w, label) {
  let bytes = Buffer.from(label || '', 'utf8');
  if (bytes.length > PRESENCE_LABEL_MAX) bytes = bytes.subarray(0, PRESENCE_LABEL_MAX);
  w.u8(bytes.length).bytes(bytes);
}

export function encodeDebugReq(d) {
  const w = new Writer(32);
  w.u32(d.seq >>> 0);
  if (d.id != null) {
    const id = Buffer.from(String(d.id), 'utf8');
    w.u8(d.sel === DEBUG_SEL.EDGE_ID ? DEBUG_SEL.EDGE_ID : DEBUG_SEL.NODE_ID);
    w.u16(id.length);
    w.bytes(id);
  } else {
    w.u8(DEBUG_SEL.SLOT).u16(d.slot >>> 0);
  }
  return frame(MSG.DEBUG_REQ, w.done());
}

export function encodeRows(r) {
  const rows = r.rows || [];
  const strings = [];
  const index = new Map();
  const intern = (s) => {
    const key = String(s);
    let i = index.get(key);
    if (i === undefined) {
      i = strings.length;
      index.set(key, i);
      strings.push(key);
    }
    return i;
  };

  const encoded = rows.map((row) => {
    let flags = 0;
    const refs = [];
    if (row.id != null) { flags |= ROW_FIELD.ID; refs.push(intern(row.id)); }
    if (row.kind != null) { flags |= ROW_FIELD.KIND; refs.push(intern(row.kind)); }
    if (row.source != null) { flags |= ROW_FIELD.SOURCE; refs.push(intern(row.source)); }
    if (row.target != null) { flags |= ROW_FIELD.TARGET; refs.push(intern(row.target)); }
    if (row.layer != null) { flags |= ROW_FIELD.LAYER; refs.push(intern(row.layer)); }
    if (row.label != null) { flags |= ROW_FIELD.LABEL; refs.push(intern(row.label)); }
    const hasWeight = row.weight != null && Number.isFinite(row.weight);
    if (hasWeight) flags |= ROW_FIELD.WEIGHT;
    return { type: ROW_TYPE[row.type] || 0, op: ROW_OP[row.op] || 0, flags, refs, weight: hasWeight ? row.weight : 0 };
  });

  if (strings.length > 0xffff) {
    throw new Error(`${strings.length} distinct strings exceeds the ${0xffff} string table`);
  }

  const blobs = strings.map((s) => Buffer.from(s, 'utf8'));
  for (const b of blobs) {
    if (b.length > 0xffff) throw new Error(`row string of ${b.length} B exceeds the u16 length field`);
  }

  const w = new Writer(256);
  w.u32(r.seq >>> 0);
  w.u16(blobs.length);
  for (const b of blobs) { w.u16(b.length); w.bytes(b); }
  w.u32(encoded.length);
  for (const e of encoded) {
    w.u8(e.type).u8(e.op).u8(e.flags);
    for (const ref of e.refs) w.u16(ref);
    if (e.flags & ROW_FIELD.WEIGHT) w.f32(e.weight);
  }
  return frame(MSG.ROWS, w.done());
}

export function encodePresenceSelf(p) {
  const w = new Writer(32);
  w.f32(p.cx).f32(p.cy).f32(p.halfW).f32(p.halfH).f32(p.rot || 0);
  w.u8(p.kind ?? 0).u8(p.own ? 1 : 0);
  writePresenceLabel(w, p.label);
  return frame(MSG.PRESENCE_SELF, w.done());
}

export function encodePresence(d) {
  const w = new Writer(64);
  w.u16(d.viewers.length);
  for (const v of d.viewers) {
    w.u32(v.id);
    w.f32(v.cx).f32(v.cy).f32(v.halfW).f32(v.halfH).f32(v.rot || 0);
    w.u8(v.rgb[0]).u8(v.rgb[1]).u8(v.rgb[2]);
    w.u8(v.kind ?? 0).u8(v.self ? 1 : 0);
    writePresenceLabel(w, v.label);
  }
  return frame(MSG.PRESENCE, w.done());
}

export function encodePopulation(n) {
  const w = new Writer(4);
  w.u32(n >>> 0);
  return frame(MSG.POPULATION, w.done());
}

function writeFrameHeader(w, h) {
  w.u32(h.frameSeq).u32(h.tickTime).u32(h.lastAppliedInputSeq || 0);
}

export function encodeKeyframe(header, nodes) {
  const w = new Writer(16 + nodes.length * 16);
  writeFrameHeader(w, header);
  w.u24(nodes.length);
  for (const n of nodes) {
    w.u16(n.slot).i16(n.px).i16(n.py).i16(n.vx).i16(n.vy)
      .u8(n.r).u8(n.g).u8(n.b).u8(n.a).u8(n.radius).u8(n.stroke || 0);
  }
  return frame(MSG.KEYFRAME, w.done());
}

export function encodeDelta(header, baseSeq, changes) {
  const w = new Writer(32 + changes.length * 8);
  writeFrameHeader(w, header);
  w.u32(baseSeq);
  w.u24(changes.length);
  for (const c of changes) {
    if (c.entered) {
      const e = c.entered;
      w.u16(c.slot).u8(FLAG.ENTERED)
        .i16(e.px).i16(e.py).i16(e.vx).i16(e.vy)
        .u8(e.r).u8(e.g).u8(e.b).u8(e.a).u8(e.radius).u8(e.stroke || 0);
      continue;
    }
    if (c.left) {
      w.u16(c.slot).u8(FLAG.LEFT);
      continue;
    }
    const [dx, dy] = c.dpos;
    const bigPos = dx < -128 || dx > 127 || dy < -128 || dy > 127;
    let flags = bigPos ? FLAG.BIG_DPOS : 0;
    let bigVel = false;
    if (c.dvel) {
      flags |= FLAG.VEL_CHANGED;
      const [dvx, dvy] = c.dvel;
      bigVel = dvx < -128 || dvx > 127 || dvy < -128 || dvy > 127;
      if (bigVel) flags |= FLAG.BIG_DVEL;
    }
    if (c.color) flags |= FLAG.COLOR_CHANGED;
    if (c.radius != null) flags |= FLAG.RADIUS_CHANGED;
    if (c.stroke != null) flags |= FLAG.STROKE_CHANGED;
    w.u16(c.slot).u8(flags);
    if (bigPos) w.i16(dx).i16(dy); else w.i8(dx).i8(dy);
    if (c.dvel) {
      if (bigVel) w.i16(c.dvel[0]).i16(c.dvel[1]);
      else w.i8(c.dvel[0]).i8(c.dvel[1]);
    }
    if (c.color) w.u8(c.color[0]).u8(c.color[1]).u8(c.color[2]).u8(c.color[3]);
    if (c.radius != null) w.u8(c.radius);
    if (c.stroke != null) w.u8(c.stroke);
  }
  return frame(MSG.DELTA, w.done());
}

export function encodeEdgeDelta(d) {
  const w = new Writer(64);
  w.u16(d.adds.length);
  for (const a of d.adds) {
    if (a.nodes.length > 255) {
      throw new Error(`hyperedge arity ${a.nodes.length} exceeds u8 — split the hull`);
    }
    w.u16(a.edgeSlot).u8(a.rgba[0]).u8(a.rgba[1]).u8(a.rgba[2]).u8(a.rgba[3]);

    w.u8(a.width != null ? a.width : 11);
    w.u8(a.nodes.length);
    for (const slot of a.nodes) w.u16(slot);
  }
  w.u16(d.removes.length);
  for (const slot of d.removes) w.u16(slot);
  w.u16((d.recolors || []).length);
  for (const rc of d.recolors || []) {
    w.u16(rc.edgeSlot).u8(rc.rgba[0]).u8(rc.rgba[1]).u8(rc.rgba[2]).u8(rc.rgba[3]);
  }
  return frame(MSG.EDGE_DELTA, w.done());
}

class Reader {
  constructor(buf) { this.buf = buf; this.off = 0; }
  u8() { const v = this.buf.readUInt8(this.off); this.off += 1; return v; }
  i8() { const v = this.buf.readInt8(this.off); this.off += 1; return v; }
  u16() { const v = this.buf.readUInt16LE(this.off); this.off += 2; return v; }
  i16() { const v = this.buf.readInt16LE(this.off); this.off += 2; return v; }
  u24() { const v = this.buf.readUIntLE(this.off, 3); this.off += 3; return v; }
  u32() { const v = this.buf.readUInt32LE(this.off); this.off += 4; return v; }
  f32() { const v = this.buf.readFloatLE(this.off); this.off += 4; return v; }
  bytes(n) { const v = this.buf.subarray(this.off, this.off + n); this.off += n; return v; }
  rest() { const v = this.buf.subarray(this.off); this.off = this.buf.length; return v; }
}

function readFrameHeader(r) {
  return { frameSeq: r.u32(), tickTime: r.u32(), lastAppliedInputSeq: r.u32() };
}

export function decodeMessage(buf, offset = 0, opts = {}) {
  const tokenLen = opts.tokenLen ?? 12;
  if (buf.readUInt8(offset) !== MAGIC) {
    throw new Error(`bad magic at ${offset}: 0x${buf.readUInt8(offset).toString(16)}`);
  }
  const type = buf.readUInt8(offset + 1);
  const length = buf.readUInt32LE(offset + 2);
  const next = offset + 6 + length;
  const r = new Reader(buf.subarray(offset + 6, next));

  let msg = null;
  if (type === MSG.HELLO) {
    msg = {
      protoVersion: r.u8(), capFlags: r.u8(),
      viewportW: r.u16(), viewportH: r.u16(),
    };
  } else if (type === MSG.RESCALE) {
    msg = { posScale: r.f32(), velScale: r.f32(), effectiveFromSeq: r.u32() };
  } else if (type === MSG.PING || type === MSG.PONG) {
    msg = { clientTime: r.u32(), echoTime: r.u32() };
  } else if (type === MSG.POINTER) {
    msg = {
      clientTime: r.u32(), seq: r.u32(), wx: r.i16(), wy: r.i16(),
      zoomQ: r.u16(), buttons: r.u8(),
    };
  } else if (type === MSG.GRAB) {
    msg = { seq: r.u32(), slot: r.u16(), action: r.u8() };
  } else if (type === MSG.VIEW) {
    msg = { seq: r.u32(), cx: r.i16(), cy: r.i16(), halfW: r.u16(), halfH: r.u16() };
    msg.rot = r.buf.length >= 16 ? r.f32() : 0;
  } else if (type === MSG.CAMERA) {
    msg = {
      seq: r.u32(), claimed: r.u8() !== 0,
      cx: r.f32(), cy: r.f32(), halfW: r.f32(), halfH: r.f32(), rot: r.f32(),
    };
  } else if (type === MSG.SPACE) {
    const idLen = r.u8();
    const id = r.bytes(idLen).toString('utf8');
    const dim = r.u8();
    const ctl = r.u8();
    const axis = [r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32()];
    msg = { id, dim, ctl, axis };
  } else if (type === MSG.SPACE_BOX) {
    const count = r.u16();
    const boxes = [];
    for (let i = 0; i < count; i++) {
      const id = r.bytes(r.u8()).toString('utf8');
      const box = {
        id, dim: r.u8(), ctl: r.u8(),
        minX: r.f32(), minY: r.f32(), maxX: r.f32(), maxY: r.f32(),
      };
      if (r.u8()) {
        const cx = r.f32(), cy = r.f32();
        const m = [];
        for (let k = 0; k < 9; k++) m.push(r.f32());
        box.pose = { cx, cy, m };
      }
      boxes.push(box);
    }
    msg = { boxes };
  } else if (type === MSG.SPACE_OCTREE) {
    const id = r.bytes(r.u8()).toString('utf8');
    const count = r.u16();
    const cells = { x: [], y: [], z: [], s: [], m: [] };
    for (let i = 0; i < count; i++) {
      cells.x.push(r.f32()); cells.y.push(r.f32()); cells.z.push(r.f32());
      cells.s.push(r.f32()); cells.m.push(r.f32());
    }
    msg = { id, cells };
  } else if (type === MSG.MODE) {
    msg = { seq: r.u32(), mode: r.u8() };
  } else if (type === MSG.SPEED) {
    msg = { seq: r.u32(), speedQ: r.u16() };
  } else if (type === MSG.PAUSE) {
    msg = { seq: r.u32(), paused: r.u8() !== 0 };
  } else if (type === MSG.SIM_KEY) {
    msg = { seq: r.u32(), key: r.u8(), wx: r.i16(), wy: r.i16() };
  } else if (type === MSG.SPACE_CTL) {
    const op = r.u8();
    if (op === SPACE_CTL_OP.NUDGE) msg = { op, axis: r.u8(), dir: r.i8() };
    else if (op === SPACE_CTL_OP.TURN) {
      msg = { op, rx: r.i16() / 100, ry: r.i16() / 100, rz: r.i16() / 100 };
    } else msg = { op };
  } else if (type === MSG.DEBUG_REQ) {
    const seq = r.u32();
    const sel = r.buf.length >= 7 ? r.u8() : DEBUG_SEL.SLOT;
    if (sel === DEBUG_SEL.NODE_ID || sel === DEBUG_SEL.EDGE_ID) {
      const id = r.bytes(r.u16()).toString('utf8');
      msg = { seq, sel, id };
    } else {
      msg = { seq, sel: DEBUG_SEL.SLOT, slot: r.u16() };
    }
  } else if (type === MSG.FILTER || type === MSG.SELECT || type === MSG.EDIT
    || type === MSG.MARK) {

    const seq = r.u32();
    msg = { seq, ...JSON.parse(r.rest().toString('utf8')) };
  } else if (type === MSG.ROWS) {
    const seq = r.u32();
    const strCount = r.u16();
    const strings = [];
    for (let i = 0; i < strCount; i++) strings.push(r.bytes(r.u16()).toString('utf8'));
    const str = (i) => {
      if (i >= strings.length) throw new Error(`ROWS string ref ${i} out of range`);
      return strings[i];
    };
    const count = r.u32();
    const rows = [];
    for (let i = 0; i < count; i++) {
      const rowType = r.u8();
      const rowOp = r.u8();
      const flags = r.u8();
      const row = {
        type: ROW_TYPE_NAME[rowType],
        op: ROW_OP_NAME[rowOp],
      };
      if (flags & ROW_FIELD.ID) row.id = str(r.u16());
      if (flags & ROW_FIELD.KIND) row.kind = str(r.u16());
      if (flags & ROW_FIELD.SOURCE) row.source = str(r.u16());
      if (flags & ROW_FIELD.TARGET) row.target = str(r.u16());
      if (flags & ROW_FIELD.LAYER) row.layer = str(r.u16());
      if (flags & ROW_FIELD.LABEL) row.label = str(r.u16());
      if (flags & ROW_FIELD.WEIGHT) row.weight = r.f32();
      rows.push(row);
    }
    msg = { seq, rows };
  } else if (type === MSG.META || type === MSG.DEBUG_INFO || type === MSG.ROSTER
    || type === MSG.STATS || type === MSG.DEBUG_GRID || type === MSG.DEBUG_FORCES) {
    msg = JSON.parse(r.rest().toString('utf8'));
  } else if (type === MSG.FIRE) {
    const count = r.u16();
    const events = [];
    for (let i = 0; i < count; i++) events.push({ px: r.i16(), py: r.i16() });
    msg = { events };
  } else if (type === MSG.PRESENCE_SELF) {
    const cx = r.f32(), cy = r.f32(), halfW = r.f32(), halfH = r.f32(), rot = r.f32();
    const kind = r.u8();
    const own = r.u8() !== 0;
    const label = r.bytes(r.u8()).toString('utf8');
    msg = { cx, cy, halfW, halfH, rot, kind, own, label };
  } else if (type === MSG.PRESENCE) {
    const count = r.u16();
    const viewers = [];
    for (let i = 0; i < count; i++) {
      const id = r.u32();
      const cx = r.f32(), cy = r.f32(), halfW = r.f32(), halfH = r.f32(), rot = r.f32();
      const rgb = [r.u8(), r.u8(), r.u8()];
      const kind = r.u8();
      const self = r.u8() !== 0;
      const label = r.bytes(r.u8()).toString('utf8');
      viewers.push({ id, cx, cy, halfW, halfH, rot, rgb, kind, self, label });
    }
    msg = { viewers };
  } else if (type === MSG.POPULATION) {
    msg = { count: r.u32() };
  } else if (type === MSG.NODE_LABEL) {
    const count = r.u16();
    const entries = [];
    for (let i = 0; i < count; i++) {
      const slot = r.u16();
      const flags = r.u16();
      const importance = r.u8();
      const len = r.u8();
      entries.push({ slot, flags, importance, text: r.bytes(len).toString('utf8') });
    }
    msg = { entries };
  } else if (type === MSG.WELCOME) {
    msg = {
      sessionId: r.u32(), branchId: r.u32(),
      posScale: r.f32(), velScale: r.f32(), maxRadius: r.f32(),
      serverTickHz: r.u16(), keyframeEvery: r.u16(),
      slotWidth: r.u8(), tokenLen: r.u8(),
    };
  } else if (type === MSG.ROSTER_DELTA) {
    const adds = [];
    const addCount = r.u16();
    for (let i = 0; i < addCount; i++) adds.push({ slot: r.u16(), token: Buffer.from(r.bytes(tokenLen)) });
    const removes = [];
    const removeCount = r.u16();
    for (let i = 0; i < removeCount; i++) removes.push(r.u16());
    msg = { adds, removes };
  } else if (type === MSG.KEYFRAME) {
    const header = readFrameHeader(r);
    const nodeCount = r.u24();
    const nodes = [];
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        slot: r.u16(), px: r.i16(), py: r.i16(), vx: r.i16(), vy: r.i16(),
        r: r.u8(), g: r.u8(), b: r.u8(), a: r.u8(), radius: r.u8(), stroke: r.u8(),
      });
    }
    msg = { ...header, nodes };
  } else if (type === MSG.DELTA) {
    const header = readFrameHeader(r);
    const baseSeq = r.u32();
    const changedCount = r.u24();
    const changes = [];
    for (let i = 0; i < changedCount; i++) {
      const slot = r.u16();
      const flags = r.u8();
      if (flags & FLAG.ENTERED) {
        changes.push({
          slot,
          entered: {
            px: r.i16(), py: r.i16(), vx: r.i16(), vy: r.i16(),
            r: r.u8(), g: r.u8(), b: r.u8(), a: r.u8(), radius: r.u8(), stroke: r.u8(),
          },
        });
        continue;
      }
      if (flags & FLAG.LEFT) { changes.push({ slot, left: true }); continue; }
      const c = { slot };
      c.dpos = flags & FLAG.BIG_DPOS ? [r.i16(), r.i16()] : [r.i8(), r.i8()];
      if (flags & FLAG.VEL_CHANGED) {
        c.dvel = flags & FLAG.BIG_DVEL ? [r.i16(), r.i16()] : [r.i8(), r.i8()];
      }
      if (flags & FLAG.COLOR_CHANGED) c.color = [r.u8(), r.u8(), r.u8(), r.u8()];
      if (flags & FLAG.RADIUS_CHANGED) c.radius = r.u8();
      if (flags & FLAG.STROKE_CHANGED) c.stroke = r.u8();
      changes.push(c);
    }
    msg = { ...header, baseSeq, changes };
  } else if (type === MSG.HULL) {
    const reliable = (r.u8() & 1) === 1;
    const upserts = [];
    const upsertCount = r.u16();
    for (let i = 0; i < upsertCount; i++) {
      const hullSlot = r.u16();
      const rgba = [r.u8(), r.u8(), r.u8(), r.u8()];
      const cx = r.i16(), cy = r.i16(), vx = r.i16(), vy = r.i16();
      const fillR = r.u16();
      const nVerts = r.u8();
      const verts = new Int16Array(nVerts * 2);
      for (let j = 0; j < verts.length; j++) verts[j] = r.i16();
      upserts.push({ hullSlot, rgba, cx, cy, vx, vy, fillR, verts });
    }
    const removes = [];
    const removeCount = r.u16();
    for (let i = 0; i < removeCount; i++) removes.push(r.u16());
    msg = { reliable, upserts, removes };
  } else if (type === MSG.EDGE_DELTA) {
    const adds = [];
    const addCount = r.u16();
    for (let i = 0; i < addCount; i++) {
      const edgeSlot = r.u16();
      const rgba = [r.u8(), r.u8(), r.u8(), r.u8()];
      const width = r.u8();
      const arity = r.u8();
      const nodes = [];
      for (let j = 0; j < arity; j++) nodes.push(r.u16());
      adds.push({ edgeSlot, rgba, width, nodes });
    }
    const removes = [];
    const removeCount = r.u16();
    for (let i = 0; i < removeCount; i++) removes.push(r.u16());
    const recolors = [];
    const recolorCount = r.u16();
    for (let i = 0; i < recolorCount; i++) {
      recolors.push({ edgeSlot: r.u16(), rgba: [r.u8(), r.u8(), r.u8(), r.u8()] });
    }
    msg = { adds, removes, recolors };
  }

  return { type, length, msg, next };
}

export function decodeStream(buf, opts) {
  const out = [];
  let off = 0;
  while (off < buf.length) {
    const d = decodeMessage(buf, off, opts);
    out.push(d);
    off = d.next;
  }
  return out;
}
