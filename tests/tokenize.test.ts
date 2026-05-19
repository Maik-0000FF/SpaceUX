// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { tokenize } from '../src/main/builtins/tokenize';
// Drift-guard: the example plugin duplicates tokenize because plugins
// can't import host internals. Importing both lets us run the same
// spec table against each and catch divergence at test time rather
// than via a user-facing parse mismatch.
//
// The plugin is plain JS without a .d.ts, so TS doesn't see the
// `tokenize` export. The runtime drift-guard tests below assert the
// function shape; `@ts-expect-error` will fire if a future .d.ts
// makes the suppression unnecessary.
// @ts-expect-error -- plain-JS plugin module, no type declarations
import { tokenize as pluginTokenize } from '../plugins/example-launch/index.js';

describe('tokenize', () => {
  it('returns empty array for empty or pure-whitespace input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
    expect(tokenize('\t\n\r ')).toEqual([]);
  });

  it('splits on whitespace runs and trims surrounding whitespace', () => {
    expect(tokenize('a b c')).toEqual(['a', 'b', 'c']);
    expect(tokenize('  a   b  ')).toEqual(['a', 'b']);
    expect(tokenize('a\tb\nc')).toEqual(['a', 'b', 'c']);
  });

  it('respects double-quoted strings as single tokens', () => {
    // The motivating use case: a file path with spaces.
    expect(tokenize('xdg-open "Mein File.pdf"')).toEqual(['xdg-open', 'Mein File.pdf']);
    expect(tokenize('"hello world"')).toEqual(['hello world']);
  });

  it('respects single-quoted strings as single tokens', () => {
    expect(tokenize("xdg-open 'Mein File.pdf'")).toEqual(['xdg-open', 'Mein File.pdf']);
    expect(tokenize("'hello world'")).toEqual(['hello world']);
  });

  it('lets each quote style nest the other literally', () => {
    expect(tokenize(`echo "it's fine"`)).toEqual(['echo', "it's fine"]);
    expect(tokenize(`echo 'say "hi"'`)).toEqual(['echo', 'say "hi"']);
  });

  it('concatenates adjacent quoted segments without whitespace', () => {
    // Matches bash: 'a''b' resolves to 'ab', a"b c"d to 'ab cd'.
    // Pinning the current behaviour so a future shell-style
    // reimplementation that changes it surfaces here.
    expect(tokenize("'a''b'")).toEqual(['ab']);
    expect(tokenize('a"b c"d')).toEqual(['ab cd']);
  });

  it('accepts unbalanced quotes by consuming to end of string', () => {
    // Matches bash non-strict behaviour. A trailing unbalanced quote
    // in a menu.json typo is the most likely cause, so an
    // empty-result-or-throw alternative would be unfriendly.
    expect(tokenize('cmd "unbalanced')).toEqual(['cmd', 'unbalanced']);
    expect(tokenize("cmd 'unbalanced with spaces")).toEqual(['cmd', 'unbalanced with spaces']);
  });

  it('preserves empty quoted tokens', () => {
    // Whether spawn() accepts an empty argv element is the caller's
    // problem; the tokenizer just reports what was in the config.
    expect(tokenize('cmd ""')).toEqual(['cmd', '']);
    expect(tokenize("cmd ''")).toEqual(['cmd', '']);
    expect(tokenize('"" cmd')).toEqual(['', 'cmd']);
  });

  it('treats backslash as a literal character (no escape)', () => {
    // We deliberately do not support backslash escapes today; if
    // a config wants a literal backslash in a path, the user types
    // it and it survives unchanged.
    expect(tokenize('path\\with\\backslashes')).toEqual(['path\\with\\backslashes']);
    expect(tokenize('"a \\ b"')).toEqual(['a \\ b']);
  });

  it('lets a bare opening quote produce an empty token', () => {
    // Edge of "unbalanced consumes to EOS": when the quote is the
    // entire input, consumption produces nothing, but the inToken
    // flag still flips so the empty token gets pushed.
    expect(tokenize('"')).toEqual(['']);
    expect(tokenize("'")).toEqual(['']);
  });

  it('preserves non-space whitespace inside quotes', () => {
    // Tab and newline inside quoted segments are content, not
    // separators — pins the "quotes swallow whitespace" rule for
    // every whitespace flavour the tokenizer recognises.
    expect(tokenize('"a\tb"')).toEqual(['a\tb']);
    expect(tokenize('"a\nb"')).toEqual(['a\nb']);
  });
});

describe('drift guard: built-in vs. example-plugin tokenize', () => {
  // The example plugin in plugins/example-launch/ duplicates the
  // tokenize function because plugins can't import host internals.
  // The two implementations must agree on every input; this
  // spec table runs the same cases through both and asserts
  // identical output. A divergence here means one side picked up
  // an escape rule the other didn't.
  const cases: { name: string; input: string }[] = [
    { name: 'empty', input: '' },
    { name: 'whitespace only', input: '   \t\n  ' },
    { name: 'simple split', input: 'a b c' },
    { name: 'quoted path with spaces', input: 'xdg-open "Mein File.pdf"' },
    { name: 'single-quoted', input: "echo 'hello world'" },
    { name: 'concatenated quotes', input: "'a''b'" },
    { name: 'mid-token quote', input: 'a"b c"d' },
    { name: 'unbalanced double quote', input: 'cmd "unbalanced' },
    { name: 'unbalanced single quote', input: "cmd 'unbalanced" },
    { name: 'empty quoted token', input: 'cmd ""' },
    { name: 'leading empty token', input: '"" cmd' },
    { name: 'bare opening quote', input: '"' },
    { name: 'literal backslash', input: 'a\\b\\c' },
    { name: 'tab inside quotes', input: '"a\tb"' },
  ];
  for (const c of cases) {
    it(`agrees on ${c.name}`, () => {
      expect(pluginTokenize(c.input)).toEqual(tokenize(c.input));
    });
  }
});
