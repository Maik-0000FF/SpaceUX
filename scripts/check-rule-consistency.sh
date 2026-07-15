#!/usr/bin/env bash
# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Guard against drift in the udev-rule surface that is spread across several
# files by hand. data/spacemouse-046d-pids is the single source for the 046d
# SpaceMouse product ids, but two consumers cannot read it and instead carry a
# copied literal: the manual-setup block in docs/install.md and the Nix module
# (nix/module.nix). This check fails when a copy drifts from the source, so a
# forgotten update is caught in CI instead of silently shipping a rule that
# matches the wrong devices.
#
# It also checks that every udev rule file scripts/install.sh writes is removed
# again by scripts/uninstall.sh, so an added or renamed rule can never be left
# behind on uninstall.
#
# No arguments; exits 0 when everything agrees, non-zero (with the specific
# mismatch) otherwise. Runs in CI and by hand from anywhere in the checkout.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Same PID parser scripts/install.sh uses, so the reference this check compares
# against is byte-identical to what the installer writes.
# shellcheck source=scripts/lib/spacemouse-pids.sh
. "$ROOT/scripts/lib/spacemouse-pids.sh"

PID_SOURCE=data/spacemouse-046d-pids
DOCS=docs/install.md
NIX=nix/module.nix
INSTALL=scripts/install.sh
UNINSTALL=scripts/uninstall.sh

fail=0
err() {
    printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2
    fail=1
}
ok() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

# The canonical 046d PID alternation (c603|c605|...|c640), from the shared parser
# so the reference matches the installer's output exactly.
canonical="$(spacemouse_046d_pid_alternation "$PID_SOURCE")"
if [[ -z "$canonical" ]]; then
    err "no PIDs parsed from $PID_SOURCE"
    exit 1
fi

# ── 1. docs/install.md: every idProduct=="..." literal must equal canonical ──
# The manual-setup block writes the rules verbatim, so each 046d idProduct match
# is a hand-copy of the source.
mapfile -t docs_lits < <(grep -oE 'idProduct}=="[^"]+"' "$DOCS" | sed -E 's/^idProduct}=="//; s/"$//')
if [[ ${#docs_lits[@]} -eq 0 ]]; then
    err "$DOCS: no idProduct==\"...\" rule found (expected the 046d SpaceMouse rules)"
fi
for lit in "${docs_lits[@]}"; do
    if [[ "$lit" != "$canonical" ]]; then
        err "$DOCS: idProduct list drifted from $PID_SOURCE"
        printf '    docs:   %s\n    source: %s\n' "$lit" "$canonical" >&2
    fi
done

# ── 2. nix/module.nix: the logitechSpacemousePids literal must equal canonical ─
nix_lit="$(grep -oE 'logitechSpacemousePids = "[^"]+"' "$NIX" | sed -E 's/^logitechSpacemousePids = "//; s/"$//' || true)"
if [[ -z "$nix_lit" ]]; then
    err "$NIX: logitechSpacemousePids not found"
elif [[ "$nix_lit" != "$canonical" ]]; then
    err "$NIX: logitechSpacemousePids drifted from $PID_SOURCE"
    printf '    nix:    %s\n    source: %s\n' "$nix_lit" "$canonical" >&2
fi

[[ $fail -eq 0 ]] && ok "046d PID list is in sync across $PID_SOURCE, $DOCS and $NIX"

# ── 3. every rule install.sh writes is removed by uninstall.sh ────────────────
# Match the NN-spaceux-*.rules filenames each script references. install.sh's
# set is what it creates (plus the legacy name it cleans up); every one of them
# must appear in uninstall.sh so nothing is orphaned. The reverse is fine:
# uninstall may list extra legacy names.
rules_fail=0
mapfile -t install_rules < <(grep -oE '[0-9]{2}-spaceux-[a-z-]+\.rules' "$INSTALL" | sort -u)
# || true: an empty match returns 1 and, under pipefail + set -e, would abort the
# assignment before the loop can report the specific missing rule.
uninstall_rules="$(grep -oE '[0-9]{2}-spaceux-[a-z-]+\.rules' "$UNINSTALL" | sort -u || true)"
if [[ ${#install_rules[@]} -eq 0 ]]; then
    err "$INSTALL: no NN-spaceux-*.rules filename found"
    rules_fail=1
fi
for r in "${install_rules[@]}"; do
    if ! grep -qxF "$r" <<<"$uninstall_rules"; then
        err "$UNINSTALL does not remove $r (written by $INSTALL)"
        rules_fail=1
    fi
done
[[ $rules_fail -eq 0 && ${#install_rules[@]} -gt 0 ]] &&
    ok "every udev rule $INSTALL writes is removed by $UNINSTALL"

exit $fail
