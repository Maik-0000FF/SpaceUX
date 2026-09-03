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
#   the same, on a store that already      exit 1: the probe below makes this
#     holds the stale hash's output        case indistinguishable from a cold
#                                          store, see there
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
# The tracked files this guards are named in one place, shared with the other
# npm check, so a rename cannot leave one of them behind.
# shellcheck source=scripts/lib/nix-pins.sh
. "$ROOT/scripts/lib/nix-pins.sh"

# The deps half of the package, which is the only part the hash pins.
DEPS_ATTR='.#default.npmDeps'

if ! command -v nix >/dev/null 2>&1; then
    err "nix not found, and this check needs it to build $DEPS_ATTR"
    exit 2
fi

# --no-link so no result symlink is dropped in the checkout.
#
# The build alone answers nothing on a machine that has built the package
# before. A fixed-output derivation's store path is derived from its hash alone,
# so a stale hash names the path left behind by the build that hash was correct
# for; nix takes that as already built, never runs the fetcher and never
# compares. The result is a green tick on exactly the tree that is wrong, and it
# appears only when run by hand, which is where the tick is trusted most.
#
# --rebuild forces the comparison, but it only ever re-checks an output that is
# there: with the path absent it refuses outright ("not valid, so checking is
# not possible"), which is every CI run. So the flag is added exactly when the
# path is already in the store, and left off when it is not, which is when the
# plain build fetches and compares by itself. Both ways compare the hash, and
# both fetch the tree exactly once.
#
# --extra-experimental-features: nix-command and flakes are still opt-in on a
# stock install, where this call would otherwise fail on the invocation instead
# of on the hash. Requesting them here keeps the check runnable on a machine
# whose nix.conf does not enable them.
#
# NO_COLOR: nix colours its diagnosis when it believes it is writing to a
# terminal, and the sentence below is matched literally. A command substitution
# already hides the terminal, so this only pins what is otherwise incidental.
# The path is pure evaluation, available without building anything. An
# evaluation failure leaves it empty, and the build below then reports that
# failure properly instead of this probe swallowing it.
deps_path="$(nix eval --raw \
    --extra-experimental-features 'nix-command flakes' \
    "$DEPS_ATTR.outPath" 2>/dev/null || true)"

# Validity, not existence: an interrupted or hash-rejected build leaves the
# directory on disk while nix still counts the path as invalid, and --rebuild
# wants what nix counts, not what the filesystem shows. path-info answers
# exactly that question and builds nothing.
rebuild=()
if [[ -n "$deps_path" ]] && nix path-info \
    --extra-experimental-features 'nix-command flakes' \
    "$deps_path" >/dev/null 2>&1; then
    rebuild=(--rebuild)
fi

status=0
output="$(NO_COLOR=1 nix build --no-link "${rebuild[@]}" \
    --extra-experimental-features 'nix-command flakes' \
    "$DEPS_ATTR" 2>&1)" || status=$?

if [[ $status -eq 0 ]]; then
    ok "$NIX_FLAKE pins the hash $NIX_LOCK currently produces"
    exit 0
fi

# Only a fixed-output hash mismatch is drift. A missing binary cache, an
# unreachable registry and a flake that does not evaluate all fail here too, and
# none of them is an answer about the hash; reporting them as drift would send
# someone off to refresh a value that is already correct.
MISMATCH_MESSAGE='hash mismatch in fixed-output derivation'
if ! grep -qF "$MISMATCH_MESSAGE" <<<"$output"; then
    err "nix build failed before it could check the hash in $NIX_FLAKE"
    printf '%s\n' "$output" >&2
    exit 2
fi

err "the $NIX_HASH_FIELD in $NIX_FLAKE is stale for $NIX_LOCK"
printf '%s\n' "$output" >&2
# nix names both values, so the fix is a copy of the one it got. The second
# route is for a lockfile that is about to change anyway, where the hash can be
# computed without waiting for this check to fail again.
printf '\n    Put the `got:` value above into %s in %s.\n' "$NIX_HASH_FIELD" "$NIX_FLAKE" >&2
printf '    It can also be computed directly, from the repository root:\n' >&2
printf '      %s %s\n' "$NIX_PREFETCH" "$NIX_LOCK" >&2
exit 1
