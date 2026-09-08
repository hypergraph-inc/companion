const isFlagWord = (a) => typeof a === 'string' && a.startsWith('--');

export function splitCommand(argv) {
  const name = (argv[0] && !argv[0].startsWith('-')) ? argv[0] : null;
  return { name, args: name ? argv.slice(1) : argv };
}

export function createArgs(args) {
  const value = (name, dflt = null) => {
    const i = args.indexOf(`--${name}`);
    if (i === -1) return dflt;
    const v = args[i + 1];
    return (v == null || isFlagWord(v)) ? dflt : v;
  };

  const has = (name) => args.includes(`--${name}`);

  const num = (name, dflt) => {
    const v = value(name, null);
    if (v == null) return dflt;
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  };

  return { value, has, num, raw: args };
}

export function subjectOf(args, booleans) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) continue;
    const prev = i > 0 ? args[i - 1] : null;
    if (prev && prev.startsWith('--') && !booleans.has(prev.slice(2))) continue;
    return a;
  }
  return null;
}
