// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CORE_METHODS, CORE_SIGNALS } from '../src/shared/core-contract';

// The D-Bus interface XML is hand-maintained alongside the typed contract; this
// locks them together so the wire form and core-contract.ts can't drift. Source
// of truth for the members is the two arrays; the XML must list exactly those,
// with the uniform JSON-RPC signatures the generic dispatcher relies on.
const xml = readFileSync(
  fileURLToPath(new URL('../src/shared/dbus/org.spaceux.Core1.xml', import.meta.url)),
  'utf8',
);

interface XmlArg {
  type: string;
  direction: string | null;
}

/** Each `<method>` / `<signal>` block: its name and the args inside it (handles
 *  both `<tag name="X">...</tag>` and the self-closing `<tag name="X"/>`). */
function blocks(tag: 'method' | 'signal'): { name: string; args: XmlArg[] }[] {
  const re = new RegExp(`<${tag}\\s+name="([^"]+)"\\s*(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  const out: { name: string; args: XmlArg[] }[] = [];
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    const body = m[2] ?? '';
    const args: XmlArg[] = [];
    const argRe = /<arg\b([^/>]*)\/?>/g;
    for (let a = argRe.exec(body); a !== null; a = argRe.exec(body)) {
      const attrs = a[1]!;
      args.push({
        type: /\btype="([^"]+)"/.exec(attrs)?.[1] ?? '',
        direction: /\bdirection="([^"]+)"/.exec(attrs)?.[1] ?? null,
      });
    }
    out.push({ name: m[1]!, args });
  }
  return out;
}

describe('org.spaceux.Core1.xml matches the typed contract', () => {
  it('declares exactly the CORE_METHODS members', () => {
    expect(
      blocks('method')
        .map((b) => b.name)
        .sort(),
    ).toEqual([...CORE_METHODS].sort());
  });

  it('declares exactly the CORE_SIGNALS members', () => {
    expect(
      blocks('signal')
        .map((b) => b.name)
        .sort(),
    ).toEqual([...CORE_SIGNALS].sort());
  });

  it('gives every method the uniform (in s args, out s result) wire', () => {
    for (const { name, args } of blocks('method')) {
      expect(args, name).toEqual([
        { type: 's', direction: 'in' },
        { type: 's', direction: 'out' },
      ]);
    }
  });

  it('gives every signal a single JSON-string payload, or none', () => {
    for (const { name, args } of blocks('signal')) {
      expect(args.length, name).toBeLessThanOrEqual(1);
      for (const arg of args) expect(arg, name).toEqual({ type: 's', direction: null });
    }
  });
});
