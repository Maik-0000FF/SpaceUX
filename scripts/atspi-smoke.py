# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# AT-SPI smoke test for the Qt editor (#457 Phase E): asserts the editor's
# automation surface is reachable over AT-SPI and
# drives one real interaction through the accessibility actions. Run by
# scripts/atspi-smoke.sh inside a private session bus + X server with the Qt
# accessibility bridge forced on (see the editor-a11y CI job).

import sys
import time

import pyatspi

FIND_APP_TIMEOUT_S = 60
SETTLE_TIMEOUT_S = 10
POLL_INTERVAL_S = 0.5

# The expected role inventory (#457 E1): role name as
# AT-SPI reports it -> the minimum count a healthy editor exposes. Push
# buttons are deliberately absent: none is visible without a selection (the
# Properties buttons and the tree row actions are selection/hover-gated), and
# actionability is proven by the tab-press interaction below.
EXPECTED_ROLES = {
    "page tab list": 1,  # the top tab strip
    "page tab": 3,  # Settings | Pie menu | Desktop
    "combo box": 1,  # the dropdowns
}
# Qt's AT-SPI bridge reports the tree family in table vocabulary (tree table /
# table cell) rather than the web's tree / tree item; accept either, the
# assertion tracks the surface, not the bridge's wording.
TREE_ROLES = ("tree", "tree table")
TREE_ROW_ROLES = ("tree item", "table cell", "list item")
PAGE_TABS = ("Settings", "Pie menu", "Desktop")


def find_editor(deadline_s):
    """The editor's application accessible, polled until it registers."""
    end = time.monotonic() + deadline_s
    while time.monotonic() < end:
        desktop = pyatspi.Registry.getDesktop(0)
        for app in desktop:
            if app is not None and "spaceux" in (app.name or "").lower():
                return app
        time.sleep(POLL_INTERVAL_S)
    return None


def walk(node):
    # Tolerate accessibles going stale mid-iteration: a tab switch rebuilds
    # whole subtrees, and a node fetched before the rebuild answers with a
    # GLib error afterwards. A vanished subtree just stops contributing.
    yield node
    try:
        count = node.childCount
    except Exception:
        return
    for i in range(count):
        try:
            child = node.getChildAtIndex(i)
        except Exception:
            continue
        if child is not None:
            yield from walk(child)


def role_inventory(app):
    """Role name -> list of accessible names found under the app."""
    out = {}
    for node in walk(app):
        try:
            out.setdefault(node.getRoleName(), []).append(node.name or "")
        except Exception:
            continue  # stale accessible, see walk()
    return out


def has_role(app, roles):
    return any(role_inventory(app).get(role) for role in roles)


def press(node):
    """Invoke the node's press-like accessibility action, if it has one."""
    try:
        action = node.queryAction()
    except Exception:
        return False  # no action interface, or stale (see walk())
    for i in range(action.nActions):
        if action.getName(i).lower() in ("press", "click", "push", "toggle"):
            action.doAction(i)
            return True
    return False


def wait_for(predicate, deadline_s):
    end = time.monotonic() + deadline_s
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(POLL_INTERVAL_S)
    return False


def main():
    app = find_editor(FIND_APP_TIMEOUT_S)
    if app is None:
        print("FAIL: the editor never appeared on the AT-SPI bus")
        return 1

    failures = []

    # Settle: the app registers on the bus before the pie tab's async pulls
    # (menu config, scene) have landed; without this wait the first inventory
    # races the load and the run depends on machine speed. The tree rows are
    # the sentinel for a fully loaded pie tab.
    if not wait_for(lambda: has_role(app, TREE_ROW_ROLES), SETTLE_TIMEOUT_S):
        print("FAIL: the pie tab never settled (no tree rows appeared)")
        return 1

    found = role_inventory(app)

    # One real interaction: switch to the Settings tab over the AT-SPI press
    # action and wait for the check boxes that page carries (launch-on-login,
    # grab-while-open) to appear in the accessible tree.
    settings_tab = next(
        (
            n
            for n in walk(app)
            if n.getRoleName() == "page tab" and n.name == "Settings"
        ),
        None,
    )
    if settings_tab is None or not press(settings_tab):
        failures.append("could not press the Settings page tab")
    elif not wait_for(
        lambda: any(n.getRoleName() == "check box" for n in walk(app)),
        SETTLE_TIMEOUT_S,
    ):
        failures.append("no check box appeared after switching to Settings")

    # Assert over the union of both tabs' inventories, so a control that only
    # exists on the Settings page still counts for its role.
    for role, names in role_inventory(app).items():
        found.setdefault(role, []).extend(names)

    for role, minimum in EXPECTED_ROLES.items():
        count = len(found.get(role, []))
        if count < minimum:
            failures.append(f"role '{role}': expected >= {minimum}, found {count}")

    if not any(found.get(role) for role in TREE_ROLES):
        failures.append(f"no tree container (any of {TREE_ROLES})")
    if not any(found.get(role) for role in TREE_ROW_ROLES):
        failures.append(f"no tree rows (any of {TREE_ROW_ROLES})")

    for tab in PAGE_TABS:
        if tab not in found.get("page tab", []):
            failures.append(f"page tab '{tab}' is missing")

    if failures:
        print("AT-SPI smoke FAILED:")
        for failure in failures:
            print(f"  - {failure}")
        print("inventory:")
        for role in sorted(found):
            print(f"  {role}: {len(found[role])}")
        return 1

    total = sum(len(names) for names in found.values())
    print(f"AT-SPI smoke ok: {total} accessibles, roles: {', '.join(sorted(found))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
