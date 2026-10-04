import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { AGENTS, agentSkillDir, parseAgents } from './config.mjs';

export const installedAgents = () => Object.keys(AGENTS).filter((id) => existsSync(AGENTS[id].home));

export async function onboardAgents({ agentsFlag = null, noLink = false, interactive = process.stdin.isTTY }) {
  let agents = parseAgents(agentsFlag);
  let link = noLink || (agents && !agents.length) ? false : null;
  if (agents != null && (link != null || !interactive)) return { agents, link: link ?? true };
  if (!interactive) return null;

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    if (agents == null) {
      const found = installedAgents();
      const names = Object.entries(AGENTS).map(([id, a]) => `${id} (${a.name})`).join(', ');
      console.error(`[companion] which coding agents should read the lessons? ${names},`
        + ' a skills folder path, or none (comma separated)');
      for (;;) {
        const ans = (await rl.question(`[companion] agents [${found.join(',') || 'none'}]: `)).trim();
        try {
          agents = parseAgents(ans || found.join(',') || 'none');
          break;
        } catch (err) {
          console.error(`[companion] ${err.message}`);
        }
      }
    }
    if (link == null && !agents.length) link = false;
    if (link == null) {
      const dirs = agents.map(agentSkillDir).join(', ');
      const ans = (await rl.question(`[companion] symlink each lesson into ${dirs}? [Y/n]: `))
        .trim().toLowerCase();
      link = !ans.startsWith('n');
    }
  } finally {
    rl.close();
  }
  return { agents, link };
}

export const linkTargets = (choice) => (choice && choice.link
  ? choice.agents.filter((e) => !AGENTS[e] || existsSync(AGENTS[e].home)).map(agentSkillDir)
  : []);
