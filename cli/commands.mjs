const spec =(sig, help) => {
  const [name, arg = null] = sig.split(' ');
  return { name, arg, help };
};

const GLOBAL = [
  spec('port <n>', 'local dev server port (default 3000); implies http://127.0.0.1'),
  spec('origin <url>', 'server origin; overrides --port and the hosted default'),
  spec('label <name>', 'the name this key appears under (default: the welcomed identity, else tesseract-companion)'),
  spec('json', 'emit machine-readable output'),
  spec('settle <ms>', 'how long to let the stream fill before reading (default 2500)'),
  spec('linger <s>', 'seconds to stay visible once the work is done (default 3, minimum 1)'),
];

const JOIN = [
  spec('join <token>', 'join this session token instead of resolving one'),
  spec('own', 'do not join a browser session at all'),
  spec('no-pair', 'never start the pairing flow'),
  spec('no-open', 'print the pairing link instead of opening a browser'),
  spec('no-learn', 'skip the curriculum download that follows a fresh pairing'),
];

const CENSUS = [
  spec('top <n>', 'how many labelled nodes to list (default 40)'),
  spec('adjacency', 'list what each labelled node is wired to'),
  spec('adjacency-max <n>', 'cap the adjacency listing (default 60)'),
  spec('cx <n>', 'aim the view at this x before reading'),
  spec('cy <n>', 'aim the view at this y before reading'),
  spec('halfW <n>', 'half-width of the aimed view (default 500)'),
  spec('halfH <n>', 'half-height of the aimed view (default 500)'),
  spec('follow <name>', 'aim at whatever viewer matching <name> is looking at'),
];

const PROBE = [
  spec('probe <id>', 'walk structure out from this node id'),
  spec('probe-edge <id>', 'walk structure out from this edge id'),
  spec('probe-slot <n>', 'walk structure out from a slot the census printed'),
  spec('hops <n>', 'how far to walk from the probed id (default 0)'),
];

const RENDER = [
  spec('render <file>', 'write the sampled view to this PNG'),
  spec('field <spec>', 'print one or more ASCII fields (comma separated)'),
  spec('cell <n>', 'world units per sampled cell (default 16)'),
  spec('scale <n>', 'PNG pixels per cell (default 3)'),
  spec('ramp <chars>', 'characters to draw a field with, low to high'),
  spec('field-step <n>', 'sample every Nth cell when printing a field (default 1)'),
];

const WRITE = [
  spec('emit <file>', 'write the rows in this JSON file into the hypergraph'),
  spec('batch <n>', 'rows per batch (default 32, max 1000)'),
  spec('rps <n>', 'rows/sec to pace at (default 8; full companions may raise it)'),
  spec('mark-max <n>', 'cap how many touched nodes get marked (default 2000)'),
];

export const COMMANDS = {
  welcome: {
    summary: 'create (or select) a companion identity and make it the default',
    subject: 'name',
    flags: [
      spec('no-pair', 'never start the pairing flow'),
      spec('no-open', 'print the pairing link instead of opening a browser'),
      spec('no-learn', 'skip the curriculum download that follows a fresh pairing'),
      spec('no-default', 'do not make this identity the default for future commands'),
    ],
  },
  read: {
    summary: 'census the view; --probe/--probe-edge for structure, --repl to stay open',
    subject: null,
    flags: [...CENSUS, spec('repl', 'stay open and take probes on stdin'), ...PROBE, ...RENDER, ...WRITE, ...JOIN],
  },
  branch: {
    summary: 'census a named scene instead of a live browser session',
    subject: 'scene',
    flags: [spec('scene <name>', 'the scene to read'), ...CENSUS, ...PROBE, ...RENDER],
  },
  learn: {
    summary: 'download the curriculum this key is entitled to',
    subject: 'lesson',
    flags: [
      spec('all', 'download every lesson on offer, not just the core ones'),
      spec('relearn', 're-read lessons whose digest has not changed'),
      spec('skill-dir <dir>', 'where lessons are written (default ~/.claude/skills)'),
      spec('no-pair', 'never start the pairing flow'),
      spec('no-open', 'print the pairing link instead of opening a browser'),
    ],
  },
  emit: {
    summary: 'write rows from a JSON file into the hypergraph',
    subject: 'file',
    flags: [...WRITE, ...JOIN],
  },
  probe: {
    summary: 'walk structure from one id',
    subject: 'id',
    flags: [...PROBE, spec('repl', 'stay open and take probes on stdin'), ...JOIN],
  },
  render: {
    summary: 'sample the view to a PNG and/or an ASCII field',
    subject: 'file',
    flags: [...RENDER, ...CENSUS, ...JOIN],
  },
};

export const BOOLEAN_FLAGS = new Set([
  'help', 'h', 'version', 'V',
  ...[...Object.values(COMMANDS).flatMap((c) => c.flags), ...GLOBAL]
    .filter((f) => !f.arg)
    .map((f) => f.name),
]);

const table = (flags) => {
  const seen = new Set();
  const rows = [];
  for (const f of flags) {
    const sig = `--${f.name}${f.arg ? ` ${f.arg}` : ''}`;
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    rows.push(`  ${sig.padEnd(22)}${f.help}`);
  }
  return rows;
};

export function usage() {
  return [
    'usage: hypergraph <command> [options]',
    '',
    ...Object.entries(COMMANDS).map(([k, v]) => `  ${k.padEnd(8)}${v.summary}`),
    '',
    'run `hypergraph <command> --help` for the options a command takes.',
    'every command accepts --port/--origin, --label, --json, --linger.',
  ].join('\n');
}

export function commandHelp(name) {
  const c = COMMANDS[name];
  const subject = c.subject ? ` <${c.subject}>` : '';
  return [
    `usage: hypergraph ${name}${subject} [options]`,
    '',
    c.summary,
    '',
    ...table(c.flags),
    '',
    'common to every command:',
    ...table(GLOBAL),
  ].join('\n');
}
