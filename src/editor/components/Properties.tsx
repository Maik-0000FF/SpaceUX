// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  BUILTIN_ACTION,
  DEFAULT_ACTIVATION_THRESHOLD,
  builtinAction,
  resolveNavigation,
} from '@/shared/menu';

import { useAvailableActions } from '../hooks/useAvailableActions';
import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { activationCollisions } from '../state/activation-collision';
import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { moveTargets, pathOfSectorId } from '../state/move-targets';
import { FALLBACK_BUTTON_COUNT } from '../state/nav-input';
import { ringSectors, sectorAtPath, selectedPath } from '../state/selectors';
import { nextSectorId } from '../state/sector-keys';

import { ActionField } from './ActionField';
import { CenterFieldSettings } from './CenterFieldSettings';
import { ConfigEditor } from './ConfigEditor';
import { MenuSettings } from './MenuSettings';
import { NavInputRow } from './NavInputRow';
import { Row } from './Row';
import styles from './Properties.module.scss';

/**
 * Quote a picked file path so the exec tokenizer keeps it as one token
 * (it honours "…"/'…' but has no backslash escapes). Only quotes when
 * the path has whitespace, and picks a quote char the path doesn't
 * contain so a space (or a quote) in the path doesn't split the command.
 */
function quoteCommandPath(p: string): string {
  if (!/\s/.test(p)) return p;
  if (!p.includes('"')) return `"${p}"`;
  if (!p.includes("'")) return `'${p}'`;
  return `"${p}"`;
}

/**
 * Right sidebar: editable properties of the selected sector (at any
 * depth — the selection is the current ring's index, combined with the
 * view path). A sector is a leaf (action binding) or a branch (submenu);
 * the Type dropdown converts between them. A branch offers "Open
 * submenu" to drill in; Delete removes it from the current ring.
 */
export function Properties() {
  const config = useMenuSettings((s) => s.config);
  const updateSectorAt = useMenuSettings((s) => s.updateSectorAt);
  const deleteSector = useMenuSettings((s) => s.deleteSector);
  const moveSectorBetween = useMenuSettings((s) => s.moveSectorBetween);
  const remoteRev = useMenuSettings((s) => s.remoteRev);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const centerSelected = useAppState((s) => s.centerSelected);
  const selectSector = useAppState((s) => s.selectSector);
  const selectPath = useAppState((s) => s.selectPath);
  const clearSelection = useAppState((s) => s.clearSelection);
  const drillInto = useAppState((s) => s.drillInto);

  // Connected device's button count (0 = none/unknown) → constrains the
  // activation input dropdown's button options (#66).
  const { buttons: buttonCount } = useDeviceInfo();
  const offeredButtons = buttonCount > 0 ? buttonCount : FALLBACK_BUTTON_COUNT;
  const availableActions = useAvailableActions();

  const path = selectedPath(viewPath, selectedIndex);
  const sector = config && path ? sectorAtPath(config, path) : null;
  const isExec = sector?.binding?.action === builtinAction(BUILTIN_ACTION.EXEC);
  // Global gestures this sector's activation shadows — it wins for this
  // item, so flag the override rather than block it. Empty without one.
  const activationShadows =
    config && sector?.activation
      ? activationCollisions(sector.activation, resolveNavigation(config))
      : [];

  // Rings the selected sector can be moved into (excludes its own ring, its
  // subtree, and too-deep targets). Picked from the "Move to…" dropdown.
  const targets = config && path ? moveTargets(config, path) : [];
  const handleMove = (toRingPath: number[]): void => {
    if (!path || !config) return;
    // Capture the stable id first: index paths (incl. toRingPath) can shift
    // when the source splice reindexes a shared ancestor ring, so re-select
    // the moved sector by id rather than by its pre-move target path.
    const movedId = sectorAtPath(config, path)?.id;
    moveSectorBetween(path, toRingPath);
    const current = useMenuSettings.getState().config;
    const newPath = current && movedId !== undefined ? pathOfSectorId(current, movedId) : null;
    if (newPath) selectPath(newPath);
  };

  // Pick a file for an exec command and write it into the action config.
  const handleBrowse = (): void => {
    if (!path) return;
    void window.editor.pickFile().then((file) => {
      if (!file) return;
      updateSectorAt(path, (s) => {
        if (s.binding) {
          s.binding.config = { ...(s.binding.config ?? {}), command: quoteCommandPath(file) };
        }
      });
    });
  };

  const canDelete =
    selectedIndex !== null && (config ? ringSectors(config, viewPath).length : 0) > 1;
  const handleDelete = (): void => {
    if (selectedIndex === null) return;
    deleteSector(viewPath, selectedIndex);
    const current = useMenuSettings.getState().config;
    const remaining = current ? ringSectors(current, viewPath).length : 0;
    // Keep the editing flow: select a neighbour rather than nothing.
    if (remaining > 0) selectSector(Math.min(selectedIndex, remaining - 1));
    else clearSelection();
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.heading}>Properties</div>
      {config && centerSelected ? (
        // Centre field clicked in the preview → focus just its editor.
        <div className={styles.fields}>
          <CenterFieldSettings />
        </div>
      ) : !sector || !path ? (
        <div className={styles.fields}>
          <p className={styles.empty}>Select a sector to edit it.</p>
          {config && <MenuSettings />}
        </div>
      ) : (
        <div className={styles.fields}>
          {/* The item is edited along the flow you run with the puck:
              how you reach it (Entry), what it does (Behavior), how you
              leave it (Exit). Entry/Exit only describe the global model
              for now — per-item gesture overrides land with #105. */}
          <section className={styles.flowSection}>
            <div className={styles.flowHeading}>↳ Entry</div>
            <p className={styles.sectionNote}>
              Reached with the global navigation gestures — aim the puck at this sector, or cycle to
              step onto it. A per-item entry gesture lands later.
            </p>
          </section>

          <section className={styles.flowSection}>
            <div className={styles.flowHeading}>Behavior</div>
            <Row label="Label">
              <input
                className={styles.input}
                value={sector.label}
                onChange={(e) =>
                  updateSectorAt(path, (s) => {
                    s.label = e.target.value;
                  })
                }
              />
            </Row>
            <Row label="Type">
              <select
                className={styles.select}
                value={sector.children !== undefined ? 'submenu' : 'action'}
                title={
                  sector.children !== undefined
                    ? 'Switching to Action discards this submenu and its items'
                    : undefined
                }
                onChange={(e) =>
                  updateSectorAt(path, (s) => {
                    if (e.target.value === 'submenu') {
                      if (s.children === undefined) {
                        s.children = [{ label: 'New item', id: nextSectorId() }];
                        delete s.binding;
                        // keepOpen is a leaf-only flag — a branch always
                        // stays open (it drills), so drop a stale one.
                        delete s.keepOpen;
                      }
                    } else {
                      delete s.children;
                    }
                  })
                }
              >
                <option value="action">Action</option>
                <option value="submenu">Submenu</option>
              </select>
            </Row>
            {sector.children !== undefined && (
              <>
                <Row label="Submenu items">
                  <span className={styles.readonly}>{sector.children.length}</span>
                </Row>
                {sector.children.length > 0 && (
                  <button
                    type="button"
                    className={styles.openButton}
                    onClick={() => {
                      if (selectedIndex !== null) drillInto(selectedIndex);
                    }}
                  >
                    Open submenu →
                  </button>
                )}
              </>
            )}
            {sector.children === undefined && (
              <>
                {/* Keyed on the selection so ActionField's local "custom
                    mode" resets when you switch to another sector. */}
                <ActionField
                  key={path.join('.')}
                  binding={sector.binding}
                  actions={availableActions}
                  onPick={(id) =>
                    updateSectorAt(path, (s) => {
                      if (s.binding) s.binding.action = id;
                      else s.binding = { action: id };
                    })
                  }
                  onCustomChange={(text) =>
                    updateSectorAt(path, (s) => {
                      if (s.binding) s.binding.action = text;
                      else s.binding = { action: text };
                    })
                  }
                  onClear={() =>
                    updateSectorAt(path, (s) => {
                      delete s.binding;
                    })
                  }
                />
                {isExec && (
                  <button type="button" className={styles.openButton} onClick={handleBrowse}>
                    Browse for file…
                  </button>
                )}
                {sector.binding !== undefined && (
                  <>
                    {/* Keyed on the selection + remoteRev so the local JSON
                        text remounts on an external adoption, not while typing. */}
                    <ConfigEditor
                      key={`${path.join('.')}-${remoteRev}`}
                      value={sector.binding.config}
                      onChange={(cfg) =>
                        updateSectorAt(path, (s) => {
                          if (!s.binding) return;
                          if (cfg === undefined) delete s.binding.config;
                          else s.binding.config = cfg;
                        })
                      }
                    />
                    {/* keepOpen only makes sense for a leaf that actually
                        fires something — a label-only leaf commits to nothing,
                        so keeping the menu open there would strand the user. */}
                    <Row label="After action">
                      <select
                        className={styles.select}
                        value={sector.keepOpen ? 'keep' : 'close'}
                        title="Keep the menu open after this action fires — e.g. to nudge volume repeatedly with the same gesture"
                        onChange={(e) =>
                          updateSectorAt(path, (s) => {
                            if (e.target.value === 'keep') s.keepOpen = true;
                            else delete s.keepOpen;
                          })
                        }
                      >
                        <option value="close">Close menu</option>
                        <option value="keep">Keep menu open</option>
                      </select>
                    </Row>
                    {/* Per-item activation: an input that fires THIS item's
                        binding while it's hovered, on top of the global
                        trigger. Resolved ahead of the global gestures, so it
                        wins on a shared input (flagged below). */}
                    <div className={styles.subheading}>Activate with</div>
                    {(sector.activation?.inputs ?? []).map((input, i) => (
                      <Row key={i} label={`Input ${i + 1}`}>
                        <NavInputRow
                          input={input}
                          offeredButtons={offeredButtons}
                          defaultThreshold={DEFAULT_ACTIVATION_THRESHOLD}
                          onChange={(next) =>
                            updateSectorAt(path, (s) => {
                              if (s.activation) s.activation.inputs[i] = next;
                            })
                          }
                          onRemove={() =>
                            updateSectorAt(path, (s) => {
                              s.activation?.inputs.splice(i, 1);
                              if (s.activation && s.activation.inputs.length === 0)
                                delete s.activation;
                            })
                          }
                        />
                      </Row>
                    ))}
                    <button
                      type="button"
                      className={styles.openButton}
                      onClick={() =>
                        updateSectorAt(path, (s) => {
                          if (!s.activation) s.activation = { inputs: [] };
                          s.activation.inputs.push({ kind: 'none' });
                        })
                      }
                    >
                      + Add input
                    </button>
                    {activationShadows.length > 0 && (
                      <span className={styles.warning}>
                        ⚠ Shares an input with global {activationShadows.join(', ')} — this item’s
                        activation wins here.
                      </span>
                    )}
                  </>
                )}
              </>
            )}
          </section>

          <section className={styles.flowSection}>
            <div className={styles.flowHeading}>↱ Exit</div>
            <p className={styles.sectionNote}>
              Left with the global Back gesture — pops to the parent ring, or dismisses at the top
              level. A per-item exit gesture lands later.
            </p>
          </section>

          <section className={styles.flowSection}>
            {targets.length > 0 && (
              <Row label="Move to">
                <select
                  className={styles.select}
                  value=""
                  title="Move this item into another submenu (or the top level)"
                  onChange={(e) => {
                    if (e.target.value === '') return;
                    handleMove(targets[Number(e.target.value)]!.path);
                  }}
                >
                  <option value="">Move to submenu…</option>
                  {targets.map((t, i) => (
                    <option key={t.path.join('.')} value={i}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Row>
            )}
            <button
              type="button"
              className={styles.deleteButton}
              onClick={handleDelete}
              disabled={!canDelete}
              title={canDelete ? 'Delete this sector' : 'A menu must keep at least one sector'}
            >
              Delete sector
            </button>
          </section>
        </div>
      )}
    </aside>
  );
}
