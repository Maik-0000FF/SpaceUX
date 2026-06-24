// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { desktopField, execBinary } from '../src/main/action-icon';

describe('execBinary', () => {
  it('takes the basename of the first shlex token, dropping args and field codes', () => {
    expect(execBinary('/usr/bin/dolphin %u')).toBe('dolphin');
    expect(execBinary('firefox --new-window https://example.com')).toBe('firefox');
    expect(execBinary('firefox')).toBe('firefox');
  });

  it('honours quotes so a spaced program path stays one token', () => {
    expect(execBinary('"/opt/My App/bin/app" %f')).toBe('app');
  });

  it('returns "" for an empty command', () => {
    expect(execBinary('')).toBe('');
  });
});

describe('desktopField', () => {
  const entry = '[Desktop Entry]\nName=Firefox\nIcon=firefox\nExec=firefox %u\n';

  it('reads a line-anchored key, trimmed', () => {
    expect(desktopField(entry, 'Icon')).toBe('firefox');
    expect(desktopField(entry, 'Exec')).toBe('firefox %u');
    expect(desktopField('Icon=  org.kde.dolphin  ', 'Icon')).toBe('org.kde.dolphin');
  });

  it('keeps the whole value when it contains "="', () => {
    expect(desktopField('Exec=env FOO=bar app', 'Exec')).toBe('env FOO=bar app');
  });

  it('does not match a key that is only a prefix of the line key', () => {
    // `Icon=` must not be satisfied by an `IconName=` line.
    expect(desktopField('IconName=x\nIcon=y', 'Icon')).toBe('y');
  });

  it('returns null when the key is absent', () => {
    expect(desktopField('[Desktop Entry]\nName=X', 'Icon')).toBeNull();
  });
});
