// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { tokenize } from '../src/main/builtins/tokenize';

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
