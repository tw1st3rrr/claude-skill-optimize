#!/usr/bin/env node
// Installs /optimize and the "опт:" prefix hook into Claude Code.
//   node install.js                 install (or update)
//   node install.js --uninstall     remove skill, hooks and the settings entry
//   node install.js --dry-run       show what would change, touch nothing
//   node install.js --claude-dir D  use D instead of ~/.claude (also: CLAUDE_CONFIG_DIR)
// Your settings.json is backed up before every change (settings.json.bak-<timestamp>).
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const HOOK_FILES = ['optimize-prefix.js', 'optimize-rewrite.js'];
const MARKER = 'optimize-prefix.js';

function claudeDir(argDir) {
  return path.resolve(argDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
}

function hookCommand(dir) {
  return `node "${path.join(dir, 'hooks', 'optimize-prefix.js')}"`;
}

const isOurs = h => h && typeof h.command === 'string' && h.command.includes(MARKER);

// Adds the UserPromptSubmit hook. Returns true if the settings object changed.
function addHook(settings, command) {
  settings.hooks = settings.hooks || {};
  const list = (settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || []);
  for (const entry of list) {
    for (const h of entry.hooks || []) {
      if (isOurs(h)) {
        if (h.command === command) return false;
        h.command = command; // moved config dir: refresh the path
        return true;
      }
    }
  }
  list.push({ hooks: [{ type: 'command', command, timeout: 120 }] });
  return true;
}

// Removes our hook and cleans up empty containers. Returns true if something was removed.
function removeHook(settings) {
  const list = settings.hooks && settings.hooks.UserPromptSubmit;
  if (!Array.isArray(list)) return false;
  let changed = false;
  for (const entry of list) {
    const before = (entry.hooks || []).length;
    entry.hooks = (entry.hooks || []).filter(h => !isOurs(h));
    if (entry.hooks.length !== before) changed = true;
  }
  settings.hooks.UserPromptSubmit = list.filter(e => (e.hooks || []).length > 0);
  if (!settings.hooks.UserPromptSubmit.length) delete settings.hooks.UserPromptSubmit;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return changed;
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}). Fix it or remove it, then run again. Nothing was changed.`);
  }
}

function writeSettings(file, settings, log) {
  if (fs.existsSync(file)) {
    const bak = `${file}.bak-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
    fs.copyFileSync(file, bak);
    log(`backup: ${bak}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

function install({ dir, dryRun = false, log = console.log }) {
  const file = path.join(dir, 'settings.json');
  const settings = readSettings(file);
  const changed = addHook(settings, hookCommand(dir));
  log(`${dryRun ? '[dry-run] ' : ''}claude dir: ${dir}`);
  for (const f of HOOK_FILES) log(`${dryRun ? '[dry-run] would copy' : 'copy'} hooks/${f} -> ${path.join(dir, 'hooks', f)}`);
  log(`${dryRun ? '[dry-run] would copy' : 'copy'} skill/optimize -> ${path.join(dir, 'skills', 'optimize')}`);
  log(`${dryRun ? '[dry-run] ' : ''}settings.json: ${changed ? 'hook UserPromptSubmit added' : 'hook already present, no change'}`);
  if (dryRun) return { changed };
  fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  for (const f of HOOK_FILES) fs.copyFileSync(path.join(ROOT, 'hooks', f), path.join(dir, 'hooks', f));
  copyDir(path.join(ROOT, 'skill', 'optimize'), path.join(dir, 'skills', 'optimize'));
  if (changed) writeSettings(file, settings, log);
  return { changed };
}

function uninstall({ dir, dryRun = false, log = console.log }) {
  const file = path.join(dir, 'settings.json');
  const settings = readSettings(file);
  const changed = removeHook(settings);
  log(`${dryRun ? '[dry-run] ' : ''}claude dir: ${dir}`);
  log(`${dryRun ? '[dry-run] ' : ''}settings.json: ${changed ? 'hook removed' : 'hook not found, no change'}`);
  if (dryRun) return { changed };
  if (changed) writeSettings(file, settings, log);
  for (const f of HOOK_FILES) fs.rmSync(path.join(dir, 'hooks', f), { force: true });
  fs.rmSync(path.join(dir, 'skills', 'optimize'), { recursive: true, force: true });
  log('removed hooks/optimize-*.js and skills/optimize');
  return { changed };
}

module.exports = { addHook, removeHook, hookCommand, install, uninstall, readSettings };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = n => argv.includes(`--${n}`);
  const i = argv.indexOf('--claude-dir');
  const dir = claudeDir(i >= 0 ? argv[i + 1] : undefined);
  if (Number(process.versions.node.split('.')[0]) < 18) {
    console.error('Node.js 18 or newer is required.');
    process.exit(1);
  }
  try {
    if (flag('uninstall')) uninstall({ dir, dryRun: flag('dry-run') });
    else {
      install({ dir, dryRun: flag('dry-run') });
      if (!flag('dry-run')) {
        let found = 'not checked';
        try { found = require('./hooks/optimize-rewrite.js').claudeExe(); } catch (e) { found = `WARNING: ${e.message}`; }
        console.log(`claude binary: ${found}`);
        console.log('\nDone. Restart Claude Code, then type:  опт: your task   (or /optimize your task)');
      }
    }
  } catch (e) {
    console.error('Error: ' + e.message);
    process.exit(1);
  }
}
