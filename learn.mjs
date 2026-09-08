import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeHello, encodeMark, encodePresenceSelf } from './protocol/wire.mjs';
import { streamProtocols } from './protocol/auth.mjs';
import { createGraphState } from './read/state.mjs';
import { DEFAULT_SKILL_DIR } from './cli/config.mjs';

export { DEFAULT_SKILL_DIR };

export const INDEX_SKILL = 'hypergraph';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MARK_CHUNK = 2000;
const MARK_BEAT_MS = 90;

export async function fetchCurriculum(origin, ticket) {
  const r = await fetch(`${origin}/curriculum`, {
    headers: ticket ? { Authorization: `Bearer ${ticket}` } : {},
  });
  const body = await r.json().catch(() => ({}));
  if (!body.ok) throw new Error(body.error || `the server has no curriculum (HTTP ${r.status})`);
  return body.lessons || [];
}

function readScene({ wsOrigin, ticket, scene, label, settleMs, onMark }) {
  return new Promise((done, fail) => {
    const state = createGraphState();
    let seq = 0;
    let settled = false;

    const ws = new WebSocket(
      `${wsOrigin}/stream?scene=${encodeURIComponent(scene)}`,
      streamProtocols(ticket),
    );
    ws.binaryType = 'arraybuffer';

    const bail = (err) => {
      try { ws.close(); } catch { /* already gone */ }
      fail(err);
    };

    ws.onerror = () => { if (!settled) bail(new Error(`the socket for ${scene} failed`)); };
    ws.onclose = () => { if (!settled) bail(new Error(`${scene} closed before it settled`)); };
    ws.onmessage = (ev) => state.apply(ev.data);

    ws.onopen = async () => {
      try {
        ws.send(encodeHello({ capFlags: 0b0100, viewportW: 1280, viewportH: 800 }));
        await sleep(settleMs);
        if (!state.welcome) throw new Error(`no WELCOME from ${scene} — is the server running?`);

        ws.send(encodePresenceSelf({
          cx: 0, cy: 0, halfW: 1_000_000, halfH: 1_000_000, kind: 1, label,
        }));

        const mark = async (slots) => {
          for (let i = 0; i < slots.length; i += MARK_CHUNK) {
            ws.send(encodeMark({ seq: ++seq, slots: slots.slice(i, i + MARK_CHUNK) }));
            await sleep(MARK_BEAT_MS);
          }
        };

        const nodeSlots = [...state.nodes.keys()];
        await mark(nodeSlots);
        if (onMark) onMark({ swept: 'nodes', count: nodeSlots.length });

        const wired = [];
        for (const e of state.edges.values()) for (const s of e.slots) wired.push(s);
        await mark(wired);
        if (onMark) onMark({ swept: 'edges', count: state.edges.size });

        settled = true;
        const read = harvest(state);
        try { ws.close(); } catch { /* already gone */ }
        done(read);
      } catch (err) {
        bail(err);
      }
    };
  });
}

function harvest(state) {
  const named = state.labelled();
  const adjacency = state.adjacency();

  const textOf = (slot) => {
    const l = state.labels.get(slot);
    return l && l.text ? l.text : null;
  };

  const isExample = (t) => /^EX\s*\d+\b/.test(t);

  const examples = named
    .filter((n) => isExample(n.text))
    .sort((a, b) => (Number(/^EX\s*(\d+)/.exec(a.text)[1]) - Number(/^EX\s*(\d+)/.exec(b.text)[1])))
    .map((n) => ({
      text: n.text,
      near: [...new Set((adjacency.get(n.slot) || []).map((r) => r.other))]
        .map(textOf)
        .filter((t) => t && !isExample(t))
        .slice(0, 8),
    }));

  const anchors = named
    .filter((n) => !isExample(n.text))
    .slice(0, 40)
    .map((n) => ({ text: n.text, degree: n.degree }));

  return {
    counts: {
      nodes: state.nodes.size,
      edges: state.edges.size,
      hulls: state.hulls.size,
      labelled: named.length,
    },
    examples,
    anchors,
  };
}

const slugOf = (lesson) => lesson.slug || `hypergraph-${lesson.name.replace(/-machine$/, '')}`;

function lessonMarkdown(lesson, read, learnedAt) {
  const out = [];
  out.push('---');
  out.push(`name: ${slugOf(lesson)}`);
  out.push(`description: ${lesson.when || `${lesson.title} in the Tesseract hypergraph.`}`);
  out.push('metadata:');
  out.push(`  lesson: ${lesson.name}`);
  out.push(`  scene: ${lesson.scene}`);
  out.push(`  digest: ${lesson.digest}`);
  out.push(`  learnedAt: ${learnedAt}`);
  out.push('---');
  out.push('');
  out.push(`# ${lesson.title}`);
  out.push('');
  out.push(lesson.teaches);
  out.push('');
  if (lesson.description) {
    out.push(`> ${lesson.description}`);
    out.push('');
  }
  out.push(`Read live from \`${lesson.scene}\` — ${read.counts.nodes} nodes, `
    + `${read.counts.edges} edges, ${read.counts.hulls} hulls, `
    + `${read.counts.labelled} labelled.`);
  out.push('');

  if (read.examples.length) {
    out.push('## The examples');
    out.push('');
    for (const ex of read.examples) {
      out.push(`### ${ex.text.split(/\s+—\s+/)[0]}`);
      out.push('');
      out.push(ex.text);
      out.push('');
      if (ex.near.length) {
        out.push(`Attached to: ${ex.near.map((t) => `\`${t}\``).join(', ')}`);
        out.push('');
      }
    }
  }

  if (read.anchors.length) {
    out.push('## What carries the scene');
    out.push('');
    for (const a of read.anchors) out.push(`- \`${a.text}\` (degree ${a.degree})`);
    out.push('');
  }

  out.push('## Re-read it');
  out.push('');
  out.push('```bash');
  out.push(`hypergraph branch ${lesson.scene} --top 40`);
  out.push('```');
  out.push('');
  return out.join('\n');
}

function indexMarkdown(shelf, locked, learnedAt) {
  const out = [];
  out.push('---');
  out.push('name: hypergraph');
  out.push('description: Map of the Tesseract hypergraph curriculum — which rule lives in '
    + 'which skill. Read when working on a Tesseract scene and it is not yet clear which '
    + 'rule governs, or to find out what else can be learned.');
  out.push('---');
  out.push('');
  out.push('# The Hypergraph curriculum');
  out.push('');
  out.push('Every rule below was read out of a live scene on the server, not written by hand.');
  out.push(`Downloaded ${learnedAt}.`);
  out.push('');
  out.push('Each lesson is its own skill and loads on its own. This page only says which.');
  out.push('');
  out.push('## Held');
  out.push('');
  for (const e of shelf) {
    out.push(`- **\`${slugOf(e.lesson)}\`** — ${e.lesson.title}. `
      + `${e.read.examples.length} worked examples, ${e.read.counts.nodes} nodes.`);
    out.push(`  ${e.lesson.teaches}`);
  }
  out.push('');
  if (locked.length) {
    out.push('## Not held');
    out.push('');
    for (const l of locked) out.push(`- \`${l.slug || l.name}\` — ${l.title}. ${l.locked}`);
    out.push('');
  }
  out.push('## Refresh');
  out.push('');
  out.push('The curriculum grows. A lesson whose digest changed is re-read; the rest are skipped.');
  out.push('');
  out.push('```bash');
  out.push('hypergraph learn         # core lessons');
  out.push('hypergraph learn --all   # everything on offer');
  out.push('```');
  out.push('');
  return out.join('\n');
}

async function heldDigests(root) {
  try {
    const held = JSON.parse(await readFile(join(root, INDEX_SKILL, 'held.json'), 'utf8'));
    return new Map(Object.entries(held));
  } catch {
    return new Map();
  }
}

export async function learn({
  origin,
  ticket,
  label = 'claude',
  skillDir = DEFAULT_SKILL_DIR,
  settleMs = 2500,
  only = null,
  coreOnly = true,
  force = false,
  onProgress = () => {},
}) {
  const wsOrigin = origin.replace(/^http/, 'ws');
  const all = await fetchCurriculum(origin, ticket);

  const wanted = all.filter((l) => {
    if (!l.available) return false;
    if (only && only.length) return only.includes(l.name);
    return coreOnly ? l.core : true;
  });

  const locked = all.filter((l) => !l.available);
  const held = force ? new Map() : await heldDigests(skillDir);
  const fresh = wanted.filter((l) => held.get(l.name) !== l.digest);
  const skipped = wanted.filter((l) => held.get(l.name) === l.digest);

  onProgress({ phase: 'plan', total: fresh.length, skipped: skipped.length, locked: locked.length });

  const learnedAt = new Date().toISOString();
  const entries = [];

  for (let i = 0; i < fresh.length; i++) {
    const lesson = fresh[i];
    onProgress({ phase: 'open', lesson, index: i, total: fresh.length });
    const read = await readScene({
      wsOrigin,
      ticket,
      scene: lesson.scene,
      label,
      settleMs,
      onMark: (m) => onProgress({ phase: 'mark', lesson, index: i, total: fresh.length, ...m }),
    });
    const dir = join(skillDir, slugOf(lesson));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), lessonMarkdown(lesson, read, learnedAt), 'utf8');
    entries.push({ lesson, read, skill: slugOf(lesson) });
    onProgress({
      phase: 'wrote', lesson, index: i, total: fresh.length, skill: slugOf(lesson), read,
    });
  }

  if (entries.length || !held.size) {
    const indexDir = join(skillDir, INDEX_SKILL);
    await mkdir(indexDir, { recursive: true });

    const index = new Map(held);
    for (const e of entries) index.set(e.lesson.name, e.lesson.digest);

    const shelf = wanted
      .map((l) => entries.find((e) => e.lesson.name === l.name))
      .filter(Boolean);

    if (shelf.length) {
      await writeFile(
        join(indexDir, 'SKILL.md'), indexMarkdown(shelf, locked, learnedAt), 'utf8',
      );
    }
    await writeFile(
      join(indexDir, 'held.json'),
      `${JSON.stringify(Object.fromEntries(index), null, 2)}\n`,
      'utf8',
    );
  }

  onProgress({ phase: 'done', learned: entries.length, skipped: skipped.length, skillDir });
  return { skillDir, learned: entries, skipped, locked };
}
