import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COMMANDS, BOOLEAN_FLAGS, usage, commandHelp } from './commands.mjs';

const allFlags = Object.values(COMMANDS).flatMap((c) => c.flags);

// The invariant the spec() helper exists to hold: a flag documented with an
// <arg> must never also be in the boolean set, or subjectOf would read that
// flag's argument as the command's subject.
test('no flag is both documented with an argument and treated as a switch', () => {
  for (const f of allFlags) {
    if (f.arg) assert.equal(BOOLEAN_FLAGS.has(f.name), false, `--${f.name} takes ${f.arg} but is boolean`);
  }
});

test('every argument-free flag is in the boolean set', () => {
  for (const f of allFlags) {
    if (!f.arg) assert.equal(BOOLEAN_FLAGS.has(f.name), true, `--${f.name} takes no arg but is not boolean`);
  }
});

// One name, one signature -- the same spec is spread into several commands, and
// a flag that took a value in one place and not another would make subjectOf
// depend on which command was typed.
test('a flag name has the same signature everywhere it appears', () => {
  const sig = new Map();
  for (const f of allFlags) {
    if (sig.has(f.name)) assert.equal(sig.get(f.name), f.arg, `--${f.name} has two signatures`);
    else sig.set(f.name, f.arg);
  }
});

test('the boolean set carries the flags the entry point checks before parsing', () => {
  for (const n of ['help', 'h', 'version', 'V']) assert.equal(BOOLEAN_FLAGS.has(n), true);
});

test('every command has a summary and flags', () => {
  for (const [name, c] of Object.entries(COMMANDS)) {
    assert.equal(typeof c.summary, 'string', `${name} has no summary`);
    assert.ok(c.summary.length, `${name} has an empty summary`);
    assert.ok(Array.isArray(c.flags) && c.flags.length, `${name} has no flags`);
  }
});

// A command whose subject is named in the registry must be reachable as a bare
// word, so its subject flag has to take a value.
test('a command that names a subject also offers it as a flag', () => {
  const subjectFlag = { branch: 'scene', emit: 'emit', probe: 'probe', render: 'render' };
  for (const [cmd, flag] of Object.entries(subjectFlag)) {
    assert.ok(COMMANDS[cmd], `${cmd} is gone from the registry`);
    const f = COMMANDS[cmd].flags.find((x) => x.name === flag);
    assert.ok(f, `${cmd} lost its --${flag}`);
    assert.ok(f.arg, `--${flag} must take a value`);
  }
});

test('usage lists every command', () => {
  const u = usage();
  for (const name of Object.keys(COMMANDS)) assert.match(u, new RegExp(`\\b${name}\\b`));
});

test('commandHelp prints the subject and the global flags', () => {
  const h = commandHelp('probe');
  assert.match(h, /usage: hypergraph probe <id>/);
  assert.match(h, /--hops/);
  assert.match(h, /common to every command:/);
  assert.match(h, /--json/);
});

test('commandHelp lists a subjectless command without an angle-bracket subject', () => {
  assert.match(commandHelp('read'), /^usage: hypergraph read \[options\]$/m);
});

// The table() helper dedupes, because the flag groups are spread into several
// commands and read pulls in nearly all of them.
test('commandHelp prints each flag once', () => {
  for (const name of Object.keys(COMMANDS)) {
    const lines = commandHelp(name).split('\n').filter((l) => l.startsWith('  --'));
    const names = lines.map((l) => l.trim().split(/\s+/)[0]);
    assert.equal(new Set(names).size, names.length, `${name} help repeats a flag`);
  }
});
