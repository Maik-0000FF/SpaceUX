// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from 'react';

import type { ActionConfigSchema } from '@/shared/plugin-types';

import { CONFIG_FIELD_INTRO, CONFIG_FIELD_NONE, actionConfigExample } from '../tooltips';
import { Tooltip } from './Tooltip';
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
 *
 * `schema` (the picked action's manifest config shape) drives the label's
 * hover tooltip: it shows a concrete JSON example so the user sees the shape
 * the field expects without emptying it first (#279).
 */
export function ConfigEditor({
  value,
  schema,
  onChange,
}: {
  value: Record<string, unknown> | undefined;
  schema?: ActionConfigSchema;
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

  const example = actionConfigExample(schema);
  const hint =
    example === null ? (
      CONFIG_FIELD_NONE
    ) : (
      <>
        {CONFIG_FIELD_INTRO}
        <pre className={styles.tooltipCode}>{example}</pre>
      </>
    );

  return (
    <div className={styles.configBlock}>
      <Tooltip content={hint}>
        <span className={styles.label}>Config</span>
      </Tooltip>
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
