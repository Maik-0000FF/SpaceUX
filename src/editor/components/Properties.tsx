// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import { isRenderableIcon } from '@/core/icon';
import { BUILTIN_ACTION, builtinAction, resolveNavigation } from '@/shared/menu';

import { confirmDeleteNode } from '../confirm-delete-node';
import { useAvailableActions } from '../hooks/useAvailableActions';
import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useReadOnlySource } from '../hooks/useReadOnlySource';
import { cancelLabelFor } from '../state/cancel-label';
import { gestureShadows } from '../state/gesture-collision';
import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { moveTargets, pathOfNodeId } from '../state/move-targets';
import { FALLBACK_BUTTON_COUNT } from '../state/nav-input';
import { ringBranches, nodeAtPath, selectedPath } from '../state/selectors';
import { nextNodeId, nodeKey, uniqueItemLabel } from '../state/node-keys';

import { ActionField } from './ActionField';
import { RootSettings } from './RootSettings';
import { ConfigEditor } from './ConfigEditor';
import { GestureInputList } from './GestureInputList';
import { MenuSettings } from './MenuSettings';
import { NavigationSettings } from './NavigationSettings';
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
 * Right sidebar: editable properties of the selected node (at any
 * depth — the selection is the current ring's index, combined with the
 * view path). A node is a leaf (action) or a branch (submenu);
 * the Type dropdown converts between them. A branch offers "Open
 * submenu" to drill in; Delete removes it from the current ring.
 */
export function Properties() {
  const config = useMenuSettings((s) => s.config);
  const updateNodeAt = useMenuSettings((s) => s.updateNodeAt);
  const deleteNode = useMenuSettings((s) => s.deleteNode);
  const moveNodeBetween = useMenuSettings((s) => s.moveNodeBetween);
  const remoteRev = useMenuSettings((s) => s.remoteRev);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const centerSelected = useAppState((s) => s.centerSelected);
  const selectNode = useAppState((s) => s.selectNode);
  const selectPath = useAppState((s) => s.selectPath);
  const clearSelection = useAppState((s) => s.clearSelection);
  const drillInto = useAppState((s) => s.drillInto);
  // Last node-icon pick error (too large / unsupported), shown under the row.
  const [iconError, setIconError] = useState<string | null>(null);
  // Local draft for the label field while it holds a value we deliberately
  // don't persist: an empty label on an icon-less node is unsavable (the
  // validator rejects it), so we keep it here instead of writing it to the
  // config — the field can show empty (to retype) while the saved config keeps
  // the old label and the debounced autosave never sees the invalid state.
  // null = no override (show the node's own label).
  const [labelDraft, setLabelDraft] = useState<string | null>(null);

  // Connected device's button count (0 = none/unknown) → constrains the
  // activation input dropdown's button options (#66).
  const { buttons: buttonCount } = useDeviceInfo();
  const offeredButtons = buttonCount > 0 ? buttonCount : FALLBACK_BUTTON_COUNT;
  const availableActions = useAvailableActions();
  // A plugin-provided menu is the active source → read-only. The store already
  // blocks every menu-config mutation; a disabled fieldset greys out and locks
  // all the edit controls below (incl. MenuSettings/Navigation/RootSettings) so
  // the panel visibly reads as not-editable.
  const readOnly = useReadOnlySource();

  // Edit the in-ring selection; or, when a branch has been drilled into
  // (nothing selected within its ring), edit that drilled-in node itself —
  // so picking a branch in the tree both dives in (preview) and edits it.
  const path =
    selectedPath(viewPath, selectedIndex) ?? (viewPath.length > 0 ? [...viewPath] : null);
  const node = config && path ? nodeAtPath(config, path) : null;

  // Drop a held label draft when the selection moves to another node, so a
  // leftover empty draft can't bleed onto the newly-selected node (blur
  // usually clears it first, but a programmatic selection change — undo,
  // external sync — wouldn't blur the focused field).
  const nodeKeyStr = node ? nodeKey(node) : null;
  useEffect(() => {
    setLabelDraft(null);
  }, [nodeKeyStr]);

  const isExec = node?.action?.id === builtinAction(BUILTIN_ACTION.EXEC);
  // Global gestures this node's activation / exit shadow — the per-item
  // binding wins for this item, so flag the override rather than block it.
  // Empty without one. The navigation is resolved once and shared.
  const navigation = config ? resolveNavigation(config) : null;
  const activationShadows =
    navigation && node?.activation ? gestureShadows(node.activation, navigation) : [];
  const exitShadows = navigation && node?.exit ? gestureShadows(node.exit, navigation) : [];

  // Rings the selected node can be moved into (excludes its own ring, its
  // subtree, and too-deep targets). Picked from the "Move to…" dropdown.
  const targets = config && path ? moveTargets(config, path) : [];
  const handleMove = (toRingPath: number[]): void => {
    if (!path || !config) return;
    // Capture the stable id first: index paths (incl. toRingPath) can shift
    // when the source splice reindexes a shared ancestor ring, so re-select
    // the moved node by id rather than by its pre-move target path.
    const movedId = nodeAtPath(config, path)?.id;
    moveNodeBetween(path, toRingPath);
    const current = useMenuSettings.getState().config;
    const newPath = current && movedId !== undefined ? pathOfNodeId(current, movedId) : null;
    if (newPath) selectPath(newPath);
  };

  // Pick a file for an exec command and write it into the action config.
  const handleBrowse = (): void => {
    if (!path) return;
    void window.editor.pickFile().then((file) => {
      if (!file) return;
      updateNodeAt(path, (s) => {
        if (s.action) {
          s.action.config = { ...(s.action.config ?? {}), command: quoteCommandPath(file) };
        }
      });
    });
  };

  // The top-level ring can be emptied to just the centre; a submenu keeps
  // its last item (delete the submenu node itself to remove it).
  const canDelete =
    selectedIndex !== null &&
    (viewPath.length === 0 || (config ? ringBranches(config, viewPath).length : 0) > 1);
  const handleDelete = async (): Promise<void> => {
    if (selectedIndex === null) return;
    const node = config ? ringBranches(config, viewPath)[selectedIndex] : undefined;
    if (node && !(await confirmDeleteNode(node))) return;
    deleteNode(viewPath, selectedIndex);
    const current = useMenuSettings.getState().config;
    const remaining = current ? ringBranches(current, viewPath).length : 0;
    // Keep the editing flow: select a neighbour rather than nothing.
    if (remaining > 0) selectNode(Math.min(selectedIndex, remaining - 1));
    else clearSelection();
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.heading}>Properties</div>
      {/* Everything below edits the menu config — disabled (and greyed) while
          the active source is a plugin-provided, read-only menu. */}
      <fieldset className={styles.editLock} disabled={readOnly}>
        {/* Menu-wide settings — the trigger button + what it does once open.
          Always present (collapsible) so they're reachable whatever is
          selected. The navigation gestures live in their own section below. */}
        {config && (
          <details className={styles.globalSection} open>
            <summary className={styles.globalSummary}>Menu settings</summary>
            <div className={styles.fields}>
              <MenuSettings />
            </div>
          </details>
        )}
        {/* Navigation — the global gestures + aim/deadzone a navigation style
          configures. Its own section (sibling of Menu settings) so everything
          style-related lives under one "Navigation" heading. */}
        {config && (
          <details className={styles.globalSection} open>
            <summary className={styles.globalSummary}>Navigation</summary>
            <div className={styles.fields}>
              <NavigationSettings />
            </div>
          </details>
        )}
        {config && centerSelected ? (
          // Root row / preview centre selected → edit the root node.
          <div className={styles.fields}>
            <RootSettings />
          </div>
        ) : !node || !path ? (
          <p className={styles.empty}>Select a node to edit it.</p>
        ) : (
          <div className={styles.fields}>
            {/* The item is edited along the flow you run with the puck:
              how you reach it (Entry), what it does (Behavior), how you
              leave it (Exit). Entry/Exit only describe the global model
              for now — per-item gesture overrides land with #105. */}
            <section className={styles.flowSection}>
              <div className={styles.flowHeading}>↳ Entry</div>
              <p className={styles.sectionNote}>
                Reached with the global navigation gestures — aim the puck at this node, or cycle to
                step onto it. A per-item entry gesture lands later.
              </p>
            </section>

            <section className={styles.flowSection}>
              <div className={styles.flowHeading}>Behavior</div>
              <Row label="Label">
                <input
                  className={styles.input}
                  value={labelDraft ?? node.label}
                  onChange={(e) => {
                    const value = e.target.value;
                    // An empty label on an icon-less node is unsavable, and the
                    // live autosave would flash a save error. Hold it in the
                    // draft only — don't write it — so the config keeps the old
                    // label until a valid one is typed. Any other value is
                    // written live so the preview tracks each keystroke.
                    if (value.trim() === '' && !isRenderableIcon(node.icon)) {
                      setLabelDraft(value);
                      return;
                    }
                    setLabelDraft(null);
                    updateNodeAt(path, (s) => {
                      s.label = value;
                    });
                  }}
                  // Drop a held empty draft on blur → the field falls back to the
                  // node's (preserved) label. Matches the tree: an icon-less node
                  // can't be left label-less.
                  onBlur={() => setLabelDraft(null)}
                />
              </Row>
              <Row label="Icon">
                <div className={styles.iconRow}>
                  {isRenderableIcon(node.icon) && (
                    <img className={styles.iconPreview} src={node.icon} alt="" />
                  )}
                  <button
                    type="button"
                    className={styles.openButton}
                    onClick={() => {
                      setIconError(null);
                      void window.editor.pickIcon().then((r) => {
                        if (r.ok === true)
                          updateNodeAt(path, (s) => {
                            s.icon = r.dataUri;
                          });
                        else if (r.ok === false) setIconError(r.reason);
                      });
                    }}
                  >
                    {isRenderableIcon(node.icon) ? 'Replace…' : 'Choose…'}
                  </button>
                  {node.icon !== undefined && (
                    <button
                      type="button"
                      className={styles.openButton}
                      onClick={() =>
                        updateNodeAt(path, (s) => {
                          delete s.icon;
                        })
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              </Row>
              {iconError !== null && <p className={styles.warning}>{iconError}</p>}
              <Row label="Type">
                <select
                  className={styles.select}
                  value={node.branches !== undefined ? 'submenu' : 'action'}
                  title={
                    node.branches !== undefined
                      ? 'Switching to Action discards this submenu and its items'
                      : undefined
                  }
                  onChange={(e) =>
                    updateNodeAt(path, (s) => {
                      if (e.target.value === 'submenu') {
                        if (s.branches === undefined) {
                          s.branches = [{ label: uniqueItemLabel(path, []), id: nextNodeId() }];
                          delete s.action;
                          // keepOpen is a leaf-only flag — a branch always
                          // stays open (it drills), so drop a stale one.
                          delete s.keepOpen;
                        }
                      } else {
                        delete s.branches;
                      }
                    })
                  }
                >
                  <option value="action">Action</option>
                  <option value="submenu">Submenu</option>
                </select>
              </Row>
              {node.branches !== undefined && (
                <>
                  <Row label="Submenu items">
                    <span className={styles.readonly}>{node.branches.length}</span>
                  </Row>
                  {node.branches.length > 0 && (
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
              {node.branches === undefined && (
                <>
                  {/* Keyed on the selection so ActionField's local "custom
                    mode" resets when you switch to another node. */}
                  <ActionField
                    key={path.join('.')}
                    action={node.action}
                    actions={availableActions}
                    onPick={(id) =>
                      updateNodeAt(path, (s) => {
                        if (s.action) s.action.id = id;
                        else s.action = { id };
                        // Picking Cancel onto a still-default label fills in
                        // "Cancel" (editable); a custom label is left alone.
                        const auto = cancelLabelFor(id, s.label);
                        if (auto !== null) s.label = auto;
                      })
                    }
                    onCustomChange={(text) =>
                      updateNodeAt(path, (s) => {
                        if (s.action) s.action.id = text;
                        else s.action = { id: text };
                      })
                    }
                    onClear={() =>
                      updateNodeAt(path, (s) => {
                        delete s.action;
                      })
                    }
                  />
                  {isExec && (
                    <button type="button" className={styles.openButton} onClick={handleBrowse}>
                      Browse for file…
                    </button>
                  )}
                  {node.action !== undefined && (
                    <>
                      {/* Keyed on the selection + remoteRev so the local JSON
                        text remounts on an external adoption, not while typing. */}
                      <ConfigEditor
                        key={`${path.join('.')}-${remoteRev}`}
                        value={node.action.config}
                        onChange={(cfg) =>
                          updateNodeAt(path, (s) => {
                            if (!s.action) return;
                            if (cfg === undefined) delete s.action.config;
                            else s.action.config = cfg;
                          })
                        }
                      />
                      {/* keepOpen only makes sense for a leaf that actually
                        fires something — a label-only leaf commits to nothing,
                        so keeping the menu open there would strand the user. */}
                      <Row label="After action">
                        <select
                          className={styles.select}
                          value={node.keepOpen ? 'keep' : 'close'}
                          title="Keep the menu open after this action fires — e.g. to nudge volume repeatedly with the same gesture"
                          onChange={(e) =>
                            updateNodeAt(path, (s) => {
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
                      <GestureInputList
                        heading="Activate with"
                        binding={node.activation}
                        offeredButtons={offeredButtons}
                        shadows={activationShadows}
                        verb="activation"
                        onChangeInput={(i, next) =>
                          updateNodeAt(path, (s) => {
                            if (s.activation) s.activation.inputs[i] = next;
                          })
                        }
                        onRemoveInput={(i) =>
                          updateNodeAt(path, (s) => {
                            s.activation?.inputs.splice(i, 1);
                            if (s.activation && s.activation.inputs.length === 0)
                              delete s.activation;
                          })
                        }
                        onAddInput={() =>
                          updateNodeAt(path, (s) => {
                            if (!s.activation) s.activation = { inputs: [] };
                            s.activation.inputs.push({ kind: 'none' });
                          })
                        }
                      />
                    </>
                  )}
                </>
              )}
            </section>

            <section className={styles.flowSection}>
              <div className={styles.flowHeading}>↱ Exit</div>
              <p className={styles.sectionNote}>
                The global “Go back” gesture pops to the parent ring (or dismisses at the top
                level). A per-item exit input instead returns focus to the centre — deselects, the
                menu stays open — useful as the alternative way out when an activation has shadowed
                Go back here.
              </p>
              {/* Per-item exit: an input that, while this node is hovered,
                deselects to the centre. Applies to any node (leaf or
                submenu); resolved ahead of the global gestures, so it wins
                on a shared input (flagged below). */}
              <GestureInputList
                heading="Exit with"
                binding={node.exit}
                offeredButtons={offeredButtons}
                shadows={exitShadows}
                verb="exit"
                onChangeInput={(i, next) =>
                  updateNodeAt(path, (s) => {
                    if (s.exit) s.exit.inputs[i] = next;
                  })
                }
                onRemoveInput={(i) =>
                  updateNodeAt(path, (s) => {
                    s.exit?.inputs.splice(i, 1);
                    if (s.exit && s.exit.inputs.length === 0) delete s.exit;
                  })
                }
                onAddInput={() =>
                  updateNodeAt(path, (s) => {
                    if (!s.exit) s.exit = { inputs: [] };
                    s.exit.inputs.push({ kind: 'none' });
                  })
                }
              />
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
                onClick={() => void handleDelete()}
                disabled={!canDelete}
                title={canDelete ? 'Delete this node' : 'A submenu must keep at least one item'}
              >
                Delete node
              </button>
            </section>
          </div>
        )}
      </fieldset>
    </aside>
  );
}
