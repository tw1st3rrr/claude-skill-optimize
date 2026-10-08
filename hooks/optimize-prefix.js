// UserPromptSubmit hook: a message that starts with "опт:" (or "opt:" / "jgn:") is rewritten by a
// headless Sonnet into a precise English prompt (optimize-rewrite.js). A hook cannot replace the
// user's message, so the result goes in as additionalContext marked "this is the real request".
// The original text stays visible to the model too.
const { rewrite, parsePrefix, GUARD } = require('./optimize-rewrite.js');

if (process.env[GUARD]) process.exit(0); // the nested `claude -p` must not rewrite recursively

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (raw += c));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const parsed = parsePrefix(input.prompt);
  if (!parsed) return;
  const { prefix, task } = parsed;

  let context;
  try {
    const en = rewrite({ task, cwd: input.cwd, transcriptPath: input.transcript_path });
    context =
      `The user's message started with the "${prefix}:" prefix, so it was pre-processed by an English rewriter (Sonnet). ` +
      `Treat the REWRITTEN REQUEST below as the user's actual request and execute it. ` +
      `The original wording stays in the message above only as a reference for intent: if the two ever differ, ` +
      `the original wins on intent. Begin your reply with one line "Оптимизированный запрос выполняется" ` +
      `and do not repeat or comment on the rewrite. Reply to the user in the language of the original message unless the request says otherwise.\n\n` +
      `REWRITTEN REQUEST:\n${en}`;
  } catch (e) {
    context =
      `The "${prefix}:" prefix was used but the automatic English rewriter failed (${e.message}). ` +
      `Just execute the user's original request as written, and mention in one line that the rewrite step was skipped.`;
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
  }));
});
