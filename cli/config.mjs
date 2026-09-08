import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createArgs, subjectOf } from './args.mjs';
import { BOOLEAN_FLAGS } from './commands.mjs';

export const DEFAULT_SKILL_DIR = join(homedir(), '.claude', 'skills');
export const DEFAULT_KEY_DIR = join(homedir(), '.tesseract', 'companions');
export const DEFAULT_ORIGIN = 'https://hypergraph.digital';
export const FALLBACK_LABEL = 'tesseract-companion';

const keyDir = () => process.env.TESS_COMPANION_KEYS || DEFAULT_KEY_DIR;
const defaultLabelFile = () => join(keyDir(), 'default-label');

export function readDefaultLabel() {
  try {
    const label = readFileSync(defaultLabelFile(), 'utf8').trim();
    return label || null;
  } catch {
    return null;
  }
}

export function writeDefaultLabel(label) {
  mkdirSync(keyDir(), { recursive: true, mode: 0o700 });
  writeFileSync(defaultLabelFile(), `${label}\n`, { mode: 0o600 });
}

export function resolveConfig({ command, args }) {
  const a = createArgs(args);
  const subject = subjectOf(args, BOOLEAN_FLAGS);

  const port = a.num('port', 3000);
  // --port with no --origin means "talk to my local dev server"; with neither
  // given there is no server to guess a port for, so this goes to the hosted
  // instance instead of a hardcoded localhost port most users don't run.
  const origin = (a.value('origin') || (a.has('port') ? `http://127.0.0.1:${port}` : DEFAULT_ORIGIN))
    .replace(/\/+$/, '');

  const linger = a.num('linger', 3);

  return {
    command,
    subject,
    args: a,

    port,
    origin,
    wsOrigin: origin.replace(/^http/, 'ws'),

    // --label wins, then (for `welcome`) the bare name being welcomed, then
    // whatever `welcome` last set as default, then the fallback identity
    // everyone starts on before they have welcomed anyone.
    label: a.value('label')
      || (command === 'welcome' ? subject : null)
      || readDefaultLabel()
      || FALLBACK_LABEL,
    json: a.has('json'),
    settleMs: a.num('settle', 2500),
    lingerMs: Math.max(1, linger) * 1000,

    scene: a.value('scene', command === 'branch' ? subject : null),
    own: a.has('own'),
    join: a.value('join', null),

    skillDir: a.value('skill-dir')
      || process.env.TESS_COMPANION_SKILLS
      || DEFAULT_SKILL_DIR,
    keyDir: keyDir(),
  };
}
