---
name: optimize
description: >
  Rewrites a raw task into a precise English prompt through a headless Sonnet
  (using CLAUDE.md, AGENTS.md, STATUS.md and the recent conversation), then
  executes it as the real request. Manual only: /optimize. Shortcut without the
  slash command: start a normal message with "опт:" (or "opt:"), the
  optimize-prefix.js hook does the same automatically.
argument-hint: "[task text]"
disable-model-invocation: true
---

# /optimize

The user wants the task translated to English and strengthened with context before it runs. The rewrite is done not by you but by a separate Sonnet call, so the main model gets a clean, complete request.

## Steps

1. Source text: `$ARGUMENTS`. If empty, ask what to optimize.
2. Run the rewriter, passing the text through stdin (not as an argument: quotes and non-Latin text break in arguments):

   ```bash
   node "$HOME/.claude/hooks/optimize-rewrite.js" <<'EOF'
   <source task text>
   EOF
   ```

   Takes 15-30 seconds. The working folder is taken from the current one. The rewriter does not see the recent conversation here (only CLAUDE.md, AGENTS.md and STATUS.md), so if the task refers to "this" or "as before", put the needed detail into the source text yourself before running it.
3. Show the result as one block:

   ### Optimized request
   > <English text>

4. Immediately execute that request as the real one. The original wording is only a reference: if the meaning differs, the original is right. Do not repeat or comment on the rewrite. Answer the user in the language they wrote in.
5. If the rewriter failed (non-zero exit code or empty output), say so in one line and execute the original task as it is.

## Rules

- Do not execute the task before showing the rewrite.
- Do not edit the rewrite yourself: if it is clearly wrong (invented a file, added extra work), execute the original wording and name what was wrong in the rewrite.
- Files: `~/.claude/hooks/optimize-rewrite.js` (the rewriter, system prompt inside), `~/.claude/hooks/optimize-prefix.js` (the `опт:` / `opt:` / `jgn:` prefix hook).
