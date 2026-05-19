// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * shlex-style tokenizer for shell-like command strings used by the
 * `exec` built-in (and the bundled example-launch plugin).
 *
 * Splits on whitespace but respects double-quoted (`"..."`) and
 * single-quoted (`'...'`) segments as single tokens. The quote
 * characters themselves are stripped from the output. Quoted
 * segments may contain whitespace; that's the whole reason this
 * helper exists — `xdg-open "Mein File.pdf"` must reach `spawn`
 * as the two-element argv `['xdg-open', 'Mein File.pdf']` rather
 * than the naive whitespace split's four-element corruption.
 *
 * Deliberately simple:
 * - No backslash escaping. Menu configs hold paths and the
 *   occasional flag, not shell metacharacters.
 * - Unbalanced quote (open with no matching close) consumes to
 *   end-of-string. Matches bash non-strict behaviour and is the
 *   least surprising form for menu.json typos.
 * - Empty quoted tokens (`""`, `''`) are preserved as empty-string
 *   tokens — `spawn` may refuse them but the tokenizer stays
 *   honest about what the config said.
 * - Adjacent quoted segments concatenate (`'a''b'` → `['ab']`,
 *   `a"b c"d` → `['ab cd']`), again matching bash.
 *
 * Re-evaluating "no backslash escapes" only becomes worth doing
 * when the Phase-2 Action-Editor UI ships and users start typing
 * commands that need them; today the cost of a real parser
 * outweighs the benefit for path-with-spaces use cases.
 */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  // Tracks whether we have started accumulating a token (so empty
  // quoted strings still emit, and trailing whitespace doesn't push
  // a phantom token).
  let inToken = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote !== null) {
      // Inside a quoted segment: only the matching closing quote
      // ends it; everything else (including whitespace) is content.
      if (c === quote) {
        quote = null;
      } else {
        current += c;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
      inToken = true;
    } else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
    } else {
      current += c;
      inToken = true;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}
