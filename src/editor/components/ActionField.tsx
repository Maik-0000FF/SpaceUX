// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from 'react';

import type { EditorAction } from '@/shared/ipc';
import type { ActionRef } from '@/shared/menu';

import { ACTION_FIELD_HINT } from '../tooltips';
import { Row } from './Row';
import styles from './Properties.module.scss';

/** Sentinel select value for the raw-text escape hatch. */
const CUSTOM = '__custom__';

/**
 * The Action picker for a leaf action (and, later, the centre field): a
 * dropdown of the known actions (builtins + loaded plugins, by label)
 * plus "No action" (label-only, no action) and a "Custom…" escape that
 * reveals the raw `pluginId/actionName` field — so arbitrary or
 * not-currently-loaded actions still work.
 *
 * Stateless about *which* node it edits: the parent keys this on the
 * selection so the local "custom mode" resets when you switch nodes.
 */
export function ActionField({
  action,
  actions,
  onPick,
  onCustomChange,
  onClear,
}: {
  action: ActionRef | undefined;
  actions: EditorAction[];
  /** A known action id was chosen. */
  onPick: (id: string) => void;
  /** The raw-text action id changed (Custom mode). */
  onCustomChange: (text: string) => void;
  /** "No action" chosen → drop the action (label-only leaf). */
  onClear: () => void;
}) {
  const current = action?.id ?? '';
  const isKnown = actions.some((a) => a.id === current);
  // Sticky once chosen, so picking Custom with an empty/known value keeps
  // the raw field open. A non-empty value that isn't a known action is
  // inherently custom (covers a hand-written config or a plugin that
  // didn't load).
  const [customMode, setCustomMode] = useState(false);
  const showCustom = customMode || (current !== '' && !isKnown);
  const selectValue = showCustom ? CUSTOM : isKnown ? current : '';
  // Surface the picked action's description on the label so the "what does this
  // do" hint is reachable without opening the dropdown (the per-option titles
  // only show while the list is open). Falls back to a generic line (#279).
  const pickedDescription = actions.find((a) => a.id === current)?.description;

  return (
    <>
      <Row label="Action" hint={pickedDescription ?? ACTION_FIELD_HINT}>
        <select
          className={styles.select}
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === CUSTOM) {
              setCustomMode(true);
            } else if (v === '') {
              setCustomMode(false);
              onClear();
            } else {
              setCustomMode(false);
              onPick(v);
            }
          }}
        >
          <option value="">No action (label only)</option>
          {actions.map((a) => (
            <option key={a.id} value={a.id} title={a.description}>
              {a.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </Row>
      {showCustom && (
        <Row label="Action ID">
          <input
            className={styles.input}
            value={current}
            placeholder="pluginId/actionName"
            onChange={(e) => onCustomChange(e.target.value)}
          />
        </Row>
      )}
    </>
  );
}
