// Rewrites a raw task into a precise English prompt through a headless Sonnet call.
// Used by the optimize-prefix.js hook (UserPromptSubmit) and by the /optimize skill.
//   node optimize-rewrite.js < task text   -> English prompt on stdout
//   or require('./optimize-rewrite.js').rewrite({ task, cwd, transcriptPath })
//
// Env: OPT_MODEL (default "sonnet"), OPT_TIMEOUT_MS (default 80000), CLAUDE_BIN (path to claude).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GUARD = 'OPT_REWRITE_GUARD';
const MODEL = process.env.OPT_MODEL || 'sonnet';
const TIMEOUT_MS = Number(process.env.OPT_TIMEOUT_MS) || 80000;
const NOTE_FILES = ['CLAUDE.md', 'AGENTS.md', 'STATUS.md'];
// "опт" typed on an English layout is "jgn"; accept it so a forgotten layout switch still works.
const PREFIX_RE = /^\s*(опт|opt|jgn)\s*:\s*/i;

const SYSTEM = `You are a prompt rewriter. You receive a raw task a user typed to a coding assistant (usually in Russian) plus a snapshot of the working context. Output ONE rewritten request in English, ready to be handed to the assistant as the real request.

Rules:
- Translate to English. Keep file paths, identifiers, code, URLs, numbers, quoted strings and proper names exactly as written (non-English names of folders/files stay as they are).
- Make it complete and concrete: use the context snapshot (current folder, recent conversation, project notes) to fill in file paths, project names, terms and obvious defaults that clearly belong to the task. Resolve references like "this", "that file", "as before" from the recent conversation.
- Phrase it as an action ("Do X"), not as a question. If the task has several parts, number them in order. If something may block (missing access, file not found, user decision needed), say what to do in that case.
- Do NOT change the intent and do NOT add work the user did not ask for. Do NOT invent facts that are not in the input or context; if something is ambiguous and the context does not settle it, keep it ambiguous and say "ask the user" for that point.
- No fake roles ("you are an expert"), no motivational tricks, no preamble.
- Do NOT perform the task and do NOT answer it. Do not use tools.
- Output language of the user's final deliverables: if the task implies text in the user's language for the user (messages, documents, UI copy), state that explicitly in the request (for example "Reply to the user in Russian").
- Output ONLY the rewritten request text. No headings, no quotes, no explanations.`;

// "опт: сделай X" -> { prefix: "опт", task: "сделай X" }; no prefix or empty task -> null.
function parsePrefix(prompt) {
  const m = String(prompt || '').match(PREFIX_RE);
  if (!m) return null;
  const task = String(prompt).slice(m[0].length).trim();
  return task ? { prefix: m[1], task } : null;
}

function readHead(file, maxLines) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(0, maxLines).join('\n');
  } catch { return ''; }
}

function recentConversation(transcriptPath, maxMsgs = 6, maxChars = 700) {
  if (!transcriptPath) return '';
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n'); } catch { return ''; }
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < maxMsgs; i--) {
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    const role = o.type === 'user' ? 'USER' : o.type === 'assistant' ? 'ASSISTANT' : null;
    if (!role || o.isSidechain) continue;
    const c = o.message && o.message.content;
    let text = '';
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) text = c.filter(b => b.type === 'text').map(b => b.text).join('\n');
    text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (!text) continue;
    out.unshift(`${role}: ${text.length > maxChars ? text.slice(0, maxChars) + ' …' : text}`);
  }
  return out.join('\n---\n');
}

// Heads of CLAUDE.md / AGENTS.md / STATUS.md in the working folder and up to 3 parents.
function projectNotes(cwd) {
  const parts = [];
  let dir = cwd;
  for (let i = 0; i < 4 && dir; i++) {
    for (const f of NOTE_FILES) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) parts.push(`## ${p}\n${readHead(p, f === 'STATUS.md' ? 40 : 30)}`);
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return parts.join('\n\n');
}

function onPath(names) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) for (const n of names) {
    const p = path.join(d, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Find the real claude binary. We spawn it WITHOUT a shell: a multi-line --system-prompt breaks
// through cmd.exe, so on Windows the npm shim (claude.cmd) is not usable and we go to claude.exe.
function claudeExe() {
  if (process.env.CLAUDE_BIN) {
    if (fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
    throw new Error('CLAUDE_BIN points to a missing file: ' + process.env.CLAUDE_BIN);
  }
  const home = os.homedir();
  const tried = [];
  const pick = p => { tried.push(p); return fs.existsSync(p) ? p : null; };
  if (process.platform === 'win32') {
    const npm = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm');
    const found =
      pick(path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')) ||
      pick(path.join(home, '.local', 'bin', 'claude.exe')) ||
      onPath(['claude.exe']);
    if (found) return found;
    // npm shim claude.cmd somewhere on PATH: the package sits next to it
    const shim = onPath(['claude.cmd']);
    if (shim) {
      const exe = path.join(path.dirname(shim), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (fs.existsSync(exe)) return exe;
    }
  } else {
    const found =
      onPath(['claude']) ||
      pick(path.join(home, '.local', 'bin', 'claude')) ||
      pick(path.join(home, '.claude', 'local', 'claude')) ||
      pick('/usr/local/bin/claude') ||
      pick('/opt/homebrew/bin/claude');
    if (found) return found;
  }
  throw new Error('claude not found. Install Claude Code or set CLAUDE_BIN to its full path.');
}

function rewrite({ task, cwd, transcriptPath }) {
  cwd = cwd || process.cwd();
  const notes = projectNotes(cwd);
  const convo = recentConversation(transcriptPath);
  const context = [
    `Working folder: ${cwd}`,
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    notes && `Project notes (heads of CLAUDE.md / AGENTS.md / STATUS.md):\n${notes}`,
    convo && `Recent conversation:\n${convo}`,
  ].filter(Boolean).join('\n\n');

  const input = `CONTEXT SNAPSHOT\n${context}\n\nRAW TASK\n${task}\n\nRewrite the raw task now. Output only the rewritten request.`;
  const args = ['-p', '--model', MODEL, '--tools', '', '--disable-slash-commands',
    '--no-session-persistence', '--system-prompt', SYSTEM, '--output-format', 'text'];
  const r = spawnSync(claudeExe(), args, {
    input, encoding: 'utf8', timeout: TIMEOUT_MS, cwd,
    env: { ...process.env, [GUARD]: '1' }, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  const text = (r.stdout || '').trim();
  if (r.status !== 0 || !text) {
    throw new Error(`rewriter failed (status ${r.status}, ${r.error ? r.error.message : (r.stderr || '').slice(0, 300)})`);
  }
  return text;
}

module.exports = { rewrite, parsePrefix, claudeExe, GUARD };

if (require.main === module) {
  if (process.env[GUARD]) process.exit(0);
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => (raw += c));
  process.stdin.on('end', () => {
    try { process.stdout.write(rewrite({ task: raw.trim() })); }
    catch (e) { process.stderr.write(String(e.message)); process.exit(1); }
  });
}
