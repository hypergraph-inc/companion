import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitCommand, createArgs, subjectOf } from './args.mjs';
import { BOOLEAN_FLAGS } from './commands.mjs';

test('splitCommand takes the leading bare word as the command', () => {
  assert.deepEqual(splitCommand(['read', '--top', '5']), { name: 'read', args: ['--top', '5'] });
});

test('splitCommand leaves argv alone when it opens with a flag', () => {
  assert.deepEqual(splitCommand(['--json']), { name: null, args: ['--json'] });
  assert.deepEqual(splitCommand([]), { name: null, args: [] });
});

test('value reads the word after the flag', () => {
  const a = createArgs(['--render', 'out.png']);
  assert.equal(a.value('render'), 'out.png');
});

test('value falls back when the flag is absent or trailing', () => {
  assert.equal(createArgs([]).value('render', 'dflt'), 'dflt');
  assert.equal(createArgs(['--render']).value('render', 'dflt'), 'dflt');
});

// The reason isFlagWord exists: `--render --json` must not name a file "--json".
test('a following flag word is not swallowed as the value', () => {
  const a = createArgs(['--render', '--json']);
  assert.equal(a.value('render', null), null);
  assert.equal(a.has('json'), true);
});

// ...and the reason it tests for `--` and not `-`: coordinates go negative.
test('a negative number is a value, not a flag', () => {
  const a = createArgs(['--cx', '-500']);
  assert.equal(a.value('cx'), '-500');
  assert.equal(a.num('cx', 0), -500);
});

test('num parses finite numbers and falls back on the rest', () => {
  assert.equal(createArgs(['--top', '12']).num('top', 40), 12);
  assert.equal(createArgs(['--top', 'many']).num('top', 40), 40);
  assert.equal(createArgs([]).num('top', 40), 40);
  assert.equal(createArgs(['--cell', '0']).num('cell', 16), 0);
});

test('has is exact-match, not prefix', () => {
  const a = createArgs(['--json']);
  assert.equal(a.has('json'), true);
  assert.equal(a.has('jso'), false);
  assert.equal(createArgs(['--no-pair']).has('no-pair'), true);
});

test('subjectOf finds the first bare word', () => {
  assert.equal(subjectOf(['node:7'], BOOLEAN_FLAGS), 'node:7');
  assert.equal(subjectOf(['--json', 'node:7'], BOOLEAN_FLAGS), 'node:7');
});

// A word after a value-taking flag belongs to that flag, which is the whole
// reason subjectOf has to be told which flags are booleans.
test('subjectOf skips the argument of a value flag', () => {
  assert.equal(subjectOf(['--hops', '2', 'node:7'], BOOLEAN_FLAGS), 'node:7');
  assert.equal(subjectOf(['--hops', '2'], BOOLEAN_FLAGS), null);
});

test('subjectOf does not skip past a boolean flag', () => {
  assert.equal(subjectOf(['--json', 'rows.json'], BOOLEAN_FLAGS), 'rows.json');
  assert.equal(subjectOf(['--adjacency', 'node:7'], BOOLEAN_FLAGS), 'node:7');
});

test('subjectOf returns null when there is no bare word', () => {
  assert.equal(subjectOf(['--json', '--own'], BOOLEAN_FLAGS), null);
  assert.equal(subjectOf([], BOOLEAN_FLAGS), null);
});
