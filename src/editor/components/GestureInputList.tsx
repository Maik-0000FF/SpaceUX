// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { DEFAULT_GESTURE_THRESHOLD, type GestureBinding, type InputBinding } from '@/shared/menu';

import { NavInputRow } from './NavInputRow';
import { Row } from './Row';
import styles from './Properties.module.scss';

/**
 * The per-item gesture-binding editor reused by the Behavior "Activate
 * with" and Exit "Exit with" controls (#130 R2/R3): a sub-heading, one
 * `NavInputRow` per bound input, an "+ Add input" button, and an amber
 * note when the binding shadows a global gesture (it still wins for this
 * item — see gestureShadows). The caller owns where the binding lives and
 * how each edit mutates the config; this component is presentation only,
 * so a future third binding (e.g. preview arrows, #111) can reuse it too.
 */
export function GestureInputList({
  heading,
  binding,
  offeredButtons,
  shadows,
  verb,
  onChangeInput,
  onRemoveInput,
  onAddInput,
}: {
  /** Sub-heading above the list, e.g. "Activate with" / "Exit with". */
  heading: string;
  binding: GestureBinding | undefined;
  /** How many device buttons the input dropdown should offer. */
  offeredButtons: number;
  /** Global gestures this binding shadows — surfaced as a "wins here" note. */
  shadows: string[];
  /** Noun for the warning copy, e.g. "activation" / "exit". */
  verb: string;
  onChangeInput: (index: number, next: InputBinding) => void;
  onRemoveInput: (index: number) => void;
  onAddInput: () => void;
}) {
  return (
    <>
      <div className={styles.subheading}>{heading}</div>
      {(binding?.inputs ?? []).map((input, i) => (
        <Row key={i} label={`Input ${i + 1}`}>
          <NavInputRow
            input={input}
            offeredButtons={offeredButtons}
            defaultThreshold={DEFAULT_GESTURE_THRESHOLD}
            onChange={(next) => onChangeInput(i, next)}
            onRemove={() => onRemoveInput(i)}
          />
        </Row>
      ))}
      <button type="button" className={styles.openButton} onClick={onAddInput}>
        + Add input
      </button>
      {shadows.length > 0 && (
        <span className={styles.warning}>
          ⚠ Shares an input with global {shadows.join(', ')} — this item’s {verb} wins here.
        </span>
      )}
    </>
  );
}
