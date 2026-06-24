#!/usr/bin/env bash
# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# SpaceUX from-source installer (alpha). Builds the C daemon, the native
# Qt overlay + editor and the Node core from this checkout, sets up the device
# permissions the daemon needs, and installs a `spaceux` launcher plus a
# desktop entry. The clone stays in place; the launcher runs from here.
#
# Supports the Arch family (pacman) and Debian/Ubuntu (apt). Other distros can
# install the listed build dependencies by hand and re-run with --skip-deps.
#
# Usage:
#   scripts/install.sh                  # deps + build + device perms + launcher
#   scripts/install.sh --with-spacenavd # also install spacenavd for FreeCAD/Blender
#   scripts/install.sh --no-spacenavd   # never prompt about spacenavd
#   scripts/install.sh --skip-deps      # don't touch system packages
#   scripts/install.sh --skip-perms     # don't touch udev rules / groups
#   scripts/install.sh --check-deps     # only verify the required packages resolve, then exit
# Flags combine.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_SPACENAVD=ask
SKIP_DEPS=0
SKIP_PERMS=0
CHECK_DEPS_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --with-spacenavd) WITH_SPACENAVD=yes ;;
        --no-spacenavd) WITH_SPACENAVD=no ;;
        --skip-deps) SKIP_DEPS=1 ;;
        --skip-perms) SKIP_PERMS=1 ;;
        --check-deps) CHECK_DEPS_ONLY=1 ;;
        -h | --help)
            sed -n '4,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "unknown flag: $arg (try --help)" >&2
            exit 2
            ;;
    esac
done

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
ask_yes() {
    # ask_yes "question" -> 0 on yes. Defaults to no on a bare Enter.
    local reply
    read -r -p "$1 [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]]
}
ask_yes_default() {
    # ask_yes_default "question" -> 0 on yes. Defaults to YES on a bare Enter,
    # for the recommended path where accepting the default must never break the
    # install. A non-interactive run takes the default (yes).
    local reply
    [[ -t 0 ]] || return 0
    read -r -p "$1 [Y/n] " reply
    [[ ! "$reply" =~ ^[Nn]$ ]]
}

# ── Distro detection ────────────────────────────────────────────────────────
DISTRO=unknown
if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case " ${ID:-} ${ID_LIKE:-} " in
        *" arch "*) DISTRO=arch ;;
        *" debian "* | *" ubuntu "*) DISTRO=debian ;;
    esac
fi

# Build + runtime dependencies, split into ESSENTIAL and OPTIONAL.
#
# Essential = the app cannot build or run without it: the C/C++ toolchain, CMake,
# Node, the Qt6 dev modules the overlay + editor link (base/declarative/svg) plus
# their LayerShellQt dev package, the QtQuick QML runtime modules they import, and
# the Qt SVG image-format plugin the editor needs to draw SVG icons. A missing
# essential package is FATAL (install_deps aborts with the list) so a renamed or
# absent package can never silently produce a broken install.
#
# Optional = the app degrades gracefully without it: KF6WindowSystem (frosted-blur
# build dep), kscreen-doctor (reads the real per-output scale), clang (optional
# checks), wireplumber (its wpctl drives the desktop-mode volume control on
# wlroots compositors like Hyprland and mango; KDE uses the media keys instead)
# and brightnessctl (the brightness control there; it ships the udev rules and
# wants membership of the video group to write the backlight without root).
# A missing optional is warned, not fatal.
#
# Package names are verified against the live distros (Arch: pacman; Ubuntu 26.04:
# apt) and re-verified per distro by the CI dependency-drift check (install.sh
# --check-deps runs in each install-lane container), so a name that drifts on a
# future release is caught before it reaches a user.
ARCH_ESSENTIAL=(base-devel cmake nodejs npm qt6-base qt6-declarative qt6-svg layer-shell-qt)
ARCH_OPTIONAL=(libkscreen kwindowsystem clang wireplumber brightnessctl)
DEBIAN_ESSENTIAL=(build-essential cmake nodejs npm qt6-base-dev qt6-declarative-dev
    qt6-svg-dev liblayershellqtinterface-dev qml6-module-qtquick
    qml6-module-qtquick-window qt6-svg-plugins)
DEBIAN_OPTIONAL=(libkf6windowsystem-dev libkscreen-bin clang wireplumber brightnessctl)

# Names of the essential packages whose installation candidate is missing on this
# system. Empty output = all resolve. Used by both the install and the --check-deps
# path so the lists live in exactly one place.
essential_missing() {
    local pkg cand
    case "$DISTRO" in
        arch)
            for pkg in "${ARCH_ESSENTIAL[@]}"; do
                pacman -Si "$pkg" >/dev/null 2>&1 || printf '%s\n' "$pkg"
            done
            ;;
        debian)
            for pkg in "${DEBIAN_ESSENTIAL[@]}"; do
                cand="$(apt-cache policy "$pkg" 2>/dev/null | awk '/Candidate:/ {print $2}')"
                [[ -n "$cand" && "$cand" != "(none)" ]] || printf '%s\n' "$pkg"
            done
            ;;
    esac
}

# Verify every essential package resolves on this distro; exit non-zero (for
# --check-deps) or abort the install otherwise. The drift safety net.
check_deps() {
    case "$DISTRO" in
        arch | debian) ;;
        *)
            warn "Unsupported distro: install the deps from docs/install.md, then re-run with --skip-deps."
            return 1
            ;;
    esac
    if [[ "$DISTRO" == debian ]]; then sudo apt-get update; fi
    local missing
    mapfile -t missing < <(essential_missing)
    if [[ ${#missing[@]} -gt 0 ]]; then
        warn "Required packages have no installation candidate on this system:"
        printf '    %s\n' "${missing[@]}" >&2
        warn "A package may have been renamed on this release, or your package"
        warn "database is out of date. Sync it, or install the equivalents by hand"
        warn "(see docs/install.md), then re-run with --skip-deps."
        return 1
    fi
    say "All required packages resolve on this distro."
    return 0
}

# Install the available optional packages, tolerating a missing one (warn only).
# pacman/apt abort the whole call on an unknown name, so filter first.
install_optional() {
    local pkg available=() missing=() cand
    case "$DISTRO" in
        arch)
            for pkg in "${ARCH_OPTIONAL[@]}"; do
                if pacman -Si "$pkg" >/dev/null 2>&1; then available+=("$pkg"); else missing+=("$pkg"); fi
            done
            [[ ${#available[@]} -gt 0 ]] && { sudo pacman -S --needed --noconfirm "${available[@]}" || warn "Some optional packages failed to install."; }
            ;;
        debian)
            for pkg in "${DEBIAN_OPTIONAL[@]}"; do
                cand="$(apt-cache policy "$pkg" 2>/dev/null | awk '/Candidate:/ {print $2}')"
                if [[ -n "$cand" && "$cand" != "(none)" ]]; then available+=("$pkg"); else missing+=("$pkg"); fi
            done
            [[ ${#available[@]} -gt 0 ]] && sudo apt-get install -y --no-install-recommends "${available[@]}" || true
            ;;
    esac
    [[ ${#missing[@]} -gt 0 ]] && warn "Optional packages not found (the app still works without them): ${missing[*]}"
    return 0
}

install_deps() {
    # Essential first, and abort hard if any is missing: a half-met essential set
    # would only fail later mid-build with a cryptic error.
    check_deps || exit 1
    case "$DISTRO" in
        arch)
            say "Installing required packages (pacman, sudo)"
            sudo pacman -S --needed "${ARCH_ESSENTIAL[@]}"
            ;;
        debian)
            say "Installing required packages (apt, sudo)"
            sudo apt-get install -y --no-install-recommends "${DEBIAN_ESSENTIAL[@]}"
            ;;
    esac
    say "Installing optional packages"
    install_optional
}

# ── Dependency sanity check ─────────────────────────────────────────────────
check_tools() {
    say "Checking required tools"
    local missing=()
    for tool in node npm cmake cc; do
        command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        warn "Missing tools: ${missing[*]} (run without --skip-deps, or install them by hand)."
        exit 1
    fi
    # Qt6 + LayerShellQt back the overlay build. Hint here (warn, don't block:
    # CMake is the real gate) so a missing one gives a friendly message instead
    # of a raw CMake error mid-build.
    if ! pkg-config --exists Qt6Quick 2>/dev/null && [[ ! -d /usr/include/qt6 ]]; then
        warn "Qt6 not detected; the overlay build may fail. Install qt6-base-dev + qt6-declarative-dev + LayerShellQt (or re-run without --skip-deps)."
    fi
}

# ── Build ───────────────────────────────────────────────────────────────────
build() {
    say "Building the daemon + native overlay + editor (CMake)"
    cmake -S . -B build -DSPACEUX_BUILD_UI=ON
    cmake --build build -j"$(nproc)"

    say "Installing npm dependencies"
    npm install --no-audit --no-fund

    say "Building the core (TypeScript)"
    npm run build
}

# ── Device permissions ──────────────────────────────────────────────────────
# The daemon reads the SpaceMouse via evdev (the `input` group) and injects
# key combos via /dev/uinput (a udev rule grants the `input` group access, and
# the uinput module must load). Adding the user to `input` needs a re-login.
UDEV_RULE=/etc/udev/rules.d/99-spaceux-uinput.rules
UDEV_RULE_HIDRAW=/etc/udev/rules.d/99-spaceux-hidraw.rules
MODULES_CONF=/etc/modules-load.d/spaceux-uinput.conf

# The 3Dconnexion devices that enumerate under Logitech's vendor id (046d): the
# classic pucks predate 3Dconnexion's own 256f id. Matching these exact product
# ids (not all of 046d) keeps the rule from touching unrelated Logitech mice,
# keyboards or webcams. Modern devices use 256f, matched whole.
HIDRAW_046D_PIDS='c603|c605|c606|c621|c623|c625|c626|c627|c628|c629|c62b|c62e|c640'

setup_perms() {
    # id -un rather than $USER: robust under set -u if the env var is unset.
    local user
    user="$(id -un)"
    say "Setting up device permissions (sudo)"
    echo "  - udev rule for /dev/uinput access ($UDEV_RULE)"
    echo "  - udev rule for the SpaceMouse hidraw node, LED control ($UDEV_RULE_HIDRAW)"
    echo "  - load the uinput module on boot ($MODULES_CONF)"
    echo "  - add '$user' to the 'input' group (read the SpaceMouse)"
    # Express run applies these without a second prompt: device access is what
    # makes the app work, so the recommended path must set it up. The custom path
    # still asks; --skip-perms (handled by the caller) is the opt-out either way.
    if [[ "${EXPRESS:-0}" -ne 1 ]] && ! ask_yes "Apply these with sudo?"; then
        warn "Skipped. See docs/install.md to set them up by hand."
        return 0
    fi
    printf 'KERNEL=="uinput", GROUP="input", MODE="0660", OPTIONS+="static_node=uinput"\n' |
        sudo tee "$UDEV_RULE" >/dev/null
    # hidraw access for LED control (#460): 3Dconnexion's own vendor (256f) plus
    # the known 046d product ids; the daemon writes the LED report to this node.
    {
        printf 'KERNEL=="hidraw*", ATTRS{idVendor}=="256f", MODE="0660", GROUP="input"\n'
        printf 'KERNEL=="hidraw*", ATTRS{idVendor}=="046d", ATTRS{idProduct}=="%s", MODE="0660", GROUP="input"\n' "$HIDRAW_046D_PIDS"
    } | sudo tee "$UDEV_RULE_HIDRAW" >/dev/null
    printf 'uinput\n' | sudo tee "$MODULES_CONF" >/dev/null
    sudo modprobe uinput || warn "modprobe uinput failed; the daemon's key injection may be unavailable until a reboot."
    sudo udevadm control --reload-rules && sudo udevadm trigger
    sudo usermod -aG input "$user"
    warn "Log out and back in (or reboot) so the 'input' group membership takes effect."
}

# ── spacenavd (optional, for FreeCAD/Blender) ───────────────────────────────
# spacenavd is the upstream driver FreeCAD and Blender use for their built-in
# SpaceMouse 3D navigation. SpaceUX does NOT need it (it reads the device
# directly). Install it only if you use those apps. While the pie is open SpaceUX
# grabs the device, so FreeCAD/Blender pause; on close they resume. That needs
# spacenavd to run with grab=0 so SpaceUX can grab transiently.
setup_spacenavd() {
    [[ "$WITH_SPACENAVD" == "no" ]] && return 0
    # The recommended (express) install leaves spacenavd out: it is only for
    # FreeCAD/Blender and most users don't need it. --with-spacenavd opts in.
    [[ "${EXPRESS:-0}" -eq 1 && "$WITH_SPACENAVD" == "ask" ]] && return 0
    if [[ "$WITH_SPACENAVD" == "ask" ]]; then
        say "Optional: FreeCAD / Blender 3D navigation"
        echo "  spacenavd is the upstream driver FreeCAD and Blender use for their own"
        echo "  SpaceMouse 3D navigation. SpaceUX does not need it. Install it only if"
        echo "  you use those apps. SpaceUX and spacenavd coexist: while the pie is open"
        echo "  SpaceUX holds the device (those apps pause); on close they resume."
        ask_yes "Install spacenavd + libspnav for FreeCAD/Blender?" || return 0
    fi
    # Resilient: this is the optional step, so a failure here must never abort
    # the core install. Every external command tolerates failure with a warning.
    case "$DISTRO" in
        arch)
            # libspnav is in the official repos; spacenavd lives in the AUR, which
            # pacman can't install. Use an AUR helper if one is present (with
            # consent), otherwise tell the user how to install it themselves.
            sudo pacman -S --needed libspnav || warn "Could not install libspnav."
            if ! pacman -Qq spacenavd >/dev/null 2>&1; then
                local helper=""
                for h in yay paru; do
                    if command -v "$h" >/dev/null 2>&1; then
                        helper="$h"
                        break
                    fi
                done
                if [[ -n "$helper" ]] && ask_yes "spacenavd is in the AUR; build + install it now with $helper?"; then
                    "$helper" -S --needed spacenavd || warn "AUR install of spacenavd failed; install it by hand."
                else
                    warn "spacenavd is in the AUR. Install it with an AUR helper, e.g. 'yay -S spacenavd'."
                    return 0
                fi
            fi
            ;;
        debian)
            sudo apt-get install -y spacenavd libspnav0 || warn "Could not install spacenavd / libspnav0."
            ;;
        *)
            warn "Install spacenavd + libspnav by hand on this distro."
            return 0
            ;;
    esac
    sudo systemctl enable --now spacenavd 2>/dev/null ||
        warn "Could not enable the spacenavd service; start it the way your init expects."
    # SpaceUX needs spacenavd to not exclusively grab the device (grab=0) so its
    # own transient grab works. Set it only with consent and only if not already.
    if [[ ! -f /etc/spnavrc ]] || ! grep -qE '^[[:space:]]*grab[[:space:]]*=[[:space:]]*0([[:space:]]|$)' /etc/spnavrc 2>/dev/null; then
        if ask_yes "Set 'grab = 0' in /etc/spnavrc so SpaceUX and FreeCAD/Blender coexist?"; then
            if [[ -f /etc/spnavrc ]] && grep -qE '^[[:space:]]*grab[[:space:]]*=' /etc/spnavrc; then
                # Reconcile an existing grab line (e.g. grab = 1) instead of
                # appending a second, contradictory one.
                sudo sed -i -E 's/^[[:space:]]*grab[[:space:]]*=.*/grab = 0/' /etc/spnavrc
            else
                printf 'grab = 0\n' | sudo tee -a /etc/spnavrc >/dev/null
            fi
        else
            warn "Leave /etc/spnavrc as-is; if the pie can't grab the device, set 'grab = 0' there."
        fi
    fi
}

# ── Launcher + desktop entry ────────────────────────────────────────────────
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/spaceux"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/spaceux.desktop"

install_launcher() {
    say "Installing the launcher + desktop entry"
    mkdir -p "$BIN_DIR" "$DESKTOP_DIR"
    cat >"$LAUNCHER" <<LAUNCH
#!/usr/bin/env bash
# Launch SpaceUX from its source checkout. Generated by scripts/install.sh.
set -euo pipefail
ROOT="$ROOT"
"\$ROOT/build/spaceux-daemon" &
DAEMON_PID=\$!
trap 'kill "\$DAEMON_PID" 2>/dev/null || true' EXIT
cd "\$ROOT"
# Foreground (not exec) so this shell stays the parent and its EXIT trap kills
# the daemon when the core exits; exec would replace the shell and orphan it.
# A second launch while the core runs opens the editor and returns. Forward
# arguments so the autostart entry's --background flag (BACKGROUND_FLAG, see
# src/shared/launch.ts) reaches the core and keeps login silent.
node dist/core-host/main.js "\$@"
LAUNCH
    chmod +x "$LAUNCHER"
    cat >"$DESKTOP_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=SpaceUX
Comment=Radial pie menu for 3Dconnexion SpaceMouse devices
Exec=$LAUNCHER
Icon=$ROOT/assets/icon.png
Terminal=false
Categories=Utility;
DESKTOP
    case ":$PATH:" in
        *":$BIN_DIR:"*) ;;
        *) warn "$BIN_DIR is not on your PATH; run SpaceUX from the app menu, or add it to PATH." ;;
    esac
}

# ── Desktop environment check ───────────────────────────────────────────────
# SpaceUX's overlay needs KWin + the wlr-layer-shell protocol, and the cursor
# position comes from a KWin script over D-Bus. GNOME's Mutter implements
# neither, so the pie won't show there. Warn (don't block): the user can still
# build, and they may be on a KDE session the env var doesn't advertise.
check_desktop() {
    local de="${XDG_CURRENT_DESKTOP:-}"
    case "${de,,}" in
        *kde* | *plasma*) ;;
        *)
            warn "SpaceUX needs KDE Plasma (KWin + wlr-layer-shell); detected desktop: '${de:-unknown}'."
            warn "On GNOME or other compositors the pie overlay will not appear. Continuing anyway."
            ;;
    esac
}

# ── Run ─────────────────────────────────────────────────────────────────────
# --check-deps: only verify the required packages resolve, then exit (the CI
# dependency-drift check; also a quick local sanity check). Nothing is installed.
if [[ $CHECK_DEPS_ONLY -eq 1 ]]; then
    check_deps
    exit $?
fi

check_desktop

# Express vs custom (#424): accepting the default must yield a working setup, so
# the recommended path applies device access without a second prompt (the bare
# Enter that used to skip it was the footgun). A non-interactive run (curl | bash)
# takes the recommended path too. Answer 'n' for the granular, step-by-step flow.
EXPRESS=0
say "Recommended setup"
echo "  Installs dependencies, builds SpaceUX, sets up device access (udev rules"
echo "  + the 'input' group, via sudo) and installs the launcher. spacenavd for"
echo "  FreeCAD/Blender stays optional (--with-spacenavd to include it)."
if ask_yes_default "Install with recommended settings?"; then
    EXPRESS=1
fi

[[ $SKIP_DEPS -eq 1 ]] || install_deps
check_tools
build
# Install the launcher (the essential bit) before the optional spacenavd step,
# so a hiccup there can never leave the core install half-done.
[[ $SKIP_PERMS -eq 1 ]] || setup_perms
install_launcher
setup_spacenavd

say "Done."
echo "  Launch from your app menu (SpaceUX), or run: spaceux"
echo "  Press the SpaceMouse trigger button (button 0 by default) to open the pie."
echo "  If you set up the 'input' group just now, log out and back in first."
