import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = fileURLToPath(new URL('./companion-cli.mjs', import.meta.url));

// Only the paths that exit before any network work are driven here: help,
// version, and the unknown-command refusal. Everything past those needs a
// server, and is covered against a stub in session/pairing.test.mjs.
const run = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [CLI, ...args], { timeout: 20_000 },
    (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
});

const runWithKeys = (keyDir, ...args) => new Promise((resolve) => {
  execFile(process.execPath, [CLI, ...args],
    { timeout: 20_000, env: { ...process.env, TESS_COMPANION_KEYS: keyDir } },
    (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
});

test('--version prints the package version and nothing else', async () => {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const { code, stdout } = await run('--version');
  assert.equal(code, 0);
  assert.equal(stdout.trim(), pkg.version);
});

test('--help lists the commands on stdout and exits clean', async () => {
  const { code, stdout } = await run('--help');
  assert.equal(code, 0);
  assert.match(stdout, /usage: hypergraph <command>/);
  for (const c of ['welcome', 'read', 'branch', 'learn', 'emit', 'probe', 'render']) {
    assert.match(stdout, new RegExp(`\\b${c}\\b`));
  }
});

test('a command --help prints that command, not the summary', async () => {
  const { code, stdout } = await run('probe', '--help');
  assert.equal(code, 0);
  assert.match(stdout, /usage: hypergraph probe <id>/);
  assert.match(stdout, /--hops/);
});

// An unknown command must not be treated as a bare subject and dialled out on.
test('an unknown command is refused with the usage, and exit code 2', async () => {
  const { code, stderr } = await run('destroy');
  assert.equal(code, 2);
  assert.match(stderr, /unknown command "destroy"/);
  assert.match(stderr, /usage: hypergraph <command>/);
});

test('--help wins over an unknown flag rather than dialling out', async () => {
  const { code } = await run('read', '--help', '--origin', 'http://127.0.0.1:1');
  assert.equal(code, 0);
});

test('set-origin saves a default origin and reset clears it, without dialling out', async () => {
  const keyDir = mkdtempSync(join(tmpdir(), 'hg-companion-test-'));
  try {
    const set = await runWithKeys(keyDir, 'set-origin', 'http://127.0.0.1:4500/');
    assert.equal(set.code, 0);
    assert.equal(readFileSync(join(keyDir, 'default-origin'), 'utf8').trim(), 'http://127.0.0.1:4500');

    const missing = await runWithKeys(keyDir, 'set-origin');
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /set-origin needs a url/);

    const reset = await runWithKeys(keyDir, 'set-origin', '--reset');
    assert.equal(reset.code, 0);
    assert.throws(() => readFileSync(join(keyDir, 'default-origin'), 'utf8'));
  } finally {
    rmSync(keyDir, { recursive: true, force: true });
  }
});
