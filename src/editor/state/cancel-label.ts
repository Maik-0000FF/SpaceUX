// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { BUILTIN_ACTION, builtinAction } from '@/shared/menu';

/** The generic label a freshly-added ring node carries (see addNode). */
const DEFAULT_NODE_LABEL = 'New item';

/**
 * Suggested label when an action is picked onto a node, or `null` to leave
 * the label as-is. Picking the built-in Cancel action onto a node whose
 * label is still a default (empty, or the generic "New item") fills in
 * "Cancel" so the wedge is labelled without the user typing it — but a
 * custom label the user already set is never clobbered. The label stays
 * fully editable afterwards. Used by both the sector and centre editors.
 */
export function cancelLabelFor(actionId: string, currentLabel: string): string | null {
  const isCancel = actionId === builtinAction(BUILTIN_ACTION.CANCEL);
  const isDefaultLabel = currentLabel === '' || currentLabel === DEFAULT_NODE_LABEL;
  return isCancel && isDefaultLabel ? 'Cancel' : null;
}
