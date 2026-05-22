// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { resolveNavigation, type MenuNavigation } from '@/shared/menu';

import { useAvailableActions } from '../hooks/useAvailableActions';
import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useMenuSettings } from '../state/menu-settings';
import { FALLBACK_BUTTON_COUNT } from '../state/nav-input';

import { ActionField } from './ActionField';
import { ConfigEditor } from './ConfigEditor';
import { GestureInputList } from './GestureInputList';
import { Row } from './Row';
import styles from './Properties.module.scss';

/**
 * Editor for the root node — the centre of the pie. Shown when the root
 * row (or the preview centre) is selected. The root is just a node like
 * any other (#129): a label (blank → the ✕ glyph) and an optional action
 * fired when the centre wins on commit, picked from the same Action
 * dropdown as every node. "No action" = silent dismiss (the historical
 * cancel); picking the Cancel action = an explicit, red cancel target.
 *
 * The root always hosts the top-level ring (`root.branches`) — that's
 * edited in the tree, not here. How the centre is *triggered* — its
 * commitCenter gesture — is edited here too, with the centre rather than
 * in the global ring-navigation section: there's a single centre, so its
 * trigger is naturally one binding (the per-item "Activate with" parallel).
 */
export function RootSettings() {
  const root = useMenuSettings((s) => s.config?.root);
  const setRootLabel = useMenuSettings((s) => s.setRootLabel);
  const setRootAction = useMenuSettings((s) => s.setRootAction);
  const setRootActionConfig = useMenuSettings((s) => s.setRootActionConfig);
  const navigation = useMenuSettings((s) => s.config?.navigation);
  const setNavigation = useMenuSettings((s) => s.setNavigation);
  const remoteRev = useMenuSettings((s) => s.remoteRev);
  const actions = useAvailableActions();

  // Device button count constrains the input dropdown (#66), like Properties.
  const { buttons: buttonCount } = useDeviceInfo();
  const offeredButtons = buttonCount > 0 ? buttonCount : FALLBACK_BUTTON_COUNT;

  const nav = resolveNavigation({ navigation });
  // Clone (the resolved fallback is frozen) → mutate → store.
  const commit = (mutator: (n: MenuNavigation) => void): void => {
    const next = structuredClone(nav);
    mutator(next);
    setNavigation(next);
  };

  return (
    <>
      <div className={styles.heading}>Center (root)</div>
      <Row label="Label">
        <input
          className={styles.input}
          value={root?.label ?? ''}
          placeholder="✕"
          onChange={(e) => setRootLabel(e.target.value)}
        />
      </Row>
      <ActionField
        action={root?.action}
        actions={actions}
        onPick={(id) => setRootAction(id)}
        onCustomChange={(text) => setRootAction(text)}
        onClear={() => setRootAction(null)}
      />
      {root?.action !== undefined && (
        // Remount on external adoption (not mid-typing), like the node
        // config editor.
        <ConfigEditor
          key={`root-${remoteRev}`}
          value={root?.action?.config}
          onChange={(cfg) => setRootActionConfig(cfg)}
        />
      )}
      {/* How the centre is triggered: the commitCenter gesture, edited here
          with the centre. No shadow warning — it's the centre's own commit,
          not a per-item override of a global gesture. */}
      <GestureInputList
        heading="Activate with"
        binding={nav.commitCenter}
        offeredButtons={offeredButtons}
        shadows={[]}
        verb="center"
        onChangeInput={(i, next) =>
          commit((n) => {
            n.commitCenter.inputs[i] = next;
          })
        }
        onRemoveInput={(i) =>
          commit((n) => {
            n.commitCenter.inputs.splice(i, 1);
          })
        }
        onAddInput={() =>
          commit((n) => {
            n.commitCenter.inputs.push({ kind: 'none' });
          })
        }
      />
    </>
  );
}
