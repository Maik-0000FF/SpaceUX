# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# NixOS module for SpaceUX. Turns the flake's package into a declarative install:
# it puts the app on the system, grants the SpaceMouse the device access the
# daemon needs (evdev read via the `input` group, the hidraw LED node + /dev/uinput
# via udev `uaccess`, and the `uinput` kernel module) and autostarts it on the
# graphical session via a systemd user service.
#
# The udev rules + PID list are mirrored 1:1 from the author's reference NixOS
# host (modules/input-devices.nix) which is the source of truth. The app's own
# XDG-autostart seeding stays inert here: it only fires when the install.sh
# launcher (~/.local/bin/spaceux) exists, which a Nix install never creates, so
# this service is the single autostart and no transient /nix/store path is baked
# into a ~/.config/autostart entry.
#
# Wired from the flake as `nixosModules.default`; `self` is closed over so the
# package option can default to this flake's own build for the host's system.
{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.spaceux;

  # Logitech-branded SpaceMice (vendor 046d) SpaceUX drives over raw hidraw.
  # Kept as one string so an ID change is a single edit, matching the reference
  # host's input-devices.nix.
  logitechSpacemousePids = "c603|c605|c606|c621|c623|c625|c626|c627|c628|c629|c62b|c62e|c640";
in
{
  options.programs.spaceux = {
    enable = lib.mkEnableOption "SpaceUX, the radial pie menu for 3Dconnexion SpaceMouse devices";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.system}.default;
      defaultText = lib.literalExpression "spaceux flake package for the host system";
      description = "The SpaceUX package to install and autostart.";
    };

    users = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      example = [ "alice" ];
      description = ''
        Users to add to the `input` and `video` groups so the daemon can read the
        SpaceMouse over evdev and adjust the display backlight via brightnessctl.
        A relogin (or reboot) is required for a group change to take effect.
      '';
    };

    deviceAccess = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Install the udev rules, the `uinput` kernel module and the group
        membership the daemon needs. Set to false if the host already grants
        SpaceMouse / uinput access elsewhere (e.g. an existing input-devices
        module) so the rules are not declared twice.
      '';
    };

    autostart = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Start SpaceUX as a systemd user service bound to graphical-session.target
        so it comes up with the Wayland session. The compositor must reach
        graphical-session.target with WAYLAND_DISPLAY imported into the user
        manager: KDE and the NixOS Hyprland module do this automatically; a
        hand-rolled mango/Hyprland session must run
        `systemctl --user import-environment WAYLAND_DISPLAY` and start the target
        (or this service) itself.
      '';
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    {
      # The app itself, plus brightnessctl (the brightness backend on wlroots
      # compositors). wpctl (volume), mmsg (mango) and hyprctl (Hyprland) come
      # from the host's audio / compositor setup, which is already present
      # wherever those run.
      environment.systemPackages = [
        cfg.package
        pkgs.brightnessctl
      ];
    }

    (lib.mkIf cfg.deviceAccess {
      boot.kernelModules = [ "uinput" ];

      users.users = lib.genAttrs cfg.users (_: {
        extraGroups = [
          "input"
          "video"
        ];
      });

      # hidraw LED access for 3Dconnexion (vendor 256f) + Logitech SpaceMice, and
      # a writable /dev/uinput (group input, plus uaccess for the session user).
      # uaccess grants the active-session user an ACL instead of relying on a
      # fixed group, the NixOS-idiomatic form.
      services.udev.extraRules = ''
        KERNEL=="hidraw*", ATTRS{idVendor}=="256f", TAG+="uaccess"
        KERNEL=="hidraw*", ATTRS{idVendor}=="046d", ATTRS{idProduct}=="${logitechSpacemousePids}", TAG+="uaccess"
        KERNEL=="uinput", SUBSYSTEM=="misc", GROUP="input", MODE="0660", TAG+="uaccess", OPTIONS+="static_node=uinput"
      '';
    })

    (lib.mkIf cfg.autostart {
      systemd.user.services.spaceux = {
        description = "SpaceUX radial pie menu for 3Dconnexion SpaceMouse";
        partOf = [ "graphical-session.target" ];
        after = [ "graphical-session.target" ];
        wantedBy = [ "graphical-session.target" ];
        # brightnessctl + wireplumber (wpctl) on PATH so volume/brightness work
        # even when the user manager's PATH is otherwise minimal. The compositor
        # IPC the desktop backends shell out to (mmsg for mango, hyprctl for
        # Hyprland) lives in the host's system profile, so expose that too; the
        # explicit path above would otherwise shadow the inherited PATH and the
        # cursor source + desktop actions could not resolve mmsg/hyprctl.
        # Covers system-wide installs (/run/current-system/sw/bin); a compositor
        # installed only via home-manager would need its per-user profile bin here.
        path = [
          pkgs.brightnessctl
          pkgs.wireplumber
          "/run/current-system/sw/bin"
        ];
        serviceConfig = {
          # --background keeps login silent (no editor window); the launcher
          # starts the daemon and reaps it when the service stops.
          ExecStart = "${lib.getExe cfg.package} --background";
          Restart = "on-failure";
          RestartSec = 2;
        };
      };
    })
  ]);
}
