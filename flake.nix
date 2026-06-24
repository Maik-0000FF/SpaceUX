{
  # SPDX-FileCopyrightText: Maik-0000FF
  # SPDX-License-Identifier: GPL-3.0-or-later
  #
  # Nix development environment for SpaceUX.
  #
  # This flake provides a reproducible *development* shell only: every build
  # dependency the installer (scripts/install.sh) resolves via pacman/apt is
  # pinned here instead, so `nix develop` drops you into a shell that can build
  # the daemon (CMake/C), the Qt6/QML overlay + editor (-DSPACEUX_BUILD_UI=ON)
  # and the TypeScript core (npm + tsc) without touching the host system.
  #
  # It deliberately does NOT install anything: no launcher, no autostart, no
  # udev rules. Device access (/dev/uinput + the SpaceMouse hidraw/evdev nodes,
  # the `input` group, the `uinput` module) is a system-level concern handled by
  # the OS configuration, not by this shell. On NixOS that lives in the system
  # flake; elsewhere it is what scripts/install.sh sets up.
  #
  # Usage:
  #   nix develop          # enter the dev shell
  #   npm run build:all    # build the daemon, then the TS core (see README)
  #   cmake -S . -B build/ui -DSPACEUX_BUILD_UI=ON && cmake --build build/ui
  #
  # The pin tracks nixos-unstable so it matches a typical rolling NixOS host
  # (Qt 6.11, kdePackages 6.x); flake.lock freezes the exact revision.

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      # Linux only: the daemon's CMakeLists.txt hard-fails to configure on any
      # other host, so a non-Linux dev shell would be a trap rather than a help.
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      # The packaged app: daemon + Qt overlay/editor + TS core, plus a `spaceux`
      # launcher. `nix run .#` to try it, or add it to a NixOS/home config.
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.callPackage ./nix/package.nix {
            src = self;
            npmDepsHash = "sha256-CCNQXkR59pUHckNedNYZaXd+rZVi5O16WzwMIY8hodQ=";
          };
        }
      );

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/spaceux";
        };
      });

      # Declarative install: adds the package, the SpaceMouse device access
      # (udev/uinput/groups) and a graphical-session autostart service. `self` is
      # closed over so the package option defaults to this flake's build.
      nixosModules.default = import ./nix/module.nix { inherit self; };

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          inherit (pkgs) lib;

          # Qt6 install layout in nixpkgs: every module ships its QML modules
          # under <pkg>/lib/qt-6/qml and its plugins under <pkg>/lib/qt-6/plugins.
          # Defined once so a Qt major bump is a single edit.
          qtLibDir = "lib/qt-6";

          # The Qt modules the overlay and editor link and load at runtime.
          # qtwayland is the platform plugin needed to actually show a window on
          # a Wayland session; qtsvg also carries the SVG image plugin used for
          # the pie icons. layer-shell-qt backs the wlr-layer-shell overlay.
          qtModules = [
            pkgs.qt6.qtbase
            pkgs.qt6.qtdeclarative
            pkgs.qt6.qtsvg
            pkgs.qt6.qtwayland
            pkgs.kdePackages.layer-shell-qt
          ];

          # Optional Qt/KDE modules the build picks up if present: per-monitor
          # scale (libkscreen) and the frosted-blur region (kwindowsystem). The
          # CMake build degrades to no-ops without them; included here so the
          # dev shell exercises the same code paths the supported target does.
          qtOptional = [
            pkgs.kdePackages.libkscreen
            pkgs.kdePackages.kwindowsystem
          ];
        in
        {
          default = pkgs.mkShell {
            # Build tooling. The C compiler comes from mkShell's stdenv.
            nativeBuildInputs = [
              pkgs.cmake
              pkgs.ninja
              pkgs.pkg-config
              pkgs.nodejs_22
              pkgs.clang-tools # clang-format / clang-tidy (.clang-* configs in-tree)
              # CI-parity lint tools, so the shellcheck and reuse-lint lanes can
              # be reproduced locally before pushing (the rest of CI runs via npm
              # or cmake, already covered above).
              pkgs.shellcheck
              pkgs.reuse
            ];

            buildInputs = qtModules ++ qtOptional;

            # The Qt setup hooks (sourced from the modules above) wire
            # CMAKE_PREFIX_PATH so find_package(Qt6 ...) / find_package(LayerShellQt)
            # resolve. The runtime search paths below are what a plain
            # `nix develop` run of a freshly built binary still needs, since no
            # wrapQtAppsHook wraps the in-tree build artefacts.
            shellHook = ''
              export QML2_IMPORT_PATH="${lib.makeSearchPath "${qtLibDir}/qml" (qtModules ++ qtOptional)}''${QML2_IMPORT_PATH:+:$QML2_IMPORT_PATH}"
              export QT_PLUGIN_PATH="${lib.makeSearchPath "${qtLibDir}/plugins" (qtModules ++ qtOptional)}''${QT_PLUGIN_PATH:+:$QT_PLUGIN_PATH}"
              export QT_QPA_PLATFORM="''${QT_QPA_PLATFORM:-wayland}"

              echo "SpaceUX dev shell: Qt $(qmake6 -query QT_VERSION 2>/dev/null || echo '6.x'), node $(node --version)"
              echo "  build daemon + core : npm run build:all"
              echo "  build Qt UI         : cmake -S . -B build/ui -DSPACEUX_BUILD_UI=ON && cmake --build build/ui"
            '';
          };
        }
      );
    };
}
