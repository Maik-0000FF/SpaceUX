# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
# shellcheck shell=bash
#
# Shared helper, meant to be sourced (not run). The one place the terminal
# styling of the shell scripts lives: four message shapes (a section heading, a
# success, a warning, an error), each with its colour and glyph. Sourced by
# scripts/install.sh, scripts/uninstall.sh, scripts/check-rule-consistency.sh,
# scripts/check-npm-lock-sync.sh and scripts/check-npm-deps-hash.sh, so a change
# to how a message looks reaches all of them at once instead of being
# hand-copied per script. Sourcing it
# defines the four functions, the colour names they use and the error counter,
# and does nothing else.
#
# say and ok print to stdout, the progress the caller asked to see. warn and err
# print to stderr, so a failing CI lane still shows them when stdout is
# captured or discarded, and so a caller can pipe its own output without
# swallowing the diagnosis.

# Bold SGR colours and the reset, named once so no caller carries an escape
# sequence of its own.
LOG_BLUE=$'\033[1;34m'
LOG_GREEN=$'\033[1;32m'
LOG_YELLOW=$'\033[1;33m'
LOG_RED=$'\033[1;31m'
LOG_RESET=$'\033[0m'

# How many errors err has printed. A check that reports every mismatch instead
# of stopping at the first takes its exit status from here, so the counting path
# is the plain err every script already calls and there is no second name to
# forget. Only calls in the current shell count: err inside a command
# substitution or a pipeline updates a copy that is thrown away with the
# subshell.
LOG_ERRORS=0

# Section heading. The leading blank line sets it off from the step above it.
say() { printf '\n%s==> %s%s\n' "$LOG_BLUE" "$*" "$LOG_RESET"; }
ok() { printf '%s✓ %s%s\n' "$LOG_GREEN" "$*" "$LOG_RESET"; }
warn() { printf '%s! %s%s\n' "$LOG_YELLOW" "$*" "$LOG_RESET" >&2; }
err() {
    printf '%s✗ %s%s\n' "$LOG_RED" "$*" "$LOG_RESET" >&2
    LOG_ERRORS=$((LOG_ERRORS + 1))
}
