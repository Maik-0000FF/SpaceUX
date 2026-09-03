#!/usr/bin/env bash
# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Guard against drift between nix/package-lock.json and the npmDepsHash that
# flake.nix pins for it. buildNpmPackage fetches the whole dependency tree as a
# single fixed-output derivation whose hash is written by hand, so a regenerated
# lockfile has to be committed together with a refreshed hash.
#
# Nothing else catches a stale one. The lockfile-sync check compares the
# manifest against the lock and says nothing about the hash, and every npm lane
# in CI installs from the untracked root lock, which the hash does not cover.
# Without this check the mismatch surfaces at `nix build`, on a machine that is
# usually not the one that made the change.
#
# Only the deps derivation is built, never the package. That derivation is
# exactly what the hash covers, and stopping there keeps the check to a registry
# fetch instead of the Qt and CMake build behind it.
#
# The verdict comes from nix rather than from two hashes compared here, so it
# stays exactly as strict as the build it protects and the diagnosis already
# carries the value to paste back. The cost of borrowing a verdict is that the
# classification keys on the wording nix uses; anything that does not match it
# is reported as no verdict reached, never as drift.
#
# The cases this has to tell apart, and what each one produces:
#
#   lock and hash agree                    exit 0
#   lock regenerated, hash left stale      exit 1, with nix's `got:` value
#   nix not installed                      exit 2, named as such
#   nix-command/flakes not enabled         cannot arise: both are requested on
#                                          the command line below
#   binary cache or registry unreachable   exit 2
#   flake does not evaluate                exit 2
#
# No arguments. Runs in CI and by hand from anywhere in the checkout.

set -euo pipefail

# BASH_SOURCE holds the path the script was invoked by, which is not necessarily
# a path to the script itself: for a symlink pointing into the checkout it names
# the link, and the shared libraries below would be looked for beside that link.
# readlink -f resolves it to the real file, once, for everything that follows.
SELF="$(readlink -f "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"
cd "$ROOT"

# err/ok come from the shared logger, so this lane's output matches the other
# scripts' and the styling lives in one place.
# shellcheck source=scripts/lib/log.sh
. "$ROOT/scripts/lib/log.sh"

FLAKE=flake.nix
LOCK=nix/package-lock.json
# The deps half of the package, which is the only part the hash pins.
DEPS_ATTR='.#default.npmDeps'

if ! command -v nix >/dev/null 2>&1; then
    err "nix not found, and this check needs it to build $DEPS_ATTR"
    exit 2
fi

# --no-link so no result symlink is dropped in the checkout.
#
# --extra-experimental-features: nix-command and flakes are still opt-in on a
# stock install, where this call would otherwise fail on the invocation instead
# of on the hash. Requesting them here keeps the check runnable on a machine
# whose nix.conf does not enable them.
#
# NO_COLOR: nix colours its diagnosis when it believes it is writing to a
# terminal, and the sentence below is matched literally. A command substitution
# already hides the terminal, so this only pins what is otherwise incidental.
status=0
output="$(NO_COLOR=1 nix build --no-link \
    --extra-experimental-features 'nix-command flakes' \
    "$DEPS_ATTR" 2>&1)" || status=$?

if [[ $status -eq 0 ]]; then
    ok "$FLAKE pins the hash $LOCK currently produces"
    exit 0
fi

# Only a fixed-output hash mismatch is drift. A missing binary cache, an
# unreachable registry and a flake that does not evaluate all fail here too, and
# none of them is an answer about the hash; reporting them as drift would send
# someone off to refresh a value that is already correct.
MISMATCH_MESSAGE='hash mismatch in fixed-output derivation'
if ! grep -qF "$MISMATCH_MESSAGE" <<<"$output"; then
    err "nix build failed before it could check the hash in $FLAKE"
    printf '%s\n' "$output" >&2
    exit 2
fi

err "the npmDepsHash in $FLAKE is stale for $LOCK"
printf '%s\n' "$output" >&2
# nix names both values, so the fix is a copy of the one it got. The second
# route is for a lockfile that is about to change anyway, where the hash can be
# computed without waiting for this check to fail again.
printf '\n    Put the `got:` value above into npmDepsHash in %s.\n' "$FLAKE" >&2
printf '    It can also be computed directly, from the repository root:\n' >&2
printf '      prefetch-npm-deps %s\n' "$LOCK" >&2
exit 1
