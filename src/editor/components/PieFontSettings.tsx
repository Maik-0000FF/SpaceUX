// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import { SYSTEM_FONT_MONO, SYSTEM_FONT_UI } from '@/shared/pie-appearance';

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

  // Adopt the persisted value once it loads (getPieAppearance resolves after
  // mount) or when it changes out-of-band (a profile switch). Guard the one
  // case our own edits create: an empty Custom field stores '' but shouldn't
  // kick the control back to Bundled mid-edit.
  useEffect(() => {
    const p = presetOf(value, systemStack);
    setMode((cur) => (cur === 'custom' && value === '' ? 'custom' : p));
    if (p === 'custom') setCustomText(value);
  }, [value, systemStack]);

  const selectPreset = (p: Preset) => {
    setMode(p);
    if (p === 'bundled') onChange('');
    else if (p === 'system') onChange(systemStack);
    else onChange(customText);
  };

  const onText = (t: string) => {
    setCustomText(t);
    onChange(t);
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
