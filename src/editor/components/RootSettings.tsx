// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useAvailableActions } from '../hooks/useAvailableActions';
import { useMenuSettings } from '../state/menu-settings';

import { ActionField } from './ActionField';
import { ConfigEditor } from './ConfigEditor';
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
 * edited in the tree, not here — and how the centre is *triggered* lives
 * in the navigation bindings (`navigation.commitCenter`, #105).
 */
export function RootSettings() {
  const root = useMenuSettings((s) => s.config?.root);
  const setRootLabel = useMenuSettings((s) => s.setRootLabel);
  const setRootAction = useMenuSettings((s) => s.setRootAction);
  const setRootActionConfig = useMenuSettings((s) => s.setRootActionConfig);
  const remoteRev = useMenuSettings((s) => s.remoteRev);
  const actions = useAvailableActions();

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
    </>
  );
}
