// Run: node --test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parsePrefix } = require('../hooks/optimize-rewrite.js');
const { addHook, removeHook, install, uninstall, hookCommand } = require('../install.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opt-test-'));
const quiet = () => {};

test('parsePrefix: the three prefixes, any case, spaces around the colon', () => {
  assert.deepStrictEqual(parsePrefix('опт: сделай X'), { prefix: 'опт', task: 'сделай X' });
  assert.deepStrictEqual(parsePrefix('OPT:do X'), { prefix: 'OPT', task: 'do X' });
  assert.deepStrictEqual(parsePrefix('  jgn : сделай X'), { prefix: 'jgn', task: 'сделай X' });
});

test('parsePrefix: no prefix, empty task, prefix not at the start', () => {
  assert.strictEqual(parsePrefix('сделай опт: X'), null);
  assert.strictEqual(parsePrefix('опт:'), null);
  assert.strictEqual(parsePrefix('опт:   '), null);
  assert.strictEqual(parsePrefix('optimize this'), null);
  assert.strictEqual(parsePrefix(undefined), null);
});

test('addHook is idempotent and keeps other hooks', () => {
  const s = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo other' }] }], PreCompact: [] } };
  assert.strictEqual(addHook(s, 'node "/a/optimize-prefix.js"'), true);
  assert.strictEqual(addHook(s, 'node "/a/optimize-prefix.js"'), false);
  assert.strictEqual(s.hooks.UserPromptSubmit.length, 2);
  assert.ok('PreCompact' in s.hooks);
});

test('addHook refreshes the path when the config dir moved', () => {
  const s = {};
  addHook(s, 'node "/old/optimize-prefix.js"');
  assert.strictEqual(addHook(s, 'node "/new/optimize-prefix.js"'), true);
  assert.strictEqual(s.hooks.UserPromptSubmit.length, 1);
  assert.match(s.hooks.UserPromptSubmit[0].hooks[0].command, /\/new\//);
});

test('removeHook leaves foreign hooks and cleans empty containers', () => {
  const s = {};
  addHook(s, 'node "/a/optimize-prefix.js"');
  assert.strictEqual(removeHook(s), true);
  assert.deepStrictEqual(s, {});
  const t = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } };
  addHook(t, 'node "/a/optimize-prefix.js"');
  removeHook(t);
  assert.strictEqual(t.hooks.UserPromptSubmit[0].hooks[0].command, 'echo other');
  assert.strictEqual(removeHook(t), false);
});

test('install into an empty dir, then again, then uninstall', () => {
  const dir = tmp();
  install({ dir, log: quiet });
  for (const f of ['hooks/optimize-prefix.js', 'hooks/optimize-rewrite.js', 'skills/optimize/SKILL.md']) {
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  }
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.strictEqual(settings.hooks.UserPromptSubmit[0].hooks[0].command, hookCommand(dir));
  assert.strictEqual(install({ dir, log: quiet }).changed, false);
  uninstall({ dir, log: quiet });
  assert.ok(!fs.existsSync(path.join(dir, 'skills', 'optimize')));
  assert.ok(!fs.existsSync(path.join(dir, 'hooks', 'optimize-prefix.js')));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), {});
});

test('install keeps existing settings and makes a backup', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(ls)'] } }));
  install({ dir, log: quiet });
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.strictEqual(s.model, 'opus');
  assert.deepStrictEqual(s.permissions.allow, ['Bash(ls)']);
  assert.ok(fs.readdirSync(dir).some(n => n.startsWith('settings.json.bak-')));
});

test('install refuses broken settings.json and changes nothing', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
  assert.throws(() => install({ dir, log: quiet }), /not valid JSON/);
  assert.ok(!fs.existsSync(path.join(dir, 'hooks')));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{ not json');
});

test('dry-run touches nothing', () => {
  const dir = tmp();
  install({ dir, dryRun: true, log: quiet });
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});
