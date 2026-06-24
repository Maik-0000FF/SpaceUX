# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Nix package for SpaceUX. Builds the three halves of the app in one derivation:
# the C daemon and the Qt6 overlay + editor (CMake, -DSPACEUX_BUILD_UI=ON) and
# the TypeScript core (npm + tsc). Installs them under share/spaceux with a
# `spaceux` launcher (nix/spaceux-launcher.sh) that starts the daemon + core.
#
# The npm half is pinned by nix/package-lock.json (the repo root stays
# lockfile-free on purpose); `npmDepsHash` is passed from the flake and refreshed
# with `prefetch-npm-deps nix/package-lock.json`.
{
  lib,
  bash,
  runCommand,
  buildNpmPackage,
  nodejs_22,
  cmake,
  ninja,
  pkg-config,
  qt6,
  kdePackages,
  makeDesktopItem,
  copyDesktopItems,
  # From the flake:
  src,
  npmDepsHash,
}:
let
  # One source for the human-readable tagline (meta + the desktop entry below).
  description = "Radial pie menu for 3Dconnexion SpaceMouse devices";

  # The Qt modules the overlay + editor link and load at runtime (qtwayland is
  # the platform plugin; qtsvg also carries the icon SVG plugin; layer-shell-qt
  # backs the overlay). Optional libkscreen/kwindowsystem for scale + blur.
  qtModules = [
    qt6.qtbase
    qt6.qtdeclarative
    qt6.qtsvg
    qt6.qtwayland
    kdePackages.layer-shell-qt
  ];
  qtOptional = [
    kdePackages.libkscreen
    kdePackages.kwindowsystem
  ];
  qtLibDir = "lib/qt-6";
  # qtOptional is included so the overlay finds the KWindowSystem platform plugin
  # (kf6/kwindowsystem) and libkscreen at runtime; without it the overlay logs
  # "kf.windowsystem: Could not find any platform plugin" and the frosted blur +
  # per-monitor scale silently degrade to no-ops.
  qmlPath = lib.makeSearchPath "${qtLibDir}/qml" (qtModules ++ qtOptional);
  pluginPath = lib.makeSearchPath "${qtLibDir}/plugins" (qtModules ++ qtOptional);

  # buildNpmPackage / fetchNpmDeps want package-lock.json at the source root; the
  # repo keeps it under nix/ instead, so stage a copy at the root.
  pinnedSrc = runCommand "spaceux-src" { } ''
    cp -r ${src} $out
    chmod -R u+w $out
    cp $out/nix/package-lock.json $out/package-lock.json
  '';
in
buildNpmPackage {
  pname = "spaceux";
  version = "0.0.1";
  src = pinnedSrc;
  inherit npmDepsHash;
  nodejs = nodejs_22;
  npmFlags = [
    "--no-audit"
    "--no-fund"
  ];

  nativeBuildInputs = [
    cmake
    ninja
    pkg-config
    qt6.wrapQtAppsHook
    copyDesktopItems
  ];
  buildInputs = qtModules ++ qtOptional;

  # The binaries live under share/, not $out/bin, and the launcher sets the Qt
  # env itself, so the auto-wrapper has nothing to wrap.
  dontWrapQtApps = true;

  # cmake + ninja are here only for the manual build below; stop their setup
  # hooks from hijacking configure/build, which would fight buildNpmPackage's
  # npm phases (the Qt CMAKE_PREFIX_PATH still comes from the Qt setup hooks).
  dontUseCmakeConfigure = true;
  dontUseNinjaBuild = true;

  # App-menu entry, mirrored 1:1 from the from-source installer (scripts/
  # install.sh): the Nix package omitted it, so SpaceUX never appeared in an app
  # launcher (e.g. wofi/rofi/Noctalia). copyDesktopItems installs it into
  # share/applications; Icon=spaceux resolves by theme lookup to the icons
  # installed below. exec is the bare launcher (no --background): with the core
  # already running it just opens the editor.
  desktopItems = [
    (makeDesktopItem {
      name = "spaceux";
      desktopName = "SpaceUX";
      comment = description;
      exec = "spaceux";
      icon = "spaceux";
      terminal = false;
      categories = [ "Utility" ];
    })
  ];

  # npmBuildHook already ran `npm run build` (tsc -> dist/); now the C/Qt half.
  postBuild = ''
    cmake -S . -B build -G Ninja -DSPACEUX_BUILD_UI=ON
    cmake --build build
  '';

  installPhase = ''
    runHook preInstall

    # Drop dev dependencies; the runtime core only needs dbus-next + lodash.
    npm prune --omit=dev

    share=$out/share/spaceux
    mkdir -p "$share/build" "$out/bin"
    install -Dm755 -t "$share/build" \
      build/spaceux-daemon build/spaceux-overlay build/spaceux-editor
    cp -r dist "$share/dist"
    cp -r node_modules "$share/node_modules"
    cp -r assets "$share/assets"
    cp package.json "$share/package.json"

    substitute ${./spaceux-launcher.sh} "$out/bin/spaceux" \
      --subst-var-by bash "${bash}" \
      --subst-var-by share "$share" \
      --subst-var-by qmlPath "${qmlPath}" \
      --subst-var-by pluginPath "${pluginPath}" \
      --subst-var-by node "${nodejs_22}"
    chmod +x "$out/bin/spaceux"

    # Desktop-entry icon, both named "spaceux": the from-source installer points
    # Icon= at assets/icon.png, a distinct mark from the plain logo_*.svg, so
    # install exactly that for 1:1 parity (same artwork in the app menu).
    # hicolor/512x512 is the themed location, pixmaps the legacy fallback.
    install -Dm644 assets/icon.png "$out/share/icons/hicolor/512x512/apps/spaceux.png"
    install -Dm644 assets/icon.png "$out/share/pixmaps/spaceux.png"

    runHook postInstall
  '';

  meta = {
    inherit description;
    homepage = "https://github.com/Maik-0000FF/SpaceUX";
    license = lib.licenses.gpl3Plus;
    platforms = lib.platforms.linux;
    mainProgram = "spaceux";
  };
}
