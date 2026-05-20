// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from 'react';

import { useMenuSettings } from '../state/menu-settings';

import styles from './Properties.module.scss';

/**
 * JSON editor for a leaf sector's action config. Keeps local text state
 * so a half-typed (invalid) value stays in the field without being
 * pushed into the store; only a parse to a plain object commits. Clearing
 * the field removes the config. Remounted per selection (keyed on the
 * path + remoteRev) so switching sectors / adopting a remote change
 * reloads the field cleanly.
 */
export function ConfigEditor({
  path,
  value,
}: {
  path: readonly number[];
  value: Record<string, unknown> | undefined;
}) {
  const updateSectorAt = useMenuSettings((s) => s.updateSectorAt);
  const [text, setText] = useState(value !== undefined ? JSON.stringify(value, null, 2) : '');
  const [error, setError] = useState<string | null>(null);

  const onChange = (next: string): void => {
    setText(next);
    if (next.trim() === '') {
      setError(null);
      updateSectorAt(path, (s) => {
        if (s.binding) delete s.binding.config;
      });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(next);
    } catch {
      setError('invalid JSON');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setError('config must be a JSON object');
      return;
    }
    setError(null);
    updateSectorAt(path, (s) => {
      if (s.binding) s.binding.config = parsed as Record<string, unknown>;
    });
  };

  return (
    <div className={styles.configBlock}>
      <span className={styles.label}>Config</span>
      <textarea
        className={styles.textarea}
        value={text}
        spellCheck={false}
        rows={5}
        onChange={(e) => onChange(e.target.value)}
      />
      {error !== null && <span className={styles.fieldError}>{error}</span>}
    </div>
  );
}
