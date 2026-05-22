// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from 'react';

import styles from './Properties.module.scss';

/**
 * JSON editor for an action's per-instance config. Keeps local text
 * state so a half-typed (invalid) value stays in the field without
 * being pushed out; only a parse to a plain object commits. Clearing
 * the field reports `undefined` so the caller can remove the config.
 *
 * Caller-agnostic: it owns no store reference, just `value` in and an
 * `onChange` out, so it serves both a leaf node's action and the
 * center field's action. Remount it (via `key`) on a selection change
 * or external adoption so the field reloads cleanly rather than
 * mid-typing.
 */
export function ConfigEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (config: Record<string, unknown> | undefined) => void;
}) {
  const [text, setText] = useState(value !== undefined ? JSON.stringify(value, null, 2) : '');
  const [error, setError] = useState<string | null>(null);

  const handleChange = (next: string): void => {
    setText(next);
    if (next.trim() === '') {
      setError(null);
      onChange(undefined);
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
    onChange(parsed as Record<string, unknown>);
  };

  return (
    <div className={styles.configBlock}>
      <span className={styles.label}>Config</span>
      <textarea
        className={styles.textarea}
        value={text}
        spellCheck={false}
        rows={5}
        onChange={(e) => handleChange(e.target.value)}
      />
      {error !== null && <span className={styles.fieldError}>{error}</span>}
    </div>
  );
}
