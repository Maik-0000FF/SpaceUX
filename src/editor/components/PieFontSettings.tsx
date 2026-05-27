// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';

import { clampFontFamily, SYSTEM_FONT_MONO, SYSTEM_FONT_UI } from '@/shared/pie-appearance';

import { usePieAppearance } from '../hooks/usePieAppearance';

import styles from './PieFontSettings.module.scss';

/**
 * Pie font override (#237 PR 2): pick the font used by the pie labels (live
 * overlay + the editor preview), independent of the editor UI's own font.
 * Three presets per font: Bundled (the shipped Inter / JetBrains Mono),
 * System (the OS default), or Custom (any CSS `font-family`). The stored value
 * is a plain family string: '' = bundled, the system stack = System, anything
 * else = Custom. Lives in the Settings tab because Custom wants a text field.
 */
type Preset = 'bundled' | 'system' | 'custom';

function presetOf(value: string, systemStack: string): Preset {
  if (value === '') return 'bundled';
  if (value === systemStack) return 'system';
  return 'custom';
}

function FontControl({
  label,
  bundledName,
  systemStack,
  value,
  onChange,
}: {
  label: string;
  bundledName: string;
  systemStack: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [mode, setMode] = useState<Preset>(() => presetOf(value, systemStack));
  const [customText, setCustomText] = useState(() =>
    presetOf(value, systemStack) === 'custom' ? value : '',
  );
  // The (clamped) value we last pushed out, so we can tell our own round-trip
  // (optimistic state + main's re-broadcast) apart from an external change.
  const emittedRef = useRef<string | null>(null);

  // Adopt the persisted value when it loads (getPieAppearance resolves after
  // mount) or changes out-of-band (a profile switch). Skip our own edits: an
  // explicit Custom choice must stick even when the typed text happens to be
  // empty or to equal a preset stack (e.g. `monospace`), which would otherwise
  // re-derive the mode and yank the field away mid-edit.
  useEffect(() => {
    if (value === emittedRef.current) return;
    const p = presetOf(value, systemStack);
    setMode(p);
    setCustomText(p === 'custom' ? value : '');
  }, [value, systemStack]);

  const emit = (next: string) => {
    emittedRef.current = clampFontFamily(next);
    onChange(next);
  };

  const selectPreset = (p: Preset) => {
    setMode(p);
    if (p === 'bundled') emit('');
    else if (p === 'system') emit(systemStack);
    else emit(customText);
  };

  const onText = (t: string) => {
    setCustomText(t);
    emit(t);
  };

  return (
    <div className={styles.control}>
      <span className={styles.label}>{label}</span>
      <select
        className={styles.select}
        value={mode}
        onChange={(e) => selectPreset(e.target.value as Preset)}
      >
        <option value="bundled">Bundled ({bundledName})</option>
        <option value="system">System default</option>
        <option value="custom">Custom…</option>
      </select>
      {mode === 'custom' && (
        <input
          className={styles.input}
          type="text"
          value={customText}
          placeholder="e.g. Cantarell, sans-serif"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onText(e.target.value)}
        />
      )}
    </div>
  );
}

export function PieFontSettings() {
  const { appearance: pie, setFontUi, setFontMono } = usePieAppearance();

  return (
    <div className={styles.grid}>
      <FontControl
        label="Label font"
        bundledName="Inter"
        systemStack={SYSTEM_FONT_UI}
        value={pie.fontUi}
        onChange={setFontUi}
      />
      <FontControl
        label="Monospace font"
        bundledName="JetBrains Mono"
        systemStack={SYSTEM_FONT_MONO}
        value={pie.fontMono}
        onChange={setFontMono}
      />
    </div>
  );
}
