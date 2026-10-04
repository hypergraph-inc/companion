import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createArgs, subjectOf } from './args.mjs';
import { BOOLEAN_FLAGS } from './commands.mjs';

export const DEFAULT_SKILL_DIR = join(homedir(), '.tesseract', 'skills');
export const AGENTS = {
  claude: { name: 'Claude Code', home: join(homedir(), '.claude') },
  codex: { name: 'Codex', home: join(homedir(), '.codex') },
};
export const agentSkillDir = (entry) => (AGENTS[entry] ? join(AGENTS[entry].home, 'skills') : entry);

const isPathy = (s) => /^[/~.]/.test(s);
const expandPath = (s) => resolve(s.replace(/^~(?=$|\/)/, homedir()));
export const DEFAULT_KEY_DIR = join(homedir(), '.tesseract', 'companions');
export const DEFAULT_ORIGIN = 'https://hypergraph.digital';
export const FALLBACK_LABEL = 'tesseract-companion';

const keyDir = () => process.env.TESS_COMPANION_KEYS || DEFAULT_KEY_DIR;
const defaultLabelFile = () => join(keyDir(), 'default-label');
const defaultOriginFile = () => join(keyDir(), 'default-origin');
const agentsFile = () => join(keyDir(), 'agents.json');

export function parseAgents(list) {
  if (list == null) return null;
  const words = list.split(',').map((s) => s.trim()).filter(Boolean);
  if (words.length === 1 && words[0].toLowerCase() === 'none') return [];
  const entries = words.map((w) => (isPathy(w) ? expandPath(w) : w.toLowerCase()));
  const unknown = entries.filter((e) => !AGENTS[e] && !isAbsolute(e));
  if (unknown.length) {
    throw new Error(`unknown agent "${unknown.join('", "')}" — choose from `
      + `${Object.keys(AGENTS).join(', ')}, a skills folder path, or none`);
  }
  return [...new Set(entries)];
}

export function readAgents() {
  try {
    const { agents, link } = JSON.parse(readFileSync(agentsFile(), 'utf8'));
    return { agents: agents.filter((e) => AGENTS[e] || isAbsolute(e)), link: link === true };
  } catch {
    return null;
  }
}

export function writeAgents({ agents, link }) {
  mkdirSync(keyDir(), { recursive: true, mode: 0o700 });
  writeFileSync(agentsFile(), `${JSON.stringify({ agents, link }, null, 2)}\n`, { mode: 0o600 });
}

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

export function readDefaultOrigin() {
  try {
    const origin = readFileSync(defaultOriginFile(), 'utf8').trim();
    return origin || null;
  } catch {
    return null;
  }
}

export function writeDefaultOrigin(origin) {
  mkdirSync(keyDir(), { recursive: true, mode: 0o700 });
  writeFileSync(defaultOriginFile(), `${origin}\n`, { mode: 0o600 });
}

export function clearDefaultOrigin() {
  try {
    rmSync(defaultOriginFile(), { force: true });
    return true;
  } catch {
    return false;
  }
}

export function resolveConfig({ command, args }) {
  const a = createArgs(args);
  const subject = subjectOf(args, BOOLEAN_FLAGS);

  const port = a.num('port', 3000);
  // --port with no --origin means "talk to my local dev server"; with neither
  // given, fall back to whatever `set-origin` last saved, else the hosted
  // instance instead of a hardcoded localhost port most users don't run.
  const origin = (a.value('origin')
    || (a.has('port') ? `http://127.0.0.1:${port}` : null)
    || readDefaultOrigin()
    || DEFAULT_ORIGIN)
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
    agents: readAgents(),
    keyDir: keyDir(),
  };
}
